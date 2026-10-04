import { parseRecordingSaved, parseRecordingDiagnostics, validateRecordingAudio, recordingDuration, recordingId } from "./web-annotations/recording-protocol.js";
function object(value, required, optional = []) {
    if (!value || typeof value !== "object" || Array.isArray(value) || required.some(k => !Object.hasOwn(value, k)) || Object.keys(value).some(k => ![...required, ...optional].includes(k)))
        throw new Error("Invalid recording journal fields.");
    return value;
}
const int = (n, max = Number.MAX_SAFE_INTEGER) => { if (!Number.isSafeInteger(n) || n < 0 || n > max)
    throw new Error("Invalid recording journal number."); };
export function parseRecordingJob(value) {
    const r = object(value, ["version", "id", "cartridgeType", "binding", "phase", "durationMs", "admittedAt", "startBy", "stopBy", "delivered", "uploadAttempted", "stopped", "released", "browserAcknowledgedSave"], ["finalizationDeadline", "saved", "outcome", "error", "partial", "diagnostics", "audioIncluded", "audioUnavailableReason"]);
    if (r.version !== 1)
        throw new Error("Unknown recording journal version.");
    recordingId(r.id);
    int(r.cartridgeType, 255);
    recordingDuration(r.durationMs);
    const b = object(r.binding, ["listenerId", "viewId", "romSha256", "runtimeSha256", "sourceRevision", "recordingGeneration"]);
    recordingId(b.viewId);
    int(b.recordingGeneration);
    if (typeof b.listenerId !== "string" || !/^[a-f0-9]{32}$/.test(b.listenerId) || typeof b.romSha256 !== "string" || !/^[a-f0-9]{64}$/.test(b.romSha256) || typeof b.runtimeSha256 !== "string" || !/^[a-f0-9]{64}$/.test(b.runtimeSha256) || typeof b.sourceRevision !== "string" || !b.sourceRevision.length || b.sourceRevision.length > 1024)
        throw new Error("Invalid recording journal binding.");
    for (const k of ["admittedAt", "startBy", "stopBy"])
        int(r[k]);
    if (r.finalizationDeadline !== undefined)
        int(r.finalizationDeadline);
    if (r.startBy !== r.admittedAt + 5000 || r.stopBy !== r.startBy + r.durationMs)
        throw new Error("Invalid recording journal deadlines.");
    for (const k of ["delivered", "uploadAttempted", "stopped", "released", "browserAcknowledgedSave"])
        if (typeof r[k] !== "boolean")
            throw new Error("Invalid recording journal facts.");
    if (!["queued", "starting", "recording", "stopping", "saving", "finished", "failed", "unknown"].includes(String(r.phase)))
        throw new Error("Invalid recording journal phase.");
    if (r.error !== undefined && (typeof r.error !== "string" || r.error.length > 512))
        throw new Error("Invalid recording journal error.");
    if (r.diagnostics !== undefined)
        r.diagnostics = parseRecordingDiagnostics(r.diagnostics);
    validateRecordingAudio(r);
    if (r.outcome !== undefined && !['complete', 'partial'].includes(String(r.outcome)))
        throw new Error("Invalid recording outcome.");
    if (r.saved !== undefined) {
        r.saved = parseRecordingSaved(r.saved);
        const saved = r.saved;
        if (saved.url !== `./codex-captures/${saved.id}/media` || saved.metadataUrl !== `./codex-captures/${saved.id}/metadata`)
            throw new Error("Invalid recording journal URL.");
    }
    if (r.phase === "finished" && (!r.delivered || !r.uploadAttempted || !r.stopped || !r.released || !r.browserAcknowledgedSave || !r.saved || !r.outcome))
        throw new Error("Unproven terminal recording journal.");
    if (r.phase === "failed" && (r.uploadAttempted || r.saved || !r.stopped || !r.released))
        throw new Error("Unproven failed recording journal.");
    if (r.partial !== undefined) {
        const p = object(r.partial, ["id", "path", "metadataPath", "mediaPublished", "metadataPublished", "publicationAttempted", "temporaryPaths"]);
        recordingId(p.id);
        for (const k of ["path", "metadataPath"])
            if (typeof p[k] !== "string" || p[k].length > 4096)
                throw new Error("Invalid partial recording path.");
        for (const k of ["mediaPublished", "metadataPublished", "publicationAttempted"])
            if (typeof p[k] !== "boolean")
                throw new Error("Invalid partial recording fact.");
        if (!Array.isArray(p.temporaryPaths) || p.temporaryPaths.length > 4 || p.temporaryPaths.some(x => typeof x !== "string" || x.length > 4096))
            throw new Error("Invalid partial recording files.");
    }
    return r;
}
//# sourceMappingURL=web-preview-recording-record.js.map