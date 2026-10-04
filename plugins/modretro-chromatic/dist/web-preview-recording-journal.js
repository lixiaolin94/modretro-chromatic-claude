import { constants } from "node:fs";
import { lstat, mkdir, open, opendir, realpath, rename, unlink, link } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseRecordingJob } from "./web-preview-recording-record.js";
import { recordingId } from "./web-annotations/recording-protocol.js";
const LIMIT = 32 * 1024;
/** Project-wide, bounded and fail-closed. Never discovers or reconstructs media. */
export class RecordingJournal {
    root;
    directory;
    queue = Promise.resolve();
    pin;
    constructor(root) {
        this.root = root;
        this.directory = path.join(path.resolve(root), "captures", ".browser-recordings");
    }
    async directorySafe(create = false) {
        const root = path.resolve(this.root);
        if (await realpath(root) !== root)
            throw new Error("Recording project must be a canonical directory.");
        for (const dir of [root, path.dirname(this.directory), this.directory]) {
            if (create && dir !== root)
                await mkdir(dir, { mode: 0o700 }).catch(error => { if (error.code !== "EEXIST")
                    throw error; });
            const s = await lstat(dir);
            if (!s.isDirectory() || s.isSymbolicLink() || (typeof process.getuid === "function" && s.uid !== process.getuid()))
                throw new Error("Unsafe recording journal directory.");
            if (dir === this.directory) {
                if (this.pin && (s.ino !== this.pin.ino || s.dev !== this.pin.dev))
                    throw new Error("Recording journal directory changed.");
                this.pin ??= { dev: s.dev, ino: s.ino };
            }
        }
    }
    async readFile(name) {
        const file = path.join(this.directory, name);
        const before = await lstat(file);
        if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > LIMIT || (typeof process.getuid === "function" && before.uid !== process.getuid()))
            throw new Error("Unsafe recording journal entry.");
        const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            const actual = await handle.stat();
            if (actual.ino !== before.ino || actual.dev !== before.dev)
                throw new Error("Recording journal changed.");
            const buffer = Buffer.alloc(LIMIT + 1);
            let bytes = 0;
            while (bytes < buffer.length) {
                const r = await handle.read(buffer, bytes, buffer.length - bytes, null);
                if (!r.bytesRead)
                    break;
                bytes += r.bytesRead;
            }
            if (bytes > LIMIT || bytes !== before.size)
                throw new Error("Recording journal exceeds its bound.");
            const after = await handle.stat(), named = await lstat(file);
            if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || named.ino !== before.ino || named.dev !== before.dev)
                throw new Error("Recording journal changed while reading.");
            const v = JSON.parse(buffer.subarray(0, bytes).toString("utf8"));
            if (!v || typeof v !== "object" || Array.isArray(v))
                throw new Error("Invalid recording journal.");
            await this.directorySafe();
            if (name === "active.json") {
                const r = v;
                if (Object.keys(r).length !== 1)
                    throw new Error("Invalid recording reservation.");
                recordingId(r.id);
                return r;
            }
            return parseRecordingJob(v);
        }
        finally {
            await handle.close();
        }
    }
    async entries() {
        try {
            await this.directorySafe();
        }
        catch (error) {
            if (error.code === "ENOENT")
                return [];
            throw error;
        }
        const entries = [];
        const dir = await opendir(this.directory);
        let count = 0;
        for await (const entry of dir) {
            if (++count > 66)
                throw new Error("Recording journal limit reached; preserve existing recordings.");
            if (entry.name === "active.json")
                continue;
            if (!/^[a-f0-9-]{36}\.json$/.test(entry.name))
                throw new Error("Partial or unknown recording journal entry; inspect original evidence.");
            recordingId(entry.name.slice(0, -5));
            const value = await this.readFile(entry.name);
            if (value.id !== entry.name.slice(0, -5))
                throw new Error("Recording journal identity mismatch.");
            entries.push(value);
        }
        if (entries.length > 64)
            throw new Error("Recording journal limit reached.");
        return entries;
    }
    async reserve(id, value) {
        recordingId(id);
        await this.directorySafe(true);
        // This exclusive project lock also rejects another process between scan and publication.
        const lock = await open(path.join(this.directory, "active.json"), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try {
            await lock.writeFile(JSON.stringify({ id }));
            await lock.sync();
        }
        finally {
            await lock.close();
        }
        const entries = await this.entries();
        if (entries.length >= 64 || entries.some(e => e.phase !== "finished" && e.phase !== "failed"))
            throw new Error("RECORDING_UNKNOWN: an earlier project recording is unresolved. Preserve its original status.");
        await this.write(id, value, true);
    }
    write(id, value, initial = false) {
        recordingId(id);
        const task = this.queue.then(async () => {
            await this.directorySafe();
            const data = JSON.stringify(parseRecordingJob(value)) + "\n";
            if (Buffer.byteLength(data) > LIMIT)
                throw new Error("Recording journal entry exceeds 32 KiB.");
            const target = path.join(this.directory, `${id}.json`);
            if (!initial)
                await this.readFile(`${id}.json`);
            const temporary = path.join(this.directory, `${id}.${randomUUID()}.tmp`);
            const handle = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
            try {
                await handle.writeFile(data);
                await handle.sync();
            }
            finally {
                await handle.close();
            }
            await this.directorySafe();
            if (initial) {
                await link(temporary, target);
                await unlink(temporary);
            }
            else
                await rename(temporary, target);
            await this.syncDirectory();
        });
        this.queue = task.catch(() => { });
        return task;
    }
    async syncDirectory() {
        if (process.platform === "win32")
            return;
        const handle = await open(this.directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try {
            const stat = await handle.stat();
            if (stat.ino !== this.pin?.ino || stat.dev !== this.pin.dev)
                throw new Error("Recording journal directory changed.");
            await handle.sync();
        }
        finally {
            await handle.close();
        }
    }
    async release(id) {
        await this.queue;
        const lock = await this.readFile("active.json");
        if (lock.id !== id)
            throw new Error("Recording journal lock changed.");
        await this.directorySafe();
        await unlink(path.join(this.directory, "active.json"));
        await this.syncDirectory();
    }
    async activeId() {
        try {
            await this.directorySafe();
            const value = await this.readFile("active.json");
            return recordingId(value.id);
        }
        catch (error) {
            if (error.code === "ENOENT")
                return;
            throw error;
        }
    }
    async read(id) { recordingId(id); await this.directorySafe(); return this.readFile(`${id}.json`); }
}
//# sourceMappingURL=web-preview-recording-journal.js.map