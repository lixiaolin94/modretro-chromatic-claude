import { createHash } from "node:crypto";
import { z } from "zod";
import { readNativeImportSnapshot } from "./native-import-files.js";
import { GameStudioProjectError } from "./project.js";
import { applyPreparedProjectTransaction } from "./scene-batch.js";
// This adapter has one fixed destination and fixed data arrays. It is not a C editor.
const TITLE_HEADER = "plugins/wrecklight-title/engine/include/wrecklight_title_data.h";
const PATTERN_COUNT = 196, STATIC_COUNT = 179, CELLS = 360, BYTES_PER_PATTERN = 16;
const MAX_HEADER_BYTES = 128 * 1024;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sha256 = z.string().regex(/^[a-f0-9]{64}$/u);
const protectedNames = ["wl_title_font", "wl_credit_palette_0", "wl_credit_palette_1", "wl_credit_palette_2", "wl_credit_palette_3",
    "wl_credit_0_patterns", "wl_credit_0_map", "wl_credit_1_patterns", "wl_credit_1_map"];
const protectedPins = z.object({
    wl_title_font: sha256, wl_credit_palette_0: sha256, wl_credit_palette_1: sha256,
    wl_credit_palette_2: sha256, wl_credit_palette_3: sha256, wl_credit_0_patterns: sha256,
    wl_credit_0_map: sha256, wl_credit_1_patterns: sha256, wl_credit_1_map: sha256,
}).strict();
const byte = z.number().int().min(0).max(255);
const pattern = z.object({
    index: z.number().int().min(0).max(PATTERN_COUNT - 1),
    rows: z.array(z.string().regex(/^[0-3]{8}$/u)).length(8),
    twoBitplaneHex: z.string().regex(/^[a-fA-F0-9]{32}$/u),
}).strict();
/** Complete inert atlas contract; currentHeader.path is descriptive, never a destination. */
export const nativeTitleAtlasSchema = z.object({
    profile: z.literal("wrecklight-title-v1"),
    expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u).describe("Whole-project revision. The plugin header is separately guarded by currentHeader.sha256."),
    dryRun: z.boolean().optional(),
    contract: z.object({
        status: z.string().max(256).optional(),
        currentHeader: z.object({ path: z.string().max(4096).optional(), sha256, bytes: z.number().int().min(1).max(MAX_HEADER_BYTES) }).strict(),
        patternCount: z.literal(PATTERN_COUNT), staticPatternRange: z.tuple([z.literal(0), z.literal(STATIC_COUNT - 1)]),
        animatedPatternRange: z.tuple([z.literal(STATIC_COUNT), z.literal(PATTERN_COUNT - 1)]),
        fontRangePreserved: z.tuple([z.literal(224), z.literal(255)]),
        map: z.array(z.number().int().min(0).max(PATTERN_COUNT - 1)).length(CELLS),
        attributes: z.array(byte).length(CELLS), patterns: z.array(pattern).length(PATTERN_COUNT),
        animatedBytesExact: z.boolean().optional(), reconstructsCandidateExactly: z.boolean().optional(),
        creditsAndFontArrayPins: protectedPins,
        integrationBlocker: z.string().max(4096).optional(),
    }).strict(),
}).strict();
function invalid(code, message) { throw new GameStudioProjectError(code, message); }
function readArray(source, name, type, length) {
    const expression = new RegExp(`^static const ${type} ${name}\\[${length}\\] = \\{([\\s\\S]*?)\\};`, "gmu");
    const matches = [...source.matchAll(expression)];
    const occurrences = [...source.matchAll(new RegExp(`\\b${name}\\b`, "gu"))];
    if (matches.length !== 1 || occurrences.length !== 1)
        invalid("NATIVE_GRAPHICS_LAYOUT_MISMATCH", `Expected one ${name} array with the declared layout.`);
    const match = matches[0], body = match[1];
    if (!/^\s*(?:\d+\s*,\s*)*\d+\s*,?\s*$/u.test(body))
        invalid("NATIVE_GRAPHICS_LAYOUT_MISMATCH", `The ${name} array is not a literal numeric array.`);
    const values = [...body.matchAll(/\d+/gu)].map(item => Number(item[0]));
    if (values.length !== length || values.some(value => !Number.isSafeInteger(value) || value < 0 || value > (type === "UBYTE" ? 255 : 65535))) {
        invalid("NATIVE_GRAPHICS_LAYOUT_MISMATCH", `The ${name} array has an invalid count or value.`);
    }
    return { values, body, bodyStart: match.index + match[0].indexOf("{") + 1 };
}
function replaceValues(source, array, values) {
    const tokens = [...array.body.matchAll(/\d+/gu)];
    let body = array.body;
    // Replace only changed number tokens; formatting and unchanged animation bytes stay exact.
    for (let index = tokens.length - 1; index >= 0; index--) {
        const token = tokens[index];
        if (array.values[index] !== values[index])
            body = body.slice(0, token.index) + String(values[index]) + body.slice(token.index + token[0].length);
    }
    return source.slice(0, array.bodyStart) + body + source.slice(array.bodyStart + array.body.length);
}
function encodeRows(rows) {
    const output = Buffer.alloc(BYTES_PER_PATTERN);
    for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
            const pixel = Number(rows[y][x]);
            output[y * 2] = output[y * 2] | ((pixel & 1) << (7 - x));
            output[y * 2 + 1] = output[y * 2 + 1] | (((pixel >> 1) & 1) << (7 - x));
        }
    return output;
}
/** Validate the whole contract, then construct only the two authorized numeric-array changes. */
export function prepareNativeTitleAtlas(header, raw) {
    const parsed = nativeTitleAtlasSchema.safeParse(raw);
    if (!parsed.success)
        invalid("INVALID_NATIVE_GRAPHICS_CONTRACT", "The title atlas contract is malformed or exceeds its fixed bounds.");
    const input = parsed.data, contract = input.contract;
    if (header.length !== contract.currentHeader.bytes || digest(header) !== contract.currentHeader.sha256) {
        invalid("STALE_NATIVE_GRAPHICS", "The current title header does not match the contract's byte count and SHA-256.");
    }
    if (header.length > MAX_HEADER_BYTES || header.some(value => value > 127 || value === 0)) {
        invalid("NATIVE_GRAPHICS_LAYOUT_MISMATCH", "The title header must be bounded ASCII text.");
    }
    const source = header.toString("ascii");
    if ([...source.matchAll(/^#define WL_TITLE_PATTERNS 196u$/gmu)].length !== 1)
        invalid("NATIVE_GRAPHICS_LAYOUT_MISMATCH", "The title pattern budget is not the expected 196 slots.");
    const patterns = readArray(source, "wl_title_patterns", "UBYTE", PATTERN_COUNT * BYTES_PER_PATTERN);
    const map = readArray(source, "wl_title_map", "UBYTE", CELLS);
    const attributes = readArray(source, "wl_title_attributes", "UBYTE", CELLS);
    if (map.values.some(value => value >= PATTERN_COUNT)) {
        invalid("NATIVE_GRAPHICS_LAYOUT_MISMATCH", "The existing title map refers outside the supported atlas.");
    }
    if (attributes.values.some((value, index) => value !== contract.attributes[index])) {
        invalid("NATIVE_GRAPHICS_PROTECTED_DATA", "Title attributes differ from the existing header; all 360 must remain unchanged.");
    }
    const shapes = [
        ["wl_title_font", "UBYTE", 512], ["wl_credit_palette_0", "UWORD", 4], ["wl_credit_palette_1", "UWORD", 4],
        ["wl_credit_palette_2", "UWORD", 4], ["wl_credit_palette_3", "UWORD", 4],
        ["wl_credit_0_patterns", "UBYTE", 624], ["wl_credit_0_map", "UBYTE", 360],
        ["wl_credit_1_patterns", "UBYTE", 592], ["wl_credit_1_map", "UBYTE", 360],
    ];
    for (const [name, type, length] of shapes) {
        const array = readArray(source, name, type, length);
        if (digest(JSON.stringify(array.values)) !== contract.creditsAndFontArrayPins[name]) {
            invalid("NATIVE_GRAPHICS_PROTECTED_DATA", `The protected ${name} data does not match the contract.`);
        }
    }
    const nextPatterns = [];
    for (let index = 0; index < PATTERN_COUNT; index++) {
        const item = contract.patterns[index];
        if (item.index !== index)
            invalid("INVALID_NATIVE_GRAPHICS_CONTRACT", "Pattern indices must be unique and in order.");
        const bytes = encodeRows(item.rows);
        if (bytes.toString("hex") !== item.twoBitplaneHex.toLowerCase())
            invalid("INVALID_NATIVE_GRAPHICS_CONTRACT", `Pattern ${index} rows and bitplanes disagree.`);
        nextPatterns.push(...bytes);
    }
    if (nextPatterns.slice(STATIC_COUNT * BYTES_PER_PATTERN).some((value, index) => value !== patterns.values[STATIC_COUNT * BYTES_PER_PATTERN + index])) {
        invalid("NATIVE_GRAPHICS_PROTECTED_DATA", "The 17 animated patterns must remain unchanged.");
    }
    const uiPatterns = new Set();
    for (let index = 0; index < CELLS; index++) {
        const old = map.values[index], next = contract.map[index];
        if ((attributes.values[index] & 7) === 7) {
            uiPatterns.add(old);
            if (next !== old)
                invalid("NATIVE_GRAPHICS_PROTECTED_DATA", "Palette-7 UI cells must keep their existing tile references.");
        }
        if (next !== old && (old >= STATIC_COUNT || next >= STATIC_COUNT)) {
            invalid("NATIVE_GRAPHICS_PROTECTED_DATA", "Animated tile references must remain in their existing cells.");
        }
    }
    for (const index of uiPatterns) {
        if (nextPatterns.slice(index * BYTES_PER_PATTERN, (index + 1) * BYTES_PER_PATTERN)
            .some((value, offset) => value !== patterns.values[index * BYTES_PER_PATTERN + offset])) {
            invalid("NATIVE_GRAPHICS_PROTECTED_DATA", "Patterns used by palette-7 UI cells must remain unchanged.");
        }
    }
    // The map follows patterns in the header; apply from the last span so offsets stay valid.
    if (patterns.bodyStart >= map.bodyStart)
        invalid("NATIVE_GRAPHICS_LAYOUT_MISMATCH", "The title arrays are not in the supported order.");
    let updated = replaceValues(source, map, contract.map);
    updated = replaceValues(updated, patterns, nextPatterns);
    const output = Buffer.from(updated, "ascii");
    const changedPatterns = Array.from({ length: STATIC_COUNT }, (_, index) => index).filter(index => nextPatterns.slice(index * BYTES_PER_PATTERN, (index + 1) * BYTES_PER_PATTERN).some((value, offset) => value !== patterns.values[index * BYTES_PER_PATTERN + offset])).length;
    return { output, previousHeaderSha256: digest(header), previousHeaderBytes: header.length,
        headerSha256: digest(output), headerBytes: output.length, changedPatterns,
        changedMapCells: contract.map.filter((value, index) => value !== map.values[index]).length,
        preservedAnimationPatterns: PATTERN_COUNT - STATIC_COUNT, preservedAttributeCells: CELLS,
        preservedUiPalette7Cells: attributes.values.filter(value => (value & 7) === 7).length,
        protectedArraysVerified: protectedNames.length };
}
export async function updateNativeTitleAtlas(projectPath, input, access) {
    const parsed = nativeTitleAtlasSchema.safeParse(input);
    if (!parsed.success)
        invalid("INVALID_NATIVE_GRAPHICS_CONTRACT", "The title atlas contract is malformed or exceeds its fixed bounds.");
    const { value, ...transaction } = await applyPreparedProjectTransaction(projectPath, parsed.data, async (snapshot) => {
        const current = await readNativeImportSnapshot(snapshot.projectRoot, TITLE_HEADER, MAX_HEADER_BYTES);
        const prepared = prepareNativeTitleAtlas(current.bytes, parsed.data);
        return { files: [{ relativePath: TITLE_HEADER, before: current.bytes, after: prepared.output,
                    beforeIdentity: current.identity, preserveMode: true }], value: {
                previousHeaderSha256: prepared.previousHeaderSha256, previousHeaderBytes: prepared.previousHeaderBytes,
                headerSha256: prepared.headerSha256, headerBytes: prepared.headerBytes,
                changedPatterns: prepared.changedPatterns, changedMapCells: prepared.changedMapCells,
                preservedAnimationPatterns: prepared.preservedAnimationPatterns, preservedAttributeCells: prepared.preservedAttributeCells,
                preservedUiPalette7Cells: prepared.preservedUiPalette7Cells, protectedArraysVerified: prepared.protectedArraysVerified,
            } };
    }, access);
    return { ...value, ...transaction, note: "The public project revision excludes plugin files; use headerSha256 as the next header preimage. Dependency-profile recognition and rendered output require separate validation." };
}
//# sourceMappingURL=native-title-atlas.js.map