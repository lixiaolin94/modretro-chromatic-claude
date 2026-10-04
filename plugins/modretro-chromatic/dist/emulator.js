import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { accessSync, appendFileSync, closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { PNG } from "pngjs";
import { RecordingMaintenance } from "./recording-maintenance.js";
import { assertSafePlatformPath, isPathWithinRoot, runtimeExecutablePaths, sanitizeSubprocessEnvironment, } from "./platform.js";
export const MAX_EMULATOR_FRAMES = 3_600;
export const MAX_EMULATOR_TIMELINE_ACTIONS = 128;
export const MAX_EMULATOR_TIMELINE_CHECKPOINTS = 64;
export const MAX_EMULATOR_INSPECTION_BYTES = 256;
export const MAX_EMULATOR_OAM_OBJECTS = 40;
export const EMULATOR_CLOCK_HZ = 4_194_304;
export const EMULATOR_DOTS_PER_FRAME = 70_224;
export const MAX_EMULATOR_RECORDING_BYTES = 512 * 1024 * 1024;
export const MAX_EMULATOR_RECORDING_FRAMES = 216_000;
export const MAX_EMULATOR_RECORDING_WALL_MS = 3_600_000;
export const MAX_EMULATOR_RECENT_FRAMES = 64;
export const MAX_EMULATOR_CLIP_FRAMES = 600;
export const MAX_EMULATOR_CLIP_CUTS = 16;
export const MAX_EMULATOR_RECORDING_EVENTS = 250_000;
export const MAX_EMULATOR_REVIEW_ACTIONS = 4_096;
export const MAX_EMULATOR_REVIEW_IMAGES = 8;
export const MAX_EMULATOR_REVIEW_METADATA_BYTES = 2 * 1024 * 1024;
export const MAX_EMULATOR_STEP_SAMPLES = 8;
export const MAX_EMULATOR_SAMPLE_BYTES = 128 * 1024;
export const EMULATOR_BUTTONS = [
    "a",
    "b",
    "up",
    "down",
    "left",
    "right",
    "start",
    "select",
];
export class EmulatorError extends Error {
    execution;
    imageDelivery;
    cleanup;
    constructor(message, options) {
        super(message, options);
        this.name = "EmulatorError";
    }
}
export class EmulatorTimelineError extends EmulatorError {
    failedActionIndex;
    advancedFrames;
    startFrame;
    frame;
    activeButtons;
    recordingSpan;
    sampledButtons;
    appliedButtons;
    constructor(message, details) {
        super(message);
        this.name = "EmulatorTimelineError";
        this.failedActionIndex = details.failedActionIndex;
        this.advancedFrames = details.advancedFrames;
        this.startFrame = details.startFrame;
        this.frame = details.frame;
        this.activeButtons = details.activeButtons;
        this.recordingSpan = details.recordingSpan;
        this.sampledButtons = details.sampledButtons;
        this.appliedButtons = details.appliedButtons;
    }
}
/** A persistent, root-bounded session around an optional PyBoy installation. */
export class EmulatorService {
    projectRoot;
    #pythonPath;
    #workerPath;
    #requestTimeoutMs;
    #platform;
    #pending = new Map();
    #diagnostics = [];
    #worker;
    #responses;
    #nextRequestId = 1;
    #activeRomPath;
    #activeRomDigest;
    #activeColorMode;
    #activeRecordingPath;
    #lastRecordingPath;
    #recordingRequested = false;
    #sessionGeneration = 0;
    #cancelPromise;
    #checkpointRecordings = new Map();
    #expectedExits = new WeakSet();
    #workerClosures = new WeakMap();
    #recordingMaintenance;
    #releaseRecordingAccess;
    #recordingWorkerClosed = Promise.resolve();
    #recordingWorkers = new Set();
    constructor(options = {}) {
        this.#platform = options.platform ?? process.platform;
        const configuredRoot = options.projectRoot ?? process.env.GB_STUDIO_PROJECT_ROOT ?? process.cwd();
        try {
            this.projectRoot = realpathSync(resolve(configuredRoot));
            if (!statSync(this.projectRoot).isDirectory()) {
                throw new Error("not a directory");
            }
        }
        catch (error) {
            throw new EmulatorError(`The emulator project root does not exist: ${configuredRoot}`, {
                cause: error,
            });
        }
        this.#recordingMaintenance = new RecordingMaintenance(this.projectRoot);
        const bundledWorker = fileURLToPath(new URL("../scripts/emulator_worker.py", import.meta.url));
        this.#workerPath = resolve(options.workerPath ?? bundledWorker);
        const packageRoot = dirname(dirname(bundledWorker));
        const configuredToolchain = options.toolchainRoot ?? process.env.GB_STUDIO_TOOLCHAIN_ROOT;
        let toolchainRoot = packageRoot;
        if (configuredToolchain) {
            try {
                toolchainRoot = realpathSync(resolve(configuredToolchain));
                if (!statSync(toolchainRoot).isDirectory()) {
                    throw new Error("not a directory");
                }
                const localDirectory = resolve(toolchainRoot, ".local");
                if (existsSync(localDirectory)) {
                    const canonicalLocal = realpathSync(localDirectory);
                    if (canonicalLocal !== localDirectory) {
                        if (basename(canonicalLocal) !== ".local" || !statSync(canonicalLocal).isDirectory()) {
                            throw new Error("invalid linked .local directory");
                        }
                        toolchainRoot = dirname(canonicalLocal);
                    }
                }
            }
            catch (error) {
                if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
                    // The stable dependency root can be absent on first launch. Setup may
                    // populate it later; constructing the server must not require Python.
                    toolchainRoot = resolve(configuredToolchain);
                }
                else {
                    throw new EmulatorError(`The emulator toolchain root is invalid: ${configuredToolchain}`, { cause: error });
                }
            }
        }
        const configuredPython = options.pythonPath ??
            process.env.GB_STUDIO_PYTHON ??
            runtimeExecutablePaths(toolchainRoot, this.#platform).emulatorPython;
        if (!isAbsolute(configuredPython)) {
            throw new EmulatorError("The emulator Python executable must be an absolute path");
        }
        if (this.#platform === "win32" && extname(configuredPython).toLowerCase() !== ".exe") {
            throw new EmulatorError("The Windows emulator Python executable must be an absolute .exe path");
        }
        this.#pythonPath = resolve(configuredPython);
        this.#requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
        if (!Number.isSafeInteger(this.#requestTimeoutMs) || this.#requestTimeoutMs < 1) {
            throw new EmulatorError("Emulator requestTimeoutMs must be a positive integer");
        }
    }
    /** True only while a successfully opened ROM still has a live worker. */
    get active() {
        return (this.#activeRomPath !== undefined &&
            this.#worker !== undefined &&
            this.#worker.exitCode === null &&
            this.#worker.signalCode === null);
    }
    async run(romPath, options = {}, signal) {
        if (signal?.aborted)
            throw new EmulatorError("The emulator open request was cancelled before execution");
        const validatedRom = this.#resolvePath(romPath, { existing: true });
        if (![".gb", ".gbc"].includes(extname(validatedRom).toLowerCase())) {
            throw new EmulatorError("The emulator requires an existing .gb or .gbc ROM");
        }
        const initialFrames = options.initialFrames ?? 120;
        this.#validateFrames(initialFrames, 0);
        if (options.cgb !== undefined && typeof options.cgb !== "boolean") {
            throw new EmulatorError("The cgb option must be a boolean");
        }
        if (options.restart !== undefined && typeof options.restart !== "boolean") {
            throw new EmulatorError("The restart option must be a boolean");
        }
        const recording = this.#validateRecordingOptions(options.recording);
        let romDigest;
        try {
            romDigest = createHash("sha256").update(readFileSync(validatedRom)).digest("hex");
        }
        catch (error) {
            throw new EmulatorError(`The emulator ROM could not be read: ${validatedRom}`, {
                cause: error,
            });
        }
        if (this.#worker !== undefined && this.#workerClosures.has(this.#worker)) {
            throw new EmulatorError("The emulator worker is closing; wait for cleanup before opening a ROM");
        }
        if (options.restart !== true &&
            recording === undefined &&
            this.active &&
            this.#activeRomPath === validatedRom &&
            this.#activeRomDigest === romDigest &&
            (options.cgb === undefined || options.cgb === this.#activeColorMode)) {
            return this.status();
        }
        const generation = ++this.#sessionGeneration;
        this.#clearActiveSession();
        this.#recordingRequested = recording !== undefined;
        if (recording !== undefined) {
            this.#activeRecordingPath = recording.outputPath;
            this.#lastRecordingPath = recording.outputPath;
        }
        let cancellation;
        let operationFailure;
        let openingWorker;
        const cancel = () => {
            cancellation ??= this.control({ action: "cancel" });
            // Observe rejection immediately; cleanup is awaited and reported below.
            void cancellation.catch(() => undefined);
        };
        signal?.addEventListener("abort", cancel, { once: true });
        try {
            const opening = this.#request("open", {
                romPath: validatedRom,
                initialFrames,
                ...(options.cgb === undefined ? {} : { cgb: options.cgb }),
                ...(recording === undefined ? {} : { recording }),
            });
            openingWorker = this.#worker;
            const state = await opening;
            if (signal?.aborted || generation !== this.#sessionGeneration) {
                throw new EmulatorError("The emulator open request was cancelled or superseded");
            }
            this.#activeRomPath = validatedRom;
            this.#activeRomDigest = romDigest;
            this.#activeColorMode = state.cgb;
            if (state.recording !== undefined) {
                this.#activeRecordingPath = state.recording.recordingPath;
                this.#lastRecordingPath = state.recording.recordingPath;
            }
            return state;
        }
        catch (error) {
            operationFailure = error instanceof EmulatorError ? error : new EmulatorError(error instanceof Error ? error.message : String(error), { cause: error });
            // A rejected open can leave its worker and recording-access lease alive
            // even though no active ROM was established. Use the ordinary owned
            // transport closure, without closing a session that superseded this run.
            if (generation === this.#sessionGeneration && (this.#worker === openingWorker || this.#worker === undefined)) {
                try {
                    await this.close();
                }
                catch (cleanup) {
                    operationFailure.cleanup = { status: "failed", error: cleanup instanceof Error ? cleanup.message : String(cleanup) };
                }
            }
            throw operationFailure;
        }
        finally {
            signal?.removeEventListener("abort", cancel);
            try {
                await cancellation;
            }
            catch (error) {
                const failure = operationFailure ?? new EmulatorError("Emulator open cancellation cleanup failed", { cause: error });
                failure.cleanup = { status: "failed", error: error instanceof Error ? error.message : String(error) };
                throw failure;
            }
        }
    }
    async control(options) {
        if (!["pause", "cancel"].includes(options?.action)) {
            throw new EmulatorError("Continuous play is unavailable; use exact stepped actions or cancel");
        }
        if (options.action !== "cancel") {
            return this.#request("control", { action: options.action });
        }
        if (this.#cancelPromise !== undefined)
            return this.#cancelPromise;
        this.#sessionGeneration++;
        const worker = this.#worker;
        if (worker === undefined)
            return { cancelled: true, closed: true };
        const cancellation = (async () => {
            let state;
            try {
                state = await this.#request("control", { action: "cancel" });
            }
            catch {
                // Cancellation must also handle a failed/pending open, a timeout, or a
                // concurrent caller which already closed the same worker.
            }
            finally {
                if (this.#worker === worker)
                    await this.close();
                else
                    await this.#terminateWorker(worker);
            }
            return state === undefined ? { cancelled: true, closed: true } : { ...state, cancelled: true, closed: true };
        })();
        this.#cancelPromise = cancellation;
        try {
            return await cancellation;
        }
        finally {
            if (this.#cancelPromise === cancellation)
                this.#cancelPromise = undefined;
        }
    }
    async recentFrames(options = {}) {
        if (options.limit !== undefined)
            this.#validateInteger(options.limit, "Recent frame limit", 1, MAX_EMULATOR_RECENT_FRAMES);
        return this.#request("recent_frames", { ...options });
    }
    async checkpointSave(options = {}) {
        if (options.label !== undefined && (typeof options.label !== "string" || options.label.length > 160)) {
            throw new EmulatorError("Checkpoint labels must contain at most 160 characters");
        }
        const checkpoint = await this.#request("checkpoint_save", { ...options });
        this.#checkpointRecordings.set(checkpoint.checkpointId, checkpoint.recordingPath);
        return checkpoint;
    }
    async checkpointRestore(options) {
        if (typeof options?.checkpointId !== "string" || !/^checkpoint-[0-9a-f]{32}$/u.test(options.checkpointId)) {
            throw new EmulatorError("Invalid opaque checkpoint ID");
        }
        const origin = options.recordingPath ?? this.#checkpointRecordings.get(options.checkpointId);
        return this.#request("checkpoint_restore", {
            checkpointId: options.checkpointId,
            ...(origin === undefined ? {} : { recordingPath: this.#resolveDirectory(origin) }),
        });
    }
    async recordingStatus(options = {}) {
        return this.#request("recording_status", this.#recordingSelection(options));
    }
    recordingAccessDiagnostic() {
        return { ...this.#recordingMaintenance.accessDiagnostic(), localTransports: {
                workerAttached: this.#worker !== undefined, workerTransportsAwaitingClose: this.#recordingWorkers.size,
                pendingRequests: this.#pending.size, emulatorActive: this.active,
            } };
    }
    async recordingExport(options = {}) {
        return this.#request("recording_export", this.#recordingSelection(options));
    }
    /** Maintain finalized recording storage without starting an emulator. */
    async recordingMaintain(options) {
        if (!["archive", "retrieve", "restore"].includes(options.action))
            throw new EmulatorError("Unknown recording maintenance action");
        if (this.#worker !== undefined || this.#pending.size || this.#releaseRecordingAccess !== undefined) {
            throw new EmulatorError("Close the emulator and settle its transports before recording maintenance");
        }
        const release = this.#recordingMaintenance.acquire();
        let result;
        try {
            result = this.#recordingMaintenance[options.action](options.recordingPath);
        }
        catch (error) {
            try {
                release();
            }
            catch (closure) {
                throw new EmulatorError(`${error instanceof Error ? error.message : String(error)}; ${closure instanceof Error ? closure.message : String(closure)}`, { cause: error });
            }
            throw error;
        }
        release();
        return result;
    }
    /** Read only already committed inputs and sampled PNGs; never capture or tick. */
    async recordingReview(options) {
        if (options === null || typeof options !== "object" || Array.isArray(options)) {
            throw new EmulatorError("Recording review requires an options object");
        }
        const allowed = new Set(["recordingPath", "sessionId", "branchId", "fromActionIndex", "toActionIndex", "fromFrame", "toFrame", "prefixPin", "maxImages"]);
        if (Object.keys(options).some((key) => !allowed.has(key)))
            throw new EmulatorError("Unknown recording review option");
        if (typeof options.sessionId !== "string" || !/^[0-9a-f]{32}$/u.test(options.sessionId)) {
            throw new EmulatorError("Recording review requires an exact sessionId");
        }
        if (typeof options.branchId !== "string" || options.branchId.length > 100 || !/^branch-[0-9]{4,}$/u.test(options.branchId)) {
            throw new EmulatorError("Recording review requires an exact branchId");
        }
        // Imported prefixes can contain more normalized actions than this journal
        // has events. Bound the requested delta, not its absolute branch indices.
        this.#validateInteger(options.fromActionIndex, "fromActionIndex", 0, Number.MAX_SAFE_INTEGER);
        this.#validateInteger(options.toActionIndex, "toActionIndex", 0, Number.MAX_SAFE_INTEGER);
        if (options.toActionIndex < options.fromActionIndex || options.toActionIndex - options.fromActionIndex > MAX_EMULATOR_REVIEW_ACTIONS) {
            throw new EmulatorError(`Review requires an ordered interval of at most ${MAX_EMULATOR_REVIEW_ACTIONS} normalized actions; narrow the interval`);
        }
        if ((options.fromFrame === undefined) !== (options.toFrame === undefined)) {
            throw new EmulatorError("Review frame bounds must be supplied together");
        }
        if (options.fromFrame !== undefined && options.toFrame !== undefined) {
            this.#validateInteger(options.fromFrame, "fromFrame", 0, MAX_EMULATOR_RECORDING_FRAMES);
            this.#validateInteger(options.toFrame, "toFrame", 0, MAX_EMULATOR_RECORDING_FRAMES);
            if (options.toFrame < options.fromFrame || options.toFrame - options.fromFrame > MAX_EMULATOR_FRAMES) {
                throw new EmulatorError(`Review requires an ordered interval of at most ${MAX_EMULATOR_FRAMES} native frames; narrow the interval`);
            }
        }
        if (options.prefixPin !== undefined) {
            const pin = options.prefixPin;
            if (pin === null || typeof pin !== "object" || Array.isArray(pin) ||
                Object.keys(pin).length !== 4 || Object.keys(pin).some((key) => !["eventCount", "eventDigest", "byteLength", "sha256"].includes(key))) {
                throw new EmulatorError("A recording prefix pin requires eventCount, eventDigest, byteLength, and sha256");
            }
            this.#validateInteger(pin.eventCount, "Prefix event count", 1, MAX_EMULATOR_RECORDING_EVENTS);
            this.#validateInteger(pin.byteLength, "Prefix byte length", 1, MAX_EMULATOR_RECORDING_BYTES);
            if (typeof pin.eventDigest !== "string" || !/^[0-9a-f]{64}$/u.test(pin.eventDigest) ||
                typeof pin.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(pin.sha256)) {
                throw new EmulatorError("Recording prefix digests must be lowercase SHA-256 values");
            }
        }
        const maxImages = options.maxImages === undefined ? 4 : options.maxImages;
        this.#validateInteger(maxImages, "Review image limit", 1, MAX_EMULATOR_REVIEW_IMAGES);
        const result = await this.#request("recording_review", {
            ...this.#recordingSelection(options), sessionId: options.sessionId,
            fromActionIndex: options.fromActionIndex, toActionIndex: options.toActionIndex, maxImages,
            ...(options.fromFrame === undefined ? {} : { fromFrame: options.fromFrame, toFrame: options.toFrame }),
            ...(options.prefixPin === undefined ? {} : { prefixPin: options.prefixPin }),
        });
        if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_EMULATOR_REVIEW_METADATA_BYTES) {
            throw new EmulatorError("Review metadata exceeds 2 MiB; narrow the interval");
        }
        return result;
    }
    async recordingStop(options = {}) {
        if (options.outcome !== undefined && !["passed", "failed", "needs-review", "cancelled"].includes(options.outcome)) {
            throw new EmulatorError("Unknown recording outcome");
        }
        if (options.reason !== undefined && (typeof options.reason !== "string" || options.reason.length > 2000)) {
            throw new EmulatorError("Recording outcome reason must contain at most 2000 characters");
        }
        return this.#request("recording_stop", { ...options });
    }
    async clip(options) {
        const outputPath = this.#resolvePath(options.outputPath, { existing: false });
        if (extname(outputPath).toLowerCase() !== ".gif" || existsSync(outputPath)) {
            throw new EmulatorError("A clip requires a new .gif output path; existing files are never overwritten");
        }
        const selection = this.#recordingSelection(options);
        const recordingRoot = String(selection.recordingPath);
        if (this.#recordingMaintenance.isArchived(recordingRoot))
            throw new EmulatorError("Restore an archived recording before creating derived clips; archive bytes are immutable");
        if (isPathWithinRoot(recordingRoot, outputPath, this.#platform)) {
            this.#assertRecordingPackageProtection(recordingRoot);
        }
        else {
            const generatedRoot = this.#unredirectedArtifactsRoot();
            if (!isPathWithinRoot(generatedRoot, outputPath, this.#platform)) {
                throw new EmulatorError("Clips must be written inside their recording directory or the authorized artifacts directory");
            }
        }
        for (const [name, value] of [["Clip start frame", options.startFrame], ["Clip end frame", options.endFrame]]) {
            if (value !== undefined)
                this.#validateInteger(value, name, 0, MAX_EMULATOR_RECORDING_FRAMES);
        }
        if (options.maxFrames !== undefined)
            this.#validateInteger(options.maxFrames, "Clip frame limit", 1, MAX_EMULATOR_CLIP_FRAMES);
        if (options.startFrame !== undefined && options.endFrame !== undefined && options.endFrame < options.startFrame) {
            throw new EmulatorError("Clip endFrame must not precede startFrame");
        }
        if (options.cuts !== undefined) {
            if (options.startFrame !== undefined || options.endFrame !== undefined) {
                throw new EmulatorError("Clip cuts cannot be combined with startFrame or endFrame");
            }
            if (!Array.isArray(options.cuts) || options.cuts.length < 1 || options.cuts.length > MAX_EMULATOR_CLIP_CUTS) {
                throw new EmulatorError(`A montage requires 1–${MAX_EMULATOR_CLIP_CUTS} ordered cuts`);
            }
            let periods = 0;
            for (const cut of options.cuts) {
                if (cut === null || typeof cut !== "object" || Array.isArray(cut) ||
                    Object.keys(cut).some((key) => !["startFrame", "endFrame"].includes(key))) {
                    throw new EmulatorError("Each montage cut requires only startFrame and endFrame");
                }
                this.#validateInteger(cut.startFrame, "Cut start frame", 0, MAX_EMULATOR_RECORDING_FRAMES);
                this.#validateInteger(cut.endFrame, "Cut end frame", cut.startFrame, MAX_EMULATOR_RECORDING_FRAMES);
                periods += cut.endFrame - cut.startFrame + 1;
            }
            if (periods * EMULATOR_DOTS_PER_FRAME > 60 * EMULATOR_CLOCK_HZ) {
                throw new EmulatorError("A montage may contain at most 60 seconds of native game time");
            }
        }
        return this.#request("clip", { ...selection, outputPath,
            ...(options.startFrame === undefined ? {} : { startFrame: options.startFrame }),
            ...(options.endFrame === undefined ? {} : { endFrame: options.endFrame }),
            ...(options.maxFrames === undefined ? {} : { maxFrames: options.maxFrames }),
            ...(options.cuts === undefined ? {} : { cuts: options.cuts.map((cut) => ({ ...cut })) }),
        });
    }
    async step(frames = 1) {
        this.#validateFrames(frames);
        return this.#request("step", { frames });
    }
    /** The sole interactive play primitive: exact inputs, exact frames, genuine samples. */
    async playStep(options, signal) {
        let execution = { status: "pre-execution-rejected" };
        let cancellation;
        let operationFailure;
        const cancel = () => {
            cancellation ??= this.control({ action: "cancel" });
            void cancellation.catch(() => undefined);
        };
        try {
            if (options === null || typeof options !== "object" || Array.isArray(options) ||
                Object.keys(options).some((key) => !["buttons", "frames", "sampleCount"].includes(key))) {
                throw new EmulatorError("A stepped action requires only buttons, frames, and optional sampleCount");
            }
            this.#validateButtonSet(options.buttons);
            this.#validateFrames(options.frames);
            execution.requestedFrames = options.frames;
            const sampleCount = options.sampleCount ?? 4;
            this.#validateInteger(sampleCount, "Step sample count", 1, MAX_EMULATOR_STEP_SAMPLES);
            if (signal?.aborted)
                throw new EmulatorError("The stepped action was cancelled before execution");
            if (!this.active)
                throw new EmulatorError("No emulator session is running; run a ROM first");
            signal?.addEventListener("abort", cancel, { once: true });
            // No authoritative response means unknown execution, never measured zero.
            execution = { status: "unknown", requestedFrames: options.frames };
            const result = await this.#request("play_step", {
                buttons: [...options.buttons], frames: options.frames, sampleCount,
            });
            this.#validateObservationExecution(result, options);
            execution = {
                status: "completed", requestedFrames: options.frames,
                startFrame: result.startFrame, frame: result.frame, advancedFrames: result.advancedFrames,
                appliedButtons: result.appliedButtons,
                ...(result.recordingSpan === undefined ? {} : { recordingSpan: result.recordingSpan }),
            };
            if (signal?.aborted)
                throw new EmulatorError("The stepped action completed before cancellation cleanup");
            // Preserve execution above even if subsequent image validation/read fails.
            this.#validateObservation(result, { ...options, sampleCount });
            execution.sampledButtons = result.sampledButtons;
            return { ...result, execution };
        }
        catch (error) {
            const failure = error instanceof EmulatorError ? error : new EmulatorError(error instanceof Error ? error.message : String(error), { cause: error });
            if (failure.execution?.status === "unknown") {
                execution = { ...failure.execution, requestedFrames: options.frames };
            }
            else if (error instanceof EmulatorTimelineError &&
                Number.isSafeInteger(error.startFrame) && error.startFrame >= 0 &&
                Number.isSafeInteger(error.frame) && error.frame >= error.startFrame &&
                error.advancedFrames === error.frame - error.startFrame &&
                Number.isSafeInteger(options?.frames) && error.advancedFrames <= options.frames) {
                execution = {
                    status: error.advancedFrames === options.frames ? "completed" : "known-partial",
                    requestedFrames: options.frames, startFrame: error.startFrame,
                    frame: error.frame, advancedFrames: error.advancedFrames,
                    ...(error.appliedButtons === undefined ? {} : { appliedButtons: error.appliedButtons }),
                    ...(error.sampledButtons === undefined ? {} : { sampledButtons: error.sampledButtons }),
                    ...(error.recordingSpan === undefined ? {} : { recordingSpan: error.recordingSpan }),
                };
            }
            else if (failure.execution?.status === "pre-execution-rejected") {
                execution = { status: "pre-execution-rejected", requestedFrames: options.frames };
            }
            failure.execution = execution;
            failure.imageDelivery = {
                status: execution.status === "pre-execution-rejected" ? "not-attempted" : execution.status === "unknown" ? "unavailable" : "failed",
                ...(execution.status === "pre-execution-rejected" ? {} : {
                    recovery: "Inspect emulator_status and recover images with emulator_observe or emulator_review. Do not repeat input to repair an image response.",
                }),
            };
            operationFailure = failure;
            throw failure;
        }
        finally {
            signal?.removeEventListener("abort", cancel);
            try {
                await cancellation;
            }
            catch (error) {
                const failure = operationFailure ?? new EmulatorError("Stepped action cancellation cleanup failed", { cause: error });
                failure.execution = execution;
                failure.cleanup = { status: "failed", error: error instanceof Error ? error.message : String(error) };
                throw failure;
            }
        }
    }
    /** Encode the current framebuffer in memory, without ticking or journaling. */
    async observe() {
        const result = await this.#request("observe", {});
        this.#validateObservation(result);
        return result;
    }
    #validateButtonSet(buttons) {
        if (!Array.isArray(buttons) || buttons.length > EMULATOR_BUTTONS.length ||
            buttons.some((button) => !EMULATOR_BUTTONS.includes(button)) || new Set(buttons).size !== buttons.length) {
            throw new EmulatorError("Buttons must be a complete unique set of Game Boy buttons; use [] for neutral input");
        }
    }
    #validateObservationExecution(result, step) {
        const sameButtons = (left, right) => [...left].sort().join(",") === [...right].sort().join(",");
        if (result === null || typeof result !== "object" ||
            result.paused !== true || result.clock?.mode !== "paused" ||
            !Number.isSafeInteger(result.startFrame) || result.startFrame < 0 ||
            !Number.isSafeInteger(result.frame) || result.frame !== result.startFrame + result.advancedFrames ||
            result.advancedFrames !== (step?.frames ?? 0)) {
            throw new EmulatorError("The stepped observation returned inconsistent native-frame or paused-state evidence");
        }
        this.#validateButtonSet(result.activeButtons);
        this.#validateButtonSet(result.appliedButtons);
        if (!sameButtons(result.appliedButtons, result.activeButtons) ||
            (step !== undefined && !sameButtons(result.appliedButtons, step.buttons))) {
            throw new EmulatorError("The stepped observation returned inconsistent applied controller input");
        }
    }
    #validateObservation(result, step) {
        this.#validateObservationExecution(result, step);
        this.#validateButtonSet(result.sampledButtons);
        if (result.width !== 160 || result.height !== 144) {
            throw new EmulatorError("The stepped observation must contain native 160×144 framebuffers");
        }
        const sameButtons = (left, right) => [...left].sort().join(",") === [...right].sort().join(",");
        const count = step === undefined ? 1 : Math.min(step.sampleCount ?? 4, step.frames);
        if (!Array.isArray(result.samples) || result.samples.length !== count) {
            throw new EmulatorError("The stepped observation did not return the requested bounded samples");
        }
        for (const [index, sample] of result.samples.entries()) {
            const frame = result.startFrame + (step === undefined ? 0 : Math.floor((index + 1) * step.frames / count));
            if (sample === null || typeof sample !== "object" || sample.frame !== frame ||
                sample.width !== 160 || sample.height !== 144 || typeof sample.pngBase64 !== "string" ||
                sample.pngBase64.length > Math.ceil(MAX_EMULATOR_SAMPLE_BYTES / 3) * 4 ||
                !/^[A-Za-z0-9+/]*={0,2}$/u.test(sample.pngBase64) ||
                typeof sample.sha256 !== "string" || !/^[0-9a-f]{64}$/u.test(sample.sha256) ||
                typeof sample.rgbaSha256 !== "string" || !/^[0-9a-f]{64}$/u.test(sample.rgbaSha256)) {
                throw new EmulatorError("The stepped observation returned invalid sample metadata");
            }
            this.#validateButtonSet(sample.sampledButtons);
            if (index === count - 1 && !sameButtons(result.sampledButtons, sample.sampledButtons)) {
                throw new EmulatorError("The observation's sampled buttons disagree with its final framebuffer sample");
            }
            if (step !== undefined && !sameButtons(sample.sampledButtons, step.buttons)) {
                throw new EmulatorError("The sampled framebuffer does not describe the requested controller input");
            }
            const bytes = Buffer.from(sample.pngBase64, "base64");
            if (bytes.toString("base64") !== sample.pngBase64 || bytes.length < 24 || bytes.length > MAX_EMULATOR_SAMPLE_BYTES ||
                !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
                bytes.readUInt32BE(16) !== 160 || bytes.readUInt32BE(20) !== 144 ||
                createHash("sha256").update(bytes).digest("hex") !== sample.sha256) {
                throw new EmulatorError("The stepped observation failed PNG dimension or SHA-256 verification");
            }
            const decoded = PNG.sync.read(bytes, { checkCRC: true });
            if (createHash("sha256").update(decoded.data).digest("hex") !== sample.rgbaSha256) {
                throw new EmulatorError("The stepped observation failed RGBA framebuffer verification");
            }
            if (sample.path !== undefined) {
                const filename = this.#resolvePath(sample.path, { existing: true });
                const descriptor = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
                try {
                    const before = fstatSync(descriptor);
                    if (!before.isFile() || before.size > MAX_EMULATOR_SAMPLE_BYTES) {
                        throw new EmulatorError("The retained stepped framebuffer exceeds its regular-file byte limit");
                    }
                    const buffer = Buffer.alloc(bytes.length + 1);
                    let count = 0;
                    while (count < buffer.length) {
                        const read = readSync(descriptor, buffer, count, buffer.length - count, count);
                        if (read === 0)
                            break;
                        count += read;
                    }
                    const after = fstatSync(descriptor);
                    if (count !== bytes.length || !buffer.subarray(0, count).equals(bytes) ||
                        before.size !== after.size || before.mtimeMs !== after.mtimeMs ||
                        this.#resolvePath(sample.path, { existing: true }) !== filename) {
                        throw new EmulatorError("The retained stepped framebuffer differs from the returned image");
                    }
                }
                finally {
                    closeSync(descriptor);
                }
                sample.path = filename;
            }
        }
    }
    async input(button, action, frames) {
        if (!EMULATOR_BUTTONS.includes(button)) {
            throw new EmulatorError(`Unknown Game Boy input button: ${String(button)}`);
        }
        if (action !== "press" && action !== "release" && action !== "tap") {
            throw new EmulatorError(`Unknown Game Boy input action: ${String(action)}`);
        }
        if (frames !== undefined) {
            this.#validateFrames(frames);
        }
        if (frames !== undefined && action !== "tap") {
            throw new EmulatorError("A frame count is only supported for tap input actions");
        }
        return this.#request("input", {
            button,
            action,
            ...(frames === undefined ? {} : { frames }),
        });
    }
    async capture(outputPath) {
        const validatedOutput = this.#resolvePath(outputPath, { existing: false });
        if (extname(validatedOutput).toLowerCase() !== ".png") {
            throw new EmulatorError("Emulator screenshots must use the .png extension");
        }
        return this.#request("screenshot", { outputPath: validatedOutput });
    }
    async timeline(actions) {
        this.#validateTimelineActions(actions, { requireActions: true });
        return this.#request("timeline", { actions });
    }
    async captureTimeline(checkpoints) {
        if (!Array.isArray(checkpoints) ||
            checkpoints.length < 1 ||
            checkpoints.length > MAX_EMULATOR_TIMELINE_CHECKPOINTS) {
            throw new EmulatorError(`An emulator capture timeline requires between 1 and ${MAX_EMULATOR_TIMELINE_CHECKPOINTS} checkpoints`);
        }
        const actions = [];
        const validatedCheckpoints = checkpoints.map((checkpoint, index) => {
            if (checkpoint === null ||
                typeof checkpoint !== "object" ||
                !Array.isArray(checkpoint.actions)) {
                throw new EmulatorError(`Emulator checkpoint ${index} requires an actions array`);
            }
            actions.push(...checkpoint.actions);
            const outputPath = this.#resolvePath(checkpoint.outputPath, { existing: false });
            if (extname(outputPath).toLowerCase() !== ".png") {
                throw new EmulatorError("Emulator timeline screenshots must use the .png extension");
            }
            return { actions: checkpoint.actions, outputPath };
        });
        this.#validateTimelineActions(actions, { requireActions: false });
        return this.#request("capture_timeline", {
            checkpoints: validatedCheckpoints,
        });
    }
    async inspect(options) {
        if (options === null || typeof options !== "object") {
            throw new EmulatorError("Emulator inspection requires a bounded inspection view");
        }
        switch (options.view) {
            case "oam": {
                if (options.limit !== undefined &&
                    (!Number.isSafeInteger(options.limit) ||
                        options.limit < 1 ||
                        options.limit > MAX_EMULATOR_OAM_OBJECTS)) {
                    throw new EmulatorError(`OAM inspection limits must be integers between 1 and ${MAX_EMULATOR_OAM_OBJECTS}`);
                }
                for (const value of [options.visibleOnly, options.includeScanlineSummary]) {
                    if (value !== undefined && typeof value !== "boolean") {
                        throw new EmulatorError("OAM inspection flags must be boolean values");
                    }
                }
                break;
            }
            case "memory":
            case "vram": {
                if (!["vram", "wram", "oam", "hram"].includes(options.region)) {
                    throw new EmulatorError("Memory inspection requires a named VRAM, WRAM, OAM, or HRAM region");
                }
                if (options.view === "vram" && options.region !== "vram") {
                    throw new EmulatorError("The VRAM inspection view only permits the VRAM region");
                }
                if (!Number.isSafeInteger(options.offset) || options.offset < 0) {
                    throw new EmulatorError("Memory inspection offsets must be non-negative integers");
                }
                if (!Number.isSafeInteger(options.length) ||
                    options.length < 1 ||
                    options.length > MAX_EMULATOR_INSPECTION_BYTES) {
                    throw new EmulatorError(`Memory inspections must return between 1 and ${MAX_EMULATOR_INSPECTION_BYTES} bytes`);
                }
                const regionSize = { vram: 0x2000, wram: 0x2000, oam: 0xa0, hram: 0x7f }[options.region];
                if (options.offset + options.length > regionSize) {
                    throw new EmulatorError(`The requested byte range exceeds the ${options.region} region`);
                }
                if (options.bank !== undefined) {
                    if (!Number.isSafeInteger(options.bank) || options.bank < 0) {
                        throw new EmulatorError("Memory bank selections must be non-negative integers");
                    }
                    if (options.region !== "vram" && options.region !== "wram") {
                        throw new EmulatorError("Only VRAM and WRAM regions support bank selection");
                    }
                    const maximumBank = options.region === "vram" ? 1 : 7;
                    if (options.bank > maximumBank) {
                        throw new EmulatorError(`The ${options.region} bank must be between 0 and ${maximumBank}`);
                    }
                    if (options.region === "wram" && options.offset + options.length > 0x1000) {
                        throw new EmulatorError("A banked WRAM inspection must remain inside one 4 KiB bank");
                    }
                }
                break;
            }
            default:
                throw new EmulatorError("Unsupported emulator inspection view");
        }
        return this.#request("inspect", { ...options });
    }
    async status() {
        return this.#request("state", {});
    }
    async close() {
        const worker = this.#worker;
        if (worker === undefined) {
            this.#clearActiveSession();
            await this.#releaseRecordingLease();
            return;
        }
        const existing = this.#workerClosures.get(worker);
        if (existing !== undefined)
            return existing;
        this.#sessionGeneration++;
        this.#expectedExits.add(worker);
        const closing = Promise.resolve().then(async () => {
            try {
                if (this.#worker === worker)
                    await this.#request("close", {});
            }
            finally {
                if (this.#worker === worker)
                    this.#clearActiveSession();
                worker.stdin.end();
                await this.#terminateWorker(worker, true);
                await this.#releaseRecordingLease();
            }
        });
        this.#workerClosures.set(worker, closing);
        try {
            await closing;
        }
        finally {
            if (this.#workerClosures.get(worker) === closing)
                this.#workerClosures.delete(worker);
        }
    }
    async #releaseRecordingLease() {
        const release = this.#releaseRecordingAccess;
        if (!release)
            return;
        let timer;
        try {
            await Promise.race([this.#recordingWorkerClosed, new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new EmulatorError("Recording transport closure is unresolved; access lease retained")), 2000);
                })]);
            if (this.#recordingWorkers.size !== 0)
                throw new EmulatorError("Worker transport closure changed; access lease retained");
            if (this.#releaseRecordingAccess === release) {
                release();
                this.#releaseRecordingAccess = undefined;
            }
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    #clearActiveSession() {
        this.#activeRomPath = undefined;
        this.#activeRomDigest = undefined;
        this.#activeColorMode = undefined;
        this.#activeRecordingPath = undefined;
        this.#recordingRequested = false;
    }
    #validateInteger(value, name, minimum, maximum) {
        if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
            throw new EmulatorError(`${name} must be an integer between ${minimum} and ${maximum}`);
        }
    }
    #validateRecordingOptions(value) {
        if (value === undefined || value === false)
            return undefined;
        if (value === null || typeof value !== "object" || Array.isArray(value)) {
            throw new EmulatorError("The recording option must be an object or false");
        }
        const bounds = {
            sampleEveryFrames: [1, MAX_EMULATOR_FRAMES],
            recentFrameCount: [1, MAX_EMULATOR_RECENT_FRAMES],
            maxBytes: [64 * 1024, MAX_EMULATOR_RECORDING_BYTES],
            maxFrames: [1, MAX_EMULATOR_RECORDING_FRAMES],
            maxWallTimeMs: [1, MAX_EMULATOR_RECORDING_WALL_MS],
        };
        for (const [key, item] of Object.entries(value)) {
            if (key === "outputPath")
                continue;
            const bound = bounds[key];
            if (bound === undefined)
                throw new EmulatorError(`Unknown recording option: ${key}`);
            this.#validateInteger(item, key, bound[0], bound[1]);
        }
        const outputPath = this.#resolvePath(value.outputPath ?? `artifacts/playtests/session-${randomUUID()}`, { existing: false });
        if (existsSync(outputPath))
            throw new EmulatorError("A recording output directory must be new; existing attempts are never overwritten");
        return { ...value, outputPath };
    }
    #resolveDirectory(path) {
        const resolved = this.#resolvePath(path, { existing: false });
        if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
            throw new EmulatorError("recordingPath must name an existing recording directory");
        }
        return existsSync(resolve(resolved, ".recording-archive.json")) || this.#recordingMaintenance.isArchived(resolved)
            ? this.#recordingMaintenance.resolveRecording(resolved) : resolved;
    }
    #assertRecordingPackageProtection(recordingRoot) {
        try {
            for (const name of [".gitignore", ".npmignore"]) {
                const path = resolve(recordingRoot, name);
                const entry = lstatSync(path);
                if (entry.isSymbolicLink() || !entry.isFile() || entry.size !== 2 ||
                    !readFileSync(path).equals(Buffer.from("*\n"))) {
                    throw new Error("recording package-protection marker changed");
                }
            }
        }
        catch (error) {
            throw new EmulatorError("The recording directory's package-protection markers are missing or changed", { cause: error });
        }
    }
    #unredirectedArtifactsRoot() {
        const lexicalRoot = resolve(this.projectRoot, "artifacts");
        try {
            const entry = lstatSync(lexicalRoot);
            if (entry.isSymbolicLink() || !entry.isDirectory()) {
                throw new EmulatorError("The top-level artifacts directory must not be a symbolic link, junction, or redirected path");
            }
        }
        catch (error) {
            if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
                throw error;
        }
        const canonicalRoot = this.#resolvePath(lexicalRoot, { existing: false });
        // Both directions express equality using the selected platform's drive,
        // separator, and case rules. Never bless a redirected packaged directory.
        if (!isPathWithinRoot(lexicalRoot, canonicalRoot, this.#platform) ||
            !isPathWithinRoot(canonicalRoot, lexicalRoot, this.#platform)) {
            throw new EmulatorError("The top-level artifacts directory must not be a symbolic link, junction, or redirected path");
        }
        return lexicalRoot;
    }
    #recordingSelection(options) {
        const selected = options.recordingPath ?? this.#activeRecordingPath ?? this.#lastRecordingPath;
        if (selected === undefined)
            throw new EmulatorError("A recordingPath is required when no retained recording is selected");
        if (options.branchId !== undefined && (typeof options.branchId !== "string" || !/^branch-[0-9]{4,}$/u.test(options.branchId))) {
            throw new EmulatorError("Invalid recording branch ID");
        }
        return { recordingPath: this.#resolveDirectory(selected), ...(options.branchId === undefined ? {} : { branchId: options.branchId }) };
    }
    async #terminateWorker(worker, grace = false) {
        if (worker.exitCode !== null || worker.signalCode !== null)
            return;
        await new Promise((resolveExit) => {
            let killed = false;
            const kill = setTimeout(() => {
                killed = true;
                worker.kill("SIGKILL");
            }, grace ? 2_000 : 1_000);
            kill.unref();
            const terminate = grace ? setTimeout(() => worker.kill("SIGTERM"), 1_000) : undefined;
            terminate?.unref();
            if (!grace)
                worker.kill("SIGTERM");
            const finished = () => {
                clearTimeout(kill);
                if (terminate !== undefined)
                    clearTimeout(terminate);
                if (killed)
                    this.#diagnostics.push("The emulator required forced process cleanup");
                resolveExit();
            };
            worker.once("exit", finished);
            if (worker.exitCode !== null || worker.signalCode !== null) {
                worker.off("exit", finished);
                finished();
            }
        });
    }
    #recordWorkerFailure(message) {
        const root = this.#activeRecordingPath;
        if (!this.#recordingRequested || root === undefined)
            return;
        try {
            if (!existsSync(root) || realpathSync(root) !== root || !statSync(root).isDirectory())
                return;
            const path = resolve(root, "worker-failures.jsonl");
            if (existsSync(path) && (lstatSync(path).isSymbolicLink() || statSync(path).size > 8_192))
                return;
            appendFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), message: message.slice(0, 2000) })}\n`, { mode: 0o600 });
        }
        catch {
            // The append-only worker journal still identifies an unfinished attempt.
            // Cleanup must not be prevented by a full disk or inaccessible artifact.
        }
    }
    #validateFrames(frames, minimum = 1) {
        if (!Number.isSafeInteger(frames) || frames < minimum || frames > MAX_EMULATOR_FRAMES) {
            throw new EmulatorError(`Emulator frame counts must be integers between ${minimum} and ${MAX_EMULATOR_FRAMES}`);
        }
    }
    #validateTimelineActions(actions, options) {
        if (!Array.isArray(actions) ||
            (options.requireActions && actions.length === 0) ||
            actions.length > MAX_EMULATOR_TIMELINE_ACTIONS) {
            throw new EmulatorError(`An emulator timeline permits at most ${MAX_EMULATOR_TIMELINE_ACTIONS} actions${options.requireActions ? " and requires at least one action" : ""}`);
        }
        let advancedFrames = 0;
        for (const [index, action] of actions.entries()) {
            if (action === null || typeof action !== "object") {
                throw new EmulatorError(`Emulator timeline action ${index} must be an object`);
            }
            switch (action.type) {
                case "hold":
                case "tap":
                    if (!EMULATOR_BUTTONS.includes(action.button)) {
                        throw new EmulatorError(`Unknown Game Boy input button in timeline action ${index}`);
                    }
                    this.#validateFrames(action.frames);
                    advancedFrames += action.frames;
                    if (action.settleFrames !== undefined) {
                        this.#validateFrames(action.settleFrames, 0);
                        advancedFrames += action.settleFrames;
                    }
                    break;
                case "step":
                    this.#validateFrames(action.frames);
                    advancedFrames += action.frames;
                    break;
                case "press":
                case "release":
                    if (!EMULATOR_BUTTONS.includes(action.button)) {
                        throw new EmulatorError(`Unknown Game Boy input button in timeline action ${index}`);
                    }
                    break;
                case "set_buttons":
                case "hold_buttons":
                    if (!Array.isArray(action.buttons) || action.buttons.length > EMULATOR_BUTTONS.length ||
                        action.buttons.some((button) => !EMULATOR_BUTTONS.includes(button)) ||
                        new Set(action.buttons).size !== action.buttons.length) {
                        throw new EmulatorError(`Timeline action ${index} requires a unique bounded Game Boy button set`);
                    }
                    if (action.type === "hold_buttons") {
                        this.#validateFrames(action.frames);
                        advancedFrames += action.frames;
                        if (action.settleFrames !== undefined) {
                            this.#validateFrames(action.settleFrames, 0);
                            advancedFrames += action.settleFrames;
                        }
                    }
                    break;
                default:
                    throw new EmulatorError(`Unknown emulator timeline action at index ${index}`);
            }
            if (advancedFrames > MAX_EMULATOR_FRAMES) {
                throw new EmulatorError(`An emulator timeline may advance at most ${MAX_EMULATOR_FRAMES} total frames`);
            }
        }
    }
    #resolvePath(path, options) {
        if (typeof path !== "string" || path.trim().length === 0) {
            throw new EmulatorError("An emulator ROM or output path must be a non-empty string");
        }
        try {
            assertSafePlatformPath(path, this.#platform);
        }
        catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            throw new EmulatorError(`The emulator path is not safe: ${reason}`, { cause: error });
        }
        const candidate = resolve(this.projectRoot, path);
        let resolvedPath;
        try {
            if (options.existing) {
                resolvedPath = realpathSync(candidate);
                if (!statSync(resolvedPath).isFile()) {
                    throw new Error("not a regular file");
                }
            }
            else {
                let ancestor = candidate;
                while (!existsSync(ancestor)) {
                    const parent = dirname(ancestor);
                    if (parent === ancestor) {
                        throw new Error("no existing parent directory");
                    }
                    ancestor = parent;
                }
                const resolvedAncestor = realpathSync(ancestor);
                resolvedPath = resolve(resolvedAncestor, relative(ancestor, candidate));
            }
        }
        catch (error) {
            throw new EmulatorError(`The emulator path is not accessible: ${candidate}`, {
                cause: error,
            });
        }
        if (!isPathWithinRoot(this.projectRoot, resolvedPath, this.#platform)) {
            throw new EmulatorError(`The emulator path must remain inside ${this.projectRoot}`);
        }
        return resolvedPath;
    }
    #startWorker() {
        if (this.#worker !== undefined) {
            return this.#worker;
        }
        if (this.#recordingWorkers.size !== 0)
            throw new EmulatorError("Previous worker transport closure is unresolved; replacement is refused");
        if (!existsSync(this.#workerPath)) {
            throw new EmulatorError(`The bundled emulator worker is missing: ${this.#workerPath}`);
        }
        try {
            accessSync(this.#pythonPath, constants.X_OK);
        }
        catch (error) {
            const setupCommand = this.#platform === "win32"
                ? "powershell -NoProfile -File scripts/setup.ps1"
                : "sh scripts/setup.sh";
            throw new EmulatorError(`The direct-play PyBoy runtime is unavailable. From a trusted compiled package, run ${setupCommand} doctor, ` +
                "then plan --components emulator with a separate owned --root. Apply requires explicit setup consent; binding prepared dependencies is a separate action. " +
                "Alternatively, configure GB_STUDIO_PYTHON as an absolute Python executable with verified PyBoy and Pillow.", { cause: error });
        }
        this.#diagnostics.length = 0;
        const environment = sanitizeSubprocessEnvironment({ ...process.env, PYTHONUNBUFFERED: "1" }, this.#platform);
        if (process.getuid)
            this.#releaseRecordingAccess ??= this.#recordingMaintenance.acquire();
        // Isolated Python ignores bytecode environment flags; avoid writing into external runtimes explicitly.
        const worker = spawn(this.#pythonPath, ["-I", "-B", "-u", this.#workerPath, "--root", this.projectRoot], {
            cwd: dirname(this.#workerPath),
            stdio: ["pipe", "pipe", "pipe"],
            shell: false,
            windowsHide: true,
            env: environment,
        });
        this.#worker = worker;
        this.#recordingWorkers.add(worker);
        const closed = new Promise((done) => worker.once("close", () => { this.#recordingWorkers.delete(worker); done(); }));
        this.#recordingWorkerClosed = Promise.all([this.#recordingWorkerClosed, closed]).then(() => undefined);
        this.#responses = createInterface({ input: worker.stdout, crlfDelay: Infinity });
        this.#responses.on("line", (line) => this.#handleResponse(line));
        worker.stderr.setEncoding("utf8");
        worker.stderr.on("data", (chunk) => {
            this.#diagnostics.push(chunk.trim());
            if (this.#diagnostics.length > 8) {
                this.#diagnostics.shift();
            }
        });
        worker.once("error", (error) => {
            this.#failWorker(worker, new EmulatorError(`Could not start the optional PyBoy emulator: ${error.message}`, {
                cause: error,
            }));
        });
        worker.once("exit", (code, signal) => {
            const details = this.#diagnostics.filter(Boolean).join(" ");
            const reason = signal === null ? `exit code ${String(code)}` : `signal ${signal}`;
            this.#failWorker(worker, new EmulatorError(`The PyBoy emulator stopped (${reason})${details.length > 0 ? `: ${details}` : ""}`));
        });
        return worker;
    }
    #failWorker(worker, error) {
        if (this.#worker !== worker) {
            return;
        }
        if (!this.#expectedExits.has(worker))
            this.#recordWorkerFailure(error.message);
        this.#clearActiveSession();
        this.#worker = undefined;
        this.#responses?.close();
        this.#responses = undefined;
        for (const [id, request] of this.#pending) {
            clearTimeout(request.timeout);
            this.#pending.delete(id);
            request.reject(error);
        }
    }
    #handleResponse(line) {
        let response;
        try {
            response = JSON.parse(line);
        }
        catch {
            this.#diagnostics.push(`Unexpected emulator output: ${line.slice(0, 300)}`);
            return;
        }
        if (typeof response.id !== "number") {
            return;
        }
        const request = this.#pending.get(response.id);
        if (request === undefined) {
            return;
        }
        clearTimeout(request.timeout);
        this.#pending.delete(response.id);
        if (response.error !== undefined) {
            const message = typeof response.error.message === "string"
                ? response.error.message
                : "The PyBoy emulator reported an unknown error";
            const details = response.error;
            if (typeof details.failedActionIndex === "number" &&
                typeof details.advancedFrames === "number" &&
                typeof details.startFrame === "number" &&
                typeof details.frame === "number" &&
                Array.isArray(details.activeButtons) &&
                details.activeButtons.every((button) => EMULATOR_BUTTONS.includes(button))) {
                request.reject(new EmulatorTimelineError(message, {
                    failedActionIndex: details.failedActionIndex,
                    advancedFrames: details.advancedFrames,
                    startFrame: details.startFrame,
                    frame: details.frame,
                    activeButtons: details.activeButtons,
                    ...(details.recordingSpan !== undefined ? { recordingSpan: details.recordingSpan } : {}),
                    ...(Array.isArray(details.sampledButtons) ? { sampledButtons: details.sampledButtons } : {}),
                    ...(Array.isArray(details.appliedButtons) && details.appliedButtons.length <= 8 &&
                        details.appliedButtons.every((button) => EMULATOR_BUTTONS.includes(button)) &&
                        new Set(details.appliedButtons).size === details.appliedButtons.length
                        ? { appliedButtons: details.appliedButtons } : {}),
                }));
            }
            else {
                const error = new EmulatorError(message);
                if (details.executionStatus === "pre-execution-rejected")
                    error.execution = { status: "pre-execution-rejected" };
                if (details.executionStatus === "unknown") {
                    error.execution = { status: "unknown" };
                    const prefix = details.confirmedPrefix;
                    if (prefix !== null && typeof prefix === "object" &&
                        Number.isSafeInteger(prefix.startFrame) && prefix.startFrame >= 0 &&
                        Number.isSafeInteger(prefix.frame) && prefix.frame >= prefix.startFrame &&
                        prefix.advancedFrames === prefix.frame - prefix.startFrame) {
                        error.execution.confirmedPrefix = prefix;
                    }
                }
                request.reject(error);
            }
        }
        else {
            request.resolve(response.result);
        }
    }
    async #request(method, params) {
        const artifactOnly = ["recording_status", "recording_export", "recording_review", "clip"].includes(method) && typeof params.recordingPath === "string";
        if (method !== "open" && !artifactOnly && this.#worker === undefined) {
            throw new EmulatorError("No emulator session is running; run a ROM first");
        }
        const worker = this.#startWorker();
        const id = this.#nextRequestId++;
        const result = await new Promise((resolveRequest, rejectRequest) => {
            const timeout = setTimeout(() => {
                const error = new EmulatorError(`The emulator ${method} request timed out`);
                this.#failWorker(worker, error);
                void this.#terminateWorker(worker);
            }, this.#requestTimeoutMs);
            timeout.unref();
            this.#pending.set(id, {
                resolve: resolveRequest,
                reject: rejectRequest,
                timeout,
            });
            worker.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
                if (error !== null && error !== undefined) {
                    const failure = new EmulatorError(`Could not contact the PyBoy emulator: ${error.message}`, {
                        cause: error,
                    });
                    this.#failWorker(worker, failure);
                    void this.#terminateWorker(worker);
                }
            });
        });
        return result;
    }
}
//# sourceMappingURL=emulator.js.map