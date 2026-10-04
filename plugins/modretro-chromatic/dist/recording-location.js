import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
const MAX_BYTES = 512 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const inside = (root, path) => path === root || path.startsWith(root + sep);
function unchanged(a, b) {
    return ["dev", "ino", "mode", "uid", "gid", "nlink", "size", "mtimeMs", "ctimeMs"].every(key => a[key] === b[key]);
}
function owned(st) {
    if (!process.getuid || st.uid !== process.getuid() || (st.mode & 0o7022) !== 0 || st.isSymbolicLink()) {
        throw new Error("Recording archive requires owned paths without special or writable-by-others permission bits");
    }
}
function bytes(path, maximum) {
    const before = lstatSync(path);
    owned(before);
    if (!before.isFile() || before.nlink !== 1 || before.size > maximum)
        throw new Error("Invalid archive metadata file");
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        if (!unchanged(before, fstatSync(fd)))
            throw new Error("Archive metadata identity changed");
        const out = Buffer.alloc(before.size + 1);
        let size = 0;
        let n;
        while ((n = readSync(fd, out, size, out.length - size, null)) > 0) {
            size += n;
            if (size > before.size)
                throw new Error("Archive metadata grew");
        }
        if (size !== before.size || !unchanged(before, fstatSync(fd)) || !unchanged(before, lstatSync(path)))
            throw new Error("Archive metadata changed");
        return out.subarray(0, size);
    }
    finally {
        closeSync(fd);
    }
}
/** One canonical inventory shared by maintenance and the ordinary TS reader. */
export function recordingInventory(root, resolvePath) {
    if (resolvePath(root, { existing: true }) !== root || realpathSync(root) !== root)
        throw new Error("Archive root is redirected");
    const rows = [];
    let total = 0;
    let count = 0;
    const visit = (path) => {
        const before = lstatSync(path);
        owned(before);
        if (++count > MAX_ENTRIES)
            throw new Error("Recording member limit exceeded");
        const name = relative(root, path);
        if (before.isDirectory()) {
            rows.push([name, "directory", before.mode & 0o7777]);
            for (const child of readdirSync(path).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))))
                visit(join(path, child));
        }
        else {
            if (!before.isFile() || before.nlink !== 1)
                throw new Error("Recording contains a linked or non-regular member");
            total += before.size;
            if (total > MAX_BYTES)
                throw new Error("Recording archive byte limit exceeded");
            const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
            try {
                if (!unchanged(before, fstatSync(fd)))
                    throw new Error("Recording member identity changed");
                const hash = createHash("sha256");
                const buffer = Buffer.alloc(65536);
                let n;
                let size = 0;
                while ((n = readSync(fd, buffer)) > 0) {
                    size += n;
                    if (size > before.size)
                        throw new Error("Recording member grew");
                    hash.update(buffer.subarray(0, n));
                }
                if (size !== before.size || !unchanged(before, fstatSync(fd)))
                    throw new Error("Recording member changed");
                rows.push([name, "file", before.mode & 0o7777, size, hash.digest("hex")]);
            }
            finally {
                closeSync(fd);
            }
        }
        if (!unchanged(before, lstatSync(path)))
            throw new Error("Recording changed during inventory");
    };
    visit(root);
    for (const marker of [".gitignore", ".npmignore"])
        if (!bytes(join(root, marker), 2).equals(Buffer.from("*\n")))
            throw new Error("Recording package-protection marker differs");
    return { digest: digest(JSON.stringify(rows)), bytes: total, entries: count };
}
/** A mapping is not a generic accounting override: authenticate both copies,
 * the original reference, manifest, and every retained byte/mode first. */
export function recordingArchiveOrigin(root, resolvePath) {
    const container = dirname(root);
    const archiveRoot = dirname(container);
    if (basename(root) !== "recording" || basename(archiveRoot) !== "recording-archives" || basename(dirname(archiveRoot)) !== "artifacts")
        return undefined;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(basename(container)))
        throw new Error("Invalid archive container identity");
    const mappingPath = join(container, "mapping.json");
    if (resolvePath(mappingPath, { existing: true }) !== mappingPath || realpathSync(mappingPath) !== mappingPath)
        throw new Error("Archive mapping is redirected");
    const raw = bytes(mappingPath, 4096);
    const value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(raw));
    if (!value || typeof value !== "object" || Array.isArray(value)
        || Object.keys(value).sort().join() !== "archivePath,inventory,manifestSha256,originalPath,schemaVersion,sessionId"
        || value.schemaVersion !== 1 || value.archivePath !== root || typeof value.originalPath !== "string" || !isAbsolute(value.originalPath)
        || !/^[0-9a-f]{32}$/u.test(value.sessionId) || !/^[0-9a-f]{64}$/u.test(value.manifestSha256))
        throw new Error("Invalid archive mapping");
    const original = value.originalPath;
    if (inside(archiveRoot, original) || inside(original, archiveRoot) || resolvePath(original, { existing: true }) !== original || realpathSync(original) !== original)
        throw new Error("Invalid original recording reference");
    const before = lstatSync(original);
    owned(before);
    if (!before.isDirectory() || (before.mode & 0o7777) !== 0o700 || readdirSync(original).sort().join() !== ".gitignore,.npmignore,.recording-archive.json")
        throw new Error("Archive reference directory differs");
    for (const marker of [".gitignore", ".npmignore"])
        if (!bytes(join(original, marker), 2).equals(Buffer.from("*\n")))
            throw new Error("Archive reference marker differs");
    const pointer = join(original, ".recording-archive.json");
    if ((lstatSync(mappingPath).mode & 0o7777) !== 0o600 || (lstatSync(pointer).mode & 0o7777) !== 0o600 || !bytes(pointer, 4096).equals(raw))
        throw new Error("Archive mapping copies differ");
    const inventory = recordingInventory(root, resolvePath);
    if (JSON.stringify(inventory) !== JSON.stringify(value.inventory))
        throw new Error("Archived recording bytes or modes changed");
    const manifest = bytes(join(root, "recording.json"), 1024 * 1024);
    if (digest(manifest) !== value.manifestSha256 || JSON.parse(manifest.toString("utf8")).sessionId !== value.sessionId)
        throw new Error("Archived recording provenance changed");
    if (!unchanged(before, lstatSync(original)) || !bytes(mappingPath, 4096).equals(raw) || !bytes(pointer, 4096).equals(raw))
        throw new Error("Archive mapping changed during reading");
    return original;
}
//# sourceMappingURL=recording-location.js.map