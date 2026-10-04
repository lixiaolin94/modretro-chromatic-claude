import { randomUUID } from "node:crypto";
import { flashFailureDetails } from "./chromatic-failure-diagnostics.js";
import { chromaticErrorMessage } from "./chromatic.js";
export class PreviewFlashError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const record = (value) => !!value && typeof value === "object" && !Array.isArray(value);
const uncertain = (operation) => operation?.state === "unresolved" || operation?.cartridgeWrite === "outcome-unverified";
const diagnosticCode = (value) => typeof value === "string" && /^[a-zA-Z0-9_.-]{1,128}$/u.test(value) ? value : undefined;
function operationDiagnostics(operation) {
    const commands = Array.isArray(operation.commands) ? operation.commands.filter(record) : [];
    const errorDetails = record(operation.error) && record(operation.error.details) ? operation.error.details : {};
    const attempted = commands.filter(command => typeof command.dispatchAttemptedAt === "string");
    const closed = attempted.length > 0 && attempted.every(command => {
        const process = record(command.process) ? command.process : {};
        const elevation = record(process.elevation) ? process.elevation : {};
        return command.processStart === "not-started" || record(process.close) && typeof process.close.at === "string"
            && (elevation.method !== "windows-run-as" || command.elevatedClosure === "vendor-exit-observed" || command.elevatedClosure === "not-started");
    });
    const boundary = (value) => record(value) ? {
        ...(value.code === null || Number.isInteger(value.code) ? { code: value.code } : {}),
        ...(value.signal === null || diagnosticCode(value.signal) ? { signal: value.signal } : {}),
    } : undefined;
    return {
        processCompletion: closed ? "closed" : commands.length === 0 && Array.isArray(operation.commands) ? "not-dispatched" : "unconfirmed",
        ...(operation.journalError ? { journal: "Final status could not be recorded." } : {}),
        commands: commands.slice(0, 16).map((command, index) => {
            const process = record(command.process) ? command.process : {};
            const failureDetails = flashFailureDetails(operation, command);
            return {
                command: Array.isArray(command.args) ? diagnosticCode(command.args[0]) : undefined,
                version: diagnosticCode(process.version), target: diagnosticCode(process.target),
                ...(Number.isInteger(process.pid) ? { pid: process.pid } : {}),
                ...(command.processStart === "not-started" ? { processStart: "not-started" } : {}),
                exit: boundary(process.exit), close: boundary(process.close),
                // The service records this only after complete capture and validation of
                // the supported envelope against this exact command. Raw JSON is not a cause.
                vendorCode: errorDetails.commandIndex === index ? diagnosticCode(errorDetails.vendorCode) : undefined,
                ...(failureDetails ? { failureDetails } : {}),
                // Raw strings, argv, environment, auth values and vendor details stay out of the UI.
                outputComplete: Array.isArray(process.observationErrors) && process.observationErrors.length === 0
                    && record(command.rawOutput) && ["stdout", "stderr"].every(name => {
                    const output = command.rawOutput;
                    const stream = process[name];
                    return record(output[name]) && output[name].complete === true && record(stream)
                        && !stream.error && stream.endObserved === true && stream.closeObserved === true && output[name].observedBytes === stream.bytes;
                }),
            };
        }),
        ...(commands.length > 16 ? { omittedCommands: commands.length - 16 } : {}),
    };
}
/** A preview-scoped caller, not a second hardware service or operation journal. */
export class PreviewFlashControl {
    service;
    #requests = new Map();
    #latest;
    #discovery;
    #discoveryResult;
    #observation;
    #nextObservation = 0;
    #reviewed;
    constructor(service) {
        this.service = service;
    }
    #canDismiss(binding, operation, status) {
        if (!operation || operation.command !== "flash" || operation.state !== "failed" || operation.journalError ||
            this.#latest?.binding.generation !== binding.generation || this.#latest.binding.romSha256 !== binding.romSha256 ||
            status.activeOperation || status.retainedReservation || status.acceptingOperations !== true)
            return false;
        const diagnostics = operationDiagnostics(operation);
        return diagnostics.processCompletion === "closed" && diagnostics.commands.length > 0 && diagnostics.commands.every(command => Number.isInteger(command.pid) && command.pid > 0 && command.exit && command.close &&
            (typeof command.exit.code === "number" || typeof command.exit.signal === "string") &&
            command.exit.code === command.close.code && command.exit.signal === command.close.signal);
    }
    hasRequest(requestId) {
        return typeof requestId === "string" && this.#requests.has(requestId);
    }
    /** A changed project may read an exact existing request, never admit work. */
    recover(value, binding) {
        if (!record(value) || typeof value.requestId !== "string"
            || !["status", "discover", "flash"].includes(String(value.action)))
            return undefined;
        const original = this.#requests.get(value.requestId);
        if (!original || value.generation !== binding.generation || original.binding.generation !== binding.generation)
            return undefined;
        return this.execute(value, binding); // Existing mutation IDs take only the exact-replay branch.
    }
    #operation(request) {
        return request ? this.service.execute({ command: "operation_status", operationId: request.operationId }) : undefined;
    }
    #discoveryOperation(binding) {
        if (this.#discovery?.binding.generation !== binding.generation)
            return undefined;
        const operation = this.#discoveryResult ?? this.#operation(this.#discovery);
        // Background results have bounded service retention. Keep this preview's
        // settled selection or diagnostic until its next discovery replaces it.
        if (operation?.state !== "running")
            this.#discoveryResult = operation;
        return operation;
    }
    #devices(binding) {
        const operation = this.#discoveryOperation(binding);
        if (operation?.state !== "succeeded" || !record(operation.result) || !Array.isArray(operation.result.devices))
            return [];
        return operation.result.devices.flatMap((device) => {
            if (!record(device) || typeof device.deviceToken !== "string" || !UUID.test(device.deviceToken) ||
                typeof device.expiresAt !== "string" || !record(device.location) || !Array.isArray(device.location.port_chain))
                return [];
            return [{ token: device.deviceToken, expiresAt: device.expiresAt,
                    label: `Chromatic ${device.player} · USB ${device.location.bus_id} / ${device.location.port_chain.join(".")}` }];
        });
    }
    #status(binding, requestedId) {
        let observation;
        try {
            observation = this.#operation(this.#observation);
        }
        catch (error) {
            if (!record(error) || error.code !== "CHROMATIC_OPERATION_UNKNOWN")
                throw error;
            // A hidden preview may miss the terminal result before other observers
            // replace it. Only a read-only scan may be recovered with a new discovery.
            observation = { state: "failed", error: { code: "DEVICE_DISCOVERY_EXPIRED",
                    message: "The previous device discovery expired. Retry discovery to check the current connection." } };
        }
        if (this.#observation && observation?.state !== "running") {
            this.#discovery = this.#observation;
            this.#discoveryResult = observation;
            this.#observation = undefined;
            this.#nextObservation = Date.now() + 5_000;
        }
        const status = this.service.execute({ command: "status" });
        const latest = this.#operation(this.#latest);
        const request = requestedId ? this.#requests.get(requestedId) : this.#latest;
        const operation = request === this.#latest ? latest : this.#operation(request);
        const discovery = this.#discoveryOperation(binding);
        const discoveryFailed = discovery?.state === "failed" || discovery?.state === "unresolved";
        const discoveryError = discoveryFailed && record(discovery.error) ? discovery.error : undefined;
        const discoveryNotices = discovery?.state === "succeeded" && record(discovery.result) && Array.isArray(discovery.result.diagnostics)
            ? discovery.result.diagnostics.filter(record).slice(0, 9).flatMap(item => {
                const code = diagnosticCode(item.code);
                return code && typeof item.message === "string" ? [{ code, message: chromaticErrorMessage(item) }] : [];
            }) : [];
        const backend = record(status.backend) ? status.backend : {};
        const reviewed = this.#reviewed?.operationId === this.#latest?.operationId && this.#reviewed?.generation === binding.generation && this.#reviewed?.romSha256 === binding.romSha256
            && this.#canDismiss(binding, latest, status);
        const blocked = !!status.activeOperation || !!status.retainedReservation || status.acceptingOperations !== true || uncertain(latest) && !reviewed;
        return {
            generation: binding.generation,
            rom: { sha256: binding.romSha256, sizeBytes: binding.romSizeBytes },
            available: backend.supported === true,
            ...(typeof backend.reason === "string" ? { unavailableReason: backend.reason } : {}),
            blocked,
            dismissalAvailable: this.#canDismiss(binding, latest, status),
            ...(reviewed ? { newInstallReview: { ...this.#reviewed, previousCartridgeWrite: latest?.cartridgeWrite } } : {}),
            detecting: !!this.#observation,
            ...(discoveryNotices.length ? { discoveryNotices } : {}),
            ...(discoveryFailed ? { discoveryError: {
                    code: discoveryError?.code ?? "DEVICE_DISCOVERY_FAILED",
                    message: discoveryError ? chromaticErrorMessage(discoveryError) : "Device discovery could not complete. Check the original operation in the plugin.",
                    // Background observations are separate from the latest manual flash.
                    // Their operation ID is the recovery handle; their private request ID
                    // is not accepted by the preview's manual-request lookup.
                    ...(this.#discovery ? { operation: {
                            operationId: this.#discovery.operationId,
                            command: discovery.command, state: discovery.state, stage: discovery.stage,
                            cartridgeWrite: discovery.cartridgeWrite,
                            diagnostics: operationDiagnostics(discovery),
                        } } : {}),
                } } : {}),
            ...(requestedId && !request ? { requestedOperationUnknown: true } : {}),
            devices: this.#devices(binding),
            ...(operation && request ? { operation: {
                    requestId: request.requestId, operationId: request.operationId,
                    generation: request.binding.generation, romSha256: request.binding.romSha256,
                    command: operation.command, state: operation.state, stage: operation.stage,
                    cartridgeWrite: operation.cartridgeWrite,
                    ...(typeof operation.success === "boolean" ? { success: operation.success } : {}),
                    ...(record(operation.error) ? { error: { code: diagnosticCode(operation.error.code), message: chromaticErrorMessage(operation.error) } } : {}),
                    diagnostics: operationDiagnostics(operation),
                } } : {}),
        };
    }
    /** Read-only connection polling shares the hardware lock, but not the manual request quota. */
    #observe(binding, refresh = false) {
        const status = this.#status(binding);
        if (!status.available || status.blocked || this.#observation || !refresh && (status.discoveryError || Date.now() < this.#nextObservation))
            return status;
        const requestId = randomUUID();
        const operation = this.service.execute({ command: "observe_devices", requestId: `preview-observe:${requestId}` });
        this.#nextObservation = Date.now() + 5_000;
        this.#observation = { input: "", requestId, operationId: String(operation.operationId), binding };
        return this.#status(binding);
    }
    execute(value, binding) {
        if (!record(value) || value.generation !== binding.generation) {
            throw new PreviewFlashError("PREVIEW_CHANGED", "This preview changed. Reload it before using device controls.");
        }
        const allowed = value.action === "dismiss_failure" ? ["action", "generation", "requestId", "operationId", "acknowledgePreviousOutcome"]
            : value.action === "status" ? ["action", "generation", "requestId"]
                : value.action === "observe" || value.action === "refresh" ? ["action", "generation"] : value.action === "discover"
                    ? ["action", "generation", "requestId"]
                    : value.action === "flash"
                        ? ["action", "generation", "requestId", "deviceToken", "acknowledgeErase", "acknowledgeSaveLoss", "acknowledgeNoBackup"] : [];
        if (!allowed.length || Object.keys(value).some(key => !allowed.includes(key)) ||
            (value.requestId !== undefined && (typeof value.requestId !== "string" || !UUID.test(value.requestId)))) {
            throw new PreviewFlashError("INVALID_REQUEST", "Invalid preview device request.");
        }
        if (value.action === "status")
            return this.#status(binding, value.requestId);
        if (value.action === "dismiss_failure") {
            const status = this.service.execute({ command: "status" }), latest = this.#operation(this.#latest);
            if (value.requestId !== this.#latest?.requestId || value.acknowledgePreviousOutcome !== true ||
                (value.operationId !== this.#latest?.operationId || !this.#canDismiss(binding, latest, status))) {
                throw new PreviewFlashError("REVIEW_UNAVAILABLE", "A new installation requires the exact closed failed operation and released device ownership. Its original outcome stays unchanged.");
            }
            this.#reviewed = { operationId: this.#latest.operationId, requestId: this.#latest.requestId,
                generation: binding.generation, romSha256: binding.romSha256 };
            this.#discovery = undefined;
            this.#discoveryResult = undefined;
            return this.#status(binding);
        }
        if (value.action === "observe")
            return this.#observe(binding);
        if (value.action === "refresh")
            return this.#observe(binding, true);
        if (typeof value.requestId !== "string")
            throw new PreviewFlashError("INVALID_REQUEST", "A request identity is required.");
        if (value.action === "flash" && (typeof value.deviceToken !== "string" || !UUID.test(value.deviceToken) ||
            value.acknowledgeErase !== true || value.acknowledgeSaveLoss !== true || value.acknowledgeNoBackup !== true)) {
            throw new PreviewFlashError("CONFIRMATION_REQUIRED", "Choose a device and acknowledge cartridge erasure, possible save loss, and that no backup is made.");
        }
        const fingerprint = JSON.stringify(allowed.map(key => value[key]));
        const previous = this.#requests.get(value.requestId);
        if (previous) {
            if (previous.input !== fingerprint)
                throw new PreviewFlashError("REQUEST_REUSED", "This request belongs to a different action. Its original result is unchanged.");
            return this.#status(binding, value.requestId);
        }
        if (this.#requests.size >= 64)
            throw new PreviewFlashError("REQUEST_LIMIT", "This plugin session has reached its preview device-request limit. Restart the plugin only after its original device operation has settled.");
        const current = this.#status(binding);
        if (current.blocked)
            throw new PreviewFlashError("DEVICE_BUSY", "A device operation is pending or its write outcome is unverified. Check its original status; do not retry the write.");
        if (value.action === "flash" && !this.#devices(binding).some(device => device.token === value.deviceToken)) {
            throw new PreviewFlashError("DEVICE_CHANGED", "Discover devices and explicitly choose one for this preview.");
        }
        const requestId = `preview:${binding.generation}:${value.requestId}`;
        const operation = this.service.execute(value.action === "discover"
            ? { command: "list_devices", requestId }
            : { command: "flash", requestId, deviceToken: value.deviceToken,
                romPath: binding.romPath, expectedSha256: binding.romSha256,
                expectedSizeBytes: binding.romSizeBytes, confirm: true }, binding.projectRoot);
        const request = { input: fingerprint, requestId: value.requestId,
            operationId: String(operation.operationId), binding };
        this.#requests.set(value.requestId, request);
        this.#latest = request;
        this.#discovery = value.action === "discover" ? request : undefined;
        this.#discoveryResult = undefined;
        return this.#status(binding, value.requestId);
    }
}
//# sourceMappingURL=web-preview-flash.js.map