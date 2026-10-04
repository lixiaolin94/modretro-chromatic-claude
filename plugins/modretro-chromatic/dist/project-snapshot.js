import { createHash } from "node:crypto";
import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { PROJECT_REVISION_ALGORITHM, } from "./project-access.js";
import { discoverProject, GameStudioProjectError, inventoryProject, } from "./project.js";
import { ProjectRevisionTree } from "./project-revision.js";
const RESOURCE_ORDER = [
    "scene", "actor", "trigger", "palette", "asset", "variable", "diagnostic",
];
const RESOURCE_KINDS = new Set(RESOURCE_ORDER);
const MAXIMUM_PAGE_BYTES = 32 * 1024;
const MAXIMUM_LEGACY_BYTES = 512 * 1024;
const MAXIMUM_QUERY_LENGTH = 128;
const INSPECTION_MAXIMUM_BYTES = 4 * 1024;
const ALLOWED_FIELDS = new Set([
    "id", "name", "resourcePath", "sceneId", "type", "width", "height", "x", "y",
    "backgroundId", "spriteSheetId", "actorIds", "triggerIds", "filename",
    "metadataPath", "hasMetadata", "colors", "symbol", "code", "severity", "message",
    "paletteIds", "spritePaletteIds", "defaultPlayerSprites", "startSceneId",
    "startX", "startY", "colorMode", "defaultSceneTypeId", "defaultFontId", "compilerPreset",
]);
const INSPECTION_SETTINGS = [
    "colorMode", "startSceneId", "startX", "startY", "defaultSceneTypeId",
    "defaultFontId", "defaultPlayerSprites", "compilerPreset",
];
class FrozenMap {
    #entries;
    constructor(entries) {
        this.#entries = new Map(entries);
        Object.freeze(this);
    }
    get size() {
        return this.#entries.size;
    }
    get(key) {
        return this.#entries.get(key);
    }
    has(key) {
        return this.#entries.has(key);
    }
    entries() {
        return this.#entries.entries();
    }
    keys() {
        return this.#entries.keys();
    }
    values() {
        return this.#entries.values();
    }
    [Symbol.iterator]() {
        return this.#entries[Symbol.iterator]();
    }
    forEach(callbackfn, thisArg) {
        this.#entries.forEach((value, key) => callbackfn.call(thisArg, value, key, this));
    }
}
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function withinProject(root, candidate) {
    const relative = path.relative(root, candidate);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new GameStudioProjectError("PATH_OUTSIDE_PROJECT", `Refusing to access a path outside the native game project: ${candidate}`, candidate);
    }
}
function systemError(error, code) {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function deepFreeze(value) {
    if (typeof value !== "object" || value === null || Object.isFrozen(value))
        return value;
    for (const child of Object.values(value))
        deepFreeze(child);
    return Object.freeze(value);
}
function mapResources(resources) {
    return new FrozenMap(resources.filter((resource) => resource.id).map((resource) => [resource.id, resource]));
}
async function authoredFiles(root, directory) {
    let canonical;
    try {
        canonical = await realpath(directory);
    }
    catch (error) {
        if (systemError(error, "ENOENT"))
            return [];
        throw error;
    }
    withinProject(root, canonical);
    const entries = await readdir(canonical, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    const files = [];
    for (const entry of entries) {
        const candidate = path.join(canonical, entry.name);
        if (entry.isSymbolicLink()) {
            let destination;
            try {
                destination = await realpath(candidate);
            }
            catch {
                throw new GameStudioProjectError("UNSAFE_SYMLINK", `Project contains an unreadable symbolic link: ${candidate}`, candidate);
            }
            withinProject(root, destination);
            continue;
        }
        if (entry.isDirectory())
            files.push(...await authoredFiles(root, candidate));
        else if (entry.isFile())
            files.push(candidate);
    }
    return files;
}
async function discoveryRevision(discovery, exclude = new Set()) {
    const root = await realpath(discovery.projectRoot);
    if (root !== discovery.projectRoot) {
        throw new GameStudioProjectError("STALE_PROJECT", "The selected native game project root changed during collection", root);
    }
    const descriptor = await realpath(discovery.projectPath);
    withinProject(root, descriptor);
    if (descriptor !== discovery.projectPath) {
        throw new GameStudioProjectError("STALE_PROJECT", "The selected project descriptor changed during collection", descriptor);
    }
    const files = [
        descriptor,
        ...await authoredFiles(root, path.join(root, "project")),
        ...await authoredFiles(root, path.join(root, "assets")),
    ];
    const entries = [];
    for (const file of files) {
        const canonical = await realpath(file);
        withinProject(root, canonical);
        if (canonical !== file) {
            throw new GameStudioProjectError("STALE_PROJECT", "An authored project resource changed during collection", file);
        }
        const relative = path.relative(root, file).split(path.sep).join("/");
        if (exclude.has(relative))
            continue;
        const content = await readFile(file);
        entries.push({
            relativePath: relative,
            sha256: createHash("sha256").update(content).digest("hex"),
        });
    }
    return new ProjectRevisionTree(entries).revision();
}
function assertMatchingAccess(projectPath, access) {
    const requestedPath = path.resolve(projectPath);
    if (requestedPath !== access.projectPath && requestedPath !== access.projectRoot) {
        throw new GameStudioProjectError("STALE_PROJECT", "Indexed project access does not belong to the requested native game project", requestedPath);
    }
    if (access.revisionAlgorithm !== PROJECT_REVISION_ALGORITHM) {
        throw new GameStudioProjectError("STALE_PROJECT", "Indexed project access uses an obsolete project revision algorithm");
    }
}
export async function projectRevision(projectPath, access) {
    if (access) {
        assertMatchingAccess(projectPath, access);
        await access.ensureFresh();
        return access.revision;
    }
    return discoveryRevision(await discoverProject(projectPath));
}
/** Internal create-only transaction check: remove only its new outputs from the
 * current census to prove that the preexisting authored project stayed unchanged. */
export async function projectRevisionBeforeAdditions(projectPath, additions) {
    return discoveryRevision(await discoverProject(projectPath), new Set(additions));
}
async function projectVariables(inventory) {
    let entries;
    let resourcePath;
    if (inventory.format === "legacy") {
        entries = inventory.descriptor.variables;
        resourcePath = path.basename(inventory.projectPath);
    }
    else {
        const filename = path.join(inventory.projectRoot, "project", "variables.gbsres");
        let canonical;
        try {
            canonical = await realpath(filename);
        }
        catch (error) {
            if (systemError(error, "ENOENT"))
                return [];
            throw error;
        }
        withinProject(inventory.projectRoot, canonical);
        let parsed;
        try {
            parsed = JSON.parse(await readFile(canonical, "utf8"));
        }
        catch (error) {
            throw new GameStudioProjectError("INVALID_RESOURCE", `Could not parse project variables: ${error instanceof Error ? error.message : String(error)}`, canonical);
        }
        if (!isObject(parsed)) {
            throw new GameStudioProjectError("INVALID_RESOURCE", "project variables resource must contain a JSON object", canonical);
        }
        entries = parsed.variables;
        resourcePath = "project/variables.gbsres";
    }
    return (Array.isArray(entries) ? entries : [])
        .filter(isObject)
        .map((resource) => ({
        ...resource,
        id: typeof resource.id === "string" ? resource.id : "",
        name: typeof resource.name === "string" ? resource.name : "",
        resourcePath,
    }));
}
function projectHealth(diagnostics) {
    const byCode = {};
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    for (const diagnostic of diagnostics) {
        byCode[diagnostic.code] = (byCode[diagnostic.code] ?? 0) + 1;
        if (diagnostic.severity === "error")
            errorCount += 1;
        else if (diagnostic.severity === "warning")
            warningCount += 1;
        else
            infoCount += 1;
    }
    return { errorCount, warningCount, infoCount, byCode };
}
export async function loadProjectSnapshot(projectPath, options = {}, access) {
    const attempts = options.maxAttempts ?? 3;
    if (!Number.isSafeInteger(attempts) || attempts < 1 || attempts > 10) {
        throw new GameStudioProjectError("INVALID_INPUT", "Snapshot maxAttempts must be an integer between 1 and 10");
    }
    const generation = options.selectionGeneration ?? 0;
    if (!Number.isSafeInteger(generation) || generation < 0) {
        throw new GameStudioProjectError("INVALID_INPUT", "Snapshot selectionGeneration must be a non-negative integer");
    }
    if (access) {
        assertMatchingAccess(projectPath, access);
        if (options.selectionGeneration !== undefined && generation !== access.selectionGeneration) {
            throw new GameStudioProjectError("STALE_PROJECT", "Indexed project access belongs to a different project selection");
        }
        await access.ensureFresh();
        return access.snapshot();
    }
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        const discovery = await discoverProject(projectPath);
        let before;
        let inventory;
        let variables;
        let after;
        try {
            before = await discoveryRevision(discovery);
            inventory = await inventoryProject(discovery.projectPath);
            variables = await projectVariables(inventory);
            after = await discoveryRevision(discovery);
        }
        catch (error) {
            if ((systemError(error, "ENOENT") || (error instanceof GameStudioProjectError && error.code === "STALE_PROJECT")) && attempt + 1 < attempts) {
                continue;
            }
            throw error;
        }
        if (before !== after)
            continue;
        deepFreeze(inventory);
        deepFreeze(variables);
        const counts = { ...inventory.counts, variables: variables.length };
        const health = projectHealth(inventory.diagnostics);
        return Object.freeze({
            projectPath: inventory.projectPath,
            projectRoot: inventory.projectRoot,
            revision: after,
            revisionAlgorithm: PROJECT_REVISION_ALGORITHM,
            selectionGeneration: generation,
            descriptor: inventory.descriptor,
            settings: inventory.settings,
            scenesById: mapResources(inventory.scenes),
            actorsById: mapResources(inventory.actors),
            triggersById: mapResources(inventory.triggers),
            assetsById: mapResources(inventory.assets),
            palettesById: mapResources(inventory.palettes),
            variablesById: mapResources(variables),
            diagnostics: inventory.diagnostics,
            counts: deepFreeze(counts),
            health: deepFreeze(health),
            inventory,
        });
    }
    throw new GameStudioProjectError("STALE_PROJECT", "Native game project resources kept changing while collecting a consistent snapshot", projectPath);
}
function compactSettings(settings) {
    const result = {};
    for (const key of INSPECTION_SETTINGS) {
        const value = settings[key];
        if (value !== undefined)
            result[key] = value;
    }
    return result;
}
export function inspectProjectSnapshot(snapshot, options = {}) {
    const limit = options.diagnosticLimit ?? 5;
    if (!Number.isSafeInteger(limit) || limit < 0 || limit > 50) {
        throw new GameStudioProjectError("INVALID_INPUT", "Diagnostic limit must be an integer between 0 and 50");
    }
    const result = {
        projectPath: snapshot.projectPath,
        projectRoot: snapshot.projectRoot,
        name: snapshot.inventory.name,
        author: snapshot.inventory.author,
        format: snapshot.inventory.format,
        version: snapshot.inventory.version,
        revision: snapshot.revision,
        revisionAlgorithm: snapshot.revisionAlgorithm,
        settings: compactSettings(snapshot.settings),
        counts: { ...snapshot.counts },
        health: { ...snapshot.health, byCode: { ...snapshot.health.byCode } },
        diagnostics: snapshot.diagnostics.slice(0, limit),
        diagnosticCount: snapshot.diagnostics.length,
        diagnosticsTruncated: snapshot.diagnostics.length > limit,
    };
    while (Buffer.byteLength(JSON.stringify(result)) > INSPECTION_MAXIMUM_BYTES && result.diagnostics.length > 0) {
        result.diagnostics = result.diagnostics.slice(0, -1);
        result.diagnosticsTruncated = true;
    }
    if (Buffer.byteLength(JSON.stringify(result)) > INSPECTION_MAXIMUM_BYTES) {
        throw new GameStudioProjectError("PROJECT_INSPECTION_TOO_LARGE", "Compact project inspection exceeds the 4 KiB response limit");
    }
    return result;
}
function sortRecords(left, right) {
    return RESOURCE_ORDER.indexOf(left.kind) - RESOURCE_ORDER.indexOf(right.kind)
        || left.resourcePath.localeCompare(right.resourcePath)
        || left.id.localeCompare(right.id);
}
function normalizedQuery(options) {
    return options.query?.toLowerCase();
}
function cursorFilter(options) {
    const query = normalizedQuery(options);
    const filters = {
        sceneId: options.sceneId ?? null,
        resourceTypes: [...(options.resourceTypes ?? [])].sort(),
        assetTypes: [...(options.assetTypes ?? [])].sort(),
        detail: options.detail ?? "standard",
        fields: [...(options.fields ?? [])].sort(),
        includeSettings: options.includeSettings ?? false,
        includeReferencedResources: options.includeReferencedResources ?? false,
        layout: options.layout ?? "normalized",
        ...(query === undefined ? {} : { query }),
    };
    return createHash("sha256").update(JSON.stringify(filters)).digest("base64url").slice(0, 16);
}
function parseCursor(snapshot, options) {
    if (!options.cursor)
        return 0;
    let payload;
    try {
        payload = JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8"));
    }
    catch {
        throw new GameStudioProjectError("INVALID_CURSOR", "Project inventory cursor is not a valid opaque cursor");
    }
    if (!isObject(payload) || typeof payload.revision !== "string" || typeof payload.filter !== "string"
        || (payload.revisionAlgorithm !== undefined && typeof payload.revisionAlgorithm !== "string")
        || !Number.isSafeInteger(payload.generation) || !Number.isSafeInteger(payload.offset)
        || typeof payload.offset !== "number" || payload.offset < 0) {
        throw new GameStudioProjectError("INVALID_CURSOR", "Project inventory cursor is malformed");
    }
    if (payload.revisionAlgorithm !== snapshot.revisionAlgorithm || payload.revision !== snapshot.revision
        || payload.generation !== snapshot.selectionGeneration || payload.filter !== cursorFilter(options)) {
        throw new GameStudioProjectError("STALE_CURSOR", "Project inventory cursor no longer matches the selected project, revision, or filters");
    }
    return payload.offset;
}
function nextCursor(snapshot, options, offset) {
    const cursor = {
        revision: snapshot.revision,
        revisionAlgorithm: snapshot.revisionAlgorithm,
        generation: snapshot.selectionGeneration,
        filter: cursorFilter(options),
        offset,
    };
    return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}
function validateOptions(options) {
    const limit = options.limit ?? 50;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 250) {
        throw new GameStudioProjectError("INVALID_INPUT", "Project inventory limit must be an integer between 1 and 250");
    }
    if (options.detail && !["summary", "standard", "full"].includes(options.detail)) {
        throw new GameStudioProjectError("INVALID_INPUT", "Project inventory detail must be summary, standard, or full");
    }
    if (options.layout && !["normalized", "legacy"].includes(options.layout)) {
        throw new GameStudioProjectError("INVALID_INPUT", "Project inventory layout must be normalized or legacy");
    }
    if (options.query !== undefined && (typeof options.query !== "string" || options.query.trim().length === 0
        || options.query.length > MAXIMUM_QUERY_LENGTH)) {
        throw new GameStudioProjectError("INVALID_INPUT", `Project inventory query must be a nonblank string of at most ${MAXIMUM_QUERY_LENGTH} characters`);
    }
    for (const kind of options.resourceTypes ?? []) {
        if (!RESOURCE_KINDS.has(kind)) {
            throw new GameStudioProjectError("INVALID_INPUT", `Unsupported project inventory resource type: ${kind}`);
        }
    }
    for (const field of options.fields ?? []) {
        if (!ALLOWED_FIELDS.has(field)) {
            throw new GameStudioProjectError("INVALID_INPUT", `Unsupported project inventory field: ${field}`);
        }
    }
    return limit;
}
function selectFields(result, resource, options) {
    if (!options.fields?.length)
        return result;
    const selected = {};
    for (const required of ["id", "sceneId"]) {
        if (result[required] !== undefined)
            selected[required] = result[required];
    }
    for (const field of options.fields) {
        const value = result[field] ?? resource[field];
        if (value !== undefined)
            selected[field] = value;
    }
    return selected;
}
function projectRecord(kind, resource, options, sceneId) {
    if (options.detail === "full") {
        const full = { ...resource };
        if (sceneId)
            full.sceneId = sceneId;
        if (kind === "scene") {
            delete full.actors;
            delete full.triggers;
            const scene = resource;
            full.actorIds = scene.actors.map((actor) => actor.id);
            full.triggerIds = scene.triggers.map((trigger) => trigger.id);
        }
        return selectFields(full, resource, options);
    }
    const summary = { id: resource.id, name: resource.name };
    if (sceneId)
        summary.sceneId = sceneId;
    if (kind === "asset")
        summary.type = resource.type;
    if (options.detail === "summary")
        return selectFields(summary, resource, options);
    if (kind === "scene") {
        const scene = resource;
        summary.type = scene.type;
        summary.width = scene.width;
        summary.height = scene.height;
        summary.backgroundId = scene.backgroundId;
        summary.actorIds = scene.actors.map((actor) => actor.id);
        summary.triggerIds = scene.triggers.map((trigger) => trigger.id);
    }
    else if (kind === "actor") {
        if (resource.x !== undefined)
            summary.x = resource.x;
        if (resource.y !== undefined)
            summary.y = resource.y;
        if (resource.spriteSheetId !== undefined)
            summary.spriteSheetId = resource.spriteSheetId;
    }
    else if (kind === "trigger") {
        for (const field of ["x", "y", "width", "height"]) {
            if (resource[field] !== undefined)
                summary[field] = resource[field];
        }
    }
    else if (kind === "palette") {
        if (resource.colors !== undefined)
            summary.colors = resource.colors;
    }
    else if (kind === "asset") {
        const asset = resource;
        summary.filename = asset.filename;
        summary.width = asset.width;
        summary.height = asset.height;
        summary.hasMetadata = asset.hasMetadata;
    }
    else if (kind === "variable" && resource.symbol !== undefined) {
        summary.symbol = resource.symbol;
    }
    summary.resourcePath = resource.resourcePath;
    return selectFields(summary, resource, options);
}
function referencedIds(scene) {
    const assets = new Set();
    const palettes = new Set();
    if (typeof scene.backgroundId === "string" && scene.backgroundId)
        assets.add(scene.backgroundId);
    for (const actor of scene.actors) {
        if (typeof actor.spriteSheetId === "string" && actor.spriteSheetId)
            assets.add(actor.spriteSheetId);
    }
    for (const field of ["paletteIds", "spritePaletteIds"]) {
        for (const value of Array.isArray(scene[field]) ? scene[field] : []) {
            if (typeof value === "string")
                palettes.add(value);
        }
    }
    return { assets, palettes };
}
function inventoryRecords(snapshot, options) {
    const scene = options.sceneId ? snapshot.scenesById.get(options.sceneId) : undefined;
    if (options.sceneId && !scene) {
        throw new GameStudioProjectError("SCENE_NOT_FOUND", `No scene with id ${options.sceneId} exists in this project`);
    }
    const selectedKinds = new Set(options.resourceTypes?.length
        ? options.resourceTypes
        : options.sceneId
            ? ["scene", "actor", "trigger", ...(options.includeReferencedResources ? ["asset", "palette"] : [])]
            : RESOURCE_ORDER);
    const referenced = scene ? referencedIds(scene) : undefined;
    const query = normalizedQuery(options);
    const records = [];
    const add = (kind, resource, owner) => {
        if (!selectedKinds.has(kind))
            return;
        if (query !== undefined && !resource.name.toLowerCase().includes(query) && !resource.id.toLowerCase().includes(query)
            && !(kind === "asset" && resource.filename.toLowerCase().includes(query)))
            return;
        records.push({
            kind,
            resourcePath: resource.resourcePath,
            id: resource.id,
            resource: projectRecord(kind, resource, options, owner),
        });
    };
    for (const candidate of snapshot.inventory.scenes) {
        if (scene && candidate.id !== scene.id)
            continue;
        add("scene", candidate);
        for (const actor of candidate.actors)
            add("actor", actor, candidate.id);
        for (const trigger of candidate.triggers)
            add("trigger", trigger, candidate.id);
    }
    for (const palette of snapshot.inventory.palettes) {
        if (scene && !referenced?.palettes.has(palette.id))
            continue;
        add("palette", palette);
    }
    for (const asset of snapshot.inventory.assets) {
        if (scene && !referenced?.assets.has(asset.id))
            continue;
        if (options.assetTypes?.length && !options.assetTypes.includes(asset.type))
            continue;
        add("asset", asset);
    }
    for (const variable of snapshot.variablesById.values())
        add("variable", variable);
    if (selectedKinds.has("diagnostic") && query === undefined) {
        for (let index = 0; index < snapshot.diagnostics.length; index += 1) {
            const diagnostic = snapshot.diagnostics[index];
            if (!diagnostic)
                continue;
            if (scene && diagnostic.resourcePath && !diagnostic.resourcePath.startsWith(path.dirname(scene.resourcePath)))
                continue;
            records.push({
                kind: "diagnostic",
                resourcePath: diagnostic.resourcePath ?? "",
                id: `${diagnostic.code}:${index}`,
                resource: diagnostic,
            });
        }
    }
    records.sort(sortRecords);
    return records;
}
function recordArray(result, kind) {
    switch (kind) {
        case "scene": return result.scenes;
        case "actor": return result.actors;
        case "trigger": return result.triggers;
        case "palette": return result.palettes;
        case "asset": return result.assets;
        case "variable": return result.variables;
        case "diagnostic": return result.diagnostics;
    }
}
export function inventoryProjectSnapshot(snapshot, options = {}) {
    const limit = validateOptions(options);
    if (options.layout === "legacy") {
        if (options.detail !== "full") {
            throw new GameStudioProjectError("INVALID_INPUT", "Legacy project inventory requires explicitly setting detail to full");
        }
        if (options.cursor || options.sceneId || options.resourceTypes?.length || options.assetTypes?.length || options.fields?.length
            || options.query !== undefined) {
            throw new GameStudioProjectError("INVALID_INPUT", "Legacy full project inventory does not support normalized filters or cursors");
        }
        if (Buffer.byteLength(JSON.stringify(snapshot.inventory)) > MAXIMUM_LEGACY_BYTES) {
            throw new GameStudioProjectError("INVENTORY_PAGE_TOO_LARGE", "Legacy full project inventory exceeds the 512 KiB compatibility limit");
        }
        return snapshot.inventory;
    }
    const offset = parseCursor(snapshot, options);
    const records = inventoryRecords(snapshot, options);
    if (offset > records.length) {
        throw new GameStudioProjectError("INVALID_CURSOR", "Project inventory cursor points beyond the available resources");
    }
    const result = {
        projectPath: snapshot.projectPath,
        projectRoot: snapshot.projectRoot,
        name: snapshot.inventory.name,
        format: snapshot.inventory.format,
        version: snapshot.inventory.version,
        revision: snapshot.revision,
        revisionAlgorithm: snapshot.revisionAlgorithm,
        counts: snapshot.counts,
        health: snapshot.health,
        ...(options.includeSettings ? { settings: compactSettings(snapshot.settings) } : {}),
        scenes: [],
        actors: [],
        triggers: [],
        palettes: [],
        assets: [],
        variables: [],
        diagnostics: [],
        total: records.length,
        returned: 0,
        nextCursor: null,
    };
    for (const record of records.slice(offset, offset + limit)) {
        const destination = recordArray(result, record.kind);
        destination.push(record.resource);
        result.returned += 1;
        const followingOffset = offset + result.returned;
        result.nextCursor = followingOffset < records.length ? nextCursor(snapshot, options, followingOffset) : null;
        if (Buffer.byteLength(JSON.stringify(result)) > MAXIMUM_PAGE_BYTES) {
            destination.pop();
            result.returned -= 1;
            if (result.returned === 0) {
                throw new GameStudioProjectError("INVENTORY_PAGE_TOO_LARGE", "One project resource exceeds the 32 KiB normalized page limit; request summary detail or specific fields");
            }
            result.nextCursor = nextCursor(snapshot, options, offset + result.returned);
            break;
        }
    }
    return result;
}
export async function inventoryProjectNormalized(projectPath, options = {}, selectionGeneration = 0, access) {
    if (access) {
        assertMatchingAccess(projectPath, access);
        if (selectionGeneration !== 0 && selectionGeneration !== access.selectionGeneration) {
            throw new GameStudioProjectError("STALE_PROJECT", "Indexed project access belongs to a different project selection");
        }
        await access.ensureFresh();
        if (options.layout !== "legacy")
            return access.normalizedInventory(options);
        validateOptions(options);
        if (options.detail !== "full") {
            throw new GameStudioProjectError("INVALID_INPUT", "Legacy project inventory requires explicitly setting detail to full");
        }
        if (options.cursor || options.sceneId || options.resourceTypes?.length || options.assetTypes?.length || options.fields?.length
            || options.query !== undefined) {
            throw new GameStudioProjectError("INVALID_INPUT", "Legacy full project inventory does not support normalized filters or cursors");
        }
        const inventory = await access.legacyInventory();
        if (Buffer.byteLength(JSON.stringify(inventory)) > MAXIMUM_LEGACY_BYTES) {
            throw new GameStudioProjectError("INVENTORY_PAGE_TOO_LARGE", "Legacy full project inventory exceeds the 512 KiB compatibility limit");
        }
        return inventory;
    }
    const snapshot = await loadProjectSnapshot(projectPath, { selectionGeneration });
    return inventoryProjectSnapshot(snapshot, options);
}
//# sourceMappingURL=project-snapshot.js.map