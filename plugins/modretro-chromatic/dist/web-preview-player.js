import { createHash, randomUUID } from "node:crypto";
import { PreviewRecordingBroker } from "./web-preview-recording.js";
import { parseRecordingState } from "./web-annotations/recording-protocol.js";
import { PreviewInputBroker } from "./web-preview-input.js";
import { parseInputReadiness } from "./web-annotations/input-protocol.js";
import { MAX_SAVE_STATE_FILE_BYTES } from "./web-annotations/save-state.js";
const VIEW_TTL_MS = 5_000;
const MAX_TIMEOUT_MS = 15_000;
const MAX_VIEWS = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
export class PreviewPlayerControlError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "PreviewPlayerControlError";
    }
}
function fail(code, message) { throw new PreviewPlayerControlError(code, message); }
function record(value, required, optional, code) {
    if (!value || typeof value !== "object" || Array.isArray(value)
        || required.some(key => !Object.hasOwn(value, key))
        || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key)))
        fail(code, "Invalid browser control fields.");
    return value;
}
function uuid(value, code) {
    if (typeof value !== "string" || !UUID.test(value))
        fail(code, "A browser view or command ID must be a UUID.");
    return value.toLowerCase();
}
function frame(value) { return Number.isSafeInteger(value) && value >= 0; }
function state(value, code) {
    if (typeof value !== "string" || !value.length || value.length > MAX_SAVE_STATE_FILE_BYTES
        || Buffer.byteLength(value, "utf8") > MAX_SAVE_STATE_FILE_BYTES)
        fail(code, "Save-state text is missing or exceeds the supported size.");
    return value;
}
function build(value, code) {
    if (typeof value.romSha256 !== "string" || !SHA256.test(value.romSha256)
        || typeof value.runtimeSha256 !== "string" || !SHA256.test(value.runtimeSha256)
        || typeof value.sourceRevision !== "string" || !value.sourceRevision.trim() || value.sourceRevision.length > 1024) {
        fail(code, "Browser control requires exact ROM and runtime SHA-256 hashes and a source revision.");
    }
    return { romSha256: value.romSha256, runtimeSha256: value.runtimeSha256, sourceRevision: value.sourceRevision };
}
function pollPayload(value) {
    const item = record(value, ["viewId", "romSha256", "runtimeSha256", "sourceRevision", "frame", "paused"], ["result"], "INVALID_PAYLOAD");
    const identity = build(item, "INVALID_PAYLOAD");
    if (!frame(item.frame) || typeof item.paused !== "boolean")
        fail("INVALID_PAYLOAD", "Invalid browser frame or paused status.");
    const poll = { ...identity, viewId: uuid(item.viewId, "INVALID_PAYLOAD"), frame: item.frame, paused: item.paused };
    if (item.result !== undefined) {
        const result = record(item.result, ["id", "ok"], ["state", "frame", "error"], "INVALID_PAYLOAD");
        if (typeof result.ok !== "boolean" || (result.frame !== undefined && !frame(result.frame)))
            fail("INVALID_PAYLOAD", "Invalid browser command result.");
        const parsed = { id: uuid(result.id, "INVALID_PAYLOAD"), ok: result.ok };
        if (result.state !== undefined)
            parsed.state = state(result.state, "INVALID_PAYLOAD");
        if (result.frame !== undefined)
            parsed.frame = result.frame;
        if (result.ok) {
            if (result.error !== undefined)
                fail("INVALID_PAYLOAD", "A successful browser result cannot contain an error.");
        }
        else {
            if (typeof result.error !== "string" || !result.error.trim() || result.error.length > 1024
                || Buffer.byteLength(result.error, "utf8") > 1024 || result.state !== undefined || result.frame !== undefined) {
                fail("INVALID_PAYLOAD", "A failed browser result requires a bounded error and no state or frame.");
            }
            parsed.error = result.error;
        }
        poll.result = parsed;
    }
    return poll;
}
/** One-shot commands for explicitly selected, recently polling browser views. */
export class PreviewPlayerControl {
    identity;
    views = new Map();
    closed = false;
    input = new PreviewInputBroker();
    recording;
    constructor(identity, projectRoot, cartridgeType = 0) {
        if (projectRoot)
            this.recording = new PreviewRecordingBroker(projectRoot, undefined, cartridgeType);
        this.identity = build(record(identity, ["romSha256", "runtimeSha256", "sourceRevision"], [], "INVALID_IDENTITY"), "INVALID_IDENTITY");
    }
    status() {
        const now = Date.now();
        this.prune(now);
        return [...this.views.values()].filter(view => now - view.lastSeen < VIEW_TTL_MS)
            .map(({ id, frame, paused, lastSeen, input }) => ({ id, frame, paused, lastSeen, ...(input ? { input: { ...input } } : {}), ...(this.recording?.view(id) ? { recording: this.recording.view(id) } : {}) }));
    }
    poll(payload) {
        this.assertOpen();
        if (!payload || typeof payload !== "object" || Array.isArray(payload))
            fail("INVALID_PAYLOAD", "Invalid browser poll.");
        const { inputStatus, inputActive, inputResult, recordingStatus, ...statePoll } = payload;
        const readiness = inputStatus === undefined ? undefined : parseInputReadiness(inputStatus);
        const poll = pollPayload(statePoll);
        if (poll.romSha256 !== this.identity.romSha256 || poll.runtimeSha256 !== this.identity.runtimeSha256
            || poll.sourceRevision !== this.identity.sourceRevision) {
            fail("WRONG_BUILD", "This browser view belongs to a different ROM, emulator runtime, or source revision. Reload the preview.");
        }
        const now = Date.now();
        this.prune(now);
        const recording = recordingStatus === undefined ? undefined : parseRecordingState(recordingStatus);
        if (recording?.retireId || this.recording?.isRetired(poll.viewId)) {
            // This branch is synchronous and precedes any input/state dispatch or
            // view registration. Retirement cannot swallow a racing command.
            if (!this.recording || this.input.blocking || this.views.get(poll.viewId)?.pending || poll.result || inputActive !== undefined || inputResult !== undefined)
                fail("BUSY", "Finish the original browser command before retiring its view.");
            if (!recording?.retireId)
                fail("STALE_VIEW", "This browser view has retired.");
            const reply = this.recording.poll(poll.viewId, recording);
            if (reply?.retired)
                this.views.delete(poll.viewId);
            return { recording: reply };
        }
        let view = this.views.get(poll.viewId);
        let repeated = false;
        let resultDigest;
        if (poll.result) {
            resultDigest = createHash("sha256").update(JSON.stringify(poll.result)).digest("hex");
            repeated = view?.completed?.id === poll.result.id && view.completed.digest === resultDigest;
            const pending = view?.pending;
            if (!repeated && (!pending || !pending.delivered || pending.command.id !== poll.result.id)) {
                fail("RESULT_MISMATCH", "This result does not match a delivered command for this browser view.");
            }
            if (!repeated && poll.result.ok && ((pending.command.action === "capture" && poll.result.state === undefined)
                || (pending.command.action === "restore" && (poll.result.state !== undefined || poll.result.frame === undefined)))) {
                fail("INVALID_PAYLOAD", "The browser result does not match the requested save-state action.");
            }
        }
        if (!view) {
            if (this.views.size >= MAX_VIEWS)
                fail("VIEW_LIMIT", "At most eight browser preview views can connect. Close an unused preview and wait for it to expire or finish its pending request.");
            view = { id: poll.viewId, frame: poll.frame, paused: poll.paused, lastSeen: now };
            this.views.set(view.id, view);
        }
        view.frame = poll.frame;
        view.paused = poll.paused;
        view.lastSeen = now;
        view.input = readiness;
        const inputReply = { ...this.input.poll(view.id, readiness, inputActive, inputResult),
            ...(this.recording ? { recording: this.recording.poll(view.id, recordingStatus) } : {}) };
        if (poll.result && !repeated) {
            const pending = this.finish(view);
            // A lost reply may be retried after the view stops being live. Keep only its
            // digest for one command-timeout window; retries must not extend that window.
            view.completed = { id: poll.result.id, digest: resultDigest, expiresAt: now + MAX_TIMEOUT_MS };
            if (poll.result.ok) {
                const result = {};
                if (poll.result.state !== undefined)
                    result.state = poll.result.state;
                if (poll.result.frame !== undefined)
                    result.frame = poll.result.frame;
                pending.resolve(result);
            }
            else
                pending.reject(new PreviewPlayerControlError("BROWSER_ERROR", `Browser save-state request failed: ${poll.result.error}`));
        }
        if (!view.pending || view.pending.delivered)
            return inputReply;
        view.pending.delivered = true;
        return { ...inputReply, command: { ...view.pending.command } };
    }
    async request(action, options = {}, timeoutMs = MAX_TIMEOUT_MS) {
        this.assertOpen();
        if (this.input.blocking || this.recording?.busy)
            fail("BUSY", "Browser input or recording is pending or unresolved.");
        const args = record(options, [], ["viewId", "state"], "INVALID_REQUEST");
        if (!["capture", "restore"].includes(action))
            fail("INVALID_REQUEST", "Unsupported browser control action.");
        if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS)
            fail("INVALID_REQUEST", "Browser command timeout must be between 1 and 15000 milliseconds.");
        const viewId = args.viewId === undefined ? undefined : uuid(args.viewId, "INVALID_REQUEST");
        const savedState = action === "restore" ? state(args.state, "INVALID_REQUEST") : undefined;
        if (action !== "restore" && args.state !== undefined)
            fail("INVALID_REQUEST", "Only restore accepts a saved state.");
        const fresh = this.status();
        if (!fresh.length)
            fail("NO_VIEW", "Open the browser preview first, then try this save-state action again.");
        if (!viewId && fresh.length > 1)
            fail("AMBIGUOUS_VIEW", "Multiple browser previews are open. Choose a viewId from status.");
        const selected = viewId ?? fresh[0].id;
        if (!fresh.some(view => view.id === selected))
            fail("STALE_VIEW", "The selected browser view is no longer active. Open it and request status again.");
        const view = this.views.get(selected);
        if (view.pending)
            fail("BUSY", "This browser view already has a save-state request in progress.");
        const command = { id: randomUUID(), action };
        if (savedState !== undefined)
            command.state = savedState;
        return new Promise((resolve, reject) => {
            const pending = {
                command, delivered: false, deadline: Date.now() + timeoutMs, resolve, reject,
                timer: setTimeout(() => {
                    this.timeout(view, pending);
                    this.prune(Date.now());
                }, timeoutMs),
            };
            view.pending = pending;
        });
    }
    requestInput(viewId, generation, buttons, durationMs, signal) {
        this.assertOpen();
        const selected = uuid(viewId, "INVALID_REQUEST");
        const view = this.status().find(item => item.id === selected);
        if (!view || view.paused)
            fail("STALE_VIEW", "Choose a current running browser view from status.");
        if ([...this.views.values()].some(item => item.pending))
            fail("BUSY", "A browser state command is in progress.");
        return this.input.request(selected, view.input, generation, buttons, durationMs, signal);
    }
    identityForInput() { return { ...this.identity }; }
    close() {
        if (this.closed)
            return;
        if (this.input.blocking)
            fail("BUSY", "Input release must be confirmed before closing its browser owner.");
        this.closed = true;
        this.recording?.dispose();
        for (const view of this.views.values())
            this.finish(view)?.reject(new PreviewPlayerControlError("CLOSED", "The browser preview closed before the save-state request completed."));
        this.views.clear();
    }
    assertOpen() { if (this.closed)
        fail("CLOSED", "The browser preview is closed."); }
    prune(now) {
        for (const [id, view] of this.views) {
            if (view.pending && now >= view.pending.deadline)
                this.timeout(view, view.pending);
            if (view.completed && now >= view.completed.expiresAt)
                view.completed = undefined;
            if (!view.pending && !view.completed && now - view.lastSeen >= VIEW_TTL_MS)
                this.views.delete(id);
        }
    }
    timeout(view, pending) {
        if (view.pending !== pending)
            return;
        this.finish(view);
        pending.reject(new PreviewPlayerControlError("TIMEOUT", pending.delivered
            ? "The browser command timed out after delivery. Its outcome is UNKNOWN; inspect the preview before retrying. The command will not be replayed."
            : "The browser did not pick up the command before it timed out. Open the preview and try again."));
    }
    finish(view) {
        const pending = view.pending;
        if (pending) {
            clearTimeout(pending.timer);
            view.pending = undefined;
        }
        return pending;
    }
}
//# sourceMappingURL=web-preview-player.js.map