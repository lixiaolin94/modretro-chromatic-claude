import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { findAssetMetadata } from "./assets.js";
import { projectRelativePath, resolveProjectPath, resourceSlug, stableResourceId, writeProjectJsonAtomic, } from "./project-files.js";
import { GameStudioProjectError } from "./project.js";
const SOURCE_PREVIEW_LABEL = "Authored sprite source composite; not an emulator framebuffer or gameplay capture.";
const MAX_PREVIEW_FRAMES = 32;
const SPRITE_TILE_WIDTH = 8;
const SPRITE_TILE_HEIGHT = 16;
const CHROMA_RED = 0x65;
const CHROMA_GREEN = 0xff;
const CHROMA_BLUE = 0x00;
function spriteError(code, message) {
    throw new GameStudioProjectError(code, message);
}
function asObject(value, label) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        spriteError("INVALID_SPRITE_RESOURCE", `Sprite ${label} must be a JSON object.`);
    }
    return value;
}
function asArray(value, label) {
    if (!Array.isArray(value))
        spriteError("INVALID_SPRITE_RESOURCE", `Sprite ${label} must be an array.`);
    return value;
}
function asNumber(value, fallback = 0) {
    return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function integer(value, name, minimum, maximum) {
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
        spriteError("INVALID_INPUT", `${name} must be an integer between ${minimum} and ${maximum}.`);
    }
    return value;
}
function nestedId(rootId, ...parts) {
    return stableResourceId("sprite", rootId, ...parts.map(String));
}
function objectTile(rootId, animationIndex, frameIndex, tileIndex, sliceX) {
    return {
        id: nestedId(rootId, "tile", animationIndex, frameIndex, tileIndex),
        x: tileIndex * SPRITE_TILE_WIDTH,
        y: 0,
        sliceX: sliceX + tileIndex * SPRITE_TILE_WIDTH,
        sliceY: 0,
        flipX: false,
        flipY: false,
        palette: 0,
        paletteIndex: 0,
        objPalette: "OBP0",
        priority: false,
    };
}
function animationFrame(rootId, animationIndex, frameIndex, sliceX) {
    return {
        id: nestedId(rootId, "frame", animationIndex, frameIndex),
        tiles: sliceX === undefined
            ? []
            : [objectTile(rootId, animationIndex, frameIndex, 0, sliceX), objectTile(rootId, animationIndex, frameIndex, 1, sliceX)],
    };
}
function profileLayout(profile) {
    if (profile === "static" || profile === "static16x16") {
        return {
            width: 16,
            animationType: "fixed",
            flipLeft: false,
            numTiles: 2,
            boundsY: -8,
            boundsHeight: 16,
            slices: [[0], [undefined], [undefined], [undefined], [undefined], [undefined], [undefined], [undefined]],
        };
    }
    if (profile === "directional" || profile === "directional48x16") {
        return {
            width: 48,
            animationType: "multi",
            flipLeft: true,
            numTiles: 5,
            boundsY: -8,
            boundsHeight: 16,
            slices: [[32], [undefined], [16], [0], [undefined], [undefined], [undefined], [undefined]],
        };
    }
    if (profile === "directional_animated" || profile === "directional_animated96x16") {
        return {
            width: 96,
            animationType: "multi_movement",
            flipLeft: true,
            numTiles: 10,
            boundsY: 0,
            boundsHeight: 8,
            slices: [[64], [undefined], [32], [0], [80, 64], [undefined], [48, 32], [16, 0]],
        };
    }
    return spriteError("UNSUPPORTED_SPRITE_PROFILE", `Unsupported or unproven sprite profile ${String(profile)}.`);
}
function replaceNestedIds(value, assetId, trail = "root") {
    if (Array.isArray(value))
        return value.map((entry, index) => replaceNestedIds(entry, assetId, `${trail}.${index}`));
    if (typeof value !== "object" || value === null)
        return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [
        key,
        key === "id" && trail !== "root" ? nestedId(assetId, trail) : replaceNestedIds(child, assetId, `${trail}.${key}`),
    ]));
}
export async function createSpriteResource(projectRoot, input, access) {
    if (input.profile === "template") {
        if (!input.templateAssetId) {
            spriteError("SPRITE_TEMPLATE_REQUIRED", "The template profile requires an existing templateAssetId.");
        }
        const template = await findAssetMetadata(projectRoot, { assetId: input.templateAssetId }, access);
        if (template.metadata._resourceType !== "sprite") {
            spriteError("INVALID_SPRITE_TEMPLATE", "A sprite template must refer to an existing sprite asset.");
        }
        if (template.metadata.width !== input.width || template.metadata.height !== input.height) {
            spriteError("SPRITE_TEMPLATE_DIMENSIONS", "Sprite source dimensions must match the selected native template.");
        }
        return {
            ...replaceNestedIds(template.metadata, input.id),
            id: input.id,
            name: input.name,
            symbol: `sprite_${resourceSlug(input.name, "sprite")}`,
            filename: input.filename,
            width: input.width,
            height: input.height,
            checksum: input.checksum,
        };
    }
    const layout = profileLayout(input.profile);
    if (input.width !== layout.width || input.height !== 16) {
        spriteError("INVALID_SPRITE_DIMENSIONS", `Sprite profile ${input.profile} requires exactly ${layout.width} × 16 source pixels.`);
    }
    return {
        _resourceType: "sprite",
        id: input.id,
        name: input.name,
        symbol: `sprite_${resourceSlug(input.name, "sprite")}`,
        states: [
            {
                id: nestedId(input.id, "state", 0),
                name: "",
                animationType: layout.animationType,
                flipLeft: layout.flipLeft,
                animations: layout.slices.map((frames, animationIndex) => ({
                    id: nestedId(input.id, "animation", animationIndex),
                    frames: frames.map((sliceX, frameIndex) => animationFrame(input.id, animationIndex, frameIndex, sliceX)),
                })),
            },
        ],
        numTiles: layout.numTiles,
        canvasOriginX: 0,
        canvasOriginY: 0,
        canvasWidth: 16,
        canvasHeight: 16,
        boundsX: 0,
        boundsY: layout.boundsY,
        boundsWidth: 16,
        boundsHeight: layout.boundsHeight,
        animSpeed: 15,
        filename: input.filename,
        width: input.width,
        height: input.height,
        checksum: input.checksum,
    };
}
async function loadSprite(projectRoot, input, access) {
    const assetId = input.spriteId ?? input.assetId;
    if (input.spriteId && input.assetId && input.spriteId !== input.assetId) {
        spriteError("INVALID_INPUT", "spriteId and assetId must identify the same sprite.");
    }
    const loaded = await findAssetMetadata(projectRoot, { assetId, assetPath: input.assetPath }, access);
    if (loaded.metadata._resourceType !== "sprite") {
        spriteError("INVALID_SPRITE_RESOURCE", `Asset ${loaded.assetPath} is not a native game sprite.`);
    }
    return loaded;
}
function summarizeSprite(metadata, assetPath, includeFrames = false) {
    const states = asArray(metadata.states, "states").map((entry, stateIndex) => {
        const state = asObject(entry, `state ${stateIndex}`);
        return {
            id: String(state.id),
            name: String(state.name ?? ""),
            animationType: String(state.animationType),
            flipLeft: state.flipLeft === true,
            animations: asArray(state.animations, `state ${stateIndex} animations`).map((animationEntry, animationIndex) => {
                const animation = asObject(animationEntry, `animation ${animationIndex}`);
                const frames = asArray(animation.frames, `animation ${animationIndex} frames`);
                const result = {
                    id: String(animation.id),
                    index: animationIndex,
                    frameCount: frames.length,
                };
                if (includeFrames) {
                    result.frames = frames.map((frameEntry, frameIndex) => {
                        const frame = asObject(frameEntry, `frame ${frameIndex}`);
                        const tiles = asArray(frame.tiles, `frame ${frameIndex} tiles`);
                        return {
                            id: String(frame.id),
                            tileCount: tiles.length,
                            tiles: tiles.map((tileEntry, tileIndex) => {
                                const tile = asObject(tileEntry, `tile ${tileIndex}`);
                                return {
                                    id: String(tile.id),
                                    x: asNumber(tile.x),
                                    y: asNumber(tile.y),
                                    sliceX: asNumber(tile.sliceX),
                                    sliceY: asNumber(tile.sliceY),
                                    flipX: tile.flipX === true,
                                    flipY: tile.flipY === true,
                                    palette: asNumber(tile.palette),
                                    paletteIndex: asNumber(tile.paletteIndex),
                                    objPalette: String(tile.objPalette ?? "OBP0"),
                                    priority: tile.priority === true,
                                };
                            }),
                        };
                    });
                }
                return result;
            }),
        };
    });
    return {
        id: String(metadata.id),
        kind: "sprite",
        name: String(metadata.name),
        assetPath,
        metadataPath: `${assetPath}.gbsres`,
        width: asNumber(metadata.width),
        height: asNumber(metadata.height),
        checksum: String(metadata.checksum),
        numTiles: asNumber(metadata.numTiles),
        canvas: {
            originX: asNumber(metadata.canvasOriginX),
            originY: asNumber(metadata.canvasOriginY),
            width: asNumber(metadata.canvasWidth, 16),
            height: asNumber(metadata.canvasHeight, 16),
        },
        bounds: {
            x: asNumber(metadata.boundsX),
            y: asNumber(metadata.boundsY),
            width: asNumber(metadata.boundsWidth),
            height: asNumber(metadata.boundsHeight),
        },
        animSpeed: asNumber(metadata.animSpeed),
        states,
    };
}
export async function inspectSprite(projectRoot, input, access) {
    const loaded = await loadSprite(projectRoot, input, access);
    return summarizeSprite(loaded.metadata, loaded.assetPath, input.includeFrames);
}
export async function updateSprite(projectRoot, input, access) {
    const loaded = await loadSprite(projectRoot, input, access);
    const updated = structuredClone(loaded.metadata);
    if (input.name !== undefined) {
        const name = input.name.trim();
        if (!name)
            spriteError("INVALID_INPUT", "Sprite names cannot be empty.");
        updated.name = name;
        updated.symbol = `sprite_${resourceSlug(name, "sprite")}`;
    }
    if (input.animSpeed !== undefined)
        updated.animSpeed = integer(input.animSpeed, "animSpeed", 0, 255);
    if (input.boundsX !== undefined)
        updated.boundsX = integer(input.boundsX, "boundsX", -128, 127);
    if (input.boundsY !== undefined)
        updated.boundsY = integer(input.boundsY, "boundsY", -128, 127);
    if (input.boundsWidth !== undefined)
        updated.boundsWidth = integer(input.boundsWidth, "boundsWidth", 1, 255);
    if (input.boundsHeight !== undefined)
        updated.boundsHeight = integer(input.boundsHeight, "boundsHeight", 1, 255);
    if (input.flipLeft !== undefined || input.animationType !== undefined) {
        const stateIndex = integer(input.stateIndex ?? 0, "stateIndex", 0, 31);
        const states = asArray(updated.states, "states");
        const state = asObject(states[stateIndex], `state ${stateIndex}`);
        if (input.flipLeft !== undefined)
            state.flipLeft = input.flipLeft;
        if (input.animationType !== undefined) {
            if (!["fixed", "multi", "multi_movement"].includes(input.animationType)) {
                spriteError("INVALID_INPUT", "animationType must be fixed, multi, or multi_movement.");
            }
            state.animationType = input.animationType;
        }
    }
    await writeProjectJsonAtomic(loaded.projectRoot, loaded.metadataPath, updated);
    return summarizeSprite(updated, loaded.assetPath, input.includeFrames);
}
function compositeFrame(source, metadata, frame) {
    const width = integer(asNumber(metadata.canvasWidth, 16), "sprite canvasWidth", 1, 256);
    const height = integer(asNumber(metadata.canvasHeight, 16), "sprite canvasHeight", 1, 256);
    // Native 8x16 metasprites use a centered X origin and positive Y points up
    // from the bottom tile row. Canvases narrower than 16 keep their X origin.
    const originX = width < 16 ? 0 : width / 2 - SPRITE_TILE_WIDTH;
    const originY = height - SPRITE_TILE_HEIGHT;
    const image = new PNG({ width, height, colorType: 6 });
    for (const tileEntry of asArray(frame.tiles, "frame tiles")) {
        const tile = asObject(tileEntry, "tile");
        for (let y = 0; y < SPRITE_TILE_HEIGHT; y += 1) {
            for (let x = 0; x < SPRITE_TILE_WIDTH; x += 1) {
                const sourceX = asNumber(tile.sliceX) + (tile.flipX === true ? SPRITE_TILE_WIDTH - x - 1 : x);
                const sourceY = asNumber(tile.sliceY) + (tile.flipY === true ? SPRITE_TILE_HEIGHT - y - 1 : y);
                const destinationX = originX + asNumber(tile.x) + x;
                const destinationY = originY - asNumber(tile.y) + y;
                if (sourceX < 0 ||
                    sourceY < 0 ||
                    sourceX >= source.width ||
                    sourceY >= source.height ||
                    destinationX < 0 ||
                    destinationY < 0 ||
                    destinationX >= width ||
                    destinationY >= height) {
                    continue;
                }
                const readIndex = (source.width * sourceY + sourceX) * 4;
                const red = source.data[readIndex] ?? 0;
                const green = source.data[readIndex + 1] ?? 0;
                const blue = source.data[readIndex + 2] ?? 0;
                const alpha = source.data[readIndex + 3] ?? 0;
                if (alpha === 0 || (red === CHROMA_RED && green === CHROMA_GREEN && blue === CHROMA_BLUE))
                    continue;
                const writeIndex = (width * destinationY + destinationX) * 4;
                image.data[writeIndex] = red;
                image.data[writeIndex + 1] = green;
                image.data[writeIndex + 2] = blue;
                image.data[writeIndex + 3] = alpha;
            }
        }
    }
    return image;
}
function scaledImage(source, scale) {
    if (scale === 1)
        return source;
    const image = new PNG({ width: source.width * scale, height: source.height * scale, colorType: 6 });
    for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
            const from = (source.width * Math.floor(y / scale) + Math.floor(x / scale)) * 4;
            const to = (image.width * y + x) * 4;
            source.data.copy(image.data, to, from, from + 4);
        }
    }
    return image;
}
async function writePreview(root, relativeOutput, image) {
    if (!relativeOutput || path.extname(relativeOutput).toLowerCase() !== ".png") {
        spriteError("INVALID_INPUT", "Sprite previews require a project-local .png outputPath.");
    }
    const output = await resolveProjectPath(root, relativeOutput);
    await mkdir(path.dirname(output), { recursive: true });
    await resolveProjectPath(root, path.dirname(output), { mustExist: true });
    const bytes = PNG.sync.write(image);
    const handle = await open(output, "wx", 0o600).catch((error) => {
        if (error instanceof Error && "code" in error && error.code === "EEXIST") {
            spriteError("SPRITE_PREVIEW_OUTPUT_EXISTS", "The sprite preview output already exists and was preserved. Choose a new project-local .png outputPath.");
        }
        throw error;
    });
    try {
        await handle.writeFile(bytes);
        await handle.sync();
    }
    finally {
        await handle.close();
    }
    return {
        outputPath: projectRelativePath(root, output),
        width: image.width,
        height: image.height,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        provenance: "authored-source-composite",
        emulatorFrame: false,
        label: SOURCE_PREVIEW_LABEL,
    };
}
function selectedFrame(metadata, stateIndex, animationIndex, frameIndex) {
    const state = asObject(asArray(metadata.states, "states")[stateIndex], `state ${stateIndex}`);
    const animation = asObject(asArray(state.animations, `state ${stateIndex} animations`)[animationIndex], `animation ${animationIndex}`);
    return asObject(asArray(animation.frames, `animation ${animationIndex} frames`)[frameIndex], `frame ${frameIndex}`);
}
export async function previewSprite(projectRoot, input, access) {
    const loaded = await loadSprite(projectRoot, input, access);
    const stateIndex = integer(input.stateIndex ?? 0, "stateIndex", 0, 31);
    const animationIndex = integer(input.animationIndex ?? 0, "animationIndex", 0, 7);
    const frameIndex = integer(input.frameIndex ?? 0, "frameIndex", 0, 31);
    const scale = integer(input.scale ?? 1, "scale", 1, 8);
    const frame = selectedFrame(loaded.metadata, stateIndex, animationIndex, frameIndex);
    const source = PNG.sync.read(await readFile(await resolveProjectPath(loaded.projectRoot, loaded.assetPath, { mustExist: true })), {
        checkCRC: true,
    });
    const outputPath = input.outputPath ?? `artifacts/sprite-previews/${resourceSlug(String(loaded.metadata.name), "sprite")}-s${stateIndex}-a${animationIndex}-f${frameIndex}-x${scale}-${randomUUID()}.png`;
    return {
        id: String(loaded.metadata.id),
        ...(await writePreview(loaded.projectRoot, outputPath, scaledImage(compositeFrame(source, loaded.metadata, frame), scale))),
    };
}
const FONT = {
    A: ["010", "101", "111", "101", "101"],
    C: ["111", "100", "100", "100", "111"],
    E: ["111", "100", "110", "100", "111"],
    F: ["111", "100", "110", "100", "100"],
    I: ["111", "010", "010", "010", "111"],
    M: ["101", "111", "111", "101", "101"],
    N: ["101", "111", "111", "111", "101"],
    O: ["111", "101", "101", "101", "111"],
    P: ["110", "101", "110", "100", "100"],
    R: ["110", "101", "110", "101", "101"],
    S: ["111", "100", "111", "001", "111"],
    T: ["111", "010", "010", "010", "010"],
    U: ["101", "101", "101", "101", "111"],
    V: ["101", "101", "101", "101", "010"],
    W: ["101", "101", "111", "111", "101"],
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"],
    "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"],
    "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"],
    "7": ["111", "001", "001", "001", "001"],
    "8": ["111", "101", "111", "101", "111"],
    "9": ["111", "101", "111", "001", "111"],
};
function fill(image, red, green, blue) {
    for (let offset = 0; offset < image.data.length; offset += 4) {
        image.data[offset] = red;
        image.data[offset + 1] = green;
        image.data[offset + 2] = blue;
        image.data[offset + 3] = 255;
    }
}
function drawText(image, text, originX, originY) {
    let cursor = originX;
    for (const character of text.toUpperCase()) {
        const glyph = FONT[character];
        if (glyph) {
            for (let row = 0; row < glyph.length; row += 1) {
                for (let column = 0; column < 3; column += 1) {
                    if (glyph[row]?.[column] !== "1")
                        continue;
                    const x = cursor + column;
                    const y = originY + row;
                    if (x < 0 || y < 0 || x >= image.width || y >= image.height)
                        continue;
                    const offset = (image.width * y + x) * 4;
                    image.data[offset] = 0xe0;
                    image.data[offset + 1] = 0xf8;
                    image.data[offset + 2] = 0xcf;
                    image.data[offset + 3] = 255;
                }
            }
        }
        cursor += 4;
    }
}
function blit(source, target, originX, originY) {
    for (let y = 0; y < source.height; y += 1) {
        for (let x = 0; x < source.width; x += 1) {
            const from = (source.width * y + x) * 4;
            if ((source.data[from + 3] ?? 0) === 0)
                continue;
            const to = (target.width * (originY + y) + originX + x) * 4;
            source.data.copy(target.data, to, from, from + 4);
        }
    }
}
export async function spriteContactSheet(projectRoot, input, access) {
    const loaded = await loadSprite(projectRoot, input, access);
    const stateIndex = integer(input.stateIndex ?? 0, "stateIndex", 0, 31);
    const columns = integer(input.columns ?? 4, "columns", 1, 8);
    const scale = integer(input.scale ?? 2, "scale", 1, 8);
    const state = asObject(asArray(loaded.metadata.states, "states")[stateIndex], `state ${stateIndex}`);
    const frames = [];
    for (const [animationIndex, animationEntry] of asArray(state.animations, "animations").entries()) {
        const animation = asObject(animationEntry, `animation ${animationIndex}`);
        for (const [frameIndex, frameEntry] of asArray(animation.frames, `animation ${animationIndex} frames`).entries()) {
            const frame = asObject(frameEntry, `frame ${frameIndex}`);
            if (asArray(frame.tiles, `frame ${frameIndex} tiles`).length === 0)
                continue;
            if (frames.length >= MAX_PREVIEW_FRAMES) {
                spriteError("SPRITE_PREVIEW_LIMIT", `Sprite contact sheets are limited to ${MAX_PREVIEW_FRAMES} authored frames.`);
            }
            frames.push({ animationIndex, frameIndex, frame });
        }
    }
    if (frames.length === 0)
        spriteError("SPRITE_PREVIEW_EMPTY", "The selected sprite state contains no visible authored frames.");
    const source = PNG.sync.read(await readFile(await resolveProjectPath(loaded.projectRoot, loaded.assetPath, { mustExist: true })), {
        checkCRC: true,
    });
    const frameWidth = integer(asNumber(loaded.metadata.canvasWidth, 16), "sprite canvasWidth", 1, 256) * scale;
    const frameHeight = integer(asNumber(loaded.metadata.canvasHeight, 16), "sprite canvasHeight", 1, 256) * scale;
    const cellWidth = Math.max(frameWidth + 8, 52);
    const cellHeight = frameHeight + 15;
    const rows = Math.ceil(frames.length / columns);
    const image = new PNG({ width: Math.max(cellWidth * columns + 8, 92), height: rows * cellHeight + 20 });
    fill(image, 0x07, 0x18, 0x21);
    drawText(image, "SOURCE SPRITE PREVIEW", 4, 5);
    frames.forEach(({ animationIndex, frameIndex, frame }, index) => {
        const x = (index % columns) * cellWidth + 5;
        const y = Math.floor(index / columns) * cellHeight + 16;
        blit(scaledImage(compositeFrame(source, loaded.metadata, frame), scale), image, x, y);
        drawText(image, `A${animationIndex} F${frameIndex}`, x, y + frameHeight + 3);
    });
    return {
        id: String(loaded.metadata.id),
        ...(await writePreview(loaded.projectRoot, input.outputPath, image)),
        frameCount: frames.length,
        frames: frames.map(({ animationIndex, frameIndex }) => ({ animationIndex, frameIndex })),
    };
}
//# sourceMappingURL=sprites.js.map