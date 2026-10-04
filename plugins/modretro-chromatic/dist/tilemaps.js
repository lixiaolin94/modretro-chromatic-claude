import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { PNG } from "pngjs";
import { createBackgroundMetadata, decodePngBytes, validateBackgroundPng } from "./assets.js";
import { applyCollisionEdits } from "./collisions.js";
import { analyzeGraphicsImage } from "./graphics.js";
import { applyBackgroundPaletteEdits, decodeBackgroundPaletteTiles, resolvePaletteSlots, resolveUiPalette } from "./palettes.js";
import { resolveProjectPath, stableResourceId } from "./project-files.js";
import { ProjectWorldIndex } from "./project-world-index.js";
import { reviewedNativeBackgroundOwner } from "./wrecklight-dependencies.js";
import { decodeResourceBytes } from "./resource-codec.js";
import { applyPreparedProjectTransaction } from "./scene-batch.js";
import { applyTilemapOperations, prepareAtlasPixels, renderTilemap, replaceTilemapCells, setTilemapCollisionCells, sha256, tilemapDiff, tilemapError, tilePixels, validateRoomCells, validateRoomDimensions } from "./tilemap-compose.js";
import { atlasSchema, MAX_TILEMAP_JSON_BYTES, roomSchema, tilemapSchemas } from "./tilemap-schema.js";
const MAX_PNG_BYTES = 16 * 1024 * 1024;
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
function parse(schema, value) {
    const result = schema.safeParse(value);
    if (!result.success)
        tilemapError("INVALID_TILEMAP_INPUT", result.error.issues.slice(0, 6).map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
    return result.data;
}
/** Authoring manifests and sources participate in the existing project revision domain. */
async function ownedPath(root, candidate, kind) {
    const prefix = kind === "background" ? "assets/backgrounds/" : "project/tilemaps/";
    const suffix = kind === "atlas" ? ".atlas.json" : kind === "recipe" ? ".room.json" : ".png";
    if (path.isAbsolute(candidate) || candidate.includes("\\") || candidate.includes(":") || !candidate.startsWith(prefix) || !candidate.endsWith(suffix) ||
        candidate.split("/").some((segment) => !segment || segment === "." || segment === "..")) {
        tilemapError("INVALID_TILEMAP_PATH", `${kind} paths must be normalized project-relative ${prefix}…${suffix} paths.`);
    }
    const absolute = path.resolve(root, candidate);
    const resolved = await resolveProjectPath(root, absolute);
    if (absolute !== resolved)
        tilemapError("UNSAFE_SYMLINK", "Tilemap ownership paths cannot use symbolic-link aliases.");
    // An internal symlink is legal for some legacy readers but not for revision-owned recipes.
    let current = root;
    for (const segment of candidate.split("/")) {
        current = path.join(current, segment);
        try {
            if ((await lstat(current)).isSymbolicLink())
                tilemapError("UNSAFE_SYMLINK", "Tilemap ownership paths cannot contain symbolic links.");
        }
        catch (error) {
            if (error.code === "ENOENT")
                break;
            throw error;
        }
    }
    return absolute;
}
async function readBytes(root, candidate, maximum) {
    const filename = await resolveProjectPath(root, candidate, { mustExist: true });
    const before = await lstat(filename);
    if (filename !== path.resolve(root, candidate) || before.isSymbolicLink()) {
        tilemapError("UNSAFE_SYMLINK", "Tilemap inputs cannot use untracked symbolic-link aliases.");
    }
    if (!before.isFile() || before.size > maximum)
        tilemapError("TILEMAP_LIMIT", `Tilemap input must be a regular file no larger than ${maximum} bytes.`);
    const flags = constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0);
    const handle = await open(filename, flags).catch((error) => {
        if (error.code === "ELOOP")
            tilemapError("UNSAFE_SYMLINK", "Tilemap input was exchanged for a symbolic link before opening.");
        throw error;
    });
    try {
        const info = await handle.stat();
        const confirmedPath = await resolveProjectPath(root, candidate, { mustExist: true });
        const confirmed = await lstat(confirmedPath);
        if (confirmedPath !== filename || confirmed.isSymbolicLink() || info.dev !== before.dev || info.ino !== before.ino || info.dev !== confirmed.dev || info.ino !== confirmed.ino) {
            tilemapError("UNSAFE_SYMLINK", "Tilemap input identity changed before its confined read.");
        }
        if (!info.isFile() || info.size > maximum)
            tilemapError("TILEMAP_LIMIT", `Tilemap input must be a regular file no larger than ${maximum} bytes.`);
        // The extra byte detects growth without an unbounded readFile allocation.
        const bytes = Buffer.alloc(info.size + 1);
        let length = 0;
        while (length < bytes.length) {
            const { bytesRead } = await handle.read(bytes, length, bytes.length - length, length);
            if (bytesRead === 0)
                break;
            length += bytesRead;
        }
        const after = await handle.stat();
        if (length !== info.size || after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ctimeMs !== info.ctimeMs) {
            tilemapError("STALE_PROJECT_REVISION", "Tilemap input changed during its bounded read.");
        }
        return bytes.subarray(0, length);
    }
    finally {
        await handle.close();
    }
}
function parseJson(bytes) {
    try {
        return JSON.parse(bytes.toString("utf8"));
    }
    catch {
        tilemapError("INVALID_TILEMAP_INPUT", "Tilemap JSON could not be parsed.");
    }
}
async function requireMissing(root, filename) {
    const safe = await resolveProjectPath(root, filename);
    try {
        await lstat(safe);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return;
        throw error;
    }
    tilemapError("TILEMAP_ALREADY_EXISTS", `Refusing to overwrite existing resource ${filename}.`);
}
async function rejectMonoCompanion(root, filename) {
    const companion = filename.replace(/\.png$/u, ".mono.png");
    const safe = await resolveProjectPath(root, companion);
    try {
        await lstat(safe);
    }
    catch (error) {
        if (error.code === "ENOENT")
            return;
        throw error;
    }
    tilemapError("UNSUPPORTED_TILEMAP_BACKGROUND", "A separate monochrome companion requires its own authoring contract; tilemap v1 will not omit or overwrite it.");
}
async function readAtlas(root, atlasPath, binding) {
    await ownedPath(root, atlasPath, "atlas");
    const bytes = await readBytes(root, atlasPath, MAX_TILEMAP_JSON_BYTES);
    const rawAtlas = parseJson(bytes);
    parse(atlasSchema, rawAtlas);
    const atlas = rawAtlas;
    if (binding && (binding.path !== atlasPath || binding.sha256 !== sha256(bytes) || binding.sourceSha256 !== atlas.sourceSha256 ||
        (binding.id !== undefined && binding.id !== atlas.id) || (binding.sourcePath !== undefined && binding.sourcePath !== atlas.sourcePath))) {
        tilemapError("STALE_TILEMAP_ATLAS", "The atlas differs from its explicit recipe-owned registration.");
    }
    if (!binding && atlas.id !== stableResourceId("tilemap-atlas", atlasPath))
        tilemapError("STALE_TILEMAP_ATLAS", "Atlas identity no longer matches its registered path.");
    await ownedPath(root, atlas.sourcePath, "source");
    const source = await readBytes(root, atlas.sourcePath, MAX_PNG_BYTES);
    if (sha256(source) !== atlas.sourceSha256)
        tilemapError("STALE_TILEMAP_ATLAS", "Atlas source PNG changed; explicitly register a new atlas version instead of repainting existing rooms.");
    return { atlas, bytes, sourceBytes: source, pixels: prepareAtlasPixels(atlas, decodePngBytes(source)) };
}
function selectedScene(snapshot, sceneId) {
    const scene = snapshot.scenesById.get(sceneId);
    if (!scene || snapshot.inventory.scenes.filter((candidate) => candidate.id === sceneId).length !== 1)
        tilemapError("SCENE_NOT_FOUND", `Scene ${sceneId} must resolve uniquely in the selected project.`);
    validateRoomDimensions(Number(scene.width), Number(scene.height));
    if (typeof scene.tilesetId === "string" && scene.tilesetId !== "") {
        tilemapError("UNSUPPORTED_TILEMAP_SCENE", "Scenes with an explicit native tileset binding require a separate integration contract.");
    }
    return scene;
}
function decodeCollisions(scene, count) {
    if (typeof scene.collisions !== "string")
        tilemapError("INVALID_COLLISIONS", "Collisions must be a native byte-run string; tilemaps never reset invalid grids.");
    const decoded = decodeResourceBytes(scene.collisions, { maximumValues: count, allowImplicitZeroGrid: true });
    const cells = new Uint8Array(count);
    cells.set(decoded);
    return cells;
}
async function readBackground(snapshot, scene) {
    const asset = snapshot.assetsById.get(String(scene.backgroundId));
    if (!asset || asset.type !== "background" || !asset.metadataPath || snapshot.inventory.assets.filter((candidate) => candidate.id === asset.id).length !== 1)
        tilemapError("BACKGROUND_NOT_FOUND", "The selected scene must use a unique registered native background.");
    await ownedPath(snapshot.projectRoot, asset.resourcePath, "background");
    await rejectMonoCompanion(snapshot.projectRoot, asset.resourcePath);
    const pngBytes = await readBytes(snapshot.projectRoot, asset.resourcePath, MAX_PNG_BYTES);
    const metadataBytes = await readBytes(snapshot.projectRoot, asset.metadataPath, MAX_TILEMAP_JSON_BYTES);
    const metadata = parseJson(metadataBytes);
    if (!metadata || metadata._resourceType !== "background" || metadata.id !== asset.id || metadata.autoColor === true || metadata.autoColor === 1) {
        tilemapError("UNSUPPORTED_TILEMAP_BACKGROUND", "Tilemap v1 requires a registered manual-color background with matching identity.");
    }
    const image = decodePngBytes(pngBytes);
    validateBackgroundPng(image, false);
    if (image.width !== Number(scene.width) * 8 || image.height !== Number(scene.height) * 8 ||
        metadata.width !== scene.width || metadata.height !== scene.height || metadata.imageWidth !== image.width || metadata.imageHeight !== image.height) {
        tilemapError("TILEMAP_DIMENSION_MISMATCH", "Scene, PNG and native metadata dimensions must already match; no resize is inferred.");
    }
    return { asset, pngBytes, metadataBytes, metadata, image };
}
function palettePolicy(snapshot, scene) {
    const reservedUiSlot = resolveUiPalette(snapshot.inventory).slot;
    const assignedSlots = resolvePaletteSlots(snapshot.inventory, scene, "background")
        .flatMap((palette, index) => palette === null ? [] : [index]);
    return { reservedUiSlot, assignedSlots };
}
function checkPalette(slot, policy, reserved) {
    if (slot === policy.reservedUiSlot)
        tilemapError("UI_PALETTE_SLOT_RESERVED", `Background palette slot ${slot} is reserved for UI/fonts.`);
    if (reserved.includes(slot))
        tilemapError("TILEMAP_RESERVED_PALETTE", `Background palette slot ${slot} is reserved by this recipe.`);
    if (!policy.assignedSlots.includes(slot))
        tilemapError("UNASSIGNED_PALETTE_SLOT", `Scene background palette slot ${slot} has no native assignment.`);
}
function captureCells(image, pixels, palettes, collisions) {
    const firstTileByPattern = new Map();
    for (const [id, pattern] of pixels.patterns)
        if (!firstTileByPattern.has(pattern))
            firstTileByPattern.set(pattern, id);
    const width = image.width / 8;
    return Array.from({ length: width * (image.height / 8) }, (_, index) => {
        const tileId = firstTileByPattern.get(sha256(tilePixels(image, index % width, Math.floor(index / width))));
        if (!tileId)
            tilemapError("TILEMAP_CAPTURE_TILE_MISSING", `Existing tile (${index % width}, ${Math.floor(index / width)}) has no exact named atlas match; capture wrote nothing. Add an explicit source tile and register a new atlas version.`);
        return { tileId, paletteByte: palettes[index], collisionByte: collisions[index] };
    });
}
function sourceAnalysis(snapshot, scene, room, image) {
    const override = scene.colorModeOverride;
    const mode = (override === "mono" || override === "mixed" || override === "color" ? override : snapshot.settings.colorMode ?? "mixed");
    const analysis = analyzeGraphicsImage(image, room.backgroundPath, { kind: "background", colorMode: mode, allowFlipDeduplication: false });
    if (!analysis.valid || analysis.validationStatus !== "valid")
        tilemapError("TILEMAP_GRAPHICS_INVALID", `Native background analysis failed: ${JSON.stringify(analysis.violationCounts)}.`);
    const cap = Math.min(room.maxUniqueTiles ?? analysis.tileBudget.limit, analysis.tileBudget.limit);
    if (analysis.uniqueTiles > cap)
        tilemapError("TILEMAP_TILE_BUDGET", `${analysis.uniqueTiles} exact 8 × 8 patterns exceed the caller/native cap ${cap}.`);
    const tileSlotHistogram = {};
    for (const cell of room.cells)
        tileSlotHistogram[cell.paletteByte] = (tileSlotHistogram[cell.paletteByte] ?? 0) + 1;
    return { uniqueTiles: analysis.uniqueTiles, totalTiles: analysis.totalTiles, nativeLimit: analysis.tileBudget.limit, receivingCap: cap, colorMode: mode, flipDeduplication: false, tileSlotHistogram, validation: "authored-source-only" };
}
function outputReceipt(room, recipePath, recipeBytes = jsonBytes(room)) {
    return {
        recipePath, atlasPath: room.atlasPath, sceneId: room.sceneId, backgroundId: room.backgroundId,
        predecessorBackgroundId: room.predecessorBackgroundId, width: room.width, height: room.height, units: room.units,
        outputs: { png: { path: room.backgroundPath, sha256: room.native.pngSha256 }, metadata: { path: `${room.backgroundPath}.gbsres`, sha256: room.native.metadataSha256 }, recipe: { path: recipePath, sha256: sha256(recipeBytes) } },
    };
}
async function createTilemapAtlasIndexed(projectPath, rawInput, access) {
    const input = parse(tilemapSchemas.atlasCreate, rawInput);
    const { value, ...transaction } = await applyPreparedProjectTransaction(projectPath, input, async (snapshot) => {
        await ownedPath(snapshot.projectRoot, input.atlasPath, "atlas");
        await ownedPath(snapshot.projectRoot, input.sourcePath, "source");
        await requireMissing(snapshot.projectRoot, input.atlasPath);
        const source = await readBytes(snapshot.projectRoot, input.sourcePath, MAX_PNG_BYTES);
        const atlas = parse(atlasSchema, { format: "gb-studio-tile-atlas", version: 1, id: stableResourceId("tilemap-atlas", input.atlasPath), name: input.name, sourcePath: input.sourcePath, sourceSha256: sha256(source), tiles: input.tiles, primitives: input.primitives });
        const pixels = prepareAtlasPixels(atlas, decodePngBytes(source));
        const bytes = jsonBytes(atlas);
        if (bytes.length > MAX_TILEMAP_JSON_BYTES)
            tilemapError("TILEMAP_LIMIT", "Atlas definition exceeds its bounded JSON size.");
        return { files: [{ relativePath: input.atlasPath, before: null, after: bytes }], value: { atlasPath: input.atlasPath, id: atlas.id, atlasSha256: sha256(bytes), sourceSha256: atlas.sourceSha256, tiles: atlas.tiles.length, primitives: atlas.primitives.length, uniquePatterns: new Set(pixels.patterns.values()).size } };
    }, access);
    return { ...value, ...transaction };
}
async function createTilemapIndexed(projectPath, rawInput, access) {
    const input = parse(tilemapSchemas.create, rawInput);
    const { value, ...transaction } = await applyPreparedProjectTransaction(projectPath, input, async (snapshot) => {
        await ownedPath(snapshot.projectRoot, input.recipePath, "recipe");
        await ownedPath(snapshot.projectRoot, input.backgroundPath, "background");
        await rejectMonoCompanion(snapshot.projectRoot, input.backgroundPath);
        for (const filename of [input.recipePath, input.backgroundPath, `${input.backgroundPath}.gbsres`])
            await requireMissing(snapshot.projectRoot, filename);
        const scene = selectedScene(snapshot, input.sceneId);
        const existing = await readBackground(snapshot, scene);
        const { atlas, bytes: atlasBytes, pixels } = await readAtlas(snapshot.projectRoot, input.atlasPath);
        const width = Number(scene.width), height = Number(scene.height);
        const collisions = decodeCollisions(scene, width * height);
        const palettes = decodeBackgroundPaletteTiles(existing.metadata, width * height);
        const policy = palettePolicy(snapshot, scene);
        const reserved = [...new Set([...(input.reservedPaletteSlots ?? []), policy.reservedUiSlot])].sort();
        let cells;
        if (input.base.type === "existing") {
            cells = captureCells(existing.image, pixels, palettes, collisions);
        }
        else {
            if (!pixels.tiles.has(input.base.tileId))
                tilemapError("TILE_NOT_FOUND", `No source tile ${input.base.tileId} exists.`);
            checkPalette(input.base.paletteSlot, policy, reserved);
            if ((input.protectedRegions?.length ?? 0) > 0)
                tilemapError("TILEMAP_PROTECTED_REGION", "A full initial fill cannot claim to preserve protected source regions; use exact existing-pattern capture.");
            const base = input.base;
            cells = Array.from({ length: width * height }, (_, index) => ({ tileId: base.tileId, paletteByte: base.paletteSlot, collisionByte: collisions[index] }));
        }
        const backgroundId = stableResourceId("asset", "background", input.backgroundPath);
        if (snapshot.inventory.assets.some((asset) => asset.id === backgroundId))
            tilemapError("DUPLICATE_RESOURCE_ID", "The output background identity already exists.");
        const nativeMetadata = createBackgroundMetadata({ id: backgroundId, name: input.name, filename: path.basename(input.backgroundPath), widthPx: width * 8, heightPx: height * 8 });
        const metadata = input.base.type === "existing" ? { ...existing.metadata, ...nativeMetadata } : nativeMetadata;
        // Avoid scene-local name-derived symbols. IDs are deterministic and project-global.
        metadata.symbol = `bg_tilemap_${backgroundId.replaceAll("-", "")}`;
        const existingResources = [...snapshot.inventory.scenes, ...snapshot.inventory.actors, ...snapshot.inventory.triggers, ...snapshot.inventory.palettes];
        for (const resource of existingResources)
            if (resource.symbol === metadata.symbol)
                tilemapError("DUPLICATE_RESOURCE_SYMBOL", `Native symbol ${String(metadata.symbol)} already exists.`);
        for (const asset of snapshot.inventory.assets) {
            if (!asset.metadataPath)
                continue;
            const resource = parseJson(await readBytes(snapshot.projectRoot, asset.metadataPath, MAX_TILEMAP_JSON_BYTES));
            if (resource.symbol === metadata.symbol)
                tilemapError("DUPLICATE_RESOURCE_SYMBOL", `Native symbol ${String(metadata.symbol)} already exists.`);
        }
        let room = {
            format: "gb-studio-tilemap-room", version: 1, id: stableResourceId("tilemap-room", input.recipePath), name: input.name, units: "8px-tiles",
            atlasPath: input.atlasPath, atlasSha256: sha256(atlasBytes), sceneId: scene.id, backgroundId, backgroundPath: input.backgroundPath,
            predecessorBackgroundId: String(scene.backgroundId), width, height, cells,
            protectedRegions: input.protectedRegions ?? [], reservedPaletteSlots: reserved,
            ...(input.maxUniqueTiles === undefined ? {} : { maxUniqueTiles: input.maxUniqueTiles }),
            native: { pngSha256: "0".repeat(64), metadataSha256: "0".repeat(64), collisions: String(scene.collisions) },
        };
        validateRoomCells(room, pixels);
        const image = renderTilemap(room, pixels);
        const analysis = sourceAnalysis(snapshot, scene, room, image);
        const png = input.base.type === "existing" ? existing.pngBytes : PNG.sync.write(image);
        // Capture preserves the exact native encoding, including opaque palette attribute bytes.
        if (input.base.type === "existing")
            metadata.tileColors = existing.metadata.tileColors;
        else {
            const base = input.base;
            metadata.tileColors = applyBackgroundPaletteEdits(metadata, { width, height, edits: [{ x: 0, y: 0, width, height, slot: base.paletteSlot }], ...policy }).metadata.tileColors;
        }
        const metadataBytes = jsonBytes(metadata);
        room = { ...room, native: { ...room.native, pngSha256: sha256(png), metadataSha256: sha256(metadataBytes) } };
        const asset = { id: backgroundId, name: input.name, type: "background", filename: path.basename(input.backgroundPath), resourcePath: input.backgroundPath, metadataPath: `${input.backgroundPath}.gbsres`, hasMetadata: true, width: width * 8, height: height * 8 };
        return {
            files: [
                { relativePath: input.recipePath, before: null, after: jsonBytes(room) },
                { relativePath: input.backgroundPath, before: null, after: png },
                { relativePath: `${input.backgroundPath}.gbsres`, before: null, after: metadataBytes },
            ],
            sceneBatch: { sceneId: scene.id, operations: [{ type: "scene.update", properties: { backgroundId } }], newAssets: [asset] },
            value: { ...outputReceipt(room, input.recipePath), analysis, initialComposition: input.base.type, sceneFields: ["backgroundId"], predecessorRetained: true, collisionsChanged: 0 },
        };
    }, access);
    return { ...value, ...transaction };
}
async function loadBoundRoom(snapshot, recipePath, access, adoption) {
    await ownedPath(snapshot.projectRoot, recipePath, "recipe");
    const recipeBytes = await readBytes(snapshot.projectRoot, recipePath, MAX_TILEMAP_JSON_BYTES);
    const rawRoom = parseJson(recipeBytes);
    parse(roomSchema, rawRoom);
    // Schema validation must not normalize full retained records (for example names).
    const room = rawRoom;
    if (adoption && (room.adoptedBinding || sha256(recipeBytes) !== adoption.before.recipeSha256 ||
        room.id !== adoption.identity.roomId || room.backgroundId !== adoption.identity.backgroundId || room.sceneId !== adoption.identity.sceneId)) {
        tilemapError("TILEMAP_ADOPTION_PREIMAGE", "Adoption requires the exact unadopted recipe preimage.");
    }
    const binding = room.adoptedBinding;
    if (binding ? binding.atlas.sha256 !== binding.preimages.atlasSha256 || binding.atlas.sourceSha256 !== binding.preimages.sourceSha256 ||
        binding.recipePath !== recipePath || binding.roomId !== room.id || binding.sceneId !== room.sceneId ||
        binding.backgroundId !== room.backgroundId || binding.backgroundPath !== room.backgroundPath :
        !adoption && (room.id !== stableResourceId("tilemap-room", recipePath) || room.backgroundId !== stableResourceId("asset", "background", room.backgroundPath))) {
        tilemapError("STALE_TILEMAP_BINDING", "Recipe or background identity no longer matches its registered path.");
    }
    const scene = selectedScene(snapshot, room.sceneId);
    if (scene.backgroundId !== room.backgroundId || scene.width !== room.width || scene.height !== room.height)
        tilemapError("STALE_TILEMAP_BINDING", "The scene binding/dimensions changed outside this recipe; no automatic rebind or resize is permitted.");
    if (scene.collisions !== room.native.collisions)
        tilemapError("STALE_TILEMAP_OUTPUT", "Native collisions changed outside this recipe; no collision overwrite is permitted.");
    const background = await readBackground(snapshot, scene);
    if (background.asset.resourcePath !== room.backgroundPath || sha256(background.pngBytes) !== room.native.pngSha256 || sha256(background.metadataBytes) !== room.native.metadataSha256)
        tilemapError("STALE_TILEMAP_OUTPUT", "The native PNG or sidecar changed outside this recipe; preserve the edit and explicitly capture a new version.");
    if (snapshot.inventory.scenes.some((other) => other.id !== scene.id && other.backgroundId === room.backgroundId))
        tilemapError("TILEMAP_SHARED_BACKGROUND", "This background is now shared; create an additive room version instead of repainting other scenes.");
    if (!access.coverage.complete)
        tilemapError("TILEMAP_DEPENDENCY_UNCERTAIN", "The selected project's dependency coverage is incomplete; no native tilemap output was changed. Use world_dependencies and its coverageCursor for the actual reasons, including unresolved native references or an unsupported custom-event source, authored contract, or invocation. Successful compilation, retrying or adopt_binding cannot establish an unsupported custom-event contract. Atlas-only inspection remains available.");
    const references = access.structuralReferences({ type: "asset", id: room.backgroundId, resourcePath: background.asset.metadataPath });
    if (references.some((reference) => reference.owner.sceneId !== scene.id && reference.owner.resourcePath !== background.asset.metadataPath
        && reviewedNativeBackgroundOwner(reference, background.asset.metadataPath) !== scene.id))
        tilemapError("TILEMAP_SHARED_BACKGROUND", "Another authored owner references this background; replacement is not confined to the selected scene.");
    const atlasBinding = adoption
        ? { path: room.atlasPath, id: adoption.identity.atlasId, sha256: adoption.before.atlasSha256, sourceSha256: adoption.before.sourceSha256 }
        : binding?.atlas.path === room.atlasPath ? binding.atlas : undefined;
    const { atlas, bytes: atlasBytes, sourceBytes, pixels } = await readAtlas(snapshot.projectRoot, room.atlasPath, atlasBinding);
    if (sha256(atlasBytes) !== room.atlasSha256)
        tilemapError("STALE_TILEMAP_ATLAS", "Atlas manifest changed; register/capture a new version explicitly.");
    validateRoomCells(room, pixels);
    const currentPalettes = decodeBackgroundPaletteTiles(background.metadata, room.cells.length);
    const currentCollisions = decodeCollisions(scene, room.cells.length);
    if (!renderTilemap(room, pixels).data.equals(background.image.data) || room.cells.some((cell, index) => cell.paletteByte !== currentPalettes[index] || cell.collisionByte !== currentCollisions[index])) {
        tilemapError("TILEMAP_RECIPE_DIVERGED", "Recipe cells differ from their compiled native state; use tilemap_edit or explicitly capture a new recipe, never an implicit repaint.");
    }
    return { room, recipeBytes, scene, background, atlas, atlasBytes, sourceBytes, pixels };
}
async function adoptTilemapBinding(projectPath, input, operation, access) {
    const { value, ...transaction } = await applyPreparedProjectTransaction(projectPath, input, async (snapshot) => {
        const bound = await loadBoundRoom(snapshot, input.recipePath, access, operation);
        const sceneBytes = await readBytes(snapshot.projectRoot, bound.scene.resourcePath, MAX_TILEMAP_JSON_BYTES);
        const preimages = {
            recipeSha256: sha256(bound.recipeBytes), atlasSha256: sha256(bound.atlasBytes), sourceSha256: sha256(bound.sourceBytes),
            pngSha256: sha256(bound.background.pngBytes), metadataSha256: sha256(bound.background.metadataBytes), sceneSha256: sha256(sceneBytes),
        };
        for (const key of Object.keys(preimages)) {
            if (operation.before[key] !== preimages[key])
                tilemapError("TILEMAP_ADOPTION_PREIMAGE", `Adoption preimage mismatch: ${key}.`);
        }
        const room = { ...bound.room, adoptedBinding: {
                version: 1, recipePath: input.recipePath, roomId: bound.room.id, sceneId: bound.room.sceneId,
                backgroundId: bound.room.backgroundId, backgroundPath: bound.room.backgroundPath,
                atlas: { path: bound.room.atlasPath, id: bound.atlas.id, sha256: preimages.atlasSha256, sourcePath: bound.atlas.sourcePath, sourceSha256: preimages.sourceSha256 },
                preimages,
            } };
        const recipeBytes = jsonBytes(room);
        if (recipeBytes.length > MAX_TILEMAP_JSON_BYTES)
            tilemapError("TILEMAP_LIMIT", "Adopted recipe exceeds its bounded JSON size.");
        const analysis = sourceAnalysis(snapshot, bound.scene, room, bound.background.image);
        // Only the recipe changes. Exact no-op entries recheck ALL input preimages at
        // commit without repainting, re-encoding collisions, or invalidating other
        // recipes that pin the same immutable atlas. No newAssets or scene rebind.
        const unchanged = [
            [bound.room.atlasPath, bound.atlasBytes], [bound.atlas.sourcePath, bound.sourceBytes],
            [bound.room.backgroundPath, bound.background.pngBytes], [bound.background.asset.metadataPath, bound.background.metadataBytes],
            [bound.scene.resourcePath, sceneBytes],
        ];
        return {
            files: [{ relativePath: input.recipePath, before: bound.recipeBytes, after: recipeBytes },
                ...unchanged.map(([relativePath, bytes]) => ({ relativePath, before: bytes, after: bytes }))],
            value: { ...outputReceipt(room, input.recipePath, recipeBytes), analysis, adoptedBinding: room.adoptedBinding,
                difference: tilemapDiff(room.cells, room.cells, room.width, bound.pixels),
                sceneFields: [], nativeFilesChanged: false, atlasChanged: false, cellRecordsChanged: 0 },
        };
    }, access);
    return { ...value, ...transaction };
}
async function compileRoom(projectPath, input, operations, access) {
    const { value, ...transaction } = await applyPreparedProjectTransaction(projectPath, input, async (snapshot) => {
        const bound = await loadBoundRoom(snapshot, input.recipePath, access);
        const policy = palettePolicy(snapshot, bound.scene);
        let pixels = bound.pixels;
        let room;
        if (operations.some((operation) => operation.type === "set_collision_cells")) {
            const operation = operations[0];
            if (operations.length !== 1 || operation.type !== "set_collision_cells")
                tilemapError("INVALID_TILEMAP_OPERATION", "Selected collision changes must be the sole operation in their revision-bound batch.");
            room = setTilemapCollisionCells(bound.room, pixels, operation);
        }
        else if (operations.some((operation) => operation.type === "replace_cells")) {
            const operation = operations[0];
            if (operations.length !== 1 || operation.type !== "replace_cells")
                tilemapError("INVALID_TILEMAP_OPERATION", "Selected-cell replacement must be the sole operation in its revision-bound batch.");
            const target = operation.atlasPath === bound.room.atlasPath
                ? { atlas: bound.atlas, pixels: bound.pixels, bytes: bound.atlasBytes }
                : await readAtlas(snapshot.projectRoot, operation.atlasPath);
            if (sha256(target.bytes) !== operation.atlasSha256)
                tilemapError("STALE_TILEMAP_ATLAS", "The selected replacement atlas does not match its explicit hash.");
            // A separately registered atlas may add patterns, but must not rebind any
            // existing tile or primitive. Diff/render then share the same old meanings.
            for (const [id, pattern] of bound.pixels.patterns) {
                if (target.pixels.patterns.get(id) !== pattern)
                    tilemapError("TILEMAP_ATLAS_REBIND", `Replacement atlas changes or removes existing tile ${id}.`);
            }
            for (const primitive of bound.atlas.primitives) {
                if (!isDeepStrictEqual(target.atlas.primitives.find((entry) => entry.id === primitive.id), primitive)) {
                    tilemapError("TILEMAP_ATLAS_REBIND", `Replacement atlas changes or removes existing primitive ${primitive.id}.`);
                }
            }
            pixels = target.pixels;
            room = replaceTilemapCells(bound.room, pixels, operation);
            for (const cell of operation.cells) {
                if (cell.before.paletteByte !== cell.after.paletteByte)
                    checkPalette(cell.after.paletteByte, policy, room.reservedPaletteSlots);
            }
            room = { ...room, atlasPath: operation.atlasPath, atlasSha256: operation.atlasSha256 };
        }
        else {
            // Validate every explicit palette action, including no-op slots and overlapping stamps.
            for (const operation of operations) {
                if (operation.type === "replace_cells" || operation.type === "adopt_binding" || operation.type === "set_collision_cells")
                    continue;
                const primitive = bound.atlas.primitives.find((entry) => entry.id === operation.primitiveId);
                for (const cell of primitive?.cells ?? [])
                    if (cell?.paletteSlot !== undefined)
                        checkPalette(cell.paletteSlot, policy, bound.room.reservedPaletteSlots);
            }
            room = applyTilemapOperations(bound.room, bound.atlas, operations);
        }
        const difference = tilemapDiff(bound.room.cells, room.cells, room.width, pixels);
        const image = renderTilemap(room, pixels);
        const analysis = sourceAnalysis(snapshot, bound.scene, room, image);
        const png = difference.pixelTiles === 0 ? bound.background.pngBytes : PNG.sync.write(image);
        const paletteEdits = room.cells.flatMap((cell, index) => cell.paletteByte === bound.room.cells[index].paletteByte ? [] : [{ x: index % room.width, y: Math.floor(index / room.width), slot: cell.paletteByte }]);
        let metadata = bound.background.metadata;
        for (let start = 0; start < paletteEdits.length; start += 1_024) {
            metadata = applyBackgroundPaletteEdits(metadata, { width: room.width, height: room.height, edits: paletteEdits.slice(start, start + 1_024), ...policy }).metadata;
        }
        const collisionEdits = room.cells.flatMap((cell, index) => cell.collisionByte === bound.room.cells[index].collisionByte ? [] : [{ shape: "tile", x: index % room.width, y: Math.floor(index / room.width), value: cell.collisionByte }]);
        const sceneBytes = await readBytes(snapshot.projectRoot, bound.scene.resourcePath, MAX_TILEMAP_JSON_BYTES);
        let sceneResource = parseJson(sceneBytes);
        const sceneOperations = [];
        for (let start = 0; start < collisionEdits.length; start += 1_024) {
            const edits = collisionEdits.slice(start, start + 1_024);
            sceneResource = applyCollisionEdits(sceneResource, { sceneId: bound.scene.id, edits }).scene;
            sceneOperations.push({ type: "collision.edit", edits });
        }
        const metadataBytes = difference.paletteCells === 0 ? bound.background.metadataBytes : jsonBytes(metadata);
        room = { ...room, native: { pngSha256: sha256(png), metadataSha256: sha256(metadataBytes), collisions: String(sceneResource.collisions) } };
        const recipeBytes = isDeepStrictEqual(room, bound.room) ? bound.recipeBytes : jsonBytes(room);
        const files = [
            { relativePath: input.recipePath, before: bound.recipeBytes, after: recipeBytes },
            { relativePath: room.backgroundPath, before: bound.background.pngBytes, after: png },
            { relativePath: `${room.backgroundPath}.gbsres`, before: bound.background.metadataBytes, after: metadataBytes },
        ];
        return { files, ...(sceneOperations.length === 0 ? {} : { sceneBatch: { sceneId: room.sceneId, operations: sceneOperations } }), value: { ...outputReceipt(room, input.recipePath, recipeBytes), analysis, difference, sceneFields: sceneOperations.length === 0 ? [] : ["collisions"] } };
    }, access);
    return { ...value, ...transaction };
}
async function editTilemapIndexed(projectPath, rawInput, access) {
    const input = parse(tilemapSchemas.edit, rawInput);
    if (input.operations.some((operation) => operation.type === "adopt_binding")) {
        const operation = input.operations[0];
        if (input.operations.length !== 1 || operation.type !== "adopt_binding")
            tilemapError("INVALID_TILEMAP_OPERATION", "Binding adoption must be the sole operation in its revision-bound batch.");
        return adoptTilemapBinding(projectPath, input, operation, access);
    }
    return compileRoom(projectPath, input, input.operations, access);
}
async function compileTilemapIndexed(projectPath, rawInput, access) {
    const input = parse(tilemapSchemas.compile, rawInput);
    return compileRoom(projectPath, input, [], access);
}
async function inspectTilemapIndexed(projectPath, rawInput, access) {
    const input = parse(tilemapSchemas.inspect, rawInput);
    if (!input.recipePath && !input.atlasPath)
        tilemapError("INVALID_TILEMAP_INPUT", "Inspect a recipePath or atlasPath; use both only for that recipe's bound atlas.");
    await access.strongRefresh();
    const snapshot = await access.snapshot();
    if (input.atlasPath) {
        const bound = input.recipePath ? await loadBoundRoom(snapshot, input.recipePath, access) : undefined;
        if (bound && bound.room.atlasPath !== input.atlasPath)
            tilemapError("STALE_TILEMAP_ATLAS", "Requested atlas is not the selected recipe's bound atlas.");
        const { atlas, bytes, pixels } = bound
            ? { atlas: bound.atlas, bytes: bound.atlasBytes, pixels: bound.pixels }
            : await readAtlas(snapshot.projectRoot, input.atlasPath);
        const offset = input.offset ?? 0, limit = input.limit ?? 32;
        return { atlasPath: input.atlasPath, revision: snapshot.revision, atlasSha256: sha256(bytes), sourceSha256: atlas.sourceSha256, name: atlas.name, counts: { tiles: atlas.tiles.length, primitives: atlas.primitives.length, uniquePatterns: new Set(pixels.patterns.values()).size }, tiles: atlas.tiles.slice(offset, offset + limit).map((tile) => ({ ...tile, pixelsSha256: pixels.patterns.get(tile.id) })), primitives: atlas.primitives.slice(offset, offset + limit).map(({ cells, ...primitive }) => ({ ...primitive, opaqueCells: cells.filter((cell) => cell !== null).length })), offset, limit, truncated: Math.max(atlas.tiles.length, atlas.primitives.length) > offset + limit };
    }
    const { room, pixels, recipeBytes } = await loadBoundRoom(snapshot, input.recipePath, access);
    const x = input.x ?? 0, y = input.y ?? 0, width = input.width ?? Math.min(room.width - x, 20), height = input.height ?? Math.min(room.height - y, 18);
    if (width < 1 || height < 1 || x + width > room.width || y + height > room.height || width * height > 1_024)
        tilemapError("TILEMAP_INSPECTION_LIMIT", "Inspect a valid region of at most 1,024 room cells.");
    const cells = [];
    for (let row = y; row < y + height; row++)
        cells.push(...room.cells.slice(row * room.width + x, row * room.width + x + width));
    return { ...outputReceipt(room, input.recipePath, recipeBytes), revision: snapshot.revision, region: { x, y, width, height }, cells: cells.map((cell) => ({ ...cell, pixelsSha256: pixels.patterns.get(cell.tileId) })), protectedRegions: room.protectedRegions, reservedPaletteSlots: room.reservedPaletteSlots, uniquePatterns: new Set(room.cells.map((cell) => pixels.patterns.get(cell.tileId))).size, nativeState: "verified-authored-source" };
}
/** Direct library calls use the same dependency graph and semantic revision fence as MCP. */
async function withTilemapIndex(projectPath, access, action) {
    if (access) {
        const requested = path.resolve(projectPath);
        if (requested !== access.projectPath && requested !== access.projectRoot)
            tilemapError("STALE_PROJECT", "Indexed access belongs to another project.");
        return action(access);
    }
    const index = new ProjectWorldIndex(projectPath);
    try {
        await index.ensureFresh();
        return await action(index);
    }
    finally {
        index.dispose();
    }
}
export async function createTilemapAtlas(projectPath, input, access) {
    return withTilemapIndex(projectPath, access, (index) => createTilemapAtlasIndexed(projectPath, input, index));
}
export async function createTilemap(projectPath, input, access) {
    return withTilemapIndex(projectPath, access, (index) => createTilemapIndexed(projectPath, input, index));
}
export async function editTilemap(projectPath, input, access) {
    return withTilemapIndex(projectPath, access, (index) => editTilemapIndexed(projectPath, input, index));
}
export async function compileTilemap(projectPath, input, access) {
    return withTilemapIndex(projectPath, access, (index) => compileTilemapIndexed(projectPath, input, index));
}
export async function inspectTilemap(projectPath, input, access) {
    return withTilemapIndex(projectPath, access, (index) => inspectTilemapIndexed(projectPath, input, index));
}
//# sourceMappingURL=tilemaps.js.map