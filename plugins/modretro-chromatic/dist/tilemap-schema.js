import { z } from "zod";
export const TILEMAP_TILE_SIZE = 8;
export const MAX_ROOM_CELLS = 16_380;
export const MAX_EDIT_CELLS = 4_096;
export const MAX_TILEMAP_JSON_BYTES = 4 * 1024 * 1024;
const name = z.string().min(1).max(200).refine((value) => value.trim().length > 0);
const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/u);
const resourceId = z.string().min(1).max(256);
const filePath = z.string().min(1).max(4_096).refine((value) => !value.includes("\0"));
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const coordinate = z.number().int().min(0).max(254);
const dimension = z.number().int().min(1).max(255);
const byte = z.number().int().min(0).max(255);
const slot = z.number().int().min(0).max(7);
const rectangle = z.object({ x: coordinate, y: coordinate, width: dimension, height: dimension }).strict();
const adoptionPreimages = z.object({
    recipeSha256: hash, atlasSha256: hash, sourceSha256: hash,
    pngSha256: hash, metadataSha256: hash, sceneSha256: hash,
}).strict();
// An explicit, validated registration lives in the recipe's existing revision
// domain. Origin evidence is not a permanent hash of later editable outputs.
const adoptedBinding = z.object({
    version: z.literal(1), recipePath: filePath, roomId: resourceId,
    sceneId: resourceId, backgroundId: resourceId, backgroundPath: filePath,
    atlas: z.object({ path: filePath, id: resourceId, sha256: hash, sourcePath: filePath, sourceSha256: hash }).strict(),
    preimages: adoptionPreimages,
}).strict();
export const atlasTileSchema = z.object({ id, x: coordinate, y: coordinate }).strict();
const collisionMask = z.object({ mask: byte.refine((value) => value !== 0), value: byte }).strict()
    .refine(({ mask, value }) => (value & mask) === value, "Collision value must contain only bits in its explicit mask.");
const primitiveCellSchema = z.object({
    tileId: id,
    paletteSlot: slot.optional(),
    collision: collisionMask.optional(),
}).strict();
export const tilePrimitiveSchema = z.object({
    id,
    name: name.optional(),
    role: z.enum(["decoration", "surface"]),
    width: z.number().int().min(1).max(32),
    height: z.number().int().min(1).max(32),
    anchor: z.object({ x: coordinate, y: coordinate }).strict(),
    cells: z.array(primitiveCellSchema.nullable()).min(1).max(1_024),
}).strict().superRefine((primitive, context) => {
    if (primitive.cells.length !== primitive.width * primitive.height) {
        context.addIssue({ code: "custom", message: "Primitive cells must be a row-major width × height grid." });
    }
    if (primitive.anchor.x >= primitive.width || primitive.anchor.y >= primitive.height) {
        context.addIssue({ code: "custom", message: "Primitive anchor must be inside its tile grid." });
    }
    if (primitive.cells.every((cell) => cell === null)) {
        context.addIssue({ code: "custom", message: "A primitive must contain at least one opaque tile." });
    }
    const hasCollision = primitive.cells.some((cell) => cell?.collision !== undefined);
    if ((primitive.role === "decoration" && hasCollision) || (primitive.role === "surface" && !hasCollision)) {
        context.addIssue({ code: "custom", message: "Decoration never edits collisions; a surface requires an explicit collision mask." });
    }
});
const atlasDefinition = {
    name,
    tiles: z.array(atlasTileSchema).min(1).max(4_096),
    primitives: z.array(tilePrimitiveSchema).min(1).max(256),
};
export const atlasSchema = z.object({
    format: z.literal("gb-studio-tile-atlas"),
    version: z.literal(1),
    id: resourceId,
    sourcePath: filePath,
    sourceSha256: hash,
    ...atlasDefinition,
}).strict();
export const roomCellSchema = z.object({
    tileId: id,
    primitiveId: id.optional(),
    paletteByte: byte,
    collisionByte: byte,
}).strict();
export const roomSchema = z.object({
    format: z.literal("gb-studio-tilemap-room"),
    version: z.literal(1),
    id: resourceId,
    name,
    units: z.literal("8px-tiles"),
    atlasPath: filePath,
    atlasSha256: hash,
    sceneId: resourceId,
    backgroundId: resourceId,
    backgroundPath: filePath,
    predecessorBackgroundId: resourceId,
    width: dimension,
    height: dimension,
    cells: z.array(roomCellSchema).min(1).max(MAX_ROOM_CELLS),
    protectedRegions: z.array(rectangle).max(256),
    reservedPaletteSlots: z.array(slot).max(8),
    maxUniqueTiles: z.number().int().min(1).max(384).optional(),
    native: z.object({ pngSha256: hash, metadataSha256: hash, collisions: z.string().max(200_000) }).strict(),
    adoptedBinding: adoptedBinding.optional(),
}).strict().superRefine((room, context) => {
    if (room.cells.length !== room.width * room.height) {
        context.addIssue({ code: "custom", message: "Room cells must be a complete row-major width × height grid." });
    }
});
export const tilemapOperationSchema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("adopt_binding"), before: adoptionPreimages,
        identity: z.object({ roomId: resourceId, backgroundId: resourceId, atlasId: resourceId, sceneId: resourceId }).strict(),
    }).strict(),
    z.object({ type: z.literal("place"), primitiveId: id, x: coordinate, y: coordinate }).strict(),
    z.object({ type: z.literal("stamp"), primitiveId: id, x: coordinate, y: coordinate }).strict(),
    z.object({ type: z.literal("fill"), primitiveId: id, ...rectangle.shape }).strict(),
    z.object({
        type: z.literal("replace_cells"),
        atlasPath: filePath,
        atlasSha256: hash,
        cells: z.array(z.object({
            x: coordinate,
            y: coordinate,
            before: z.object({ pixelsSha256: hash, paletteByte: byte, collisionByte: byte }).strict(),
            after: z.object({ tileId: id, pixelsSha256: hash, paletteByte: byte }).strict(),
        }).strict()).min(1).max(MAX_EDIT_CELLS),
    }).strict(),
    z.object({
        type: z.literal("set_collision_cells"),
        cells: z.array(z.object({
            x: coordinate,
            y: coordinate,
            before: z.object({ pixelsSha256: hash, paletteByte: byte, collisionByte: byte }).strict(),
            after: z.object({ collisionByte: byte }).strict(),
        }).strict()).min(1).max(MAX_EDIT_CELLS),
    }).strict(),
]);
const mutation = { expectedRevision: hash, dryRun: z.boolean().optional() };
export const tilemapSchemas = {
    atlasCreate: z.object({ atlasPath: filePath, sourcePath: filePath, ...atlasDefinition, ...mutation }).strict(),
    create: z.object({
        recipePath: filePath,
        atlasPath: filePath,
        sceneId: resourceId,
        backgroundPath: filePath,
        name,
        base: z.discriminatedUnion("type", [
            z.object({ type: z.literal("existing") }).strict(),
            z.object({ type: z.literal("fill"), tileId: id, paletteSlot: slot }).strict(),
        ]),
        protectedRegions: z.array(rectangle).max(256).optional(),
        reservedPaletteSlots: z.array(slot).max(8).optional(),
        maxUniqueTiles: z.number().int().min(1).max(384).optional(),
        ...mutation,
    }).strict(),
    edit: z.object({
        recipePath: filePath,
        operations: z.array(tilemapOperationSchema).min(1).max(100),
        ...mutation,
    }).strict(),
    compile: z.object({ recipePath: filePath, ...mutation }).strict(),
    inspect: z.object({
        recipePath: filePath.optional(),
        atlasPath: filePath.optional(),
        x: coordinate.optional(),
        y: coordinate.optional(),
        width: dimension.optional(),
        height: dimension.optional(),
        offset: z.number().int().min(0).max(4_096).optional(),
        limit: z.number().int().min(1).max(128).optional(),
    }).strict(),
};
//# sourceMappingURL=tilemap-schema.js.map