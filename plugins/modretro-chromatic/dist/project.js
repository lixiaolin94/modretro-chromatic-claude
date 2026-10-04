import { createHash } from "node:crypto";
import { access, lstat, mkdir, open, readdir, readFile, realpath, rename, rm, stat, } from "node:fs/promises";
import path from "node:path";
import { PROJECT_REVISION_ALGORITHM, } from "./project-access.js";
import { inspectProjectSnapshot, loadProjectSnapshot } from "./project-snapshot.js";
import { decodeResourceBytes, ResourceCodecError } from "./resource-codec.js";
import { explicitlyPatchedNativeScriptCoordinates, findInvalidNativeScriptEvent, } from "./native-script-events.js";
import { validateActorResource } from "./actors.js";
import { readProjectJsonWithRevision, resourceRevision, withProjectResourceWriteLock, writeProjectBytesAtomic, } from "./project-files.js";
import { legacyPhysicalAssetMetadataLookup, legacyPluginAssetCandidates } from "./legacy-project-assets.js";
/** Stable native IDs must resolve to exactly one physical project asset across resource kinds. */
export function resolveNativeAssetIdentity(source, id) {
    const indexed = "asset" in source ? source.asset({ assetId: id }) : undefined;
    const matches = indexed?.matches ?? ("assets" in source ? source.assets.filter((asset) => asset.id === id) : []);
    if (indexed?.status === "ambiguous" || matches.length > 1) {
        throw new GameStudioProjectError("AMBIGUOUS_ASSET", `No unique project asset exists with id ${id}`);
    }
    return matches[0];
}
export class GameStudioProjectError extends Error {
    code;
    resourcePath;
    constructor(code, message, resourcePath) {
        super(message);
        this.code = code;
        this.resourcePath = resourcePath;
        this.name = "GameStudioProjectError";
    }
}
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const IMMUTABLE_RESOURCE_KEYS = new Set(["id", "_resourceType", "_index"]);
const ASSET_EXTENSIONS = new Set([
    ".png",
    ".wav",
    ".uge",
    ".mod",
    ".vgm",
    ".vgz",
]);
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function asString(value, fallback = "") {
    return typeof value === "string" ? value : fallback;
}
function asNumber(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function assertWithinRoot(root, candidate) {
    const relative = path.relative(root, candidate);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        throw new GameStudioProjectError("PATH_OUTSIDE_PROJECT", `Refusing to access a path outside the native game project: ${candidate}`, candidate);
    }
}
function toRelative(root, candidate) {
    assertWithinRoot(root, candidate);
    return path.relative(root, candidate).split(path.sep).join("/");
}
async function ensureSafeExistingPath(root, candidate) {
    const absolute = path.resolve(candidate);
    assertWithinRoot(root, absolute);
    let canonical;
    try {
        canonical = await realpath(absolute);
    }
    catch (error) {
        if (isSystemError(error, "ENOENT")) {
            throw new GameStudioProjectError("RESOURCE_NOT_FOUND", `Resource does not exist: ${absolute}`, absolute);
        }
        throw error;
    }
    assertWithinRoot(root, canonical);
    return canonical;
}
function isSystemError(error, code) {
    return isObject(error) && error.code === code;
}
async function exists(candidate) {
    try {
        await access(candidate);
        return true;
    }
    catch (error) {
        if (isSystemError(error, "ENOENT"))
            return false;
        throw error;
    }
}
async function readJson(root, candidate) {
    const safePath = await ensureSafeExistingPath(root, candidate);
    let parsed;
    try {
        parsed = JSON.parse(await readFile(safePath, "utf8"));
    }
    catch (error) {
        throw new GameStudioProjectError("INVALID_RESOURCE", `Could not parse native project resource ${toRelative(root, safePath)}: ${error instanceof Error ? error.message : String(error)}`, safePath);
    }
    if (!isObject(parsed)) {
        throw new GameStudioProjectError("INVALID_RESOURCE", `Native project resource must contain a JSON object: ${safePath}`, safePath);
    }
    return parsed;
}
async function writeJsonAtomic(root, candidate, value) {
    const absolute = path.resolve(candidate);
    assertWithinRoot(root, absolute);
    const parent = path.dirname(absolute);
    let existingAncestor = parent;
    while (!(await exists(existingAncestor))) {
        existingAncestor = path.dirname(existingAncestor);
    }
    await ensureSafeExistingPath(root, existingAncestor);
    await mkdir(parent, { recursive: true });
    await ensureSafeExistingPath(root, parent);
    if (await exists(absolute)) {
        const targetStat = await lstat(absolute);
        if (targetStat.isSymbolicLink()) {
            throw new GameStudioProjectError("UNSAFE_SYMLINK", `Refusing to overwrite symbolic link ${absolute}`, absolute);
        }
        await ensureSafeExistingPath(root, absolute);
    }
    const temporary = path.join(parent, `.${path.basename(absolute)}.${process.pid}.${Date.now()}.tmp`);
    let handle;
    try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(temporary, absolute);
    }
    catch (error) {
        if (handle)
            await handle.close();
        await rm(temporary, { force: true });
        throw error;
    }
}
function safeSlug(value, fallback) {
    const slug = value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return slug || fallback;
}
function stableId(...parts) {
    const bytes = createHash("sha256").update(parts.join("\u0000")).digest();
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hex = bytes.subarray(0, 16).toString("hex");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
function assertSafeObject(value, label, disallowImmutable = false) {
    for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key) || (disallowImmutable && IMMUTABLE_RESOURCE_KEYS.has(key))) {
            throw new GameStudioProjectError("INVALID_PROPERTY", `${label} cannot modify reserved property ${key}`);
        }
        if (isObject(child))
            assertSafeObject(child, label);
    }
}
function mergeObjects(existing, updates) {
    assertSafeObject(updates, "Project update");
    const result = { ...existing };
    for (const [key, value] of Object.entries(updates)) {
        const original = result[key];
        result[key] = isObject(original) && isObject(value) ? mergeObjects(original, value) : value;
    }
    return result;
}
function validateName(value, label) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new GameStudioProjectError("INVALID_INPUT", `${label} must be a non-empty string`);
    }
    return value.trim();
}
async function walkFiles(root, directory) {
    if (!(await exists(directory)))
        return [];
    await ensureSafeExistingPath(root, directory);
    const result = [];
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
        const candidate = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
            let destination;
            try {
                destination = await realpath(candidate);
            }
            catch {
                throw new GameStudioProjectError("UNSAFE_SYMLINK", `Project contains an unreadable symbolic link: ${candidate}`, candidate);
            }
            assertWithinRoot(root, destination);
            continue;
        }
        if (entry.isDirectory())
            result.push(...(await walkFiles(root, candidate)));
        else if (entry.isFile())
            result.push(candidate);
    }
    return result;
}
async function descriptorsIn(directory) {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    }
    catch (error) {
        if (isSystemError(error, "ENOENT") || isSystemError(error, "ENOTDIR"))
            return [];
        throw error;
    }
    return entries
        .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.toLowerCase().endsWith(".gbsproj"))
        .map((entry) => path.join(directory, entry.name))
        .sort((left, right) => left.localeCompare(right));
}
export async function discoverProject(startPath = process.cwd()) {
    const requested = path.resolve(startPath);
    let descriptorPath;
    if (requested.toLowerCase().endsWith(".gbsproj")) {
        descriptorPath = requested;
    }
    else {
        let directory = requested;
        try {
            if ((await stat(requested)).isFile())
                directory = path.dirname(requested);
        }
        catch (error) {
            if (isSystemError(error, "ENOENT")) {
                throw new GameStudioProjectError("PROJECT_NOT_FOUND", `Project search path does not exist: ${requested}`, requested);
            }
            throw error;
        }
        while (true) {
            const matches = await descriptorsIn(directory);
            if (matches.length > 1) {
                throw new GameStudioProjectError("AMBIGUOUS_PROJECT", `More than one .gbsproj file exists in ${directory}; provide an explicit project file`, directory);
            }
            if (matches[0]) {
                descriptorPath = matches[0];
                break;
            }
            const parent = path.dirname(directory);
            if (parent === directory)
                break;
            directory = parent;
        }
    }
    if (!descriptorPath) {
        throw new GameStudioProjectError("PROJECT_NOT_FOUND", `No .gbsproj project was found at or above ${requested}`, requested);
    }
    let projectRoot;
    try {
        projectRoot = await realpath(path.dirname(descriptorPath));
    }
    catch (error) {
        if (isSystemError(error, "ENOENT")) {
            throw new GameStudioProjectError("PROJECT_NOT_FOUND", `Native game project does not exist: ${descriptorPath}`, descriptorPath);
        }
        throw error;
    }
    const descriptor = await readJson(projectRoot, path.join(projectRoot, path.basename(descriptorPath)));
    const projectPath = path.join(projectRoot, path.basename(descriptorPath));
    const format = Array.isArray(descriptor.scenes) ? "legacy" : "distributed";
    return {
        projectPath,
        projectRoot,
        descriptor,
        version: typeof descriptor._version === "string" ? descriptor._version : null,
        format,
    };
}
function materializeResource(resource, resourcePath) {
    return {
        ...resource,
        id: asString(resource.id),
        name: asString(resource.name),
        resourcePath,
    };
}
async function pngDimensions(filename) {
    const handle = await open(filename, "r");
    try {
        const header = Buffer.alloc(24);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
        if (bytesRead < 24 || !header.subarray(0, 8).equals(signature))
            return null;
        return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
    }
    finally {
        await handle.close();
    }
}
function assetType(folder, metadata) {
    if (typeof metadata?._resourceType === "string")
        return metadata._resourceType;
    const lookup = {
        backgrounds: "background",
        sprites: "sprite",
        avatars: "avatar",
        emotes: "emote",
        fonts: "font",
        tilesets: "tileset",
        music: "music",
        sounds: "sound",
    };
    return lookup[folder] ?? folder;
}
async function collectAssets(discovery, diagnostics) {
    const assetsRoot = path.join(discovery.projectRoot, "assets");
    const files = await walkFiles(discovery.projectRoot, assetsRoot);
    const physicalAssets = files.filter((file) => ASSET_EXTENSIONS.has(path.extname(file).toLowerCase()));
    const physicalSet = new Set(physicalAssets);
    const result = [];
    const physicalPngDimensions = new Map();
    const legacyRootFilenames = new Map(["backgrounds", "sprites"].map((folder) => [folder, new Set()]));
    for (const file of physicalAssets) {
        if (path.extname(file).toLowerCase() !== ".png")
            continue;
        const dimensions = await pngDimensions(file);
        physicalPngDimensions.set(file, dimensions);
        if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0)
            continue;
        const [folder, ...filename] = path.relative(assetsRoot, file).split(path.sep);
        if (folder)
            legacyRootFilenames.get(folder)?.add(filename.join("/"));
    }
    const legacyRootMetadata = new Map([...legacyRootFilenames].map(([folder, filenames]) => [folder, legacyPhysicalAssetMetadataLookup(discovery, folder, undefined, filenames)]));
    for (const file of physicalAssets) {
        const relative = toRelative(discovery.projectRoot, file);
        const relativeParts = relative.split("/");
        const metadataFile = `${file}.gbsres`;
        const metadata = (await exists(metadataFile)) ? await readJson(discovery.projectRoot, metadataFile) : null;
        const dimensions = physicalPngDimensions.get(file) ?? null;
        const nativeMetadata = metadata ?? (dimensions && dimensions.width > 0 && dimensions.height > 0
            ? legacyRootMetadata.get(relativeParts[1] ?? "")?.(relativeParts.slice(2).join("/"))
            : null);
        // GB Studio's built-in UI frame/cursor files are intentionally plain PNGs;
        // they are not imported resources and never receive .gbsres sidecars.
        if (!metadata && discovery.format === "distributed" && relativeParts[1] !== "ui") {
            diagnostics.push({
                severity: "info",
                code: "ASSET_METADATA_MISSING",
                message: `Asset ${relative} has no .gbsres metadata yet; the game editor can import it on refresh`,
                resourcePath: relative,
            });
        }
        result.push({
            ...(nativeMetadata ?? {}),
            id: asString(nativeMetadata?.id),
            name: asString(nativeMetadata?.name, path.basename(file, path.extname(file))),
            type: assetType(relativeParts[1] ?? "asset", metadata),
            filename: asString(nativeMetadata?.filename, path.basename(file)),
            resourcePath: relative,
            metadataPath: metadata ? toRelative(discovery.projectRoot, metadataFile) : null,
            hasMetadata: metadata !== null,
            width: asNumber(nativeMetadata?.imageWidth) ?? dimensions?.width ?? asNumber(nativeMetadata?.width),
            height: asNumber(nativeMetadata?.imageHeight) ?? dimensions?.height ?? asNumber(nativeMetadata?.height),
        });
    }
    for (const candidate of legacyPluginAssetCandidates(discovery)) {
        const physical = path.join(discovery.projectRoot, candidate.relativePath);
        const folder = path.join(discovery.projectRoot, ...candidate.relativePath.split("/").slice(0, 3));
        let canonical;
        try {
            const entry = await lstat(physical);
            const canonicalFolder = await ensureSafeExistingPath(discovery.projectRoot, folder);
            canonical = await ensureSafeExistingPath(discovery.projectRoot, physical);
            assertWithinRoot(canonicalFolder, canonical);
            if (!entry.isFile() || canonicalFolder !== folder || canonical !== physical)
                continue;
        }
        catch (error) {
            if (isSystemError(error, "ENOENT") || (error instanceof GameStudioProjectError && error.code === "RESOURCE_NOT_FOUND"))
                continue;
            throw error;
        }
        const dimensions = await pngDimensions(canonical);
        if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0)
            continue;
        const metadata = candidate.metadata;
        result.push({
            ...metadata,
            id: asString(metadata.id),
            name: asString(metadata.name, path.basename(physical, path.extname(physical))),
            type: assetType(candidate.folder, null),
            filename: asString(metadata.filename, path.basename(physical)),
            resourcePath: candidate.relativePath,
            metadataPath: null,
            hasMetadata: false,
            width: asNumber(metadata.imageWidth) ?? dimensions.width,
            height: asNumber(metadata.imageHeight) ?? dimensions.height,
        });
    }
    for (const file of files.filter((candidate) => candidate.endsWith(".gbsres"))) {
        const expectedAsset = file.slice(0, -".gbsres".length);
        if (!physicalSet.has(expectedAsset)) {
            diagnostics.push({
                severity: "warning",
                code: "ASSET_FILE_MISSING",
                message: `Asset metadata ${toRelative(discovery.projectRoot, file)} has no corresponding asset file`,
                resourcePath: toRelative(discovery.projectRoot, file),
            });
        }
    }
    return result;
}
export async function inventoryProject(projectPath, indexedAccess) {
    if (indexedAccess) {
        assertIndexedProjectAccess(projectPath, indexedAccess);
        await indexedAccess.ensureFresh();
        return indexedAccess.legacyInventory();
    }
    const discovery = await discoverProject(projectPath);
    const { projectRoot, descriptor, format } = discovery;
    const diagnostics = [];
    const scenes = [];
    const palettes = [];
    let settings = {};
    if (format === "legacy") {
        settings = isObject(descriptor.settings) ? descriptor.settings : {};
        for (const value of Array.isArray(descriptor.scenes) ? descriptor.scenes : []) {
            if (!isObject(value))
                continue;
            const scene = materializeResource(value, toRelative(projectRoot, discovery.projectPath));
            scenes.push({
                ...scene,
                actors: (Array.isArray(value.actors) ? value.actors : [])
                    .filter(isObject)
                    .map((actor) => materializeResource(actor, scene.resourcePath)),
                triggers: (Array.isArray(value.triggers) ? value.triggers : [])
                    .filter(isObject)
                    .map((trigger) => materializeResource(trigger, scene.resourcePath)),
            });
        }
        for (const palette of Array.isArray(descriptor.palettes) ? descriptor.palettes : []) {
            if (isObject(palette))
                palettes.push(materializeResource(palette, toRelative(projectRoot, discovery.projectPath)));
        }
    }
    else {
        const projectResourcesRoot = path.join(projectRoot, "project");
        if (!(await exists(projectResourcesRoot))) {
            diagnostics.push({ severity: "error", code: "PROJECT_RESOURCES_MISSING", message: "Distributed project is missing its project/ resource directory" });
        }
        const settingsPath = path.join(projectResourcesRoot, "settings.gbsres");
        if (await exists(settingsPath))
            settings = await readJson(projectRoot, settingsPath);
        else
            diagnostics.push({ severity: "warning", code: "SETTINGS_MISSING", message: "Distributed project has no project/settings.gbsres resource" });
        const resourceFiles = await walkFiles(projectRoot, projectResourcesRoot);
        const sceneFiles = resourceFiles.filter((file) => path.basename(file) === "scene.gbsres");
        for (const sceneFile of sceneFiles) {
            const sceneData = await readJson(projectRoot, sceneFile);
            const sceneDirectory = path.dirname(sceneFile);
            const actors = [];
            const triggers = [];
            for (const [kind, destination] of [["actors", actors], ["triggers", triggers]]) {
                for (const resourceFile of await walkFiles(projectRoot, path.join(sceneDirectory, kind))) {
                    if (!resourceFile.endsWith(".gbsres"))
                        continue;
                    const resource = await readJson(projectRoot, resourceFile);
                    destination.push(materializeResource(resource, toRelative(projectRoot, resourceFile)));
                }
            }
            scenes.push({
                ...materializeResource(sceneData, toRelative(projectRoot, sceneFile)),
                actors,
                triggers,
            });
        }
        for (const file of resourceFiles.filter((candidate) => {
            const relative = toRelative(projectRoot, candidate);
            return relative.startsWith("project/palettes/") && candidate.endsWith(".gbsres");
        })) {
            const palette = await readJson(projectRoot, file);
            palettes.push(materializeResource(palette, toRelative(projectRoot, file)));
            if (Array.isArray(palette.colors) && palette.colors.length !== 4) {
                diagnostics.push({
                    severity: "warning",
                    code: "INVALID_PALETTE_SIZE",
                    message: `Palette ${asString(palette.name, asString(palette.id))} has ${palette.colors.length} colors; Game Boy Color palettes require exactly four`,
                    resourcePath: toRelative(projectRoot, file),
                });
            }
        }
    }
    const assets = await collectAssets(discovery, diagnostics);
    const backgroundIds = new Set(assets.filter((asset) => asset.type === "background").map((asset) => asset.id));
    const spriteIds = new Set(assets.filter((asset) => asset.type === "sprite").map((asset) => asset.id));
    for (const scene of scenes) {
        const backgroundId = asString(scene.backgroundId);
        if (backgroundId && !backgroundIds.has(backgroundId)) {
            diagnostics.push({ severity: "warning", code: "BACKGROUND_NOT_FOUND", message: `Scene ${scene.name || scene.id} references missing background ${backgroundId}`, resourcePath: scene.resourcePath });
        }
        const sceneWidth = asNumber(scene.width);
        const sceneHeight = asNumber(scene.height);
        if (typeof scene.collisions === "string" && sceneWidth !== null && sceneHeight !== null) {
            const tileCount = sceneWidth * sceneHeight;
            if (Number.isSafeInteger(tileCount) && tileCount >= 0 && tileCount <= 1_000_000) {
                try {
                    decodeResourceBytes(scene.collisions, { maximumValues: tileCount, allowImplicitZeroGrid: true });
                }
                catch (error) {
                    if (!(error instanceof ResourceCodecError))
                        throw error;
                    diagnostics.push({
                        severity: "error",
                        code: error.code === "RESOURCE_VALUE_LIMIT" ? "COLLISION_MAP_TOO_LARGE" : "INVALID_COLLISION_MAP",
                        message: `Scene ${scene.name || scene.id} has invalid collision data: ${error.message}`,
                        resourcePath: scene.resourcePath,
                    });
                }
            }
        }
        for (const actor of scene.actors) {
            const spriteSheetId = asString(actor.spriteSheetId);
            if (spriteSheetId && !spriteIds.has(spriteSheetId)) {
                diagnostics.push({ severity: "warning", code: "SPRITE_NOT_FOUND", message: `Actor ${actor.name || actor.id} references missing sprite ${spriteSheetId}`, resourcePath: actor.resourcePath });
            }
            const actorX = asNumber(actor.x);
            const actorY = asNumber(actor.y);
            const sceneWidth = asNumber(scene.width);
            const sceneHeight = asNumber(scene.height);
            if (actorX !== null && actorY !== null && sceneWidth !== null && sceneHeight !== null
                && (actorX < 0 || actorY < 0 || actorX >= sceneWidth || actorY >= sceneHeight)) {
                diagnostics.push({
                    severity: "error",
                    code: "ACTOR_OUT_OF_BOUNDS",
                    message: `Actor ${actor.name || actor.id} is outside the ${sceneWidth} by ${sceneHeight} scene`,
                    resourcePath: actor.resourcePath,
                });
            }
        }
        for (const trigger of scene.triggers) {
            const triggerX = asNumber(trigger.x);
            const triggerY = asNumber(trigger.y);
            const triggerWidth = asNumber(trigger.width);
            const triggerHeight = asNumber(trigger.height);
            const sceneWidth = asNumber(scene.width);
            const sceneHeight = asNumber(scene.height);
            if (triggerX !== null && triggerY !== null && triggerWidth !== null && triggerHeight !== null
                && sceneWidth !== null && sceneHeight !== null
                && (triggerX < 0 || triggerY < 0 || triggerWidth <= 0 || triggerHeight <= 0
                    || triggerX + triggerWidth > sceneWidth || triggerY + triggerHeight > sceneHeight)) {
                diagnostics.push({
                    severity: "error",
                    code: "TRIGGER_OUT_OF_BOUNDS",
                    message: `Trigger ${trigger.name || trigger.id} extends outside the ${sceneWidth} by ${sceneHeight} scene`,
                    resourcePath: trigger.resourcePath,
                });
            }
        }
    }
    const startSceneId = asString(settings.startSceneId);
    const startScene = scenes.find((scene) => scene.id === startSceneId);
    if (startSceneId && !startScene) {
        diagnostics.push({
            severity: "error",
            code: "START_SCENE_NOT_FOUND",
            message: `Project settings reference missing start scene ${startSceneId}`,
            resourcePath: format === "distributed" ? "project/settings.gbsres" : toRelative(projectRoot, discovery.projectPath),
        });
    }
    if (startScene) {
        const startX = asNumber(settings.startX);
        const startY = asNumber(settings.startY);
        const sceneWidth = asNumber(startScene.width);
        const sceneHeight = asNumber(startScene.height);
        if (startX !== null && startY !== null && sceneWidth !== null && sceneHeight !== null
            && (startX < 0 || startY < 0 || startX >= sceneWidth || startY >= sceneHeight)) {
            diagnostics.push({
                severity: "error",
                code: "START_POSITION_OUT_OF_BOUNDS",
                message: `Player start position is outside the ${sceneWidth} by ${sceneHeight} start scene`,
                resourcePath: startScene.resourcePath,
            });
        }
        const mappings = isObject(settings.defaultPlayerSprites) ? settings.defaultPlayerSprites : {};
        const sceneType = asString(startScene.type, asString(settings.defaultSceneTypeId, "TOPDOWN"));
        const effectiveSpriteId = asString(mappings[sceneType]);
        if (!effectiveSpriteId || !spriteIds.has(effectiveSpriteId)) {
            diagnostics.push({
                severity: "error",
                code: "PLAYER_SPRITE_NOT_FOUND",
                message: effectiveSpriteId
                    ? `Start scene type ${sceneType} references missing player sprite ${effectiveSpriteId}`
                    : `Start scene type ${sceneType} has no default player sprite`,
                resourcePath: format === "distributed" ? "project/settings.gbsres" : toRelative(projectRoot, discovery.projectPath),
            });
        }
    }
    if (!discovery.version)
        diagnostics.push({ severity: "warning", code: "VERSION_MISSING", message: "Project descriptor does not declare a project _version" });
    else if (format === "distributed" && Number(discovery.version.split(".")[0]) < 4) {
        diagnostics.push({ severity: "warning", code: "UNEXPECTED_PROJECT_VERSION", message: `Distributed resources usually require project format version 4 or newer; project declares ${discovery.version}` });
    }
    const actors = scenes.flatMap((scene) => scene.actors);
    const triggers = scenes.flatMap((scene) => scene.triggers);
    return {
        ...discovery,
        name: asString(descriptor.name, path.basename(discovery.projectPath, ".gbsproj")),
        author: asString(descriptor.author),
        settings,
        scenes,
        actors,
        triggers,
        palettes,
        assets,
        diagnostics,
        counts: { scenes: scenes.length, actors: actors.length, triggers: triggers.length, palettes: palettes.length, assets: assets.length },
    };
}
export async function inspectProject(projectPath, options = {}, indexedAccess) {
    if (indexedAccess) {
        assertIndexedProjectAccess(projectPath, indexedAccess);
        await indexedAccess.ensureFresh();
        if (options.diagnosticLimit === undefined)
            return indexedAccess.projectInspection();
        return inspectProjectSnapshot(await indexedAccess.snapshot(), {
            diagnosticLimit: options.diagnosticLimit,
        });
    }
    const snapshot = await loadProjectSnapshot(projectPath, {
        selectionGeneration: options.selectionGeneration,
    });
    return inspectProjectSnapshot(snapshot, { diagnosticLimit: options.diagnosticLimit });
}
function assertIndexedProjectAccess(projectPath, indexedAccess) {
    const requestedPath = path.resolve(projectPath);
    if (requestedPath !== indexedAccess.projectPath && requestedPath !== indexedAccess.projectRoot) {
        throw new GameStudioProjectError("STALE_PROJECT", "Indexed project access does not belong to the requested native game project", requestedPath);
    }
    if (indexedAccess.revisionAlgorithm !== PROJECT_REVISION_ALGORITHM) {
        throw new GameStudioProjectError("STALE_PROJECT", "Indexed project access uses an obsolete project revision algorithm");
    }
}
async function authoringContext(projectPath, indexedAccess, options = {}) {
    if (!indexedAccess)
        return inventoryProject(projectPath);
    assertIndexedProjectAccess(projectPath, indexedAccess);
    await indexedAccess.ensureFresh();
    const inspection = indexedAccess.projectInspection();
    const legacy = inspection.format === "legacy";
    const descriptor = legacy && options.includeLegacyDescriptor !== false
        ? await readJson(indexedAccess.projectRoot, indexedAccess.projectPath)
        : { name: inspection.name };
    let settings = {};
    if (options.includeSettings) {
        const cachedSettings = indexedAccess.settings;
        if (typeof cachedSettings === "function") {
            settings = cachedSettings.call(indexedAccess);
        }
        else if (legacy) {
            settings = isObject(descriptor.settings) ? descriptor.settings : {};
        }
        else {
            const settingsPath = path.join(indexedAccess.projectRoot, "project", "settings.gbsres");
            settings = await exists(settingsPath) ? await readJson(indexedAccess.projectRoot, settingsPath) : {};
        }
    }
    return {
        projectPath: indexedAccess.projectPath,
        projectRoot: indexedAccess.projectRoot,
        format: inspection.format,
        descriptor,
        settings,
        scenes: options.includeScenes
            ? indexedAccess.resourcesByKind("scene")
            : [],
        actors: [],
        // Indexed edits query their exact asset IDs directly rather than materializing all assets.
        assets: [],
    };
}
function findScene(inventory, sceneId, indexedAccess) {
    const scene = indexedAccess?.scene(sceneId)
        ?? (!indexedAccess ? inventory.scenes.find((candidate) => candidate.id === sceneId) : undefined);
    if (!scene)
        throw new GameStudioProjectError("SCENE_NOT_FOUND", `No scene with id ${sceneId} exists in this project`);
    return scene;
}
function resourceWithoutInventoryFields(resource) {
    const { resourcePath: _resourcePath, actors: _actors, triggers: _triggers, ...original } = resource;
    return original;
}
function sceneDefaults(inventory, input, id, index, slug) {
    return {
        _resourceType: "scene",
        id,
        _index: index,
        type: input.type ?? asString(inventory.settings.defaultSceneTypeId, "TOPDOWN"),
        name: input.name.trim(),
        symbol: input.symbol ?? `scene_${slug}`,
        x: input.x ?? 0,
        y: input.y ?? 0,
        width: input.width ?? 20,
        height: input.height ?? 18,
        backgroundId: input.backgroundId ?? "",
        tilesetId: "",
        colorModeOverride: "none",
        paletteIds: [],
        spritePaletteIds: [],
        autoFadeSpeed: 1,
        script: [],
        playerHit1Script: [],
        playerHit2Script: [],
        playerHit3Script: [],
        collisions: "",
    };
}
function validateDimensions(input) {
    for (const key of ["width", "height"]) {
        const value = input[key];
        if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > 255)) {
            throw new GameStudioProjectError("INVALID_INPUT", `Scene ${key} must be an integer between 1 and 255`);
        }
    }
}
/** Shared by direct and transactional scene edits; inspect the merged native resource. */
export function validateNativeSceneUpdate(previous, updated, changes, backgroundExists) {
    if (updated.name !== undefined)
        validateName(updated.name, "Scene name");
    for (const key of ["width", "height"]) {
        const value = updated[key];
        if (!Number.isInteger(value) || value < 1 || value > 255) {
            throw new GameStudioProjectError("INVALID_INPUT", `Scene ${key} must be an integer between 1 and 255`);
        }
    }
    const collisions = previous.collisions;
    const hasExistingCollisionGrid = typeof collisions === "string" || Array.isArray(collisions)
        ? collisions.length > 0
        : collisions !== undefined && collisions !== null;
    if ((updated.width !== previous.width || updated.height !== previous.height) && hasExistingCollisionGrid) {
        throw new GameStudioProjectError("INVALID_INPUT", "Resizing a scene with an existing collision grid requires explicit collision resizing semantics");
    }
    if (Object.prototype.hasOwnProperty.call(changes, "backgroundId") || updated.backgroundId !== previous.backgroundId) {
        if (updated.backgroundId !== undefined && typeof updated.backgroundId !== "string") {
            throw new GameStudioProjectError("INVALID_INPUT", "Scene backgroundId must be a string");
        }
        if (typeof updated.backgroundId === "string" && updated.backgroundId !== "" && !backgroundExists(updated.backgroundId)) {
            throw new GameStudioProjectError("BACKGROUND_NOT_FOUND", `No background with id ${updated.backgroundId} exists`);
        }
    }
    const invalid = findInvalidNativeScriptEvent(updated, previous, {
        explicitlyPatchedCoordinates: explicitlyPatchedNativeScriptCoordinates(changes),
    });
    if (invalid)
        throw new GameStudioProjectError("INVALID_EVENT", invalid.message);
}
function nextIndex(resources) {
    return resources.reduce((highest, resource) => Math.max(highest, asNumber(resource._index) ?? -1), -1) + 1;
}
async function availablePath(root, parent, base, extension) {
    for (let index = 1; index < 10_000; index++) {
        const slug = index === 1 ? base : `${base}_${index}`;
        const candidate = path.join(parent, `${slug}${extension}`);
        assertWithinRoot(root, candidate);
        if (!(await exists(candidate)))
            return { absolute: candidate, slug };
    }
    throw new GameStudioProjectError("RESOURCE_NAME_EXHAUSTED", `Could not choose a unique resource path for ${base}`);
}
export async function createScene(projectPath, input, indexedAccess) {
    validateName(input.name, "Scene name");
    validateDimensions(input);
    if (input.properties)
        assertSafeObject(input.properties, "Scene properties", true);
    const inventory = await authoringContext(projectPath, indexedAccess, {
        includeScenes: true,
        includeSettings: true,
        includeLegacyDescriptor: false,
    });
    const slugBase = safeSlug(input.name, "scene");
    if (inventory.format === "legacy") {
        const target = inventory.projectPath;
        return withProjectResourceWriteLock(inventory.projectRoot, target, async () => {
            const loaded = await readProjectJsonWithRevision(inventory.projectRoot, target);
            const originalScenes = Array.isArray(loaded.json.scenes) ? loaded.json.scenes : [];
            const scenes = originalScenes.filter(isObject).map((scene) => materializeResource(scene, toRelative(inventory.projectRoot, target)));
            const settings = isObject(loaded.json.settings) ? loaded.json.settings : {};
            const projectName = asString(loaded.json.name, "project");
            let slug = slugBase;
            let suffix = 1;
            while (scenes.some((scene) => safeSlug(scene.name, "scene") === slug || scene.symbol === `scene_${slug}`
                || (input.id === undefined && scene.id === stableId(projectName, "scene", slug))))
                slug = `${slugBase}_${++suffix}`;
            const id = input.id ?? stableId(projectName, "scene", slug);
            if (scenes.some((scene) => scene.id === id)) {
                throw new GameStudioProjectError("DUPLICATE_RESOURCE_ID", `A scene with id ${id} already exists`);
            }
            const scene = mergeObjects(sceneDefaults({ settings }, input, id, nextIndex(scenes), slug), input.properties ?? {});
            const invalid = findInvalidNativeScriptEvent(scene);
            if (invalid)
                throw new GameStudioProjectError("INVALID_EVENT", invalid.message);
            if (await resourceRevision(inventory.projectRoot, target) !== loaded.revision) {
                throw new GameStudioProjectError("STALE_RESOURCE", "The project descriptor changed before the requested scene creation", target);
            }
            await writeJsonAtomic(inventory.projectRoot, target, {
                ...loaded.json, scenes: [...originalScenes, { ...scene, actors: [], triggers: [] }],
            });
            await indexedAccess?.noteCommittedPaths([target]);
            return { projectPath: inventory.projectPath, projectRoot: inventory.projectRoot, resourcePath: toRelative(inventory.projectRoot, target), scene };
        });
    }
    const chosen = await availablePath(inventory.projectRoot, path.join(inventory.projectRoot, "project", "scenes"), slugBase, "");
    const { slug } = chosen;
    const target = path.join(chosen.absolute, "scene.gbsres");
    const id = input.id ?? stableId(inventory.descriptor.name ?? "project", "scene", slug);
    if (indexedAccess ? indexedAccess.scene(id) !== undefined : inventory.scenes.some((scene) => scene.id === id)) {
        throw new GameStudioProjectError("DUPLICATE_RESOURCE_ID", `A scene with id ${id} already exists`);
    }
    const scene = mergeObjects(sceneDefaults(inventory, input, id, nextIndex(inventory.scenes), slug), input.properties ?? {});
    const invalid = findInvalidNativeScriptEvent(scene);
    if (invalid)
        throw new GameStudioProjectError("INVALID_EVENT", invalid.message);
    await writeJsonAtomic(inventory.projectRoot, target, scene);
    await indexedAccess?.noteCommittedPaths([target]);
    return { projectPath: inventory.projectPath, projectRoot: inventory.projectRoot, resourcePath: toRelative(inventory.projectRoot, target), scene };
}
export async function updateScene(projectPath, input, indexedAccess) {
    if (input.name !== undefined)
        validateName(input.name, "Scene name");
    validateDimensions(input);
    if (input.properties)
        assertSafeObject(input.properties, "Scene properties", true);
    const inventory = await authoringContext(projectPath, indexedAccess);
    const existing = findScene(inventory, input.sceneId, indexedAccess);
    const updates = { ...(input.properties ?? {}) };
    for (const key of ["name", "type", "width", "height", "x", "y", "backgroundId"]) {
        if (input[key] !== undefined)
            updates[key] = input[key];
    }
    const target = path.join(inventory.projectRoot, existing.resourcePath);
    const backgroundExists = (id) => resolveNativeAssetIdentity(indexedAccess ?? inventory, id)?.type === "background";
    return withProjectResourceWriteLock(inventory.projectRoot, target, async () => {
        const loaded = await readProjectJsonWithRevision(inventory.projectRoot, target);
        let scene;
        let owner;
        if (inventory.format === "distributed") {
            scene = mergeObjects(loaded.json, updates);
            validateNativeSceneUpdate(loaded.json, scene, updates, backgroundExists);
            owner = scene;
        }
        else {
            const originalScenes = Array.isArray(loaded.json.scenes) ? loaded.json.scenes : [];
            const original = originalScenes.find((value) => isObject(value) && value.id === input.sceneId);
            if (!isObject(original))
                throw new GameStudioProjectError("SCENE_NOT_FOUND", `Scene ${input.sceneId} disappeared during update`);
            const updated = mergeObjects(original, updates);
            validateNativeSceneUpdate(original, updated, updates, backgroundExists);
            scene = resourceWithoutInventoryFields(updated);
            owner = { ...loaded.json, scenes: originalScenes.map((value) => value === original ? updated : value) };
        }
        if (await resourceRevision(inventory.projectRoot, target) !== loaded.revision) {
            throw new GameStudioProjectError("STALE_RESOURCE", "The target resource changed before the requested scene edit", target);
        }
        await writeJsonAtomic(inventory.projectRoot, target, owner);
        await indexedAccess?.noteCommittedPaths([target]);
        return { projectPath: inventory.projectPath, projectRoot: inventory.projectRoot, resourcePath: existing.resourcePath, scene };
    });
}
function actorDefaults(input, id, index, slug) {
    const script = [];
    if (input.dialogue !== undefined) {
        script.push({
            id: stableId(id, "script", "0", "EVENT_TEXT"),
            command: "EVENT_TEXT",
            args: { text: input.dialogue, avatarId: "" },
            __type: "event",
        });
    }
    return {
        _resourceType: "actor",
        id,
        _index: index,
        symbol: `actor_${slug}`,
        prefabId: "",
        name: input.name.trim(),
        coordinateType: "tiles",
        x: input.x ?? 0,
        y: input.y ?? 0,
        frame: 0,
        animate: false,
        spriteSheetId: input.spriteSheetId ?? "",
        paletteId: "",
        direction: input.direction ?? "down",
        moveSpeed: 1,
        animSpeed: 15,
        isPinned: false,
        persistent: false,
        collisionGroup: "",
        collisionExtraFlags: [],
        prefabScriptOverrides: {},
        script,
        startScript: [],
        updateScript: [],
        hit1Script: [],
        hit2Script: [],
        hit3Script: [],
    };
}
export async function createActor(projectPath, input, indexedAccess) {
    validateName(input.name, "Actor name");
    if (input.direction && !["up", "down", "left", "right"].includes(input.direction)) {
        throw new GameStudioProjectError("INVALID_INPUT", "Actor direction must be up, down, left, or right");
    }
    if (input.properties)
        assertSafeObject(input.properties, "Actor properties", true);
    const inventory = await authoringContext(projectPath, indexedAccess, { includeLegacyDescriptor: false });
    const scene = findScene(inventory, input.sceneId, indexedAccess);
    const base = safeSlug(input.name, "actor");
    const owner = path.join(inventory.projectRoot, scene.resourcePath);
    return withProjectResourceWriteLock(inventory.projectRoot, owner, async () => {
        const loaded = await readProjectJsonWithRevision(inventory.projectRoot, owner);
        let target;
        let slug = base;
        let ownerScene;
        let existingActors;
        let existingId;
        let ownerWithActor;
        if (inventory.format === "distributed") {
            if (loaded.json.id !== scene.id)
                throw new GameStudioProjectError("SCENE_NOT_FOUND", `Scene ${scene.id} disappeared during actor creation`);
            const actorsDirectory = path.join(path.dirname(owner), "actors");
            existingActors = await Promise.all((await walkFiles(inventory.projectRoot, actorsDirectory)).filter((filename) => filename.endsWith(".gbsres"))
                .map(async (filename) => materializeResource(await readJson(inventory.projectRoot, filename), toRelative(inventory.projectRoot, filename))));
            const chosen = await availablePath(inventory.projectRoot, actorsDirectory, base, ".gbsres");
            target = chosen.absolute;
            slug = chosen.slug;
            ownerScene = { ...scene, ...loaded.json, actors: existingActors };
            existingId = (id) => existingActors.some((actor) => actor.id === id) || (indexedAccess
                ? indexedAccess.resource({ type: "actor", id }) !== undefined
                : inventory.actors.some((actor) => actor.id === id));
        }
        else {
            target = owner;
            const originalScenes = Array.isArray(loaded.json.scenes) ? loaded.json.scenes : [];
            const original = originalScenes.find((value) => isObject(value) && value.id === scene.id);
            if (!isObject(original))
                throw new GameStudioProjectError("SCENE_NOT_FOUND", `Scene ${scene.id} disappeared during actor creation`);
            const originalActors = Array.isArray(original.actors) ? original.actors : [];
            existingActors = originalActors.filter(isObject).map((actor) => materializeResource(actor, scene.resourcePath));
            let suffix = 1;
            while (existingActors.some((actor) => safeSlug(actor.name, "actor") === slug || actor.symbol === `actor_${slug}`
                || (input.id === undefined && actor.id === stableId(scene.id, "actor", slug))))
                slug = `${base}_${++suffix}`;
            ownerScene = { ...scene, ...original, actors: existingActors };
            existingId = (id) => originalScenes.some((value) => isObject(value) && Array.isArray(value.actors)
                && value.actors.some((actor) => isObject(actor) && actor.id === id));
            ownerWithActor = (actor) => ({ ...loaded.json, scenes: originalScenes.map((value) => value === original
                    ? { ...original, actors: [...originalActors, actor] } : value) });
        }
        const id = input.id ?? stableId(scene.id, "actor", slug);
        if (existingId(id))
            throw new GameStudioProjectError("DUPLICATE_RESOURCE_ID", `An actor with id ${id} already exists`);
        const actor = mergeObjects(actorDefaults(input, id, nextIndex(existingActors), slug), input.properties ?? {});
        validateActorResource(indexedAccess ?? inventory, ownerScene, actor);
        if (await resourceRevision(inventory.projectRoot, owner) !== loaded.revision) {
            throw new GameStudioProjectError("STALE_RESOURCE", "The target scene changed before the requested actor creation", owner);
        }
        await writeJsonAtomic(inventory.projectRoot, target, ownerWithActor ? ownerWithActor(actor) : actor);
        await indexedAccess?.noteCommittedPaths([target]);
        return { projectPath: inventory.projectPath, projectRoot: inventory.projectRoot, sceneId: scene.id, resourcePath: toRelative(inventory.projectRoot, target), actor };
    });
}
function findTextEvent(events, eventId) {
    for (const value of events) {
        if (!isObject(value))
            continue;
        if (eventId && value.id === eventId) {
            if (value.command !== "EVENT_TEXT") {
                throw new GameStudioProjectError("INVALID_DIALOGUE_EVENT", `Event ${eventId} uses ${asString(value.command, "an unknown command")} and is not a supported dialogue event`);
            }
            return value;
        }
        if (!eventId && value.command === "EVENT_TEXT")
            return value;
        if (isObject(value.children)) {
            for (const child of Object.values(value.children)) {
                if (Array.isArray(child)) {
                    const nested = findTextEvent(child, eventId);
                    if (nested)
                        return nested;
                }
            }
        }
    }
    return undefined;
}
function applyDialogue(target, input) {
    const scriptKey = input.scriptKey ?? "script";
    if (!/^(?:script|[A-Za-z][A-Za-z0-9]*Script)$/.test(scriptKey)) {
        throw new GameStudioProjectError("INVALID_INPUT", `Unsupported script property ${scriptKey}`);
    }
    if (target[scriptKey] !== undefined && !Array.isArray(target[scriptKey])) {
        throw new GameStudioProjectError("INVALID_RESOURCE", `Resource ${asString(target.id)} has a non-array ${scriptKey}`);
    }
    const script = Array.isArray(target[scriptKey]) ? target[scriptKey] : [];
    target[scriptKey] = script;
    let event = findTextEvent(script, input.eventId);
    if (!event && input.eventId) {
        throw new GameStudioProjectError("EVENT_NOT_FOUND", `No dialogue event with id ${input.eventId} exists on this resource`);
    }
    const created = !event;
    if (!event) {
        event = {
            id: stableId(asString(target.id), scriptKey, String(script.length), "EVENT_TEXT"),
            command: "EVENT_TEXT",
            args: { text: input.text, avatarId: "" },
            __type: "event",
        };
        script.push(event);
    }
    else {
        event.args = { ...(isObject(event.args) ? event.args : {}), text: input.text };
    }
    return { event, created };
}
export async function updateDialogue(projectPath, input, indexedAccess) {
    if (input.actorId && input.triggerId) {
        throw new GameStudioProjectError("INVALID_INPUT", "Specify either actorId or triggerId, not both");
    }
    if (!(typeof input.text === "string" || (Array.isArray(input.text) && input.text.every((line) => typeof line === "string")))) {
        throw new GameStudioProjectError("INVALID_INPUT", "Dialogue text must be a string or an array of strings");
    }
    const inventory = await authoringContext(projectPath, indexedAccess, { includeLegacyDescriptor: false });
    const scene = findScene(inventory, input.sceneId, indexedAccess);
    const actor = input.actorId
        ? indexedAccess?.actor(scene.id, input.actorId)
            ?? (!indexedAccess ? scene.actors.find((candidate) => candidate.id === input.actorId) : undefined)
        : undefined;
    const trigger = input.triggerId
        ? indexedAccess?.trigger(scene.id, input.triggerId)
            ?? (!indexedAccess ? scene.triggers.find((candidate) => candidate.id === input.triggerId) : undefined)
        : undefined;
    if (input.actorId && !actor)
        throw new GameStudioProjectError("ACTOR_NOT_FOUND", `No actor with id ${input.actorId} exists in scene ${scene.id}`);
    if (input.triggerId && !trigger)
        throw new GameStudioProjectError("TRIGGER_NOT_FOUND", `No trigger with id ${input.triggerId} exists in scene ${scene.id}`);
    const selected = actor ?? trigger ?? scene;
    const target = path.join(inventory.projectRoot, selected.resourcePath);
    return withProjectResourceWriteLock(inventory.projectRoot, target, async () => {
        const loaded = await readProjectJsonWithRevision(inventory.projectRoot, target);
        const stale = () => {
            throw new GameStudioProjectError("STALE_RESOURCE", "The target resource changed before the requested dialogue edit", target);
        };
        if (input.expectedRevision !== undefined && loaded.revision !== input.expectedRevision)
            stale();
        const owner = loaded.json;
        let result;
        if (inventory.format === "distributed") {
            result = applyDialogue(owner, input);
        }
        else {
            const existingScene = (Array.isArray(owner.scenes) ? owner.scenes : []).find((candidate) => isObject(candidate) && candidate.id === scene.id);
            if (!isObject(existingScene))
                throw new GameStudioProjectError("SCENE_NOT_FOUND", `Scene ${scene.id} disappeared during update`);
            let selectedResource = existingScene;
            if (actor || trigger) {
                const collection = existingScene[actor ? "actors" : "triggers"];
                const matching = (Array.isArray(collection) ? collection : []).find((candidate) => isObject(candidate) && candidate.id === selected.id);
                if (!isObject(matching))
                    throw new GameStudioProjectError("RESOURCE_NOT_FOUND", `Resource ${selected.id} disappeared during update`);
                selectedResource = matching;
            }
            result = applyDialogue(selectedResource, input);
        }
        const output = Buffer.from(`${JSON.stringify(owner, null, 2)}\n`, "utf8");
        if (await resourceRevision(inventory.projectRoot, target) !== loaded.revision)
            stale();
        await writeProjectBytesAtomic(inventory.projectRoot, target, output);
        const revision = createHash("sha256").update(output).digest("hex");
        await indexedAccess?.noteCommittedPaths([target]);
        return {
            projectPath: inventory.projectPath,
            projectRoot: inventory.projectRoot,
            sceneId: scene.id,
            ...(actor ? { actorId: actor.id } : {}),
            ...(trigger ? { triggerId: trigger.id } : {}),
            resourcePath: selected.resourcePath,
            ...result,
            revision,
        };
    });
}
export async function updateSettings(projectPath, updates, indexedAccess) {
    if (!isObject(updates))
        throw new GameStudioProjectError("INVALID_INPUT", "Settings updates must be a JSON object");
    assertSafeObject(updates, "Settings updates", true);
    const inventory = await authoringContext(projectPath, indexedAccess, { includeSettings: true, includeLegacyDescriptor: false });
    const target = inventory.format === "distributed"
        ? path.join(inventory.projectRoot, "project", "settings.gbsres")
        : inventory.projectPath;
    if (inventory.format === "distributed" && !(await exists(target))) {
        const settings = mergeObjects({ _resourceType: "settings", ...inventory.settings }, updates);
        await writeJsonAtomic(inventory.projectRoot, target, settings);
        await indexedAccess?.noteCommittedPaths([target]);
        return { projectPath: inventory.projectPath, projectRoot: inventory.projectRoot, resourcePath: toRelative(inventory.projectRoot, target), settings };
    }
    return withProjectResourceWriteLock(inventory.projectRoot, target, async () => {
        const loaded = await readProjectJsonWithRevision(inventory.projectRoot, target);
        const original = inventory.format === "distributed"
            ? { _resourceType: "settings", ...loaded.json }
            : (isObject(loaded.json.settings) ? loaded.json.settings : {});
        const settings = mergeObjects(original, updates);
        if (await resourceRevision(inventory.projectRoot, target) !== loaded.revision) {
            throw new GameStudioProjectError("STALE_RESOURCE", "The target resource changed before the requested settings edit", target);
        }
        await writeJsonAtomic(inventory.projectRoot, target, inventory.format === "distributed" ? settings : { ...loaded.json, settings });
        await indexedAccess?.noteCommittedPaths([target]);
        return { projectPath: inventory.projectPath, projectRoot: inventory.projectRoot, resourcePath: toRelative(inventory.projectRoot, target), settings };
    });
}
//# sourceMappingURL=project.js.map