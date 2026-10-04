import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, mkdtemp, open, opendir, rename, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { GameStudioProjectError } from "./project.js";
import { resolveProjectPath } from "./project-files.js";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const missing = (error) => !!error && typeof error === "object" && "code" in error && error.code === "ENOENT";
const fail = (code, message) => { throw new GameStudioProjectError(code, message); };
/** Strict relative path and actual sibling alias checks; never follows project symlinks. */
export async function nativeImportPath(root, relative, mustExist = false, allowHardLinks = false) {
    if (!relative || relative.length > 4096 || relative.split("/").length > 64 || relative.includes("\\") || /[\x00-\x1f]/.test(relative)
        || path.posix.isAbsolute(relative) || path.posix.normalize(relative) !== relative || relative === "." || relative === ".." || relative.startsWith("../")) {
        fail("INVALID_RESOURCE_PATH", "Native import paths must be normalized project-relative paths.");
    }
    let parent = root;
    const parts = relative.split("/");
    for (let i = 0; i < parts.length; i++) {
        const component = parts[i], key = component.normalize("NFC").toLowerCase();
        let directory;
        try {
            directory = await opendir(parent);
        }
        catch (error) {
            if (missing(error) && !mustExist)
                break;
            throw error;
        }
        let siblings = 0;
        for await (const entry of directory) {
            if (++siblings > 16384)
                fail("NATIVE_IMPORT_BOUNDS", "Native import path validation supports at most 16384 entries per directory.");
            if (entry.name !== component && entry.name.normalize("NFC").toLowerCase() === key)
                fail("RESOURCE_PATH_ALIAS", `Native import path has a case or Unicode alias: ${relative}.`);
        }
        parent = path.join(parent, component);
        let info;
        try {
            info = await lstat(parent);
        }
        catch (error) {
            if (missing(error) && !mustExist)
                break;
            throw error;
        }
        if (info.isSymbolicLink())
            fail("UNSAFE_SYMLINK", `Native import path contains a symbolic link: ${relative}.`);
        if (i < parts.length - 1 ? !info.isDirectory() : !info.isFile())
            fail("INVALID_RESOURCE_PATH", `Native import path has an invalid file type: ${relative}.`);
        if (i === parts.length - 1 && !allowHardLinks && info.nlink !== 1)
            fail("RESOURCE_PATH_ALIAS", `Native import source has hard-link aliases: ${relative}.`);
    }
    const absolute = path.join(root, relative);
    if (await resolveProjectPath(root, absolute, { mustExist, allowRoot: false }) !== absolute)
        fail("RESOURCE_PATH_ALIAS", "Native import path resolves through an alias.");
    return absolute;
}
export async function readNativeImportSnapshot(root, relative, maximum) {
    const absolute = await nativeImportPath(root, relative, true);
    const handle = await open(absolute, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK));
    try {
        const before = await handle.stat({ bigint: true });
        if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(maximum))
            fail("NATIVE_IMPORT_BOUNDS", `Native import source exceeds its ${maximum}-byte limit or is not a single regular file: ${relative}.`);
        const bytes = Buffer.alloc(Number(before.size) + 1);
        let count = 0;
        while (count < bytes.length) {
            const read = await handle.read(bytes, count, bytes.length - count, count);
            if (!read.bytesRead)
                break;
            count += read.bytesRead;
        }
        const after = await handle.stat({ bigint: true });
        await nativeImportPath(root, relative, true);
        const named = await lstat(absolute, { bigint: true });
        if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs
            || after.mode !== before.mode || named.mode !== before.mode || named.dev !== before.dev || named.ino !== before.ino || named.nlink !== 1n || named.size !== before.size || named.mtimeNs !== before.mtimeNs || named.ctimeNs !== before.ctimeNs || BigInt(count) !== before.size) {
            fail("STALE_PROJECT_REVISION", `Native import source changed while reading: ${relative}.`);
        }
        const content = bytes.subarray(0, count);
        return { bytes: content, identity: { dev: String(before.dev), ino: String(before.ino), size: count, sha256: hash(content), mode: Number(before.mode & 4095n) } };
    }
    finally {
        await handle.close();
    }
}
export class NativeImportFileError extends Error {
    originalCause;
    cleanupFailures;
    retainedPaths;
    constructor(originalCause, cleanupFailures, retainedPaths) {
        super(`${originalCause instanceof Error ? originalCause.message : String(originalCause)}${cleanupFailures.length ? `; cleanup: ${cleanupFailures.join("; ")}` : ""}`);
        this.originalCause = originalCause;
        this.cleanupFailures = cleanupFailures;
        this.retainedPaths = retainedPaths;
    }
}
const message = (error) => error instanceof Error ? error.message : String(error);
const relativePath = (root, file) => path.relative(root, file).split(path.sep).join("/");
/** Atomic no-replace publication; notify the transaction before any post-publication await. */
export async function publishNativeImportFile(root, relative, bytes, published) {
    const absolute = await nativeImportPath(root, relative);
    await mkdir(path.dirname(absolute), { recursive: true });
    await nativeImportPath(root, relative);
    const directory = await mkdtemp(path.join(path.dirname(absolute), ".native-import-"));
    const temporary = path.join(directory, "payload");
    let handle;
    let receipt;
    let failure;
    const cleanupFailures = [];
    try {
        handle = await open(temporary, "wx", 0o600);
        await handle.writeFile(bytes);
        await handle.sync();
        const info = await handle.stat({ bigint: true });
        receipt = { dev: String(info.dev), ino: String(info.ino), size: bytes.length, sha256: hash(bytes), temporaryDirectory: directory };
        await nativeImportPath(root, relative);
        await link(temporary, absolute);
        published(receipt);
    }
    catch (error) {
        failure = error && typeof error === "object" && "code" in error && error.code === "EEXIST"
            ? new GameStudioProjectError("STALE_PROJECT_REVISION", `A destination appeared before native import publication: ${relative}.`) : error;
    }
    try {
        await handle?.close();
    }
    catch (error) {
        cleanupFailures.push(`close temporary: ${message(error)}`);
    }
    try {
        await unlink(temporary);
    }
    catch (error) {
        if (!missing(error))
            cleanupFailures.push(`remove temporary: ${message(error)}`);
    }
    let retained = true;
    try {
        await rmdir(directory);
        retained = false;
    }
    catch (error) {
        if (missing(error))
            retained = false;
        else
            cleanupFailures.push(`remove temporary directory: ${message(error)}`);
    }
    if (receipt && !retained)
        delete receipt.temporaryDirectory;
    if (failure || cleanupFailures.length)
        throw new NativeImportFileError(failure ?? new Error("Native import temporary cleanup failed after publication"), cleanupFailures, retained ? [relativePath(root, directory)] : []);
}
export class NativeRecoveryConflict extends Error {
    retainedPaths;
    constructor(message, retainedPaths = []) {
        super(message);
        this.retainedPaths = retainedPaths;
    }
}
/** Capture the pathname atomically, then delete only verified owned bytes. Never overwrite a replacement. */
export async function rollbackNativeImportFile(root, relative, expected) {
    // Validate ancestors while permitting a replaced leaf so it can be preserved in quarantine.
    const parent = path.posix.dirname(relative);
    const absolute = path.join(root, relative);
    await nativeImportPath(root, `${parent}/.rollback-check-${randomUUID()}`);
    const directory = await mkdtemp(path.join(path.dirname(absolute), ".native-recovery-"));
    const captured = path.join(directory, "payload");
    let moved = false;
    let failure;
    try {
        await rename(absolute, captured);
        moved = true;
        const named = await lstat(captured, { bigint: true });
        let owned = named.isFile() && !named.isSymbolicLink() && String(named.dev) === expected.dev && String(named.ino) === expected.ino && named.size === BigInt(expected.size)
            && (expected.mode === undefined || Number(named.mode & 4095n) === expected.mode);
        if (owned) {
            const handle = await open(captured, constants.O_RDONLY | (process.platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK));
            try {
                const info = await handle.stat({ bigint: true });
                const bytes = Buffer.alloc(expected.size + 1);
                let count = 0;
                while (count < bytes.length) {
                    const read = await handle.read(bytes, count, bytes.length - count, count);
                    if (!read.bytesRead)
                        break;
                    count += read.bytesRead;
                }
                const after = await handle.stat({ bigint: true });
                const current = await lstat(captured, { bigint: true });
                owned = String(info.dev) === expected.dev && String(info.ino) === expected.ino && info.size === BigInt(expected.size)
                    && after.size === info.size && after.mtimeNs === info.mtimeNs && after.ctimeNs === info.ctimeNs && current.dev === info.dev && current.ino === info.ino
                    && current.size === info.size && current.mtimeNs === info.mtimeNs && current.ctimeNs === info.ctimeNs
                    && (expected.mode === undefined || (Number(info.mode & 4095n) === expected.mode && info.mode === after.mode && info.mode === current.mode))
                    && count === expected.size && hash(bytes.subarray(0, count)) === expected.sha256;
            }
            finally {
                await handle.close();
            }
        }
        if (!owned)
            throw new Error("The current file is not the object published by this import.");
        await unlink(captured);
        moved = false;
    }
    catch (error) {
        const retained = [];
        if (moved) {
            try {
                await nativeImportPath(root, `${parent}/.rollback-check-${randomUUID()}`);
                await link(captured, absolute);
                await unlink(captured);
                moved = false;
            }
            catch {
                retained.push(path.relative(root, captured).split(path.sep).join("/"));
            }
        }
        failure = new NativeRecoveryConflict(`${relative}: ${message(error)}`, retained);
    }
    if (!moved) {
        try {
            await rmdir(directory);
        }
        catch (error) {
            if (!missing(error))
                failure = new NativeRecoveryConflict(`${failure?.message ?? relative}; recovery directory cleanup: ${message(error)}`, [...(failure?.retainedPaths ?? []), relativePath(root, directory)]);
        }
    }
    if (failure)
        throw failure;
}
function sameIdentity(actual, expected) {
    return actual.dev === expected.dev && actual.ino === expected.ino && actual.size === expected.size
        && actual.sha256 === expected.sha256 && actual.mode === expected.mode;
}
/**
 * Capture the old pathname first, verify the captured inode, then publish with
 * link's no-replace semantics. Conflicting pathnames are retained for recovery.
 * The captured original remains available until finalization or rollback.
 */
export async function replaceNativeImportFile(root, relative, before, original, bytes, published) {
    const absolute = await nativeImportPath(root, relative, true);
    const directory = await mkdtemp(path.join(path.dirname(absolute), ".native-replacement-"));
    const payload = path.join(directory, "payload"), backup = path.join(directory, "original");
    const backupPath = relativePath(root, backup), directoryPath = relativePath(root, directory);
    let captured = false, installed = false, handle;
    let payloadIdentity;
    try {
        const directoryInfo = await lstat(directory);
        if (!directoryInfo.isDirectory() || directoryInfo.isSymbolicLink() || (directoryInfo.mode & 0o777) !== 0o700
            || await resolveProjectPath(root, directory, { mustExist: true }) !== directory) {
            throw new Error("The native replacement staging directory is not private and canonical.");
        }
        handle = await open(payload, "wx", 0o600);
        const created = await handle.stat({ bigint: true });
        payloadIdentity = { dev: String(created.dev), ino: String(created.ino), size: 0, sha256: hash(Buffer.alloc(0)), mode: 0o600 };
        await handle.writeFile(bytes);
        await handle.chmod(original.mode);
        await handle.sync();
        const info = await handle.stat({ bigint: true });
        payloadIdentity = { dev: String(info.dev), ino: String(info.ino), size: bytes.length, sha256: hash(bytes), mode: original.mode };
        await handle.close();
        handle = undefined;
        await nativeImportPath(root, relative, true);
        await rename(absolute, backup);
        captured = true;
        const capturedFile = await readNativeImportSnapshot(root, backupPath, before.length);
        if (!sameIdentity(capturedFile.identity, original) || !capturedFile.bytes.equals(before)) {
            fail("STALE_PROJECT_REVISION", `Native update target changed before publication: ${relative}.`);
        }
        await link(payload, absolute);
        installed = true;
        published({ published: payloadIdentity, original: { ...original }, originalBytes: Buffer.from(before), backupPath, directory, backupRemoved: false });
        await unlink(payload);
    }
    catch (error) {
        const cleanupFailures = [], retained = [];
        if (handle)
            try {
                await handle.close();
            }
            catch (closeError) {
                cleanupFailures.push(`close payload: ${message(closeError)}`);
            }
        if (!installed && captured) {
            try {
                await link(backup, absolute);
                await unlink(backup);
                captured = false;
            }
            catch (restoreError) {
                cleanupFailures.push(`restore captured original without overwrite: ${message(restoreError)}`);
                retained.push(backupPath);
            }
        }
        if (payloadIdentity) {
            try {
                const current = await lstat(payload, { bigint: true });
                if (String(current.dev) !== payloadIdentity.dev || String(current.ino) !== payloadIdentity.ino)
                    throw new Error("staging identity changed");
                await unlink(payload);
            }
            catch (cleanupError) {
                if (!missing(cleanupError)) {
                    cleanupFailures.push(`remove payload: ${message(cleanupError)}`);
                    retained.push(relativePath(root, payload));
                }
            }
        }
        else if (handle) {
            cleanupFailures.push("payload identity unavailable; staging was retained");
            retained.push(relativePath(root, payload));
        }
        if (!installed && !captured && retained.length === 0) {
            try {
                await rmdir(directory);
            }
            catch (cleanupError) {
                if (!missing(cleanupError)) {
                    cleanupFailures.push(`remove staging directory: ${message(cleanupError)}`);
                    retained.push(directoryPath);
                }
            }
        }
        if (!installed && captured) {
            throw new NativeRecoveryConflict(`The captured original could not be restored without overwriting a concurrent change: ${message(error)}; ${cleanupFailures.join("; ")}`, retained);
        }
        if (cleanupFailures.length)
            throw new NativeImportFileError(error, cleanupFailures, retained);
        throw error;
    }
}
async function verifiedReplacementBackup(root, receipt) {
    try {
        const backup = await readNativeImportSnapshot(root, receipt.backupPath, receipt.originalBytes.length);
        if (!sameIdentity(backup.identity, receipt.original) || !backup.bytes.equals(receipt.originalBytes)) {
            throw new Error("The captured original changed.");
        }
    }
    catch (error) {
        throw new NativeRecoveryConflict(`The captured original could not be verified: ${message(error)}`, [receipt.backupPath]);
    }
}
/** Remove only the exact original captured by a successful replacement. */
export async function finalizeNativeReplacement(root, receipt) {
    await verifiedReplacementBackup(root, receipt);
    await unlink(path.join(root, receipt.backupPath));
    receipt.backupRemoved = true;
    try {
        await rmdir(receipt.directory);
    }
    catch (error) {
        throw new NativeImportFileError(new Error("Native update committed but staging directory cleanup failed."), [message(error)], [relativePath(root, receipt.directory)]);
    }
}
/** Restore the captured original only after removing the exact published inode. */
export async function rollbackNativeReplacement(root, relative, receipt) {
    if (receipt.backupRemoved)
        throw new NativeRecoveryConflict("The captured original is no longer available for rollback.");
    try {
        await rollbackNativeImportFile(root, relative, receipt.published);
    }
    catch (error) {
        throw new NativeRecoveryConflict(`The published native update could not be safely removed: ${message(error)}`, [receipt.backupPath, ...(error instanceof NativeRecoveryConflict ? error.retainedPaths : [])]);
    }
    try {
        await verifiedReplacementBackup(root, receipt);
        await link(path.join(root, receipt.backupPath), path.join(root, relative));
        await unlink(path.join(root, receipt.backupPath));
        receipt.backupRemoved = true;
        await rmdir(receipt.directory);
    }
    catch (error) {
        throw new NativeRecoveryConflict(`The captured original could not be safely restored: ${message(error)}`, receipt.backupRemoved ? [relativePath(root, receipt.directory)] : [receipt.backupPath]);
    }
}
/** Include every authored sidecar, even when its physical asset is temporarily absent. */
export async function readNativeProjectMetadata(root) {
    const values = [], pending = ["project", "assets"];
    let entries = 0, bytes = 0;
    while (pending.length) {
        const relative = pending.pop();
        if (relative.split("/").length > 64)
            fail("NATIVE_IMPORT_BOUNDS", "Native project metadata exceeds the directory depth limit.");
        const absolute = path.join(root, relative);
        let info;
        try {
            info = await lstat(absolute);
        }
        catch (error) {
            // Only an absent initial subtree is optional; a discovered directory that
            // disappears during the census must not silently hide reserved identities.
            if (missing(error) && (relative === "project" || relative === "assets"))
                continue;
            throw error;
        }
        if (info.isSymbolicLink() || await resolveProjectPath(root, absolute, { mustExist: true }) !== absolute) {
            fail("UNSAFE_SYMLINK", `Native project metadata contains a symbolic link: ${relative}.`);
        }
        if (!info.isDirectory())
            fail("INVALID_RESOURCE", `Native project metadata subtree is not a directory: ${relative}.`);
        const directory = await opendir(absolute);
        for await (const entry of directory) {
            if (++entries > 16384)
                fail("NATIVE_IMPORT_BOUNDS", "Native project identity scan exceeds 16384 entries.");
            const child = `${relative}/${entry.name}`;
            if (entry.isSymbolicLink())
                fail("UNSAFE_SYMLINK", `Native project metadata contains a symbolic link: ${child}.`);
            if (entry.name.toLowerCase().endsWith(".gbsres")) {
                let snapshot;
                try {
                    snapshot = await readNativeImportSnapshot(root, child, 2 * 1024 * 1024);
                }
                catch (error) {
                    if (error instanceof GameStudioProjectError)
                        throw error;
                    throw new GameStudioProjectError("INVALID_RESOURCE", `Cannot read native project metadata: ${child}: ${message(error)}`);
                }
                bytes += snapshot.bytes.length;
                if (bytes > 32 * 1024 * 1024)
                    fail("NATIVE_IMPORT_BOUNDS", "Native project identity scan exceeds 32 MiB of metadata.");
                let value;
                try {
                    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes));
                }
                catch {
                    fail("INVALID_RESOURCE", `Invalid native project metadata: ${child}.`);
                }
                if (!value || typeof value !== "object" || Array.isArray(value))
                    fail("INVALID_RESOURCE", `Native project metadata must be a JSON object: ${child}.`);
                values.push(value);
            }
            else if (entry.isDirectory())
                pending.push(child);
        }
    }
    return values;
}
//# sourceMappingURL=native-import-files.js.map