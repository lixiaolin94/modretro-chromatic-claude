import { z } from "zod";
export const NATIVE_LIMITS = { maxDurationMs: 600_000, maxRecordingBytes: 128 * 1024 * 1024, maxRecordings: 2, maxScreenshots: 32, maxScreenshotBytes: 2 * 1024 * 1024, maxPreviewBytes: 1024 * 1024 };
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const finite = z.number().finite().nonnegative();
const id = z.string().min(1).max(1024).refine(value => value !== "default" && value !== "communications");
const player = z.string().regex(/^(0[1-9]|[1-9][0-9])$/);
const videoLabel = z.string().regex(/^Chromatic - Player (0[1-9]|[1-9][0-9])$/);
const audioLabel = z.string().regex(/^(?:Chromatic - Player (0[1-9]|[1-9][0-9])|Microphone \(Chromatic - Player (0[1-9]|[1-9][0-9])\))$/);
const dimension = z.number().int().min(1).max(4096);
export const nativeErrorSchema = z.object({ code: z.string().min(1).max(100), message: z.string().min(1).max(2000) }).strict();
export const nativePermissionsSchema = z.object({ video: z.enum(["authorized", "denied", "restricted", "not_determined", "not_required"]), audio: z.enum(["authorized", "denied", "restricted", "not_determined", "not_supported"]) }).strict();
export const nativeSelectionSchema = z.object({ videoId: id, videoLabel, audioId: id.optional(), audioLabel: audioLabel.optional() }).strict().refine(value => {
    const video = /([0-9]{2})$/.exec(value.videoLabel)?.[1];
    const audio = /([0-9]{2})\)?$/.exec(value.audioLabel ?? "")?.[1];
    return value.audioId === undefined && value.audioLabel === undefined || !!value.audioId && video === audio;
}, "Select matching Chromatic USB audio explicitly, or use video only.");
const sequence = { sessionId: z.string().uuid(), stateSequence: integer };
const count = z.object({ total: integer.max(1024), unlabeled: integer.max(1024), unsupported: integer.max(1024), omitted: integer.max(1024) }).strict();
export const nativeInventorySchema = z.object({ ...sequence, inventoryId: z.string().uuid(), permissions: nativePermissionsSchema,
    videoDevices: z.array(z.object({ deviceId: id, label: videoLabel, player, formats: z.array(z.object({ width: dimension, height: dimension, minFps: finite.max(1000), maxFps: finite.max(1000) }).strict()).max(64) }).strict()).max(4),
    audioDevices: z.array(z.object({ deviceId: id, label: audioLabel, player }).strict()).max(4),
    counts: z.object({ video: count, audio: count }).strict(),
}).strict().refine(value => [value.videoDevices, value.audioDevices].every(devices => new Set(devices.map(device => device.deviceId)).size === devices.length
    && devices.every(device => /([0-9]{2})\)?$/.exec(device.label)?.[1] === device.player)) && ["video", "audio"].every(kind => { const count = value.counts[kind], devices = kind === "video" ? value.videoDevices : value.audioDevices; return count.unlabeled + count.unsupported + count.omitted + devices.length <= count.total; }), "Device identity or counts are inconsistent.");
const processEvidence = z.array(z.object({ purpose: z.string().max(80), pid: integer.positive().optional(), startedAt: z.string().datetime(), spawnObserved: z.boolean(),
    exitCode: z.number().int().nullable().optional(), signal: z.string().nullable().optional(), exitedAt: z.string().datetime().optional(), closedAt: z.string().datetime().optional(),
    streamsSettled: z.boolean(), stderr: z.string().max(65536), error: z.string().max(2000).optional() }).strict()).max(64).optional();
const clockEvidence = { sourceGeneration: integer.optional(), sourceClock: z.literal("ffmpeg-relative-input").optional() };
const previewTimingSchema = z.object({ clock: z.literal("system-uptime"), callbackReceivedAtMs: finite, encodeStartedAtMs: finite,
    encodeFinishedAtMs: finite, publishedAtMs: finite, previewQueuedAtMs: finite.optional(), hashFinishedAtMs: finite.optional(),
    fileWrittenAtMs: finite.optional() }).strict().refine(value => {
    const { callbackReceivedAtMs: callback, previewQueuedAtMs: queued, encodeStartedAtMs: started, encodeFinishedAtMs: encoded, hashFinishedAtMs: hashed, fileWrittenAtMs: written, publishedAtMs: published } = value;
    if (!(callback <= started && started <= encoded && encoded <= published))
        return false;
    // Older helpers omit the entire instrumentation group. Partial groups cannot
    // establish which stages were measured for this exact frame.
    if (queued === undefined && hashed === undefined && written === undefined)
        return true;
    return queued !== undefined && hashed !== undefined && written !== undefined
        && callback <= queued && queued <= started && encoded <= hashed && hashed <= written && written <= published;
}, "Native preview timing is incomplete or out of order.");
const previewStatsSchema = z.object({ encodedFrames: integer, replacedSamples: integer, nativeDroppedVideoSamples: integer,
    workerInFlightReplacements: integer.optional(), cadenceWaitReplacements: integer.optional(), otherReplacements: integer.optional() }).strict().refine(value => {
    const { workerInFlightReplacements: worker, cadenceWaitReplacements: cadence, otherReplacements: other } = value;
    if (worker === undefined && cadence === undefined && other === undefined)
        return true;
    if (worker === undefined || cadence === undefined || other === undefined)
        return false;
    const total = worker + cadence + other;
    return Number.isSafeInteger(total) && total === value.replacedSamples;
}, "Native preview replacement counts are incomplete or inconsistent.");
const previewEvidence = { connectionId: z.string().uuid().optional(), previewSequence: integer.positive().optional(), timing: previewTimingSchema.optional() };
const activeRecording = z.object({ captureId: z.string().uuid(), state: z.enum(["recording", "finishing", "complete", "partial", "failed"]), durationMs: finite.max(NATIVE_LIMITS.maxDurationMs + 15_000), requestedDurationMs: integer.min(1000).max(NATIVE_LIMITS.maxDurationMs), deadlineUnixMs: integer,
    videoSamples: integer, audioSamples: integer, droppedVideoSamples: integer.nullable(), droppedAudioSamples: integer }).strict();
export const nativeStatusSchema = z.object({ ...sequence, connection: z.enum(["disconnected", "connecting", "connected", "stopping", "closed", "failed"]),
    selection: z.object({ videoDeviceId: id, audioDeviceId: id.optional(), videoLabel, audioLabel: audioLabel.optional(), player }).strict().nullable(),
    permissions: nativePermissionsSchema, processes: processEvidence, sampleEvidence: z.literal("encoded-output").optional(), ...clockEvidence,
    source: z.object({ width: dimension, height: dimension, firstPTS: finite.nullable(), lastPTS: finite.nullable(), videoSamples: integer, audioSamples: integer }).strict().nullable(),
    previewStats: previewStatsSchema.optional(),
    videoFormat: z.object({ width: dimension, height: dimension, mediaSubType: integer,
        minimumFrameDurationSeconds: finite.nullable(), maximumFrameDurationSeconds: finite.nullable(),
        supportedFrameRateRanges: z.array(z.object({ minFps: finite, maxFps: finite }).strict()
            .refine(value => value.minFps <= value.maxFps, "Video frame-rate range is reversed.")).max(8), observedAtUptimeMs: finite }).strict().optional(),
    recording: z.union([activeRecording, z.lazy(() => nativeRecordingSchema)]).nullable(),
    latestFrame: z.object({ frameId: integer, basename: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.(?:jpg|jpeg|png)$/), bytes: integer.max(NATIVE_LIMITS.maxPreviewBytes), sha256: z.string().regex(/^[a-f0-9]{64}$/), width: dimension, height: dimension, sourcePTS: finite, format: z.literal("jpeg"), ...previewEvidence }).strict().nullable(), lastError: nativeErrorSchema.nullable(), accepted: z.literal(true).optional(),
}).strict().refine(value => !value.selection || nativeSelectionSchema.safeParse({ videoId: value.selection.videoDeviceId, videoLabel: value.selection.videoLabel, ...(value.selection.audioDeviceId ? { audioId: value.selection.audioDeviceId, audioLabel: value.selection.audioLabel } : {}) }).success && /([0-9]{2})$/.exec(value.selection.videoLabel)?.[1] === value.selection.player, "Native selection is inconsistent.");
export const nativeImageSchema = z.object({ ...sequence, frameId: integer, basename: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.(?:jpg|jpeg|png)$/), bytes: integer.min(1).max(NATIVE_LIMITS.maxScreenshotBytes),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), width: dimension, height: dimension, sourcePTS: finite, format: z.enum(["jpeg", "png"]), ...clockEvidence, ...previewEvidence,
    leaseId: z.string().uuid().optional() }).strict().refine(value => value.width * value.height <= 8_388_608 && (value.format !== "jpeg" || value.bytes <= NATIVE_LIMITS.maxPreviewBytes), "Frame exceeds its pixel or byte limit.");
export const nativeFrameReleaseSchema = z.object({ ...sequence, leaseId: z.string().uuid(), released: z.literal(true) }).strict();
export const nativeClockSchema = z.object({ ...sequence, clock: z.literal("system-uptime"), uptimeMs: finite }).strict();
export const nativeRecordingSchema = z.object({ captureId: z.string().uuid(), state: z.enum(["complete", "partial", "failed"]), basename: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.-]{0,100}\.(?:mp4|webm)$/).nullable(),
    format: z.enum(["mp4", "webm"]).optional(),
    bytes: integer.max(NATIVE_LIMITS.maxRecordingBytes), sha256: z.string().regex(/^[a-f0-9]{64}$/).nullable(), durationMs: finite.max(NATIVE_LIMITS.maxDurationMs + 15_000), requestedDurationMs: integer.min(1000).max(NATIVE_LIMITS.maxDurationMs),
    videoSamples: integer, audioSamples: integer, droppedVideoSamples: integer.nullable(), droppedAudioSamples: integer, reason: z.enum(["duration", "stop", "disconnect", "close", "signal", "eof", "limit", "error"]), error: nativeErrorSchema.nullable(), devicesReleased: z.boolean(), streamContinues: z.boolean().optional(),
    processes: processEvidence, sampleEvidence: z.literal("encoded-output").optional(), encodedDurationMs: finite.optional(), ...clockEvidence,
}).strict().refine(value => value.basename === null || value.basename.endsWith(`.${value.format ?? "mp4"}`), "Recording filename must match its declared format.")
    .refine(value => value.droppedVideoSamples !== null || value.sampleEvidence === "encoded-output", "Unobserved source drops require explicit encoded-output scope.")
    .refine(value => value.state !== "complete" || value.basename !== null && value.bytes > 0 && value.sha256 !== null && (value.devicesReleased || value.streamContinues === true && ["stop", "duration", "limit"].includes(value.reason)) && value.error === null, "Complete recording requires a finalized file and either released device or an intentionally continuing stream.");
export const nativeReadySchema = z.object({ event: z.literal("ready"), protocolVersion: z.literal(1), stateSequence: integer, sessionId: z.string().uuid(), sessionDir: z.string().min(1).max(4096), platform: z.enum(["macOS", "Linux"]),
    limits: z.object({ maxDurationMs: z.literal(NATIVE_LIMITS.maxDurationMs), maxRecordingBytes: z.literal(NATIVE_LIMITS.maxRecordingBytes), maxRecordings: z.literal(2), maxScreenshots: z.literal(32), maxScreenshotBytes: z.literal(NATIVE_LIMITS.maxScreenshotBytes), maxPreviewBytes: z.literal(NATIVE_LIMITS.maxPreviewBytes) }).strict(),
}).strict();
export const nativeFatalSchema = z.object({ event: z.literal("fatal"), sessionId: z.string().uuid().nullable(), error: nativeErrorSchema, devicesReleased: z.literal(false) }).strict();
export const nativeEventSchema = z.union([z.object({ event: z.literal("status"), status: nativeStatusSchema }).strict(), z.object({ event: z.literal("recording_finished"), ...sequence, recording: nativeRecordingSchema }).strict(), z.object({ event: z.literal("closed"), ...sequence, devicesReleased: z.boolean() }).strict(), nativeFatalSchema]);
export const nativeResponseSchema = z.union([
    z.object({ requestId: z.string().uuid(), ok: z.literal(true), result: z.object(sequence).passthrough() }).strict(),
    z.object({ requestId: z.string().uuid(), ok: z.literal(false), error: nativeErrorSchema, ...sequence }).strict(),
]);
//# sourceMappingURL=native-protocol.js.map