import { createHash } from "node:crypto";
import { lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { prepareDialogue, } from "./dialogue.js";
import { resolveUiPalette } from "./palettes.js";
import { GameStudioProjectError } from "./project.js";
const SCREEN_WIDTH = 160;
const SCREEN_HEIGHT = 144;
const TILE_SIZE = 8;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_DIMENSION = 1024;
const MAX_PREVIEW_PAGES = 64;
const LABEL_HEIGHT = 16;
function insideRoot(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function assertInsideRoot(root, candidate) {
    if (!insideRoot(root, candidate)) {
        throw new GameStudioProjectError("PATH_OUTSIDE_PROJECT", `Dialogue preview path must stay inside the project: ${candidate}`, candidate);
    }
}
async function loadImage(root, resourcePath, expectedType) {
    const candidate = path.resolve(root, resourcePath);
    assertInsideRoot(root, candidate);
    let canonical;
    try {
        canonical = await realpath(candidate);
    }
    catch (error) {
        throw new GameStudioProjectError("RESOURCE_NOT_FOUND", `${expectedType} PNG does not exist: ${resourcePath}`, resourcePath);
    }
    assertInsideRoot(root, canonical);
    const bytes = await readFile(canonical);
    if (bytes.length > MAX_IMAGE_BYTES || bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new GameStudioProjectError("INVALID_RESOURCE", `${expectedType} is not a bounded PNG: ${resourcePath}`, resourcePath);
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
        throw new GameStudioProjectError("INVALID_RESOURCE", `${expectedType} PNG has unsupported dimensions: ${resourcePath}`, resourcePath);
    }
    try {
        return PNG.sync.read(bytes);
    }
    catch (error) {
        throw new GameStudioProjectError("INVALID_RESOURCE", `${expectedType} PNG could not be decoded: ${resourcePath}`, resourcePath);
    }
}
function colorFromHex(hex) {
    const normalized = hex.replace(/^#/u, "");
    return [Number.parseInt(normalized.slice(0, 2), 16), Number.parseInt(normalized.slice(2, 4), 16), Number.parseInt(normalized.slice(4, 6), 16)];
}
function pixel(image, x, y) {
    const offset = (image.width * y + x) * 4;
    return [image.data[offset] ?? 0, image.data[offset + 1] ?? 0, image.data[offset + 2] ?? 0, image.data[offset + 3] ?? 0];
}
function putPixel(image, x, y, color) {
    if (x < 0 || y < 0 || x >= image.width || y >= image.height)
        return;
    const offset = (image.width * y + x) * 4;
    image.data[offset] = color[0];
    image.data[offset + 1] = color[1];
    image.data[offset + 2] = color[2];
    image.data[offset + 3] = 255;
}
function fill(image, color) {
    for (let y = 0; y < image.height; y += 1) {
        for (let x = 0; x < image.width; x += 1)
            putPixel(image, x, y, color);
    }
}
function shadeLookup(image) {
    const colors = new Map();
    for (let offset = 0; offset < image.data.length; offset += 4) {
        const red = image.data[offset] ?? 0;
        const green = image.data[offset + 1] ?? 0;
        const blue = image.data[offset + 2] ?? 0;
        if ((image.data[offset + 3] ?? 0) === 0 || (red === 255 && green === 0 && blue === 255))
            continue;
        const key = `${red},${green},${blue}`;
        colors.set(key, 0.2126 * red + 0.7152 * green + 0.0722 * blue);
    }
    return new Map(Array.from(colors).sort((left, right) => right[1] - left[1]).map(([key], index, entries) => [key, Math.min(3, Math.round((index * 3) / Math.max(1, entries.length - 1)))]));
}
function remapPixel(image, x, y, palette, shades) {
    const [red, green, blue, alpha] = pixel(image, x, y);
    if (alpha === 0 || (red === 255 && green === 0 && blue === 255))
        return undefined;
    return palette[shades.get(`${red},${green},${blue}`) ?? 0];
}
function drawFrame(destination, frame, top, height, palette) {
    if (frame.width < TILE_SIZE * 3 || frame.height < TILE_SIZE * 3) {
        throw new GameStudioProjectError("INVALID_UI_FRAME", "The project UI frame must contain a 24 x 24 nine-slice image");
    }
    const shades = shadeLookup(frame);
    const left = TILE_SIZE;
    const width = SCREEN_WIDTH - TILE_SIZE * 2;
    for (let y = 0; y < height; y += 1) {
        const sourceY = y < TILE_SIZE ? y : y >= height - TILE_SIZE ? TILE_SIZE * 2 + y - (height - TILE_SIZE) : TILE_SIZE + ((y - TILE_SIZE) % TILE_SIZE);
        for (let x = 0; x < width; x += 1) {
            const sourceX = x < TILE_SIZE ? x : x >= width - TILE_SIZE ? TILE_SIZE * 2 + x - (width - TILE_SIZE) : TILE_SIZE + ((x - TILE_SIZE) % TILE_SIZE);
            const color = remapPixel(frame, sourceX, sourceY, palette, shades);
            if (color)
                putPixel(destination, left + x, top + y, color);
        }
    }
}
function drawGlyph(destination, font, character, startX, startY, palette) {
    const index = font.mapping.get(character) ?? font.mapping.get("?");
    if (index === undefined)
        return TILE_SIZE;
    const width = font.glyphWidths[index] ?? TILE_SIZE;
    const columns = font.image.width / TILE_SIZE;
    const sourceX = (index % columns) * TILE_SIZE;
    const sourceY = Math.floor(index / columns) * TILE_SIZE;
    const shades = shadeLookup(font.image);
    for (let y = 0; y < TILE_SIZE; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const color = remapPixel(font.image, sourceX + x, sourceY + y, palette, shades);
            if (color)
                putPixel(destination, startX + x, startY + y, color);
        }
    }
    return width;
}
function drawText(destination, font, text, startX, startY, palette, maxWidth) {
    let x = startX;
    for (const character of text) {
        const width = font.glyphWidths[font.mapping.get(character) ?? -1] ?? TILE_SIZE;
        if (x + width > startX + maxWidth)
            break;
        drawGlyph(destination, font, character, x, startY, palette);
        x += width;
    }
}
function findEvent(events, page) {
    return events.find((event) => event.id === (page.eventId ?? "") && event.sceneId === (page.sceneId ?? "")) ?? events[0];
}
function avatarAsset(inventory, id) {
    const avatar = inventory.assets.find((candidate) => candidate.type === "avatar" && candidate.id === id);
    if (!avatar)
        throw new GameStudioProjectError("AVATAR_NOT_FOUND", `The selected avatar does not exist: ${id}`);
    return avatar;
}
async function renderPage(inventory, font, frame, page, event, overrideAvatarId, maxVisibleLines) {
    const palette = resolveUiPalette(inventory).colors.map(colorFromHex);
    const image = new PNG({ width: SCREEN_WIDTH, height: SCREEN_HEIGHT });
    fill(image, palette[3]);
    const scene = inventory.scenes.find((candidate) => candidate.id === page.sceneId);
    const background = inventory.assets.find((candidate) => candidate.type === "background" && candidate.id === scene?.backgroundId);
    if (background) {
        const source = await loadImage(inventory.projectRoot, background.resourcePath, "Background");
        for (let y = 0; y < Math.min(SCREEN_HEIGHT, source.height); y += 1) {
            for (let x = 0; x < Math.min(SCREEN_WIDTH, source.width); x += 1) {
                const [red, green, blue, alpha] = pixel(source, x, y);
                if (alpha > 0)
                    putPixel(image, x, y, [red, green, blue]);
            }
        }
    }
    const height = Math.min(SCREEN_HEIGHT, (Math.min(maxVisibleLines, 8) + 2) * TILE_SIZE);
    const top = event?.position === "top" ? 0 : SCREEN_HEIGHT - height;
    drawFrame(image, frame, top, height, palette);
    const avatarId = overrideAvatarId ?? event?.avatarId ?? "";
    let textX = TILE_SIZE * 2;
    if (avatarId) {
        const asset = avatarAsset(inventory, avatarId);
        const avatar = await loadImage(inventory.projectRoot, asset.resourcePath, "Avatar");
        if (avatar.width !== 16 || avatar.height !== 16)
            throw new GameStudioProjectError("INVALID_AVATAR", `Dialogue avatars must be 16 x 16: ${asset.resourcePath}`);
        const shades = shadeLookup(avatar);
        for (let y = 0; y < 16; y += 1) {
            for (let x = 0; x < 16; x += 1) {
                const color = remapPixel(avatar, x, y, palette, shades);
                if (color)
                    putPixel(image, textX + x, top + TILE_SIZE + y, color);
            }
        }
        textX += TILE_SIZE * 3;
    }
    const maxWidth = SCREEN_WIDTH - TILE_SIZE * 2 - textX;
    for (const [lineIndex, line] of page.text.split("\n").slice(0, maxVisibleLines).entries()) {
        drawText(image, font, line, textX, top + TILE_SIZE * (lineIndex + 1), palette, maxWidth);
    }
    return image;
}
function positiveOption(value, fallback, maximum, name) {
    if (value === undefined)
        return fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
        throw new GameStudioProjectError("INVALID_PREVIEW_OPTIONS", `${name} must be an integer between 1 and ${maximum}`);
    return value;
}
function scaledCopy(destination, source, startX, startY, scale) {
    for (let y = 0; y < source.height; y += 1) {
        for (let x = 0; x < source.width; x += 1) {
            const [red, green, blue] = pixel(source, x, y);
            for (let sy = 0; sy < scale; sy += 1) {
                for (let sx = 0; sx < scale; sx += 1)
                    putPixel(destination, startX + x * scale + sx, startY + y * scale + sy, [red, green, blue]);
            }
        }
    }
}
async function resolveOutputPath(projectRoot, outputPath) {
    if (typeof outputPath !== "string" || outputPath.trim().length === 0 || path.extname(outputPath).toLowerCase() !== ".png") {
        throw new GameStudioProjectError("INVALID_PREVIEW_PATH", "Dialogue previews require a nonempty .png output path");
    }
    const candidate = path.resolve(projectRoot, outputPath);
    assertInsideRoot(projectRoot, candidate);
    const parent = path.dirname(candidate);
    let ancestor = parent;
    while (true) {
        try {
            await lstat(ancestor);
            break;
        }
        catch (error) {
            if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT")
                throw error;
            const next = path.dirname(ancestor);
            if (next === ancestor)
                throw new GameStudioProjectError("INVALID_PREVIEW_PATH", `Dialogue output has no accessible parent: ${outputPath}`);
            ancestor = next;
        }
    }
    assertInsideRoot(projectRoot, await realpath(ancestor));
    await mkdir(parent, { recursive: true });
    const canonicalParent = await realpath(parent);
    assertInsideRoot(projectRoot, canonicalParent);
    const destination = path.join(canonicalParent, path.basename(candidate));
    try {
        const existing = await lstat(destination);
        if (existing.isSymbolicLink() || !existing.isFile())
            throw new GameStudioProjectError("INVALID_PREVIEW_PATH", `Refusing to overwrite an unsafe dialogue-preview output: ${destination}`);
    }
    catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT")
            throw error;
    }
    return destination;
}
export async function previewDialogue(projectPath, input, access) {
    const prepared = await prepareDialogue(projectPath, input, access);
    const allPages = prepared.analysis.pages;
    if (allPages.length === 0)
        throw new GameStudioProjectError("DIALOGUE_NOT_FOUND", "No dialogue pages match the requested preview");
    if (input.pageIndex !== undefined && input.pageIndices !== undefined)
        throw new GameStudioProjectError("INVALID_PREVIEW_OPTIONS", "Provide either pageIndex or pageIndices, not both");
    const indices = input.pageIndices ?? [input.pageIndex ?? 0];
    if (indices.length === 0 || indices.length > MAX_PREVIEW_PAGES)
        throw new GameStudioProjectError("INVALID_PREVIEW_OPTIONS", `A dialogue preview must contain between 1 and ${MAX_PREVIEW_PAGES} pages`);
    for (const index of indices) {
        if (!Number.isSafeInteger(index) || index < 0 || index >= allPages.length)
            throw new GameStudioProjectError("DIALOGUE_PAGE_NOT_FOUND", `Dialogue page ${index} does not exist`);
    }
    const frame = await loadImage(prepared.inventory.projectRoot, "assets/ui/frame.png", "UI frame");
    const pages = await Promise.all(indices.map(async (index) => {
        const page = allPages[index];
        return renderPage(prepared.inventory, prepared.font, frame, page, findEvent(prepared.events, page), input.avatarId, prepared.analysis.layout.maxVisibleLines);
    }));
    const scale = positiveOption(input.magnification, 1, 4, "magnification");
    const columns = positiveOption(input.columns, Math.min(pages.length, 3), 8, "columns");
    const actualColumns = Math.min(columns, pages.length);
    const rows = Math.ceil(pages.length / actualColumns);
    const labeled = pages.length > 1;
    const tileHeight = SCREEN_HEIGHT + (labeled ? LABEL_HEIGHT : 0);
    const output = new PNG({ width: SCREEN_WIDTH * actualColumns * scale, height: tileHeight * rows * scale });
    const palette = resolveUiPalette(prepared.inventory).colors.map(colorFromHex);
    fill(output, palette[3]);
    for (let index = 0; index < pages.length; index += 1) {
        const x = (index % actualColumns) * SCREEN_WIDTH * scale;
        const y = Math.floor(index / actualColumns) * tileHeight * scale;
        if (labeled) {
            const label = new PNG({ width: SCREEN_WIDTH, height: LABEL_HEIGHT });
            fill(label, palette[0]);
            drawText(label, prepared.font, `PAGE ${indices[index] + 1}/${allPages.length}`, 4, 4, palette, SCREEN_WIDTH - 8);
            scaledCopy(output, label, x, y, scale);
        }
        scaledCopy(output, pages[index], x, y + (labeled ? LABEL_HEIGHT * scale : 0), scale);
    }
    const destination = await resolveOutputPath(prepared.inventory.projectRoot, input.outputPath);
    const bytes = PNG.sync.write(output);
    const handle = await open(destination, "w");
    try {
        await handle.writeFile(bytes);
    }
    finally {
        await handle.close();
    }
    return {
        provenance: "static-dialogue-preview",
        genuineEmulatorFrame: false,
        runtimeVerified: false,
        path: path.relative(prepared.inventory.projectRoot, destination).split(path.sep).join("/"),
        sha256: createHash("sha256").update(bytes).digest("hex"),
        width: output.width,
        height: output.height,
        pageCount: pages.length,
        confidence: prepared.analysis.confidence,
    };
}
//# sourceMappingURL=dialogue-preview.js.map