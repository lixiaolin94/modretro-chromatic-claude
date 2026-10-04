import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, realpath } from "node:fs/promises";
import path from "node:path";
import { CHROMATIC_VERSION, selectChromaticTarget } from "../scripts/chromatic-runtime.mjs";
import { runChromaticCaptured, ChromaticNotStartedError, CHROMATIC_LIVE_DEFAULT_DURATION_SECONDS, CHROMATIC_LIVE_MIN_DURATION_SECONDS, CHROMATIC_LIVE_MAX_DURATION_SECONDS, } from "../scripts/chromatic.mjs";
import { inspectRom } from "./build.js";
import { ChromaticJournal } from "./chromatic-journal.js";
export class ChromaticDeviceError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.code = code;
        this.details = details;
    }
}
const MAX_CACHED_OPERATIONS = 64;
const SELECTION_AGE_MS = 5 * 60 * 1000;
const MAX_ROM_BYTES = 8 * 1024 * 1024;
const LIVE_SOURCE = "host-emulation-streamed-to-Chromatic";
const commandFields = {
    status: [], list_devices: ["requestId"], observe_devices: ["requestId"], operation_status: ["operationId", "requestId"],
    install_drivers: ["requestId", "sessionId", "confirm"],
    detect_cartridge: ["requestId", "deviceToken", "confirm"],
    flash: ["requestId", "deviceToken", "romPath", "expectedSha256", "expectedSizeBytes", "confirm"],
    play: ["requestId", "deviceToken", "romPath", "expectedSha256", "expectedSizeBytes", "confirm", "durationSeconds", "saveMode"],
};
function record(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function canonical(value) {
    if (Array.isArray(value))
        return `[${value.map(canonical).join(",")}]`;
    if (record(value))
        return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    return JSON.stringify(value) ?? "undefined";
}
function fingerprint(value) { return createHash("sha256").update(canonical(value)).digest("hex"); }
function required(value, name) {
    if (!value || value.length > 4096 || value.includes("\0"))
        throw new ChromaticDeviceError("CHROMATIC_INVALID_INPUT", `${name} is required.`);
    return value;
}
function vendorEnvelope(value, operation) {
    return record(value) && value.schema_version === 1 && value.operation === operation
        && typeof value.ok === "boolean" && Object.hasOwn(value, "result") && Object.hasOwn(value, "error")
        && (value.ok ? record(value.result) && value.error === null : value.result === null && record(value.error));
}
const CARTRIDGE_RECOVERY = "Only ModRetro cartridges are supported. Ask the user to clean the contacts on their cartridge and re-seat it into Chromatic before another authorized attempt.";
function playerConflictRecovery(player) {
    return {
        code: "CHROMATIC_PLAYER_AMBIGUOUS", action: "change_player_numbers",
        message: `${player === undefined ? "A player number is" : `Player ${player} is`} used by more than one Chromatic. To use these devices, give them different player numbers in the on-device settings menu, then unplug and replug Chromatic. Discover devices again before selecting one.`,
        ...(player === undefined ? {} : { diagnostics: { player } }),
    };
}
function deviceAccessRecovery(platform) {
    return {
        code: "CHROMATIC_DEVICE_ACCESS_REQUIRED", action: platform === "darwin" ? "check_device_access" : "install_drivers",
        message: platform === "darwin"
            ? "Check OS USB access and the device connection. macOS needs no additional vendor driver."
            : "Ensure the required Chromatic drivers and USB device permissions are properly installed. When setup is needed, run bundled chromatic-cli install-drivers --format json --yes through setup command install_drivers under the user's authorization for these system changes. Reuse existing permission. An installer success alone does not verify device access.",
    };
}
function associationRecovery(platform, unmatched) {
    return {
        code: "CHROMATIC_DEVICE_ASSOCIATION_INCOMPLETE", action: "check_device_association",
        message: `Some Chromatic USB functions could not be associated with a complete device. ${deviceAccessRecovery(platform).message} After setup, unplug and replug Chromatic, then discover devices again.`,
        diagnostics: { source: "vendor-reported", unmatchedCount: unmatched.length, driverHealth: "not_checked",
            checks: ["Review the unmatched USB functions and their association reasons.", "Verify that both the GWU2X programmer and player interface appear for the intended Chromatic."] },
    };
}
function hidRecovery(error, causes, platform) {
    if (error.code !== "device.input_unavailable")
        return undefined;
    const match = /expected one accessible gamepad on the selected Chromatic, found (\d+); check HID permissions/iu.exec(causes);
    const count = match ? Number(match[1]) : undefined;
    const matchingGamepads = Number.isSafeInteger(count) ? count : undefined;
    const status = matchingGamepads === 0 ? "missing" : matchingGamepads !== undefined && matchingGamepads > 1 ? "ambiguous"
        : /permission denied|access denied|LIBUSB_ERROR_ACCESS/iu.test(causes) ? "permission_denied" : "unavailable";
    const needsAccess = status === "missing" || status === "permission_denied";
    const checks = [platform === "linux"
            ? "Check that the selected Chromatic exposes streaming USB (VID 0x374e, PID 0x010f) and a HID gamepad with readable hidraw permissions."
            : platform === "win32"
                ? "Check that the selected Chromatic's USB and HID gamepad interfaces appear in Device Manager without device-access errors."
                : "Check that the selected Chromatic's USB and HID gamepad interfaces are visible and accessible to this application."];
    const access = deviceAccessRecovery(platform);
    return {
        code: needsAccess ? access.code : "CHROMATIC_HID_INPUT_UNAVAILABLE",
        action: needsAccess ? access.action : "check_hid_input",
        message: `${status === "missing" ? "No accessible HID gamepad was found for the selected Chromatic."
            : status === "ambiguous" ? "Multiple HID gamepads matched the selected Chromatic; the input association is ambiguous."
                : status === "permission_denied" ? "Access to the selected Chromatic's HID input was denied."
                    : "The selected Chromatic's HID input is unavailable; the cause has not been established."} ${checks[0]} ${needsAccess ? access.message + " " : ""}After the original operation finishes, unplug and replug Chromatic, then rediscover before another authorized attempt.`,
        diagnostics: { source: "vendor-reported", component: "hid_input", status,
            ...(matchingGamepads === undefined ? {} : { matchingGamepads }), driverHealth: "not_checked", checks },
    };
}
/** Guidance for a completed vendor failure; never dispatch recovery or retry here. */
function vendorRecovery(error, command, platform) {
    if (command === "write-homebrew" && error.code === "feature.developer_mode_required")
        return {
            code: "CHROMATIC_DEVELOPER_MODE_REQUIRED", action: "use_modretro_updater",
            message: chromaticErrorMessage(error),
        };
    // Several CLI operations wrap USB access failures in a phase-specific code.
    const causes = [error.message, ...(Array.isArray(error.causes) ? error.causes : [])]
        .filter((value) => typeof value === "string").join("\n");
    const deviceCommand = ["list-devices", "detect-cart", "write-homebrew", "live-demo"].includes(command);
    if (deviceCommand && error.code === "device.player_ambiguous") {
        const player = record(error.details) ? error.details.requested_player : undefined;
        return playerConflictRecovery(Number.isSafeInteger(player) && Number(player) >= 1 && Number(player) <= 8 ? Number(player) : undefined);
    }
    if (command === "live-demo") {
        const hid = hidRecovery(error, causes, platform);
        if (hid)
            return hid;
    }
    const usbFailure = typeof error.code === "string" && /^(?:device|usb|cartridge|flash)\./u.test(error.code);
    if (deviceCommand && (error.code === "device.permission_denied"
        || usbFailure && /permission denied|access denied|LIBUSB_ERROR_ACCESS|install-drivers|driver (?:is )?(?:not installed|missing)/iu.test(causes)))
        return deviceAccessRecovery(platform);
    const phase = record(error.details) ? error.details.phase : undefined;
    if (["detect-cart", "write-homebrew"].includes(command) && (error.code === "cartridge.not_readable"
        || error.code === "cartridge.inspect_failed" && ["detect", "read_header", "probe_flash"].includes(String(phase))
        || error.code === "flash.unsupported" || error.code === "flash.write_failed" && phase === "identify"))
        return {
            code: "CHROMATIC_CARTRIDGE_NOT_DETECTED", action: "clean_and_reseat_cartridge", message: CARTRIDGE_RECOVERY,
        };
    return undefined;
}
/** Public diagnostics never echo activation codes, credentials or raw vendor details. */
export function chromaticErrorMessage(error) {
    const value = record(error) ? error : {};
    const message = typeof value.message === "string" ? value.message : "The device operation failed.";
    // This changes wording only: it does not establish activation state or a safe retry.
    if (value.code === "feature.developer_mode_required" || /developer[ -]mode|activation|not activated/iu.test(message)) {
        return "Use ModRetro Updater to activate Developer Mode on this computer, then return here to install your game.";
    }
    return message.replace(/\bauthorization\b["']?\s*[:=]\s*[^\r\n;,]*/giu, "Authorization: [redacted]")
        .replace(/\b(?:Bearer|Basic)\s+\S+/giu, "[redacted authorization]")
        .replace(/\b(authorization|password|passphrase|client[_ -]?secret|secret|access[_ -]?token|refresh[_ -]?token|id[_ -]?token|token|api[_ -]?key)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/giu, "$1=[redacted]")
        .replace(/https?:\/\/\S+/giu, "[URL omitted]")
        .replace(/\b[A-Za-z0-9_-]{40,}\b/gu, "[redacted]")
        .replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 1000);
}
/** JSONL is documented; its lifecycle fields are not. Retain them without interpreting readiness. */
class VendorLifecycle {
    summary = {
        source: "vendor-reported", interpretation: "opaque-lifecycle-records", format: "jsonl",
        records: [], observedRecords: 0, omittedRecords: 0, observedBytes: 0,
        maxRecords: 16, maxLineBytes: 64 * 1024, error: undefined,
    };
    #pending = Buffer.alloc(0);
    #discardLine = false;
    #final;
    #fail(message) { this.summary.error ??= message; }
    #line(bytes) {
        const text = bytes.toString("utf8");
        if (!Buffer.from(text).equals(bytes)) {
            this.#fail("Invalid UTF-8 in vendor JSONL.");
            return;
        }
        if (!text.trim())
            return;
        if (this.#final)
            this.#fail("Vendor JSONL continued after its final result.");
        let value;
        try {
            value = JSON.parse(text);
        }
        catch {
            this.#fail("Malformed vendor JSONL record.");
            return;
        }
        this.summary.observedRecords++;
        this.summary.records.push(value);
        if (this.summary.records.length > this.summary.maxRecords) {
            this.summary.records.shift();
            this.summary.omittedRecords++;
        }
        if (vendorEnvelope(value, "live-demo"))
            this.#final = value;
    }
    push(bytes) {
        this.summary.observedBytes += bytes.length;
        let offset = 0;
        while (offset < bytes.length) {
            const newline = bytes.indexOf(10, offset);
            const end = newline < 0 ? bytes.length : newline;
            const part = bytes.subarray(offset, end);
            if (!this.#discardLine) {
                if (this.#pending.length + part.length > this.summary.maxLineBytes) {
                    this.#fail("Vendor JSONL record exceeded its byte limit.");
                    this.#pending = Buffer.alloc(0);
                    this.#discardLine = true;
                }
                else
                    this.#pending = Buffer.concat([this.#pending, part]);
            }
            if (newline < 0)
                break;
            if (!this.#discardLine)
                this.#line(this.#pending);
            this.#pending = Buffer.alloc(0);
            this.#discardLine = false;
            offset = newline + 1;
        }
    }
    finish() {
        if (!this.#discardLine && this.#pending.length)
            this.#line(this.#pending);
        this.#pending = Buffer.alloc(0);
        if (!this.#final)
            this.#fail("Vendor JSONL omitted a supported final result.");
        return this.summary.error ? undefined : this.#final;
    }
}
const SAVE_OWNER = "codex-gb-studio-live-demo-saves-v1";
const SAVE_MARKER = ".codex-live-demo.json";
function saveOwned(info, directory) {
    if (info.isSymbolicLink() || (directory ? !info.isDirectory() : !info.isFile() || info.nlink !== 1)
        || typeof process.getuid === "function" && info.uid !== process.getuid()
        || process.platform !== "win32" && (info.mode & 0o022)) {
        throw new Error("Live-demo saves require owned, unredirected directories and regular files.");
    }
}
function sameSaveIdentity(a, b) {
    // Creating a child legitimately changes a POSIX directory's link count.
    const keys = ["dev", "ino", "uid", "gid", "mode", ...(a.isDirectory() && b.isDirectory() ? [] : ["nlink"])];
    return keys.every((key) => a[key] === b[key]);
}
async function saveDirectory(filename) {
    const info = await lstat(filename);
    saveOwned(info, true);
    if (await realpath(filename) !== filename)
        throw new Error("Live-demo save path is redirected.");
    return info;
}
async function saveMarker(directory, expected, create) {
    const filename = path.join(directory, SAVE_MARKER);
    if (create) {
        const handle = await open(filename, "wx", 0o600);
        try {
            await handle.writeFile(JSON.stringify(expected) + "\n");
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }
    const before = await lstat(filename);
    saveOwned(before, false);
    if (before.size > 4096)
        throw new Error("Live-demo save marker is too large.");
    const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        const opened = await handle.stat();
        saveOwned(opened, false);
        if (!sameSaveIdentity(before, opened) || opened.size !== before.size)
            throw new Error("Live-demo save marker changed while opening.");
        const bytes = Buffer.alloc(opened.size);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
        const after = await handle.stat();
        if (bytesRead !== bytes.length || !sameSaveIdentity(opened, after) || after.size !== opened.size
            || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs
            || !sameSaveIdentity(after, await lstat(filename)) || await realpath(filename) !== filename
            || canonical(JSON.parse(bytes.toString("utf8"))) !== canonical(expected)) {
            throw new Error("Live-demo save marker does not match this owner and ROM.");
        }
    }
    finally {
        await handle.close();
    }
}
async function isolatedLiveSaves(root, sha256, create) {
    try {
        let current = path.resolve(root);
        await saveDirectory(current);
        for (const segment of ["artifacts", "chromatic-live-saves", sha256]) {
            const parent = current;
            const parentInfo = await saveDirectory(parent);
            current = path.join(parent, segment);
            let created = false;
            if (create) {
                try {
                    await mkdir(current, { mode: 0o700 });
                    created = true;
                }
                catch (error) {
                    if (error.code !== "EEXIST")
                        throw error;
                }
            }
            await saveDirectory(current);
            if (!sameSaveIdentity(parentInfo, await saveDirectory(parent)))
                throw new Error("Live-demo save parent changed.");
            if (segment !== "artifacts")
                await saveMarker(current, {
                    owner: SAVE_OWNER, schemaVersion: 1, ...(segment === sha256 ? { romSha256: sha256 } : {}),
                }, created);
        }
        let entries = 0;
        let totalBytes = 0;
        async function inspectTree(directory, depth) {
            if (depth > 4)
                throw new Error("Live-demo save directory exceeds its depth limit.");
            const before = await saveDirectory(directory);
            for await (const entry of await opendir(directory)) {
                if (++entries > 256)
                    throw new Error("Live-demo save directory exceeds its entry limit.");
                const filename = path.join(directory, entry.name);
                const info = await lstat(filename);
                saveOwned(info, info.isDirectory());
                if (await realpath(filename) !== filename)
                    throw new Error("Live-demo save member is redirected.");
                if (info.isDirectory())
                    await inspectTree(filename, depth + 1);
                else {
                    totalBytes += info.size;
                    if (info.size > 8 * 1024 * 1024 || totalBytes > 32 * 1024 * 1024)
                        throw new Error("Live-demo saves exceed their byte limit.");
                }
            }
            const after = await saveDirectory(directory);
            if (!sameSaveIdentity(before, after) || before.nlink !== after.nlink || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
                throw new Error("Live-demo save directory changed during inspection.");
            }
        }
        await inspectTree(current, 0);
        return current;
    }
    catch (error) {
        throw new ChromaticDeviceError("CHROMATIC_SAVE_UNSAFE", error instanceof Error ? error.message : String(error));
    }
}
function deviceRows(vendor) {
    const result = vendor.result;
    if (!record(result) || !Array.isArray(result.devices) || result.devices.length > 64 || !Array.isArray(result.unmatched)) {
        throw new ChromaticDeviceError("CHROMATIC_DISCOVERY_SCHEMA", "Device discovery did not return the supported device-list shape. No device was selected.");
    }
    for (const device of result.devices) {
        if (!record(device) || !Number.isSafeInteger(device.player) || Number(device.player) < 1 || Number(device.player) > 8
            || !record(device.location)
            || typeof device.location.bus_id !== "string" || device.location.bus_id.length === 0 || device.location.bus_id.length > 64
            || !Array.isArray(device.location.port_chain) || device.location.port_chain.length === 0 || device.location.port_chain.length > 16
            || device.location.port_chain.some((port) => !Number.isSafeInteger(port) || port < 1 || port > 255)
            || !record(device.gwu2x) || device.gwu2x.vendor_id !== 0x33aa || device.gwu2x.product_id !== 0x0120
            || !record(device.player_function) || device.player_function.vendor_id !== 0x374e || device.player_function.product_id !== 0x0100 + Number(device.player)) {
            throw new ChromaticDeviceError("CHROMATIC_DISCOVERY_SCHEMA", "Discovery returned an incomplete, ambiguous, or unrecognized device identity. No device was selected.");
        }
    }
    return result.devices;
}
function groupDevicesByPlayer(devices) {
    const groups = new Map();
    for (const device of devices) {
        const player = Number(device.player);
        const group = groups.get(player) ?? [];
        group.push(device);
        groups.set(player, group);
    }
    return groups;
}
function discoveryDiagnostics(groups, unmatched, platform) {
    const diagnostics = [...groups].filter(([, devices]) => devices.length > 1).map(([player]) => playerConflictRecovery(player));
    if (unmatched.length)
        diagnostics.push(associationRecovery(platform, unmatched));
    return diagnostics;
}
/** One service owns device operations; tool wrappers never launch vendor commands. */
export class ChromaticService {
    sessionId = randomUUID();
    #options;
    #execute;
    #inspect;
    #now;
    #operations = new Map();
    #requests = new Map();
    #selections = new Map();
    #journal;
    #leases = new Map();
    #accepting = true;
    #active;
    #lastDriverOperation;
    constructor(options = {}) {
        this.#options = options;
        this.#execute = options.execute ?? ((args, onEvent, onOutput, context) => runChromaticCaptured(args, { ...options, onEvent, onOutput, operationId: context?.operationId }));
        this.#inspect = options.inspect ?? inspectRom;
        this.#now = options.now ?? Date.now;
        this.#journal = new ChromaticJournal(options.stateRoot);
    }
    #journalAccess(read) {
        try {
            return read();
        }
        catch (error) {
            if (error instanceof Error && "code" in error && (error.code === "EPERM" || error.code === "EACCES")) {
                throw new ChromaticDeviceError("CHROMATIC_JOURNAL_ACCESS_DENIED", "Chromatic installation needs access to its local status files. Ask Claude to enable local device access, then reopen the preview.", { journalRoot: this.#journal.root, diagnostic: { code: error.code, message: error.message } });
            }
            throw error;
        }
    }
    #snapshot(operation) {
        const { settled: _settled, ...result } = operation;
        const writeDispatched = operation.commands.some((command) => command.args[0] === "write-homebrew" && command.dispatchAttemptedAt && command.processStart !== "not-started");
        return copy({ ...result, sessionId: this.sessionId, automaticRetry: false,
            ...(operation.command === "play" ? { source: LIVE_SOURCE } : {}),
            cartridgeWrite: !writeDispatched ? "not-dispatched" : operation.success ? "vendor-reported-success" : "outcome-unverified",
            processClosure: operation.commands.map((command) => {
                const launch = command.process ?? command.events.find((event) => event.type === "started");
                const elevation = record(launch?.elevation) ? launch.elevation : undefined;
                return { command: command.args[0],
                    scope: elevation?.method === "windows-run-as" ? "os-broker"
                        : elevation?.method === "polkit" ? "polkit-or-vendor" : launch ? "vendor" : "unobserved",
                    ...(launch?.pid !== undefined ? { pid: launch.pid } : {}),
                    ...(command.process?.exit ? { exit: command.process.exit } : {}),
                    ...(command.process?.close ? { close: command.process.close } : {}),
                    ...(command.processStart ? { processStart: command.processStart } : {}),
                    ...(elevation?.method === "windows-run-as" ? {
                        vendor: { scope: "os-broker-observation", closure: command.elevatedClosure ?? "unresolved",
                            ...(command.elevatedClosure === "vendor-exit-observed" ? {
                                pid: command.elevationResponse?.vendorPid, exitCode: command.elevationResponse?.vendorExitCode,
                                exitObservedAt: command.elevationResponse?.exitObservedAt,
                            } : {}),
                            stdout: "unobserved", stderr: "unobserved" },
                    } : {}),
                };
            }),
        });
    }
    status() {
        const platform = this.#options.platform ?? process.platform;
        const arch = this.#options.arch ?? process.arch;
        let backend;
        try {
            backend = { supported: true, target: selectChromaticTarget(this.#options), verification: "performed-before-each-vendor-command" };
        }
        catch (error) {
            backend = { supported: false, reason: error instanceof Error ? error.message : String(error) };
        }
        return {
            success: true, sessionId: this.sessionId, bundledVersion: CHROMATIC_VERSION, platform, arch, backend,
            pluginPlatformSupport: platform === "win32" ? arch === "x64" ? "experimental" : "unsupported" : "separate-from-vendor-binary-availability",
            drivers: {
                status: platform === "darwin" ? "not_required" : "not_checked",
                requirement: platform === "darwin" ? "No vendor driver installation is required on macOS."
                    : platform === "linux" ? "The plugin requests OS consent through pkexec to run the bundled udev-rule installer. A desktop polkit agent is required; no terminal/password fallback is used."
                        : platform === "win32" ? "The plugin requests Windows administrator consent for the bundled Gowin driver command. Its result reports the observed vendor exit status; vendor console output and driver health are not available through this route."
                            : "No supported vendor driver setup is available for this platform.",
                statusProbeAvailable: false,
                ...(this.#lastDriverOperation ? { lastAttempt: this.#operationStatus(this.#lastDriverOperation) } : {}),
            },
            runtimePrerequisites: platform === "win32"
                ? { status: "not_checked", required: ["VCRUNTIME140.dll", "Universal C Runtime"], bundled: false,
                    note: "These Windows prerequisites must be available before the vendor executable can start. Driver setup does not install them." }
                : { status: "described-by-backend-target" },
            acceptingOperations: this.#accepting,
            retainedReservation: this.#journalAccess(() => this.#journal.current()) ?? null,
            ...(this.#active ? { activeOperation: this.#snapshot(this.#active) } : {}),
            operations: [...this.#operations.values()].map(({ operationId, command, requestId, state, createdAt, finishedAt }) => ({ operationId, command, ...(requestId ? { requestId } : {}), state, createdAt, ...(finishedAt ? { finishedAt } : {}) })),
            retention: "The recent operation list is a bounded memory cache. Explicit action request IDs and results remain in the external journal; successful background observations retain only the latest scan on disk; failed observations remain available by their original operation IDs. A retained reservation blocks new device operations and is not proof of a live or closed process. Never delete it or retry automatically.",
        };
    }
    execute(input, root, signal) {
        signal?.throwIfAborted();
        const allowed = commandFields[input.command];
        if (!allowed || Object.keys(input).some((key) => key !== "command" && !allowed.includes(key))) {
            throw new ChromaticDeviceError("CHROMATIC_INVALID_INPUT", "Use only the fields documented for this Chromatic command.");
        }
        if (input.command === "status")
            return this.status();
        if (input.command === "operation_status") {
            if (Boolean(input.operationId) === Boolean(input.requestId))
                throw new ChromaticDeviceError("CHROMATIC_INVALID_INPUT", "Provide either operationId or requestId.");
            const id = input.operationId ?? fingerprint(["chromatic-request", required(input.requestId, "requestId")]);
            return this.#operationStatus(id);
        }
        if (input.command !== "list_devices" && input.command !== "observe_devices") {
            required(input.requestId, "requestId");
            if (input.confirm !== true)
                throw new ChromaticDeviceError("CHROMATIC_CONFIRMATION_REQUIRED", "Obtain explicit permission for this specific system or device change, then set confirm:true.");
        }
        if (input.requestId !== undefined) {
            const requestId = required(input.requestId, "requestId");
            const previous = this.#requests.get(requestId);
            if (previous) {
                if (previous.fingerprint !== fingerprint({ input, root }))
                    throw new ChromaticDeviceError("CHROMATIC_REQUEST_REUSED", "This requestId belongs to different arguments; its original operation is unchanged.");
                return this.#snapshot(this.#operations.get(previous.operationId));
            }
            const saved = this.#journalAccess(() => this.#journal.read(fingerprint(["chromatic-request", requestId])));
            if (saved) {
                if (saved.inputFingerprint !== fingerprint({ input, root }))
                    throw new ChromaticDeviceError("CHROMATIC_REQUEST_REUSED", "This requestId belongs to different original arguments.");
                return this.#recovered(saved);
            }
        }
        if (!this.#accepting)
            throw new ChromaticDeviceError("CHROMATIC_CLOSING", "The server is closing and will not start a new device operation.");
        if (this.#active)
            throw new ChromaticDeviceError("CHROMATIC_BUSY", "The original device operation has not closed. Read its status; do not start another.", { operationId: this.#active.operationId });
        if (input.command === "install_drivers" && input.sessionId !== this.sessionId)
            throw new ChromaticDeviceError("CHROMATIC_SESSION_CHANGED", "Read current device status before confirming driver setup in this session.");
        let selection;
        if (input.command === "detect_cartridge" || input.command === "flash" || input.command === "play") {
            selection = this.#selections.get(required(input.deviceToken, "deviceToken"));
            if (!selection || selection.expiresAt <= this.#now())
                throw new ChromaticDeviceError("CHROMATIC_SELECTION_EXPIRED", "Discover devices again and explicitly choose the intended device. No current selection is available.");
        }
        if (input.command === "flash" || input.command === "play") {
            required(input.romPath, "romPath");
            required(root, "authorized project or workspace root");
            if (!/^[a-f0-9]{64}$/u.test(input.expectedSha256 ?? "") || !Number.isSafeInteger(input.expectedSizeBytes)
                || input.expectedSizeBytes < 0x150 || input.expectedSizeBytes > MAX_ROM_BYTES) {
                throw new ChromaticDeviceError("CHROMATIC_INVALID_ROM_BINDING", "Use the exact SHA-256 and sizeBytes returned by rom_inspect for the selected ROM (at most 8 MiB).");
            }
        }
        if (input.command === "play") {
            const duration = input.durationSeconds === undefined ? CHROMATIC_LIVE_DEFAULT_DURATION_SECONDS : input.durationSeconds;
            if (!Number.isFinite(duration) || duration < CHROMATIC_LIVE_MIN_DURATION_SECONDS || duration > CHROMATIC_LIVE_MAX_DURATION_SECONDS
                || input.saveMode !== undefined && input.saveMode !== "none" && input.saveMode !== "isolated") {
                throw new ChromaticDeviceError("CHROMATIC_INVALID_INPUT", "Play requires 0.1–300 emulation seconds and saveMode none or isolated.");
            }
        }
        const operation = {
            operationId: input.requestId ? fingerprint(["chromatic-request", input.requestId]) : randomUUID(),
            inputFingerprint: fingerprint({ input, root }), command: input.command, ...(input.requestId ? { requestId: input.requestId } : {}),
            state: "running", stage: "preparing", createdAt: new Date(this.#now()).toISOString(), commands: [], settled: Promise.resolve(),
        };
        // A reported operation always has a durable reservation. A pre-admission
        // journal error is returned directly, never cached as an unrecorded result.
        try {
            this.#leases.set(operation.operationId, this.#journalAccess(() => this.#journal.acquire(operation.operationId, this.sessionId, this.#snapshot(operation))));
        }
        catch (error) {
            throw new ChromaticDeviceError(error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "CHROMATIC_JOURNAL_UNAVAILABLE", error instanceof Error ? error.message : String(error), error instanceof Error && "details" in error && record(error.details) ? error.details : undefined);
        }
        if (input.deviceToken)
            this.#selections.delete(input.deviceToken);
        if (input.command === "list_devices")
            this.#selections.clear();
        this.#operations.set(operation.operationId, operation);
        if (input.requestId)
            this.#requests.set(input.requestId, { operationId: operation.operationId, fingerprint: fingerprint({ input, root }) });
        this.#active = operation; // Reserve before any async inspection or enumeration.
        if (input.command === "install_drivers")
            this.#lastDriverOperation = operation.operationId;
        const cancelled = () => { operation.clientCancellationObservedAt = new Date(this.#now()).toISOString(); };
        signal?.addEventListener("abort", cancelled, { once: true });
        operation.settled = this.#perform(operation, input, root, selection).then((result) => {
            operation.result = result;
            operation.state = "succeeded";
            operation.success = true;
        }, (error) => {
            operation.state = "failed";
            operation.success = false;
            operation.error = error instanceof ChromaticDeviceError
                ? { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) }
                : { code: error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : "CHROMATIC_EXECUTION_ERROR",
                    message: error instanceof Error ? error.message : String(error),
                    ...(error instanceof Error && "details" in error && record(error.details) ? { details: error.details } : {}) };
        }).finally(() => {
            signal?.removeEventListener("abort", cancelled);
            operation.finishedAt = new Date(this.#now()).toISOString();
            operation.stage = "finished";
            const unclosed = operation.commands.some((command) => (command.events.some((event) => event.type === "started") && !command.process?.close)
                || (command.process?.elevation?.method === "windows-run-as" && !command.elevatedClosure));
            if (unclosed) {
                operation.state = "unresolved";
                operation.success = false;
            }
            try {
                this.#leases.get(operation.operationId)?.finish(this.#snapshot(operation), !unclosed);
            }
            catch (error) {
                operation.state = "unresolved";
                operation.success = false;
                operation.journalError = error instanceof Error ? error.message : String(error);
            }
            this.#leases.delete(operation.operationId);
            if (operation.state !== "unresolved")
                this.#active = undefined;
            this.#trimMemoryHistory();
        });
        return this.#snapshot(operation);
    }
    #operationStatus(id) {
        const operation = this.#operations.get(id);
        if (operation)
            return this.#snapshot(operation);
        const saved = this.#journalAccess(() => this.#journal.read(id));
        if (!saved)
            throw new ChromaticDeviceError("CHROMATIC_OPERATION_UNKNOWN", "No retained operation matches. Do not infer completion or retry it.");
        return this.#recovered(saved);
    }
    #trimMemoryHistory() {
        for (const [id, operation] of this.#operations) {
            if (this.#operations.size <= MAX_CACHED_OPERATIONS)
                break;
            if (operation.state === "running" || operation.state === "unresolved")
                continue;
            this.#operations.delete(id);
            if (operation.requestId)
                this.#requests.delete(operation.requestId);
        }
    }
    #recovered(saved) {
        const reservation = this.#journalAccess(() => this.#journal.current());
        const unresolved = saved.state === "running" || reservation?.operationId === saved.operationId;
        return { ...saved, recoveredFromJournal: true, observerSessionId: this.sessionId,
            ...(unresolved ? { state: "unresolved", recordedState: saved.state, recordedSuccess: saved.success, success: false,
                retainedReservation: reservation ?? null,
                completion: "The original reservation has not been qualified as released here. This journal does not supervise or inspect the original child." } : {}) };
    }
    async #vendor(operation, args) {
        if (!this.#accepting || operation.clientCancellationObservedAt)
            throw new ChromaticDeviceError("CHROMATIC_STOPPED_BEFORE_COMMAND", "The request or server was closing before the next vendor command. No later device action was started.");
        operation.stage = args[0];
        const command = { args: [...args], events: [] };
        const lifecycle = args[0] === "live-demo" ? new VendorLifecycle() : undefined;
        if (lifecycle)
            command.lifecycle = lifecycle.summary;
        operation.commands.push(command);
        const lease = this.#leases.get(operation.operationId);
        const index = operation.commands.length - 1;
        command.streamFiles = lease.prepareCommand(index);
        command.observedOutput = { stdout: 0, stderr: 0 };
        const empty = { observedBytes: 0, retainedBytes: 0, complete: true, sha256: createHash("sha256").digest("hex") };
        command.rawOutput = { stdout: { ...empty }, stderr: { ...empty } };
        command.dispatchAttemptedAt = new Date(this.#now()).toISOString();
        lease.write(this.#snapshot(operation));
        let result;
        try {
            result = await this.#execute(args, (event) => {
                command.events.push(copy(event));
                lease.write(this.#snapshot(operation));
            }, (stream, bytes) => {
                command.rawOutput[stream] = lease.output(index, stream, bytes);
                command.observedOutput[stream] += bytes.length;
                if (stream === "stdout")
                    lifecycle?.push(bytes);
                lease.write(this.#snapshot(operation));
            }, { operationId: operation.operationId });
        }
        catch (error) {
            // A generic executor failure or absent PID is not proof of non-start.
            if (error instanceof ChromaticNotStartedError && command.events.length === 0)
                command.processStart = "not-started";
            throw error;
        }
        command.process = result;
        // Node reports failed spawn with error + close, without spawn or exit.
        // An error after a spawned child must never qualify for this exception.
        if (result.error && result.close && result.pid === undefined && !result.spawn && !result.exit
            && !command.events.some(event => event.type === "spawn" || event.type === "exit" || event.pid !== undefined)) {
            command.processStart = "not-started";
        }
        let parsed;
        try {
            parsed = lifecycle ? lifecycle.finish() : JSON.parse(result.stdout.text);
            if (lifecycle?.summary.error)
                command.jsonError = lifecycle.summary.error;
            if (record(parsed)) {
                if (result.elevation?.method === "windows-run-as")
                    command.elevationResponse = parsed;
                else
                    command.vendor = parsed;
            }
        }
        catch (error) {
            command.jsonError = error instanceof Error ? error.message : String(error);
        }
        if (result.elevation?.method === "windows-run-as" && result.error && !result.spawn && !result.pid && result.close) {
            command.elevatedClosure = "not-started"; // The OS broker itself failed to spawn.
        }
        const complete = ["stdout", "stderr"].every((name) => {
            const stream = result[name];
            const raw = command.rawOutput[name];
            return !stream.error && stream.endObserved && stream.closeObserved && raw.complete && raw.observedBytes === stream.bytes;
        });
        if (!complete || result.observationErrors.length)
            throw new ChromaticDeviceError("CHROMATIC_CAPTURE_INCOMPLETE", "The original process result or output retention is incomplete. Any dispatched device change remains unverified; no retry was run.");
        if (lifecycle && (lifecycle.summary.error || lifecycle.summary.observedBytes !== result.stdout.bytes)) {
            throw new ChromaticDeviceError("CHROMATIC_RESPONSE_UNSUPPORTED", lifecycle.summary.error ?? "Vendor JSONL byte capture is incomplete. The original run was not repeated.");
        }
        if (result.elevation?.method === "windows-run-as") {
            const binding = result.elevation;
            if (!record(parsed) || parsed.schemaVersion !== 1 || parsed.source !== "codex-chromatic-uac"
                || binding.operationId !== operation.operationId || parsed.operationId !== operation.operationId
                || args[0] !== "install-drivers" || !/^[a-f0-9]{64}$/u.test(binding.sha256 ?? "")
                || parsed.executable !== binding.requestedExecutable || parsed.sha256 !== binding.sha256
                || canonical(parsed.args) !== canonical(binding.requestedArgs)
                || parsed.vendorStdout !== "unobserved" || parsed.vendorStderr !== "unobserved"
                || parsed.handlesDisposed !== true || parsed.disposalError !== undefined
                || result.stdout.truncated || !result.stdout.utf8Valid) {
                throw new ChromaticDeviceError("CHROMATIC_ELEVATION_UNRESOLVED", "The OS elevation result is missing or inconsistent. The vendor process remains unresolved; preserve this operation and do not retry.");
            }
            const beforeRequest = parsed.phase === "verify" && parsed.launchAttempted === false;
            const dismissed = parsed.phase === "request" && parsed.launchAttempted === true
                && record(parsed.error) && parsed.error.nativeErrorCode === 1223;
            if ((beforeRequest || dismissed) && record(parsed.error)
                && !Object.hasOwn(parsed, "vendorPid") && !Object.hasOwn(parsed, "vendorExitCode")) {
                command.elevatedClosure = "not-started";
                throw new ChromaticDeviceError(dismissed ? "CHROMATIC_ELEVATION_CANCELLED" : "CHROMATIC_ELEVATION_REFUSED", dismissed ? "Windows administrator consent was cancelled. No driver command started."
                    : "The bundled driver command failed validation before Windows consent. No driver command started.");
            }
            if (parsed.phase !== "closed" || parsed.launchAttempted !== true || parsed.error !== undefined
                || !Number.isSafeInteger(parsed.vendorPid) || Number(parsed.vendorPid) <= 0
                || !Number.isSafeInteger(parsed.vendorExitCode)
                || typeof parsed.startObservedAt !== "string" || !Number.isFinite(Date.parse(parsed.startObservedAt))
                || typeof parsed.exitObservedAt !== "string" || !Number.isFinite(Date.parse(parsed.exitObservedAt))
                || Date.parse(parsed.exitObservedAt) < Date.parse(parsed.startObservedAt)) {
                throw new ChromaticDeviceError("CHROMATIC_ELEVATION_UNRESOLVED", "Windows did not return a complete observed vendor exit. Keep the original operation; do not infer completion from the broker closing.");
            }
            command.elevatedClosure = "vendor-exit-observed";
            if (parsed.vendorExitCode !== 0 || result.error || !result.spawn || !result.pid || !result.exit
                || result.exit.code !== 0 || result.exit.signal !== null || result.close.code !== 0 || result.close.signal !== null) {
                throw new ChromaticDeviceError("CHROMATIC_VENDOR_FAILED", "The elevated driver command or its OS broker failed. Its observed exit is retained; vendor console output is unavailable and no retry was run.");
            }
            return parsed;
        }
        // A complete vendor rejection can have a nonzero exit. Preserve its useful
        // cause without changing cartridgeWrite or treating process close as no-write proof.
        if (!result.error && result.spawn && result.pid && result.exit && result.close
            && result.exit.signal === null && result.close.signal === null
            && Number.isInteger(result.exit.code) && result.exit.code === result.close.code
            && (lifecycle || !result.stdout.truncated && result.stdout.utf8Valid)
            && vendorEnvelope(parsed, args[0]) && !parsed.ok) {
            const error = parsed.error;
            const vendorCode = typeof error.code === "string" && /^[a-zA-Z0-9_.-]{1,128}$/u.test(error.code) ? error.code : undefined;
            const recovery = vendorRecovery(error, args[0], this.#options.platform ?? process.platform);
            throw new ChromaticDeviceError(result.exit.code === 0 ? "CHROMATIC_VENDOR_ERROR" : "CHROMATIC_VENDOR_FAILED", recovery?.message ?? chromaticErrorMessage(error), {
                commandIndex: operation.commands.length - 1, ...(vendorCode ? { vendorCode } : {}), ...(recovery ? { recovery } : {}),
            });
        }
        if (result.error || !result.spawn || !result.pid || !result.exit
            || result.exit.code !== 0 || result.exit.signal !== null || result.close.code !== 0 || result.close.signal !== null) {
            throw new ChromaticDeviceError("CHROMATIC_VENDOR_FAILED", "The original vendor command did not complete successfully. Its output, errors and process boundaries are retained; no retry or reset was run.", { commandIndex: operation.commands.length - 1 });
        }
        if (!lifecycle && (result.stdout.truncated || !result.stdout.utf8Valid))
            throw new ChromaticDeviceError("CHROMATIC_RESPONSE_UNVERIFIED", "The vendor process closed, but its response exceeds the parse bound or is not valid UTF-8. Raw output is retained separately; a dispatched cartridge write is not known to be untouched.");
        if (!vendorEnvelope(parsed, args[0]))
            throw new ChromaticDeviceError("CHROMATIC_RESPONSE_UNSUPPORTED", "The vendor response did not match the supported JSON envelope. The original output is retained; no follow-up command was run.");
        if (!parsed.ok) {
            const error = parsed.error;
            throw new ChromaticDeviceError("CHROMATIC_VENDOR_ERROR", chromaticErrorMessage(error), { commandIndex: operation.commands.length - 1 });
        }
        return parsed;
    }
    async #freshDevice(operation, selected) {
        const vendor = await this.#vendor(operation, ["list-devices", "--format", "json", "--yes"]);
        const groups = groupDevicesByPlayer(deviceRows(vendor));
        const matches = groups.get(selected.player) ?? [];
        const unmatched = vendor.result.unmatched;
        if (matches.length > 1) {
            const recovery = playerConflictRecovery(selected.player);
            throw new ChromaticDeviceError(recovery.code, recovery.message, { recovery, devices: matches });
        }
        if (selected.expiresAt <= this.#now() || matches.length !== 1 || fingerprint(matches[0]) !== selected.fingerprint) {
            const recovery = unmatched.length ? associationRecovery(this.#options.platform ?? process.platform, unmatched) : undefined;
            throw new ChromaticDeviceError("CHROMATIC_DEVICE_CHANGED", `The selected enumeration changed, expired, or disconnected. Discover devices and make a new explicit selection; nothing was written.${recovery ? " " + recovery.message : ""}`, recovery ? { recovery, unmatched } : undefined);
        }
        return { player: selected.player, diagnostics: discoveryDiagnostics(groups, unmatched, this.#options.platform ?? process.platform) };
    }
    async #perform(operation, input, root, selected) {
        selectChromaticTarget(this.#options);
        if (input.command === "list_devices" || input.command === "observe_devices") {
            const vendor = await this.#vendor(operation, ["list-devices", "--format", "json", "--yes"]);
            const groups = groupDevicesByPlayer(deviceRows(vendor));
            const unmatched = vendor.result.unmatched;
            const conflicts = [...groups].filter(([, devices]) => devices.length > 1).map(([player, devices]) => ({ player, devices }));
            const rows = [...groups.values()].filter(devices => devices.length === 1)
                .map(([device]) => ({ device: device, identity: fingerprint(device) }));
            const identities = new Set(rows.map(row => row.identity));
            const now = this.#now();
            // Background scans must not revoke another client's selection or renew
            // its consent window. Explicit discovery still clears tokens on admission.
            for (const [token, selection] of this.#selections) {
                if (selection.expiresAt <= now || !identities.has(selection.fingerprint))
                    this.#selections.delete(token);
            }
            const existing = new Map([...this.#selections].map(([token, selection]) => [selection.fingerprint, { token, selection }]));
            const devices = rows.map(({ device, identity }) => {
                const retained = existing.get(identity);
                const deviceToken = retained?.token ?? randomUUID();
                const expiresAt = retained?.selection.expiresAt ?? now + SELECTION_AGE_MS;
                if (!retained)
                    this.#selections.set(deviceToken, { player: Number(device.player), fingerprint: identity, expiresAt, discoveryId: operation.operationId, device: copy(device) });
                return { ...device, deviceToken, expiresAt: new Date(expiresAt).toISOString() };
            });
            return { devices, conflicts, unmatched, diagnostics: discoveryDiagnostics(groups, unmatched, this.#options.platform ?? process.platform),
                selection: "Choose a returned deviceToken explicitly; no default player is selected.", identityScope: "Current USB bus/port/player enumeration, not a permanent hardware identity. Rechecked before a device change." };
        }
        if (input.command === "install_drivers") {
            if ((this.#options.platform ?? process.platform) === "darwin")
                return { status: "not_required", executed: false, note: "macOS does not require this vendor driver installation." };
            const vendor = await this.#vendor(operation, ["install-drivers", "--format", "json", "--yes"]);
            if (vendor.source === "codex-chromatic-uac")
                return {
                    driverResult: vendor, statusScope: "OS-observed vendor exit status only. Vendor stdout/stderr are unavailable; driver health was not independently checked.",
                };
            return { vendorResult: vendor.result, statusScope: "Original installer response, not an independent driver-health probe." };
        }
        if (input.command === "detect_cartridge") {
            const { player, diagnostics } = await this.#freshDevice(operation, selected);
            const vendor = await this.#vendor(operation, ["detect-cart", "--all", "--player", String(player), "--format", "json", "--yes"]);
            const result = vendor.result;
            const cartridge = record(result.cartridge) ? result.cartridge : undefined;
            const flash = cartridge?.flash;
            const unidentified = cartridge && (flash === null || record(flash) && flash.model === null);
            return { vendorResult: result, selectedDevice: selected.device, diagnostics,
                ...(unidentified ? { recovery: { action: "clean_and_reseat_cartridge", message: CARTRIDGE_RECOVERY } } : {}) };
        }
        operation.stage = "inspect-rom";
        const checkRom = async () => {
            const rom = await this.#inspect(input.romPath, root);
            if (!rom.valid || rom.sha256 !== input.expectedSha256 || rom.sizeBytes !== input.expectedSizeBytes || rom.sizeBytes > MAX_ROM_BYTES) {
                throw new ChromaticDeviceError("CHROMATIC_ROM_CHANGED", "The current ROM is invalid or differs from the exact approved size and SHA-256. No ROM operation was started.", { actual: { path: rom.path, sizeBytes: rom.sizeBytes, sha256: rom.sha256, valid: rom.valid } });
            }
            return rom;
        };
        const before = await checkRom();
        const { player, diagnostics } = await this.#freshDevice(operation, selected);
        const rom = await checkRom(); // Rehash after enumeration, immediately before dispatch.
        if (rom.path !== before.path)
            throw new ChromaticDeviceError("CHROMATIC_ROM_CHANGED", "The canonical ROM path changed before dispatch. No ROM operation was started.");
        if (input.command === "play" && input.saveMode === "isolated") {
            operation.saveDirectory = await isolatedLiveSaves(root, rom.sha256, true);
            this.#leases.get(operation.operationId).write(this.#snapshot(operation));
        }
        if (selected.expiresAt <= this.#now())
            throw new ChromaticDeviceError("CHROMATIC_SELECTION_EXPIRED", "The device selection expired before dispatch. Discover it again before a new explicit attempt.");
        if (input.command === "play") {
            const durationSeconds = input.durationSeconds === undefined ? CHROMATIC_LIVE_DEFAULT_DURATION_SECONDS : input.durationSeconds;
            const vendor = await this.#vendor(operation, ["live-demo", rom.path, "--player", String(player), "--expect-sha256", rom.sha256,
                "--duration", String(durationSeconds), "--format", "jsonl", "--yes",
                ...(operation.saveDirectory ? ["--save-dir", operation.saveDirectory] : ["--no-save"])]);
            if (operation.saveDirectory)
                await isolatedLiveSaves(root, rom.sha256, false);
            return { source: LIVE_SOURCE, rom, selectedDevice: selected.device, diagnostics, durationSeconds,
                saves: { mode: input.saveMode ?? "none", directory: operation.saveDirectory ?? null },
                vendorResult: vendor.result, completion: "vendor-reported-success-and-process-closed" };
        }
        const vendor = await this.#vendor(operation, ["write-homebrew", rom.path, "--player", String(player), "--expect-sha256", rom.sha256, "--format", "json", "--yes"]);
        return { rom, selectedDevice: selected.device, diagnostics, vendorResult: vendor.result, manualBootAndPlayVerified: false };
    }
    /** Synchronous rejection of new work precedes waiting for the original child. */
    close() {
        this.#accepting = false;
        return Promise.all([...this.#operations.values()].map((operation) => operation.settled)).then(() => {
            if (this.#active)
                throw new ChromaticDeviceError("CHROMATIC_CLOSURE_UNKNOWN", "A recorded vendor process has no retained close boundary. No retry or cleanup signal was sent.", { operationId: this.#active.operationId });
        });
    }
}
//# sourceMappingURL=chromatic.js.map