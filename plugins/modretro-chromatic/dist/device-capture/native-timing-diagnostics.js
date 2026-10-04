/// <reference lib="dom" />
// Diagnostic for the explicitly selected timing-V2 ROM. It is never enabled
// for the ordinary device view and it does not create another image stream.
const HEX = [
    [0x38, 0x44, 0x4c, 0x54, 0x64, 0x44, 0x38, 0],
    [0x10, 0x30, 0x10, 0x10, 0x10, 0x10, 0x38, 0],
    [0x38, 0x44, 0x04, 0x08, 0x10, 0x20, 0x7c, 0],
    [0x78, 0x04, 0x04, 0x38, 0x04, 0x04, 0x78, 0],
    [0x08, 0x18, 0x28, 0x48, 0x7c, 0x08, 0x08, 0],
    [0x7c, 0x40, 0x40, 0x78, 0x04, 0x04, 0x78, 0],
    [0x38, 0x40, 0x40, 0x78, 0x44, 0x44, 0x38, 0],
    [0x7c, 0x04, 0x08, 0x10, 0x20, 0x20, 0x20, 0],
    [0x38, 0x44, 0x44, 0x38, 0x44, 0x44, 0x38, 0],
    [0x38, 0x44, 0x44, 0x3c, 0x04, 0x04, 0x38, 0],
    [0x38, 0x44, 0x44, 0x7c, 0x44, 0x44, 0x44, 0],
    [0x78, 0x44, 0x44, 0x78, 0x44, 0x44, 0x78, 0],
    [0x3c, 0x40, 0x40, 0x40, 0x40, 0x40, 0x3c, 0],
    [0x78, 0x44, 0x44, 0x44, 0x44, 0x44, 0x78, 0],
    [0x7c, 0x40, 0x40, 0x78, 0x40, 0x40, 0x7c, 0],
    [0x7c, 0x40, 0x40, 0x78, 0x40, 0x40, 0x40, 0],
];
const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
/** Require an exact unscaled fixture image and agreement of binary and hex rows. */
export function decodeTimingCounter(pixels, width, height) {
    if (width !== 160 || height !== 144 || pixels.length !== width * height * 4)
        return null;
    const luminance = (x, y) => { const i = (y * width + x) * 4; return .2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2]; };
    const light = median(Array.from({ length: 16 }, (_, i) => luminance(16 + 8 * i, 68)));
    const dark = median(Array.from({ length: 16 }, (_, i) => luminance(17 + 8 * i, 68)));
    if (light - dark < 18)
        return null;
    const ink = (x, y) => (light - luminance(x, y)) / (light - dark);
    let bits = 0;
    for (let i = 0; i < 16; i++) {
        const value = ink(20 + 8 * i, 68);
        if (value > .3 && value < .7)
            return null;
        bits = (bits << 1) | (value >= .7 ? 1 : 0);
    }
    let hex = 0;
    for (let digit = 0; digit < 4; digit++) {
        const differences = HEX.map(rows => {
            let mismatch = 0;
            for (let y = 0; y < 8; y++)
                for (let x = 0; x < 8; x++) {
                    const value = ink(64 + digit * 8 + x, 32 + y);
                    if ((value >= .5) !== !!(rows[y] & (0x80 >> x)))
                        mismatch++;
                }
            return mismatch;
        });
        const best = Math.min(...differences), index = differences.indexOf(best);
        if (best > 1 || differences.filter(value => value === best).length !== 1)
            return null;
        hex = (hex << 4) | index;
    }
    return bits === hex ? bits : null;
}
const sampleNames = ["callbackToEncode", "encode", "encodeToPublish", "callbackToPreviewQueue", "previewQueueToEncode", "encodeToHash", "hashToFileWrite", "fileWriteToPublish", "read", "serviceWait", "fetchToBody", "decode", "sampler", "callbackToSubmissionLower", "callbackToSubmissionUpper", "callbackToRafLower", "callbackToRafUpper", "clockRoundTrip"];
/** Fixed memory: 60 buckets, one 16-bit bitmap and at most 4096 values per distribution. */
export function createTimingDiagnostics(startedAt) {
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 144;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    const seen = new Uint8Array(8192), buckets = Array(60).fill(0), intervals = [];
    const samples = Object.fromEntries(sampleNames.map(name => [name, []]));
    const totals = Object.fromEntries(sampleNames.map(name => [name, 0]));
    const maxima = Object.fromEntries(sampleNames.map(name => [name, null]));
    const clockUnavailableResponses = { busy: 0, unsupported: 0, invalid: 0, error: 0, unspecified: 0 };
    let submitted = 0, valid = 0, invalid = 0, repeated = 0, distinct = 0, transitions = 0, wraps = 0, ambiguous = 0, clockRequestsStarted = 0, clockResponses = 0, clockHeadersPresent = 0, clockNoResponse = 0, clockAttempts = 0, clockValid = 0, clockUnavailable = 0, clockRafObserved = 0, clockRafUnobserved = 0;
    let first, previous, forwardTicks = 0, forwardJumps = 0, maxForwardDelta = 0, firstDistinctAt, lastDistinctAt, longestGapMs = null, summaryAt = -Infinity, cached, summaryFinal = false;
    const record = (name, value) => {
        if (value === undefined || !Number.isFinite(value) || value < 0)
            return;
        totals[name]++;
        maxima[name] = Math.max(maxima[name] ?? 0, value);
        if (samples[name].length < 4096)
            samples[name].push(value);
    };
    const percentile = (sorted, p) => sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
    function observe(image, t) {
        if (t.submittedAt - startedAt >= 60000)
            return;
        submitted++;
        const sampleStart = performance.now();
        let value = null;
        try {
            if (context && image.naturalWidth === 160 && image.naturalHeight === 144) {
                context.drawImage(image, 0, 0);
                value = decodeTimingCounter(context.getImageData(0, 0, 160, 144).data, 160, 144);
            }
        }
        catch { /* An unreadable canvas is an invalid observation, not a capture failure. */ }
        record("sampler", performance.now() - sampleStart);
        if (value === null)
            invalid++;
        else {
            valid++;
            first ??= value;
            if (previous !== undefined) {
                const delta = (value - previous + 65536) % 65536;
                if (delta === 0)
                    repeated++;
                else if (delta >= 32768)
                    ambiguous++;
                else {
                    transitions++;
                    forwardTicks += delta;
                    maxForwardDelta = Math.max(maxForwardDelta, delta);
                    if (delta > 1)
                        forwardJumps++;
                    if (value < previous)
                        wraps++;
                }
            }
            previous = value;
            const index = value >> 3, bit = 1 << (value & 7);
            if (!(seen[index] & bit)) {
                seen[index] = seen[index] | bit;
                distinct++;
                buckets[Math.min(59, Math.floor(Math.max(0, t.submittedAt - startedAt) / 1000))]++;
                firstDistinctAt ??= t.submittedAt;
                if (lastDistinctAt !== undefined) {
                    const gap = t.submittedAt - lastDistinctAt;
                    longestGapMs = Math.max(longestGapMs ?? 0, gap);
                    if (intervals.length < 4096)
                        intervals.push(gap);
                }
                lastDistinctAt = t.submittedAt;
            }
        }
        record("fetchToBody", t.bodyAt - t.startedAt);
        record("decode", t.decodedAt - t.decodeStartedAt);
        record("read", t.readMs);
        record("serviceWait", t.waitMs);
        if (t.callbackMs !== undefined && t.encodeStartedMs !== undefined && t.encodeFinishedMs !== undefined && t.publishedMs !== undefined) {
            record("callbackToEncode", t.encodeStartedMs - t.callbackMs);
            record("encode", t.encodeFinishedMs - t.encodeStartedMs);
            record("encodeToPublish", t.publishedMs - t.encodeFinishedMs);
        }
        const nativeStages = [t.callbackMs, t.previewQueuedMs, t.encodeStartedMs, t.encodeFinishedMs, t.hashFinishedMs, t.fileWrittenMs, t.publishedMs];
        // The added stages must describe one complete, ordered native frame. Do not
        // derive partial distributions from incomplete or malformed observations.
        if (nativeStages.every((value, index) => value !== undefined && Number.isFinite(value) && value >= 0 && (index === 0 || value >= nativeStages[index - 1]))) {
            record("callbackToPreviewQueue", t.previewQueuedMs - t.callbackMs);
            record("previewQueueToEncode", t.encodeStartedMs - t.previewQueuedMs);
            record("encodeToHash", t.hashFinishedMs - t.encodeFinishedMs);
            record("hashToFileWrite", t.fileWrittenMs - t.hashFinishedMs);
            record("fileWriteToPublish", t.publishedMs - t.fileWrittenMs);
        }
        if (t.clockAttempted) {
            clockAttempts++;
            const discontinuity = Math.abs((t.wallSubmittedAt - t.wallStartedAt) - (t.submittedAt - t.startedAt)) > 1000;
            if (t.clockSampleMs !== undefined && t.callbackMs !== undefined && t.publishedMs !== undefined && t.clockSampleMs >= t.publishedMs && !discontinuity) {
                const native = t.clockSampleMs - t.callbackMs, lower = native + t.submittedAt - t.headersAt, upper = native + t.submittedAt - t.startedAt;
                if (lower >= 0 && upper >= lower) {
                    clockValid++;
                    record("callbackToSubmissionLower", lower);
                    record("callbackToSubmissionUpper", upper);
                    record("clockRoundTrip", t.headersAt - t.startedAt);
                    return { nativeDeltaMs: native, startedAt: t.startedAt, headersAt: t.headersAt, wallStartedAt: t.wallStartedAt };
                }
                else
                    clockUnavailable++;
            }
            else
                clockUnavailable++;
        }
    }
    function observeRaf(sample, now, wallNow) {
        const lower = sample.nativeDeltaMs + now - sample.headersAt, upper = sample.nativeDeltaMs + now - sample.startedAt;
        if (now - startedAt >= 60000 || Math.abs((wallNow - sample.wallStartedAt) - (now - sample.startedAt)) > 1000 || lower < 0 || upper < lower) {
            clockRafUnobserved++;
            return;
        }
        clockRafObserved++;
        record("callbackToRafLower", lower);
        record("callbackToRafUpper", upper);
    }
    function missRaf() { clockRafUnobserved++; }
    function noteTimedRequest() { clockRequestsStarted++; }
    function noteTimedResponse(hasClock, reason) {
        clockResponses++;
        if (hasClock) {
            clockHeadersPresent++;
            return;
        }
        // Do not use an arbitrary response header as a property key.
        if (reason === "busy" || reason === "unsupported" || reason === "invalid" || reason === "error")
            clockUnavailableResponses[reason]++;
        else
            clockUnavailableResponses.unspecified++;
    }
    function noteTimedNoResponse() { clockNoResponse++; }
    function summary(now, endedAt) {
        if (cached !== undefined && (summaryFinal || endedAt === undefined && now - summaryAt < 1000))
            return cached;
        summaryAt = now;
        summaryFinal = endedAt !== undefined;
        const elapsed = Math.max(0, Math.min(60000, (endedAt ?? now) - startedAt)), seconds = Math.floor(elapsed / 1000);
        // Without a single valid decoded counter, zero would imply a measured rate
        // where the fixture was actually unreadable throughout the observation.
        const rates = (valid ? buckets.slice(0, seconds) : []).sort((a, b) => a - b), sorted = intervals.slice().sort((a, b) => a - b);
        const distributions = Object.fromEntries(sampleNames.map(name => { const values = samples[name].slice().sort((a, b) => a - b); return [name, { observed: totals[name], retained: values.length, omitted: totals[name] - values.length, p50Ms: percentile(values, .5), p95Ms: percentile(values, .95), p99Ms: percentile(values, .99), maxMs: maxima[name] }]; }));
        return cached = { version: 1, fixture: "timing-v2", scope: "unique DOM submissions of 160x144 timing fixture; not display scanout", elapsedMs: elapsed, finalized: endedAt !== undefined, submitted, valid, invalid, repeated, distinct, transitions, firstCounter: first, lastCounter: previous, forwardTicks, forwardJumps, maxForwardDelta, wraps, ambiguous, clockRequestsStarted, clockResponses, clockHeadersPresent, clockUnavailableResponses: { ...clockUnavailableResponses }, clockNoResponse, clockAttemptsAtSubmission: clockAttempts, clockValid, clockUnavailableAtSubmission: clockUnavailable, clockRafObserved, clockRafUnobserved,
            progressionScope: "forward deltas are modulo 65536; jumps do not identify where frames were missed; deltas at least 32768 are ambiguous",
            rateScope: "newly distinct valid decoded-counter observations per complete second, deduplicated over the measurement window; not content or source FPS; unavailable when no counter was decoded",
            rates: { completeSeconds: seconds, minFps: rates[0] ?? null, meanFps: rates.length ? rates.reduce((sum, x) => sum + x, 0) / rates.length : null, p50Fps: percentile(rates, .5), p95Fps: percentile(rates, .95), p99Fps: percentile(rates, .99), maxFps: rates.at(-1) ?? null },
            distinctGaps: { observed: Math.max(0, distinct - 1), retained: sorted.length, p50Ms: percentile(sorted, .5), p95Ms: percentile(sorted, .95), p99Ms: percentile(sorted, .99), betweenObservationsLongestMs: longestGapMs, initialCensoredMs: firstDistinctAt === undefined ? elapsed : firstDistinctAt - startedAt, trailingCensoredMs: lastDistinctAt === undefined ? elapsed : Math.max(0, startedAt + elapsed - lastDistinctAt) },
            nativeStageScope: "callbackToPreviewQueue measures callback to worker dispatch and includes any pending or cadence wait; previewQueueToEncode measures dispatch to worker start",
            fetchToBodyScope: "browser fetch start to body completion, including any service long-poll wait; not directly comparable to immediate-fetch 1.0.22",
            serviceWaitScope: "service-reported accumulated long-poll wait for submitted frames with the wait header; excludes handling outside those waits and responses without a submitted frame",
            clockUnavailableResponseScope: "one count per timed response without a usable clock header, including responses that do not submit a frame; unspecified includes missing or unrecognized reasons; requests with no response are counted separately",
            clockScope: "sampled frames only; request bounds and clockRoundTrip cover the complete potentially waiting request through response headers, so they are not directly comparable to immediate-fetch 1.0.22; conditional on comparable monotonic clock rates and no discontinuity during the request; browser clock resolution is not independently bounded; native timestamp is inside the capture callback after validation",
            distributions };
    }
    return { observe, observeRaf, missRaf, noteTimedRequest, noteTimedResponse, noteTimedNoResponse, summary };
}
//# sourceMappingURL=native-timing-diagnostics.js.map