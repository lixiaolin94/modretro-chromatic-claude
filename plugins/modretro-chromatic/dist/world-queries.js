import { createHash } from "node:crypto";
import { decodeSemanticCursor, encodeSemanticCursor, isSemanticCursorCurrent, PROJECT_RESPONSE_LIMITS, } from "./project-access.js";
import { GameStudioProjectError } from "./project.js";
const MAXIMUM_RELATIONS = 32;
const MAXIMUM_TRAVERSED_REFERENCES = 100_000;
const VALID_NODE_TYPES = new Set([
    "scene", "actor", "trigger", "asset", "palette", "variable", "script",
    "actorPrefab", "triggerPrefab", "settings",
]);
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function invalidInput(message) {
    throw new GameStudioProjectError("INVALID_INPUT", message);
}
function positiveLimit(value, fallback, name) {
    const limit = value ?? fallback;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > PROJECT_RESPONSE_LIMITS.semanticPageSize) {
        invalidInput(`${name} must be an integer between 1 and ${PROJECT_RESPONSE_LIMITS.semanticPageSize}`);
    }
    return limit;
}
function nodeIdentity(node) {
    return `${node.type}\u0000${node.id}\u0000${"sceneId" in node ? node.sceneId ?? "" : ""}`;
}
function ownerIdentity(owner) {
    return {
        type: owner.resourceType,
        id: owner.resourceId,
        ...(owner.sceneId ? { sceneId: owner.sceneId } : {}),
        resourcePath: owner.resourcePath,
    };
}
function referenceIdentity(reference) {
    return JSON.stringify([
        nodeIdentity(ownerIdentity(reference.owner)),
        nodeIdentity(reference.target),
        reference.relation,
        reference.access ?? "",
        reference.event?.id ?? "",
        reference.event?.scriptKey ?? "",
        reference.event?.branchPath ?? [],
        reference.provenance,
    ]);
}
function compareReferences(left, right) {
    return referenceIdentity(left).localeCompare(referenceIdentity(right));
}
function mergeCoverage(original, limitations) {
    if (limitations.length === 0)
        return original;
    const seen = new Set(original.limitations.map((limitation) => JSON.stringify(limitation)));
    const unique = [...original.limitations];
    for (const limitation of limitations) {
        const key = JSON.stringify(limitation);
        if (seen.has(key))
            continue;
        seen.add(key);
        unique.push(limitation);
    }
    return { ...original, complete: false, limitations: unique };
}
function queryIdentity(query, direction, depth) {
    return createHash("sha256").update(JSON.stringify({
        node: query.node,
        direction,
        relations: query.relations ? [...new Set(query.relations)].sort() : [],
        sceneId: query.sceneId ?? null,
        depth,
    })).digest("hex");
}
function responseBytes(value) {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
}
function assertNodeExists(access, node, sceneId) {
    if (node.type === "settings")
        return;
    if (node.type === "asset") {
        const lookup = access.asset({ assetId: node.id });
        if (lookup.status === "unique")
            return;
        throw new GameStudioProjectError(lookup.status === "ambiguous" ? "AMBIGUOUS_ASSET" : "RESOURCE_NOT_FOUND", `No unique asset exists with id ${node.id}`);
    }
    if (node.type === "actor" || node.type === "trigger") {
        if (sceneId) {
            const resource = node.type === "actor" ? access.actor(sceneId, node.id) : access.trigger(sceneId, node.id);
            if (resource)
                return;
        }
        else if (access.resource(node))
            return;
    }
    else if (access.resource(node))
        return;
    // Internal prefab and reusable-script identities may be represented only by graph edges.
    if ((node.type === "script" || node.type === "actorPrefab" || node.type === "triggerPrefab")
        && (access.effectiveReferences(node).length > 0 || access.effectiveOutgoingReferences(node).length > 0)) {
        return;
    }
    throw new GameStudioProjectError("RESOURCE_NOT_FOUND", `No ${node.type} exists with id ${node.id}`);
}
function graphNode(node, sceneId) {
    return node.type === "actor" || node.type === "trigger"
        ? { ...node, ...(sceneId ? { sceneId } : {}) }
        : { ...node };
}
/** Traverse only indexed effective gameplay relationships, never disabled structural edges. */
export async function worldDependencies(access, query) {
    if (!isObject(query.node) || !VALID_NODE_TYPES.has(query.node.type)
        || typeof query.node.id !== "string" || query.node.id.length === 0 || query.node.id.length > 256) {
        invalidInput("A dependency query requires a supported resource node and a bounded nonempty id");
    }
    const direction = query.direction ?? "both";
    if (direction !== "incoming" && direction !== "outgoing" && direction !== "both") {
        invalidInput("Dependency direction must be incoming, outgoing, or both");
    }
    const depth = query.depth ?? 1;
    if (depth !== 1 && depth !== 2 && depth !== 3)
        invalidInput("Dependency depth must be 1, 2, or 3");
    if (query.relations !== undefined && (!Array.isArray(query.relations)
        || query.relations.length > MAXIMUM_RELATIONS
        || query.relations.some((relation) => typeof relation !== "string" || relation.length === 0 || relation.length > 64))) {
        invalidInput(`Dependency relations must contain at most ${MAXIMUM_RELATIONS} bounded relation names`);
    }
    if (query.sceneId !== undefined && (typeof query.sceneId !== "string" || query.sceneId.length === 0 || query.sceneId.length > 256)) {
        invalidInput("A scene filter must be a bounded nonempty scene id");
    }
    const limit = positiveLimit(query.limit, PROJECT_RESPONSE_LIMITS.defaultSemanticPageSize, "limit");
    await access.ensureFresh();
    assertNodeExists(access, query.node, query.sceneId);
    const identity = queryIdentity(query, direction, depth);
    const coverageIdentity = `coverage:${identity}`;
    let offset = 0;
    if (query.cursor !== undefined) {
        const decoded = decodeSemanticCursor(query.cursor);
        if (!decoded)
            throw new GameStudioProjectError("INVALID_CURSOR", "The semantic dependency cursor is malformed");
        if (!isSemanticCursorCurrent(decoded, access, identity)) {
            throw new GameStudioProjectError("STALE_CURSOR", "The semantic dependency cursor no longer matches this project, selection, semantics, or query");
        }
        offset = decoded.offset;
    }
    let coverageOffset = 0;
    if (query.coverageCursor !== undefined) {
        const decoded = decodeSemanticCursor(query.coverageCursor);
        if (!decoded)
            throw new GameStudioProjectError("INVALID_CURSOR", "The semantic coverage cursor is malformed");
        if (!isSemanticCursorCurrent(decoded, access, coverageIdentity)) {
            throw new GameStudioProjectError("STALE_CURSOR", "The semantic coverage cursor no longer matches this project, selection, semantics, or query");
        }
        coverageOffset = decoded.offset;
    }
    const allowedRelations = query.relations ? new Set(query.relations) : undefined;
    const references = new Map();
    const visited = new Set();
    let frontier = [graphNode(query.node, query.sceneId)];
    const limitations = [];
    let examined = 0;
    traversal: for (let distance = 0; distance < depth && frontier.length > 0; distance += 1) {
        const next = [];
        for (const current of frontier) {
            const currentKey = nodeIdentity(current);
            if (visited.has(currentKey))
                continue;
            visited.add(currentKey);
            const incoming = direction !== "outgoing" ? access.effectiveReferences(current) : [];
            const outgoing = direction !== "incoming" ? access.effectiveOutgoingReferences(current) : [];
            for (const reference of [...incoming, ...outgoing]) {
                examined += 1;
                if (examined > MAXIMUM_TRAVERSED_REFERENCES) {
                    limitations.push({
                        code: "DEPENDENCY_TRAVERSAL_LIMIT",
                        message: `Traversal stopped after ${MAXIMUM_TRAVERSED_REFERENCES} effective references; narrow its relation, scene, or depth`,
                    });
                    break traversal;
                }
                if (allowedRelations && !allowedRelations.has(reference.relation))
                    continue;
                if (query.sceneId && reference.owner.sceneId !== undefined && reference.owner.sceneId !== query.sceneId)
                    continue;
                references.set(referenceIdentity(reference), reference);
                const owner = ownerIdentity(reference.owner);
                if (nodeIdentity(owner) !== currentKey)
                    next.push(owner);
                if (nodeIdentity(reference.target) !== currentKey)
                    next.push(reference.target);
            }
        }
        frontier = next;
    }
    const sorted = [...references.values()].sort(compareReferences);
    if (offset > sorted.length)
        throw new GameStudioProjectError("STALE_CURSOR", "The semantic dependency cursor points beyond the current result set");
    const coverage = mergeCoverage(access.coverage, limitations);
    const reviewedEvents = coverage.reviewedCustomEvents ?? [];
    const coverageTotal = coverage.limitations.length + reviewedEvents.length;
    if (coverageOffset > coverageTotal)
        throw new GameStudioProjectError("STALE_CURSOR", "The semantic coverage cursor points beyond the current diagnostic set");
    const referenceLimit = Math.min(limit, sorted.length - offset);
    const coverageLimit = Math.min(PROJECT_RESPONSE_LIMITS.defaultSemanticPageSize, coverageTotal - coverageOffset);
    function resultPage(returned, coverageReturned) {
        const nextOffset = offset + returned;
        const nextCoverageOffset = coverageOffset + coverageReturned;
        const pageLimitations = coverage.limitations.slice(Math.min(coverageOffset, coverage.limitations.length), Math.min(nextCoverageOffset, coverage.limitations.length));
        const pageReviewedEvents = reviewedEvents.slice(Math.max(0, coverageOffset - coverage.limitations.length), Math.max(0, nextCoverageOffset - coverage.limitations.length));
        return {
            revision: access.revision,
            revisionAlgorithm: access.revisionAlgorithm,
            selectionGeneration: access.selectionGeneration,
            semanticGeneration: access.semanticGeneration,
            node: query.node,
            direction,
            references: sorted.slice(offset, nextOffset),
            total: sorted.length,
            returned,
            coverage: {
                complete: coverage.complete,
                limitations: pageLimitations,
                ...(coverage.reviewedCustomEvents === undefined ? {} : { reviewedCustomEvents: pageReviewedEvents }),
                pagination: {
                    limitations: { total: coverage.limitations.length, returned: pageLimitations.length },
                    reviewedCustomEvents: { total: reviewedEvents.length, returned: pageReviewedEvents.length },
                    nextCursor: nextCoverageOffset < coverageTotal ? encodeSemanticCursor({
                        revision: access.revision,
                        revisionAlgorithm: access.revisionAlgorithm,
                        selectionGeneration: access.selectionGeneration,
                        semanticGeneration: access.semanticGeneration,
                        query: coverageIdentity,
                        offset: nextCoverageOffset,
                    }) : null,
                },
            },
            nextCursor: nextOffset < sorted.length ? encodeSemanticCursor({
                revision: access.revision,
                revisionAlgorithm: access.revisionAlgorithm,
                selectionGeneration: access.selectionGeneration,
                semanticGeneration: access.semanticGeneration,
                query: identity,
                offset: nextOffset,
            }) : null,
        };
    }
    const fits = (returned, coverageReturned) => responseBytes(resultPage(returned, coverageReturned)) <= PROJECT_RESPONSE_LIMITS.semanticQueryBytes;
    if (!fits(0, 0)) {
        throw new GameStudioProjectError("RESPONSE_TOO_LARGE", "The semantic dependency response envelope exceeds the 32 KiB limit");
    }
    if (referenceLimit > 0 && !fits(1, 0)) {
        throw new GameStudioProjectError("RESPONSE_TOO_LARGE", "One semantic dependency cannot fit the 32 KiB response limit; narrow the authored resource or its metadata");
    }
    if (coverageLimit > 0 && !fits(0, 1)) {
        const kind = coverageOffset < coverage.limitations.length ? "semantic coverage limitation" : "reviewed custom-event evidence record";
        throw new GameStudioProjectError("RESPONSE_TOO_LARGE", `One ${kind} cannot fit the 32 KiB response limit`);
    }
    let returned = 0;
    let coverageReturned = 0;
    // Each cursor advances its own stream. Explicit coverage requests prioritize
    // diagnostic progress when a reference and a diagnostic cannot fit together.
    const streams = query.coverageCursor === undefined ? ["references", "coverage"] : ["coverage", "references"];
    for (const stream of streams) {
        if (stream === "references") {
            while (returned < referenceLimit && fits(returned + 1, coverageReturned))
                returned += 1;
        }
        else {
            while (coverageReturned < coverageLimit && fits(returned, coverageReturned + 1))
                coverageReturned += 1;
        }
    }
    return resultPage(returned, coverageReturned);
}
//# sourceMappingURL=world-queries.js.map