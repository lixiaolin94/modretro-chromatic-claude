import { createHash } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";
import { inflateSync } from "node:zlib";
import { PNG } from "pngjs";
import { decodeBackgroundPaletteTiles } from "./palettes.js";
import { applyPreparedProjectTransaction } from "./scene-batch.js";
import { projectPathExists, projectRelativePath, readProjectJson, resolveProjectPath, resourceSlug, stableResourceId, writeProjectJsonAtomic, } from "./project-files.js";
import { discoverProject, GameStudioProjectError, inventoryProject, } from "./project.js";
import { createSpriteResource } from "./sprites.js";
import { createNativeSpriteMetadata, MAX_NATIVE_METADATA_BYTES } from "./native-sprite-metadata.js";
import { nativeImportPath, readNativeImportSnapshot, readNativeProjectMetadata } from "./native-import-files.js";
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const MAX_PNG_BYTES = 16 * 1024 * 1024;
const MAX_PNG_CHUNKS = 4_096;
const MAX_BACKGROUND_DIMENSION = 2040;
const MAX_BACKGROUND_PIXELS = 1_048_320;
// At most eight bytes per source pixel (16-bit RGBA), plus Adam7 filter bytes.
const MAX_PNG_INFLATED_BYTES = MAX_BACKGROUND_PIXELS * 8 + MAX_BACKGROUND_DIMENSION * 7;
const PNG_IHDR = 0x49484452;
const PNG_PLTE = 0x504c5445;
const PNG_IDAT = 0x49444154;
const PNG_IEND = 0x49454e44;
const ADAM7_PASSES = [
    [0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
    [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2],
];
const BACKGROUND_COLORS = new Set(["#071821", "#306850", "#86c06c", "#e0f8cf"]);
const SPRITE_COLORS = new Set(["#071821", "#86c06c", "#e0f8cf", "#65ff00"]);
const RESOURCE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function isSystemError(error, code) {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function assetError(code, message, resourcePath) {
    throw new GameStudioProjectError(code, message, resourcePath);
}
function colorAt(image, offset) {
    return `#${(image.data[offset] ?? 0).toString(16).padStart(2, "0")}${(image.data[offset + 1] ?? 0)
        .toString(16)
        .padStart(2, "0")}${(image.data[offset + 2] ?? 0).toString(16).padStart(2, "0")}`;
}
function validatePngDimensions(width, height, resourcePath) {
    if (!Number.isSafeInteger(width) ||
        !Number.isSafeInteger(height) ||
        width < 1 ||
        height < 1 ||
        width > MAX_BACKGROUND_DIMENSION ||
        height > MAX_BACKGROUND_DIMENSION ||
        width * height > MAX_BACKGROUND_PIXELS) {
        assetError("INVALID_ASSET_DIMENSIONS", "PNG dimensions exceed bounded native game asset limits.", resourcePath);
    }
}
function validatePngHeader(bytes, resourcePath) {
    if (bytes.length < 24 ||
        !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE) ||
        bytes.readUInt32BE(8) !== 13 ||
        bytes.readUInt32BE(12) !== PNG_IHDR) {
        assetError("INVALID_PNG", "The asset is not a valid PNG image.", resourcePath);
    }
    validatePngDimensions(bytes.readUInt32BE(16), bytes.readUInt32BE(20), resourcePath);
}
/** Check the exact stream pngjs will inflate, before its parser can allocate. */
function validatePngStream(bytes) {
    if (bytes.length < 33)
        throw new Error("Truncated IHDR chunk.");
    const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
    const depth = bytes[24], colorType = bytes[25], interlace = bytes[28];
    const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(colorType);
    const depths = colorType === 0 ? [1, 2, 4, 8, 16] : colorType === 3 ? [1, 2, 4, 8] : [8, 16];
    if (channels === undefined || !depths.includes(depth) || bytes[26] !== 0 || bytes[27] !== 0 || (interlace !== 0 && interlace !== 1)) {
        throw new Error("Unsupported PNG color, depth, compression, filter, or interlace method.");
    }
    let compressedLength = 0;
    let chunkCount = 0;
    let idatState = 0; // 0: before IDAT, 1: consecutive IDAT chunks, 2: after IDAT.
    let hasPalette = false, hasEnd = false;
    for (let offset = 8; offset < bytes.length;) {
        if (++chunkCount > MAX_PNG_CHUNKS)
            throw new Error(`PNG exceeds the ${MAX_PNG_CHUNKS}-chunk safety limit.`);
        if (bytes.length - offset < 12)
            throw new Error("Truncated PNG chunk.");
        const length = bytes.readUInt32BE(offset), type = bytes.readUInt32BE(offset + 4);
        if (length > bytes.length - offset - 12)
            throw new Error("PNG chunk length exceeds the input.");
        const end = offset + length + 12;
        if (type === PNG_IHDR && (offset !== 8 || length !== 13))
            throw new Error("PNG requires one leading 13-byte IHDR chunk.");
        if (type === PNG_PLTE) {
            if (hasPalette || idatState !== 0 || length === 0 || length > 768 || length % 3 !== 0) {
                throw new Error("PNG requires at most one palette of 1–256 entries before IDAT.");
            }
            hasPalette = true;
        }
        if (type === PNG_IDAT) {
            if (idatState === 2)
                throw new Error("PNG IDAT chunks must be consecutive.");
            idatState = 1;
            compressedLength += length;
        }
        else if (idatState === 1) {
            idatState = 2;
        }
        if (type === PNG_IEND) {
            if (length !== 0 || end !== bytes.length)
                throw new Error("PNG requires a terminal empty IEND chunk.");
            hasEnd = true;
        }
        offset = end;
    }
    if (!hasEnd || compressedLength === 0 || (colorType === 3 && !hasPalette))
        throw new Error("PNG is missing image data, palette, or IEND.");
    const passes = interlace === 1 ? ADAM7_PASSES : [[0, 0, 1, 1]];
    let inflatedLength = 0;
    for (const [startX, startY, stepX, stepY] of passes) {
        const passWidth = Math.max(0, Math.ceil((width - startX) / stepX));
        const passHeight = Math.max(0, Math.ceil((height - startY) / stepY));
        if (passWidth && passHeight)
            inflatedLength += (Math.ceil(passWidth * channels * depth / 8) + 1) * passHeight;
    }
    if (!Number.isSafeInteger(inflatedLength) || inflatedLength < 1 || inflatedLength > MAX_PNG_INFLATED_BYTES) {
        throw new Error("PNG decompression exceeds the bounded source-pixel limit.");
    }
    // Copy in a second pass rather than allocating an array per untrusted chunk.
    const compressed = Buffer.allocUnsafe(compressedLength);
    let written = 0;
    for (let offset = 8; offset < bytes.length;) {
        const length = bytes.readUInt32BE(offset);
        if (bytes.readUInt32BE(offset + 4) === PNG_IDAT) {
            bytes.copy(compressed, written, offset + 8, offset + 8 + length);
            written += length;
        }
        offset += length + 12;
    }
    // pngjs's Adam7 branch lacks an output cap; its noninterlaced branch can
    // silently truncate extra data. Prove the exact length with Node's capped
    // inflater first. pngjs then receives the same private, size-proven bytes.
    const inflated = inflateSync(compressed, { maxOutputLength: inflatedLength });
    if (inflated.length !== inflatedLength)
        throw new Error("PNG scanline data does not match its header dimensions.");
    return { width, height };
}
/** Decode bounded PNG bytes without accessing or modifying a project. */
export function decodePngBytes(bytes, resourcePath) {
    if (bytes.length > MAX_PNG_BYTES) {
        assetError("ASSET_TOO_LARGE", `PNG exceeds the ${MAX_PNG_BYTES}-byte safety limit.`, resourcePath);
    }
    // Do not let a caller's shared backing buffer change between preflight and decode.
    const input = Buffer.from(bytes);
    validatePngHeader(input, resourcePath);
    try {
        const { width, height } = validatePngStream(input);
        const image = PNG.sync.read(input, { checkCRC: true });
        if (image.width !== width || image.height !== height || image.data.length !== width * height * 4) {
            throw new Error("Decoded PNG dimensions or RGBA length differ from the bounded header.");
        }
        return image;
    }
    catch (error) {
        assetError("INVALID_PNG", `PNG decoding or CRC validation failed: ${error instanceof Error ? error.message : String(error)}`, resourcePath);
    }
}
async function readBoundedPng(projectRoot, filename) {
    const safePath = await resolveProjectPath(projectRoot, filename, { mustExist: true });
    if (path.extname(safePath).toLowerCase() !== ".png") {
        assetError("INVALID_ASSET_PATH", "Native image assets must use the .png extension.", safePath);
    }
    const handle = await open(safePath, "r");
    try {
        const info = await handle.stat();
        if (!info.isFile())
            assetError("INVALID_ASSET", "A native game asset must be a regular PNG file.", safePath);
        if (info.size > MAX_PNG_BYTES) {
            assetError("ASSET_TOO_LARGE", `PNG exceeds the ${MAX_PNG_BYTES}-byte safety limit.`, safePath);
        }
        const header = Buffer.alloc(24);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        validatePngHeader(header.subarray(0, bytesRead), safePath);
        const bytes = await handle.readFile();
        return { bytes, image: decodePngBytes(bytes, safePath) };
    }
    finally {
        await handle.close();
    }
}
function validatePixels(image, kind, autoColor) {
    for (let index = 0; index < image.data.length; index += 4) {
        const alpha = image.data[index + 3] ?? 0;
        const color = colorAt(image, index);
        if (kind === "background") {
            if (alpha !== 255) {
                assetError("BACKGROUND_TRANSPARENCY", "native game backgrounds must be completely opaque.");
            }
            if (!autoColor && !BACKGROUND_COLORS.has(color)) {
                assetError("INVALID_BACKGROUND_COLOR", `Manual-color backgrounds cannot contain ${color}.`);
            }
        }
        else {
            if (alpha !== 0 && alpha !== 255) {
                assetError("SPRITE_PARTIAL_TRANSPARENCY", "native game sprites cannot contain partially transparent pixels.");
            }
            if (alpha !== 0 && !SPRITE_COLORS.has(color)) {
                assetError("INVALID_SPRITE_COLOR", `native game sprite source artwork cannot contain ${color}.`);
            }
        }
    }
}
function validateBackgroundDimensions(width, height) {
    validatePngDimensions(width, height);
    if (width < 160 || height < 144 || width % 8 !== 0 || height % 8 !== 0) {
        assetError("INVALID_BACKGROUND_DIMENSIONS", "Backgrounds must be at least 160 × 144 and divisible into 8 × 8 tiles.");
    }
}
/** Validate native background dimensions, opacity, and manual source shades. */
export function validateBackgroundPng(image, autoColor = false) {
    validatePngDimensions(image.width, image.height);
    if (image.data.length !== image.width * image.height * 4) {
        assetError("INVALID_PNG", "Decoded PNG pixels must contain exactly four RGBA bytes per pixel.");
    }
    validatePixels(image, "background", autoColor);
    validateBackgroundDimensions(image.width, image.height);
}
/** Construct the same native background sidecar used by PNG import. */
export function createBackgroundMetadata(input) {
    if (!RESOURCE_ID.test(input.id)) {
        assetError("INVALID_RESOURCE_ID", "An imported native game asset ID must be a valid UUID.");
    }
    validateBackgroundDimensions(input.widthPx, input.heightPx);
    const name = ensureName(input.name);
    return {
        _resourceType: "background",
        id: input.id,
        name,
        symbol: `bg_${resourceSlug(name, "background")}`,
        tileColors: "",
        filename: input.filename,
        width: input.widthPx / 8,
        height: input.heightPx / 8,
        imageWidth: input.widthPx,
        imageHeight: input.heightPx,
        autoColor: input.autoColor ?? false,
    };
}
function assetResult(metadata, relativeAssetPath, profile) {
    const kind = metadata._resourceType === "background" ? "background" : "sprite";
    const width = Number(kind === "background" ? metadata.imageWidth : metadata.width);
    const height = Number(kind === "background" ? metadata.imageHeight : metadata.height);
    const result = {
        id: String(metadata.id),
        kind,
        name: String(metadata.name),
        assetPath: relativeAssetPath,
        metadataPath: `${relativeAssetPath}.gbsres`,
        width,
        height,
    };
    if (typeof metadata.checksum === "string")
        result.checksum = metadata.checksum;
    if (profile !== undefined)
        result.profile = profile;
    return result;
}
async function assertDistributedProject(projectRoot, access) {
    const project = access ? access.projectInspection() : await discoverProject(projectRoot);
    if (project.format !== "distributed") {
        assetError("UNSUPPORTED_PROJECT_FORMAT", "Native PNG asset authoring requires a distributed native game project.");
    }
    return project.projectRoot;
}
function normalizedDestination(root, assetPath, kind) {
    if (!assetPath || path.extname(assetPath).toLowerCase() !== ".png") {
        assetError("INVALID_ASSET_PATH", "An asset destination must name a .png file.");
    }
    const folder = kind === "background" ? "backgrounds" : "sprites";
    const destination = path.resolve(root, assetPath);
    const relative = path.relative(path.join(root, "assets", folder), destination);
    if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        assetError("INVALID_ASSET_PATH", `A ${kind} destination must remain inside assets/${folder}.`, destination);
    }
    return destination;
}
async function exclusiveWrite(filename, content) {
    let handle;
    try {
        handle = await open(filename, "wx", 0o600);
        await handle.writeFile(content);
        await handle.sync();
    }
    catch (error) {
        if (isSystemError(error, "EEXIST")) {
            assetError("ASSET_ALREADY_EXISTS", `Refusing to overwrite the existing asset resource ${filename}.`, filename);
        }
        if (handle)
            await rm(filename, { force: true });
        throw error;
    }
    finally {
        await handle?.close();
    }
}
function ensureName(value) {
    if (!value.trim())
        assetError("INVALID_INPUT", "Asset names cannot be empty.");
    return value.trim();
}
export async function findAssetMetadata(projectRoot, input, access) {
    if (!input.assetId && !input.assetPath) {
        assetError("INVALID_INPUT", "Provide either assetId or assetPath.");
    }
    const project = access ? undefined : await inventoryProject(projectRoot);
    const root = access?.projectRoot ?? project.projectRoot;
    const expectedPath = input.assetPath
        ? projectRelativePath(root, await resolveProjectPath(root, input.assetPath, { mustExist: true }))
        : undefined;
    let asset;
    if (access) {
        const lookup = access.asset({ assetId: input.assetId, assetPath: expectedPath });
        if (lookup.status === "unique")
            asset = lookup.asset;
    }
    else {
        const matches = project.assets.filter((candidate) => (input.assetId === undefined || candidate.id === input.assetId) &&
            (expectedPath === undefined || candidate.resourcePath === expectedPath));
        if (matches.length === 1)
            asset = matches[0];
    }
    if (!asset) {
        assetError("ASSET_NOT_FOUND", `Could not uniquely resolve native game asset ${input.assetId ?? input.assetPath}.`);
    }
    if (!asset.hasMetadata || asset.metadataPath === null) {
        assetError("ASSET_NOT_REGISTERED", `Asset ${asset.resourcePath} has no native resource metadata.`);
    }
    return {
        projectRoot: root,
        asset,
        assetPath: asset.resourcePath,
        metadataPath: asset.metadataPath,
        metadata: await readProjectJson(root, asset.metadataPath),
    };
}
export async function importAsset(projectRoot, input, access) {
    if (input.sprite?.profile === "native_metadata")
        return importNativeMetadata(projectRoot, input, access);
    if (input.expectedRevision !== undefined || input.dryRun !== undefined || input.sprite?.metadataPath !== undefined
        || input.sprite?.sourceSha256 !== undefined || input.sprite?.metadataSha256 !== undefined) {
        assetError("INVALID_INPUT", "Metadata paths, digests, expectedRevision and dryRun apply only to native_metadata sprite import.");
    }
    const root = await assertDistributedProject(projectRoot, access);
    if (input.kind !== "background" && input.kind !== "sprite") {
        assetError("INVALID_INPUT", "Asset kind must be background or sprite.");
    }
    if (input.kind === "sprite" && !input.sprite?.profile) {
        assetError("SPRITE_PROFILE_REQUIRED", "Importing a sprite requires an explicit, proven sprite profile.");
    }
    if (input.id !== undefined && !RESOURCE_ID.test(input.id)) {
        assetError("INVALID_RESOURCE_ID", "An imported native game asset ID must be a valid UUID.");
    }
    const destination = normalizedDestination(root, input.assetPath, input.kind);
    const relativeDestination = projectRelativePath(root, destination);
    const source = input.sourcePath
        ? await resolveProjectPath(root, input.sourcePath, { mustExist: true })
        : await resolveProjectPath(root, destination, { mustExist: true });
    await resolveProjectPath(root, destination);
    const sidecar = `${destination}.gbsres`;
    await resolveProjectPath(root, sidecar);
    if (input.sourcePath && (await projectPathExists(root, destination))) {
        assetError("ASSET_ALREADY_EXISTS", `Refusing to overwrite existing PNG ${relativeDestination}.`, destination);
    }
    if (await projectPathExists(root, sidecar)) {
        assetError("ASSET_ALREADY_EXISTS", `Refusing to overwrite existing metadata ${relativeDestination}.gbsres.`, sidecar);
    }
    const { bytes, image } = await readBoundedPng(root, source);
    const autoColor = input.background?.autoColor ?? false;
    if (input.kind === "background")
        validateBackgroundPng(image, autoColor);
    else
        validatePixels(image, input.kind, autoColor);
    const filename = path.basename(destination);
    const name = ensureName(input.name ?? path.basename(filename, ".png"));
    const id = input.id ?? stableResourceId("asset", input.kind, relativeDestination);
    const duplicate = access
        ? access.asset({ assetId: id }).status !== "missing"
        : (await inventoryProject(root)).assets.some((asset) => asset.id === id);
    if (duplicate) {
        assetError("DUPLICATE_RESOURCE_ID", `The asset ID ${id} is already used by this native game project.`);
    }
    let metadata;
    if (input.kind === "background") {
        metadata = createBackgroundMetadata({
            id,
            name,
            filename,
            widthPx: image.width,
            heightPx: image.height,
            autoColor,
        });
    }
    else {
        metadata = await createSpriteResource(root, {
            id,
            name,
            filename,
            width: image.width,
            height: image.height,
            checksum: createHash("sha1").update(bytes).digest("hex"),
            profile: input.sprite.profile,
            templateAssetId: input.sprite.templateAssetId,
        }, access);
    }
    const parent = path.dirname(destination);
    await mkdir(parent, { recursive: true });
    await resolveProjectPath(root, parent, { mustExist: true });
    let createdPng = false;
    try {
        if (input.sourcePath) {
            await exclusiveWrite(destination, bytes);
            createdPng = true;
        }
        await exclusiveWrite(sidecar, `${JSON.stringify(metadata, null, 2)}\n`);
    }
    catch (error) {
        if (createdPng)
            await rm(destination, { force: true });
        throw error;
    }
    return assetResult(metadata, relativeDestination, input.sprite?.profile);
}
async function importNativeMetadata(projectRoot, input, access) {
    const options = input.sprite;
    if (input.kind !== "sprite" || input.background !== undefined || options.templateAssetId !== undefined || !input.sourcePath
        || !options.metadataPath || !input.expectedRevision?.trim() || !/^[a-f0-9]{64}$/i.test(options.sourceSha256 ?? "")
        || !/^[a-f0-9]{64}$/i.test(options.metadataSha256 ?? "")) {
        assetError("INVALID_INPUT", "native_metadata requires a sprite, sourcePath, metadataPath, both SHA-256 digests and expectedRevision; background and template options are not allowed.");
    }
    if (input.id !== undefined && !RESOURCE_ID.test(input.id))
        assetError("INVALID_RESOURCE_ID", "The imported sprite ID must be a valid UUID.");
    const { value, ...transaction } = await applyPreparedProjectTransaction(projectRoot, { expectedRevision: input.expectedRevision, dryRun: input.dryRun }, async (snapshot) => {
        const root = snapshot.projectRoot;
        const destination = await nativeImportPath(root, input.assetPath);
        if (normalizedDestination(root, input.assetPath, "sprite") !== destination)
            assetError("INVALID_ASSET_PATH", "Invalid sprite destination.");
        const metadataPath = `${input.assetPath}.gbsres`;
        await nativeImportPath(root, metadataPath);
        if (await projectPathExists(root, destination) || await projectPathExists(root, metadataPath))
            assetError("ASSET_ALREADY_EXISTS", "Native sprite import requires a new PNG and metadata sidecar.");
        if (path.extname(input.sourcePath).toLowerCase() !== ".png" || ![".json", ".gbsres"].includes(path.extname(options.metadataPath).toLowerCase())) {
            assetError("INVALID_ASSET_PATH", "Native sprite sources require a PNG and a JSON or gbsres metadata file.");
        }
        const [png, metadata] = await Promise.all([
            readNativeImportSnapshot(root, input.sourcePath, MAX_PNG_BYTES),
            readNativeImportSnapshot(root, options.metadataPath, MAX_NATIVE_METADATA_BYTES),
        ]);
        if (png.identity.sha256 !== options.sourceSha256.toLowerCase() || metadata.identity.sha256 !== options.metadataSha256.toLowerCase()) {
            assetError("NATIVE_IMPORT_DIGEST_MISMATCH", "The native sprite source pair does not match the supplied digests.");
        }
        const image = decodePngBytes(png.bytes, input.sourcePath);
        validatePixels(image, "sprite", false);
        const id = (input.id ?? stableResourceId("asset", "sprite", input.assetPath)).toLowerCase();
        const name = ensureName(input.name ?? path.basename(input.assetPath, ".png"));
        const existingIds = new Set(), pending = [snapshot.inventory, [...snapshot.variablesById.values()], await readNativeProjectMetadata(root)];
        while (pending.length) {
            const node = pending.pop();
            if (!node || typeof node !== "object")
                continue;
            if (Array.isArray(node)) {
                for (const child of node)
                    pending.push(child);
            }
            else
                for (const [key, value] of Object.entries(node)) {
                    if (key === "id" && typeof value === "string")
                        existingIds.add(value.toLowerCase());
                    else if (value && typeof value === "object")
                        pending.push(value);
                }
        }
        const created = createNativeSpriteMetadata(metadata.bytes, png.bytes, image, { id, name, filename: path.basename(input.assetPath) }, existingIds);
        const outputMetadata = Buffer.from(`${JSON.stringify(created.metadata, null, 2)}\n`);
        return {
            files: [
                { relativePath: input.sourcePath, before: png.bytes, after: png.bytes, beforeIdentity: png.identity },
                { relativePath: options.metadataPath, before: metadata.bytes, after: metadata.bytes, beforeIdentity: metadata.identity },
                { relativePath: input.assetPath, before: null, after: png.bytes, createOnly: true },
                { relativePath: metadataPath, before: null, after: outputMetadata, createOnly: true },
            ],
            value: { ...assetResult(created.metadata, input.assetPath, "native_metadata"), idMap: created.idMap, diagnostics: created.diagnostics, counts: created.counts, patternAccounting: created.patternAccounting,
                sourceSha256: png.identity.sha256, metadataSha256: metadata.identity.sha256, outputSha256: png.identity.sha256,
                outputMetadataSha256: createHash("sha256").update(outputMetadata).digest("hex") },
        };
    }, access);
    return { ...value, ...transaction };
}
export async function inspectAsset(projectRoot, input, access) {
    const loaded = await findAssetMetadata(projectRoot, input, access);
    if (loaded.metadata._resourceType !== "background" && loaded.metadata._resourceType !== "sprite") {
        assetError("UNSUPPORTED_ASSET_KIND", `Asset ${loaded.assetPath} is not a registered background or sprite.`);
    }
    return assetResult(loaded.metadata, loaded.assetPath);
}
export async function updateAsset(projectRoot, input, access) {
    if (input.copyTileColorsFrom !== undefined)
        return copyBackgroundTileColors(projectRoot, input, access);
    if (input.expectedRevision !== undefined || input.dryRun !== undefined) {
        assetError("INVALID_INPUT", "expectedRevision and dryRun apply to copyTileColorsFrom only.");
    }
    const loaded = await findAssetMetadata(await assertDistributedProject(projectRoot, access), input, access);
    if (loaded.metadata._resourceType !== "background" && loaded.metadata._resourceType !== "sprite") {
        assetError("UNSUPPORTED_ASSET_KIND", "Only native background and sprite metadata can be updated.");
    }
    if (input.autoColor !== undefined && loaded.metadata._resourceType !== "background") {
        assetError("INVALID_INPUT", "autoColor applies only to background assets.");
    }
    const updated = { ...loaded.metadata };
    if (input.name !== undefined) {
        updated.name = ensureName(input.name);
        updated.symbol = `${loaded.metadata._resourceType === "background" ? "bg" : "sprite"}_${resourceSlug(String(updated.name), "asset")}`;
    }
    if (input.autoColor !== undefined) {
        if (!input.autoColor) {
            const { image } = await readBoundedPng(loaded.projectRoot, loaded.assetPath);
            validatePixels(image, "background", false);
        }
        updated.autoColor = input.autoColor;
    }
    await writeProjectJsonAtomic(loaded.projectRoot, loaded.metadataPath, updated);
    return assetResult(updated, loaded.assetPath);
}
/** Initialize replacement art with an existing palette grid, without repainting reserved UI cells. */
async function copyBackgroundTileColors(projectPath, input, access) {
    if (!input.copyTileColorsFrom?.trim() || !input.expectedRevision?.trim()
        || input.name !== undefined || input.autoColor !== undefined) {
        assetError("INVALID_INPUT", "copyTileColorsFrom requires an existing background ID and expectedRevision, without name or autoColor edits.");
    }
    const { value, ...transaction } = await applyPreparedProjectTransaction(projectPath, { expectedRevision: input.expectedRevision, dryRun: input.dryRun }, async (snapshot) => {
        const root = snapshot.projectRoot;
        const expectedPath = input.assetPath === undefined ? undefined
            : projectRelativePath(root, await resolveProjectPath(root, input.assetPath, { mustExist: true }));
        const select = (id, assetPath) => {
            if (!id && !assetPath)
                assetError("INVALID_INPUT", "Provide either assetId or assetPath.");
            const matches = snapshot.inventory.assets.filter((asset) => (id === undefined || asset.id === id) && (assetPath === undefined || asset.resourcePath === assetPath));
            if (matches.length !== 1)
                assetError("ASSET_NOT_FOUND", "Palette transfer requires two uniquely registered backgrounds.");
            const selected = matches[0];
            if (typeof selected.id !== "string" || !selected.id.trim()) {
                assetError("ASSET_NOT_REGISTERED", "Palette transfer requires registered backgrounds with explicit IDs.");
            }
            if (snapshot.inventory.assets.filter((asset) => asset.id === selected.id).length !== 1) {
                assetError("ASSET_NOT_FOUND", "A palette transfer background ID must be unique, even when selecting by path.");
            }
            return selected;
        };
        const source = select(input.copyTileColorsFrom);
        const target = select(input.assetId, expectedPath);
        if (source.id === target.id || source.resourcePath === target.resourcePath) {
            assetError("INVALID_INPUT", "Palette transfer requires a different source background.");
        }
        const readBackground = async (asset) => {
            if (!asset.hasMetadata || !asset.metadataPath || typeof asset.id !== "string" || !asset.id.trim()) {
                assetError("ASSET_NOT_REGISTERED", "Palette transfer requires registered backgrounds with explicit IDs.");
            }
            const handle = await open(await resolveProjectPath(root, asset.metadataPath, { mustExist: true }), "r");
            let bytes;
            try {
                const info = await handle.stat();
                if (!info.isFile() || info.size > 2 * 1024 * 1024)
                    assetError("INVALID_RESOURCE", "Background metadata must be a regular file no larger than 2 MiB.");
                // A fixed read also bounds a file that grows after stat.
                const buffer = Buffer.alloc(2 * 1024 * 1024 + 1);
                let length = 0;
                while (length < buffer.length) {
                    const part = await handle.read(buffer, length, buffer.length - length, length);
                    if (part.bytesRead === 0)
                        break;
                    length += part.bytesRead;
                }
                if (length > 2 * 1024 * 1024)
                    assetError("INVALID_RESOURCE", "Background metadata exceeds 2 MiB.");
                bytes = buffer.subarray(0, length);
            }
            finally {
                await handle.close();
            }
            const metadata = JSON.parse(bytes.toString("utf8"));
            if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata))
                assetError("INVALID_RESOURCE", "Background metadata must be an object.");
            const data = metadata;
            if (data._resourceType !== "background" || data.id !== asset.id || data.autoColor !== false) {
                assetError("INVALID_INPUT", "Palette transfer requires two registered manual-color backgrounds.");
            }
            const png = await readBoundedPng(root, asset.resourcePath);
            validateBackgroundPng(png.image, false);
            if (data.imageWidth !== png.image.width || data.imageHeight !== png.image.height
                || data.width !== png.image.width / 8 || data.height !== png.image.height / 8) {
                assetError("INVALID_TILE_COLOR_GRID", "Background metadata dimensions must match the actual PNG.");
            }
            if (typeof data.tileColors !== "string")
                assetError("INVALID_TILE_COLOR_GRID", "Background tileColors must be an encoded string.");
            return { asset, bytes, data, png };
        };
        const from = await readBackground(source), to = await readBackground(target);
        if (from.png.image.width !== to.png.image.width || from.png.image.height !== to.png.image.height) {
            assetError("INVALID_TILE_COLOR_GRID", "Palette transfer requires equal image and tile dimensions.");
        }
        const grid = decodeBackgroundPaletteTiles(from.data, from.png.image.width * from.png.image.height / 64);
        if (to.data.tileColors !== "" && to.data.tileColors !== from.data.tileColors) {
            assetError("TILE_COLORS_ALREADY_SET", "Destination palette assignments are already set; palette transfer only initializes empty metadata.");
        }
        const updated = { ...to.data, tileColors: from.data.tileColors };
        return {
            files: [
                { relativePath: source.resourcePath, before: from.png.bytes, after: from.png.bytes },
                { relativePath: source.metadataPath, before: from.bytes, after: from.bytes },
                { relativePath: target.resourcePath, before: to.png.bytes, after: to.png.bytes },
                { relativePath: target.metadataPath, before: to.bytes, after: to.data.tileColors === from.data.tileColors ? to.bytes : updated },
            ],
            value: { ...assetResult(updated, target.resourcePath), tileColors: {
                    copiedFrom: source.id, tiles: grid.length, uiTiles: grid.filter((cell) => (cell & 7) === 7).length,
                } },
        };
    }, access);
    return { ...value, ...transaction };
}
export async function deleteAsset(projectRoot, input, access) {
    const root = await assertDistributedProject(projectRoot, access);
    if (access)
        await access.strongRefresh();
    const loaded = await findAssetMetadata(root, input, access);
    if (loaded.metadata._resourceType !== "background" && loaded.metadata._resourceType !== "sprite") {
        assetError("UNSUPPORTED_ASSET_KIND", "Only registered background and sprite assets can be deleted.");
    }
    const id = String(loaded.metadata.id);
    let inUse;
    if (access) {
        const identity = { type: "asset", id, resourcePath: loaded.metadataPath };
        inUse =
            !access.coverage.complete ||
                access.assetUsers(id).length > 0 ||
                access.structuralReferences(identity).some((reference) => reference.owner.resourcePath !== loaded.metadataPath);
    }
    else {
        const inventory = await inventoryProject(loaded.projectRoot);
        const usedByScene = inventory.scenes.some((scene) => scene.backgroundId === id);
        const usedByActor = inventory.actors.some((actor) => actor.spriteSheetId === id);
        const playerSprites = inventory.settings.defaultPlayerSprites;
        const usedByPlayer = typeof playerSprites === "object" &&
            playerSprites !== null &&
            !Array.isArray(playerSprites) &&
            Object.values(playerSprites).includes(id);
        inUse = usedByScene || usedByActor || usedByPlayer;
    }
    if (inUse) {
        assetError("ASSET_IN_USE", `Asset ${id} is still referenced by a scene, actor, or player setting.`);
    }
    const png = await resolveProjectPath(loaded.projectRoot, loaded.assetPath, { mustExist: true });
    const sidecar = await resolveProjectPath(loaded.projectRoot, loaded.metadataPath, { mustExist: true });
    const suffix = `.deleting.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
    const temporaryPng = `${png}${suffix}`;
    const temporarySidecar = `${sidecar}${suffix}`;
    await rename(png, temporaryPng);
    try {
        await rename(sidecar, temporarySidecar);
    }
    catch (error) {
        await rename(temporaryPng, png);
        throw error;
    }
    await Promise.all([rm(temporaryPng), rm(temporarySidecar)]);
    return { ...assetResult(loaded.metadata, loaded.assetPath), deleted: true };
}
//# sourceMappingURL=assets.js.map