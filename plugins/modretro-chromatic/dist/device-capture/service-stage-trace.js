const CAPACITY = 60, WIDTH_MS = 1000;
const count = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
const duration = (value) => Number.isFinite(value) && value >= 0 ? value : null;
/** Sparse, bounded service-clock events. Missing seconds are unobserved, never synthetic zeros. */
export class ServiceStageTrace {
    startedAtMs;
    startedAfterUnattributedTransition;
    buckets = new Map();
    latestMs;
    endedAtMs;
    endReason;
    inFlight;
    lastNative;
    counterRegression = false;
    clockAnomaly = false;
    evictedBuckets = 0;
    overflow = false;
    identity;
    constructor(serviceSessionId, serviceGeneration, status, startedAtMs, startedAfterUnattributedTransition = false) {
        this.startedAtMs = startedAtMs;
        this.startedAfterUnattributedTransition = startedAfterUnattributedTransition;
        if (!Number.isFinite(startedAtMs) || startedAtMs < 0 || !Number.isSafeInteger(Math.floor(startedAtMs)) || status.connection !== "connected" || !status.latestFrame)
            throw new Error("Trace requires a connected frame and monotonic start.");
        this.latestMs = startedAtMs;
        this.identity = { serviceSessionId, serviceGeneration, nativeSessionId: status.sessionId, connectionId: status.latestFrame.connectionId ?? null, sourceGeneration: status.sourceGeneration ?? null };
    }
    matches(status) {
        return status.connection === "connected" && !!status.latestFrame && status.sessionId === this.identity.nativeSessionId && (status.latestFrame.connectionId ?? null) === this.identity.connectionId && (status.sourceGeneration ?? null) === this.identity.sourceGeneration;
    }
    matchesImage(image) {
        return image.sessionId === this.identity.nativeSessionId && (image.connectionId ?? null) === this.identity.connectionId && (image.sourceGeneration ?? null) === this.identity.sourceGeneration;
    }
    get ended() { return this.endedAtMs !== undefined; }
    advance(now) {
        const elapsed = now - this.startedAtMs, index = Math.floor(elapsed / WIDTH_MS);
        if (!Number.isFinite(now) || now < this.latestMs || !Number.isSafeInteger(Math.floor(now)) || !Number.isSafeInteger(Math.floor(elapsed)) || !Number.isSafeInteger(index)) {
            this.clockAnomaly = true;
            return false;
        }
        this.latestMs = now;
        const first = Math.max(0, index - CAPACITY + 1);
        for (const key of this.buckets.keys())
            if (key < first) {
                this.buckets.delete(key);
                this.evictedBuckets++;
            }
        return true;
    }
    bucket(now) {
        if (this.ended || !this.advance(now))
            return;
        const index = Math.floor((now - this.startedAtMs) / WIDTH_MS);
        let bucket = this.buckets.get(index);
        if (!bucket) {
            bucket = { index, statusStarts: 0, statusCompletions: 0, statusFailures: 0, acquisitionStarts: 0, acquisitionCompletions: 0, acquisitionFailures: 0, verifiedPublications: 0, identityMismatches: 0, maxStatusMs: null, maxAcquisitionMs: null, maxFileReadMs: null, firstNativeSample: null, lastNativeSample: null, firstPublication: null, lastPublication: null };
            this.buckets.set(index, bucket);
        }
        return bucket;
    }
    increment(bucket, key) {
        if (bucket[key] === Number.MAX_SAFE_INTEGER)
            this.overflow = true;
        else
            bucket[key]++;
    }
    begin(phase, now) {
        const bucket = this.bucket(now);
        if (!bucket)
            return;
        if (this.inFlight) {
            this.overflow = true;
            return;
        }
        this.increment(bucket, phase === "status" ? "statusStarts" : "acquisitionStarts");
        this.inFlight = { phase, startedAtMs: now };
    }
    finish(phase, success, now, fileReadMs) {
        const bucket = this.bucket(now);
        if (!bucket)
            return;
        if (!this.inFlight || this.inFlight.phase !== phase) {
            this.overflow = true;
            return;
        }
        const elapsed = duration(now - this.inFlight.startedAtMs);
        this.inFlight = undefined;
        this.increment(bucket, phase === "status" ? (success ? "statusCompletions" : "statusFailures") : (success ? "acquisitionCompletions" : "acquisitionFailures"));
        if (elapsed !== null) {
            const key = phase === "status" ? "maxStatusMs" : "maxAcquisitionMs";
            bucket[key] = Math.max(bucket[key] ?? 0, elapsed);
        }
        if (phase === "acquisition" && fileReadMs !== undefined) {
            const read = duration(fileReadMs);
            if (read !== null)
                bucket.maxFileReadMs = Math.max(bucket.maxFileReadMs ?? 0, read);
        }
    }
    sample(status, now, observedVia = "status-response") {
        if (!this.matches(status))
            return;
        const bucket = this.bucket(now);
        if (!bucket)
            return;
        const stats = status.previewStats;
        const sample = { atMs: now, observedVia, videoSamples: count(status.source?.videoSamples), encodedFrames: count(stats?.encodedFrames), replacedSamples: count(stats?.replacedSamples), workerInFlightReplacements: count(stats?.workerInFlightReplacements), cadenceWaitReplacements: count(stats?.cadenceWaitReplacements), otherReplacements: count(stats?.otherReplacements), nativeDroppedVideoSamples: count(stats?.nativeDroppedVideoSamples) };
        if (this.lastNative)
            for (const key of ["videoSamples", "encodedFrames", "replacedSamples", "workerInFlightReplacements", "cadenceWaitReplacements", "otherReplacements", "nativeDroppedVideoSamples"]) {
                const before = this.lastNative[key], after = sample[key];
                if (before !== null && after !== null && after < before)
                    this.counterRegression = true;
            }
        bucket.firstNativeSample ??= sample;
        bucket.lastNativeSample = sample;
        this.lastNative = sample;
    }
    publish(image, now) {
        if (!this.matchesImage(image))
            return;
        const bucket = this.bucket(now);
        if (!bucket)
            return;
        this.increment(bucket, "verifiedPublications");
        const anchor = { atMs: now, frameId: image.frameId, previewSequence: image.previewSequence ?? null, nativeCallbackAtMs: image.timing?.callbackReceivedAtMs ?? null, nativePublishedAtMs: image.timing?.publishedAtMs ?? null };
        bucket.firstPublication ??= anchor;
        bucket.lastPublication = anchor;
    }
    mismatch(now) { const bucket = this.bucket(now); if (bucket)
        this.increment(bucket, "identityMismatches"); }
    end(reason, now) { if (this.ended)
        return; if (!this.advance(now))
        now = this.latestMs; this.endedAtMs = now; this.endReason = reason; }
    snapshot(now) {
        if (!this.ended && !this.advance(now))
            now = this.latestMs;
        const through = this.endedAtMs ?? this.latestMs, index = Math.floor((through - this.startedAtMs) / WIDTH_MS), first = Math.max(0, index - CAPACITY + 1);
        const connectionContinuity = this.identity.connectionId !== null ? (this.identity.sourceGeneration !== null ? "connection-id-and-source-generation" : "connection-id") : (this.identity.sourceGeneration !== null ? "source-generation" : "unverified");
        return { version: 1, state: this.ended ? "ended" : "active", clock: "service-performance-now", clockAlignment: "not-aligned-to-native-or-browser", scope: "Sparse service events and native counters sampled when status is observed; missing buckets are unobserved, not zero. Native timestamps are same-frame anchors only. Stage maximum durations are attributed to the bucket where the operation completed, including operations started in an earlier bucket.", durationAttribution: "completion-bucket", identity: { ...this.identity }, connectionContinuity, startedAfterUnattributedTransition: this.startedAfterUnattributedTransition, startedAtMs: this.startedAtMs, observedThroughMs: through, endedAtMs: this.endedAtMs ?? null, endReason: this.endReason ?? null, bucketWidthMs: WIDTH_MS, capacity: CAPACITY, firstRetainedIndex: first, lastRetainedIndex: index, evictedBuckets: this.evictedBuckets, evictionUnit: "materialized-event-buckets", firstEdgePartial: true, lastEdgePartial: true, clockAnomaly: this.clockAnomaly, counterRegression: this.counterRegression, overflow: this.overflow, inFlight: this.inFlight ? { ...this.inFlight, ageMs: duration(through - this.inFlight.startedAtMs) } : null, buckets: [...this.buckets.values()].sort((a, b) => a.index - b.index).map(value => ({ ...value, firstNativeSample: value.firstNativeSample && { ...value.firstNativeSample }, lastNativeSample: value.lastNativeSample && { ...value.lastNativeSample }, firstPublication: value.firstPublication && { ...value.firstPublication }, lastPublication: value.lastPublication && { ...value.lastPublication } })) };
    }
}
//# sourceMappingURL=service-stage-trace.js.map