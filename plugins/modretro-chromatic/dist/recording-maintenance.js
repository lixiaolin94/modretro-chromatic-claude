import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readdirSync, readSync, realpathSync, renameSync, unlinkSync, writeFileSync, } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { recordingInventory } from "./recording-location.js";
import { readRecording } from "./recording-archive.js";
import { MAX_RECORDING_BYTES, MAX_SIBLING_RECORDINGS, MAX_SIBLING_RESERVED_BYTES, boundedInteger } from "./recording-common.js";
const POINTER = ".recording-archive.json";
const MAX_ENTRIES = 20_000;
const inside = (root, path) => path === root || path.startsWith(root + sep);
const absent = (path) => {
    try {
        lstatSync(path);
        return false;
    }
    catch (error) {
        if (error.code === "ENOENT")
            return true;
        throw error;
    }
};
function same(a, b) {
    return ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeMs", "ctimeMs"].every(key => a[key] === b[key]);
}
function owned(entry) {
    if ((process.getuid && entry.uid !== process.getuid()) || (entry.mode & 0o022) !== 0 || (entry.mode & 0o7000) !== 0) {
        throw new Error("Recording maintenance requires owned paths without special or writable-by-others permission bits");
    }
}
function file(path, maximum, expected) {
    const before = lstatSync(path);
    owned(before);
    if (expected !== undefined && !same(expected, before))
        throw new Error("Recording file changed before opening");
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maximum) {
        throw new Error("Unsafe or oversized recording maintenance file");
    }
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        if (!same(before, fstatSync(fd)))
            throw new Error("Recording file identity changed");
        const buffer = Buffer.alloc(before.size + 1);
        let size = 0;
        let n;
        while ((n = readSync(fd, buffer, size, buffer.length - size, null)) > 0) {
            size += n;
            if (size > before.size)
                throw new Error("Recording file grew");
        }
        const bytes = buffer.subarray(0, size);
        if (bytes.length !== before.size || !same(before, fstatSync(fd)) || !same(before, lstatSync(path))) {
            throw new Error("Recording file changed during reading");
        }
        return bytes;
    }
    finally {
        closeSync(fd);
    }
}
function failureDetails(error) {
    const value = error;
    const code = typeof value?.code === "string" && /^E[A-Z0-9_]{1,40}$/.test(value.code) ? value.code : undefined;
    const errno = Number.isSafeInteger(value?.errno) ? value.errno : undefined;
    const category = code === "EEXIST" ? "already-exists"
        : code === "EACCES" || code === "EPERM" ? "permission-denied"
            : code === "ENOSPC" || code === "EDQUOT" ? "storage-capacity"
                : code === "EROFS" ? "read-only-filesystem"
                    : code === "ENOENT" || code === "ENOTDIR" || code === "ELOOP" ? "path-error"
                        : code === undefined ? "unknown" : "filesystem-error";
    return { category, ...(code === undefined ? {} : { code }), ...(errno === undefined ? {} : { errno }) };
}
export class RecordingAccessError extends Error {
    failure;
    constructor(cause) {
        super("Recording access is live or unresolved; close its owning client before maintenance", { cause });
        this.failure = { operation: "create-exclusive-lease", observedAt: new Date().toISOString(), ...failureDetails(cause) };
    }
}
function identity(entry) {
    return { dev: entry.dev, ino: entry.ino, uid: entry.uid, gid: entry.gid, mode: entry.mode,
        nlink: entry.nlink, size: entry.size, mtimeMs: entry.mtimeMs, ctimeMs: entry.ctimeMs };
}
class AccessSnapshotError extends Error {
    reason;
    constructor(reason) {
        super(reason);
        this.reason = reason;
    }
}
/** Filesystem-only maintenance. No ROM, interpreter, or native core is opened. */
export class RecordingMaintenance {
    project;
    #leased = false;
    #incomplete = false;
    #serviceInstanceId = randomUUID();
    #createdAt = new Date().toISOString();
    #lastAcquisitionFailure;
    #savedLease;
    constructor(project) { this.project = realpathSync(project); }
    /** Observe only the fixed access metadata. Never acquires access, starts a worker, or reads a recording. */
    accessDiagnostic() {
        const common = {
            schemaVersion: 1, observedAt: new Date().toISOString(), scope: "authorized-root-recording-access",
            readOnly: true, processLiveness: "unobserved", recoveryAuthorized: false,
            localService: { instanceId: this.#serviceInstanceId, createdAt: this.#createdAt, pid: process.pid,
                leaseCapabilityRetained: this.#leased, maintenanceIncomplete: this.#incomplete,
                ...(this.#savedLease === undefined ? {} : { acquiredAt: this.#savedLease.acquiredAt }) },
            acquisitionFailureHistory: this.#lastAcquisitionFailure === undefined
                ? { status: "unavailable-in-this-service" }
                : { status: "recorded", failure: { ...this.#lastAcquisitionFailure } },
        };
        if (!process.getuid)
            return { ...common, lease: { status: "unresolved", reason: "unsupported-platform" } };
        const directories = [];
        let stage = "authorized-root";
        const verifyDirectories = () => {
            for (const dir of directories) {
                if (!same(dir.stat, lstatSync(dir.path)) || realpathSync(dir.path) !== dir.path)
                    throw new AccessSnapshotError("changed");
            }
        };
        try {
            for (const [label, path] of [
                ["authorized-root", this.project], ["artifacts", join(this.project, "artifacts")],
                ["access-directory", join(this.project, "artifacts", ".recording-access")],
            ]) {
                stage = label;
                let st;
                try {
                    st = lstatSync(path);
                }
                catch (error) {
                    if (error.code !== "ENOENT" || label === "authorized-root")
                        throw error;
                    verifyDirectories();
                    return { ...common, lease: { status: "absent-observed", missing: label } };
                }
                if (!st.isDirectory() || st.isSymbolicLink() || realpathSync(path) !== path
                    || st.uid !== process.getuid() || (st.mode & 0o7022) !== 0)
                    throw new AccessSnapshotError("unsafe-path");
                directories.push({ path, stat: st });
            }
            stage = "lease-file";
            const path = join(this.project, "artifacts", ".recording-access", "lease.json");
            let st;
            try {
                st = lstatSync(path);
            }
            catch (error) {
                if (error.code !== "ENOENT")
                    throw error;
                verifyDirectories();
                return { ...common, lease: { status: "absent-observed", missing: "lease-file" } };
            }
            if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.uid !== process.getuid()
                || (st.mode & 0o7777) !== 0o600 || st.size > 4096 || realpathSync(path) !== path)
                throw new AccessSnapshotError("unsafe-file");
            const raw = file(path, 4096, st);
            if (!same(st, lstatSync(path)))
                throw new AccessSnapshotError("changed");
            stage = "lease-schema";
            let parsed;
            try {
                parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
            }
            catch {
                throw new AccessSnapshotError("invalid-record");
            }
            const record = parsed;
            if (record === null || typeof record !== "object" || Array.isArray(record)
                || Object.keys(record).sort().join(",") !== "pid,schemaVersion,token" || record.schemaVersion !== 1
                || !Number.isSafeInteger(record.pid) || record.pid <= 0
                || typeof record.token !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(record.token)) {
                throw new AccessSnapshotError("invalid-record");
            }
            const sha256 = createHash("sha256").update(raw).digest("hex");
            verifyDirectories();
            if (!same(st, lstatSync(path)))
                throw new AccessSnapshotError("changed");
            const matchesSavedLease = this.#leased && this.#savedLease !== undefined
                && same(st, this.#savedLease.identity) && sha256 === this.#savedLease.sha256;
            return { ...common, lease: { status: "present-unverified", sha256, identity: identity(st),
                    ownerPidClaim: record.pid, ownerProcessStart: "unrecorded", ownerReachability: "unknown",
                    relation: matchesSavedLease ? "matches-this-services-saved-lease" : "not-established" } };
        }
        catch (error) {
            return { ...common, lease: { status: "unresolved", stage,
                    reason: error instanceof AccessSnapshotError ? error.reason : "observation-failed", ...failureDetails(error) } };
        }
    }
    resolvePath = (value, { existing }) => {
        if (typeof value !== "string")
            throw new Error("A recording path is required");
        const path = resolve(this.project, value);
        if (!inside(this.project, path))
            throw new Error("Recording path is outside the authorized project");
        let part = this.project;
        for (const segment of relative(this.project, path).split(sep).filter(Boolean)) {
            part = join(part, segment);
            if (absent(part)) {
                if (existing)
                    throw new Error("Recording path is missing");
                continue;
            }
            const st = lstatSync(part);
            owned(st);
            if (st.isSymbolicLink() || realpathSync(part) !== part)
                throw new Error("Recording path is redirected");
        }
        return path;
    };
    #directory(path) {
        this.resolvePath(path, { existing: true });
        if (!lstatSync(path).isDirectory())
            throw new Error("Expected a recording directory");
    }
    #protectedDirectory(path) {
        this.resolvePath(path, { existing: false });
        if (absent(path))
            mkdirSync(path, { mode: 0o700 });
        this.#directory(path);
        for (const marker of [".gitignore", ".npmignore"]) {
            const name = join(path, marker);
            if (absent(name))
                writeFileSync(name, "*\n", { flag: "wx", mode: 0o600 });
            if (!file(name, 2).equals(Buffer.from("*\n")))
                throw new Error("Recording package-protection marker differs");
        }
    }
    /** Advisory across supported clients. Stale/unresolved leases are never stolen. */
    acquire() {
        if (!process.getuid)
            throw new Error("Recording maintenance requires supported POSIX ownership checks");
        const artifacts = join(this.project, "artifacts");
        this.resolvePath(artifacts, { existing: false });
        if (absent(artifacts))
            mkdirSync(artifacts, { mode: 0o700 });
        this.#directory(artifacts);
        const root = join(artifacts, ".recording-access");
        this.#protectedDirectory(root);
        const path = join(root, "lease.json");
        const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, pid: process.pid, token: randomUUID() }) + "\n");
        try {
            writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
        }
        catch (error) {
            const failure = new RecordingAccessError(error);
            this.#lastAcquisitionFailure = failure.failure;
            throw failure;
        }
        const identity = lstatSync(path);
        this.#leased = true;
        this.#savedLease = { identity, sha256: createHash("sha256").update(bytes).digest("hex"), acquiredAt: new Date().toISOString() };
        return () => {
            if (this.#incomplete)
                throw new Error("Recording maintenance is incomplete; access lease retained for reconciliation");
            if (!same(identity, lstatSync(path)) || !file(path, 4096).equals(bytes))
                throw new Error("Recording access lease changed; closure is unresolved");
            unlinkSync(path);
            this.#leased = false;
            this.#savedLease = undefined;
        };
    }
    #snapshot(root) {
        return recordingInventory(root, this.resolvePath);
    }
    #closed(root) {
        const record = readRecording(root, this.resolvePath);
        if (!["stopped", "cancelled", "failed"].includes(record.status) || !record.sourcePins.finalized || record.truncatedTail) {
            throw new Error("Only a finalized recording with complete integrity is eligible; live or unresolved recordings cannot be archived");
        }
        return record;
    }
    #archiveRoot() { return join(this.project, "artifacts", "recording-archives"); }
    #mapping(original) {
        this.#directory(original);
        const raw = file(join(original, POINTER), 4096);
        const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
        if (value.schemaVersion !== 1 || value.originalPath !== original || typeof value.archivePath !== "string"
            || !/^[0-9a-f]{32}$/.test(value.sessionId) || !/^[0-9a-f]{64}$/.test(value.manifestSha256)
            || !inside(this.#archiveRoot(), value.archivePath) || dirname(dirname(value.archivePath)) !== this.#archiveRoot()
            || !/^[0-9a-f-]{36}$/.test(relative(this.#archiveRoot(), dirname(value.archivePath)))
            || value.archivePath !== join(dirname(value.archivePath), "recording"))
            throw new Error("Invalid recording archive mapping");
        if (JSON.stringify(readdirSync(original).sort()) !== JSON.stringify([".gitignore", ".npmignore", POINTER].sort()))
            throw new Error("Archive reference directory has unexpected content");
        for (const marker of [".gitignore", ".npmignore"])
            if (!file(join(original, marker), 2).equals(Buffer.from("*\n")))
                throw new Error("Archive reference marker differs");
        if (!file(join(dirname(value.archivePath), "mapping.json"), 4096).equals(raw))
            throw new Error("Archive mapping copies differ");
        const current = this.#snapshot(value.archivePath);
        if (JSON.stringify(current) !== JSON.stringify(value.inventory))
            throw new Error("Archived recording bytes or modes changed");
        const record = this.#closed(value.archivePath);
        if (record.sessionId !== value.sessionId || record.sourcePins.manifest.sha256 !== value.manifestSha256)
            throw new Error("Archived recording provenance changed");
        return { raw, value };
    }
    retrieve(recordingPath) {
        const original = this.resolvePath(recordingPath, { existing: true });
        const { value } = this.#mapping(original);
        return { ...value, status: "archived", reservationReleasedFrom: dirname(original), bytesReclaimed: 0 };
    }
    resolveRecording(recordingPath) {
        const original = this.resolvePath(recordingPath, { existing: true });
        if (this.isArchived(original)) {
            const mapping = JSON.parse(file(join(dirname(original), "mapping.json"), 4096).toString("utf8"));
            const verified = this.retrieve(mapping.originalPath);
            if (verified.archivePath !== original)
                throw new Error("Archive recording path differs");
            return original;
        }
        return absent(join(original, POINTER)) ? original : this.retrieve(original).archivePath;
    }
    isArchived(path) { return inside(this.#archiveRoot(), path); }
    archive(recordingPath) {
        if (!this.#leased)
            throw new Error("Recording maintenance requires exclusive access");
        const original = this.resolvePath(recordingPath, { existing: true });
        if (this.isArchived(original) || !absent(join(original, POINTER)) || original === this.project
            || inside(original, this.#archiveRoot()))
            throw new Error("Recording archive source is not eligible");
        const record = this.#closed(original);
        const inventory = this.#snapshot(original);
        const archiveRoot = this.#archiveRoot();
        this.#protectedDirectory(archiveRoot);
        if (lstatSync(original).dev !== lstatSync(archiveRoot).dev)
            throw new Error("Archive must remain on the same filesystem");
        const container = join(archiveRoot, randomUUID());
        mkdirSync(container, { mode: 0o700 });
        this.#protectedDirectory(container);
        const archivePath = join(container, "recording");
        const value = { schemaVersion: 1, originalPath: original, archivePath, sessionId: record.sessionId,
            manifestSha256: record.sourcePins.manifest.sha256, inventory };
        const raw = Buffer.from(JSON.stringify(value) + "\n");
        writeFileSync(join(container, "mapping.json"), raw, { flag: "wx", mode: 0o600 });
        if (JSON.stringify(this.#snapshot(original)) !== JSON.stringify(inventory) || !absent(archivePath))
            throw new Error("Recording changed before archive");
        this.#incomplete = true;
        renameSync(original, archivePath);
        // The original bytes remain intact even if subsequent publication fails.
        // A partial operation is reported, never silently overwritten or replayed.
        try {
            mkdirSync(original, { mode: 0o700 });
            this.#protectedDirectory(original);
            writeFileSync(join(original, POINTER), raw, { flag: "wx", mode: 0o600 });
            const result = this.retrieve(original);
            this.#incomplete = false;
            return result;
        }
        catch (error) {
            throw new Error(`Archive publication incomplete; recording retained at ${archivePath}; original reference ${original} requires reconciliation`, { cause: error });
        }
    }
    restore(recordingPath) {
        if (!this.#leased)
            throw new Error("Recording maintenance requires exclusive access");
        const original = this.resolvePath(recordingPath, { existing: true });
        const { value, raw } = this.#mapping(original);
        const restored = this.#closed(value.archivePath);
        let siblings = 0;
        let reserved = 0;
        const neighbors = readdirSync(dirname(original));
        if (neighbors.length > MAX_ENTRIES)
            throw new Error("Recording neighbor inventory exceeds its limit");
        for (const name of neighbors) {
            const sibling = join(dirname(original), name);
            const st = lstatSync(sibling);
            if (!st.isDirectory() || st.isSymbolicLink() || absent(join(sibling, "recording.json")))
                continue;
            const record = JSON.parse(file(join(sibling, "recording.json"), 1024 * 1024).toString("utf8"));
            if (!record || typeof record !== "object" || Array.isArray(record))
                throw new Error("Invalid neighboring recording quota metadata");
            if (record.kind !== "gb-studio-playtest")
                continue;
            siblings++;
            reserved += boundedInteger(record.limits?.maxBytes, "recording reservation", 64 * 1024, MAX_RECORDING_BYTES);
        }
        if (siblings >= MAX_SIBLING_RECORDINGS || reserved + restored.limits.maxBytes > MAX_SIBLING_RESERVED_BYTES) {
            throw new Error("Restoring this recording would exceed retained recording quota");
        }
        // Move the exact reference directory out of the way, retaining it for
        // recovery. Never rename over an existing destination, even an empty one.
        const parked = join(dirname(value.archivePath), "original-reference");
        if (!absent(parked))
            throw new Error("Recording restoration is already pending");
        if (!file(join(original, POINTER), 4096).equals(raw))
            throw new Error("Archive reference changed");
        this.#incomplete = true;
        renameSync(original, parked);
        if (!absent(original))
            throw new Error("Original recording destination was replaced");
        renameSync(value.archivePath, original);
        if (JSON.stringify(this.#snapshot(original)) !== JSON.stringify(value.inventory))
            throw new Error("Restored recording integrity differs");
        this.#closed(original);
        this.#incomplete = false;
        return { ...value, status: "restored", recordingPath: original, reservationReleasedFrom: null, bytesReclaimed: 0 };
    }
}
//# sourceMappingURL=recording-maintenance.js.map