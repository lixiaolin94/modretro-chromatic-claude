import { open, realpath } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { includesPalette, MAX_PALETTES, packTilePalettes } from "./graphics-palette-packing.js";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_IMAGE_BYTES = 24 * 1024 * 1024;
const MAX_IMAGE_DIMENSION = 4096;
const MAX_IMAGE_PIXELS = 4096 * 1024;
const MAX_COLOR_SAMPLES = 32;
const MAX_QUANTIZATION_SAMPLES = 24;
const MAX_DIAGNOSTICS = 24;
const TILE_SIZE = 8;
function isWithinRoot(root, candidate) {
    const relativePath = path.relative(root, candidate);
    return relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath);
}
function asHex(red, green, blue) {
    return `#${red.toString(16).padStart(2, "0")}${green.toString(16).padStart(2, "0")}${blue.toString(16).padStart(2, "0")}`;
}
function quantizeChannel(channel) {
    return Math.round((Math.round((channel * 31) / 255) * 255) / 31);
}
const FIXED_SOURCE_SHADES = ["#071821", "#306850", "#86c06c", "#e0f8cf"];
const FIXED_SHADE_INDICES = new Map(FIXED_SOURCE_SHADES.map((color, index) => {
    const red = Number.parseInt(color.slice(1, 3), 16);
    const green = Number.parseInt(color.slice(3, 5), 16);
    const blue = Number.parseInt(color.slice(5, 7), 16);
    return [asHex(quantizeChannel(red), quantizeChannel(green), quantizeChannel(blue)), 3 - index];
}));
function checkedDimension(value, name) {
    if (!Number.isSafeInteger(value) || value < 1 || value > MAX_IMAGE_DIMENSION) {
        throw new RangeError(`${name} must be an integer between 1 and ${MAX_IMAGE_DIMENSION}.`);
    }
    return value;
}
function readPixel(image, x, y, spriteChromaKey = false) {
    if (x >= image.width || y >= image.height) {
        return {
            original: "#000000",
            quantized: "#000000",
            transparent: true,
            partiallyTransparent: false,
        };
    }
    const offset = (image.width * y + x) * 4;
    const red = image.data[offset] ?? 0;
    const green = image.data[offset + 1] ?? 0;
    const blue = image.data[offset + 2] ?? 0;
    const alpha = image.data[offset + 3] ?? 0;
    const chromaTransparent = spriteChromaKey && red === 0x65 && green === 0xff && blue === 0x00;
    return {
        original: asHex(red, green, blue),
        quantized: asHex(quantizeChannel(red), quantizeChannel(green), quantizeChannel(blue)),
        transparent: alpha === 0 || chromaTransparent,
        partiallyTransparent: alpha > 0 && alpha < 255,
    };
}
function normalizedPattern(pixels) {
    const indices = new Map();
    let nextIndex = 1;
    return pixels
        .map((pixel) => {
        if (pixel === null) {
            return "0";
        }
        let index = indices.get(pixel);
        if (index === undefined) {
            index = nextIndex;
            nextIndex += 1;
            indices.set(pixel, index);
        }
        return index.toString(36);
    })
        .join("");
}
function orientPixels(pixels, flipX, flipY) {
    const oriented = [];
    for (let y = 0; y < TILE_SIZE; y += 1) {
        for (let x = 0; x < TILE_SIZE; x += 1) {
            const sourceX = flipX ? TILE_SIZE - 1 - x : x;
            const sourceY = flipY ? TILE_SIZE - 1 - y : y;
            oriented.push(pixels[sourceY * TILE_SIZE + sourceX] ?? null);
        }
    }
    return oriented;
}
function inspectTile(image, tileX, tileY, spriteChromaKey) {
    const colors = new Set();
    const pixels = [];
    let partialAlpha = false;
    let transparentPixel = false;
    for (let y = 0; y < TILE_SIZE; y += 1) {
        for (let x = 0; x < TILE_SIZE; x += 1) {
            const pixel = readPixel(image, tileX * TILE_SIZE + x, tileY * TILE_SIZE + y, spriteChromaKey);
            partialAlpha ||= pixel.partiallyTransparent;
            transparentPixel ||= pixel.transparent;
            if (pixel.transparent) {
                pixels.push(null);
            }
            else {
                colors.add(pixel.quantized);
                pixels.push(pixel.quantized);
            }
        }
    }
    return {
        colors,
        pixels,
        invariantPattern: normalizedPattern(pixels),
        partialAlpha,
        transparentPixel,
    };
}
function familyShadeIndices(family, sprite) {
    const indices = new Map();
    const usedIndices = new Set(sprite ? [0] : []);
    if (!sprite) {
        for (const color of family) {
            const fixedIndex = FIXED_SHADE_INDICES.get(color);
            if (fixedIndex !== undefined) {
                indices.set(color, fixedIndex);
                usedIndices.add(fixedIndex);
            }
        }
    }
    const remaining = Array.from(family)
        .filter((color) => !indices.has(color))
        .sort((left, right) => left.localeCompare(right));
    for (const color of remaining) {
        for (let index = sprite ? 1 : 0; index < 4; index += 1) {
            if (!usedIndices.has(index)) {
                indices.set(color, index);
                usedIndices.add(index);
                break;
            }
        }
    }
    return indices;
}
function encodedPattern(pixels, indices) {
    return pixels.map((pixel) => (pixel === null ? 0 : indices.get(pixel) ?? 0).toString()).join("");
}
async function loadPng(projectRoot, assetPath) {
    const root = await realpath(projectRoot);
    const requestedPath = path.resolve(root, assetPath);
    const requestedRoot = path.resolve(projectRoot);
    if (!isWithinRoot(root, requestedPath) && !isWithinRoot(requestedRoot, requestedPath)) {
        throw new Error(`Graphics asset must stay within the project root: ${assetPath}`);
    }
    const resolvedPath = await realpath(requestedPath);
    if (!isWithinRoot(root, resolvedPath)) {
        throw new Error(`Graphics asset resolves outside the project root: ${assetPath}`);
    }
    if (path.extname(resolvedPath).toLowerCase() !== ".png") {
        throw new Error(`Graphics assets must be PNG files: ${assetPath}`);
    }
    const handle = await open(resolvedPath, "r");
    try {
        const information = await handle.stat();
        if (!information.isFile()) {
            throw new Error(`Graphics asset must be a regular file: ${assetPath}`);
        }
        if (information.size > MAX_IMAGE_BYTES) {
            throw new RangeError(`Graphics asset exceeds the ${MAX_IMAGE_BYTES}-byte safety limit.`);
        }
        const header = Buffer.alloc(24);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        if (bytesRead < header.length ||
            !header.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
            header.toString("ascii", 12, 16) !== "IHDR") {
            throw new Error(`Graphics asset is not a valid PNG image: ${assetPath}`);
        }
        const width = checkedDimension(header.readUInt32BE(16), "PNG width");
        const height = checkedDimension(header.readUInt32BE(20), "PNG height");
        if (width * height > MAX_IMAGE_PIXELS) {
            throw new RangeError(`PNG exceeds the ${MAX_IMAGE_PIXELS}-pixel safety limit.`);
        }
        const content = await handle.readFile();
        const image = PNG.sync.read(content, { checkCRC: true });
        return {
            assetPath: path.relative(root, resolvedPath).split(path.sep).join("/"),
            image,
        };
    }
    finally {
        await handle.close();
    }
}
function resolveGraphicsOptions(options) {
    const kind = options.kind ?? "background";
    const colorMode = options.colorMode ?? "mixed";
    if (!["background", "sprite", "tileset"].includes(kind)) {
        throw new RangeError(`Unsupported graphics asset kind: ${kind}`);
    }
    if (!["mono", "mixed", "color"].includes(colorMode)) {
        throw new RangeError(`Unsupported Game Boy color mode: ${colorMode}`);
    }
    const viewportWidth = checkedDimension(options.viewportWidth ?? 160, "Viewport width");
    const viewportHeight = checkedDimension(options.viewportHeight ?? 144, "Viewport height");
    return { kind, colorMode, viewportWidth, viewportHeight };
}
export async function analyzeGraphics(projectRoot, assetPath, options = {}) {
    // Preserve option validation before any filesystem access in the file API.
    resolveGraphicsOptions(options);
    const { assetPath: resolvedAssetPath, image } = await loadPng(projectRoot, assetPath);
    return analyzeGraphicsImage(image, resolvedAssetPath, options);
}
/** Analyze decoded PNG pixels without accessing files or changing the image. */
export function analyzeGraphicsImage(image, assetPath, options = {}) {
    const { kind, colorMode, viewportWidth, viewportHeight } = resolveGraphicsOptions(options);
    checkedDimension(image.width, "PNG width");
    checkedDimension(image.height, "PNG height");
    if (image.width * image.height > MAX_IMAGE_PIXELS) {
        throw new RangeError(`PNG exceeds the ${MAX_IMAGE_PIXELS}-pixel safety limit.`);
    }
    if (image.data.length !== image.width * image.height * 4) {
        throw new RangeError("Decoded PNG pixels must contain exactly four RGBA bytes per pixel.");
    }
    const tileWidth = Math.ceil(image.width / TILE_SIZE);
    const tileHeight = Math.ceil(image.height / TILE_SIZE);
    const maxTileColors = kind === "sprite" ? 3 : 4;
    const violations = [];
    const violationCounts = new Map();
    const sampledViolationCounts = new Map();
    let violationCount = 0;
    let hasError = false;
    const tilePatterns = new Set();
    const flippedTilePatterns = new Set();
    const invariantTilePatterns = new Set();
    const tilePalettes = [];
    const encodableTiles = [];
    const sourceColors = new Set();
    const quantizedColors = new Set();
    const quantizations = new Map();
    const addViolation = (violation) => {
        violationCount += 1;
        hasError ||= violation.severity === "error";
        violationCounts.set(violation.code, (violationCounts.get(violation.code) ?? 0) + 1);
        if (violations.length < MAX_DIAGNOSTICS) {
            violations.push(violation);
            sampledViolationCounts.set(violation.code, (sampledViolationCounts.get(violation.code) ?? 0) + 1);
            return;
        }
        if (sampledViolationCounts.has(violation.code)) {
            return;
        }
        for (let index = violations.length - 1; index >= 0; index -= 1) {
            const replacement = violations[index];
            if (replacement !== undefined && (sampledViolationCounts.get(replacement.code) ?? 0) > 1) {
                violations.splice(index, 1);
                sampledViolationCounts.set(replacement.code, sampledViolationCounts.get(replacement.code) - 1);
                violations.push(violation);
                sampledViolationCounts.set(violation.code, 1);
                return;
            }
        }
    };
    if (image.width % TILE_SIZE !== 0 || image.height % TILE_SIZE !== 0) {
        addViolation({
            code: "INVALID_TILE_DIMENSIONS",
            message: `Image dimensions ${image.width}×${image.height} must both be multiples of ${TILE_SIZE} pixels.`,
            severity: "error",
        });
    }
    for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1) {
            const pixel = readPixel(image, x, y, kind === "sprite");
            if (pixel.transparent) {
                continue;
            }
            sourceColors.add(pixel.original);
            quantizedColors.add(pixel.quantized);
            if (pixel.original !== pixel.quantized) {
                const existing = quantizations.get(pixel.original);
                if (existing === undefined) {
                    quantizations.set(pixel.original, {
                        sourceColor: pixel.original,
                        quantizedColor: pixel.quantized,
                        pixelCount: 1,
                    });
                }
                else {
                    existing.pixelCount += 1;
                }
            }
        }
    }
    for (let tileY = 0; tileY < tileHeight; tileY += 1) {
        for (let tileX = 0; tileX < tileWidth; tileX += 1) {
            const tile = inspectTile(image, tileX, tileY, kind === "sprite");
            invariantTilePatterns.add(tile.invariantPattern);
            const completeTile = (tileX + 1) * TILE_SIZE <= image.width && (tileY + 1) * TILE_SIZE <= image.height;
            let encodable = completeTile;
            if (tile.colors.size > maxTileColors) {
                encodable = false;
                addViolation({
                    code: kind === "sprite" ? "SPRITE_TILE_COLOR_LIMIT" : "BACKGROUND_TILE_COLOR_LIMIT",
                    message: `Tile (${tileX}, ${tileY}) uses ${tile.colors.size} opaque RGB555 colors; ${kind} tiles allow at most ${maxTileColors}${kind === "sprite" ? " plus transparency" : ""}.`,
                    tileX,
                    tileY,
                    severity: "error",
                });
            }
            if (tile.partialAlpha) {
                encodable = false;
                addViolation({
                    code: "PARTIAL_TRANSPARENCY",
                    message: `Tile (${tileX}, ${tileY}) uses partial transparency, which Game Boy hardware cannot display.`,
                    tileX,
                    tileY,
                    severity: "error",
                });
            }
            if (tile.transparentPixel && kind !== "sprite" && completeTile) {
                encodable = false;
                addViolation({
                    code: "BACKGROUND_TRANSPARENCY",
                    message: `Tile (${tileX}, ${tileY}) contains transparency; ${kind} graphics require opaque pixels.`,
                    tileX,
                    tileY,
                    severity: "error",
                });
            }
            if (encodable) {
                encodableTiles.push(tile);
                tilePalettes.push(tile.colors);
            }
        }
    }
    const packing = packTilePalettes(tilePalettes, maxTileColors);
    const paletteFamilies = packing.count ?? packing.upperBound;
    const familyIndices = packing.families.map((family) => familyShadeIndices(family, kind === "sprite"));
    for (const tile of encodableTiles) {
        const familyIndex = packing.families.findIndex((family) => includesPalette(family, tile.colors));
        const indices = familyIndices[familyIndex] ?? new Map();
        const pattern = encodedPattern(tile.pixels, indices);
        const orientations = [
            pattern,
            encodedPattern(orientPixels(tile.pixels, true, false), indices),
            encodedPattern(orientPixels(tile.pixels, false, true), indices),
            encodedPattern(orientPixels(tile.pixels, true, true), indices),
        ].sort();
        tilePatterns.add(pattern);
        flippedTilePatterns.add(orientations[0] ?? "");
    }
    if (packing.exceedsHardwareLimit) {
        addViolation({
            code: "PALETTE_FAMILY_LIMIT",
            message: `Image requires more than ${MAX_PALETTES} distinct ${kind === "sprite" ? "sprite" : "background"} palette families${packing.status === "exact" ? ` (${paletteFamilies} required)` : ""}; Game Boy Color supports at most ${MAX_PALETTES}.`,
            severity: "error",
        });
    }
    const allowFlipDeduplication = options.allowFlipDeduplication ?? colorMode === "color";
    const usedTiles = allowFlipDeduplication ? flippedTilePatterns.size : tilePatterns.size;
    const tileLimit = colorMode === "color" ? 384 : 192;
    const totalTiles = tileWidth * tileHeight;
    const invalidTiles = totalTiles - encodableTiles.length;
    const tileMetricStatus = invalidTiles === 0 ? "exact" : encodableTiles.length === 0 ? "unknown" : "partial";
    if (usedTiles > tileLimit) {
        addViolation({
            code: "TILE_BUDGET_EXCEEDED",
            message: `Image uses ${usedTiles} unique tiles, exceeding the ${tileLimit}-tile native ${colorMode} mode budget.`,
            severity: "error",
        });
    }
    const colors = Array.from(sourceColors).sort().slice(0, MAX_COLOR_SAMPLES);
    const rgb555Colors = Array.from(quantizedColors).sort().slice(0, MAX_COLOR_SAMPLES);
    const quantization = Array.from(quantizations.values())
        .sort((left, right) => left.sourceColor.localeCompare(right.sourceColor))
        .slice(0, MAX_QUANTIZATION_SAMPLES);
    return {
        assetPath,
        width: image.width,
        height: image.height,
        tileWidth,
        tileHeight,
        totalTiles,
        uniqueTiles: tilePatterns.size,
        uniqueTilesWithFlips: flippedTilePatterns.size,
        paletteFamilies,
        colors,
        colorCount: sourceColors.size,
        rgb555Colors,
        rgb555ColorCount: quantizedColors.size,
        quantization,
        quantizationCount: quantizations.size,
        tileBudget: {
            limit: tileLimit,
            used: usedTiles,
            remaining: tileLimit - usedTiles,
            mode: colorMode,
            exceeded: usedTiles > tileLimit,
        },
        viewport: {
            width: viewportWidth,
            height: viewportHeight,
            tileCount: Math.ceil(Math.min(image.width, viewportWidth) / TILE_SIZE) *
                Math.ceil(Math.min(image.height, viewportHeight) / TILE_SIZE),
        },
        violations,
        violationCount,
        violationCounts: Object.fromEntries(Array.from(violationCounts.entries()).sort(([left], [right]) => left.localeCompare(right))),
        truncation: {
            colors: sourceColors.size > colors.length,
            rgb555Colors: quantizedColors.size > rgb555Colors.length,
            quantization: quantizations.size > quantization.length,
            violations: violationCount > violations.length,
        },
        sampleLimits: {
            colors: MAX_COLOR_SAMPLES,
            rgb555Colors: MAX_COLOR_SAMPLES,
            quantization: MAX_QUANTIZATION_SAMPLES,
            violations: MAX_DIAGNOSTICS,
        },
        metrics: {
            tiles: {
                status: tileMetricStatus,
                unique: tileMetricStatus === "unknown" ? null : tilePatterns.size,
                uniqueWithFlips: tileMetricStatus === "unknown" ? null : flippedTilePatterns.size,
                paletteInvariantPatterns: invariantTilePatterns.size,
                encodableTiles: encodableTiles.length,
                invalidTiles,
            },
            paletteFamilies: invalidTiles > 0
                ? { status: "indeterminate", count: null }
                : {
                    status: packing.status,
                    count: packing.count,
                    ...(packing.status !== "exact" ? { upperBound: packing.upperBound } : {}),
                },
            tileBudget: {
                status: tileMetricStatus,
                used: tileMetricStatus === "unknown" ? null : usedTiles,
                remaining: tileMetricStatus === "exact" ? tileLimit - usedTiles : null,
                exceeded: usedTiles > tileLimit ? true : tileMetricStatus === "exact" ? false : null,
            },
        },
        validationStatus: hasError ? "invalid" : packing.status === "indeterminate" ? "indeterminate" : "valid",
        valid: !hasError,
    };
}
//# sourceMappingURL=graphics.js.map