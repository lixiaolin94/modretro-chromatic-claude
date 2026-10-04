import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { renderContactSheetPng } from "./contact-sheet.js";
import { analyzeGraphics } from "./graphics.js";
import { decodeBackgroundPaletteTiles, FALLBACK_PALETTE_COLORS, HARDWARE_PALETTE_SLOTS, resolvePaletteSlots, resolveUiPalette, } from "./palettes.js";
import { GameStudioProjectError, inventoryProject, } from "./project.js";
import { readProjectJson, resolveProjectPath } from "./project-files.js";
const MAX_TILE_DETAILS = 512;
const DEFAULT_TILE_DETAILS = 64;
const MAX_PREVIEW_PIXELS = 4_194_304;
const MAX_OAM_OBJECTS = 40;
const MAX_SCANLINE_OBJECTS = 10;
const OAM_COORDINATE_RANGE = 256;
const OAM_Y_BIAS = 16;
const HARDWARE_SCREEN_HEIGHT = 144;
const FIXED_SOURCE_SHADES = new Map([
    ["071821", 3],
    ["306850", 2],
    ["86C06C", 1],
    ["E0F8CF", 0],
]);
function integer(value, fallback = 0) {
    return typeof value === "number" && Number.isSafeInteger(value) ? value : fallback;
}
function asRecords(value) {
    return Array.isArray(value)
        ? value.filter((entry) => typeof entry === "object" && entry !== null && !Array.isArray(entry))
        : [];
}
function nativeSpriteAnimationIndices(type, flipLeft) {
    const all = [0, 1, 2, 3, 4, 5, 6, 7];
    const multiMovement = flipLeft ? [0, 2, 3, 4, 6, 7] : all;
    // Match GB Studio's compiler animationMapBySpriteType, which maps eight
    // engine directions/states onto these authored source slots. Mirroring is
    // horizontal only, so a mirrored slot does not change vertical geometry.
    switch (type) {
        case "fixed": return { indices: [0], known: true };
        case "fixed_movement": return { indices: [0, 4], known: true };
        case "multi": return { indices: flipLeft ? [0, 2, 3] : [0, 1, 2, 3], known: true };
        case "multi_movement": return { indices: multiMovement, known: true };
        case "horizontal": return { indices: flipLeft ? [0] : [0, 1], known: true };
        case "horizontal_movement": return { indices: flipLeft ? [0, 4] : [0, 1, 4, 5], known: true };
        case "platform_player": return { indices: flipLeft ? [0, 2, 4, 6, 7] : all, known: true };
        case "cursor": return { indices: [0, 1], known: true };
        default: return { indices: multiMovement, known: false };
    }
}
function wrapOamScanline(value) {
    return ((value % OAM_COORDINATE_RANGE) + OAM_COORDINATE_RANGE) % OAM_COORDINATE_RANGE;
}
function projectColorMode(settings) {
    return settings.colorMode === "color" || settings.colorMode === "mono" ? settings.colorMode : "mixed";
}
async function loadSceneGraphicsContext(projectPath, sceneId, access) {
    if (access !== undefined)
        await access.ensureFresh();
    const inventory = access === undefined
        ? await inventoryProject(projectPath)
        : {
            projectPath: access.projectPath,
            projectRoot: access.projectRoot,
            settings: access.settings?.() ?? access.projectInspection().settings,
            palettes: [],
            assets: [],
        };
    const scene = access === undefined
        ? inventory.scenes.find((candidate) => candidate.id === sceneId)
        : access.scene(sceneId);
    if (scene === undefined) {
        throw new GameStudioProjectError("SCENE_NOT_FOUND", `No scene exists with id ${sceneId}.`);
    }
    const background = access === undefined
        ? inventory.assets.find((asset) => asset.type === "background" && asset.id === scene.backgroundId)
        : access.asset({ assetId: typeof scene.backgroundId === "string" ? scene.backgroundId : "" }).asset;
    if (background === undefined || background.type !== "background" || background.metadataPath === null) {
        throw new GameStudioProjectError("BACKGROUND_NOT_FOUND", `Scene ${scene.name} has no readable native background asset.`);
    }
    const metadata = await readProjectJson(inventory.projectRoot, path.join(inventory.projectRoot, background.metadataPath));
    const width = integer(metadata.width, Math.ceil((background.width ?? 0) / 8));
    const height = integer(metadata.height, Math.ceil((background.height ?? 0) / 8));
    const totalTiles = width * height;
    if (width < 1 || height < 1 || !Number.isSafeInteger(totalTiles) || totalTiles > MAX_PREVIEW_PIXELS / 64) {
        throw new GameStudioProjectError("INVALID_TILE_COLOR_GRID", "The background has invalid or unreasonably large tile dimensions.");
    }
    return {
        inventory,
        scene,
        background,
        metadata,
        tileColors: decodeBackgroundPaletteTiles(metadata, totalTiles),
        width,
        height,
        colorMode: projectColorMode(inventory.settings),
        backgroundPalettes: resolvePaletteSlots(inventory, scene, "background", access),
        objectPalettes: resolvePaletteSlots(inventory, scene, "sprite", access),
        ...(access === undefined ? {} : { access }),
    };
}
function paletteHistogram(values) {
    const counts = new Map();
    for (const value of values)
        counts.set(value, (counts.get(value) ?? 0) + 1);
    return Object.fromEntries(Array.from(counts).sort(([left], [right]) => left - right));
}
function configuredOverrideCount(value) {
    return Array.isArray(value) ? value.filter((entry) => typeof entry === "string" && entry.length > 0).length : 0;
}
function scriptSpriteReferences(scene) {
    const references = new Set();
    const pending = [{ value: scene, depth: 0 }];
    let visited = 0;
    while (pending.length > 0 && visited < 20_000) {
        const current = pending.pop();
        visited += 1;
        if (current.depth >= 32)
            continue;
        if (Array.isArray(current.value)) {
            for (const value of current.value)
                pending.push({ value, depth: current.depth + 1 });
        }
        else if (typeof current.value === "object" && current.value !== null) {
            for (const [key, value] of Object.entries(current.value)) {
                if ((key === "spriteSheetId" || key === "spriteId") && typeof value === "string" && value.length > 0) {
                    references.add(value);
                }
                pending.push({ value, depth: current.depth + 1 });
            }
        }
    }
    return references;
}
async function analyzeSprites(context) {
    const defaults = context.inventory.settings.defaultPlayerSprites;
    const playerSprites = typeof defaults === "object" && defaults !== null && !Array.isArray(defaults)
        ? defaults
        : undefined;
    const defaultPlayerSprite = playerSprites?.[String(context.scene.type ?? "TOPDOWN")];
    const defaultPlayerSpriteId = typeof defaultPlayerSprite === "string" && defaultPlayerSprite.length > 0 ? defaultPlayerSprite : null;
    const scenePlayerSprite = context.scene.playerSpriteSheetId;
    const scenePlayerSpriteId = typeof scenePlayerSprite === "string" && scenePlayerSprite.length > 0 ? scenePlayerSprite : null;
    const spriteAssetCache = new Map();
    function spriteAsset(id) {
        if (spriteAssetCache.has(id))
            return spriteAssetCache.get(id);
        const asset = context.access === undefined
            ? context.inventory.assets.find((candidate) => candidate.type === "sprite" && candidate.id === id)
            : context.access.asset({ assetId: id }).asset;
        const readableAsset = asset?.type === "sprite" && asset.metadataPath !== null ? asset : null;
        spriteAssetCache.set(id, readableAsset);
        return readableAsset;
    }
    const firstPlayerCandidate = scenePlayerSpriteId ?? defaultPlayerSpriteId;
    const playerSpriteId = firstPlayerCandidate !== null && spriteAsset(firstPlayerCandidate) !== null
        ? firstPlayerCandidate
        : context.scene.type !== "LOGO" && defaultPlayerSpriteId !== null && spriteAsset(defaultPlayerSpriteId) !== null
            ? defaultPlayerSpriteId : null;
    const playerGeometryStatus = playerSpriteId !== null ? "authored-frame-count"
        : firstPlayerCandidate === null && context.scene.type === "LOGO" ? "not-configured" : "unresolved";
    const scriptReferences = scriptSpriteReferences(context.scene);
    const actorSpriteIds = context.scene.actors
        .map((actor) => typeof actor.spriteSheetId === "string" ? actor.spriteSheetId : "")
        .filter(Boolean);
    const uniqueSpriteIds = new Set([...actorSpriteIds, ...scriptReferences]);
    if (playerSpriteId !== null)
        uniqueSpriteIds.add(playerSpriteId);
    const configuredDefaultSpriteMode = context.inventory.settings.spriteMode ?? "8x16";
    const configuredSpriteMode = context.scene.spriteMode ?? configuredDefaultSpriteMode;
    const spriteMode = configuredSpriteMode === "8x8" ? "8x8" : "8x16";
    const spriteModeKnown = configuredSpriteMode === "8x8" || configuredSpriteMode === "8x16";
    const spriteObjectHeight = spriteMode === "8x8" ? 8 : 16;
    const referencedSlots = new Set();
    const summaries = await Promise.all(Array.from(uniqueSpriteIds).map(async (id) => {
        const asset = spriteAsset(id);
        if (asset === null || asset.metadataPath === null)
            return null;
        const metadata = await readProjectJson(context.inventory.projectRoot, path.join(context.inventory.projectRoot, asset.metadataPath));
        const slots = new Set();
        let maximumFrameObjects = 0;
        const maximumKnownObjectsByRelativeScanline = new Map();
        const maximumKnownObjectsByOamScanline = new Map();
        const configuredOriginY = metadata.canvasOriginY ?? 0;
        const originY = typeof configuredOriginY === "number" && Number.isSafeInteger(configuredOriginY) ? configuredOriginY : null;
        const configuredAssetMode = metadata.spriteMode ?? configuredDefaultSpriteMode;
        const assetModeKnown = configuredAssetMode === "8x8" || configuredAssetMode === "8x16";
        const modeMismatch = spriteModeKnown && assetModeKnown && configuredAssetMode !== spriteMode;
        const assetAnchor = configuredAssetMode === "8x8" ? 16 : 8;
        let geometryComplete = spriteModeKnown && assetModeKnown && originY !== null;
        function geometryRecords(value) {
            const records = asRecords(value);
            if (!Array.isArray(value) || records.length !== value.length)
                geometryComplete = false;
            return records;
        }
        for (const state of geometryRecords(metadata.states)) {
            const mappedAnimations = nativeSpriteAnimationIndices(state.animationType, Boolean(state.flipLeft));
            if (!mappedAnimations.known ||
                !["fixed", "fixed_movement", "cursor"].includes(String(state.animationType)) && typeof state.flipLeft !== "boolean") {
                geometryComplete = false;
            }
            if (!Array.isArray(state.animations)) {
                geometryComplete = false;
                continue;
            }
            for (const animationIndex of mappedAnimations.indices) {
                const entry = state.animations[animationIndex];
                // The official compiler emits no frames for an absent selected slot.
                if (entry === undefined)
                    continue;
                const animation = geometryRecords([entry])[0];
                if (animation === undefined)
                    continue;
                for (const frame of geometryRecords(animation.frames)) {
                    const tiles = geometryRecords(frame.tiles);
                    maximumFrameObjects = Math.max(maximumFrameObjects, tiles.length);
                    const knownObjectsByRelativeScanline = new Map();
                    const knownObjectsByOamScanline = new Map();
                    for (const tile of tiles) {
                        const slot = integer(tile.paletteIndex, integer(tile.palette));
                        if (slot >= 0 && slot < HARDWARE_PALETTE_SLOTS) {
                            slots.add(slot);
                            referencedSlots.add(slot);
                        }
                        // Native tile and canvas-origin Y both grow upward. The asset mode
                        // determines the compiled OAM anchor; the scene's hardware mode
                        // determines the selected span, including transparent object pixels.
                        if (!spriteModeKnown || !assetModeKnown || originY === null || typeof tile.y !== "number" ||
                            !Number.isSafeInteger(tile.y) || !Number.isSafeInteger(assetAnchor - tile.y - originY) ||
                            !Number.isSafeInteger(assetAnchor - tile.y - originY + spriteObjectHeight - 1)) {
                            geometryComplete = false;
                            continue;
                        }
                        for (let row = 0; row < spriteObjectHeight; row += 1) {
                            const relativeY = assetAnchor - tile.y - originY + row;
                            knownObjectsByRelativeScanline.set(relativeY, (knownObjectsByRelativeScanline.get(relativeY) ?? 0) + 1);
                            const oamY = wrapOamScanline(relativeY);
                            knownObjectsByOamScanline.set(oamY, (knownObjectsByOamScanline.get(oamY) ?? 0) + 1);
                        }
                    }
                    // One actor cannot display multiple frames at once. Keep the maximum
                    // for each row so independently animated actors can later be combined.
                    for (const [relativeY, count] of knownObjectsByRelativeScanline) {
                        maximumKnownObjectsByRelativeScanline.set(relativeY, Math.max(maximumKnownObjectsByRelativeScanline.get(relativeY) ?? 0, count));
                    }
                    for (const [oamY, count] of knownObjectsByOamScanline) {
                        maximumKnownObjectsByOamScanline.set(oamY, Math.max(maximumKnownObjectsByOamScanline.get(oamY) ?? 0, count));
                    }
                }
            }
        }
        return {
            summary: {
                id,
                name: asset.name,
                tileCount: typeof metadata.numTiles === "number" && Number.isSafeInteger(metadata.numTiles) ? metadata.numTiles : null,
                maximumFrameObjects,
                referencedPaletteSlots: Array.from(slots).sort((left, right) => left - right),
                scriptReferenced: scriptReferences.has(id) && !actorSpriteIds.includes(id) && id !== playerSpriteId,
            },
            maximumKnownObjectsByRelativeScanline,
            maximumKnownObjectsByOamScanline,
            geometryComplete,
            modeMismatch,
        };
    }));
    const spriteGeometries = summaries.filter((summary) => summary !== null);
    const sprites = spriteGeometries.map((sprite) => sprite.summary);
    const byId = new Map(spriteGeometries.map((sprite) => [sprite.summary.id, sprite]));
    const worldScanlineCounts = new Map();
    const pinnedScanlineCounts = new Map();
    let staticOamObjects = playerSpriteId === null ? 0 : (byId.get(playerSpriteId)?.summary.maximumFrameObjects ?? 0);
    let maximumWorldScanlineObjects = 0;
    let maximumPinnedScanlineObjects = 0;
    let pinnedActorInstances = 0;
    let actorInstancesWithIncompleteScanlineGeometry = 0;
    let actorInstancesWithMismatchedSpriteMode = 0;
    for (const actor of context.scene.actors) {
        const spriteId = typeof actor.spriteSheetId === "string" ? actor.spriteSheetId : "";
        const sprite = byId.get(spriteId);
        staticOamObjects += sprite?.summary.maximumFrameObjects ?? 0;
        let geometryComplete = sprite?.geometryComplete === true;
        if (sprite?.modeMismatch === true)
            actorInstancesWithMismatchedSpriteMode += 1;
        const coordinateScale = actor.coordinateType === "pixels" ? 1 : 8;
        const actorY = typeof actor.y === "number" && Number.isSafeInteger(actor.y * coordinateScale) ? actor.y * coordinateScale : null;
        const pinned = actor.isPinned === true;
        if (pinned)
            pinnedActorInstances += 1;
        const scanlineCounts = pinned ? pinnedScanlineCounts : worldScanlineCounts;
        if (sprite !== undefined && actorY !== null) {
            const geometry = pinned ? sprite.maximumKnownObjectsByOamScanline : sprite.maximumKnownObjectsByRelativeScanline;
            for (const [relativeY, objects] of geometry) {
                const y = pinned ? wrapOamScanline(wrapOamScanline(actorY) + relativeY) - OAM_Y_BIAS : actorY + relativeY;
                if (pinned && (y < 0 || y >= HARDWARE_SCREEN_HEIGHT))
                    continue;
                if (!Number.isSafeInteger(y)) {
                    geometryComplete = false;
                    continue;
                }
                const count = (scanlineCounts.get(y) ?? 0) + objects;
                scanlineCounts.set(y, count);
                if (pinned)
                    maximumPinnedScanlineObjects = Math.max(maximumPinnedScanlineObjects, count);
                else
                    maximumWorldScanlineObjects = Math.max(maximumWorldScanlineObjects, count);
            }
        }
        else if (spriteId.length > 0) {
            geometryComplete = false;
        }
        if (!geometryComplete)
            actorInstancesWithIncompleteScanlineGeometry += 1;
        if (typeof actor.paletteId === "string" && actor.paletteId.length > 0) {
            const slot = context.objectPalettes.findIndex((palette) => palette?.id === actor.paletteId);
            if (slot >= 0)
                referencedSlots.add(slot);
        }
    }
    return {
        sprites,
        playerSpriteId,
        playerGeometryStatus,
        actorInstanceCount: context.scene.actors.length,
        staticOamObjects,
        // Screen-pinned objects and world objects have different coordinate origins.
        // Their separate maxima can align for an unknown camera offset, but actual
        // runtime alignment or even co-visibility is not established.
        maximumScanlineObjects: maximumWorldScanlineObjects + maximumPinnedScanlineObjects,
        maximumWorldScanlineObjects,
        maximumPinnedScanlineObjects,
        pinnedActorInstances,
        spriteMode,
        actorInstancesWithIncompleteScanlineGeometry,
        actorInstancesWithMismatchedSpriteMode,
        referencedSlots,
    };
}
export async function analyzeSceneGraphics(projectPath, input, access) {
    if (input.detail !== undefined && input.detail !== "summary" && input.detail !== "tiles") {
        throw new GameStudioProjectError("INVALID_GRAPHICS_DETAIL", "Scene graphics detail must be summary or tiles.");
    }
    if (input.tileOffset !== undefined && (!Number.isSafeInteger(input.tileOffset) || input.tileOffset < 0)) {
        throw new GameStudioProjectError("INVALID_TILE_PAGE", "Tile offsets must be nonnegative safe integers.");
    }
    if (input.tileLimit !== undefined && (!Number.isSafeInteger(input.tileLimit) || input.tileLimit < 1 || input.tileLimit > MAX_TILE_DETAILS)) {
        throw new GameStudioProjectError("INVALID_TILE_PAGE", `Tile limits must be integers between 1 and ${MAX_TILE_DETAILS}.`);
    }
    const context = await loadSceneGraphicsContext(projectPath, input.sceneId, access);
    const allowFlips = context.colorMode === "color" && context.inventory.settings.autoTileFlipEnabled === true &&
        context.scene.autoTileFlipEnabled !== false && context.metadata.autoTileFlipEnabled !== false;
    const analysis = await analyzeGraphics(context.inventory.projectRoot, context.background.resourcePath, {
        kind: "background",
        colorMode: context.colorMode,
        allowFlipDeduplication: allowFlips,
    });
    const metrics = analysis.metrics;
    const uniqueTiles = metrics?.tiles?.unique ?? analysis.uniqueTiles;
    const uniqueTilesWithFlips = metrics?.tiles?.uniqueWithFlips ?? analysis.uniqueTilesWithFlips;
    const metricsStatus = metrics?.tiles?.status ?? "exact";
    const effectiveUniqueTiles = metricsStatus === "unknown" ? null : (allowFlips ? uniqueTilesWithFlips : uniqueTiles);
    const backgroundLimit = context.colorMode === "color" ? 384 : 192;
    const spriteAvailability = context.colorMode === "color" ? { minimum: 128, maximum: 192 } : { minimum: 64, maximum: 96 };
    const spriteAnalysis = await analyzeSprites(context);
    const spriteTileUsageUnknown = spriteAnalysis.sprites.some((sprite) => sprite.tileCount === null);
    const spriteTileUsage = spriteTileUsageUnknown ? null : spriteAnalysis.sprites.reduce((total, sprite) => total + (sprite.tileCount ?? 0), 0);
    const histogram = paletteHistogram(context.tileColors);
    const usedTileSlots = Object.keys(histogram).map(Number).filter((slot) => slot < HARDWARE_PALETTE_SLOTS);
    const uiPalette = resolveUiPalette(context.inventory, access);
    const diagnostics = analysis.violations.map(({ severity, code, message }) => ({ severity, code, message }));
    if (context.metadata.autoColor === true) {
        diagnostics.push({
            severity: "warning",
            code: "AUTOMATIC_COLORIZATION_UNVERIFIED",
            message: "Automatic colorization is not reconstructed; authored palette assignments may not predict runtime colors.",
        });
    }
    for (const slot of Object.keys(histogram).map(Number).filter((value) => value >= HARDWARE_PALETTE_SLOTS)) {
        diagnostics.push({
            severity: "warning",
            code: "OPAQUE_TILE_COLOR_ATTRIBUTES",
            message: `Tile attribute byte ${slot} contains unverified non-palette bits and cannot be interpreted as a displayed palette slot.`,
        });
    }
    for (const slot of usedTileSlots) {
        if (context.backgroundPalettes[slot] === null) {
            diagnostics.push({
                severity: "warning",
                code: "UNRESOLVED_BACKGROUND_PALETTE",
                message: `Displayed background palette slot ${slot} has no resolvable authored project palette.`,
            });
        }
    }
    // Stored numTiles can outlive compiler removal/reuse of sprite content. It
    // also does not establish sprite-mode normalization, dynamic reservations
    // or the final VRAM layout.
    const spriteEstimateExceedsMaximum = spriteTileUsage === null ? null : spriteTileUsage > spriteAvailability.maximum;
    if (spriteEstimateExceedsMaximum === true) {
        diagnostics.push({
            severity: "warning",
            code: "SPRITE_TILE_ALLOCATION_UNVERIFIED",
            message: `Stored sprite metadata (numTiles) totals ${spriteTileUsage}, above the nominal ${spriteAvailability.minimum}-${spriteAvailability.maximum} 8x16-pair ${context.colorMode} range. This metadata comparison is not normalized for sprite mode; compiler removal/reuse and dynamic reservations are unverified. Check compiled allocation before reducing art.`,
        });
    }
    if (input.includeStaticOam === true && spriteAnalysis.staticOamObjects > MAX_OAM_OBJECTS) {
        diagnostics.push({
            severity: "warning",
            code: "STATIC_OAM_OBJECT_LIMIT_EXCEEDED",
            message: `The authored static estimate allows ${spriteAnalysis.staticOamObjects} sprite objects across placed actors${spriteAnalysis.playerGeometryStatus === "authored-frame-count" ? " and the resolved player" : spriteAnalysis.playerGeometryStatus === "unresolved" ? " (player sprite unresolved)" : ""}, above the ${MAX_OAM_OBJECTS}-object hardware OAM limit. Reduce object counts in sprite frames or the number of sprites visible together, then check the affected scene in an emulator. Runtime visibility or flicker was not measured.`,
        });
    }
    if (input.includeStaticOam === true && spriteAnalysis.maximumScanlineObjects > MAX_SCANLINE_OBJECTS) {
        diagnostics.push({
            severity: "warning",
            code: "STATIC_OAM_SCANLINE_LIMIT_EXCEEDED",
            message: `The authored static estimate allows ${spriteAnalysis.maximumScanlineObjects} placed-actor sprite objects on one scanline, above the ${MAX_SCANLINE_OBJECTS}-object hardware limit, if each actor independently displays a compiler-selected authored frame with that overlap.${spriteAnalysis.maximumPinnedScanlineObjects > 0 && spriteAnalysis.maximumWorldScanlineObjects > 0 ? " World and screen-pinned actor maxima may align only at an unverified camera offset." : ""} Stagger actor heights or simplify sprite frames, then check the affected rows in an emulator. Player overlap, runtime visibility, or flicker was not measured.`,
        });
    }
    const diagnosticCounts = diagnostics.reduce((counts, diagnostic) => {
        counts[diagnostic.code] = (counts[diagnostic.code] ?? 0) + 1;
        return counts;
    }, {});
    const offset = input.tileOffset ?? 0;
    const limit = input.tileLimit ?? DEFAULT_TILE_DETAILS;
    const tiles = input.detail === "tiles"
        ? Array.from(context.tileColors.slice(offset, offset + limit), (slot, index) => ({
            index: offset + index,
            x: (offset + index) % context.width,
            y: Math.floor((offset + index) / context.width),
            slot,
            paletteId: context.backgroundPalettes[slot]?.id ?? null,
        }))
        : undefined;
    const backgroundBudget = {
        status: effectiveUniqueTiles === null ? "unknown" : "exact",
        mode: context.colorMode,
        limit: backgroundLimit,
        used: effectiveUniqueTiles,
        remaining: effectiveUniqueTiles === null ? null : backgroundLimit - effectiveUniqueTiles,
        exceeded: effectiveUniqueTiles === null ? null : effectiveUniqueTiles > backgroundLimit,
        flipDeduplicationApplied: allowFlips,
    };
    let returnedSprites = spriteAnalysis.sprites;
    if (access !== undefined) {
        returnedSprites = [];
        let spriteResponseBytes = 0;
        for (const sprite of spriteAnalysis.sprites) {
            const entryBytes = Buffer.byteLength(JSON.stringify(sprite));
            if (entryBytes > 24 * 1024) {
                if (returnedSprites.length > 0)
                    break;
                throw new GameStudioProjectError("SPRITE_RESPONSE_TOO_LARGE", "One referenced sprite exceeds the bounded scene-graphics response; inspect its asset directly.");
            }
            if (returnedSprites.length >= 200 || spriteResponseBytes + entryBytes > 24 * 1024)
                break;
            spriteResponseBytes += entryBytes;
            returnedSprites.push(sprite);
        }
    }
    const spritesTruncated = returnedSprites.length < spriteAnalysis.sprites.length;
    return {
        projectPath: context.inventory.projectPath,
        projectRoot: context.inventory.projectRoot,
        sceneId: context.scene.id,
        sceneName: context.scene.name,
        background: {
            id: context.background.id,
            resourcePath: context.background.resourcePath,
            totalTiles: context.tileColors.length,
            width: context.width,
            height: context.height,
            uniqueTiles: metricsStatus === "unknown" ? null : uniqueTiles,
            uniqueTilesWithFlips: metricsStatus === "unknown" ? null : uniqueTilesWithFlips,
            effectiveUniqueTiles,
            metricStatus: metricsStatus,
            flipDeduplicationApplied: allowFlips,
        },
        palettes: {
            background: {
                configuredOverrideCount: configuredOverrideCount(context.scene.paletteIds),
                resolvedSlotCount: context.backgroundPalettes.filter((palette) => palette !== null).length,
                usedTileSlotCount: usedTileSlots.length,
                tileSlotHistogram: histogram,
                reservedUiSlot: uiPalette.slot,
                usedSlots: usedTileSlots.map((slot) => ({
                    slot,
                    paletteId: context.backgroundPalettes[slot]?.id ?? null,
                    tileCount: histogram[String(slot)],
                    colors: context.backgroundPalettes[slot]?.colors ?? null,
                })),
            },
            objects: {
                configuredOverrideCount: configuredOverrideCount(context.scene.spritePaletteIds),
                resolvedSlotCount: context.objectPalettes.filter((palette) => palette !== null).length,
                referencedSlotCount: spriteAnalysis.referencedSlots.size,
                referencedSlots: Array.from(spriteAnalysis.referencedSlots).sort((left, right) => left - right),
            },
        },
        sprites: {
            playerSpriteId: spriteAnalysis.playerSpriteId,
            uniqueAssetCount: spriteAnalysis.sprites.length,
            actorInstanceCount: spriteAnalysis.actorInstanceCount,
            assets: returnedSprites,
            ...(spritesTruncated
                ? { spriteAssetCount: spriteAnalysis.sprites.length, returnedSpriteAssetCount: returnedSprites.length }
                : {}),
        },
        budgets: {
            engine: {
                background: backgroundBudget,
                sprites: {
                    status: spriteTileUsage === null ? "unknown" : "metadata-estimate",
                    provenance: "stored-sprite-numTiles",
                    units: "stored-numTiles",
                    used: spriteTileUsage,
                    available: spriteAvailability,
                    availableUnits: "8x16-tile-pairs",
                    comparison: "unnormalized-metadata",
                    remaining: spriteTileUsage === null ? null : {
                        minimum: spriteAvailability.minimum - spriteTileUsage,
                        maximum: spriteAvailability.maximum - spriteTileUsage,
                    },
                    estimateExceedsMaximum: spriteEstimateExceedsMaximum,
                    exceeded: null,
                    allocation: "remaining and estimateExceedsMaximum compare raw metadata with the nominal 8x16-pair range. Sprite-mode normalization, compiled payloads, dynamic reservations and compiler banking are not established.",
                },
                actors: { used: spriteAnalysis.actorInstanceCount, limit: null, status: "unknown" },
            },
            hardware: {
                backgroundPaletteSlots: { limit: HARDWARE_PALETTE_SLOTS, used: usedTileSlots.length },
                objectPaletteSlots: { limit: HARDWARE_PALETTE_SLOTS, used: spriteAnalysis.referencedSlots.size },
                oamObjects: input.includeStaticOam === true
                    ? {
                        limit: MAX_OAM_OBJECTS,
                        estimate: spriteAnalysis.staticOamObjects,
                        exceeded: spriteAnalysis.staticOamObjects > MAX_OAM_OBJECTS,
                        playerGeometry: spriteAnalysis.playerGeometryStatus,
                        scope: "Maximum compiler-selected authored frame objects for each placed actor and any resolved player sprite; compiler removal, simultaneous visibility, runtime sprite changes or culling are unverified.",
                        provenance: "authored-static-estimate",
                        runtimeMeasured: false,
                    }
                    : { limit: MAX_OAM_OBJECTS, estimate: null, provenance: "not-measured", runtimeMeasured: false },
                scanlines: input.includeStaticOam === true
                    ? {
                        objectsPerScanlineLimit: MAX_SCANLINE_OBJECTS,
                        maximumStaticEstimate: spriteAnalysis.maximumScanlineObjects,
                        maximumWorldActorEstimate: spriteAnalysis.maximumWorldScanlineObjects,
                        maximumScreenPinnedActorEstimate: spriteAnalysis.maximumPinnedScanlineObjects,
                        screenPinnedActorInstances: spriteAnalysis.pinnedActorInstances,
                        spriteMode: spriteAnalysis.spriteMode,
                        estimateKind: "maximum-over-independently-possible-authored-animation-frames",
                        animationSelection: "native-compiler-mapped-state-slots",
                        geometryStatus: spriteAnalysis.actorInstancesWithIncompleteScanlineGeometry === 0 ? "complete" : "partial-known-object-offsets-only",
                        actorInstancesWithIncompleteGeometry: spriteAnalysis.actorInstancesWithIncompleteScanlineGeometry,
                        actorInstancesWithMismatchedSpriteMode: spriteAnalysis.actorInstancesWithMismatchedSpriteMode,
                        scope: "Placed actors in compiler-selected frames. Screen-pinned objects are clipped to the 144 hardware display rows; their maximum is added conservatively to the world maximum. The compiler may omit transparent or obscured objects; camera alignment, horizontal visibility, player, movement, animation synchronization, and runtime sprite changes or culling are unverified.",
                        provenance: "authored-static-estimate",
                        runtimeMeasured: false,
                    }
                    : { objectsPerScanlineLimit: MAX_SCANLINE_OBJECTS, maximumStaticEstimate: null, runtimeMeasured: false },
            },
        },
        ...(tiles === undefined ? {} : { tiles }),
        diagnostics,
        diagnosticCounts,
        truncation: {
            tiles: tiles !== undefined && offset + tiles.length < context.tileColors.length,
            diagnostics: analysis.truncation.violations,
            ...(spritesTruncated ? { sprites: true } : {}),
        },
    };
}
function validColors(value) {
    if (!Array.isArray(value) || value.length !== 4)
        return undefined;
    const colors = value.map((color) => typeof color === "string" ? color.replace(/^#/, "").toUpperCase() : "");
    return colors.every((color) => /^[\dA-F]{6}$/.test(color)) ? colors : undefined;
}
function monoColors(settings) {
    return validColors([
        settings.customColorsWhite,
        settings.customColorsLight,
        settings.customColorsDark,
        settings.customColorsBlack,
    ]) ?? [...FALLBACK_PALETTE_COLORS];
}
async function renderSceneGraphics(context, sourcePath, displayMode) {
    let source;
    try {
        source = PNG.sync.read(await readFile(sourcePath));
    }
    catch (error) {
        throw new GameStudioProjectError("INVALID_BACKGROUND_IMAGE", `Could not decode the authored background PNG: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (source.width < 1 || source.height < 1 || source.width * source.height > MAX_PREVIEW_PIXELS) {
        throw new GameStudioProjectError("INVALID_BACKGROUND_IMAGE", "The authored background exceeds the safe preview pixel budget.");
    }
    if (source.width !== context.width * 8 || source.height !== context.height * 8) {
        throw new GameStudioProjectError("INVALID_BACKGROUND_IMAGE", "The authored background PNG dimensions do not match its native tile metadata.");
    }
    const output = new PNG({ width: source.width, height: source.height });
    const limitations = new Set([
        "Static authored-source projection; not an emulator frame or gameplay capture.",
        "Does not reconstruct actors, overlays, UI, camera motion, runtime palette changes, or hardware color correction.",
    ]);
    if (context.metadata.autoColor === true) {
        limitations.add("Automatic background colorization is not reconstructed from authored source.");
    }
    let unsupportedSourcePixels = 0;
    let unresolvedPalettePixels = 0;
    let opaqueAttributePixels = 0;
    const monoPalette = monoColors(context.inventory.settings);
    for (let y = 0; y < source.height; y += 1) {
        for (let x = 0; x < source.width; x += 1) {
            const pixelIndex = (y * source.width + x) * 4;
            const shade = `${source.data[pixelIndex].toString(16).padStart(2, "0")}${source.data[pixelIndex + 1].toString(16).padStart(2, "0")}${source.data[pixelIndex + 2].toString(16).padStart(2, "0")}`.toUpperCase();
            const shadeIndex = FIXED_SOURCE_SHADES.get(shade);
            const tileIndex = Math.floor(y / 8) * context.width + Math.floor(x / 8);
            const slot = context.tileColors[tileIndex];
            const authoredPalette = slot < HARDWARE_PALETTE_SLOTS ? context.backgroundPalettes[slot] : null;
            const paletteColors = displayMode === "mono" ? monoPalette : validColors(authoredPalette?.colors);
            const displayColor = shadeIndex === undefined || paletteColors === undefined ? shade : paletteColors[shadeIndex];
            if (shadeIndex === undefined)
                unsupportedSourcePixels += 1;
            if (paletteColors === undefined && displayMode === "color")
                unresolvedPalettePixels += 1;
            if (slot >= HARDWARE_PALETTE_SLOTS)
                opaqueAttributePixels += 1;
            output.data[pixelIndex] = Number.parseInt(displayColor.slice(0, 2), 16);
            output.data[pixelIndex + 1] = Number.parseInt(displayColor.slice(2, 4), 16);
            output.data[pixelIndex + 2] = Number.parseInt(displayColor.slice(4, 6), 16);
            output.data[pixelIndex + 3] = source.data[pixelIndex + 3];
        }
    }
    if (unsupportedSourcePixels > 0)
        limitations.add(`${unsupportedSourcePixels} pixels do not use a verified native fixed source shade.`);
    if (unresolvedPalettePixels > 0)
        limitations.add(`${unresolvedPalettePixels} pixels reference an unresolved authored background palette.`);
    if (opaqueAttributePixels > 0)
        limitations.add(`${opaqueAttributePixels} pixels belong to tiles with opaque unverified attribute bits.`);
    return { image: output, metadata: {
            projectPath: context.inventory.projectPath,
            projectRoot: context.inventory.projectRoot,
            sceneId: context.scene.id,
            width: source.width,
            height: source.height,
            displayMode,
            provenance: "authored-source-projection",
            emulatorFrame: false,
            confidence: unsupportedSourcePixels === 0 && unresolvedPalettePixels === 0 && opaqueAttributePixels === 0 &&
                context.metadata.autoColor !== true ? "authored-palette-projection" : "limited",
            unsupportedSourcePixels,
            unresolvedPalettePixels,
            opaqueAttributePixels,
            limitations: Array.from(limitations),
        } };
}
export async function previewSceneGraphics(projectPath, input, access) {
    if (input.displayMode !== undefined && input.displayMode !== "color" && input.displayMode !== "mono") {
        throw new GameStudioProjectError("INVALID_DISPLAY_MODE", "Display mode must be color or mono.");
    }
    if (path.extname(input.outputPath).toLowerCase() !== ".png") {
        throw new GameStudioProjectError("INVALID_PREVIEW_PATH", "Scene graphics previews must use the .png extension.");
    }
    const context = await loadSceneGraphicsContext(projectPath, input.sceneId, access);
    const outputPath = await resolveProjectPath(context.inventory.projectRoot, input.outputPath, { allowRoot: false });
    const sourcePath = await resolveProjectPath(context.inventory.projectRoot, context.background.resourcePath, { mustExist: true });
    if (outputPath === sourcePath) {
        throw new GameStudioProjectError("INVALID_PREVIEW_PATH", "Scene previews must not overwrite authored background source artwork.");
    }
    const rendered = await renderSceneGraphics(context, sourcePath, input.displayMode ?? "color");
    await mkdir(path.dirname(outputPath), { recursive: true });
    const confirmedOutput = await resolveProjectPath(context.inventory.projectRoot, outputPath, { allowRoot: false });
    const png = PNG.sync.write(rendered.image);
    const file = await open(confirmedOutput, "wx", 0o600).catch((error) => {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
            throw new GameStudioProjectError("PREVIEW_OUTPUT_EXISTS", "The scene preview output already exists and was preserved. Choose a new project-local .png outputPath.");
        }
        throw error;
    });
    try {
        await file.writeFile(png);
        await file.sync();
    }
    finally {
        await file.close();
    }
    return { ...rendered.metadata, outputPath: confirmedOutput };
}
/** The existing authored projection, composed without intermediate preview files or emulator work. */
export async function previewSceneContactSheet(projectPath, input, access) {
    if (!Array.isArray(input.sceneIds) || input.sceneIds.length < 1 || input.sceneIds.length > 16 ||
        new Set(input.sceneIds).size !== input.sceneIds.length ||
        Array.from(input.sceneIds).some((id) => typeof id !== "string" || id.trim().length === 0 || id.length > 256)) {
        throw new GameStudioProjectError("INVALID_PREVIEW_OPTIONS", "Scene contact sheets require 1–16 distinct explicit scene IDs.");
    }
    if (input.displayMode !== undefined && input.displayMode !== "color" && input.displayMode !== "mono") {
        throw new GameStudioProjectError("INVALID_DISPLAY_MODE", "Display mode must be color or mono.");
    }
    if (typeof input.outputPath !== "string" || path.extname(input.outputPath).toLowerCase() !== ".png") {
        throw new GameStudioProjectError("INVALID_PREVIEW_PATH", "Scene contact sheets require a new project-local .png output.");
    }
    const columns = input.columns ?? Math.min(3, input.sceneIds.length);
    const magnification = input.magnification ?? 1;
    if (!Number.isSafeInteger(columns) || columns < 1 || columns > 8 ||
        !Number.isSafeInteger(magnification) || magnification < 1 || magnification > 4) {
        throw new GameStudioProjectError("INVALID_PREVIEW_OPTIONS", "Scene sheets require 1–8 columns and integer magnification 1–4.");
    }
    const selected = [];
    let totalPixels = 0;
    for (const sceneId of input.sceneIds) {
        const context = await loadSceneGraphicsContext(projectPath, sceneId, access);
        totalPixels += context.width * context.height * 64;
        if (totalPixels > MAX_PREVIEW_PIXELS) {
            throw new GameStudioProjectError("INVALID_PREVIEW_OPTIONS", "The selected scenes exceed the aggregate preview pixel budget.");
        }
        const sourcePath = await resolveProjectPath(context.inventory.projectRoot, context.background.resourcePath, { mustExist: true });
        selected.push({ context, sourcePath });
    }
    const root = selected[0].context.inventory.projectRoot;
    const outputPath = await resolveProjectPath(root, input.outputPath, { allowRoot: false });
    if (selected.some(({ context, sourcePath }) => context.inventory.projectRoot !== root || sourcePath === outputPath)) {
        throw new GameStudioProjectError("INVALID_PREVIEW_PATH", "Scene sheets must preserve authored sources in the same project.");
    }
    const images = [];
    const scenes = [];
    for (const [index, { context, sourcePath }] of selected.entries()) {
        const { image, metadata } = await renderSceneGraphics(context, sourcePath, input.displayMode ?? "color");
        const png = PNG.sync.write(image);
        const sha256 = createHash("sha256").update(png).digest("hex");
        images.push({ png, sha256, label: `SCENE ${index + 1} / ${metadata.displayMode.toUpperCase()}`, caption: "STATIC / NOT GAMEPLAY" });
        const { projectRoot: _root, projectPath: _project, ...details } = metadata;
        scenes.push({ ...details, sha256 });
    }
    const { png, ...sheet } = renderContactSheetPng({
        images, columns, magnification, title: "STATIC SCENE CONTACT SHEET",
        subtitle: "BACKGROUND ONLY / NOT RUNTIME",
    });
    await mkdir(path.dirname(outputPath), { recursive: true });
    const confirmedOutput = await resolveProjectPath(root, outputPath, { allowRoot: false });
    // New sheets never overwrite an earlier capture or an authored resource.
    const file = await open(confirmedOutput, "wx", 0o600);
    try {
        await file.writeFile(png);
        await file.sync();
    }
    finally {
        await file.close();
    }
    return {
        ...sheet, outputPath: confirmedOutput, provenance: "authored-scene-contact-sheet",
        emulatorFrame: false, runtimeVerified: false, sceneCount: scenes.length, scenes,
        selection: "explicit-scene-ids-in-request-order", otherScenesIncluded: false,
    };
}
//# sourceMappingURL=scene-graphics.js.map