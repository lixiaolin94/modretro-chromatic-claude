import { createHash } from "node:crypto";
import { watch } from "node:fs";
import { lstat, readdir, readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { PROJECT_REVISION_ALGORITHM, } from "./project-access.js";
import { isPathWithinRoot } from "./platform.js";
import { assertWithinProject, projectRelativePath } from "./project-files.js";
import { ProjectRevisionTree, isPublicProjectRevisionPath } from "./project-revision.js";
import { inspectProjectSnapshot, inventoryProjectSnapshot, } from "./project-snapshot.js";
import { discoverProject, GameStudioProjectError, } from "./project.js";
import { decodeResourceBytes, ResourceCodecError } from "./resource-codec.js";
import { buildWorldScriptGraph } from "./world-script-graph.js";
import { observeReviewedCompiler } from "./reviewed-compiler.js";
import { REVIEWED_CUSTOM_EVENTS } from "./custom-event-dependencies.js";
import { legacyPhysicalAssetMetadataLookup, legacyPluginAssetCandidates } from "./legacy-project-assets.js";
const ASSET_EXTENSIONS = new Set([".png", ".wav", ".uge", ".mod", ".vgm", ".vgz"]);
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAXIMUM_DIRTY_PATHS = 2_048;
const EMPTY_COVERAGE = { complete: true, limitations: [] };
class FrozenResourceMap {
    #entries;
    constructor(entries) {
        this.#entries = new Map(entries);
        Object.freeze(this);
    }
    get size() { return this.#entries.size; }
    get(key) { return this.#entries.get(key); }
    has(key) { return this.#entries.has(key); }
    entries() { return this.#entries.entries(); }
    keys() { return this.#entries.keys(); }
    values() { return this.#entries.values(); }
    [Symbol.iterator]() { return this.#entries[Symbol.iterator](); }
    forEach(callback, receiver) {
        this.#entries.forEach((value, key) => callback.call(receiver, value, key, this));
    }
}
function deepFreeze(value) {
    if (typeof value !== "object" || value === null || Object.isFrozen(value))
        return value;
    for (const child of Object.values(value))
        deepFreeze(child);
    return Object.freeze(value);
}
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
}
function asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function systemError(error, code) {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function category(relativePath, descriptorPath) {
    if (relativePath === descriptorPath)
        return "descriptor";
    if (relativePath === "project/settings.gbsres")
        return "settings";
    if (relativePath === "project/variables.gbsres")
        return "variables";
    if (relativePath.startsWith("plugins/"))
        return relativePath.endsWith(".js") ? "plugin-event" : "plugin-resource";
    if (relativePath.startsWith("assets/"))
        return relativePath.endsWith(".gbsres") ? "asset-metadata" : "asset";
    if (relativePath.startsWith("project/prefabs/actors/"))
        return "actor-prefab";
    if (relativePath.startsWith("project/prefabs/triggers/"))
        return "trigger-prefab";
    if (relativePath.startsWith("project/scripts/"))
        return "script";
    if (relativePath.startsWith("project/palettes/") && relativePath.endsWith(".gbsres"))
        return "palette";
    if (relativePath.endsWith("/scene.gbsres"))
        return "scene";
    if (relativePath.includes("/actors/") && relativePath.endsWith(".gbsres"))
        return "actor";
    if (relativePath.includes("/triggers/") && relativePath.endsWith(".gbsres"))
        return "trigger";
    return "other";
}
function assetType(folder, metadata) {
    if (typeof metadata?._resourceType === "string")
        return metadata._resourceType;
    const names = {
        backgrounds: "background", sprites: "sprite", avatars: "avatar", emotes: "emote",
        fonts: "font", tilesets: "tileset", music: "music", sounds: "sound",
    };
    return names[folder] ?? folder;
}
function isLegacyImagePath(relative) {
    return /^(?:assets\/(?:backgrounds|sprites)|plugins\/[^/]+\/(?:backgrounds|sprites))\/.+\.png$/iu.test(relative);
}
function isPhysicalPng(file) {
    return file.pngHeader !== undefined && file.pngHeader.width > 0 && file.pngHeader.height > 0;
}
function materialize(resource, resourcePath) {
    return { ...resource, id: asString(resource.id), name: asString(resource.name), resourcePath };
}
function health(diagnostics) {
    const byCode = {};
    let errorCount = 0;
    let warningCount = 0;
    let infoCount = 0;
    for (const item of diagnostics) {
        byCode[item.code] = (byCode[item.code] ?? 0) + 1;
        if (item.severity === "error")
            errorCount += 1;
        else if (item.severity === "warning")
            warningCount += 1;
        else
            infoCount += 1;
    }
    return { errorCount, warningCount, infoCount, byCode };
}
function graphKey(identity) {
    return `${identity.type}\u0000${identity.id}`;
}
/** One selected project's in-memory, incremental authored-resource census. */
export class ProjectWorldIndex {
    projectPath;
    projectRoot;
    selectionGeneration;
    revisionAlgorithm = PROJECT_REVISION_ALGORITHM;
    indexGeneration = 0;
    semanticGeneration = 0;
    revision = "";
    coverage = EMPTY_COVERAGE;
    #requestedPath;
    #watcherFactory;
    #platform;
    #reviewedCustomEvents;
    #toolchainRoot;
    #compilerObservation;
    #compilerRefresh;
    #files = new Map();
    #windowsPaths = new Map();
    #dirty = new Set();
    #actors = new Map();
    #triggers = new Map();
    #sceneIdsByResource = new Map();
    #incoming = new Map();
    #outgoing = new Map();
    #structural = new Map();
    #assetsById = new Map();
    #assetsByPath = new Map();
    #palettesById = new Map();
    #kind = new Map();
    #state = "initializing";
    #watcher;
    #bootstrap;
    #refresh;
    #degraded = false;
    #watchUnavailable = false;
    #watchUnsupported = false;
    #inAuthoritativeRebuild = false;
    #discovery;
    #inventory;
    #snapshot;
    #detachedSnapshot;
    #graph;
    #tree = new ProjectRevisionTree();
    #counters = {
        fullInventoryBuilds: 0, fullHashPasses: 0, authoredFileReads: 0,
        authoredBytesRead: 0, directoryReads: 0, resourceParses: 0,
        cacheHits: 0, dirtyEvents: 0, changedPaths: 0, fallbackFullRebuilds: 0,
    };
    constructor(projectPath, selectionGeneration = 0, options = {}) {
        this.#requestedPath = path.resolve(projectPath);
        this.#watcherFactory = options.watcherFactory ?? watch;
        this.#platform = options.platform ?? process.platform;
        this.#reviewedCustomEvents = options.reviewedCustomEvents ?? REVIEWED_CUSTOM_EVENTS;
        this.#toolchainRoot = options.toolchainRoot;
        this.projectPath = this.#requestedPath;
        this.projectRoot = this.#requestedPath.toLowerCase().endsWith(".gbsproj")
            ? path.dirname(this.#requestedPath) : this.#requestedPath;
        this.selectionGeneration = selectionGeneration;
    }
    async ensureFresh() {
        if (this.#state === "disposed")
            throw new GameStudioProjectError("STALE_PROJECT", "The selected project index was disposed");
        if (!this.#bootstrap) {
            this.#bootstrap = this.#initialize().catch((error) => {
                this.#bootstrap = undefined;
                this.#watcher?.close();
                this.#watcher = undefined;
                throw error;
            });
        }
        await this.#bootstrap;
        if (this.#degraded || this.#state === "invalidated") {
            await this.strongRefresh();
        }
        else if (this.#dirty.size > 0) {
            await this.#refreshDirty();
        }
        else {
            this.#counters.cacheHits += 1;
            await this.#refreshCompiler();
        }
    }
    async strongRefresh() {
        if (!this.#bootstrap) {
            await this.ensureFresh();
            return;
        }
        await this.#bootstrap;
        if (this.#refresh) {
            await this.#refresh;
            return;
        }
        const pending = this.#rebuild(true);
        this.#refresh = pending;
        try {
            await pending;
        }
        catch (error) {
            this.invalidate("The authoritative authored refresh failed");
            throw error;
        }
        finally {
            this.#refresh = undefined;
        }
    }
    projectInspection() {
        this.#hit();
        return inspectProjectSnapshot(this.#requiredSnapshot());
    }
    normalizedInventory(options = {}) {
        this.#hit();
        const snapshot = this.#requiredSnapshot();
        let selected = snapshot;
        if (options.sceneId && options.layout !== "legacy") {
            const scene = snapshot.scenesById.get(options.sceneId);
            if (!scene)
                throw new GameStudioProjectError("SCENE_NOT_FOUND", `No scene with id ${options.sceneId} exists in this project`);
            const selectedKinds = new Set(options.resourceTypes ?? []);
            const referencedAssetIds = new Set();
            const referencedPaletteIds = new Set();
            if (typeof scene.backgroundId === "string")
                referencedAssetIds.add(scene.backgroundId);
            for (const actor of scene.actors) {
                if (typeof actor.spriteSheetId === "string")
                    referencedAssetIds.add(actor.spriteSheetId);
            }
            for (const field of ["paletteIds", "spritePaletteIds"]) {
                for (const value of Array.isArray(scene[field]) ? scene[field] : []) {
                    if (typeof value === "string")
                        referencedPaletteIds.add(value);
                }
            }
            const palettes = [...referencedPaletteIds].flatMap((id) => this.#palettesById.get(id) ?? []);
            const assets = [...referencedAssetIds].flatMap((id) => this.#assetsById.get(id) ?? []);
            const wantsVariables = selectedKinds.has("variable");
            const wantsDiagnostics = selectedKinds.has("diagnostic");
            const prefix = path.posix.dirname(scene.resourcePath);
            const diagnostics = wantsDiagnostics
                ? snapshot.diagnostics.filter((item) => !item.resourcePath || item.resourcePath.startsWith(prefix))
                : [];
            selected = {
                ...snapshot,
                variablesById: wantsVariables ? snapshot.variablesById : new Map(),
                diagnostics,
                inventory: { ...snapshot.inventory, scenes: [scene], actors: scene.actors,
                    triggers: scene.triggers, palettes, assets, diagnostics },
            };
        }
        const result = inventoryProjectSnapshot(selected, options);
        if (!("revision" in result)) {
            throw new GameStudioProjectError("INVALID_INPUT", "Use explicit legacyInventory for full legacy layout");
        }
        return result;
    }
    async snapshot() {
        this.#hit();
        if (this.#detachedSnapshot?.revision === this.revision)
            return this.#detachedSnapshot;
        const current = this.#requiredSnapshot();
        const inventory = structuredClone(current.inventory);
        deepFreeze(inventory);
        const variables = structuredClone([...current.variablesById.values()]);
        deepFreeze(variables);
        const frozenMap = (entries) => new FrozenResourceMap(entries.filter((resource) => resource.id).map((resource) => [resource.id, resource]));
        const snapshot = {
            projectPath: current.projectPath, projectRoot: current.projectRoot,
            revision: current.revision, revisionAlgorithm: current.revisionAlgorithm,
            selectionGeneration: current.selectionGeneration,
            descriptor: inventory.descriptor, settings: inventory.settings,
            scenesById: frozenMap(inventory.scenes), actorsById: frozenMap(inventory.actors),
            triggersById: frozenMap(inventory.triggers), assetsById: frozenMap(inventory.assets),
            palettesById: frozenMap(inventory.palettes), variablesById: frozenMap(variables),
            diagnostics: inventory.diagnostics,
            counts: deepFreeze({ ...current.counts }),
            health: deepFreeze({ ...current.health, byCode: { ...current.health.byCode } }),
            inventory,
        };
        this.#detachedSnapshot = Object.freeze(snapshot);
        return this.#detachedSnapshot;
    }
    async legacyInventory() {
        this.#hit();
        return this.#requiredInventory();
    }
    settings() {
        this.#hit();
        return this.#requiredInventory().settings;
    }
    authoredFile(relativePath) {
        this.#hit();
        return this.#files.get(this.#canonicalRelativePath(relativePath));
    }
    sceneForResource(resourcePath) {
        this.#hit();
        const sceneId = this.#sceneIdsByResource.get(resourcePath);
        return sceneId ? this.#requiredSnapshot().scenesById.get(sceneId) : undefined;
    }
    scene(sceneId) {
        this.#hit();
        return this.#requiredSnapshot().scenesById.get(sceneId);
    }
    actor(sceneId, actorId) {
        this.#hit();
        return this.#actors.get(`${sceneId}\u0000${actorId}`);
    }
    trigger(sceneId, triggerId) {
        this.#hit();
        return this.#triggers.get(`${sceneId}\u0000${triggerId}`);
    }
    asset(query) {
        this.#hit();
        let matches;
        if (query.assetId && query.assetPath) {
            matches = (this.#assetsById.get(query.assetId) ?? []).filter((item) => item.resourcePath === query.assetPath || item.metadataPath === query.assetPath || item.filename === query.assetPath);
        }
        else if (query.assetId)
            matches = this.#assetsById.get(query.assetId) ?? [];
        else if (query.assetPath)
            matches = this.#assetsByPath.get(query.assetPath) ?? [];
        else
            matches = [];
        const first = matches[0];
        if (matches.length === 1 && first)
            return { status: "unique", matches, asset: first };
        return matches.length === 0 ? { status: "missing", matches } : { status: "ambiguous", matches };
    }
    variable(variableId) {
        this.#hit();
        return this.#requiredSnapshot().variablesById.get(variableId);
    }
    palette(paletteId) {
        this.#hit();
        return this.#requiredSnapshot().palettesById.get(paletteId);
    }
    resource(identity) {
        this.#hit();
        const snapshot = this.#requiredSnapshot();
        switch (identity.type) {
            case "scene": return snapshot.scenesById.get(identity.id);
            case "actor": return identity.sceneId
                ? this.#actors.get(`${identity.sceneId}\u0000${identity.id}`) : snapshot.actorsById.get(identity.id);
            case "trigger": return identity.sceneId
                ? this.#triggers.get(`${identity.sceneId}\u0000${identity.id}`) : snapshot.triggersById.get(identity.id);
            case "asset": return snapshot.assetsById.get(identity.id);
            case "palette": return snapshot.palettesById.get(identity.id);
            case "variable": return snapshot.variablesById.get(identity.id);
            default: return undefined;
        }
    }
    resourcesByKind(kind) {
        this.#hit();
        return this.#kind.get(kind) ?? [];
    }
    resourcesByScene(sceneId) {
        this.#hit();
        const scene = this.#requiredSnapshot().scenesById.get(sceneId);
        return scene ? [scene, ...scene.actors, ...scene.triggers] : [];
    }
    assetUsers(assetId) {
        return this.effectiveReferences({ type: "asset", id: assetId });
    }
    effectiveReferences(target) {
        this.#hit();
        const refs = this.#incoming.get(graphKey(target)) ?? [];
        return target.sceneId ? refs.filter((item) => item.target.sceneId === target.sceneId) : refs;
    }
    effectiveOutgoingReferences(owner) {
        this.#hit();
        const refs = this.#outgoing.get(graphKey(owner)) ?? [];
        return owner.sceneId ? refs.filter((item) => item.owner.sceneId === owner.sceneId) : refs;
    }
    structuralReferences(target) {
        this.#hit();
        const refs = this.#structural.get(graphKey(target)) ?? [];
        return target.sceneId ? refs.filter((item) => item.target.sceneId === target.sceneId) : refs;
    }
    async noteCommittedPaths(paths) {
        await this.ensureFresh();
        for (const candidate of paths) {
            assertWithinProject(this.projectRoot, candidate, this.#platform);
            const platformCandidate = this.#platform === "win32"
                ? candidate.replace(/\\/g, path.sep)
                : candidate;
            const absolute = path.isAbsolute(platformCandidate)
                ? platformCandidate
                : path.join(this.projectRoot, platformCandidate);
            assertWithinProject(this.projectRoot, absolute, this.#platform);
            const relative = this.#canonicalRelativePath(projectRelativePath(this.projectRoot, absolute, this.#platform));
            if (this.#isObserved(relative))
                this.#dirty.add(relative);
        }
        if (this.#dirty.size > 0)
            await this.#refreshDirty();
    }
    invalidate(_reason) {
        if (this.#state !== "disposed") {
            this.#state = "invalidated";
            this.#degraded = true;
        }
    }
    stats() {
        return {
            state: this.#state,
            selectionGeneration: this.selectionGeneration,
            indexGeneration: this.indexGeneration,
            semanticGeneration: this.semanticGeneration,
            ...this.#counters,
        };
    }
    dispose() {
        this.#state = "disposed";
        this.#dirty.clear();
        this.#watcher?.close();
        this.#watcher = undefined;
    }
    #hit() {
        this.#counters.cacheHits += 1;
    }
    #requiredInventory() {
        if (!this.#inventory)
            throw new GameStudioProjectError("STALE_PROJECT", "The project world index has not been initialized");
        return this.#inventory;
    }
    #requiredSnapshot() {
        if (!this.#snapshot)
            throw new GameStudioProjectError("STALE_PROJECT", "The project world index has not been initialized");
        return this.#snapshot;
    }
    async #initialize() {
        let discovery = await discoverProject(this.#requestedPath);
        this.projectRoot = discovery.projectRoot;
        if (this.#platform === "win32") {
            const canonicalDescriptor = await realpath(discovery.projectPath);
            assertWithinProject(this.projectRoot, canonicalDescriptor, this.#platform);
            if (!this.#pathsMatch(canonicalDescriptor, discovery.projectPath)) {
                throw new GameStudioProjectError("STALE_PROJECT", "The selected native game project descriptor changed during collection", discovery.projectPath);
            }
            discovery = { ...discovery, projectPath: canonicalDescriptor };
        }
        this.#discovery = discovery;
        this.projectPath = discovery.projectPath;
        this.#startWatcher();
        await this.#rebuild(false);
        if (this.#dirty.size > 0)
            await this.#applyDirty([...this.#dirty]);
    }
    #startWatcher() {
        try {
            this.#watcher = this.#watcherFactory(this.projectRoot, { recursive: true, persistent: false }, (_event, filename) => {
                if (this.#state === "disposed")
                    return;
                if (!filename) {
                    this.#degraded = true;
                    this.#state = "invalidated";
                    return;
                }
                const relative = this.#canonicalRelativePath(filename.toString());
                if (!this.#isObserved(relative))
                    return;
                this.#counters.dirtyEvents += 1;
                this.#dirty.add(relative);
                if (this.#dirty.size > MAXIMUM_DIRTY_PATHS) {
                    this.#degraded = true;
                    this.#state = "invalidated";
                }
                else if (this.#state === "ready")
                    this.#state = "dirty";
            });
            this.#watcher.on("error", () => {
                if (this.#state !== "disposed") {
                    this.#watchUnavailable = true;
                    this.#degraded = true;
                    this.#state = "invalidated";
                }
            });
        }
        catch {
            this.#watchUnavailable = true;
            this.#watchUnsupported = true;
            this.#degraded = true;
        }
    }
    #isObserved(relative) {
        if (!relative || relative.includes("\u0000") || relative === ".")
            return false;
        const observed = this.#platform === "win32" ? relative.toLowerCase() : relative;
        const descriptor = this.#platform === "win32"
            ? path.basename(this.projectPath).toLowerCase()
            : path.basename(this.projectPath);
        return observed === descriptor || observed.startsWith("project/")
            || observed.startsWith("assets/") || observed.startsWith("plugins/")
            || observed === "project" || observed === "assets" || observed === "plugins";
    }
    #canonicalRelativePath(candidate) {
        const normalized = this.#platform === "win32"
            ? candidate.replace(/\\/g, "/")
            : candidate.split(path.sep).join("/");
        if (this.#platform !== "win32")
            return normalized;
        return this.#windowsPaths.get(normalized.toLowerCase()) ?? normalized;
    }
    #pathsMatch(left, right) {
        if (left === right)
            return true;
        return this.#platform === "win32" &&
            isPathWithinRoot(left, right, this.#platform) &&
            isPathWithinRoot(right, left, this.#platform);
    }
    #setIndexedFile(relative, file) {
        this.#files.set(relative, file);
        if (this.#platform === "win32")
            this.#windowsPaths.set(relative.toLowerCase(), relative);
    }
    #deleteIndexedFile(relative) {
        this.#files.delete(relative);
        if (this.#platform === "win32")
            this.#windowsPaths.delete(relative.toLowerCase());
    }
    async #walk(directory, discovered) {
        let canonical;
        try {
            canonical = await realpath(directory);
        }
        catch (error) {
            if (systemError(error, "ENOENT") || systemError(error, "ENOTDIR"))
                return;
            throw error;
        }
        assertWithinProject(this.projectRoot, canonical, this.#platform);
        const entries = await readdir(canonical, { withFileTypes: true });
        this.#counters.directoryReads += 1;
        entries.sort((left, right) => left.name.localeCompare(right.name));
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
                assertWithinProject(this.projectRoot, destination, this.#platform);
                throw new GameStudioProjectError("UNSAFE_SYMLINK", `Project contains an unsupported authored symbolic link: ${candidate}`, candidate);
            }
            else if (entry.isDirectory()) {
                await this.#walk(candidate, discovered);
            }
            else if (entry.isFile()) {
                const indexed = await this.#readFile(candidate);
                discovered.set(indexed.relativePath, indexed);
            }
        }
    }
    async #readFile(filename) {
        const canonical = await realpath(filename);
        assertWithinProject(this.projectRoot, canonical, this.#platform);
        if (!this.#pathsMatch(canonical, filename)) {
            throw new GameStudioProjectError("STALE_PROJECT", "An authored project resource changed during collection", filename);
        }
        const info = await stat(canonical, { bigint: true });
        const bytes = await readFile(canonical);
        this.#counters.authoredFileReads += 1;
        this.#counters.authoredBytesRead += bytes.byteLength;
        const relativePath = projectRelativePath(this.projectRoot, canonical, this.#platform);
        const fileCategory = category(relativePath, path.basename(this.projectPath));
        const semanticResource = relativePath.endsWith(".gbsproj") || relativePath.endsWith(".gbsres");
        // Font mappings are useful cached projections, but arbitrary authored JSON
        // remains revision-significant even when it is opaque or malformed.
        const optionalJson = relativePath.endsWith(".json") && relativePath.startsWith("assets/fonts/");
        const parseJson = semanticResource || optionalJson;
        let json;
        if (parseJson) {
            try {
                const parsed = JSON.parse(bytes.toString("utf8"));
                if (!isObject(parsed))
                    throw new Error("Native project resource must contain a JSON object");
                json = parsed;
                this.#counters.resourceParses += 1;
            }
            catch (error) {
                if (optionalJson)
                    json = undefined;
                else if (fileCategory === "asset-metadata") {
                    const physical = filename.slice(0, -".gbsres".length);
                    let hasPhysical = true;
                    try {
                        await lstat(physical);
                    }
                    catch (missing) {
                        if (!systemError(missing, "ENOENT") && !systemError(missing, "ENOTDIR"))
                            throw missing;
                        hasPhysical = false;
                    }
                    if (hasPhysical) {
                        throw new GameStudioProjectError("INVALID_RESOURCE", `Could not parse native project resource ${relativePath}: ${error instanceof Error ? error.message : String(error)}`, filename);
                    }
                    json = undefined;
                }
                else {
                    throw new GameStudioProjectError("INVALID_RESOURCE", `Could not parse native project resource ${relativePath}: ${error instanceof Error ? error.message : String(error)}`, filename);
                }
            }
        }
        const pngHeader = relativePath.toLowerCase().endsWith(".png") && bytes.length >= 24
            && bytes.subarray(0, 8).equals(PNG_SIGNATURE)
            ? { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) } : undefined;
        return {
            relativePath,
            category: fileCategory,
            identity: { dev: info.dev, ino: info.ino, size: info.size, mtimeNs: info.mtimeNs, ctimeNs: info.ctimeNs },
            sha256: createHash("sha256").update(bytes).digest("hex"),
            ...(json ? { json } : {}),
            ...(pngHeader ? { pngHeader } : {}),
        };
    }
    async #rebuild(fallback) {
        const discovery = this.#discovery;
        if (!discovery)
            throw new GameStudioProjectError("STALE_PROJECT", "The project selection is unavailable");
        const root = await realpath(this.projectRoot);
        if (!this.#pathsMatch(root, this.projectRoot)) {
            throw new GameStudioProjectError("STALE_PROJECT", "The selected project root changed", root);
        }
        const descriptor = await realpath(this.projectPath);
        if (!this.#pathsMatch(descriptor, this.projectPath)) {
            throw new GameStudioProjectError("STALE_PROJECT", "The selected project descriptor changed", descriptor);
        }
        const discovered = new Map();
        const descriptorFile = await this.#readFile(descriptor);
        discovered.set(descriptorFile.relativePath, descriptorFile);
        for (const folder of ["project", "assets", "plugins"]) {
            await this.#walk(path.join(root, folder), discovered);
        }
        const previousPluginHashes = new Map([...this.#files].filter(([name]) => name.startsWith("plugins/"))
            .map(([name, item]) => [name, item.sha256]));
        this.#files.clear();
        this.#windowsPaths.clear();
        for (const [relative, item] of discovered)
            this.#setIndexedFile(relative, item);
        const descriptorRelative = path.basename(this.projectPath);
        this.#tree = new ProjectRevisionTree([...discovered.values()]
            .filter((item) => isPublicProjectRevisionPath(item.relativePath, descriptorRelative)));
        this.#counters.fullHashPasses += 1;
        this.#counters.fullInventoryBuilds += 1;
        if (fallback)
            this.#counters.fallbackFullRebuilds += 1;
        const nextPluginHashes = new Map([...discovered].filter(([name]) => name.startsWith("plugins/"))
            .map(([name, item]) => [name, item.sha256]));
        if (this.semanticGeneration === 0 || previousPluginHashes.size !== nextPluginHashes.size
            || [...nextPluginHashes].some(([name, digest]) => previousPluginHashes.get(name) !== digest)) {
            this.semanticGeneration += 1;
        }
        this.#inAuthoritativeRebuild = true;
        try {
            await this.#publish();
        }
        finally {
            this.#inAuthoritativeRebuild = false;
        }
        // An editor can save while the cold census or verification is underway. Do
        // not discard those watcher events: reconcile them against their final
        // authored bytes before advertising a coherent generation.
        if (this.#dirty.size > 0)
            await this.#applyDirty([...this.#dirty]);
        // A completed authoritative scan already reconciles a watcher that failed
        // during that same scan. Retain its unavailability separately: callers can
        // explicitly request another strong verification without duplicating the
        // cold census or turning every cache hit into a project-wide scan.
        this.#degraded = this.#watchUnsupported;
        this.#state = this.#degraded ? "invalidated" : "ready";
    }
    async #refreshDirty() {
        if (this.#refresh) {
            await this.#refresh;
            return;
        }
        const dirty = [...this.#dirty];
        this.#dirty.clear();
        const pending = this.#applyDirty(dirty);
        this.#refresh = pending;
        try {
            await pending;
        }
        catch (error) {
            this.invalidate("The authored project changed ambiguously");
            throw error;
        }
        finally {
            this.#refresh = undefined;
        }
    }
    async #applyDirty(dirty) {
        let semanticChange = false;
        const changedPaths = new Set();
        const descriptorRelative = path.basename(this.projectPath);
        for (const observed of new Set(dirty)) {
            this.#dirty.delete(observed);
            let relative = this.#canonicalRelativePath(observed);
            let absolute = path.join(this.projectRoot, relative);
            assertWithinProject(this.projectRoot, absolute, this.#platform);
            let entry;
            try {
                entry = await lstat(absolute, { bigint: true });
            }
            catch (error) {
                if (!systemError(error, "ENOENT") && !systemError(error, "ENOTDIR"))
                    throw error;
                for (const existing of [...this.#files.keys()]) {
                    if (existing !== relative && !existing.startsWith(`${relative}/`))
                        continue;
                    this.#deleteIndexedFile(existing);
                    if (isPublicProjectRevisionPath(existing, descriptorRelative))
                        this.#tree.remove(existing);
                    if (existing.startsWith("plugins/"))
                        semanticChange = true;
                    this.#counters.changedPaths += 1;
                    changedPaths.add(existing);
                }
                if (relative === descriptorRelative)
                    throw new GameStudioProjectError("STALE_PROJECT", "The selected project descriptor was removed", absolute);
                continue;
            }
            if (entry.isSymbolicLink()) {
                const destination = await realpath(absolute).catch(() => {
                    throw new GameStudioProjectError("UNSAFE_SYMLINK", `Project contains an unreadable symbolic link: ${absolute}`, absolute);
                });
                assertWithinProject(this.projectRoot, destination, this.#platform);
                throw new GameStudioProjectError("UNSAFE_SYMLINK", `Project contains an unsupported authored symbolic link: ${absolute}`, absolute);
            }
            if (this.#platform === "win32") {
                const canonical = await realpath(absolute);
                assertWithinProject(this.projectRoot, canonical, this.#platform);
                if (!this.#pathsMatch(canonical, absolute)) {
                    throw new GameStudioProjectError("STALE_PROJECT", "An authored project resource changed during collection", absolute);
                }
                absolute = canonical;
                relative = this.#canonicalRelativePath(projectRelativePath(this.projectRoot, canonical, this.#platform));
            }
            if (entry.isDirectory()) {
                const descendants = new Map();
                await this.#walk(absolute, descendants);
                if (this.#discovery?.format === "legacy") {
                    for (const existing of this.#files.keys()) {
                        if (!existing.startsWith(`${relative}/`) || !isLegacyImagePath(existing) || descendants.has(existing))
                            continue;
                        this.#deleteIndexedFile(existing);
                        if (isPublicProjectRevisionPath(existing, descriptorRelative))
                            this.#tree.remove(existing);
                        if (existing.startsWith("plugins/"))
                            semanticChange = true;
                        this.#counters.changedPaths += 1;
                        changedPaths.add(existing);
                    }
                }
                for (const indexed of descendants.values()) {
                    const previous = this.#files.get(indexed.relativePath);
                    if (previous?.sha256 === indexed.sha256)
                        continue;
                    this.#setIndexedFile(indexed.relativePath, indexed);
                    if (isPublicProjectRevisionPath(indexed.relativePath, descriptorRelative))
                        this.#tree.upsert(indexed.relativePath, indexed.sha256);
                    if (indexed.relativePath.startsWith("plugins/"))
                        semanticChange = true;
                    this.#counters.changedPaths += 1;
                    changedPaths.add(indexed.relativePath);
                }
                continue;
            }
            if (!entry.isFile())
                continue;
            const previous = this.#files.get(relative);
            if (previous && previous.identity.dev === entry.dev && previous.identity.ino === entry.ino
                && previous.identity.size === entry.size && previous.identity.mtimeNs === entry.mtimeNs
                && previous.identity.ctimeNs === entry.ctimeNs) {
                const canonical = await realpath(absolute);
                assertWithinProject(this.projectRoot, canonical, this.#platform);
                if (!this.#pathsMatch(canonical, absolute)) {
                    throw new GameStudioProjectError("STALE_PROJECT", "An authored project resource changed during collection", absolute);
                }
                continue;
            }
            const indexed = await this.#readFile(absolute);
            if (previous?.sha256 === indexed.sha256) {
                this.#setIndexedFile(relative, indexed);
                continue;
            }
            this.#setIndexedFile(relative, indexed);
            if (isPublicProjectRevisionPath(relative, descriptorRelative))
                this.#tree.upsert(relative, indexed.sha256);
            if (relative.startsWith("plugins/"))
                semanticChange = true;
            this.#counters.changedPaths += 1;
            changedPaths.add(relative);
        }
        if (semanticChange)
            this.semanticGeneration += 1;
        if (changedPaths.size > 0)
            await this.#publish([...changedPaths]);
        this.#state = "ready";
    }
    async #publish(changedPaths = []) {
        const discovery = this.#discovery;
        if (!discovery)
            throw new GameStudioProjectError("STALE_PROJECT", "The project selection is unavailable");
        const descriptorFile = this.#files.get(path.basename(this.projectPath));
        if (!descriptorFile?.json)
            throw new GameStudioProjectError("STALE_PROJECT", "The selected project descriptor is unavailable");
        const descriptor = descriptorFile.json;
        const format = Array.isArray(descriptor.scenes) ? "legacy" : "distributed";
        const currentDiscovery = {
            projectPath: this.projectPath, projectRoot: this.projectRoot, descriptor,
            version: typeof descriptor._version === "string" ? descriptor._version : null, format,
        };
        this.#discovery = currentDiscovery;
        if (await this.#publishChangedOwners(currentDiscovery, changedPaths))
            return;
        if (changedPaths.length > 0 && !this.#inAuthoritativeRebuild) {
            this.#counters.fullInventoryBuilds += 1;
        }
        const inventory = this.#buildInventory(currentDiscovery);
        const variablesFile = format === "legacy" ? descriptorFile : this.#files.get("project/variables.gbsres");
        const entries = variablesFile?.json?.variables;
        const variables = (Array.isArray(entries) ? entries : [])
            .filter(isObject).map((item) => materialize(item, variablesFile?.relativePath ?? "project/variables.gbsres"));
        const map = (values) => new Map(values.filter((item) => item.id).map((item) => [item.id, item]));
        this.revision = this.#tree.revision();
        this.#inventory = inventory;
        this.#snapshot = {
            projectPath: this.projectPath, projectRoot: this.projectRoot,
            revision: this.revision, revisionAlgorithm: PROJECT_REVISION_ALGORITHM,
            selectionGeneration: this.selectionGeneration, descriptor, settings: inventory.settings,
            scenesById: map(inventory.scenes), actorsById: map(inventory.actors),
            triggersById: map(inventory.triggers), assetsById: map(inventory.assets),
            palettesById: map(inventory.palettes), variablesById: map(variables),
            diagnostics: inventory.diagnostics,
            counts: { ...inventory.counts, variables: variables.length },
            health: health(inventory.diagnostics), inventory,
        };
        this.#reindex(inventory, variables);
        await this.#publishGraph(inventory, changedPaths);
        this.indexGeneration += 1;
    }
    async #publishChangedOwners(discovery, changedPaths) {
        const inventory = this.#inventory;
        const previousSnapshot = this.#snapshot;
        if (!inventory || !previousSnapshot || discovery.format !== "distributed" || changedPaths.length === 0)
            return false;
        // Opaque project/assets files can be reviewed helper inputs. Their warm
        // updates must publish coverage and semantic freshness, not only revision.
        if (!this.#reviewedCustomEvents.needsDependencyRefresh(this.#files, changedPaths) && changedPaths.every((relative) => {
            const file = this.#files.get(relative);
            return file ? file.category === "other" : !relative.endsWith(".gbsres")
                && !ASSET_EXTENSIONS.has(path.extname(relative).toLowerCase());
        })) {
            this.revision = this.#tree.revision();
            this.#snapshot = { ...previousSnapshot, revision: this.revision };
            this.indexGeneration += 1;
            return true;
        }
        const replacements = [];
        for (const relative of new Set(changedPaths)) {
            const file = this.#files.get(relative);
            if (!file?.json || (file.category !== "actor" && file.category !== "trigger"))
                return false;
            const sceneId = this.#sceneIdsByResource.get(relative);
            if (!sceneId)
                return false;
            const scene = previousSnapshot.scenesById.get(sceneId);
            if (!scene)
                return false;
            const previous = (file.category === "actor" ? scene.actors : scene.triggers)
                .find((resource) => resource.resourcePath === relative);
            if (!previous)
                return false;
            const next = materialize(file.json, relative);
            if (next.id !== previous.id)
                return false;
            replacements.push({ previous, next, scene, kind: file.category });
        }
        if (replacements.length === 0)
            return false;
        const replacementByPath = new Map(replacements.map((item) => [item.previous.resourcePath, item]));
        const diagnostics = inventory.diagnostics.filter((item) => !item.resourcePath || !replacementByPath.has(item.resourcePath));
        const spriteIds = new Set(inventory.assets.filter((asset) => asset.type === "sprite").map((asset) => asset.id));
        const actorsById = previousSnapshot.actorsById;
        const triggersById = previousSnapshot.triggersById;
        for (const replacement of replacements) {
            const { previous, next, scene, kind } = replacement;
            const sceneResources = kind === "actor" ? scene.actors : scene.triggers;
            const scenePosition = sceneResources.indexOf(previous);
            if (scenePosition < 0)
                return false;
            sceneResources[scenePosition] = next;
            const flatResources = kind === "actor" ? inventory.actors : inventory.triggers;
            const flatPosition = flatResources.indexOf(previous);
            if (flatPosition < 0)
                return false;
            flatResources[flatPosition] = next;
            const scoped = `${scene.id}\u0000${next.id}`;
            if (kind === "actor") {
                this.#actors.set(scoped, next);
                actorsById.set(next.id, next);
                const spriteId = asString(next.spriteSheetId);
                if (spriteId && !spriteIds.has(spriteId))
                    diagnostics.push({ severity: "warning", code: "SPRITE_NOT_FOUND",
                        message: `Actor ${next.name || next.id} references missing sprite ${spriteId}`, resourcePath: next.resourcePath });
                const x = asNumber(next.x), y = asNumber(next.y);
                const width = asNumber(scene.width), height = asNumber(scene.height);
                if (x !== null && y !== null && width !== null && height !== null && (x < 0 || y < 0 || x >= width || y >= height)) {
                    diagnostics.push({ severity: "error", code: "ACTOR_OUT_OF_BOUNDS",
                        message: `Actor ${next.name || next.id} is outside the ${width} by ${height} scene`, resourcePath: next.resourcePath });
                }
            }
            else {
                this.#triggers.set(scoped, next);
                triggersById.set(next.id, next);
                const x = asNumber(next.x), y = asNumber(next.y);
                const width = asNumber(next.width), height = asNumber(next.height);
                const sceneWidth = asNumber(scene.width), sceneHeight = asNumber(scene.height);
                if (x !== null && y !== null && width !== null && height !== null && sceneWidth !== null && sceneHeight !== null
                    && (x < 0 || y < 0 || width <= 0 || height <= 0 || x + width > sceneWidth || y + height > sceneHeight)) {
                    diagnostics.push({ severity: "error", code: "TRIGGER_OUT_OF_BOUNDS",
                        message: `Trigger ${next.name || next.id} extends outside the ${sceneWidth} by ${sceneHeight} scene`, resourcePath: next.resourcePath });
                }
            }
        }
        inventory.diagnostics = diagnostics;
        this.revision = this.#tree.revision();
        this.#snapshot = { ...previousSnapshot, revision: this.revision, diagnostics,
            health: health(diagnostics), inventory };
        await this.#publishGraph(inventory, changedPaths);
        this.indexGeneration += 1;
        return true;
    }
    async #observeCompiler() {
        const profiles = this.#reviewedCustomEvents.activeCompilerProfiles(this.#files);
        return profiles.length ? observeReviewedCompiler(this.projectRoot, profiles, this.#toolchainRoot, this.#reviewedCustomEvents.activeCompilerDependencies(this.#files)) : undefined;
    }
    async #refreshCompiler() {
        if (!this.#reviewedCustomEvents.activeCompilerProfiles(this.#files).length)
            return;
        if (this.#compilerRefresh)
            return this.#compilerRefresh;
        const pending = (async () => {
            const next = await this.#observeCompiler();
            if (next?.fingerprint === this.#compilerObservation?.fingerprint)
                return;
            if (this.#state === "disposed" || !this.#inventory)
                throw new GameStudioProjectError("STALE_PROJECT", "The selected project index is unavailable");
            await this.#publishGraph(this.#inventory, [], next);
            this.indexGeneration += 1;
        })();
        this.#compilerRefresh = pending;
        try {
            await pending;
        }
        finally {
            this.#compilerRefresh = undefined;
        }
    }
    async #publishGraph(inventory, changedPaths, compiler) {
        this.#compilerObservation = compiler ?? await this.#observeCompiler();
        const previousGraph = this.#graph;
        this.#graph = await buildWorldScriptGraph(this.projectRoot, {
            inventory,
            filesByPath: this.#files,
            changedPaths,
            reviewedCustomEvents: this.#reviewedCustomEvents,
            ...(this.#compilerObservation ? { reviewedCompiler: this.#compilerObservation } : {}),
            ...(previousGraph ? { previousGraph } : {}),
        });
        if (previousGraph && this.#reviewedCustomEvents.contracts.length > 0
            && previousGraph.customEventFingerprint !== this.#graph.customEventFingerprint) {
            // Required definitions can be public resources as well as plugin files.
            // Their semantic binding changes even when the handler bytes do not.
            this.semanticGeneration += 1;
        }
        this.coverage = this.#graph.coverage;
        if (!this.#reviewedCustomEvents.needsDependencyRefresh(this.#files, changedPaths) && previousGraph && changedPaths.length > 0
            && changedPaths.every((relative) => {
                const file = this.#files.get(relative);
                return file?.category === "actor" || file?.category === "trigger";
            })) {
            const changed = new Set(changedPaths);
            const removeReferences = (map) => {
                for (const [key, references] of map) {
                    const remaining = references.filter((item) => !changed.has(item.owner.resourcePath));
                    if (remaining.length !== references.length) {
                        if (remaining.length > 0)
                            map.set(key, remaining);
                        else
                            map.delete(key);
                    }
                }
            };
            removeReferences(this.#incoming);
            removeReferences(this.#outgoing);
            removeReferences(this.#structural);
            for (const ref of this.#graph.references) {
                if (!changed.has(ref.owner.resourcePath))
                    continue;
                const incoming = this.#incoming.get(graphKey(ref.target)) ?? [];
                incoming.push(ref);
                this.#incoming.set(graphKey(ref.target), incoming);
                const owner = { type: ref.owner.resourceType, id: ref.owner.resourceId };
                const outgoing = this.#outgoing.get(graphKey(owner)) ?? [];
                outgoing.push(ref);
                this.#outgoing.set(graphKey(owner), outgoing);
            }
            for (const ref of this.#graph.structuralReferences) {
                if (!changed.has(ref.owner.resourcePath))
                    continue;
                const existing = this.#structural.get(graphKey(ref.target)) ?? [];
                existing.push(ref);
                this.#structural.set(graphKey(ref.target), existing);
            }
            return;
        }
        for (const map of [this.#incoming, this.#outgoing, this.#structural])
            map.clear();
        for (const ref of this.#graph.references) {
            const incoming = this.#incoming.get(graphKey(ref.target)) ?? [];
            incoming.push(ref);
            this.#incoming.set(graphKey(ref.target), incoming);
            const owner = { type: ref.owner.resourceType, id: ref.owner.resourceId };
            const outgoing = this.#outgoing.get(graphKey(owner)) ?? [];
            outgoing.push(ref);
            this.#outgoing.set(graphKey(owner), outgoing);
        }
        for (const ref of this.#graph.structuralReferences) {
            const existing = this.#structural.get(graphKey(ref.target)) ?? [];
            existing.push(ref);
            this.#structural.set(graphKey(ref.target), existing);
        }
    }
    #reindex(inventory, variables) {
        this.#actors.clear();
        this.#triggers.clear();
        this.#sceneIdsByResource.clear();
        this.#assetsById.clear();
        this.#assetsByPath.clear();
        this.#palettesById.clear();
        this.#kind.clear();
        this.#kind.set("scene", inventory.scenes);
        this.#kind.set("actor", inventory.actors);
        this.#kind.set("trigger", inventory.triggers);
        this.#kind.set("palette", inventory.palettes);
        this.#kind.set("asset", inventory.assets);
        this.#kind.set("variable", variables);
        for (const palette of inventory.palettes) {
            const matches = this.#palettesById.get(palette.id) ?? [];
            matches.push(palette);
            this.#palettesById.set(palette.id, matches);
        }
        for (const scene of inventory.scenes) {
            this.#sceneIdsByResource.set(scene.resourcePath, scene.id);
            for (const actor of scene.actors) {
                this.#actors.set(`${scene.id}\u0000${actor.id}`, actor);
                this.#sceneIdsByResource.set(actor.resourcePath, scene.id);
            }
            for (const trigger of scene.triggers) {
                this.#triggers.set(`${scene.id}\u0000${trigger.id}`, trigger);
                this.#sceneIdsByResource.set(trigger.resourcePath, scene.id);
            }
        }
        for (const asset of inventory.assets) {
            if (asset.id) {
                const matches = this.#assetsById.get(asset.id) ?? [];
                matches.push(asset);
                this.#assetsById.set(asset.id, matches);
            }
            for (const key of new Set([asset.resourcePath, asset.metadataPath, asset.filename].filter((item) => Boolean(item)))) {
                const matches = this.#assetsByPath.get(key) ?? [];
                matches.push(asset);
                this.#assetsByPath.set(key, matches);
            }
        }
    }
    #buildInventory(discovery) {
        const { descriptor, format } = discovery;
        const diagnostics = [];
        const scenes = [];
        const palettes = [];
        let settings = {};
        const projectFiles = [...this.#files.values()].filter((item) => item.relativePath.startsWith("project/"))
            .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
        if (format === "legacy") {
            settings = isObject(descriptor.settings) ? descriptor.settings : {};
            for (const candidate of Array.isArray(descriptor.scenes) ? descriptor.scenes : []) {
                if (!isObject(candidate))
                    continue;
                const resourcePath = path.basename(this.projectPath);
                scenes.push({ ...materialize(candidate, resourcePath),
                    actors: (Array.isArray(candidate.actors) ? candidate.actors : []).filter(isObject)
                        .map((actor) => materialize(actor, resourcePath)),
                    triggers: (Array.isArray(candidate.triggers) ? candidate.triggers : []).filter(isObject)
                        .map((trigger) => materialize(trigger, resourcePath)),
                });
            }
            for (const item of Array.isArray(descriptor.palettes) ? descriptor.palettes : []) {
                if (isObject(item))
                    palettes.push(materialize(item, path.basename(this.projectPath)));
            }
        }
        else {
            if (projectFiles.length === 0)
                diagnostics.push({ severity: "error", code: "PROJECT_RESOURCES_MISSING", message: "Distributed project is missing its project/ resource directory" });
            const settingsFile = this.#files.get("project/settings.gbsres");
            if (settingsFile?.json)
                settings = settingsFile.json;
            else
                diagnostics.push({ severity: "warning", code: "SETTINGS_MISSING", message: "Distributed project has no project/settings.gbsres resource" });
            const sceneFiles = [];
            const actorsBySceneDirectory = new Map();
            const triggersBySceneDirectory = new Map();
            for (const file of projectFiles) {
                if (file.category === "scene")
                    sceneFiles.push(file);
                else if (file.category === "actor" || file.category === "trigger") {
                    const marker = file.category === "actor" ? "/actors/" : "/triggers/";
                    const markerPosition = file.relativePath.indexOf(marker);
                    if (markerPosition < 0 || !file.json)
                        continue;
                    const directory = file.relativePath.slice(0, markerPosition);
                    const buckets = file.category === "actor" ? actorsBySceneDirectory : triggersBySceneDirectory;
                    const entries = buckets.get(directory) ?? [];
                    entries.push(file);
                    buckets.set(directory, entries);
                }
            }
            for (const sceneFile of sceneFiles) {
                if (!sceneFile.json)
                    continue;
                const directory = path.posix.dirname(sceneFile.relativePath);
                const actors = (actorsBySceneDirectory.get(directory) ?? [])
                    .map((item) => materialize(item.json, item.relativePath));
                const triggers = (triggersBySceneDirectory.get(directory) ?? [])
                    .map((item) => materialize(item.json, item.relativePath));
                scenes.push({ ...materialize(sceneFile.json, sceneFile.relativePath), actors, triggers });
            }
            for (const file of projectFiles.filter((item) => item.category === "palette")) {
                if (!file.json)
                    continue;
                const palette = file.json;
                palettes.push(materialize(palette, file.relativePath));
                if (Array.isArray(palette.colors) && palette.colors.length !== 4)
                    diagnostics.push({
                        severity: "warning", code: "INVALID_PALETTE_SIZE",
                        message: `Palette ${asString(palette.name, asString(palette.id))} has ${palette.colors.length} colors; Game Boy Color palettes require exactly four`,
                        resourcePath: file.relativePath,
                    });
            }
        }
        const files = [...this.#files.values()].filter((item) => item.relativePath.startsWith("assets/"))
            .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
        const physical = files.filter((item) => ASSET_EXTENSIONS.has(path.extname(item.relativePath).toLowerCase()));
        const physicalPaths = new Set(physical.map((item) => item.relativePath));
        const assets = [];
        const legacyRootMetadata = new Map();
        if (format === "legacy") {
            for (const folder of ["backgrounds", "sprites"]) {
                const prefix = `assets/${folder}/`;
                const physicalFilenames = new Set(physical.filter((file) => file.relativePath.startsWith(prefix) && isPhysicalPng(file))
                    .map((file) => file.relativePath.slice(prefix.length)));
                legacyRootMetadata.set(folder, legacyPhysicalAssetMetadataLookup(discovery, folder, undefined, physicalFilenames));
            }
        }
        for (const file of physical) {
            const parts = file.relativePath.split("/");
            const metadata = this.#files.get(`${file.relativePath}.gbsres`)?.json;
            const nativeMetadata = metadata ?? (isPhysicalPng(file)
                ? legacyRootMetadata.get(parts[1] ?? "")?.(parts.slice(2).join("/")) ?? undefined
                : undefined);
            if (!metadata && format === "distributed" && parts[1] !== "ui")
                diagnostics.push({
                    severity: "info", code: "ASSET_METADATA_MISSING",
                    message: `Asset ${file.relativePath} has no .gbsres metadata yet; the game editor can import it on refresh`, resourcePath: file.relativePath,
                });
            const extension = path.extname(file.relativePath);
            assets.push({ ...nativeMetadata, id: asString(nativeMetadata?.id),
                name: asString(nativeMetadata?.name, path.basename(file.relativePath, extension)),
                type: assetType(parts[1] ?? "asset", metadata),
                filename: asString(nativeMetadata?.filename, path.basename(file.relativePath)),
                resourcePath: file.relativePath, metadataPath: metadata ? `${file.relativePath}.gbsres` : null,
                hasMetadata: Boolean(metadata),
                width: asNumber(nativeMetadata?.imageWidth) ?? file.pngHeader?.width ?? asNumber(nativeMetadata?.width),
                height: asNumber(nativeMetadata?.imageHeight) ?? file.pngHeader?.height ?? asNumber(nativeMetadata?.height),
            });
        }
        // The cold/warm census only caches canonical regular files and rejects symlinks.
        // Legacy descriptors identify plugin images by plugin name plus relative filename.
        for (const candidate of legacyPluginAssetCandidates(discovery)) {
            const file = this.#files.get(candidate.relativePath);
            if (!file || !isPhysicalPng(file))
                continue;
            const { metadata, folder } = candidate;
            const extension = path.posix.extname(file.relativePath);
            assets.push({ ...metadata, id: asString(metadata.id),
                name: asString(metadata.name, path.posix.basename(file.relativePath, extension)),
                type: assetType(folder, undefined),
                filename: asString(metadata.filename, path.posix.basename(file.relativePath)),
                resourcePath: file.relativePath, metadataPath: null, hasMetadata: false,
                width: asNumber(metadata.imageWidth) ?? file.pngHeader.width,
                height: asNumber(metadata.imageHeight) ?? file.pngHeader.height,
            });
        }
        for (const file of files.filter((item) => item.relativePath.endsWith(".gbsres"))) {
            const expectedAsset = file.relativePath.slice(0, -".gbsres".length);
            if (!physicalPaths.has(expectedAsset))
                diagnostics.push({ severity: "warning", code: "ASSET_FILE_MISSING",
                    message: `Asset metadata ${file.relativePath} has no corresponding asset file`, resourcePath: file.relativePath });
        }
        const backgroundIds = new Set(assets.filter((asset) => asset.type === "background").map((asset) => asset.id));
        const spriteIds = new Set(assets.filter((asset) => asset.type === "sprite").map((asset) => asset.id));
        for (const scene of scenes) {
            const backgroundId = asString(scene.backgroundId);
            if (backgroundId && !backgroundIds.has(backgroundId))
                diagnostics.push({ severity: "warning", code: "BACKGROUND_NOT_FOUND",
                    message: `Scene ${scene.name || scene.id} references missing background ${backgroundId}`, resourcePath: scene.resourcePath });
            const width = asNumber(scene.width);
            const height = asNumber(scene.height);
            if (typeof scene.collisions === "string" && width !== null && height !== null) {
                const tiles = width * height;
                if (Number.isSafeInteger(tiles) && tiles >= 0 && tiles <= 1_000_000) {
                    try {
                        decodeResourceBytes(scene.collisions, { maximumValues: tiles, allowImplicitZeroGrid: true });
                    }
                    catch (error) {
                        if (!(error instanceof ResourceCodecError))
                            throw error;
                        diagnostics.push({ severity: "error", code: error.code === "RESOURCE_VALUE_LIMIT" ? "COLLISION_MAP_TOO_LARGE" : "INVALID_COLLISION_MAP",
                            message: `Scene ${scene.name || scene.id} has invalid collision data: ${error.message}`, resourcePath: scene.resourcePath });
                    }
                }
            }
            for (const actor of scene.actors) {
                const spriteId = asString(actor.spriteSheetId);
                if (spriteId && !spriteIds.has(spriteId))
                    diagnostics.push({ severity: "warning", code: "SPRITE_NOT_FOUND",
                        message: `Actor ${actor.name || actor.id} references missing sprite ${spriteId}`, resourcePath: actor.resourcePath });
                const x = asNumber(actor.x), y = asNumber(actor.y);
                if (x !== null && y !== null && width !== null && height !== null && (x < 0 || y < 0 || x >= width || y >= height)) {
                    diagnostics.push({ severity: "error", code: "ACTOR_OUT_OF_BOUNDS",
                        message: `Actor ${actor.name || actor.id} is outside the ${width} by ${height} scene`, resourcePath: actor.resourcePath });
                }
            }
            for (const trigger of scene.triggers) {
                const x = asNumber(trigger.x), y = asNumber(trigger.y);
                const triggerWidth = asNumber(trigger.width), triggerHeight = asNumber(trigger.height);
                if (x !== null && y !== null && triggerWidth !== null && triggerHeight !== null && width !== null && height !== null
                    && (x < 0 || y < 0 || triggerWidth <= 0 || triggerHeight <= 0 || x + triggerWidth > width || y + triggerHeight > height)) {
                    diagnostics.push({ severity: "error", code: "TRIGGER_OUT_OF_BOUNDS",
                        message: `Trigger ${trigger.name || trigger.id} extends outside the ${width} by ${height} scene`, resourcePath: trigger.resourcePath });
                }
            }
        }
        const settingsPath = format === "distributed" ? "project/settings.gbsres" : path.basename(this.projectPath);
        const startSceneId = asString(settings.startSceneId);
        const startScene = scenes.find((scene) => scene.id === startSceneId);
        if (startSceneId && !startScene)
            diagnostics.push({ severity: "error", code: "START_SCENE_NOT_FOUND",
                message: `Project settings reference missing start scene ${startSceneId}`, resourcePath: settingsPath });
        if (startScene) {
            const x = asNumber(settings.startX), y = asNumber(settings.startY);
            const width = asNumber(startScene.width), height = asNumber(startScene.height);
            if (x !== null && y !== null && width !== null && height !== null && (x < 0 || y < 0 || x >= width || y >= height)) {
                diagnostics.push({ severity: "error", code: "START_POSITION_OUT_OF_BOUNDS",
                    message: `Player start position is outside the ${width} by ${height} start scene`, resourcePath: startScene.resourcePath });
            }
            const mappings = isObject(settings.defaultPlayerSprites) ? settings.defaultPlayerSprites : {};
            const sceneType = asString(startScene.type, asString(settings.defaultSceneTypeId, "TOPDOWN"));
            const spriteId = asString(mappings[sceneType]);
            if (!spriteId || !spriteIds.has(spriteId))
                diagnostics.push({ severity: "error", code: "PLAYER_SPRITE_NOT_FOUND",
                    message: spriteId ? `Start scene type ${sceneType} references missing player sprite ${spriteId}`
                        : `Start scene type ${sceneType} has no default player sprite`, resourcePath: settingsPath });
        }
        if (!discovery.version)
            diagnostics.push({ severity: "warning", code: "VERSION_MISSING", message: "Project descriptor does not declare a project _version" });
        else if (format === "distributed" && Number(discovery.version.split(".")[0]) < 4)
            diagnostics.push({ severity: "warning", code: "UNEXPECTED_PROJECT_VERSION",
                message: `Distributed resources usually require project format version 4 or newer; project declares ${discovery.version}` });
        const actors = scenes.flatMap((scene) => scene.actors);
        const triggers = scenes.flatMap((scene) => scene.triggers);
        return { ...discovery,
            name: asString(descriptor.name, path.basename(discovery.projectPath, ".gbsproj")), author: asString(descriptor.author),
            settings, scenes, actors, triggers, palettes, assets, diagnostics,
            counts: { scenes: scenes.length, actors: actors.length, triggers: triggers.length, palettes: palettes.length, assets: assets.length },
        };
    }
}
//# sourceMappingURL=project-world-index.js.map