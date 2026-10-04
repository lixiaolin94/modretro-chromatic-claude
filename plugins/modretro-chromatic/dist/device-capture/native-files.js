import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { NATIVE_LIMITS } from "./native-protocol.js";
import { validateNativeJpeg } from "./native-jpeg.js";
function same(a, b) { return a.dev === b.dev && a.ino === b.ino && a.uid === b.uid; }
function owner(stat) { return process.getuid === undefined || stat.uid === process.getuid(); }
/** Reads only hash-bound artifacts from one pinned native helper directory. Never accepts caller paths. */
export class NativeCaptureFiles {
    directory;
    identity;
    constructor(directory, identity) {
        this.directory = directory;
        this.identity = identity;
    }
    static async create(directory) {
        if (!path.isAbsolute(directory) || path.resolve(directory) !== directory || await realpath(directory) !== directory)
            throw new Error("Native capture directory is not canonical.");
        const temporaryRoot = await realpath(os.tmpdir());
        if (path.dirname(directory) !== temporaryRoot || !/^chromatic-native-capture-[A-Za-z0-9-]+$/.test(path.basename(directory)))
            throw new Error("Native capture directory must be a generated session under the local temporary directory.");
        const stat = await lstat(directory);
        if (!stat.isDirectory() || !owner(stat) || (stat.mode & 0o777) !== 0o700)
            throw new Error("Native capture directory must be private and owned by this user.");
        return new NativeCaptureFiles(directory, stat);
    }
    async checkDirectory() {
        const stat = await lstat(this.directory);
        if (!same(stat, this.identity) || !stat.isDirectory() || (stat.mode & 0o777) !== 0o700 || await realpath(this.directory) !== this.directory)
            throw new Error("Native capture directory changed.");
    }
    async verifiedFile(artifact) {
        return this.readVerifiedFile(artifact, false);
    }
    async readVerifiedFile(artifact, retainBytes) {
        if (!artifact.basename || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,104}$/.test(artifact.basename) || artifact.basename.includes("..") || !artifact.sha256 || !/^[a-f0-9]{64}$/.test(artifact.sha256)
            || !Number.isSafeInteger(artifact.bytes) || artifact.bytes < 1 || artifact.bytes > NATIVE_LIMITS.maxRecordingBytes)
            throw new Error("Invalid native artifact reference.");
        await this.checkDirectory();
        const filename = path.join(this.directory, artifact.basename);
        const named = await lstat(filename);
        if (!named.isFile() || named.nlink !== 1 || !owner(named) || (named.mode & 0o777) !== 0o600 || named.size !== artifact.bytes)
            throw new Error("Native artifact is not a private regular file of the expected size.");
        const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const before = await handle.stat();
            if (!same(before, named) || before.size !== artifact.bytes)
                throw new Error("Native artifact changed before opening.");
            const digest = createHash("sha256"), buffer = Buffer.alloc(retainBytes ? artifact.bytes : Math.min(64 * 1024, artifact.bytes));
            let offset = 0;
            while (offset < artifact.bytes) {
                const bufferOffset = retainBytes ? offset : 0;
                const { bytesRead } = await handle.read(buffer, bufferOffset, Math.min(64 * 1024, artifact.bytes - offset), offset);
                if (!bytesRead)
                    throw new Error("Native artifact ended unexpectedly.");
                digest.update(buffer.subarray(bufferOffset, bufferOffset + bytesRead));
                offset += bytesRead;
            }
            const after = await handle.stat();
            const current = await lstat(filename);
            await this.checkDirectory();
            if (!same(before, after) || !same(before, current) || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
                || !current.isFile() || current.nlink !== 1 || after.nlink !== 1 || (current.mode & 0o777) !== 0o600 || (after.mode & 0o777) !== 0o600
                || current.size !== before.size || current.mtimeMs !== before.mtimeMs || current.ctimeMs !== before.ctimeMs || digest.digest("hex") !== artifact.sha256)
                throw new Error("Native artifact changed or its checksum did not match.");
            return { handle, path: filename, bytes: artifact.bytes, ...(retainBytes ? { contents: buffer } : {}) };
        }
        catch (error) {
            await handle.close();
            throw error;
        }
    }
    async image(artifact) {
        if (artifact.bytes > (artifact.format === "png" ? NATIVE_LIMITS.maxScreenshotBytes : NATIVE_LIMITS.maxPreviewBytes))
            throw new Error("Native frame exceeds its byte limit.");
        const file = await this.readVerifiedFile(artifact, true);
        try {
            // These are the exact bytes hashed while the path, descriptor and directory
            // identities were checked. Do not reopen/reread a live preview after that check.
            const bytes = file.contents;
            if (artifact.format === "jpeg")
                validateNativeJpeg(bytes, artifact);
            return bytes;
        }
        finally {
            await file.handle.close();
        }
    }
}
/** Load fixed shipped assets without following links or trusting a size after allocation. */
export async function readBoundedCaptureAsset(filename, maximum) {
    if (await realpath(filename) !== path.resolve(filename))
        throw new Error("Capture assets must not use symbolic links.");
    const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const before = await file.stat();
        if (!before.isFile() || before.size < 1 || before.size > maximum)
            throw new Error("Capture asset exceeds its size bound.");
        const bytes = Buffer.alloc(before.size);
        let offset = 0;
        while (offset < bytes.length) {
            const read = await file.read(bytes, offset, bytes.length - offset, offset);
            if (!read.bytesRead)
                throw new Error("Capture asset changed while reading.");
            offset += read.bytesRead;
        }
        const after = await file.stat();
        if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
            throw new Error("Capture asset changed while reading.");
        return bytes;
    }
    finally {
        await file.close();
    }
}
//# sourceMappingURL=native-files.js.map