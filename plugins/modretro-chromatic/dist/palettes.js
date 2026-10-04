import { createHash } from "node:crypto";
import { realpath } from "node:fs/promises";
import path from "node:path";
import { GameStudioProjectError, inventoryProject, } from "./project.js";
import { projectPathExists, readProjectJson, resourceSlug, stableResourceId, writeProjectJsonAtomic, } from "./project-files.js";
import { decodeSemanticCursor, encodeSemanticCursor, isSemanticCursorCurrent, PROJECT_REVISION_ALGORITHM, } from "./project-access.js";
import { projectRevision } from "./project-snapshot.js";
import { decodeResourceBytes, encodeResourceBytes } from "./resource-codec.js";
export const HARDWARE_PALETTE_SLOTS = 8;
export const DEFAULT_UI_PALETTE_SLOT = 7;
export const FALLBACK_PALETTE_COLORS = ["E0F8CF", "86C06C", "306850", "071821"];
const PALETTE_INSPECTION_PAGE_LIMIT = 250;
const PALETTE_INSPECTION_BYTE_LIMIT = 30 * 1024;
const PALETTE_INSPECTION_CURSOR_QUERY = "palette-inspect-v1";
async function paletteCursorQuery(projectPath) {
    const canonicalDescriptor = await realpath(projectPath);
    return `${PALETTE_INSPECTION_CURSOR_QUERY}:${createHash("sha256").update(canonicalDescriptor).digest("hex")}`;
}
async function paletteProject(projectPath, access) {
    if (access === undefined)
        return inventoryProject(projectPath);
    await access.ensureFresh();
    const inspection = access.projectInspection();
    const completeSettings = access.settings?.() ?? inspection.settings;
    return {
        projectPath: access.projectPath,
        projectRoot: access.projectRoot,
        format: inspection.format,
        settings: completeSettings,
        palettes: [],
        scenes: [],
        assets: [],
        counts: inspection.counts,
    };
}
function normalizeColors(colors) {
    if (colors.length !== 4) {
        throw new GameStudioProjectError("INVALID_PALETTE_COLORS", "A Game Boy Color palette must contain exactly four RGB colors.");
    }
    return colors.map((color, index) => {
        if (typeof color !== "string" || !/^#?[\da-f]{6}$/i.test(color)) {
            throw new GameStudioProjectError("INVALID_PALETTE_COLOR", `Palette color ${index} must be a six-digit RGB hexadecimal value.`);
        }
        return color.replace(/^#/, "").toUpperCase();
    });
}
function requirePalette(inventory, id, access) {
    const palette = access === undefined
        ? inventory.palettes.find((candidate) => candidate.id === id)
        : access.palette(id);
    if (palette === undefined) {
        throw new GameStudioProjectError("PALETTE_NOT_FOUND", `No palette exists with id ${id}.`);
    }
    return palette;
}
function requireScene(inventory, id, access) {
    const scene = access === undefined
        ? inventory.scenes.find((candidate) => candidate.id === id)
        : access.scene(id);
    if (scene === undefined) {
        throw new GameStudioProjectError("SCENE_NOT_FOUND", `No scene exists with id ${id}.`);
    }
    return scene;
}
function paletteIds(value) {
    return Array.isArray(value) ? value.map((id) => typeof id === "string" ? id : "") : [];
}
export function resolvePaletteSlots(inventory, scene, target, access) {
    const defaults = paletteIds(target === "background" ? inventory.settings.defaultBackgroundPaletteIds : inventory.settings.defaultSpritePaletteIds);
    const overrides = paletteIds(target === "background" ? scene.paletteIds : scene.spritePaletteIds);
    return Array.from({ length: HARDWARE_PALETTE_SLOTS }, (_, slot) => {
        const firstPaletteId = slot === 0 && !overrides[slot] && !defaults[slot]
            ? (access === undefined ? inventory.palettes[0]?.id : access.resourcesByKind("palette")[0]?.id)
            : undefined;
        const id = overrides[slot] || defaults[slot] || firstPaletteId;
        return id === undefined
            ? null
            : access === undefined
                ? inventory.palettes.find((palette) => palette.id === id) ?? null
                : access.palette(id) ?? null;
    });
}
export function resolveUiPalette(inventory, access) {
    const id = typeof inventory.settings.defaultUIPaletteId === "string"
        ? inventory.settings.defaultUIPaletteId
        : null;
    const defaults = paletteIds(inventory.settings.defaultBackgroundPaletteIds);
    const detectedSlot = id === null ? -1 : defaults.indexOf(id);
    const slot = detectedSlot < 0 ? DEFAULT_UI_PALETTE_SLOT : detectedSlot;
    const palette = id === null
        ? undefined
        : access === undefined
            ? inventory.palettes.find((candidate) => candidate.id === id)
            : access.palette(id);
    return {
        id,
        colors: Array.isArray(palette?.colors) && palette.colors.length === 4
            ? normalizeColors(palette.colors)
            : [...FALLBACK_PALETTE_COLORS],
        slot,
        source: palette === undefined ? "fallback" : "project-palette",
    };
}
function referencedSceneCount(inventory, paletteId, access) {
    if (access !== undefined) {
        const sceneIds = new Set();
        for (const reference of access.effectiveReferences({ type: "palette", id: paletteId })) {
            if (reference.owner.resourceType === "scene") {
                sceneIds.add(reference.owner.sceneId ?? reference.owner.resourceId);
            }
        }
        return sceneIds.size;
    }
    return inventory.scenes.filter((scene) => [...resolvePaletteSlots(inventory, scene, "background"), ...resolvePaletteSlots(inventory, scene, "sprite")]
        .some((palette) => palette?.id === paletteId)).length;
}
function validateSlot(slot) {
    if (!Number.isInteger(slot) || slot < 0 || slot >= HARDWARE_PALETTE_SLOTS) {
        throw new GameStudioProjectError("INVALID_PALETTE_SLOT", "Palette slots must be integers from 0 through 7.");
    }
}
function validatePositiveInteger(value, field) {
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new GameStudioProjectError("INVALID_PALETTE_EDIT", `${field} must be a positive integer.`);
    }
}
export async function inspectPalettes(projectPath, access, input = {}) {
    if (input.paletteId !== undefined && (typeof input.paletteId !== "string"
        || input.paletteId.trim().length === 0 || input.paletteId.trim().length > 256)) {
        throw new GameStudioProjectError("INVALID_PALETTE_INSPECTION", "paletteId must be a nonempty palette ID of at most 256 characters.");
    }
    if (input.limit !== undefined && (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > PALETTE_INSPECTION_PAGE_LIMIT)) {
        throw new GameStudioProjectError("INVALID_PALETTE_INSPECTION", `limit must be an integer from 1 through ${PALETTE_INSPECTION_PAGE_LIMIT}.`);
    }
    if (input.paletteId !== undefined && (input.limit !== undefined || input.cursor !== undefined)) {
        throw new GameStudioProjectError("INVALID_PALETTE_INSPECTION", "Use paletteId for one palette, or use limit and cursor to list palettes; do not combine them.");
    }
    const standaloneRevision = access === undefined ? await projectRevision(projectPath) : undefined;
    const inventory = await paletteProject(projectPath, access);
    const cursorIdentity = {
        revision: access?.revision ?? standaloneRevision,
        revisionAlgorithm: access?.revisionAlgorithm ?? PROJECT_REVISION_ALGORITHM,
        selectionGeneration: access?.selectionGeneration ?? 0,
        semanticGeneration: access?.semanticGeneration ?? 0,
    };
    let offset = 0;
    let cursorQuery;
    if (input.cursor !== undefined) {
        const cursor = decodeSemanticCursor(input.cursor);
        if (cursor === undefined) {
            throw new GameStudioProjectError("INVALID_CURSOR", "The palette inspection cursor is malformed. Restart the list without cursor.");
        }
        cursorQuery = await paletteCursorQuery(inventory.projectPath);
        if (!isSemanticCursorCurrent(cursor, cursorIdentity, cursorQuery)) {
            throw new GameStudioProjectError("STALE_CURSOR", "The palette inspection cursor no longer matches this project, selection, revision, or reference index. Restart the list without cursor.");
        }
        offset = cursor.offset;
    }
    const focused = input.paletteId !== undefined;
    const indexedPalettes = focused ? [] : access === undefined ? inventory.palettes : access.resourcesByKind("palette");
    const paletteCount = focused ? inventory.counts.palettes : indexedPalettes.length;
    if (offset > paletteCount) {
        throw new GameStudioProjectError("STALE_CURSOR", "The palette inspection cursor points beyond the current list. Restart the list without cursor.");
    }
    const candidates = focused ? [requirePalette(inventory, input.paletteId.trim(), access)] : indexedPalettes.slice(offset);
    const limit = input.limit ?? PALETTE_INSPECTION_PAGE_LIMIT;
    const palettes = [];
    let responseBytes = 0;
    for (const palette of candidates) {
        if (palettes.length >= limit)
            break;
        const entry = { ...palette, affectedSceneCount: referencedSceneCount(inventory, palette.id, access) };
        const entryBytes = Buffer.byteLength(JSON.stringify(entry));
        if (entryBytes > PALETTE_INSPECTION_BYTE_LIMIT) {
            if (palettes.length > 0)
                break;
            throw new GameStudioProjectError("PALETTE_RESPONSE_TOO_LARGE", `Authored palette ${palette.id} exceeds the bounded inspection response; inspect its resource directly.`);
        }
        if (responseBytes + entryBytes > PALETTE_INSPECTION_BYTE_LIMIT)
            break;
        responseBytes += entryBytes;
        palettes.push(entry);
    }
    const nextOffset = offset + palettes.length;
    const truncated = !focused && nextOffset < paletteCount;
    const includePaging = focused || input.limit !== undefined || input.cursor !== undefined || truncated;
    if (includePaging && access === undefined && standaloneRevision !== await projectRevision(projectPath)) {
        throw new GameStudioProjectError("STALE_PROJECT", "The project changed while inspecting palettes. Restart the list without cursor.");
    }
    return {
        projectPath: inventory.projectPath,
        projectRoot: inventory.projectRoot,
        palettes,
        reservedUiPalette: resolveUiPalette(inventory, access),
        ...(includePaging ? {
            revision: cursorIdentity.revision,
            paletteCount,
            returned: palettes.length,
            truncated,
            nextCursor: truncated ? encodeSemanticCursor({
                ...cursorIdentity, query: cursorQuery ?? await paletteCursorQuery(inventory.projectPath), offset: nextOffset,
            }) : null,
        } : {}),
    };
}
export async function createPalette(projectPath, input, access) {
    const inventory = await paletteProject(projectPath, access);
    const name = input.name.trim();
    if (name.length === 0) {
        throw new GameStudioProjectError("INVALID_PALETTE_NAME", "Palette names must not be empty.");
    }
    const colors = normalizeColors(input.colors);
    const id = input.id?.trim() || stableResourceId("palette", name);
    if (access === undefined ? inventory.palettes.some((palette) => palette.id === id) : access.palette(id) !== undefined) {
        throw new GameStudioProjectError("DUPLICATE_PALETTE_ID", `A palette already exists with id ${id}.`);
    }
    const palette = {
        _resourceType: "palette",
        id,
        name,
        colors,
        defaultName: name,
        defaultColors: [...colors],
    };
    if (inventory.format === "legacy") {
        const descriptor = await readProjectJson(inventory.projectRoot, inventory.projectPath);
        const existing = Array.isArray(descriptor.palettes) ? descriptor.palettes : [];
        descriptor.palettes = [...existing, palette];
        await writeProjectJsonAtomic(inventory.projectRoot, inventory.projectPath, descriptor);
        return {
            projectPath: inventory.projectPath,
            projectRoot: inventory.projectRoot,
            resourcePath: path.basename(inventory.projectPath),
            palette,
            affectedSceneCount: 0,
        };
    }
    const slug = resourceSlug(name, "palette");
    let resourcePath = path.join("project", "palettes", `${slug}.gbsres`);
    let suffix = 2;
    while (await projectPathExists(inventory.projectRoot, path.join(inventory.projectRoot, resourcePath))) {
        resourcePath = path.join("project", "palettes", `${slug}_${suffix}.gbsres`);
        suffix += 1;
    }
    await writeProjectJsonAtomic(inventory.projectRoot, path.join(inventory.projectRoot, resourcePath), palette);
    return {
        projectPath: inventory.projectPath,
        projectRoot: inventory.projectRoot,
        resourcePath: resourcePath.split(path.sep).join("/"),
        palette,
        affectedSceneCount: 0,
    };
}
export async function updatePalette(projectPath, input, access) {
    const inventory = await paletteProject(projectPath, access);
    const existing = requirePalette(inventory, input.paletteId, access);
    if (input.name !== undefined && input.name.trim().length === 0) {
        throw new GameStudioProjectError("INVALID_PALETTE_NAME", "Palette names must not be empty.");
    }
    if (input.updateDefaultColors === true && input.colors === undefined) {
        throw new GameStudioProjectError("INVALID_PALETTE_COLORS", "Updating default colors requires replacement palette colors.");
    }
    const colors = input.colors === undefined ? undefined : normalizeColors(input.colors);
    const update = (palette) => ({
        ...palette,
        ...(input.name === undefined ? {} : { name: input.name.trim() }),
        ...(colors === undefined ? {} : { colors }),
        ...(input.updateDefaultColors === true ? { defaultColors: colors } : {}),
    });
    let palette;
    if (inventory.format === "legacy") {
        const descriptor = await readProjectJson(inventory.projectRoot, inventory.projectPath);
        const palettes = Array.isArray(descriptor.palettes) ? descriptor.palettes : [];
        let changed;
        descriptor.palettes = palettes.map((candidate) => {
            if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate) || candidate.id !== input.paletteId) {
                return candidate;
            }
            changed = update(candidate);
            return changed;
        });
        palette = changed;
        await writeProjectJsonAtomic(inventory.projectRoot, inventory.projectPath, descriptor);
    }
    else {
        const absolute = path.join(inventory.projectRoot, existing.resourcePath);
        palette = update(await readProjectJson(inventory.projectRoot, absolute));
        await writeProjectJsonAtomic(inventory.projectRoot, absolute, palette);
    }
    return {
        projectPath: inventory.projectPath,
        projectRoot: inventory.projectRoot,
        resourcePath: existing.resourcePath,
        palette,
        affectedSceneCount: referencedSceneCount(inventory, input.paletteId, access),
    };
}
export async function assignScenePalette(projectPath, input, access) {
    const inventory = await paletteProject(projectPath, access);
    const scene = requireScene(inventory, input.sceneId, access);
    requirePalette(inventory, input.paletteId, access);
    validateSlot(input.slot);
    const uiPalette = resolveUiPalette(inventory, access);
    if (input.target === "background" && input.slot === uiPalette.slot && input.allowUiSlot !== true) {
        throw new GameStudioProjectError("UI_PALETTE_SLOT_RESERVED", `Background palette slot ${input.slot} is reserved for the UI/font palette; set allowUiSlot to override it explicitly.`);
    }
    const field = input.target === "background" ? "paletteIds" : "spritePaletteIds";
    const update = (resource) => {
        const ids = paletteIds(resource[field]);
        while (ids.length <= input.slot)
            ids.push("");
        ids[input.slot] = input.paletteId;
        return { ...resource, [field]: ids };
    };
    let updated;
    if (inventory.format === "legacy") {
        const descriptor = await readProjectJson(inventory.projectRoot, inventory.projectPath);
        const scenes = Array.isArray(descriptor.scenes) ? descriptor.scenes : [];
        let changed;
        descriptor.scenes = scenes.map((candidate) => {
            if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate) || candidate.id !== input.sceneId) {
                return candidate;
            }
            changed = update(candidate);
            return changed;
        });
        updated = changed;
        await writeProjectJsonAtomic(inventory.projectRoot, inventory.projectPath, descriptor);
    }
    else {
        const absolute = path.join(inventory.projectRoot, scene.resourcePath);
        updated = update(await readProjectJson(inventory.projectRoot, absolute));
        await writeProjectJsonAtomic(inventory.projectRoot, absolute, updated);
    }
    return {
        projectPath: inventory.projectPath,
        projectRoot: inventory.projectRoot,
        resourcePath: scene.resourcePath,
        scene: updated,
        target: input.target,
        slot: input.slot,
        paletteId: input.paletteId,
    };
}
export function decodeBackgroundPaletteTiles(metadata, totalTiles) {
    const encoded = typeof metadata.tileColors === "string" ? metadata.tileColors : "";
    const decoded = decodeResourceBytes(encoded, { maximumValues: totalTiles, allowImplicitZeroGrid: true });
    if (decoded.length === 0)
        return new Uint8Array(totalTiles);
    if (decoded.length !== totalTiles) {
        throw new GameStudioProjectError("INVALID_TILE_COLOR_GRID", `Background tile colors decode to ${decoded.length} entries, but the background contains ${totalTiles} tiles.`);
    }
    return decoded;
}
/** Apply bounded palette edits without mutating metadata or accessing a project. */
export function applyBackgroundPaletteEdits(metadata, input) {
    const { width, height } = input;
    if (input.edits.length === 0 || input.edits.length > 1_024) {
        throw new GameStudioProjectError("INVALID_PALETTE_EDIT", "Provide between 1 and 1,024 bounded palette edits.");
    }
    validatePositiveInteger(width, "Background tile width");
    validatePositiveInteger(height, "Background tile height");
    const totalTiles = width * height;
    if (!Number.isSafeInteger(totalTiles) || totalTiles > 1_048_576) {
        throw new GameStudioProjectError("INVALID_TILE_COLOR_GRID", "The background palette grid exceeds its safe size limit.");
    }
    validateSlot(input.reservedUiSlot);
    const tileColors = decodeBackgroundPaletteTiles(metadata, totalTiles);
    const changed = new Set();
    for (const edit of input.edits) {
        validateSlot(edit.slot);
        if (edit.slot === input.reservedUiSlot) {
            throw new GameStudioProjectError("UI_PALETTE_SLOT_RESERVED", `Background palette slot ${edit.slot} is reserved for the UI/font palette.`);
        }
        if (input.assignedSlots !== undefined && !input.assignedSlots.includes(edit.slot)) {
            throw new GameStudioProjectError("UNASSIGNED_PALETTE_SLOT", `Scene background palette slot ${edit.slot} has no assigned palette.`);
        }
        const editWidth = edit.width ?? 1;
        const editHeight = edit.height ?? 1;
        validatePositiveInteger(editWidth, "Palette edit width");
        validatePositiveInteger(editHeight, "Palette edit height");
        if (!Number.isSafeInteger(edit.x) || !Number.isSafeInteger(edit.y) || edit.x < 0 || edit.y < 0 ||
            edit.x + editWidth > width || edit.y + editHeight > height) {
            throw new GameStudioProjectError("PALETTE_EDIT_OUT_OF_BOUNDS", `Palette edit (${edit.x}, ${edit.y}) exceeds the ${width}×${height} background tile grid.`);
        }
        for (let y = edit.y; y < edit.y + editHeight; y += 1) {
            for (let x = edit.x; x < edit.x + editWidth; x += 1) {
                const index = y * width + x;
                const previous = tileColors[index];
                if (previous >= HARDWARE_PALETTE_SLOTS) {
                    throw new GameStudioProjectError("UNSUPPORTED_TILE_COLOR_ATTRIBUTES", `Tile (${x}, ${y}) contains opaque unverified attribute bits (${previous}); refusing to alter its native metadata.`);
                }
                if (previous !== edit.slot) {
                    tileColors[index] = edit.slot;
                    changed.add(index);
                }
            }
        }
    }
    const tileSlotHistogram = {};
    for (const slot of tileColors)
        tileSlotHistogram[String(slot)] = (tileSlotHistogram[String(slot)] ?? 0) + 1;
    return {
        metadata: changed.size > 0 ? { ...metadata, tileColors: encodeResourceBytes(tileColors) } : metadata,
        affectedTileCount: changed.size,
        tileSlotHistogram,
    };
}
export async function paintBackgroundPalette(projectPath, input, access) {
    const inventory = await paletteProject(projectPath, access);
    const background = access === undefined
        ? inventory.assets.find((asset) => asset.type === "background" && asset.id === input.backgroundId)
        : access.asset({ assetId: input.backgroundId }).asset;
    if (background === undefined || background.type !== "background" || background.metadataPath === null) {
        throw new GameStudioProjectError("BACKGROUND_NOT_FOUND", `No editable background exists with id ${input.backgroundId}.`);
    }
    if (input.edits.length === 0 || input.edits.length > 1_024) {
        throw new GameStudioProjectError("INVALID_PALETTE_EDIT", "Provide between 1 and 1,024 bounded palette edits.");
    }
    const scene = input.sceneId === undefined ? undefined : requireScene(inventory, input.sceneId, access);
    if (scene !== undefined && scene.backgroundId !== background.id) {
        throw new GameStudioProjectError("SCENE_BACKGROUND_MISMATCH", "The selected scene does not use the selected background.");
    }
    const metadataPath = path.join(inventory.projectRoot, background.metadataPath);
    const metadata = await readProjectJson(inventory.projectRoot, metadataPath);
    const width = typeof metadata.width === "number" ? metadata.width : Math.ceil((background.width ?? 0) / 8);
    const height = typeof metadata.height === "number" ? metadata.height : Math.ceil((background.height ?? 0) / 8);
    const sceneSlots = scene === undefined ? undefined : resolvePaletteSlots(inventory, scene, "background", access);
    const applied = applyBackgroundPaletteEdits(metadata, {
        width,
        height,
        edits: input.edits,
        reservedUiSlot: resolveUiPalette(inventory, access).slot,
        ...(sceneSlots === undefined ? {} : {
            assignedSlots: sceneSlots.flatMap((palette, slot) => palette === null ? [] : [slot]),
        }),
    });
    if (applied.affectedTileCount > 0) {
        await writeProjectJsonAtomic(inventory.projectRoot, metadataPath, applied.metadata);
    }
    const affectedSceneCount = access === undefined
        ? inventory.scenes.filter((candidate) => candidate.backgroundId === background.id).length
        : new Set(access.assetUsers(background.id)
            .filter((reference) => reference.owner.resourceType === "scene")
            .map((reference) => reference.owner.sceneId ?? reference.owner.resourceId)
            .filter((sceneId) => access.scene(sceneId)?.backgroundId === background.id)).size;
    return {
        projectPath: inventory.projectPath,
        projectRoot: inventory.projectRoot,
        resourcePath: background.metadataPath,
        backgroundId: background.id,
        affectedTileCount: applied.affectedTileCount,
        affectedSceneCount,
        tileSlotHistogram: applied.tileSlotHistogram,
    };
}
//# sourceMappingURL=palettes.js.map