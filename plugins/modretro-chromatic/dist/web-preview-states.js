import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, opendir, realpath, unlink } from "node:fs/promises";
import { assertSafePlatformPath, isPathWithinRoot, platformPath } from "./platform.js";
import { MAX_SAVE_STATE_FILE_BYTES, parseSaveState, serializeSaveState, } from "./web-annotations/save-state.js";
export const MAX_PREVIEW_STATES = 8;
const MAX_DIRECTORY_ENTRIES = 64;
const SHA256 = /^[a-f0-9]{64}$/;
const STATE_NAME = /^([a-f0-9]{64})\.gbstate\.json$/;
const queues = new Map();
export class PreviewStateStoreError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "PreviewStateStoreError";
    }
}
function unsafe() { throw new PreviewStateStoreError("UNSAFE_PATH", "The saved-state path is not a stable, canonical regular file or directory."); }
function isError(error, code) { return error?.code === code; }
function sameFile(a, b) { return a.dev === b.dev && a.ino === b.ino; }
function sameVersion(a, b) { return sameFile(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }
function digest(text) { return createHash("sha256").update(text).digest("hex"); }
function metadata(id, file) { return { id, title: file.title, frame: file.frame, createdAt: file.createdAt }; }
function newestFirst(a, b) { return Date.parse(b.createdAt) - Date.parse(a.createdAt) || a.id.localeCompare(b.id); }
/**
 * Local rolling history, independent of the browser origin and preview port.
 * Canonical paths and inodes are checked around I/O, as in the other project
 * writers. Node has no portable openat/linkat/unlinkat API: these checks cannot
 * atomically confine pathname operations against hostile concurrent ancestor
 * renames. The project directory must remain under the caller's control.
 */
export class PreviewStateStore {
    root;
    directory;
    identity;
    platform;
    paths;
    constructor(options) {
        this.platform = options.platform ?? process.platform;
        assertSafePlatformPath(options.projectRoot, this.platform);
        this.paths = platformPath(options.projectRoot, this.platform);
        if (!this.paths.isAbsolute(options.projectRoot))
            unsafe();
        this.root = this.paths.resolve(options.projectRoot);
        const build = options.identity;
        if (!build || typeof build.romSha256 !== "string" || !SHA256.test(build.romSha256.toLowerCase())
            || typeof build.runtimeSha256 !== "string" || !SHA256.test(build.runtimeSha256.toLowerCase())
            || typeof build.sourceRevision !== "string" || !build.sourceRevision.trim() || build.sourceRevision.length > 1024
            || !Number.isInteger(build.cartridgeType) || build.cartridgeType < 0 || build.cartridgeType > 255) {
            throw new PreviewStateStoreError("INVALID_IDENTITY", "Saved states require an exact ROM, runtime, source revision, and cartridge type.");
        }
        this.identity = {
            romSha256: build.romSha256.toLowerCase(), runtimeSha256: build.runtimeSha256.toLowerCase(),
            sourceRevision: build.sourceRevision, cartridgeType: build.cartridgeType,
        };
        this.directory = this.paths.join(this.root, "save-states", digest(JSON.stringify(this.identity)));
    }
    async list() {
        return this.serialized(async () => {
            const directories = await this.directories(false);
            if (!directories)
                return [];
            return (await this.history(directories)).records.slice(0, MAX_PREVIEW_STATES).map(record => record.metadata);
        });
    }
    async latest() {
        return this.serialized(async () => {
            const directories = await this.directories(false);
            if (!directories)
                return null;
            const latest = (await this.history(directories)).latest;
            return latest ? { state: latest.metadata, text: latest.text } : null;
        });
    }
    async read(id) {
        this.checkId(id);
        return this.serialized(async () => {
            const directories = await this.directories(false);
            return directories ? (await this.readState(id, directories))?.text ?? null : null;
        });
    }
    async save(text) {
        // Validate all bounds, build identity and checksums before creating any paths.
        const { file } = await parseSaveState(text, this.identity);
        const canonical = serializeSaveState(file);
        const id = digest(canonical);
        return this.serialized(async () => {
            const directories = (await this.directories(true));
            const existing = await this.readState(id, directories);
            if (existing) {
                await this.prune(directories);
                return existing.metadata;
            }
            const entries = await this.entries(directories);
            if (entries.ids.includes(id))
                throw new PreviewStateStoreError("CORRUPT_FILE", "An existing saved-state file is corrupt and will not be overwritten.");
            if (entries.count >= MAX_DIRECTORY_ENTRIES)
                throw new PreviewStateStoreError("DIRECTORY_LIMIT", "The saved-state directory contains too many entries to add a capture safely.");
            try {
                await this.publish(id, canonical, directories);
            }
            catch (error) {
                // Another preview process may have saved the same immutable content.
                if (!isError(error, "EEXIST"))
                    throw error;
                const concurrent = await this.readState(id, directories);
                if (!concurrent)
                    throw new PreviewStateStoreError("CORRUPT_FILE", "An existing saved-state file cannot be replaced.");
            }
            // Keep previous captures until the new file has been published completely.
            await this.prune(directories);
            return metadata(id, file);
        });
    }
    checkId(id) {
        if (typeof id !== "string" || !SHA256.test(id))
            throw new PreviewStateStoreError("INVALID_ID", "A saved-state ID must contain exactly 64 lowercase hexadecimal characters.");
    }
    matches(a, b) { return this.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b; }
    async directoryStat(filename, expected) {
        const before = await lstat(filename);
        if (before.isSymbolicLink() || !before.isDirectory())
            unsafe();
        const canonical = await realpath(filename);
        const after = await lstat(filename);
        if (!this.matches(canonical, filename) || !sameFile(before, after) || (expected && !sameFile(after, expected)))
            unsafe();
        return after;
    }
    async checkDirectories(directories) {
        for (const directory of directories)
            await this.directoryStat(directory.path, directory.stat);
    }
    async directories(create) {
        const result = [{ path: this.root, stat: await this.directoryStat(this.root) }];
        for (const filename of [this.paths.dirname(this.directory), this.directory]) {
            if (!isPathWithinRoot(this.root, filename, this.platform))
                unsafe();
            await this.checkDirectories(result);
            let stat;
            try {
                stat = await this.directoryStat(filename);
            }
            catch (error) {
                if (!isError(error, "ENOENT"))
                    throw error;
                if (!create)
                    return null;
                await mkdir(filename, { mode: 0o700 }).catch(error => { if (!isError(error, "EEXIST"))
                    throw error; });
                stat = await this.directoryStat(filename);
            }
            result.push({ path: filename, stat });
        }
        await this.checkDirectories(result);
        return result;
    }
    async entries(directories) {
        await this.checkDirectories(directories);
        const result = [];
        let count = 0;
        const entries = await opendir(this.directory);
        for await (const entry of entries) {
            if (++count > MAX_DIRECTORY_ENTRIES)
                throw new PreviewStateStoreError("DIRECTORY_LIMIT", "The saved-state directory contains too many entries to inspect safely.");
            const match = STATE_NAME.exec(entry.name);
            if (!match)
                continue;
            if (!entry.isFile())
                unsafe();
            result.push(match[1]);
        }
        await this.checkDirectories(directories);
        return { ids: result, count };
    }
    async history(directories) {
        const records = [];
        let latest = null;
        for (const id of (await this.entries(directories)).ids) {
            const state = await this.readState(id, directories);
            if (!state)
                continue;
            records.push({ metadata: state.metadata, stat: state.stat });
            if (!latest || newestFirst(state.metadata, latest.metadata) < 0)
                latest = state;
        }
        records.sort((a, b) => newestFirst(a.metadata, b.metadata));
        return { records, latest };
    }
    async prune(directories) {
        const { records } = await this.history(directories);
        for (const candidate of records.slice(MAX_PREVIEW_STATES).reverse()) {
            // A link or a changed/replaced file is not ours to remove. Revalidate the
            // full payload before each deletion; metadata alone never authorizes it.
            if (candidate.stat.nlink !== 1 || (process.getuid && candidate.stat.uid !== process.getuid()))
                continue;
            const current = await this.readState(candidate.metadata.id, directories);
            if (!current || current.stat.nlink !== 1 || !sameVersion(current.stat, candidate.stat))
                continue;
            const filename = this.paths.join(this.directory, `${candidate.metadata.id}.gbstate.json`);
            await this.checkDirectories(directories);
            try {
                const named = await this.namedFile(filename);
                if (named.nlink !== 1 || !sameVersion(named, current.stat))
                    continue;
                await unlink(filename);
            }
            catch (error) {
                if (!isError(error, "ENOENT"))
                    throw error;
            }
        }
    }
    async namedFile(filename, expected) {
        const stat = await lstat(filename);
        if (stat.isSymbolicLink() || !stat.isFile() || (expected && !sameFile(stat, expected))
            || !this.matches(await realpath(filename), filename) || !isPathWithinRoot(this.directory, filename, this.platform))
            unsafe();
        return stat;
    }
    async readState(id, directories) {
        try {
            return await this.readExistingState(id, directories);
        }
        catch (error) {
            // Another preview process may prune this exact candidate at any point in
            // the read. Treat disappearance as missing without widening a prune batch.
            if (isError(error, "ENOENT"))
                return null;
            throw error;
        }
    }
    async readExistingState(id, directories) {
        const filename = this.paths.join(this.directory, `${id}.gbstate.json`);
        let named = await this.namedFile(filename);
        if (!Number.isSafeInteger(named.size) || named.size < 1 || named.size > MAX_SAVE_STATE_FILE_BYTES)
            return null;
        await this.checkDirectories(directories);
        const handle = await open(filename, constants.O_RDONLY | (this.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK));
        let text;
        try {
            const before = await handle.stat();
            if (!before.isFile() || !sameFile(named, before))
                unsafe();
            if (before.size !== named.size)
                return null;
            const bytes = Buffer.alloc(before.size + 1);
            let size = 0;
            while (size < bytes.length) {
                const { bytesRead } = await handle.read(bytes, size, bytes.length - size, size);
                if (!bytesRead)
                    break;
                size += bytesRead;
            }
            const after = await handle.stat();
            named = await this.namedFile(filename, before);
            await this.checkDirectories(directories);
            if (size !== before.size || after.size !== before.size || named.size !== before.size
                || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs
                || named.mtimeMs !== after.mtimeMs || named.ctimeMs !== after.ctimeMs)
                return null;
            try {
                text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes.subarray(0, size));
            }
            catch {
                return null;
            }
        }
        finally {
            await handle.close();
        }
        if (digest(text) !== id)
            return null;
        try {
            const { file } = await parseSaveState(text, this.identity);
            return serializeSaveState(file) === text ? { text, metadata: metadata(id, file), stat: named } : null;
        }
        catch {
            return null;
        }
    }
    async publish(id, text, directories) {
        const temporary = this.paths.join(this.directory, `.${id}.${randomUUID()}.tmp`);
        const filename = this.paths.join(this.directory, `${id}.gbstate.json`);
        await this.checkDirectories(directories);
        const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (this.platform === "win32" ? 0 : constants.O_NOFOLLOW), 0o600);
        let owned;
        try {
            owned = await handle.stat();
            await this.checkDirectories(directories);
            const named = await this.namedFile(temporary, owned);
            if (!owned.isFile() || owned.nlink !== 1 || named.nlink !== 1)
                unsafe();
            await handle.writeFile(text, "utf8");
            await handle.sync();
            await this.checkDirectories(directories);
            const written = await this.namedFile(temporary, owned);
            if (written.nlink !== 1 || written.size !== Buffer.byteLength(text))
                unsafe();
            // link() publishes complete bytes atomically and fails if the destination exists.
            await link(temporary, filename);
            await this.namedFile(filename, owned);
            await this.checkDirectories(directories);
        }
        finally {
            await handle.close();
            // Only unlink the temporary name still pointing to the file we created.
            // A crash can leave a complete final file plus this extra hard link; reads
            // remain safe because every immutable payload is revalidated before use.
            if (owned) {
                await this.checkDirectories(directories);
                const leftover = await lstat(temporary).catch(error => { if (isError(error, "ENOENT"))
                    return null; throw error; });
                if (leftover && sameFile(leftover, owned) && !leftover.isSymbolicLink())
                    await unlink(temporary);
            }
        }
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
    async serialized(operation) {
        const key = this.platform === "win32" ? this.directory.toLowerCase() : this.directory;
        const current = (queues.get(key) ?? Promise.resolve()).then(operation);
        const settled = current.then(() => { }, () => { });
        queues.set(key, settled);
        try {
            return await current;
        }
        finally {
            if (queues.get(key) === settled)
                queues.delete(key);
        }
    }
}
//# sourceMappingURL=web-preview-states.js.map