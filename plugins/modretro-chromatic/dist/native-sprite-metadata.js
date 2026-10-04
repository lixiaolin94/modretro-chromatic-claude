import { createHash } from "node:crypto";
import { z } from "zod";
import { GameStudioProjectError } from "./project.js";
import { resourceSlug, stableResourceId } from "./project-files.js";
export const MAX_NATIVE_METADATA_BYTES = 2 * 1024 * 1024;
export const NATIVE_SPRITE_LIMITS = { states: 32, animationsPerState: 8, framesPerAnimation: 32, frames: 1024, objectsPerFrame: 40, objects: 8192, depth: 12 };
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
const signed = z.number().int().min(-128).max(127);
const name = z.string().max(200).refine(value => !/[\x00-\x1f]/.test(value), "Names cannot contain control characters");
const tile = z.object({ id: uuid, x: signed, y: signed, sliceX: z.number().int().min(0).max(2040), sliceY: z.number().int().min(0).max(2040),
    flipX: z.boolean(), flipY: z.boolean(), palette: z.number().int().min(0).max(7), paletteIndex: z.number().int().min(0).max(7),
    objPalette: z.enum(["OBP0", "OBP1"]), priority: z.boolean() }).strict();
const frame = z.object({ id: uuid, tiles: z.array(tile).max(NATIVE_SPRITE_LIMITS.objectsPerFrame) }).strict();
const animation = z.object({ id: uuid, frames: z.array(frame).min(1).max(NATIVE_SPRITE_LIMITS.framesPerAnimation) }).strict();
const state = z.object({ id: uuid, name, animationType: z.enum(["fixed", "fixed_movement", "multi", "multi_movement", "horizontal", "horizontal_movement", "platform_player", "cursor"]), flipLeft: z.boolean(), animations: z.array(animation).length(8) }).strict();
const schema = z.object({ _resourceType: z.literal("sprite"), id: uuid, name, symbol: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,199}$/),
    filename: z.string().min(1).max(255).refine(value => !/[\\/\x00-\x1f]/.test(value) && value !== "." && value !== "..", "filename must be a basename"),
    width: z.number().int().min(1).max(2040), height: z.number().int().min(1).max(2040), checksum: z.string().regex(/^[0-9a-f]{40}$/i),
    // This declaration does not drive allocation and is not the measured pattern count.
    numTiles: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), canvasOriginX: signed, canvasOriginY: signed,
    canvasWidth: z.number().int().min(1).max(256), canvasHeight: z.number().int().min(1).max(256),
    boundsX: signed, boundsY: signed, boundsWidth: z.number().int().min(1).max(255), boundsHeight: z.number().int().min(1).max(255),
    animSpeed: z.number().int().min(0).max(255), states: z.array(state).min(1).max(NATIVE_SPRITE_LIMITS.states) }).strict();
function fail(message) { throw new GameStudioProjectError("INVALID_NATIVE_SPRITE_METADATA", message); }
/** Bound nesting before JSON.parse or schema recursion; input bytes have already been snapshotted. */
function parse(bytes) {
    if (!bytes.length || bytes.length > MAX_NATIVE_METADATA_BYTES)
        fail("Native sprite metadata must contain 1–2097152 bytes.");
    let text;
    try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    }
    catch {
        fail("Native sprite metadata must be valid UTF-8.");
    }
    let at = 0;
    const space = () => { while (/\s/.test(text[at] ?? "") && at < text.length)
        at++; };
    const string = () => {
        const begin = at++;
        let escaped = false;
        while (at < text.length) {
            const char = text[at++];
            if (escaped)
                escaped = false;
            else if (char === "\\")
                escaped = true;
            else if (char === '"') {
                try {
                    return JSON.parse(text.slice(begin, at));
                }
                catch {
                    fail("Invalid JSON string.");
                }
            }
        }
        return fail("Unterminated JSON string.");
    };
    const visit = (depth) => {
        if (depth > NATIVE_SPRITE_LIMITS.depth)
            fail("Native sprite metadata exceeds the nesting limit.");
        space();
        const char = text[at];
        if (char === '"') {
            string();
            return;
        }
        if (char === "{" || char === "[") {
            const object = char === "{", close = object ? "}" : "]", keys = new Set();
            at++;
            space();
            if (text[at] === close) {
                at++;
                return;
            }
            while (at < text.length) {
                if (object) {
                    space();
                    if (text[at] !== '"')
                        fail("Expected a JSON object key.");
                    const key = string();
                    if (keys.has(key) || ["__proto__", "prototype", "constructor"].includes(key))
                        fail(`Duplicate or forbidden JSON key: ${key}.`);
                    keys.add(key);
                    space();
                    if (text[at++] !== ":")
                        fail("Expected a JSON colon.");
                }
                visit(depth + 1);
                space();
                if (text[at] === close) {
                    at++;
                    return;
                }
                if (text[at++] !== ",")
                    fail("Expected a JSON comma.");
            }
            fail("Unterminated JSON container.");
        }
        const begin = at;
        while (at < text.length && !/[\s,}\]]/.test(text[at]))
            at++;
        if (at === begin)
            fail("Invalid JSON value.");
    };
    visit(0);
    space();
    if (at !== text.length)
        fail("Unexpected trailing JSON data.");
    try {
        return JSON.parse(text);
    }
    catch {
        fail("Native sprite metadata must be valid JSON.");
    }
}
/** Exact normalized 8×16 source patterns, independent of placement, palette and flip flags. Not compiled allocation. */
function pattern(image, x, y) {
    let result = "";
    for (let py = y; py < y + 16; py++)
        for (let px = x; px < x + 8; px++) {
            const at = (py * image.width + px) * 4;
            const [r, g, b, a] = image.data.subarray(at, at + 4);
            result += a === 0 || (r === 0x65 && g === 0xff && b === 0) ? "0" : r === 7 && g === 24 && b === 33 ? "3" : r === 0x86 && g === 0xc0 && b === 0x6c ? "2" : "1";
        }
    return result;
}
export function createNativeSpriteMetadata(bytes, pngBytes, image, output, existingIds) {
    const parsed = parse(bytes);
    // Reject oversized nested arrays before the schema allocates validated copies.
    let totalFrames = 0, totalObjects = 0;
    if (parsed && Array.isArray(parsed.states)) {
        if (parsed.states.length > NATIVE_SPRITE_LIMITS.states)
            fail("Too many native sprite states.");
        for (const state of parsed.states)
            if (state && Array.isArray(state.animations)) {
                if (state.animations.length > 8)
                    fail("Too many native sprite animation slots.");
                for (const animation of state.animations)
                    if (animation && Array.isArray(animation.frames)) {
                        totalFrames += animation.frames.length;
                        if (animation.frames.length > 32 || totalFrames > NATIVE_SPRITE_LIMITS.frames)
                            fail("Too many native sprite frames.");
                        for (const frame of animation.frames)
                            if (frame && Array.isArray(frame.tiles)) {
                                totalObjects += frame.tiles.length;
                                if (frame.tiles.length > 40 || totalObjects > NATIVE_SPRITE_LIMITS.objects)
                                    fail("Too many native sprite objects.");
                            }
                    }
            }
    }
    const checked = schema.safeParse(parsed);
    if (!checked.success)
        fail(`Unsupported native sprite metadata: ${checked.error.issues.slice(0, 8).map(issue => `${issue.path.join("/") || "/"}: ${issue.message}`).join("; ")}`);
    const source = checked.data;
    if (source.width !== image.width || source.height !== image.height)
        fail("Native sprite metadata dimensions do not match the paired PNG.");
    if (source.checksum.toLowerCase() !== createHash("sha1").update(pngBytes).digest("hex"))
        fail("Native sprite metadata checksum does not match the paired PNG bytes.");
    const sourceIds = new Set(), outputIds = new Set(), idMap = [];
    const add = (kind, value, pointer) => {
        const sourceId = value.id;
        if (sourceIds.has(sourceId.toLowerCase()))
            fail(`Duplicate source UUID at ${pointer}/id.`);
        sourceIds.add(sourceId.toLowerCase());
        const destinationId = kind === "root" ? output.id : stableResourceId("native-sprite-metadata-v1", output.id, kind, pointer);
        if (outputIds.has(destinationId.toLowerCase()) || existingIds.has(destinationId.toLowerCase()))
            fail(`Destination UUID collision at ${pointer || "/"}.`);
        outputIds.add(destinationId.toLowerCase());
        idMap.push({ kind, sourceId, destinationId, sourcePointer: `${pointer}/id` });
        value.id = destinationId;
    };
    add("root", source, "");
    let animations = 0, frames = 0, objects = 0;
    const patterns = new Set(), flipPatterns = new Set();
    source.states.forEach((state, si) => {
        const sp = `/states/${si}`;
        add("state", state, sp);
        state.animations.forEach((animation, ai) => {
            const ap = `${sp}/animations/${ai}`;
            animations++;
            add("animation", animation, ap);
            animation.frames.forEach((frame, fi) => {
                const fp = `${ap}/frames/${fi}`;
                if (++frames > NATIVE_SPRITE_LIMITS.frames)
                    fail("Native sprite metadata exceeds the total frame limit.");
                add("frame", frame, fp);
                frame.tiles.forEach((tile, ti) => {
                    const tp = `${fp}/tiles/${ti}`;
                    if (++objects > NATIVE_SPRITE_LIMITS.objects)
                        fail("Native sprite metadata exceeds the total object limit.");
                    add("tile", tile, tp);
                    if (tile.sliceX + 8 > image.width || tile.sliceY + 16 > image.height)
                        fail(`Full 8×16 source rectangle is outside the PNG at ${tp}.`);
                    const pixels = pattern(image, tile.sliceX, tile.sliceY);
                    patterns.add(pixels);
                    const rows = Array.from({ length: 16 }, (_, y) => pixels.slice(y * 8, y * 8 + 8));
                    const flipped = rows.map(row => [...row].reverse().join(""));
                    flipPatterns.add([pixels, flipped.join(""), [...rows].reverse().join(""), [...flipped].reverse().join("")].sort()[0]);
                });
            });
        });
    });
    for (const id of outputIds)
        if (sourceIds.has(id))
            fail("Destination identities must be distinct from every source identity.");
    source.name = output.name;
    source.symbol = `sprite_${resourceSlug(output.name, "sprite")}`.slice(0, 200);
    source.filename = output.filename;
    source.checksum = createHash("sha1").update(pngBytes).digest("hex");
    const validOutput = schema.safeParse(source);
    if (!validOutput.success)
        fail("Output name, filename or identity is invalid for native sprite metadata.");
    return { metadata: source, idMap,
        diagnostics: source.numTiles === patterns.size ? [] : [{ code: "NATIVE_TILE_DECLARATION_DIFFERS", severity: "warning",
                message: `Preserved native numTiles=${source.numTiles}; measured ${patterns.size} exact and ${flipPatterns.size} flip-canonical referenced 8x16 patterns. These measurements do not establish compiled allocation.` }],
        counts: { states: source.states.length, animations, frames, objects, ids: idMap.length, sourcePatterns8x16: patterns.size, flipCanonicalPatterns8x16: flipPatterns.size, declaredNumTiles: source.numTiles },
        patternAccounting: "Unique referenced 8x16 source pixel patterns, normalized transparency; no flip deduplication. Not compiled tile allocation or runtime scanline proof." };
}
//# sourceMappingURL=native-sprite-metadata.js.map