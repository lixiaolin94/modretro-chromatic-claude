import { parseRecordingReply, RECORDING_DRAIN_MS, RECORDING_LEASE_MS, RECORDING_MAX_MS } from "./recording-protocol.js";
/** Coordinates one existing recorder. The browser remains the only media producer. */
export class RecordingController {
    hooks;
    clock;
    generation = 0;
    managed;
    barrier;
    retirement;
    terminalStopped;
    timer;
    constructor(hooks, clock = { wall: () => Date.now(), mono: () => performance.now() }) {
        this.hooks = hooks;
        this.clock = clock;
    }
    get blocked() { return !!this.barrier || !!this.managed || !!this.retirement; }
    beginRetirement() {
        if (this.blocked || this.hooks.busy())
            throw new Error("Finish the original recording or capture before restarting.");
        this.retirement = crypto.randomUUID();
        this.hooks.changed();
        return this.retirement;
    }
    humanStart() { if (this.blocked)
        return false; this.generation++; return true; }
    captureGeneration() { return this.generation; }
    state() {
        const m = this.managed, busy = this.hooks.busy();
        return { generation: m && !(m.phase === "failed" && busy) ? m.command.generation : this.generation, available: this.hooks.available(), visible: this.hooks.visible(), owner: m && !(m.phase === "failed" && busy) ? "mcp" : busy ? "human" : null,
            phase: m?.phase ?? (busy ? "recording" : "idle"), pending: busy, ...(this.barrier ? { closeEpoch: this.barrier } : {}), ...(this.retirement ? { retireId: this.retirement } : {}),
            ...(m ? { recordingId: m.command.id, stopped: m.stopped, released: m.released, ...(m.saved ? { saved: m.saved } : {}), ...(m.error ? { error: m.error } : {}), ...(m.diagnostics ? { diagnostics: m.diagnostics } : {}) } : {}) };
    }
    apply(value) {
        const r = parseRecordingReply(value);
        // Close admission changes synchronously before any recording action or acknowledgment.
        if (r.close)
            this.barrier = r.close;
        if (r.terminalClose && r.close && this.terminalStopped !== r.close && !this.managed?.ownsRecorder && this.hooks.busy()) {
            this.terminalStopped = r.close;
            try {
                this.hooks.stop();
            }
            catch {
                this.hooks.error?.("Recording stop is UNKNOWN. Keep the original browser copy.");
            }
        }
        if (r.cancelClose === this.barrier)
            this.barrier = undefined;
        if (r.start && this.managed?.command.id !== r.start.id) {
            const c = r.start;
            if (this.managed || this.barrier || this.retirement || this.hooks.busy() || !this.hooks.visible() || !this.hooks.available() || c.generation !== this.generation || this.clock.wall() >= c.startBy || this.clock.wall() >= c.stopBy) {
                // A rejected command has a final no-acquisition receipt without claiming another human operation.
                if (!this.managed)
                    this.managed = { ownsRecorder: false, command: c, phase: "failed", lease: 0, deadline: 0, stopped: true, released: true, error: "Recording start was stale or a human capture won admission." };
            }
            else {
                this.managed = { ownsRecorder: true, command: c, phase: "recording", lease: this.clock.mono() + RECORDING_LEASE_MS,
                    started: this.clock.mono(), deadline: this.clock.mono() + Math.min(c.durationMs, c.stopBy - this.clock.wall(), RECORDING_MAX_MS), stopped: false, released: false };
                try {
                    if (!this.hooks.start() && this.managed.phase !== "failed" && this.managed.phase !== "unknown")
                        this.failed("The recorder did not start.", true);
                }
                catch {
                    this.failed("Recording startup could not be confirmed.", false);
                }
                try {
                    this.timer ??= setInterval(() => this.tick(), 100);
                }
                catch {
                    this.stop("Recording timer unavailable.");
                    this.failed("Recording timing is UNKNOWN.", false);
                }
            }
        }
        const m = this.managed;
        if (m && r.lease === m.command.id && m.phase === "recording")
            m.lease = this.clock.mono() + RECORDING_LEASE_MS;
        if (m && r.stop === m.command.id)
            this.stop("Stopped by the caller.");
        if (m && !m.saved && r.saved?.recordingId === m.command.id && m.stopped && m.released) {
            if (this.hooks.acceptSaved(r.saved.capture)) {
                m.saved = r.saved.capture;
                if (m.phase !== "unknown")
                    m.phase = "finished";
            }
        }
        if (m && r.settled === m.command.id && !this.hooks.busy() && (m.phase === "finished" || m.phase === "failed")) {
            this.managed = undefined;
            this.generation++;
            if (this.timer)
                clearInterval(this.timer);
            this.timer = undefined;
        }
        this.hooks.changed();
    }
    tick() {
        const m = this.managed;
        if (!m)
            return;
        try {
            const now = this.clock.mono();
            const visible = this.hooks.visible();
            if (m.phase === "recording" && (now >= m.deadline || now >= m.lease || !visible))
                this.stop(visible && now >= m.deadline && m.deadline <= m.lease ? "Duration reached." : "The recording view lost its live connection or visibility.");
            if (m.drain !== undefined && now >= m.drain && !["finished", "failed", "unknown"].includes(m.phase))
                this.failed("Recording finalization is UNKNOWN. Keep the original browser copy.", false);
        }
        catch {
            this.stop("The recording clock failed.");
            this.failed("Recording timing is UNKNOWN.", false);
        }
    }
    stop(reason) {
        const m = this.managed;
        if (!m || ["finished", "failed"].includes(m.phase))
            return;
        if (m.drain === undefined) {
            try {
                m.drain = this.clock.mono() + RECORDING_DRAIN_MS;
            }
            catch {
                m.drain = 0;
            }
        }
        if (m.phase === "recording") {
            m.phase = "stopping";
            m.reason = reason;
            try {
                this.hooks.stop();
            }
            catch {
                this.failed("The recorder stop is UNKNOWN.", false);
            }
        }
        this.hooks.changed();
    }
    captured(released) { const m = this.managed; if (!m?.ownsRecorder)
        return; m.stopped = true; m.released = released; this.stop("Saving recording."); if (m.phase !== "unknown")
        m.phase = released ? "saving" : "unknown"; this.hooks.changed(); }
    saved(value) { const m = this.managed; if (m && m.stopped && m.released) {
        m.saved = value;
        if (m.phase !== "unknown")
            m.phase = "finished";
        this.hooks.changed();
    } }
    failed(error, released = false, diagnostics) { const m = this.managed; if (m) {
        m.phase = m.phase === "unknown" ? "unknown" : released ? "failed" : "unknown";
        m.stopped = released;
        m.released = released;
        m.error = error.slice(0, 512);
        m.diagnostics = m.ownsRecorder ? diagnostics : undefined;
        this.hooks.error?.(m.error);
        this.hooks.changed();
    } }
    metadata(value) {
        const m = this.managed;
        if (!m?.ownsRecorder)
            return value;
        let observedDurationMs = null;
        try {
            observedDurationMs = Math.max(0, this.clock.mono() - (m.started ?? this.clock.mono()));
        }
        catch { /* Uncertain timing stays explicit. */ }
        const partial = value.status === "partial" || m.reason !== "Duration reached." || observedDurationMs === null || observedDurationMs > m.command.durationMs + 1000;
        return { ...value, status: partial ? "partial" : "complete", managed: { recordingId: m.command.id, requestedDurationMs: m.command.durationMs, observedDurationMs, stopReason: m.reason ?? "Recorder stopped unexpectedly." } };
    }
    ownership() { const m = this.managed; return m?.ownsRecorder ? { id: m.command.id, generation: m.command.generation } : undefined; }
    dispose() { this.stop("The browser owner closed."); if (this.timer)
        clearInterval(this.timer); this.timer = undefined; }
}
//# sourceMappingURL=recording-controller.js.map