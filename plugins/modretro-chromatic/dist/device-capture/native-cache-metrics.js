const LIMIT = 4096, WINDOW_MS = 60_000;
/** Fixed-size, connection-scoped service evidence. The native and browser clocks are separate. */
export class NativeCacheMetrics {
    nativeSessionId;
    connectionId;
    sourceGeneration;
    startedAtMs;
    key;
    timings = { status: [], acquisition: [], fileRead: [], poll: [] };
    totals = { status: 0, acquisition: 0, fileRead: 0, poll: 0 };
    maxima = { status: null, acquisition: null, fileRead: null, poll: null };
    buckets = Array(60).fill(0);
    endedAtMs;
    endReason;
    cached;
    attempts = 0;
    acquired = 0;
    failures = 0;
    identityMismatches = 0;
    publications = 0;
    firstSequence;
    lastSequence;
    firstFrameId;
    lastFrameId;
    skippedSequences = 0;
    sequenceRegressions = 0;
    constructor(nativeSessionId, connectionId, sourceGeneration, startedAtMs) {
        this.nativeSessionId = nativeSessionId;
        this.connectionId = connectionId;
        this.sourceGeneration = sourceGeneration;
        this.startedAtMs = startedAtMs;
        this.key = JSON.stringify([nativeSessionId, connectionId, sourceGeneration]);
    }
    static forStatus(status, now) {
        if (status.connection !== "connected" || !status.latestFrame)
            return;
        return new NativeCacheMetrics(status.sessionId, status.latestFrame.connectionId, status.sourceGeneration, now);
    }
    matchesStatus(status) { return status.connection === "connected" && !!status.latestFrame && this.key === JSON.stringify([status.sessionId, status.latestFrame.connectionId, status.sourceGeneration]); }
    matchesImage(image) { return this.key === JSON.stringify([image.sessionId, image.connectionId, image.sourceGeneration]); }
    open(now) { if (this.endedAtMs === undefined && now - this.startedAtMs >= WINDOW_MS)
        this.end("window-complete", this.startedAtMs + WINDOW_MS); return this.endedAtMs === undefined; }
    end(reason, now) { if (this.endedAtMs !== undefined)
        return; this.endedAtMs = Math.min(this.startedAtMs + WINDOW_MS, Math.max(this.startedAtMs, now)); this.endReason = now >= this.startedAtMs + WINDOW_MS ? "window-complete" : reason; }
    restartable() { return this.endedAtMs !== undefined && this.endReason !== "window-complete"; }
    sample(name, duration, now) { if (!this.open(now) || !Number.isFinite(duration) || duration < 0)
        return; this.totals[name]++; this.maxima[name] = Math.max(this.maxima[name] ?? 0, duration); if (this.timings[name].length < LIMIT)
        this.timings[name].push(duration); }
    attempted(now) { if (this.open(now))
        this.attempts++; }
    failed(now) { if (this.open(now))
        this.failures++; }
    identityMismatch(now) { if (this.open(now))
        this.identityMismatches++; }
    validated(image, now) { if (this.open(now) && this.matchesImage(image))
        this.acquired++; }
    published(image, now) {
        if (!this.open(now) || !this.matchesImage(image))
            return;
        this.publications++;
        this.buckets[Math.min(59, Math.floor((now - this.startedAtMs) / 1000))]++;
        this.firstFrameId ??= image.frameId;
        this.lastFrameId = image.frameId;
        if (image.previewSequence === undefined)
            return;
        this.firstSequence ??= image.previewSequence;
        if (this.lastSequence !== undefined) {
            if (image.previewSequence > this.lastSequence)
                this.skippedSequences = Math.min(Number.MAX_SAFE_INTEGER, this.skippedSequences + image.previewSequence - this.lastSequence - 1);
            else if (image.previewSequence < this.lastSequence)
                this.sequenceRegressions++;
        }
        this.lastSequence = image.previewSequence;
    }
    snapshot(now) {
        this.open(now);
        if (this.cached && this.cached.endedAtMs === this.endedAtMs && (this.endedAtMs !== undefined || now - this.cached.at < 1000))
            return this.cached.value;
        const elapsed = Math.max(0, (this.endedAtMs ?? now) - this.startedAtMs), seconds = Math.min(60, Math.floor(elapsed / 1000));
        const percentile = (values, p) => values[Math.max(0, Math.ceil(values.length * p) - 1)] ?? null;
        const rates = this.buckets.slice(0, seconds).sort((a, b) => a - b);
        const timing = (name) => { const values = this.timings[name].slice().sort((a, b) => a - b); return { observed: this.totals[name], retained: values.length, omitted: this.totals[name] - values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99), maxMs: this.maxima[name] }; };
        const value = { version: 1, clock: "service-performance-now", clockAlignment: "not-aligned-to-browser-or-native", nativeSessionId: this.nativeSessionId, connectionId: this.connectionId, sourceGeneration: this.sourceGeneration, startedAtMs: this.startedAtMs, endedAtMs: this.endedAtMs, endReason: this.endReason, elapsedMs: elapsed, windowLimitMs: WINDOW_MS,
            scope: "single-connection service preview cache; window edges are censored; sequence gaps are encoded previews not observed in this cache, not source drops",
            acquisitionAttempts: this.attempts, validatedAcquisitions: this.acquired, failedAcquisitions: this.failures, identityMismatches: this.identityMismatches, cachePublications: this.publications, firstFrameId: this.firstFrameId, lastFrameId: this.lastFrameId,
            firstPreviewSequence: this.firstSequence, lastPreviewSequence: this.lastSequence, unobservedPreviewSequences: this.firstSequence === undefined || this.sequenceRegressions > 0 ? null : this.skippedSequences, previewSequenceRegressions: this.firstSequence === undefined ? null : this.sequenceRegressions,
            publicationRatesFps: { completeSeconds: seconds, min: rates[0] ?? null, mean: rates.length ? rates.reduce((sum, v) => sum + v, 0) / rates.length : null, p50: percentile(rates, .5), p95: percentile(rates, .95), p99: percentile(rates, .99), max: rates.at(-1) ?? null },
            timings: { status: timing("status"), acquisition: timing("acquisition"), fileRead: timing("fileRead"), poll: timing("poll") },
            timingScope: "status and poll include only connected, enabled cycles with an observed status frame; disabled, disconnected, pre-first-frame, failed-status and skipped-busy cycles are excluded. Status includes helper IPC and parsing; acquisition includes helper acquire, verified file read, and lease release; fileRead is its verified-read subset; poll covers the full included service cycle" };
        this.cached = { at: now, endedAtMs: this.endedAtMs, value };
        return value;
    }
}
//# sourceMappingURL=native-cache-metrics.js.map