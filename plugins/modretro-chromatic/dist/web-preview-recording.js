import { randomUUID } from "node:crypto";
import { RecordingJournal } from "./web-preview-recording-journal.js";
import { parseRecordingState, recordingDuration, recordingId, savedRecordingKey, RECORDING_DRAIN_MS } from "./web-annotations/recording-protocol.js";
const errorText = (error) => (error instanceof Error ? error.message : String(error)).slice(0, 512);
/** One async recording, with independent durable ownership and fresh close acknowledgments. */
export class PreviewRecordingBroker {
    now;
    cartridgeType;
    mono;
    views = new Map();
    retired = new Map();
    journal;
    job;
    admission = true;
    pending = Promise.resolve();
    timer;
    closeState;
    cancelledEpoch;
    reserving = false;
    completion;
    completed = false;
    journalFailed = false;
    startDeadline = 0;
    stopDeadline = 0;
    finalizationDeadline;
    constructor(projectRoot, now = () => Date.now(), cartridgeType = 0, mono = () => performance.now()) {
        this.now = now;
        this.cartridgeType = cartridgeType;
        this.mono = mono;
        this.journal = new RecordingJournal(projectRoot);
    }
    get busy() { return this.reserving || !!this.job && (!this.completed || this.job.phase === "unknown"); }
    get remainingDrainMs() { return Math.max(0, (this.closeState?.deadline ?? this.mono() + RECORDING_DRAIN_MS) - this.mono()); }
    get closeUncertain() { return !!this.closeState && !this.closeState.human; }
    async unresolved() {
        if (this.job)
            return this.state();
        const entries = await this.journal.entries();
        const entry = entries.find(e => e.phase !== "finished" && e.phase !== "failed");
        if (entry)
            return { ...entry, phase: "unknown" };
        const active = await this.journal.activeId();
        return active ? { id: active, phase: "unknown", error: "Recording reservation is incomplete; preserve the original journal." } : undefined;
    }
    get active() { return this.busy || !!this.closeState; }
    state() {
        this.tick();
        const result = this.job ? structuredClone(this.job) : undefined;
        if (result && !this.completed && (result.phase === "finished" || result.phase === "failed"))
            result.phase = "stopping";
        return result;
    }
    async status(id) {
        recordingId(id);
        if (this.job?.id === id)
            return this.state();
        return this.read(id);
    }
    view(id) { const s = this.views.get(id)?.status; return s ? structuredClone(s) : undefined; }
    isRetired(id) { return this.retired.has(id); }
    persist() {
        const job = this.job;
        if (!job)
            return Promise.resolve();
        const snapshot = structuredClone(job);
        const task = this.pending.then(async () => {
            // An earlier queued write may have failed after this snapshot was made.
            // Once uncertain, no later terminal snapshot is allowed to release ownership.
            if (this.journalFailed || job.phase === "unknown") {
                snapshot.phase = "unknown";
                snapshot.error = job.error;
            }
            await this.journal.write(job.id, snapshot);
            if (this.journalFailed)
                throw new Error("Earlier recording journal commit remains UNKNOWN.");
        });
        this.pending = task.catch(error => { this.journalFailed = true; job.phase = "unknown"; job.error = `Journal commit unconfirmed: ${errorText(error)}`; });
        return task;
    }
    arm() { this.timer ??= setInterval(() => this.tick(), 100); this.timer.unref?.(); }
    tick() {
        const j = this.job;
        if (!j || j.phase === "finished" || j.phase === "failed")
            return;
        const now = this.mono();
        if ((j.phase === "queued" || j.phase === "starting") && now >= this.startDeadline) {
            if (!j.delivered) {
                j.phase = "failed";
                j.stopped = true;
                j.released = true;
                j.error = "Recording expired before delivery; no recorder was started.";
                void this.completeWithoutCapture();
            }
            else
                this.stop(j.id);
        }
        if (j.delivered && ["starting", "recording"].includes(j.phase) && now - (this.views.get(j.binding.viewId)?.lastSeen ?? 0) >= 2500)
            this.stop(j.id);
        if (now >= this.stopDeadline && !j.finalizationDeadline)
            this.stop(j.id);
        if (this.finalizationDeadline !== undefined && now >= this.finalizationDeadline && j.phase !== "unknown") {
            j.phase = "unknown";
            j.error = "Recording finalization was not acknowledged within 30 seconds. Preserve the original browser and capture.";
            void this.persist().catch(() => { });
        }
    }
    async start(binding, duration) {
        if (!this.admission || this.busy)
            throw new Error("A recording or close operation is already pending or UNKNOWN.");
        const v = this.views.get(binding.viewId);
        if (!v || this.mono() - v.lastSeen > 2500 || !v.status.available || !v.status.visible || v.status.pending || v.status.phase !== "idle" ||
            v.status.generation !== binding.recordingGeneration || v.status.owner !== null)
            throw new Error("Choose a current visible idle recording view from status.");
        if ([...this.views.values()].some(view => view.status.owner === "human" || view.status.pending || view.status.phase === "unknown"))
            throw new Error("A person is recording or saving in another preview. Finish that capture first.");
        const durationMs = recordingDuration(duration), now = this.now();
        const job = { version: 1, id: randomUUID(), cartridgeType: this.cartridgeType, binding: { ...binding }, phase: "queued", durationMs, admittedAt: now, startBy: now + 5000, stopBy: now + 5000 + durationMs,
            delivered: false, uploadAttempted: false, stopped: false, released: false, browserAcknowledgedSave: false };
        this.reserving = true;
        try {
            await this.journal.reserve(job.id, job);
            this.job = job;
            this.completion = undefined;
            this.completed = false;
            this.journalFailed = false;
            this.startDeadline = this.mono() + 5000;
            this.stopDeadline = this.startDeadline + durationMs;
            this.finalizationDeadline = undefined;
            this.arm();
            if (!this.admission)
                this.stop(job.id);
            return structuredClone(job);
        }
        finally {
            this.reserving = false;
        }
    }
    async read(id) {
        recordingId(id);
        if (this.job?.id === id) {
            this.tick();
            await this.pending;
            await this.completion;
            return structuredClone(this.job);
        }
        const old = await this.journal.read(id);
        // Restart never turns an unacknowledged job into success, even if a media file exists.
        if (old.phase !== "finished" && old.phase !== "failed") {
            old.phase = "unknown";
            old.error = "The original recording owner is unavailable. Preserve its original receipt; new conflicting recordings are blocked.";
        }
        return old;
    }
    stop(id) {
        if (!this.job || this.job.id !== recordingId(id))
            throw new Error("This recording belongs to another or unavailable owner; read its original status.");
        const j = this.job;
        if (j.phase === "queued" && !j.delivered) {
            j.phase = "failed";
            j.stopped = true;
            j.released = true;
            j.error = "Stopped before delivery; no recorder was started.";
            void this.completeWithoutCapture();
            return structuredClone(j);
        }
        if (j.phase !== "finished" && j.phase !== "failed" && !j.finalizationDeadline) {
            j.finalizationDeadline = this.now() + RECORDING_DRAIN_MS;
            this.finalizationDeadline = this.mono() + RECORDING_DRAIN_MS;
            if (j.phase !== "unknown")
                j.phase = "stopping";
            void this.persist().catch(() => { });
        }
        return structuredClone(j);
    }
    poll(viewId, value) {
        if (value === undefined)
            return undefined;
        const status = parseRecordingState(value), now = this.mono();
        const retired = this.retired.get(viewId);
        const idle = status.owner === null && status.phase === "idle" && !status.pending && !status.recordingId && !status.closeEpoch;
        if (retired) {
            if (status.retireId === retired && idle)
                return { retired };
            throw new Error("This recording view has retired; stale activity is not accepted.");
        }
        if (status.retireId && this.cancelledEpoch && status.closeEpoch === this.cancelledEpoch)
            return { cancelClose: this.cancelledEpoch };
        if (status.retireId && !this.closeState) {
            const previous = this.views.get(viewId);
            if (!previous || status.generation !== previous.generation || !idle || this.reserving || this.job?.binding.viewId === viewId && this.busy)
                throw new Error("Recording retirement requires a known idle view with no pending owner.");
            if (this.retired.size >= 256)
                throw new Error("Recording view retirement limit reached. Close this preview before opening another.");
            this.retired.set(viewId, status.retireId);
            this.views.delete(viewId);
            return { retired: status.retireId };
        }
        if (!this.views.has(viewId) && this.views.size >= 8)
            throw new Error("This recording listener has reached its eight-view limit.");
        const v = this.views.get(viewId) ?? { status, lastSeen: now, generation: status.generation };
        if (status.generation >= v.generation) {
            v.status = status;
            v.generation = status.generation;
        }
        v.lastSeen = now;
        this.views.set(viewId, v);
        const reply = {};
        this.tick();
        const close = this.closeState;
        if (close) {
            reply.close = close.id;
            if (close.terminal)
                reply.terminalClose = true;
            if (status.closeEpoch === close.id && status.generation >= v.generation) {
                v.ack = close.id;
                if (status.owner === "human" && (status.pending || status.phase !== "idle"))
                    close.human = true;
            }
        }
        else if (this.cancelledEpoch)
            reply.cancelClose = this.cancelledEpoch;
        const j = this.job;
        if (j && j.binding.viewId === viewId) {
            if (!j.delivered && j.phase === "queued" && !close) {
                j.delivered = true;
                j.phase = "starting";
                void this.persist().catch(() => { });
                reply.start = { id: j.id, generation: j.binding.recordingGeneration, durationMs: j.durationMs, startBy: j.startBy, stopBy: j.stopBy };
            }
            if (status.recordingId === j.id) {
                if (status.owner === "mcp" && status.generation === j.binding.recordingGeneration) {
                    const previous = JSON.stringify([j.diagnostics, j.audioIncluded, j.audioUnavailableReason]);
                    if (status.diagnostics)
                        j.diagnostics = status.diagnostics;
                    if (status.audioIncluded !== undefined) {
                        j.audioIncluded = status.audioIncluded;
                        j.audioUnavailableReason = status.audioUnavailableReason;
                    }
                    // Late evidence can improve diagnostics, never clear UNKNOWN. Save
                    // it even when no phase transition remains to trigger a journal write.
                    if (previous !== JSON.stringify([j.diagnostics, j.audioIncluded, j.audioUnavailableReason]))
                        void this.persist().catch(() => { });
                }
                if (status.phase === "failed" && status.stopped && status.released && !j.uploadAttempted && j.phase !== "failed" && j.phase !== "finished" && j.phase !== "unknown") {
                    j.phase = "failed";
                    j.stopped = true;
                    j.released = true;
                    j.error = status.error;
                    void this.completeWithoutCapture();
                }
                else if (status.generation !== j.binding.recordingGeneration && j.phase !== "failed" && j.phase !== "finished") {
                    j.phase = "unknown";
                    j.error = "Recording generation changed unexpectedly.";
                    void this.persist().catch(() => { });
                }
                else {
                    if (status.phase === "recording" && j.phase === "starting") {
                        j.phase = "recording";
                        void this.persist().catch(() => { });
                    }
                    if (status.phase === "stopping" || status.phase === "saving" || status.phase === "unknown")
                        this.stop(j.id);
                    j.stopped ||= status.stopped === true;
                    j.released ||= status.released === true;
                    if (j.saved && status.saved && savedRecordingKey(j.saved) === savedRecordingKey(status.saved) && j.stopped && j.released && !j.browserAcknowledgedSave) {
                        j.browserAcknowledgedSave = true;
                        if (j.phase !== "unknown") {
                            j.phase = "finished";
                            void this.completeWithoutCapture();
                        }
                        else
                            void this.persist().catch(() => { });
                    }
                }
            }
            if (j.phase === "starting" || j.phase === "recording")
                reply.lease = j.id;
            if (j.finalizationDeadline && j.phase !== "finished" && j.phase !== "failed")
                reply.stop = j.id;
            if (this.completed && (j.phase === "finished" || j.phase === "failed"))
                reply.settled = j.id;
            if (j.saved && !j.browserAcknowledgedSave)
                reply.saved = { recordingId: j.id, capture: { ...j.saved } };
        }
        return reply;
    }
    completeWithoutCapture() {
        return this.completion ??= this.finish();
    }
    async finish() {
        try {
            await this.persist();
            if (this.journalFailed || this.job?.phase === "unknown")
                throw new Error("Recording journal remains UNKNOWN.");
            await this.journal.release(this.job.id);
            this.completed = true;
        }
        catch (error) {
            if (this.job) {
                this.job.phase = "unknown";
                this.job.error = errorText(error);
            }
        }
        if (!this.busy && this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }
    /** Called before consuming any multipart bytes, including attempts to omit ownership fields. */
    admitUpload(id, viewId, generation) {
        if (typeof viewId === "string" && this.retired.has(viewId))
            throw new Error("A retired recording view cannot upload a capture.");
        const j = this.job;
        if (id === undefined) {
            if (typeof viewId !== "string" || typeof generation !== "string" || !/^(0|[1-9][0-9]*)$/.test(generation))
                throw new Error("Capture upload requires its original view ownership fields.");
            const v = this.views.get(viewId), g = Number(generation);
            if (!v || !Number.isSafeInteger(g) || j?.binding.viewId === viewId && this.busy && j.phase !== "failed" || v.status.owner === "mcp" || v.uploadedGeneration === g || g < v.generation || g > v.generation + 1 ||
                g === v.generation && v.status.owner !== "human" || this.closeState && v.ack === this.closeState.id && g > v.generation)
                throw new Error("Human capture upload ownership is stale, repeated, or blocked by close.");
            v.generation = g;
            v.uploadedGeneration = g;
            return;
        }
        if (!j || j.id !== recordingId(id) || j.binding.viewId !== viewId || String(j.binding.recordingGeneration) !== generation || !j.delivered ||
            j.uploadAttempted || ["finished", "failed", "unknown"].includes(j.phase))
            throw new Error("Recording upload ownership is stale, repeated, or unresolved.");
        j.uploadAttempted = true;
        this.stop(j.id);
        j.phase = "saving";
        void this.persist().catch(() => { });
        return j;
    }
    async published(id, saved, outcome = "complete") {
        const j = this.job;
        if (!j || j.id !== id)
            throw new Error("Recording owner changed during publication.");
        j.saved = { ...saved };
        j.outcome = outcome;
        try {
            await this.persist();
        }
        catch (error) {
            j.phase = "unknown";
            j.error = "Media published but journal commit is unconfirmed. Preserve the original publication; do not upload again.";
            throw error;
        }
    }
    async uploadFailed(id, error) {
        const j = this.job;
        if (!j || j.id !== id)
            return;
        j.phase = "unknown";
        j.error = errorText(error);
        const partial = error?.partial;
        if (partial)
            j.partial = partial;
        await this.persist().catch(() => { });
    }
    markUnknown(message) {
        if (this.job && this.busy) {
            this.job.phase = "unknown";
            this.job.error = message.slice(0, 512);
            void this.persist().catch(() => { });
        }
    }
    async drain(terminal = false) {
        this.admission = false;
        const close = this.closeState ??= { id: randomUUID(), deadline: this.mono() + RECORDING_DRAIN_MS, human: false, terminal };
        close.terminal ||= terminal;
        this.arm();
        if (this.job && this.busy)
            this.stop(this.job.id);
        let expired = false, timer;
        const work = async () => {
            for (;;) {
                this.tick();
                await this.pending;
                await this.completion;
                if (expired)
                    throw new Error("Recording drain expired.");
                if (close.human && !terminal) {
                    this.cancelledEpoch = close.id;
                    this.closeState = undefined;
                    this.admission = true;
                    if (!this.busy && this.timer) {
                        clearInterval(this.timer);
                        this.timer = undefined;
                    }
                    throw new Error("A person is recording or saving in this preview. Finish that capture before closing.");
                }
                const acknowledged = [...this.views.values()].every(v => v.ack === close.id && !v.status.pending && (v.status.phase === "idle" || v.status.owner === "mcp" && (v.status.phase === "finished" || v.status.phase === "failed")));
                if (acknowledged && !this.busy)
                    return;
                if (this.mono() >= close.deadline)
                    throw new Error("Browser recording close acknowledgement is UNKNOWN.");
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        };
        try {
            await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error("Browser recording close acknowledgement is UNKNOWN.")); }, this.remainingDrainMs); })]);
        }
        catch (error) {
            if (this.closeState === close) {
                expired = true;
                this.markUnknown("Browser close or journal finalization is UNKNOWN. Preserve the original capture.");
            }
            throw error;
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    dispose() { if (this.timer)
        clearInterval(this.timer); this.timer = undefined; }
}
//# sourceMappingURL=web-preview-recording.js.map