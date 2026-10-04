import { createHash, randomUUID } from "node:crypto";
import { constants, openAsBlob } from "node:fs";
import { link, lstat, mkdir, open, realpath, unlink } from "node:fs/promises";
import { PNG } from "pngjs";
import { assertSafePlatformPath, isPathWithinRoot, platformPath } from "./platform.js";
export const MAX_PREVIEW_SCREENSHOT_BYTES = 8 * 1024 * 1024;
export const MAX_PREVIEW_VIDEO_BYTES = 128 * 1024 * 1024;
export const MAX_PREVIEW_CAPTURE_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_HEADER_BYTES = 4096;
const CAPTURE_ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const FORMAT = "modretro-preview-capture";
const PHYSICAL_FORMAT = "modretro-physical-capture";
function physical(identity) { return "source" in identity; }
export class PreviewCaptureStoreError extends Error {
    code;
    partial;
    constructor(code, message, partial, options) {
        super(message, options);
        this.code = code;
        this.partial = partial;
        this.name = "PreviewCaptureStoreError";
    }
}
function fail(code, message) { throw new PreviewCaptureStoreError(code, message); }
function unsafe() { fail("UNSAFE_PATH", "The capture path is not a stable, owned, canonical file or directory."); }
function isError(error, code) { return error?.code === code; }
function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino; }
function sameVersion(a, b) { return sameFile(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }
function owned(stat) { return !process.getuid || stat.uid === process.getuid(); }
function hash(value) { return createHash("sha256").update(value).digest("hex"); }
function buildIdentity(value) {
    if (!value || typeof value.romSha256 !== "string" || !SHA256.test(value.romSha256.toLowerCase())
        || typeof value.runtimeSha256 !== "string" || !SHA256.test(value.runtimeSha256.toLowerCase())
        || typeof value.sourceRevision !== "string" || !value.sourceRevision.trim() || value.sourceRevision.length > 1024
        || !Number.isInteger(value.cartridgeType) || value.cartridgeType < 0 || value.cartridgeType > 255) {
        fail("INVALID_IDENTITY", "Captures require the exact ROM, runtime, source revision, and cartridge type.");
    }
    return { romSha256: value.romSha256.toLowerCase(), runtimeSha256: value.runtimeSha256.toLowerCase(), sourceRevision: value.sourceRevision, cartridgeType: value.cartridgeType };
}
function captureIdentity(value) {
    if (value && physical(value)) {
        if (value.source !== "physical-uvc" || !CAPTURE_ID.test(value.sessionId) || !Number.isSafeInteger(value.generation) || value.generation < 0) {
            fail("INVALID_IDENTITY", "Physical captures require a local session and selection generation.");
        }
        return { source: "physical-uvc", sessionId: value.sessionId, generation: value.generation };
    }
    return buildIdentity(value);
}
function mediaType(kind, value) {
    if (typeof value !== "string" || value.length > 200)
        fail("INVALID_MEDIA", "Unsupported capture MIME type.");
    const mimeType = value.trim().toLowerCase();
    if (kind === "screenshot" && mimeType === "image/png")
        return { mimeType, extension: "png", limit: MAX_PREVIEW_SCREENSHOT_BYTES };
    const video = /^(video\/(webm|mp4))(?:;\s*codecs=(?:"[a-z0-9., _-]+"|[a-z0-9.,_-]+))?$/.exec(mimeType);
    if (kind === "video" && video)
        return { mimeType, extension: video[2], limit: MAX_PREVIEW_VIDEO_BYTES };
    return fail("INVALID_MEDIA", "Captures must be PNG screenshots or WebM/MP4 videos.");
}
function dimensions(width, height) {
    return Number.isInteger(width) && Number.isInteger(height) && Number(width) > 0 && Number(height) > 0
        && Number(width) <= 4096 && Number(height) <= 4096 && Number(width) * Number(height) <= 4_194_304;
}
function validateHeader(kind, extension, header, size, metadata) {
    if (kind === "screenshot") {
        if (size < 45 || header.length < 33 || !header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            || header.readUInt32BE(8) !== 13 || header.toString("ascii", 12, 16) !== "IHDR")
            fail("INVALID_MEDIA", "The screenshot is not a PNG image.");
        const width = header.readUInt32BE(16), height = header.readUInt32BE(20);
        if (!dimensions(width, height) || (metadata.width !== undefined && (metadata.width !== width || metadata.height !== height))) {
            fail("INVALID_MEDIA", "The PNG dimensions are invalid or differ from its metadata.");
        }
        // Canvas PNGs are non-interlaced. Check this before decoding: pngjs bounds
        // its non-interlaced inflate by dimensions, but not its interlaced inflate.
        if (header[24] > 8 || header[26] !== 0 || header[27] !== 0 || header[28] !== 0)
            fail("INVALID_MEDIA", "The screenshot must be a non-interlaced PNG with at most 8 bits per channel.");
    }
    else if (extension === "webm") {
        if (header.length < 12 || header.readUInt32BE(0) !== 0x1a45dfa3)
            fail("INVALID_MEDIA", "The recording is not a WebM file.");
        // Inspect only the bounded EBML header, not encoded frame data. Incomplete
        // media tails from interrupted recording remain useful and are preserved.
        const vint = (offset) => {
            const first = header[offset];
            if (!first)
                fail("INVALID_MEDIA", "The WebM header is invalid.");
            let length = 1;
            while (length <= 8 && !(first & (0x80 >> (length - 1))))
                length++;
            if (length > 8 || offset + length > header.length)
                fail("INVALID_MEDIA", "The WebM header is invalid.");
            let value = first & ((0x80 >> (length - 1)) - 1);
            for (let index = 1; index < length; index++)
                value = value * 256 + header[offset + index];
            if (!Number.isSafeInteger(value))
                fail("INVALID_MEDIA", "The WebM header is too large.");
            return { value, end: offset + length };
        };
        const root = vint(4), end = root.end + root.value;
        if (end > header.length)
            fail("INVALID_MEDIA", "The WebM header exceeds its supported size.");
        let found = false;
        for (let offset = root.end; offset < end;) {
            const first = header[offset];
            let idLength = 1;
            while (idLength <= 4 && !(first & (0x80 >> (idLength - 1))))
                idLength++;
            if (idLength > 4 || offset + idLength > end)
                fail("INVALID_MEDIA", "The WebM header is invalid.");
            const id = header.subarray(offset, offset + idLength).toString("hex");
            const item = vint(offset + idLength);
            if (item.end + item.value > end)
                fail("INVALID_MEDIA", "The WebM header is invalid.");
            if (id === "4282")
                found = header.toString("ascii", item.end, item.end + item.value) === "webm";
            offset = item.end + item.value;
        }
        if (!found)
            fail("INVALID_MEDIA", "The recording has no WebM document type.");
    }
    else {
        if (header.length < 16 || header.toString("ascii", 4, 8) !== "ftyp")
            fail("INVALID_MEDIA", "The recording is not an MP4 file.");
        const size = header.readUInt32BE(0);
        if (size < 16 || size > header.length || size % 4 !== 0)
            fail("INVALID_MEDIA", "The MP4 header is invalid.");
        const brands = [header.toString("ascii", 8, 12)];
        for (let offset = 16; offset < size; offset += 4)
            brands.push(header.toString("ascii", offset, offset + 4));
        if (!brands.some(brand => /^(?:isom|iso[2-9]|mp4[12]|avc1|av01|dash|M4V |MSNV|cmf[cs])$/.test(brand)))
            fail("INVALID_MEDIA", "Unsupported MP4 file type.");
    }
}
export function validatePng(bytes, metadata) {
    if (bytes.length > MAX_PREVIEW_SCREENSHOT_BYTES)
        fail("TOO_LARGE", "The PNG screenshot exceeds 8 MiB.");
    validateHeader("screenshot", "png", bytes.subarray(0, MAX_HEADER_BYTES), bytes.length, metadata);
    let palette = false, data = false, ended = false, count = 0;
    for (let offset = 8; offset < bytes.length;) {
        if (++count > 4096 || offset + 12 > bytes.length)
            fail("INVALID_MEDIA", "The PNG chunks are incomplete or too numerous.");
        const size = bytes.readUInt32BE(offset), type = bytes.toString("ascii", offset + 4, offset + 8), end = offset + size + 12;
        if (end > bytes.length || (type === "IHDR" && offset !== 8))
            fail("INVALID_MEDIA", "The PNG chunk layout is invalid.");
        if (type === "PLTE") {
            if (palette || data || size > 768 || size % 3 !== 0)
                fail("INVALID_MEDIA", "The PNG palette is invalid.");
            palette = true;
        }
        if (type === "tRNS" && size > 256)
            fail("INVALID_MEDIA", "The PNG transparency palette is too large.");
        if (type === "IDAT")
            data = true;
        if (type === "IEND") {
            if (!data || size !== 0 || end !== bytes.length)
                fail("INVALID_MEDIA", "The PNG ending is invalid.");
            ended = true;
        }
        offset = end;
    }
    if (!ended)
        fail("INVALID_MEDIA", "The PNG screenshot has no complete ending.");
    try {
        PNG.sync.read(bytes, { checkCRC: true });
    }
    catch {
        fail("INVALID_MEDIA", "The PNG screenshot is incomplete or corrupt.");
    }
}
/** Snapshot plain JSON without invoking getters/toJSON or accepting lossy values. */
function metadataSnapshot(value) {
    let nodes = 0, textSize = 0;
    const active = new Set();
    const visit = (item, depth) => {
        if (++nodes > 100_000 || depth > 32)
            fail("INVALID_METADATA", "Capture metadata is too complex.");
        if (item === null || typeof item === "boolean")
            return;
        if (typeof item === "string") {
            textSize += Buffer.byteLength(item);
            if (textSize > MAX_PREVIEW_CAPTURE_METADATA_BYTES)
                fail("TOO_LARGE", "Capture metadata exceeds 2 MiB.");
            return;
        }
        if (typeof item === "number" && Number.isFinite(item))
            return;
        if (!item || typeof item !== "object" || active.has(item)
            || (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null))
            fail("INVALID_METADATA", "Capture metadata must contain plain JSON values.");
        active.add(item);
        const keys = Object.keys(item);
        if (Object.getOwnPropertySymbols(item).length
            || Object.getOwnPropertyNames(item).length !== keys.length + (Array.isArray(item) ? 1 : 0)
            || (Array.isArray(item) && (keys.length !== item.length || keys.some((key, index) => key !== String(index)))))
            fail("INVALID_METADATA", "Capture metadata must contain plain JSON values.");
        for (const key of keys) {
            const property = Object.getOwnPropertyDescriptor(item, key);
            if (!("value" in property))
                fail("INVALID_METADATA", "Capture metadata cannot contain accessors.");
            textSize += Buffer.byteLength(key);
            if (textSize > MAX_PREVIEW_CAPTURE_METADATA_BYTES)
                fail("TOO_LARGE", "Capture metadata exceeds 2 MiB.");
            visit(property.value, depth + 1);
        }
        active.delete(item);
    };
    if (!value || typeof value !== "object" || Array.isArray(value))
        fail("INVALID_METADATA", "Capture metadata must be a JSON object.");
    visit(value, 0);
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > MAX_PREVIEW_CAPTURE_METADATA_BYTES)
        fail("TOO_LARGE", "Capture metadata exceeds 2 MiB.");
    return JSON.parse(text);
}
/**
 * Permanent local captures, outside the project's authored revision inputs.
 * Paths/inodes are checked around I/O and publication is exclusive. Node has
 * no portable openat/linkat API: this cannot atomically prevent a hostile
 * ancestor rename. The project directory must stay under the caller's control.
 */
export class PreviewCaptureStore {
    root;
    directory;
    identity;
    platform;
    paths;
    directoryPins = new Map();
    filePins = new Map();
    videoUploads = new Map();
    /** Ordered, bounded physical-video chunks. Duplicate identical receipts never append twice. */
    async appendVideo(id, sequence, mimeType, bytes) {
        if (!physical(this.identity) || !CAPTURE_ID.test(id) || !Number.isInteger(sequence) || sequence < 0 || sequence >= 2048
            || !bytes.byteLength || bytes.byteLength > 8 * 1024 * 1024)
            fail("INVALID_MEDIA", "Invalid physical-video chunk.");
        const type = mediaType("video", mimeType);
        bytes = Buffer.from(bytes);
        let upload = this.videoUploads.get(id);
        if (!upload) {
            if (sequence !== 0 || this.videoUploads.size >= 32)
                fail("INVALID_MEDIA", "Video must begin with chunk zero within the session limit.");
            // Insert before yielding so a second writer cannot race exclusive creation.
            const file = { path: this.paths.join(this.directory, `.${id}.video.tmp`), final: "", published: false };
            upload = { file, directories: [], mimeType: type.mimeType, bytes: 0, hashes: [], busy: true, sealed: false };
            this.videoUploads.set(id, upload);
            try {
                upload.directories = (await this.directories(true));
                await this.createTemporary(file, upload.directories);
            }
            catch (error) {
                upload.sealed = true;
                throw error;
            }
            finally {
                upload.busy = false;
            }
        }
        if (upload.busy || upload.sealed || upload.mimeType !== type.mimeType)
            fail("INVALID_MEDIA", "Video upload is busy, sealed, or has a different MIME type.");
        const digest = hash(bytes);
        if (sequence < upload.hashes.length) {
            if (upload.hashes[sequence] !== digest)
                fail("INVALID_MEDIA", "A repeated video chunk has different bytes.");
            return { bytes: upload.bytes, chunks: upload.hashes.length, path: upload.file.path, duplicate: true };
        }
        if (sequence !== upload.hashes.length || upload.bytes + bytes.byteLength > MAX_PREVIEW_VIDEO_BYTES)
            fail("TOO_LARGE", "Video chunks are out of order or exceed 128 MiB.");
        upload.busy = true;
        try {
            await this.checkDirectories(upload.directories);
            await this.namedFile(upload.file.path, upload.file.stat);
            await upload.file.handle.writeFile(bytes);
            upload.bytes += bytes.byteLength;
            await this.finishTemporary(upload.file, upload.bytes, upload.directories);
            upload.hashes.push(digest);
            return { bytes: upload.bytes, chunks: upload.hashes.length, path: upload.file.path, duplicate: false };
        }
        catch (error) {
            upload.sealed = true;
            throw error;
        }
        finally {
            upload.busy = false;
        }
    }
    async finishVideo(id, metadata) {
        const upload = this.videoUploads.get(id);
        if (!upload)
            fail("INVALID_ID", "No video chunks were received.");
        if (upload.result)
            return upload.result;
        if (upload.finishAttempted)
            fail("SAVE_FAILED", "Video finalization was already attempted; inspect its original receipt and retained temporary file.");
        if (upload.busy)
            fail("INVALID_MEDIA", "A video chunk is still being written.");
        upload.busy = true;
        upload.sealed = true;
        upload.finishAttempted = true;
        try {
            await this.checkDirectories(upload.directories);
            if (upload.file.handle) {
                await upload.file.handle.close();
                upload.file.handle = undefined;
            }
            const before = await this.namedFile(upload.file.path, upload.file.stat);
            if (before.size !== upload.bytes)
                unsafe();
            // openAsBlob is disk-backed; save() reads a bounded stream, not a whole video Buffer.
            const media = await openAsBlob(upload.file.path, { type: upload.mimeType });
            const result = await this.save({ kind: "video", mimeType: upload.mimeType, media, metadata: { ...metadata, bytes: upload.bytes, mimeType: upload.mimeType } });
            upload.result = result;
            try {
                if (!sameVersion(before, await this.namedFile(upload.file.path, upload.file.stat)))
                    unsafe();
                await this.removeVideoSpool(upload.file, upload.directories);
            }
            catch {
                result.cleanupWarning = `Recording published; temporary cleanup is unconfirmed: ${upload.file.path}`;
            }
            return result;
        }
        finally {
            upload.busy = false;
        }
    }
    async removeVideoSpool(file, directories) {
        await this.checkDirectories(directories);
        await unlink(file.path);
    }
    videoPartial(id) {
        const upload = this.videoUploads.get(id);
        return upload ? { path: upload.file.path, bytes: upload.bytes, chunks: upload.hashes.length } : undefined;
    }
    async closeVideoUploads() {
        for (const upload of this.videoUploads.values()) {
            upload.sealed = true;
            if (upload.file.handle) {
                await upload.file.handle.close();
                upload.file.handle = undefined;
            }
        }
    }
    constructor(options) {
        this.platform = options.platform ?? process.platform;
        assertSafePlatformPath(options.projectRoot, this.platform);
        this.paths = platformPath(options.projectRoot, this.platform);
        if (!this.paths.isAbsolute(options.projectRoot))
            unsafe();
        this.root = this.paths.resolve(options.projectRoot);
        this.identity = captureIdentity(options.identity);
        this.directory = this.paths.join(this.root, "captures", hash(JSON.stringify(this.identity)));
    }
    async save(input) {
        const type = mediaType(input.kind, input.mimeType);
        if (!(input.media instanceof Blob) && !(input.media instanceof Uint8Array))
            fail("INVALID_MEDIA", "Capture media must be a Blob or byte array.");
        const size = input.media instanceof Blob ? input.media.size : input.media.byteLength;
        if (!Number.isSafeInteger(size) || size < 1)
            fail("INVALID_MEDIA", "Capture media is empty or invalid.");
        if (size > type.limit)
            fail("TOO_LARGE", "Capture media exceeds its supported size.");
        const blob = input.media instanceof Blob ? input.media : new Blob([Buffer.from(input.media)]);
        if (blob.type && mediaType(input.kind, blob.type).mimeType !== type.mimeType)
            fail("INVALID_MEDIA", "Capture MIME types differ.");
        const metadata = metadataSnapshot(input.metadata);
        this.checkMetadata(metadata, input.kind, type.mimeType, size);
        const header = Buffer.from(await blob.slice(0, MAX_HEADER_BYTES).arrayBuffer());
        validateHeader(input.kind, type.extension, header, size, metadata);
        if (input.kind === "screenshot")
            validatePng(Buffer.from(await blob.arrayBuffer()), metadata);
        const id = randomUUID(), createdAt = new Date().toISOString();
        const record = { id, kind: input.kind, mimeType: type.mimeType, bytes: size, sha256: "0".repeat(64), createdAt,
            path: this.paths.join(this.directory, `${id}.${type.extension}`), metadataPath: this.paths.join(this.directory, `${id}.json`) };
        const document = () => JSON.stringify({ format: physical(this.identity) ? PHYSICAL_FORMAT : FORMAT, version: 1, id, kind: record.kind, mimeType: record.mimeType,
            bytes: size, sha256: record.sha256, createdAt, identity: this.identity, metadata }) + "\n";
        if (Buffer.byteLength(document()) > MAX_PREVIEW_CAPTURE_METADATA_BYTES)
            fail("TOO_LARGE", "Capture metadata including its identity exceeds 2 MiB.");
        const directories = (await this.directories(true));
        const media = { path: this.paths.join(this.directory, `.${id}.media.tmp`), final: record.path, published: false };
        const sidecar = { path: this.paths.join(this.directory, `.${id}.metadata.tmp`), final: record.metadataPath, published: false };
        const files = [media, sidecar];
        let failure, publicationAttempted = false;
        try {
            await this.createTemporary(media, directories);
            const digest = createHash("sha256");
            let written = 0, prefix = Buffer.alloc(0);
            const reader = blob.stream().getReader();
            try {
                while (true) {
                    const { done, value: chunk } = await reader.read();
                    if (done)
                        break;
                    if (!(chunk instanceof Uint8Array) || written + chunk.byteLength > size || written + chunk.byteLength > type.limit)
                        fail("TOO_LARGE", "Capture bytes exceeded their declared size.");
                    if (prefix.length < MAX_HEADER_BYTES)
                        prefix = Buffer.concat([prefix, chunk.subarray(0, MAX_HEADER_BYTES - prefix.length)]);
                    digest.update(chunk);
                    await media.handle.writeFile(chunk);
                    written += chunk.byteLength;
                }
            }
            catch (error) {
                await reader.cancel().catch(() => { });
                throw error;
            }
            finally {
                reader.releaseLock();
            }
            if (written !== size || !prefix.equals(header))
                fail("INVALID_MEDIA", "Capture bytes changed while being saved.");
            record.sha256 = digest.digest("hex");
            await this.finishTemporary(media, size, directories);
            await this.createTemporary(sidecar, directories);
            const text = document();
            await sidecar.handle.writeFile(text, "utf8");
            await this.finishTemporary(sidecar, Buffer.byteLength(text), directories);
            for (const file of files) {
                await this.checkDirectories(directories);
                if (!sameVersion(await this.namedFile(file.path, file.stat), file.stat))
                    unsafe();
                publicationAttempted = true;
                await link(file.path, file.final);
                file.published = true;
                const published = await this.namedFile(file.final, file.stat, 2);
                if (published.size !== file.stat.size || published.mtimeMs !== file.stat.mtimeMs)
                    unsafe();
            }
            await this.checkDirectories(directories);
        }
        catch (error) {
            failure = error;
        }
        // A failed write/close/cleanup never removes a published capture. Close all
        // descriptors even if another close or the subsequent path check fails.
        for (const file of files) {
            if (file.handle)
                try {
                    await file.handle.close();
                }
                catch (error) {
                    failure ??= error;
                }
        }
        const temporaryPaths = [];
        for (const file of files) {
            if (!file.stat)
                continue;
            try {
                await this.checkDirectories(directories);
                await this.namedFile(file.path, file.stat, file.published ? 2 : 1);
                await unlink(file.path);
            }
            catch (error) {
                if (!isError(error, "ENOENT")) {
                    failure ??= error;
                    temporaryPaths.push(file.path);
                }
            }
        }
        if (!failure)
            try {
                for (const file of files)
                    this.filePins.set(file.final, await this.namedFile(file.final, file.stat));
                await this.checkDirectories(directories);
                if (this.platform !== "win32") {
                    const parent = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
                    try {
                        if (!sameFile(await parent.stat(), directories.at(-1).stat))
                            unsafe();
                        await parent.sync();
                    }
                    finally {
                        await parent.close();
                    }
                }
            }
            catch (error) {
                failure = error;
            }
        if (failure) {
            const partial = { id, path: record.path, metadataPath: record.metadataPath, mediaPublished: media.published,
                metadataPublished: sidecar.published, publicationAttempted, temporaryPaths };
            throw new PreviewCaptureStoreError("SAVE_FAILED", publicationAttempted
                ? "Capture saving did not finish; some capture files may already be saved. Keep the original media before retrying."
                : temporaryPaths.length ? "Capture saving failed; incomplete temporary files were retained." : "Capture saving failed before publication.", partial, { cause: failure });
        }
        return record;
    }
    async open(id, part = "media") {
        if (typeof id !== "string" || !CAPTURE_ID.test(id))
            fail("INVALID_ID", "A capture ID must be a generated lowercase UUID.");
        if (part !== "media" && part !== "metadata")
            fail("INVALID_ID", "Unknown capture part.");
        const directories = await this.directories(false);
        if (!directories)
            return null;
        const metadataPath = this.paths.join(this.directory, `${id}.json`);
        let sidecar;
        try {
            sidecar = await this.openVerified(metadataPath, MAX_PREVIEW_CAPTURE_METADATA_BYTES, directories, true);
        }
        catch (error) {
            if (isError(error, "ENOENT"))
                return null;
            throw error;
        }
        let record, metadata;
        try {
            let value;
            try {
                value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(sidecar.content));
            }
            catch {
                fail("CORRUPT_FILE", "The capture metadata is invalid JSON.");
            }
            if (!value || value.format !== (physical(this.identity) ? PHYSICAL_FORMAT : FORMAT) || value.version !== 1 || value.id !== id
                || typeof value.sha256 !== "string" || !SHA256.test(value.sha256)
                || typeof value.createdAt !== "string" || value.createdAt.length > 32 || !Number.isFinite(Date.parse(value.createdAt))
                || new Date(value.createdAt).toISOString() !== value.createdAt
                || JSON.stringify(captureIdentity(value.identity)) !== JSON.stringify(this.identity))
                fail("CORRUPT_FILE", "The capture metadata or source identity is invalid.");
            const type = mediaType(value.kind, value.mimeType);
            if (!Number.isSafeInteger(value.bytes) || value.bytes < 1 || value.bytes > type.limit)
                fail("CORRUPT_FILE", "The capture size is invalid.");
            metadata = metadataSnapshot(value.metadata);
            this.checkMetadata(metadata, value.kind, type.mimeType, value.bytes);
            record = { id, kind: value.kind, mimeType: type.mimeType, bytes: value.bytes, sha256: value.sha256, createdAt: value.createdAt,
                path: this.paths.join(this.directory, `${id}.${type.extension}`), metadataPath };
        }
        catch (error) {
            await sidecar.handle.close();
            throw error;
        }
        if (part === "metadata")
            return { record, handle: sidecar.handle, bytes: sidecar.bytes, sha256: sidecar.sha256, mimeType: "application/json" };
        await sidecar.handle.close();
        const type = mediaType(record.kind, record.mimeType);
        const media = await this.openVerified(record.path, type.limit, directories, record.kind === "screenshot");
        try {
            if (media.bytes !== record.bytes || media.sha256 !== record.sha256)
                fail("CORRUPT_FILE", "The saved capture differs from its metadata.");
            validateHeader(record.kind, type.extension, media.header, media.bytes, metadata);
            if (record.kind === "screenshot")
                validatePng(media.content, metadata);
            return { record, handle: media.handle, bytes: media.bytes, sha256: media.sha256, mimeType: record.mimeType };
        }
        catch (error) {
            await media.handle.close();
            throw error;
        }
    }
    async read(id, part = "media") {
        const file = await this.open(id, part);
        if (!file)
            return null;
        try {
            const bytes = Buffer.alloc(file.bytes);
            let offset = 0;
            while (offset < bytes.length) {
                const read = await file.handle.read(bytes, offset, bytes.length - offset, offset);
                if (!read.bytesRead)
                    fail("CORRUPT_FILE", "The saved capture became incomplete.");
                offset += read.bytesRead;
            }
            if (hash(bytes) !== file.sha256)
                fail("CORRUPT_FILE", "The saved capture changed while being read.");
            const filename = part === "media" ? file.record.path : file.record.metadataPath;
            if (!sameVersion(await file.handle.stat(), await this.namedFile(filename, this.filePins.get(filename))))
                unsafe();
            await this.directories(false);
            return { record: file.record, bytes, mimeType: file.mimeType, sha256: file.sha256 };
        }
        finally {
            await file.handle.close();
        }
    }
    checkMetadata(metadata, kind, mimeType, size) {
        if ((metadata.bytes !== undefined && metadata.bytes !== size)
            || (metadata.mimeType !== undefined && (typeof metadata.mimeType !== "string" || mediaType(kind, metadata.mimeType).mimeType !== mimeType))
            || ((metadata.width !== undefined || metadata.height !== undefined) && !dimensions(metadata.width, metadata.height)))
            fail("INVALID_METADATA", "Capture metadata does not match the media.");
        if (physical(this.identity)) {
            if (metadata.game !== undefined || metadata.romSha256 !== undefined || metadata.runtimeSha256 !== undefined
                || metadata.source !== "physical-uvc" || metadata.sessionId !== this.identity.sessionId
                || metadata.generation !== this.identity.generation)
                fail("INVALID_METADATA", "Physical captures require their local session, without a game-build identity.");
            return;
        }
        if (metadata.game !== undefined) {
            if (!metadata.game || typeof metadata.game !== "object" || Array.isArray(metadata.game))
                fail("INVALID_METADATA", "Invalid capture game identity.");
            const game = metadata.game;
            for (const key of ["romSha256", "runtimeSha256", "sourceRevision", "cartridgeType"]) {
                const actual = game[key];
                if (actual !== undefined && (key === "romSha256" || key === "runtimeSha256" ? typeof actual !== "string" || actual.toLowerCase() !== this.identity[key] : actual !== this.identity[key])) {
                    fail("INVALID_METADATA", "The capture belongs to a different game build.");
                }
            }
        }
    }
    matches(a, b) { return this.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b; }
    async directoryStat(filename, expected) {
        const before = await lstat(filename);
        if (before.isSymbolicLink() || !before.isDirectory() || !owned(before))
            unsafe();
        const canonical = await realpath(filename), after = await lstat(filename);
        if (!this.matches(canonical, filename) || !sameFile(before, after) || (expected && !sameFile(expected, after)))
            unsafe();
        return after;
    }
    async checkDirectories(directories) {
        for (const directory of directories)
            await this.directoryStat(directory.path, directory.stat);
    }
    async directories(create) {
        const directories = [];
        for (const filename of [this.root, this.paths.dirname(this.directory), this.directory]) {
            if (!isPathWithinRoot(this.root, filename, this.platform))
                unsafe();
            await this.checkDirectories(directories);
            const expected = this.directoryPins.get(filename);
            let stat;
            try {
                stat = await this.directoryStat(filename, expected);
            }
            catch (error) {
                if (!isError(error, "ENOENT"))
                    throw error;
                if (expected)
                    unsafe();
                if (filename === this.root)
                    unsafe();
                if (!create)
                    return null;
                await mkdir(filename, { mode: 0o700 }).catch(error => { if (!isError(error, "EEXIST"))
                    throw error; });
                stat = await this.directoryStat(filename);
            }
            this.directoryPins.set(filename, stat);
            directories.push({ path: filename, stat });
        }
        await this.checkDirectories(directories);
        return directories;
    }
    async namedFile(filename, expected, links = 1) {
        const before = await lstat(filename);
        if (!before.isFile() || before.isSymbolicLink() || !owned(before) || before.nlink !== links
            || !isPathWithinRoot(this.directory, filename, this.platform) || !this.matches(await realpath(filename), filename))
            unsafe();
        const after = await lstat(filename);
        if (!sameVersion(before, after) || (expected && !sameFile(expected, after)) || after.nlink !== links)
            unsafe();
        return after;
    }
    async createTemporary(file, directories) {
        await this.checkDirectories(directories);
        file.handle = await open(file.path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (this.platform === "win32" ? 0 : constants.O_NOFOLLOW), 0o600);
        file.stat = await file.handle.stat();
        await this.namedFile(file.path, file.stat);
        await this.checkDirectories(directories);
    }
    async finishTemporary(file, size, directories) {
        await file.handle.sync();
        const stat = await file.handle.stat();
        const named = await this.namedFile(file.path, file.stat);
        if (!sameVersion(stat, named) || stat.size !== size)
            unsafe();
        file.stat = stat;
        await this.checkDirectories(directories);
    }
    async openVerified(filename, limit, directories, retain) {
        const named = await this.namedFile(filename, this.filePins.get(filename));
        if (!Number.isSafeInteger(named.size) || named.size < 1 || named.size > limit)
            fail("CORRUPT_FILE", "The saved capture exceeds its supported size.");
        await this.checkDirectories(directories);
        const handle = await open(filename, constants.O_RDONLY | (this.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK));
        try {
            const before = await handle.stat();
            if (!sameVersion(named, before) || before.nlink !== 1 || !before.isFile() || !owned(before))
                unsafe();
            const digest = createHash("sha256"), buffer = Buffer.alloc(Math.min(64 * 1024, named.size + 1));
            const content = retain ? Buffer.alloc(named.size) : undefined;
            let total = 0, header = Buffer.alloc(0);
            while (total <= named.size) {
                const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, named.size + 1 - total), total);
                if (!bytesRead)
                    break;
                if (total + bytesRead > named.size)
                    fail("CORRUPT_FILE", "The capture changed size while being read.");
                const chunk = buffer.subarray(0, bytesRead);
                digest.update(chunk);
                if (header.length < MAX_HEADER_BYTES)
                    header = Buffer.concat([header, chunk.subarray(0, MAX_HEADER_BYTES - header.length)]);
                content?.set(chunk, total);
                total += bytesRead;
            }
            if (total !== named.size || !sameVersion(before, await handle.stat()) || !sameVersion(before, await this.namedFile(filename, before)))
                unsafe();
            await this.checkDirectories(directories);
            this.filePins.set(filename, before);
            return { handle, bytes: total, sha256: digest.digest("hex"), header, content };
        }
        catch (error) {
            await handle.close();
            throw error;
        }
    }
}
//# sourceMappingURL=web-preview-captures.js.map