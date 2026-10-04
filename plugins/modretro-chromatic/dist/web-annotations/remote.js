/// <reference lib="dom" />
import { parseRecordingReply } from "./recording-protocol.js";
import { parseInputCommand, parseInputReceipt } from "./input-protocol.js";
import { MAX_SAVE_STATE_FILE_BYTES } from "./save-state.js";
const POLL_MS = 750;
const RETRY_MS = 3_000;
const SNAPSHOT_MS = 5_000;
const MAX_REPLY_BYTES = MAX_SAVE_STATE_FILE_BYTES + 16 * 1024;
const COMMAND_ID = /^(?:[a-f0-9]{16,64}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/i;
function stateText(value) {
    if (typeof value !== "string" || !value.length)
        throw new Error("The saved state is missing.");
    if (value.length > MAX_SAVE_STATE_FILE_BYTES || new TextEncoder().encode(value).length > MAX_SAVE_STATE_FILE_BYTES) {
        throw new Error("The saved state exceeds the supported size.");
    }
    return value;
}
async function readReply(response) {
    if ((!response.ok && response.status !== 409) || !response.body)
        throw new Error("Player control is unavailable.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > MAX_REPLY_BYTES)
                throw new Error("The player-control response is too large.");
            text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
    }
    finally {
        await reader.cancel().catch(() => { });
        reader.releaseLock();
    }
    const reply = JSON.parse(text);
    if (!reply || typeof reply !== "object" || Array.isArray(reply))
        throw new Error("Invalid player-control response.");
    if (!response.ok) {
        // An expired view can explicitly discard an obsolete acknowledgment.
        // Retain the cached result for deduplication and any unacknowledged snapshot.
        if (reply.discardResult === true)
            return { discardResult: true };
        throw new Error("Player control is unavailable.");
    }
    const command = reply.command;
    if (command !== undefined && command !== null) {
        if (typeof command !== "object" || Array.isArray(command))
            throw new Error("Invalid player-control command.");
        const item = command;
        if (typeof item.id !== "string" || !COMMAND_ID.test(item.id))
            throw new Error("Invalid player-control command ID.");
    }
    const fields = reply;
    if (fields.inputCommand !== undefined)
        fields.inputCommand = parseInputCommand(fields.inputCommand);
    if (fields.inputLease !== undefined && (!fields.inputLease || typeof fields.inputLease.id !== "string" ||
        !COMMAND_ID.test(fields.inputLease.id) || !Number.isSafeInteger(fields.inputLease.leaseUntil) || Object.keys(fields.inputLease).length !== 2))
        throw new Error("Invalid input lease.");
    if (fields.cancelInput !== undefined && (typeof fields.cancelInput !== "string" || !COMMAND_ID.test(fields.cancelInput)))
        throw new Error("Invalid input cancellation.");
    if (fields.recording !== undefined)
        fields.recording = parseRecordingReply(fields.recording);
    if (fields.recording?.retired && Object.keys(fields).some(key => key !== "recording"))
        throw new Error("Retirement acknowledgment included unexpected work.");
    return {
        recording: fields.recording,
        command: fields.command, initialState: fields.initialState,
        snapshotSaved: fields.snapshotSaved, snapshotError: fields.snapshotError,
        snapshotDeferred: fields.snapshotDeferred, inputCommand: fields.inputCommand,
        inputLease: fields.inputLease, cancelInput: fields.cancelInput,
    };
}
/** Poll the private preview route; the official player owns every state change. */
export function connectPlayerControl(options) {
    const { context, player, controls, current } = options;
    if (context.playerPath !== "codex-player-control" || !current())
        return () => { };
    const viewId = crypto.randomUUID();
    controls.bindRecordingView?.(viewId);
    let freshStart = false;
    try {
        const key = `codex-preview-fresh:${context.romSha256}:${context.sourceRevision}`;
        freshStart = sessionStorage.getItem(key) === "1";
        if (freshStart)
            sessionStorage.removeItem(key);
    }
    catch { /* Storage may be unavailable; retain normal progress recovery. */ }
    let disposed = false;
    let initialized = false;
    let automatic = true;
    let nextSnapshotAt = 0;
    let acknowledgedTicks;
    let timer;
    let controller;
    let lastResult;
    let resultCaptureTicks;
    let pendingResult;
    let pendingSnapshot;
    let shownError;
    let inputCommand;
    let inputResult;
    let lastInputResult;
    let inputPromise;
    let cancelledInputId;
    let polling = false;
    let retirement;
    controls.beforeRestart?.(() => {
        if (retirement)
            return retirement.promise;
        if (disposed || !current() || !initialized || polling || !controls.beginRecordingRetirement || inputCommand || inputResult || inputPromise || pendingResult || pendingSnapshot) {
            return Promise.reject(new Error("Wait for the original preview action to finish before restarting."));
        }
        const id = controls.beginRecordingRetirement();
        let resolve, reject;
        const promise = new Promise((done, failed) => { resolve = done; reject = failed; });
        retirement = { id, promise, resolve, reject,
            timer: setTimeout(() => {
                if (retirement?.id === id)
                    retirement.expired = true;
                reject(new Error("Preview restart acknowledgment is unknown. Keep this view open; no restart was performed."));
            }, 10_000) };
        return promise;
    });
    function failedInput(command) {
        return { id: command.id, generation: command.generation, outcome: "interrupted", reason: "release_failed",
            applied: true, requestedDurationMs: command.durationMs, observedHoldMs: 0,
            startFrame: Math.floor(player.ticks / 70_224), endFrame: Math.floor(player.ticks / 70_224), mcpButtonsReleased: false };
    }
    function cancelCurrentInput(reason) {
        const command = inputCommand;
        if (!command || cancelledInputId === command.id)
            return;
        // Retried transport cancellations concern one command, not new lifecycle
        // transitions. The UI still invalidates each actual human/lifecycle event.
        cancelledInputId = command.id;
        try {
            controls.cancelInput(reason);
        }
        catch {
            lastInputResult = inputResult = failedInput(command);
        }
    }
    function showError(message) {
        const bounded = message.slice(0, 300);
        if (!disposed && current() && bounded !== shownError) {
            shownError = bounded;
            controls.show(bounded);
        }
    }
    const recordingActive = () => { const r = controls.recordingState?.(); return !!r && (r.owner !== null || !!r.closeEpoch || !!r.retireId); };
    async function captureBackground() {
        if (!initialized || !automatic || recordingActive() || inputCommand || inputResult || pendingResult || pendingSnapshot ||
            Date.now() < nextSnapshotAt || player.ticks === acknowledgedTicks)
            return;
        const ticks = player.ticks;
        nextSnapshotAt = Date.now() + SNAPSHOT_MS;
        try {
            const state = stateText(await controls.captureBackgroundState());
            if (!disposed && current())
                pendingSnapshot = { state, ticks };
        }
        catch (error) {
            showError(error instanceof Error ? `Automatic save failed: ${error.message}` : "Automatic save failed.");
        }
    }
    function dispose() {
        if (retirement) {
            clearTimeout(retirement.timer);
            retirement.reject(new Error("Preview closed before its restart acknowledgment."));
        }
        disposed = true;
        if (timer !== undefined)
            clearTimeout(timer);
        timer = undefined;
        controller?.abort();
        controller = undefined;
        controls.cancelInput?.("closed");
    }
    async function poll() {
        timer = undefined;
        if (disposed || !current()) {
            dispose();
            return;
        }
        polling = true;
        let delay = POLL_MS;
        let timeout;
        try {
            await captureBackground();
            if (disposed || !current()) {
                dispose();
                return;
            }
            const sentResult = pendingResult;
            const sentInput = inputResult;
            const sentSnapshot = sentResult || inputCommand || sentInput || recordingActive() ? undefined : pendingSnapshot;
            const readiness = controls.inputReadiness?.();
            controller = new AbortController();
            if (recordingActive() && !inputCommand && !sentInput)
                timeout = setTimeout(() => controller?.abort(), 1000);
            if (inputCommand || sentInput)
                timeout = setTimeout(() => { cancelCurrentInput("connection_lost"); controller?.abort(); }, 300);
            const response = await fetch("./codex-player-control", {
                method: "POST", mode: "same-origin", credentials: "same-origin", redirect: "error", cache: "no-store",
                headers: { "Content-Type": "application/json", "X-Codex-Preview-State": "1" },
                body: JSON.stringify({
                    viewId, romSha256: context.romSha256, runtimeSha256: context.runtimeSha256, sourceRevision: context.sourceRevision,
                    frame: Math.floor(player.ticks / 70_224), paused: player.isPaused,
                    ...(!initialized ? { initialize: true, freshStart } : {}),
                    ...(sentResult ? { result: sentResult } : sentSnapshot ? { snapshot: sentSnapshot.state } : {}),
                    ...(controls.recordingState ? { recordingStatus: controls.recordingState() } : {}),
                    ...(readiness ? { inputStatus: initialized ? readiness : { ...readiness, ready: false, reason: "initializing" } } : {}),
                    ...(sentInput ? { inputResult: sentInput } : inputCommand ? { inputActive: inputCommand.id } : {}),
                }),
                signal: controller.signal,
            });
            const reply = await readReply(response);
            if (disposed || !current()) {
                dispose();
                return;
            }
            if (reply.recording?.retired) {
                if (!retirement || reply.recording.retired !== retirement.id)
                    throw new Error("Unexpected retirement acknowledgment.");
                clearTimeout(retirement.timer);
                if (retirement.expired)
                    showError("Restart was not performed. Its late acknowledgment confirms this view has retired. Reopen the preview to continue.");
                retirement.resolve();
                retirement = undefined;
                dispose();
                return;
            }
            if (reply.recording)
                controls.recordingReply?.(reply.recording);
            if (reply.discardResult) {
                pendingResult = undefined;
                return;
            }
            if (sentInput) {
                inputResult = undefined;
                inputCommand = undefined;
            }
            if (reply.cancelInput !== undefined) {
                if (typeof reply.cancelInput !== "string" || !COMMAND_ID.test(reply.cancelInput))
                    throw new Error("Invalid input cancellation.");
                if (inputCommand?.id === reply.cancelInput)
                    cancelCurrentInput("cancelled");
            }
            if (reply.inputLease !== undefined) {
                const lease = reply.inputLease;
                if (!lease || typeof lease.id !== "string" || !COMMAND_ID.test(lease.id) || !Number.isSafeInteger(lease.leaseUntil))
                    throw new Error("Invalid input lease.");
                if (inputCommand?.id === lease.id)
                    controls.renewInput(lease.id, lease.leaseUntil);
            }
            if (reply.inputCommand !== undefined) {
                if (!initialized)
                    throw new Error("Input cannot start before browser initialization.");
                const command = parseInputCommand(reply.inputCommand);
                if (lastInputResult?.id === command.id)
                    inputResult = lastInputResult;
                else if (inputCommand || inputPromise)
                    throw new Error("A browser input command is already active.");
                else {
                    inputCommand = command;
                    inputPromise = controls.holdInput(command).then(receipt => {
                        lastInputResult = inputResult = parseInputReceipt(receipt);
                    }).catch(() => {
                        cancelCurrentInput("unavailable");
                        lastInputResult = inputResult = failedInput(command);
                    }).finally(() => { inputPromise = undefined; });
                }
            }
            if (!initialized && reply.initialState !== null && typeof reply.initialState !== "string") {
                throw new Error("The initial saved progress is unavailable.");
            }
            if (sentSnapshot && reply.snapshotDeferred !== true) {
                const saved = reply.snapshotSaved === true;
                const failed = typeof reply.snapshotError === "string";
                if (saved === failed)
                    throw new Error("The automatic save was not acknowledged.");
                if (saved)
                    acknowledgedTicks = sentSnapshot.ticks;
                else
                    showError(reply.snapshotError || "Automatic save failed.");
                pendingSnapshot = undefined;
            }
            if (sentResult?.ok && "state" in sentResult)
                acknowledgedTicks = resultCaptureTicks;
            pendingResult = undefined;
            if (!initialized) {
                initialized = true;
                nextSnapshotAt = Date.now() + (freshStart ? 0 : SNAPSHOT_MS);
                if (!freshStart && reply.initialState !== null) {
                    try {
                        await controls.restoreState(stateText(reply.initialState));
                        acknowledgedTicks = player.ticks;
                    }
                    catch {
                        automatic = false;
                        showError("Saved progress could not be reopened. Automatic saving is paused to preserve history.");
                    }
                    if (disposed || !current()) {
                        dispose();
                        return;
                    }
                }
            }
            const command = reply.command;
            if (!command)
                return;
            if (command.id === lastResult?.id) {
                pendingResult = lastResult;
                return;
            }
            resultCaptureTicks = undefined;
            try {
                if (command.action === "capture") {
                    lastResult = { id: command.id, ok: true, state: stateText(await controls.captureState()) };
                    resultCaptureTicks = player.ticks;
                }
                else if (command.action === "restore") {
                    const frame = await controls.restoreState(stateText(command.state));
                    if (!Number.isSafeInteger(frame) || frame < 0)
                        throw new Error("The restored frame is invalid.");
                    lastResult = { id: command.id, ok: true, frame };
                }
                else
                    throw new Error("Invalid player-control action.");
            }
            catch (error) {
                lastResult = {
                    id: command.id, ok: false,
                    error: (error instanceof Error ? error.message : "The player-control action failed.").slice(0, 512),
                };
            }
            pendingResult = lastResult;
        }
        catch {
            // Keep results for recovery, but never keep held input across a failed lease.
            if (inputCommand)
                cancelCurrentInput("connection_lost");
            delay = RETRY_MS;
        }
        finally {
            polling = false;
            if (timeout !== undefined)
                clearTimeout(timeout);
            if (recordingActive())
                delay = 250;
            if (inputCommand || inputResult)
                delay = 100;
            controller = undefined;
            if (disposed || !current())
                dispose();
            else
                timer = setTimeout(() => { void poll(); }, delay);
        }
    }
    void poll();
    return dispose;
}
//# sourceMappingURL=remote.js.map