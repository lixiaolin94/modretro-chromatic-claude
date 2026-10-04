/** Public revisions cover the selected descriptor and these authored subtrees. */
export const PROJECT_REVISION_ALGORITHM = "sha256-merkle-v2";
export const PUBLIC_REVISION_DIRECTORIES = ["project", "assets"];
/** Plugins affect semantic freshness but deliberately do not change public revisions. */
export const SEMANTIC_PLUGIN_DIRECTORY = "plugins";
export const PROJECT_RESPONSE_LIMITS = Object.freeze({
    inspectionBytes: 4 * 1024,
    inventoryBytes: 32 * 1024,
    legacyInventoryBytes: 512 * 1024,
    semanticQueryBytes: 32 * 1024,
    inventoryPageSize: 250,
    semanticPageSize: 250,
    defaultSemanticPageSize: 50,
    eventNestingDepth: 64,
    customScriptDepth: 16,
    eventsPerOwner: 10_000,
});
const SHA256_HEX = /^[a-f\d]{64}$/u;
function validGeneration(value) {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function isSemanticCursorPayload(value) {
    if (typeof value !== "object" || value === null || Array.isArray(value))
        return false;
    const candidate = value;
    return (typeof candidate.revision === "string" &&
        SHA256_HEX.test(candidate.revision) &&
        candidate.revisionAlgorithm === PROJECT_REVISION_ALGORITHM &&
        validGeneration(candidate.selectionGeneration) &&
        validGeneration(candidate.semanticGeneration) &&
        typeof candidate.query === "string" &&
        candidate.query.length > 0 &&
        candidate.query.length <= 256 &&
        validGeneration(candidate.offset));
}
/** Semantic cursor identity includes plugin freshness separately from public revision. */
export function encodeSemanticCursor(payload) {
    if (!isSemanticCursorPayload(payload)) {
        throw new TypeError("A semantic cursor requires a valid revision, generations, query, and offset");
    }
    return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}
export function decodeSemanticCursor(cursor) {
    if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 2048)
        return undefined;
    if (!/^[A-Za-z\d_-]+$/u.test(cursor))
        return undefined;
    try {
        const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
        return isSemanticCursorPayload(parsed) ? parsed : undefined;
    }
    catch {
        return undefined;
    }
}
export function isSemanticCursorCurrent(payload, current, query) {
    return (isSemanticCursorPayload(payload) &&
        payload.revision === current.revision &&
        payload.revisionAlgorithm === current.revisionAlgorithm &&
        payload.selectionGeneration === current.selectionGeneration &&
        payload.semanticGeneration === current.semanticGeneration &&
        payload.query === query);
}
//# sourceMappingURL=project-access.js.map