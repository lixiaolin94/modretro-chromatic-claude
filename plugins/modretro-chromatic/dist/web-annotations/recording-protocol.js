/** Small shared browser/MCP recording protocol; never carries media bytes. */
export const RECORDING_DEFAULT_MS = 180_000;
export const RECORDING_MAX_MS = 600_000;
export const RECORDING_DRAIN_MS = 30_000;
export const RECORDING_LEASE_MS = 2_500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function obj(value, fields) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key)) ||
        new TextEncoder().encode(JSON.stringify(value)).length > 8192)
        throw new Error("Invalid recording control fields.");
    return value;
}
export function recordingId(value) { if (typeof value !== "string" || !UUID.test(value))
    throw new Error("Invalid recording ID."); return value; }
function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) { if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new Error("Invalid recording number."); return value; }
export function recordingDuration(value = RECORDING_DEFAULT_MS) { return integer(value, 1000, RECORDING_MAX_MS); }
export function parseRecordingDiagnostics(value) {
    const r = obj(value, ["mimeType", "startEventObserved", "dataEvents", "zeroByteEvents", "bytes", "omittedBytes", "startRequestedAt", "stoppedAt", "elapsedMs", "visibilityAtStart", "visibilityAtStop", "videoTrackAtStop", "audioTrackAtStop"]);
    if (typeof r.mimeType !== "string" || r.mimeType.length > 128 || /[\u0000-\u001f\u007f]/u.test(r.mimeType) || typeof r.startEventObserved !== "boolean")
        throw new Error("Invalid recorder diagnostics.");
    for (const key of ["dataEvents", "zeroByteEvents", "bytes", "omittedBytes"])
        integer(r[key]);
    if (r.dataEvents > 10000 || r.zeroByteEvents > r.dataEvents || typeof r.elapsedMs !== "number" || !Number.isFinite(r.elapsedMs) || r.elapsedMs < 0)
        throw new Error("Invalid recorder diagnostic counts.");
    for (const key of ["startRequestedAt", "stoppedAt"])
        if (typeof r[key] !== "string" || r[key].length !== 24 || !Number.isFinite(Date.parse(r[key])))
            throw new Error("Invalid recorder diagnostic time.");
    for (const key of ["visibilityAtStart", "visibilityAtStop"])
        if (typeof r[key] !== "string" || !["visible", "hidden", "unavailable"].includes(r[key]))
            throw new Error("Invalid recorder visibility.");
    if (typeof r.videoTrackAtStop !== "string" || !["live", "ended"].includes(r.videoTrackAtStop) || typeof r.audioTrackAtStop !== "string" || !["live", "ended", "not-included"].includes(r.audioTrackAtStop))
        throw new Error("Invalid recorder track state.");
    return r;
}
export function validateRecordingAudio(r) {
    if (r.audioIncluded === false) {
        if (typeof r.audioUnavailableReason !== "string" || !["not-started", "not-running"].includes(r.audioUnavailableReason))
            throw new Error("Invalid recording audio reason.");
    }
    else if (r.audioIncluded !== undefined && r.audioIncluded !== true || r.audioUnavailableReason !== undefined)
        throw new Error("Invalid recording audio state.");
}
export function parseRecordingSaved(value) {
    const r = obj(value, ["id", "kind", "mimeType", "bytes", "sha256", "createdAt", "path", "metadataPath", "url", "metadataUrl"]);
    recordingId(r.id);
    integer(r.bytes, 1, 128 * 1024 * 1024);
    if (r.kind !== "video" || typeof r.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(r.sha256) ||
        !["video/webm", "video/mp4"].includes(String(r.mimeType).split(";")[0]))
        throw new Error("Invalid saved recording identity.");
    for (const key of ["mimeType", "createdAt", "path", "metadataPath", "url", "metadataUrl"])
        if (typeof r[key] !== "string" || !r[key] || r[key].length > 2048)
            throw new Error("Invalid saved recording field.");
    return r;
}
export function savedRecordingKey(r) { return JSON.stringify([r.id, r.kind, r.mimeType, r.bytes, r.sha256, r.createdAt, r.path, r.metadataPath]); }
export function parseRecordingState(value) {
    const r = obj(value, ["generation", "available", "visible", "owner", "phase", "pending", "recordingId", "closeEpoch", "stopped", "released", "saved", "error", "diagnostics", "retireId", "audioIncluded", "audioUnavailableReason"]);
    integer(r.generation);
    for (const key of ["available", "visible", "pending"])
        if (typeof r[key] !== "boolean")
            throw new Error("Invalid recording status.");
    if (![null, "human", "mcp"].includes(r.owner) || !["idle", "recording", "stopping", "saving", "finished", "failed", "unknown"].includes(String(r.phase)))
        throw new Error("Invalid recording phase.");
    for (const key of ["recordingId", "closeEpoch", "retireId"])
        if (r[key] !== undefined)
            recordingId(r[key]);
    for (const key of ["stopped", "released"])
        if (r[key] !== undefined && typeof r[key] !== "boolean")
            throw new Error("Invalid release status.");
    if (r.error !== undefined && (typeof r.error !== "string" || r.error.length > 512))
        throw new Error("Invalid recording error.");
    if (r.saved !== undefined)
        r.saved = parseRecordingSaved(r.saved);
    if (r.diagnostics !== undefined)
        r.diagnostics = parseRecordingDiagnostics(r.diagnostics);
    validateRecordingAudio(r);
    return r;
}
export function parseRecordingReply(value) {
    const r = obj(value, ["start", "stop", "lease", "saved", "close", "terminalClose", "cancelClose", "settled", "retired"]);
    for (const key of ["stop", "lease", "close", "cancelClose", "settled", "retired"])
        if (r[key] !== undefined)
            recordingId(r[key]);
    if (r.retired !== undefined && Object.keys(r).length !== 1)
        throw new Error("Retired views cannot receive recording work.");
    if (r.terminalClose !== undefined && (r.terminalClose !== true || r.close === undefined))
        throw new Error("Invalid terminal close barrier.");
    if (r.start !== undefined) {
        const c = obj(r.start, ["id", "generation", "durationMs", "startBy", "stopBy"]);
        recordingId(c.id);
        integer(c.generation);
        recordingDuration(c.durationMs);
        integer(c.startBy);
        integer(c.stopBy);
        if (c.stopBy > c.startBy + RECORDING_MAX_MS)
            throw new Error("Invalid recording deadline.");
    }
    if (r.saved !== undefined) {
        const s = obj(r.saved, ["recordingId", "capture"]);
        recordingId(s.recordingId);
        s.capture = parseRecordingSaved(s.capture);
    }
    return r;
}
//# sourceMappingURL=recording-protocol.js.map