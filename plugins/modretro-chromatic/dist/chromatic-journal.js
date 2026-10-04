import { closeSync, constants, fstatSync, fsyncSync, ftruncateSync, lstatSync, mkdirSync, openSync, opendirSync, readSync, readdirSync, realpathSync, renameSync, rmdirSync, unlinkSync, writeSync, } from "node:fs";
import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
const OWNER = "codex-gb-studio-chromatic-operations-v1";
const RECORD_LIMIT = 8 * 1024 * 1024;
const STREAM_LIMIT = 8 * 1024 * 1024;
// Keep the slot in the existing directory namespace so older plugin versions
// can still admit explicit actions against the same journal after a rollback.
const OBSERVATION_DIRECTORY = createHash("sha256").update("chromatic-observation-slot-v1").digest("hex");
const OPERATION_ID = /^(?:[a-f0-9]{64}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/u;
const identity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.uid === b.uid && a.gid === b.gid && a.mode === b.mode && a.nlink === b.nlink;
const unchanged = (a, b) => identity(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
const absent = (error) => error instanceof Error && "code" in error && error.code === "ENOENT";
function boundedRead(fd, size) {
    const bytes = Buffer.alloc(size);
    let offset = 0;
    while (offset < size) {
        const count = readSync(fd, bytes, offset, size - offset, offset);
        if (!count)
            throw new Error("Chromatic journal shrank while reading");
        offset += count;
    }
    if (readSync(fd, Buffer.alloc(1), 0, 1, offset))
        throw new Error("Chromatic journal grew while reading");
    return bytes;
}
function owned(filename, stat, directory) {
    if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1)
        || realpathSync(filename) !== path.resolve(filename)
        || (process.getuid && stat.uid !== process.getuid())
        || (process.platform !== "win32" && (stat.mode & 0o777) !== (directory ? 0o700 : 0o600))) {
        throw new Error(`Unsafe Chromatic operation journal identity: ${filename}`);
    }
}
function readJson(filename, limit = RECORD_LIMIT) {
    let before;
    try {
        before = lstatSync(filename);
    }
    catch (error) {
        if (absent(error))
            return undefined;
        throw error;
    }
    owned(filename, before, false);
    if (before.size > limit)
        throw new Error("Chromatic operation journal exceeds its read bound");
    const fd = fs.openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        if (!unchanged(before, fstatSync(fd)))
            throw new Error("Chromatic journal changed while opening");
        const raw = boundedRead(fd, before.size);
        if (raw.length !== before.size || !unchanged(before, fstatSync(fd)) || !unchanged(before, lstatSync(filename)))
            throw new Error("Chromatic journal changed while reading");
        const value = JSON.parse(raw.toString("utf8"));
        if (!value || typeof value !== "object" || Array.isArray(value) || !("owner" in value) || value.owner !== OWNER)
            throw new Error("Chromatic operation journal owner differs");
        return value;
    }
    finally {
        closeSync(fd);
    }
}
function readOutput(filename) {
    const before = lstatSync(filename);
    owned(filename, before, false);
    if (before.size > STREAM_LIMIT)
        throw new Error("Chromatic output journal exceeds its bound");
    const fd = fs.openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        if (!unchanged(before, fstatSync(fd)))
            throw new Error("Chromatic output changed while opening");
        const bytes = boundedRead(fd, before.size);
        if (bytes.length !== before.size || !unchanged(before, fstatSync(fd)) || !unchanged(before, lstatSync(filename)))
            throw new Error("Chromatic output is changing; its current complete contents are not established");
        const text = bytes.toString("utf8");
        const preview = bytes.subarray(0, 512 * 1024);
        return { text: preview.toString("utf8"), bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
            previewTruncated: preview.length !== bytes.length,
            ...(Buffer.from(text).equals(bytes) ? {} : { encoding: "invalid-utf8" }), complete: false };
    }
    finally {
        closeSync(fd);
    }
}
function createDirectory(parent, name) {
    const parentStat = lstatSync(parent);
    if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || realpathSync(parent) !== parent
        || (process.getuid && parentStat.uid !== process.getuid())
        || (process.platform !== "win32" && (parentStat.mode & 0o022)))
        throw new Error("Chromatic state parent must be an owned canonical directory");
    const target = path.join(parent, name);
    try {
        mkdirSync(target, { mode: 0o700 });
    }
    catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST")
            throw error;
    }
    owned(target, lstatSync(target), true);
    return target;
}
function writeAll(fd, bytes) {
    let offset = 0;
    while (offset < bytes.length) {
        const written = writeSync(fd, bytes, offset, bytes.length - offset, offset);
        if (written <= 0)
            throw new Error("Chromatic journal write made no progress");
        offset += written;
    }
    ftruncateSync(fd, bytes.length);
    fsyncSync(fd);
}
/** Small durable evidence journal, not a daemon or proof of child liveness. */
export class ChromaticJournal {
    root;
    #custom;
    constructor(root) {
        this.root = root ? path.resolve(root) : path.join(os.homedir(), ".codex-gb-studio", "chromatic");
        this.#custom = root !== undefined;
    }
    #root(create) {
        if (create) {
            if (!this.#custom)
                createDirectory(realpathSync(os.homedir()), ".codex-gb-studio");
            createDirectory(path.dirname(this.root), path.basename(this.root));
        }
        try {
            owned(this.root, lstatSync(this.root), true);
        }
        catch (error) {
            if (!create && absent(error))
                return false;
            throw error;
        }
        const marker = path.join(this.root, "owner.json");
        if (create && !readJson(marker, 4096)) {
            // A nonempty unmarked directory is never adopted as a journal.
            if (readdirSync(this.root).length)
                throw new Error("Chromatic journal directory is unowned");
            const fd = openSync(marker, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
            try {
                writeAll(fd, Buffer.from(JSON.stringify({ owner: OWNER, schemaVersion: 1 }) + "\n"));
            }
            finally {
                closeSync(fd);
            }
        }
        if (!readJson(marker, 4096))
            throw new Error("Chromatic journal owner marker is missing");
        return true;
    }
    current() {
        if (!this.#root(false))
            return undefined;
        return readJson(path.join(this.root, "active.json"), 4096);
    }
    read(operationId) {
        if (!OPERATION_ID.test(operationId))
            throw new Error("Invalid Chromatic operation ID");
        if (!this.#root(false))
            return undefined;
        let directory = path.join(this.root, operationId);
        try {
            owned(directory, lstatSync(directory), true);
        }
        catch (error) {
            if (!absent(error))
                throw error;
            directory = path.join(this.root, OBSERVATION_DIRECTORY);
            try {
                owned(directory, lstatSync(directory), true);
            }
            catch (error) {
                if (absent(error))
                    return undefined;
                throw error;
            }
        }
        const saved = readJson(path.join(directory, "operation.json"));
        if (directory === path.join(this.root, OBSERVATION_DIRECTORY) && saved?.operationId !== operationId)
            return undefined;
        if (!saved || saved.operationId !== operationId || !saved.operation || typeof saved.operation !== "object")
            throw new Error("Chromatic operation record is incomplete");
        const operation = saved.operation;
        if (operation.state === "running" && Array.isArray(operation.commands)) {
            if (operation.commands.length > 2)
                throw new Error("Unexpected Chromatic command history");
            operation.commands = operation.commands.map((value, index) => {
                if (!value || typeof value !== "object" || Array.isArray(value))
                    throw new Error("Invalid Chromatic command record");
                const command = value;
                if (!command.streamFiles)
                    return command;
                return { ...command, retainedPartialOutput: {
                        stdout: readOutput(path.join(directory, `command-${index}.stdout`)),
                        stderr: readOutput(path.join(directory, `command-${index}.stderr`)),
                    } };
            });
        }
        return operation;
    }
    acquire(operationId, sessionId, initial) {
        if (!OPERATION_ID.test(operationId))
            throw new Error("Invalid Chromatic operation ID");
        this.#root(true);
        const current = this.current();
        if (current)
            throw Object.assign(new Error("A previous Chromatic operation still holds the journal. Its completion is unresolved here; do not retry or delete its record."), { code: "CHROMATIC_OWNERSHIP_UNRESOLVED", details: current });
        // Historical request IDs remain durable across sessions. Stream the names
        // without a lifetime-use quota or loading the full history into memory.
        const entries = opendirSync(this.root);
        try {
            for (let entry = entries.readSync(); entry; entry = entries.readSync()) {
                if (entry.name !== "owner.json" && !OPERATION_ID.test(entry.name))
                    throw new Error("Chromatic journal contains an unexpected entry; preserve it for review");
            }
        }
        finally {
            entries.closeSync();
        }
        const lockPath = path.join(this.root, "active.json");
        const lockFd = openSync(lockPath, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL, 0o600);
        try {
            writeAll(lockFd, Buffer.from(JSON.stringify({ owner: OWNER, schemaVersion: 1, operationId, sessionId, pid: process.pid, createdAt: new Date().toISOString() }) + "\n"));
            const lockIdentity = fstatSync(lockFd);
            const observation = initial.command === "observe_devices";
            const directory = path.join(this.root, observation ? OBSERVATION_DIRECTORY : operationId);
            // Rotate only a settled read-only scan, while holding the shared claim.
            // Interrupted scans and every explicit action keep their original evidence.
            if (observation)
                this.#clearObservation(directory);
            mkdirSync(directory, { mode: 0o700 });
            owned(directory, lstatSync(directory), true);
            const lease = new ChromaticJournalLease(directory, operationId, lockPath, lockFd, lockIdentity);
            lease.write(initial);
            return lease;
        }
        catch (error) {
            closeSync(lockFd);
            // Preserve an incomplete reservation. Never infer that no child could exist
            // merely from a missing PID or partially written metadata after a crash.
            throw error;
        }
    }
    #clearObservation(directory) {
        let before;
        try {
            before = lstatSync(directory);
        }
        catch (error) {
            if (absent(error))
                return;
            throw error;
        }
        owned(directory, before, true);
        const saved = readJson(path.join(directory, "operation.json"));
        const operation = saved?.operation;
        if (!operation || operation.command !== "observe_devices" || !["succeeded", "failed"].includes(String(operation.state))) {
            throw new Error("The previous Chromatic observation is not settled; preserve its record");
        }
        const names = readdirSync(directory);
        for (const name of names) {
            if (!["operation.json", "command-0.stdout", "command-0.stderr"].includes(name))
                throw new Error("Unexpected Chromatic observation evidence; preserve it for review");
            const filename = path.join(directory, name);
            owned(filename, lstatSync(filename), false);
        }
        if (!unchanged(before, lstatSync(directory)))
            throw new Error("Chromatic observation changed before rotation");
        if (operation.state === "failed") {
            // Preserve a failed scan, including its original relative stream files.
            // Reserve the destination exclusively so a prior operation is never replaced.
            const id = saved.operationId;
            if (typeof id !== "string" || !OPERATION_ID.test(id) || id === OBSERVATION_DIRECTORY) {
                throw new Error("Invalid failed Chromatic observation identity");
            }
            const destination = path.join(this.root, id);
            mkdirSync(destination, { mode: 0o700 });
            const reserved = lstatSync(destination);
            owned(destination, reserved, true);
            if (!unchanged(before, lstatSync(directory)) || !unchanged(reserved, lstatSync(destination))) {
                throw new Error("Chromatic observation changed before preservation");
            }
            // Move into the exclusively created directory rather than replacing it:
            // Windows cannot rename a directory over an existing empty directory.
            for (const name of names)
                renameSync(path.join(directory, name), path.join(destination, name));
            rmdirSync(directory);
            return;
        }
        for (const name of names)
            unlinkSync(path.join(directory, name));
        rmdirSync(directory);
    }
}
export class ChromaticJournalLease {
    directory;
    operationId;
    lockPath;
    lockFd;
    lockIdentity;
    #streams = new Map();
    #recordIdentity;
    #checkpointFailure;
    #closed = false;
    constructor(directory, operationId, lockPath, lockFd, lockIdentity) {
        this.directory = directory;
        this.operationId = operationId;
        this.lockPath = lockPath;
        this.lockFd = lockFd;
        this.lockIdentity = lockIdentity;
    }
    write(operation) {
        if (this.#closed)
            throw new Error("Chromatic journal lease is closed");
        if (this.#checkpointFailure)
            throw this.#checkpointFailure;
        const bytes = Buffer.from(JSON.stringify({ owner: OWNER, schemaVersion: 1, operationId: this.operationId, operation }) + "\n");
        if (bytes.length > RECORD_LIMIT)
            throw new Error("Chromatic operation exceeds its durable record bound");
        const destination = path.join(this.directory, "operation.json");
        if (this.#recordIdentity) {
            const current = lstatSync(destination);
            owned(destination, current, false);
            if (!unchanged(current, this.#recordIdentity))
                throw new Error("Chromatic operation checkpoint changed outside its owner");
        }
        owned(this.directory, lstatSync(this.directory), true);
        const temporary = path.join(this.directory, `.checkpoint-${randomUUID()}.json`);
        try {
            const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
            try {
                writeAll(fd, bytes);
            }
            finally {
                closeSync(fd);
            }
            // The old complete checkpoint survives interruption until this atomic rename.
            renameSync(temporary, destination);
            this.#recordIdentity = lstatSync(destination);
        }
        catch (error) {
            this.#checkpointFailure = error;
            throw error;
        }
    }
    prepareCommand(index) {
        const names = { stdout: `command-${index}.stdout`, stderr: `command-${index}.stderr` };
        for (const stream of ["stdout", "stderr"]) {
            const fd = openSync(path.join(this.directory, names[stream]), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
            this.#streams.set(`${index}:${stream}`, { fd, bytes: 0, observedBytes: 0, hash: createHash("sha256") });
        }
        return names;
    }
    output(index, stream, bytes) {
        const state = this.#streams.get(`${index}:${stream}`);
        if (!state || this.#closed)
            throw new Error("Chromatic output has no open journal stream");
        const keep = Math.min(bytes.length, STREAM_LIMIT - state.bytes);
        state.observedBytes += bytes.length;
        if (state.failure)
            throw state.failure;
        let offset = 0;
        try {
            while (offset < keep) {
                const written = fs.writeSync(state.fd, bytes, offset, keep - offset, state.bytes);
                if (written <= 0)
                    throw new Error("Chromatic output journal write made no progress");
                state.hash.update(bytes.subarray(offset, offset + written));
                state.bytes += written;
                offset += written;
            }
        }
        catch (error) {
            state.failure = error;
            throw error;
        }
        return { observedBytes: state.observedBytes, retainedBytes: state.bytes,
            complete: state.observedBytes === state.bytes, sha256: state.hash.copy().digest("hex") };
    }
    finish(operation, release) {
        if (this.#closed)
            return;
        let failure;
        for (const { fd } of this.#streams.values()) {
            try {
                fsyncSync(fd);
            }
            catch (error) {
                failure ??= error;
            }
            try {
                closeSync(fd);
            }
            catch (error) {
                failure ??= error;
            }
        }
        // Publish a terminal checkpoint only after the original stream files settle.
        if (!failure)
            try {
                this.write(operation);
            }
            catch (error) {
                failure = error;
            }
        try {
            if (release && !failure) {
                const actual = lstatSync(this.lockPath);
                owned(this.lockPath, actual, false);
                if (!identity(actual, this.lockIdentity) || !identity(fstatSync(this.lockFd), this.lockIdentity))
                    throw new Error("Chromatic ownership lock changed; it was not removed");
                unlinkSync(this.lockPath);
            }
        }
        catch (error) {
            failure ??= error;
        }
        try {
            closeSync(this.lockFd);
        }
        catch (error) {
            failure ??= error;
        }
        this.#closed = true;
        if (failure)
            throw failure;
    }
}
//# sourceMappingURL=chromatic-journal.js.map