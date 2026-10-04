import { createHash } from "node:crypto";
import { PNG } from "pngjs";
import { GameStudioProjectError } from "./project.js";
import { MAX_EDIT_CELLS, MAX_ROOM_CELLS, TILEMAP_TILE_SIZE, } from "./tilemap-schema.js";
const SOURCE_COLORS = new Set(["071821", "306850", "86c06c", "e0f8cf"]);
export function tilemapError(code, message) {
    throw new GameStudioProjectError(code, message);
}
export function sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
}
export function tilePixels(image, tileX, tileY) {
    const tile = Buffer.alloc(8 * 8 * 4);
    for (let row = 0; row < 8; row++) {
        const offset = ((tileY * 8 + row) * image.width + tileX * 8) * 4;
        image.data.copy(tile, row * 8 * 4, offset, offset + 8 * 4);
    }
    return tile;
}
/** Opaque fixed-shade pixels are data; sparse motif holes are represented only by null cells. */
export function prepareAtlasPixels(atlas, image) {
    if (image.width % 8 !== 0 || image.height % 8 !== 0) {
        tilemapError("INVALID_TILEMAP_ATLAS", "An atlas must be aligned to whole 8 × 8 source tiles.");
    }
    for (let index = 0; index < image.data.length; index += 4) {
        if (image.data[index + 3] !== 255 || !SOURCE_COLORS.has(image.data.subarray(index, index + 3).toString("hex"))) {
            tilemapError("INVALID_TILEMAP_ATLAS", "Atlas PNGs must use only the four exact opaque native game background source shades.");
        }
    }
    const tiles = new Map();
    const patterns = new Map();
    for (const tile of atlas.tiles) {
        if (tiles.has(tile.id))
            tilemapError("DUPLICATE_TILE_ID", `Duplicate source tile ID ${tile.id}.`);
        if (tile.x >= image.width / 8 || tile.y >= image.height / 8) {
            tilemapError("TILE_OUT_OF_BOUNDS", `Source tile ${tile.id} lies outside the atlas.`);
        }
        const pixels = tilePixels(image, tile.x, tile.y);
        tiles.set(tile.id, pixels);
        patterns.set(tile.id, sha256(pixels));
    }
    const primitiveIds = new Set();
    let primitiveCells = 0;
    for (const primitive of atlas.primitives) {
        if (primitiveIds.has(primitive.id))
            tilemapError("DUPLICATE_PRIMITIVE_ID", `Duplicate primitive ID ${primitive.id}.`);
        primitiveIds.add(primitive.id);
        primitiveCells += primitive.cells.length;
        for (const cell of primitive.cells) {
            if (cell !== null && !tiles.has(cell.tileId))
                tilemapError("TILE_NOT_FOUND", `Primitive ${primitive.id} references missing tile ${cell.tileId}.`);
        }
    }
    if (primitiveCells > 32_768)
        tilemapError("TILEMAP_LIMIT", "Atlas motifs exceed 32,768 explicitly described cells.");
    return { tiles, patterns };
}
export function validateRoomDimensions(width, height) {
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 20 || height < 18 ||
        width > 255 || height > 255 || width * height > MAX_ROOM_CELLS) {
        tilemapError("INVALID_BACKGROUND_DIMENSIONS", "Room dimensions must satisfy native 160 × 144 minimum, 2040 per-axis maximum and 1,048,320 pixel area limits; dimensions are never resized.");
    }
}
export function validateRoomCells(room, atlas) {
    validateRoomDimensions(room.width, room.height);
    if (room.cells.length !== room.width * room.height)
        tilemapError("INVALID_TILEMAP_RECIPE", "Room cell count differs from its dimensions.");
    for (const cell of room.cells) {
        if (!atlas.tiles.has(cell.tileId))
            tilemapError("TILE_NOT_FOUND", `Room references missing source tile ${cell.tileId}.`);
    }
    for (const region of room.protectedRegions) {
        if (region.x + region.width > room.width || region.y + region.height > room.height) {
            tilemapError("TILEMAP_OUT_OF_BOUNDS", "A protected tile region extends outside this room.");
        }
    }
}
export function renderTilemap(room, atlas) {
    validateRoomCells(room, atlas);
    const image = new PNG({ width: room.width * TILEMAP_TILE_SIZE, height: room.height * TILEMAP_TILE_SIZE });
    for (let index = 0; index < room.cells.length; index++) {
        const tile = atlas.tiles.get(room.cells[index].tileId);
        const x = index % room.width;
        const y = Math.floor(index / room.width);
        for (let row = 0; row < 8; row++) {
            tile.copy(image.data, ((y * 8 + row) * image.width + x * 8) * 4, row * 8 * 4, (row + 1) * 8 * 4);
        }
    }
    return image;
}
export function applyTilemapOperations(room, atlas, operations) {
    const cells = room.cells.map((cell) => ({ ...cell }));
    const primitives = new Map(atlas.primitives.map((primitive) => [primitive.id, primitive]));
    let visited = 0;
    for (const operation of operations) {
        if (operation.type === "replace_cells" || operation.type === "set_collision_cells" || operation.type === "adopt_binding")
            tilemapError("INVALID_TILEMAP_OPERATION", "Replacement, collision assignment or adoption must be the sole operation and use its complete preimages.");
        const primitive = primitives.get(operation.primitiveId);
        if (!primitive)
            tilemapError("PRIMITIVE_NOT_FOUND", `No primitive ${operation.primitiveId} exists in this atlas.`);
        if (operation.type !== "stamp" && (primitive.width !== 1 || primitive.height !== 1)) {
            tilemapError("INVALID_TILEMAP_OPERATION", "Place and fill require a 1 × 1 primitive; use stamp for larger motifs.");
        }
        const x = operation.x - primitive.anchor.x;
        const y = operation.y - primitive.anchor.y;
        const width = operation.type === "fill" ? operation.width : primitive.width;
        const height = operation.type === "fill" ? operation.height : primitive.height;
        if (x < 0 || y < 0 || x + width > room.width || y + height > room.height) {
            tilemapError("TILEMAP_OUT_OF_BOUNDS", "The complete anchored placement must fit the room; no clipping is performed.");
        }
        for (let row = 0; row < height; row++) {
            for (let column = 0; column < width; column++) {
                const cell = primitive.cells[operation.type === "fill" ? 0 : row * primitive.width + column];
                if (cell === null)
                    continue;
                if (++visited > MAX_EDIT_CELLS)
                    tilemapError("TILEMAP_LIMIT", `One edit may visit at most ${MAX_EDIT_CELLS} nonempty cells, including repeated visits.`);
                const targetX = x + column;
                const targetY = y + row;
                if (room.protectedRegions.some((region) => targetX >= region.x && targetX < region.x + region.width && targetY >= region.y && targetY < region.y + region.height)) {
                    tilemapError("TILEMAP_PROTECTED_REGION", `Placement touches protected tile (${targetX}, ${targetY}).`);
                }
                const index = targetY * room.width + targetX;
                const previous = cells[index];
                if (cell.paletteSlot !== undefined && room.reservedPaletteSlots.includes(cell.paletteSlot)) {
                    tilemapError("TILEMAP_RESERVED_PALETTE", `Background palette slot ${cell.paletteSlot} is reserved by this recipe.`);
                }
                if (cell.paletteSlot !== undefined && previous.paletteByte >= 8) {
                    tilemapError("UNSUPPORTED_TILE_COLOR_ATTRIBUTES", `Tile (${targetX}, ${targetY}) has opaque palette attributes; omit palette editing to preserve them.`);
                }
                cells[index] = {
                    tileId: cell.tileId,
                    primitiveId: primitive.id,
                    paletteByte: cell.paletteSlot ?? previous.paletteByte,
                    collisionByte: cell.collision === undefined
                        ? previous.collisionByte
                        : (previous.collisionByte & (255 ^ cell.collision.mask)) | cell.collision.value,
                };
            }
        }
    }
    return { ...room, cells };
}
/** Validate the whole selection first; neither protection nor collision data is editable here. */
export function replaceTilemapCells(room, atlas, operation) {
    const selected = new Set();
    for (const cell of operation.cells) {
        if (cell.x >= room.width || cell.y >= room.height)
            tilemapError("TILEMAP_OUT_OF_BOUNDS", "Every selected replacement must fit the room; no clipping is performed.");
        const index = cell.y * room.width + cell.x;
        if (selected.has(index))
            tilemapError("INVALID_TILEMAP_OPERATION", `Repeated replacement for tile (${cell.x}, ${cell.y}).`);
        selected.add(index);
        const previous = room.cells[index];
        if (atlas.patterns.get(previous.tileId) !== cell.before.pixelsSha256 || previous.paletteByte !== cell.before.paletteByte || previous.collisionByte !== cell.before.collisionByte) {
            tilemapError("TILEMAP_PREIMAGE_MISMATCH", `Selected tile (${cell.x}, ${cell.y}) does not match its complete pixel/palette/collision preimage.`);
        }
        if (!atlas.tiles.has(cell.after.tileId))
            tilemapError("TILE_NOT_FOUND", `No source tile ${cell.after.tileId} exists in the selected atlas.`);
        if (atlas.patterns.get(cell.after.tileId) !== cell.after.pixelsSha256)
            tilemapError("TILEMAP_PREIMAGE_MISMATCH", `Replacement tile ${cell.after.tileId} does not match its selected pixel hash.`);
        if (previous.paletteByte !== cell.after.paletteByte && (previous.paletteByte >= 8 || cell.after.paletteByte >= 8)) {
            tilemapError("UNSUPPORTED_TILE_COLOR_ATTRIBUTES", `Tile (${cell.x}, ${cell.y}) has opaque palette attributes; preserve its entire palette byte for pixel-only replacement.`);
        }
    }
    // Keep all unselected records, including primitive identity; do not recapture the room.
    const cells = [...room.cells];
    for (const cell of operation.cells) {
        const index = cell.y * room.width + cell.x;
        const previous = room.cells[index];
        if (previous.tileId === cell.after.tileId && previous.paletteByte === cell.after.paletteByte)
            continue;
        cells[index] = { tileId: cell.after.tileId, paletteByte: cell.after.paletteByte, collisionByte: previous.collisionByte };
    }
    return { ...room, cells };
}
/** Assign only explicitly selected collision bytes; protected regions and visual data stay intact. */
export function setTilemapCollisionCells(room, atlas, operation) {
    const selected = new Set();
    for (const cell of operation.cells) {
        if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y) || cell.x < 0 || cell.y < 0 || cell.x >= room.width || cell.y >= room.height) {
            tilemapError("TILEMAP_OUT_OF_BOUNDS", "Every selected collision assignment must fit the room; no clipping is performed.");
        }
        const index = cell.y * room.width + cell.x;
        if (selected.has(index))
            tilemapError("INVALID_TILEMAP_OPERATION", `Repeated collision assignment for tile (${cell.x}, ${cell.y}).`);
        selected.add(index);
        const previous = room.cells[index];
        if (atlas.patterns.get(previous.tileId) !== cell.before.pixelsSha256 || previous.paletteByte !== cell.before.paletteByte || previous.collisionByte !== cell.before.collisionByte) {
            tilemapError("TILEMAP_PREIMAGE_MISMATCH", `Selected tile (${cell.x}, ${cell.y}) does not match its complete pixel/palette/collision preimage.`);
        }
        if (!Number.isInteger(cell.after.collisionByte) || cell.after.collisionByte < 0 || cell.after.collisionByte > 255) {
            tilemapError("INVALID_TILEMAP_INPUT", "An assigned collision byte must be an integer between 0 and 255.");
        }
    }
    // Validate the complete selection before changing any record. Unlike visual
    // replacement, collision assignment retains the selected primitive identity.
    const cells = [...room.cells];
    for (const cell of operation.cells) {
        const index = cell.y * room.width + cell.x;
        const previous = room.cells[index];
        if (previous.collisionByte !== cell.after.collisionByte)
            cells[index] = { ...previous, collisionByte: cell.after.collisionByte };
    }
    return { ...room, cells };
}
export function tilemapDiff(before, after, width, atlas) {
    const beforePatterns = new Set(before.map((cell) => atlas.patterns.get(cell.tileId)));
    const afterPatterns = new Set(after.map((cell) => atlas.patterns.get(cell.tileId)));
    const samples = [];
    let tileIds = 0;
    let primitiveIds = 0;
    let pixelTiles = 0;
    let paletteCells = 0;
    let collisionCells = 0;
    let changedCells = 0;
    for (let index = 0; index < after.length; index++) {
        const left = before[index];
        const right = after[index];
        const changed = left.tileId !== right.tileId || left.primitiveId !== right.primitiveId || left.paletteByte !== right.paletteByte || left.collisionByte !== right.collisionByte;
        tileIds += Number(left.tileId !== right.tileId);
        primitiveIds += Number(left.primitiveId !== right.primitiveId);
        pixelTiles += Number(atlas.patterns.get(left.tileId) !== atlas.patterns.get(right.tileId));
        paletteCells += Number(left.paletteByte !== right.paletteByte);
        collisionCells += Number(left.collisionByte !== right.collisionByte);
        if (changed) {
            changedCells++;
            if (samples.length < 32)
                samples.push({ x: index % width, y: Math.floor(index / width), before: left, after: right });
        }
    }
    return {
        changedCells, tileIds, primitiveIds, pixelTiles, paletteCells, collisionCells,
        uniquePatterns: {
            before: beforePatterns.size, after: afterPatterns.size,
            added: [...afterPatterns].filter((pattern) => !beforePatterns.has(pattern)).length,
            retired: [...beforePatterns].filter((pattern) => !afterPatterns.has(pattern)).length,
            net: afterPatterns.size - beforePatterns.size,
            flipDeduplication: false,
        },
        samples,
        truncated: changedCells > samples.length,
    };
}
//# sourceMappingURL=tilemap-compose.js.map