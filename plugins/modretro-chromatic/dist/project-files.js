import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readFile, realpath, rename, rm, unlink, } from "node:fs/promises";
import { hostname, userInfo } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { assertSafePlatformPath, isPathWithinRoot, platformPath } from "./platform.js";
import { GameStudioProjectError } from "./project.js";
function isSystemError(error, code) {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
function validateProjectPath(candidate, platform) {
    try {
        assertSafePlatformPath(candidate, platform);
    }
    catch (error) {
        throw new GameStudioProjectError("INVALID_RESOURCE_PATH", `Invalid native game project resource path: ${error instanceof Error ? error.message : String(error)}`, candidate);
    }
}
function platformCandidate(candidate, operations, platform) {
    // Simulated Windows fixtures live on the host's real POSIX filesystem. Still
    // honor both Windows separators so their confinement checks remain genuine.
    return platform === "win32" && operations === path.posix
        ? candidate.replace(/\\/g, "/")
        : candidate;
}
function absoluteProjectPath(root, candidate, platform = process.platform) {
    const operations = platformPath(root, platform);
    const normalizedRoot = platformCandidate(root, operations, platform);
    const normalizedCandidate = platformCandidate(candidate, operations, platform);
    return operations.isAbsolute(normalizedCandidate)
        ? operations.resolve(normalizedCandidate)
        : operations.resolve(normalizedRoot, normalizedCandidate);
}
/** Reject lexical traversal before following or creating any filesystem entry. */
export function assertWithinProject(root, candidate, platform = process.platform) {
    validateProjectPath(root, platform);
    validateProjectPath(candidate, platform);
    const operations = platformPath(root, platform);
    const absoluteRoot = operations.resolve(platformCandidate(root, operations, platform));
    const absoluteCandidate = absoluteProjectPath(absoluteRoot, candidate, platform);
    if (!isPathWithinRoot(absoluteRoot, absoluteCandidate, platform)) {
        throw new GameStudioProjectError("PATH_OUTSIDE_PROJECT", `Refusing to access a path outside the native game project: ${absoluteCandidate}`, absoluteCandidate);
    }
}
export function projectRelativePath(root, candidate, platform = process.platform) {
    assertWithinProject(root, candidate, platform);
    const operations = platformPath(root, platform);
    return operations.relative(operations.resolve(platformCandidate(root, operations, platform)), absoluteProjectPath(root, candidate, platform)).split(operations.sep).join("/");
}
async function assertExistingWindowsAncestorsStayInside(absoluteRoot, absoluteCandidate, canonicalRoot, operations, platform) {
    if (platform !== "win32")
        return;
    const relative = operations.relative(absoluteRoot, absoluteCandidate);
    if (relative === "")
        return;
    let ancestor = absoluteRoot;
    for (const component of relative.split(operations.sep)) {
        ancestor = operations.join(ancestor, component);
        try {
            assertWithinProject(canonicalRoot, await realpath(ancestor), platform);
        }
        catch (error) {
            if (isSystemError(error, "ENOENT"))
                return;
            throw error;
        }
    }
}
/** Resolve existing resources or proposed descendants without trusting escaping symlinks. */
export async function resolveProjectPath(root, candidate, options = {}) {
    const platform = options.platform ?? process.platform;
    validateProjectPath(root, platform);
    validateProjectPath(candidate, platform);
    const operations = platformPath(root, platform);
    const absoluteRoot = operations.resolve(platformCandidate(root, operations, platform));
    const absoluteCandidate = absoluteProjectPath(absoluteRoot, candidate, platform);
    assertWithinProject(absoluteRoot, absoluteCandidate, platform);
    let canonicalRoot;
    try {
        canonicalRoot = await realpath(absoluteRoot);
    }
    catch (error) {
        if (isSystemError(error, "ENOENT")) {
            throw new GameStudioProjectError("RESOURCE_NOT_FOUND", `Native game project root does not exist: ${absoluteRoot}`, absoluteRoot);
        }
        throw error;
    }
    // Windows junctions and other reparse points need not advertise themselves
    // as symbolic links. Check every existing component, not just its endpoint.
    await assertExistingWindowsAncestorsStayInside(absoluteRoot, absoluteCandidate, canonicalRoot, operations, platform);
    let existingAncestor = absoluteCandidate;
    let canonicalAncestor;
    while (true) {
        try {
            canonicalAncestor = await realpath(existingAncestor);
            break;
        }
        catch (error) {
            if (!isSystemError(error, "ENOENT"))
                throw error;
            try {
                const entry = await lstat(existingAncestor);
                if (entry.isSymbolicLink()) {
                    throw new GameStudioProjectError("UNSAFE_SYMLINK", `Refusing to access a dangling symbolic link: ${existingAncestor}`, existingAncestor);
                }
            }
            catch (entryError) {
                if (!isSystemError(entryError, "ENOENT"))
                    throw entryError;
            }
            if (options.mustExist) {
                throw new GameStudioProjectError("RESOURCE_NOT_FOUND", `Resource does not exist: ${absoluteCandidate}`, absoluteCandidate);
            }
            existingAncestor = operations.dirname(existingAncestor);
        }
    }
    assertWithinProject(canonicalRoot, canonicalAncestor, platform);
    const resolved = operations.resolve(canonicalAncestor, operations.relative(existingAncestor, absoluteCandidate));
    assertWithinProject(canonicalRoot, resolved, platform);
    if (options.allowRoot === false && operations.relative(canonicalRoot, resolved) === "") {
        throw new GameStudioProjectError("INVALID_RESOURCE_PATH", "A native project resource path must identify a descendant of the project root", absoluteCandidate);
    }
    return resolved;
}
export async function projectPathExists(root, candidate) {
    try {
        await resolveProjectPath(root, candidate, { mustExist: true });
        return true;
    }
    catch (error) {
        if (error instanceof GameStudioProjectError && error.code === "RESOURCE_NOT_FOUND")
            return false;
        throw error;
    }
}
/** Parse and hash one confined resource from exactly the same filesystem read. */
export async function readProjectJsonWithRevision(root, candidate) {
    const resourcePath = await resolveProjectPath(root, candidate, { mustExist: true, allowRoot: false });
    let parsed;
    let content;
    try {
        content = await readFile(resourcePath);
        parsed = JSON.parse(content.toString("utf8"));
    }
    catch (error) {
        throw new GameStudioProjectError("INVALID_RESOURCE", `Could not parse native project resource ${projectRelativePath(await realpath(root), resourcePath)}: ${error instanceof Error ? error.message : String(error)}`, resourcePath);
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        throw new GameStudioProjectError("INVALID_RESOURCE", `Native project resource must contain a JSON object: ${resourcePath}`, resourcePath);
    }
    return {
        resourcePath,
        json: parsed,
        revision: createHash("sha256").update(content).digest("hex"),
    };
}
export async function readProjectJson(root, candidate) {
    return (await readProjectJsonWithRevision(root, candidate)).json;
}
const RESOURCE_LOCK_TIMEOUT_MS = 5_000;
const RESOURCE_LOCK_POLL_MS = 25;
const PROJECT_LOCK_RECORD_MAX_BYTES = 1_024;
const PROJECT_RECOVERY_MAX_DEPTH = 8;
function resourceLockError(resourcePath, detail) {
    return new GameStudioProjectError("RESOURCE_WRITE_LOCKED", `${detail} No unverified lock was removed; retry only after the blocking owner is known to have released it.`, resourcePath);
}
function resourceLockOwner() {
    if (process.platform === "win32") {
        const user = userInfo();
        const identity = createHash("sha256").update(`${user.homedir.toLowerCase()}\0${user.username.toLowerCase()}`).digest("hex");
        // os.tmpdir() honors caller-controlled TEMP; independent plugin processes must choose the same root.
        return { key: identity, temporaryBase: path.join(user.homedir, "AppData", "Local", "Temp") };
    }
    const uid = BigInt(process.geteuid?.() ?? process.getuid?.() ?? userInfo().uid);
    // /tmp is the host-owned shared namespace; on macOS realpath resolves it to /private/tmp.
    return { uid, key: String(uid), temporaryBase: "/tmp" };
}
function privateResourceLockEntry(entry, uid) {
    return uid === undefined || (entry.uid === uid && (entry.mode & 63n) === 0n);
}
async function resourceLockDirectory(resourcePath) {
    try {
        const owner = resourceLockOwner();
        const temporaryBase = await realpath(owner.temporaryBase);
        const directory = path.join(temporaryBase, `codex-gb-studio-resource-locks-v1-${owner.key}`);
        try {
            await mkdir(directory, { mode: 0o700 });
        }
        catch (error) {
            if (!isSystemError(error, "EEXIST"))
                throw error;
        }
        const entry = await lstat(directory, { bigint: true });
        if (!entry.isDirectory() || entry.isSymbolicLink() || !privateResourceLockEntry(entry, owner.uid)
            || await realpath(directory) !== directory) {
            throw new Error("the per-user lock directory is not a private canonical directory");
        }
        return { directory, uid: owner.uid };
    }
    catch (error) {
        throw resourceLockError(resourcePath, `Cannot establish the private project-resource lock directory: ${error instanceof Error ? error.message : String(error)}.`);
    }
}
async function resourceLockFile(lockPath, resourcePath, uid, maximumLinks = 1n) {
    try {
        const entry = await lstat(lockPath, { bigint: true });
        if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink < 1n || entry.nlink > maximumLinks
            || !privateResourceLockEntry(entry, uid)) {
            throw resourceLockError(resourcePath, "The existing project-resource lock is not a private regular file.");
        }
        return entry;
    }
    catch (error) {
        if (isSystemError(error, "ENOENT"))
            return undefined;
        throw error;
    }
}
function sameResourceLock(left, right) {
    return left.dev === right.dev && left.ino === right.ino;
}
function projectLockRecord(scope, token) {
    return { version: 2, scope, token, pid: process.pid, hostname: hostname(), acquiredAt: new Date().toISOString() };
}
function parseRecoverableProjectLockRecord(content, scope) {
    try {
        const value = JSON.parse(content.toString("utf8"));
        if (typeof value !== "object" || value === null || Array.isArray(value))
            return undefined;
        const record = value;
        if (record.version !== 2 || record.scope !== scope || typeof record.token !== "string"
            || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(record.token)
            || typeof record.pid !== "number" || !Number.isSafeInteger(record.pid) || record.pid < 1 || record.pid > 2_147_483_647
            || typeof record.hostname !== "string" || record.hostname.length < 1 || record.hostname !== hostname()
            || typeof record.acquiredAt !== "string" || !Number.isFinite(Date.parse(record.acquiredAt))
            || new Date(record.acquiredAt).toISOString() !== record.acquiredAt)
            return undefined;
        return record;
    }
    catch {
        return undefined;
    }
}
async function readRecoverableProjectLock(lockPath, resourcePath, uid, scope) {
    const maximumLinks = 2n;
    const initial = await resourceLockFile(lockPath, resourcePath, uid, maximumLinks);
    if (!initial || initial.size < 1n || initial.size > BigInt(PROJECT_LOCK_RECORD_MAX_BYTES))
        return undefined;
    let handle;
    try {
        handle = await open(lockPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    }
    catch (error) {
        if (isSystemError(error, "ENOENT"))
            return undefined;
        throw resourceLockError(resourcePath, `Cannot inspect a project lock owner: ${error instanceof Error ? error.message : String(error)}.`);
    }
    try {
        const opened = await handle.stat({ bigint: true });
        if (!sameResourceLock(initial, opened) || opened.size !== initial.size
            || opened.mtimeNs !== initial.mtimeNs || opened.ctimeNs !== initial.ctimeNs)
            return undefined;
        const content = Buffer.alloc(PROJECT_LOCK_RECORD_MAX_BYTES + 1);
        const { bytesRead } = await handle.read(content, 0, content.length, 0);
        const closed = await handle.stat({ bigint: true });
        if (!sameResourceLock(opened, closed) || closed.size !== BigInt(bytesRead)
            || opened.mtimeNs !== closed.mtimeNs || opened.ctimeNs !== closed.ctimeNs)
            return undefined;
        const record = parseRecoverableProjectLockRecord(content.subarray(0, bytesRead), scope);
        if (!record)
            return undefined;
        const current = await resourceLockFile(lockPath, resourcePath, uid, maximumLinks);
        if (!current || !sameResourceLock(closed, current) || current.size !== closed.size
            || current.mtimeNs !== closed.mtimeNs || current.ctimeNs !== closed.ctimeNs)
            return undefined;
        if (current.nlink === 2n) {
            const staging = await resourceLockFile(projectRecoveryPendingPath(lockPath, record.token), resourcePath, uid, maximumLinks);
            if (!staging || !sameResourceLock(current, staging))
                return undefined;
        }
        return { entry: current, record };
    }
    finally {
        await handle.close();
    }
}
function sameRecoverableProjectLock(left, right) {
    return sameResourceLock(left.entry, right.entry) && left.record.scope === right.record.scope
        && left.record.token === right.record.token && left.record.pid === right.record.pid
        && left.record.hostname === right.record.hostname && left.record.acquiredAt === right.record.acquiredAt;
}
function projectLockOwnerIsDead(record) {
    if (record.hostname !== hostname() || record.pid === process.pid)
        return false;
    try {
        process.kill(record.pid, 0);
        return false;
    }
    catch (error) {
        return isSystemError(error, "ESRCH");
    }
}
function projectRecoveryPath(lockPath, token) {
    const key = createHash("sha256").update(`project-recovery\0${lockPath}\0${token}`).digest("hex");
    return path.join(path.dirname(lockPath), `${key}.recovery`);
}
function projectRecoveryPendingPath(electionPath, token) {
    return `${electionPath}.${token}.pending`;
}
/** Atomically publish already-complete project/election metadata so death cannot strand an empty lock. */
async function publishRecoverableProjectLock(lockPath, resourcePath, scope) {
    const token = randomUUID();
    const pendingPath = projectRecoveryPendingPath(lockPath, token);
    let pending;
    let published = false;
    try {
        pending = await open(pendingPath, "wx", 0o600);
        await pending.writeFile(JSON.stringify(projectLockRecord(scope, token)));
        await pending.sync();
        try {
            await link(pendingPath, lockPath);
            published = true;
        }
        catch (error) {
            if (isSystemError(error, "EEXIST"))
                return undefined;
            throw resourceLockError(resourcePath, `Cannot publish private ${scope} lock metadata: ${error instanceof Error ? error.message : String(error)}.`);
        }
    }
    finally {
        let stagingRemoved = false;
        try {
            try {
                await unlink(pendingPath);
            }
            catch (error) {
                if (!isSystemError(error, "ENOENT"))
                    throw error;
            }
            stagingRemoved = true;
        }
        catch (error) {
            if (published && pending) {
                const held = await pending.stat({ bigint: true });
                const current = await readRecoverableProjectLock(lockPath, resourcePath, resourceLockOwner().uid, scope);
                if (current?.record.token === token && sameResourceLock(held, current.entry)) {
                    try {
                        await unlink(lockPath);
                    }
                    catch (releaseError) {
                        if (!isSystemError(releaseError, "ENOENT"))
                            throw releaseError;
                    }
                }
            }
            throw resourceLockError(resourcePath, `Cannot remove a ${scope} lock staging file: ${error instanceof Error ? error.message : String(error)}.`);
        }
        finally {
            if ((!published || !stagingRemoved) && pending)
                await pending.close();
        }
    }
    return pending ? { token, handle: pending } : undefined;
}
async function publishProjectRecoveryElection(electionPath, resourcePath) {
    const published = await publishRecoverableProjectLock(electionPath, resourcePath, "project-recovery");
    if (!published)
        return undefined;
    await published.handle.close();
    return published.token;
}
async function releaseProjectRecoveryElection(electionPath, resourcePath, uid, token) {
    let handle;
    try {
        handle = await open(electionPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    }
    catch (error) {
        throw resourceLockError(resourcePath, `Cannot release a project lock recovery election: ${error instanceof Error ? error.message : String(error)}.`);
    }
    await releaseResourceLock(handle, electionPath, resourcePath, uid, token);
}
/** Caller holds the token-specific election, so cooperating successors cannot be mistaken for this owner. */
async function removeVerifiedDeadProjectLock(lockPath, resourcePath, uid, stale) {
    const current = await readRecoverableProjectLock(lockPath, resourcePath, uid, stale.record.scope);
    if (!current || !sameRecoverableProjectLock(stale, current) || !projectLockOwnerIsDead(current.record))
        return false;
    const confirmed = await readRecoverableProjectLock(lockPath, resourcePath, uid, stale.record.scope);
    if (!confirmed || !sameRecoverableProjectLock(current, confirmed) || !projectLockOwnerIsDead(confirmed.record))
        return false;
    try {
        await unlink(lockPath);
    }
    catch (error) {
        if (isSystemError(error, "ENOENT"))
            return false;
        throw resourceLockError(resourcePath, `Cannot remove a verified dead project lock owner: ${error instanceof Error ? error.message : String(error)}.`);
    }
    // Any publisher can die between publishing its hard link and removing the unique staging link.
    const pendingPath = projectRecoveryPendingPath(lockPath, stale.record.token);
    const pending = await resourceLockFile(pendingPath, resourcePath, uid);
    if (pending && sameResourceLock(pending, confirmed.entry)) {
        try {
            await unlink(pendingPath);
        }
        catch (error) {
            if (!isSystemError(error, "ENOENT"))
                throw error;
        }
    }
    return true;
}
async function acquireProjectRecoveryElection(electionPath, resourcePath, uid, depth = 0) {
    const existing = await resourceLockFile(electionPath, resourcePath, uid, 2n);
    const token = existing ? undefined : await publishProjectRecoveryElection(electionPath, resourcePath);
    if (token)
        return token;
    if (depth >= PROJECT_RECOVERY_MAX_DEPTH)
        return undefined;
    const stale = await readRecoverableProjectLock(electionPath, resourcePath, uid, "project-recovery");
    if (!stale || !projectLockOwnerIsDead(stale.record))
        return undefined;
    const nextPath = projectRecoveryPath(electionPath, stale.record.token);
    const nextToken = await acquireProjectRecoveryElection(nextPath, resourcePath, uid, depth + 1);
    if (!nextToken)
        return undefined;
    try {
        await removeVerifiedDeadProjectLock(electionPath, resourcePath, uid, stale);
    }
    finally {
        await releaseProjectRecoveryElection(nextPath, resourcePath, uid, nextToken);
    }
    return publishProjectRecoveryElection(electionPath, resourcePath);
}
async function recoverDeadProjectWriteLock(lockPath, resourcePath, uid) {
    const stale = await readRecoverableProjectLock(lockPath, resourcePath, uid, "project");
    if (!stale || !projectLockOwnerIsDead(stale.record))
        return false;
    const electionPath = projectRecoveryPath(lockPath, stale.record.token);
    const electionToken = await acquireProjectRecoveryElection(electionPath, resourcePath, uid);
    if (!electionToken)
        return false;
    try {
        return await removeVerifiedDeadProjectLock(lockPath, resourcePath, uid, stale);
    }
    finally {
        await releaseProjectRecoveryElection(electionPath, resourcePath, uid, electionToken);
    }
}
async function releaseResourceLock(handle, lockPath, resourcePath, uid, token) {
    let held;
    try {
        held = await handle.stat({ bigint: true });
    }
    finally {
        await handle.close();
    } // Do not depend on the operating system's open-file deletion semantics.
    const current = await resourceLockFile(lockPath, resourcePath, uid);
    if (!current || !sameResourceLock(held, current)) {
        throw resourceLockError(resourcePath, "The project-resource lock changed before this writer could release it.");
    }
    if (token !== undefined) {
        let disk;
        try {
            disk = await open(lockPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        }
        catch (error) {
            throw resourceLockError(resourcePath, `Cannot reopen the project-resource lock to verify ownership: ${error instanceof Error ? error.message : String(error)}.`);
        }
        try {
            const observed = await disk.stat({ bigint: true });
            if (!sameResourceLock(held, observed) || JSON.parse(await disk.readFile("utf8")).token !== token) {
                throw resourceLockError(resourcePath, "The project-resource lock ownership changed before release.");
            }
        }
        catch (error) {
            if (error instanceof GameStudioProjectError)
                throw error;
            throw resourceLockError(resourcePath, `Cannot verify ownership of the project-resource lock: ${error instanceof Error ? error.message : String(error)}.`);
        }
        finally {
            await disk.close();
        }
        const rechecked = await resourceLockFile(lockPath, resourcePath, uid);
        if (!rechecked || !sameResourceLock(held, rechecked)) {
            throw resourceLockError(resourcePath, "The project-resource lock changed while this writer was releasing it.");
        }
    }
    try {
        await unlink(lockPath);
    }
    catch (error) {
        throw resourceLockError(resourcePath, `Cannot release the verified project-resource lock: ${error instanceof Error ? error.message : String(error)}.`);
    }
}
/**
 * Serialize cooperating plugin writers on one existing canonical owner path in the same host filesystem namespace.
 * The lock lives outside the authored project and never takes over an abandoned/unknown owner. Editors and tools that
 * do not use this helper are not locked; read the fresh owner and recheck its revision just before replacing it.
 */
export async function withProjectResourceWriteLock(root, candidate, operation, options = {}) {
    return withCanonicalProjectWriteLock(root, candidate, "resource", operation, options);
}
/** Gate public mutations; only a positively dead local owner with unchanged private metadata can be recovered. */
export async function withProjectWriteLock(root, operation, options = {}) {
    return withCanonicalProjectWriteLock(root, root, "project", operation, options);
}
async function withCanonicalProjectWriteLock(root, candidate, scope, operation, options) {
    const timeoutMs = options.timeoutMs ?? (scope === "project" ? 30_000 : RESOURCE_LOCK_TIMEOUT_MS);
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30_000) {
        throw new GameStudioProjectError("INVALID_INPUT", "A project-resource write lock timeout must be an integer between 0 and 30000 milliseconds", candidate);
    }
    const pathOptions = { mustExist: true, allowRoot: scope === "project" };
    const resourcePath = await resolveProjectPath(root, candidate, pathOptions);
    const entry = await lstat(resourcePath);
    if (scope === "project" ? !entry.isDirectory() : !entry.isFile()) {
        throw new GameStudioProjectError("INVALID_RESOURCE", `A project-${scope} write lock requires an existing ${scope === "project" ? "directory" : "regular file"}`, resourcePath);
    }
    const { directory, uid } = await resourceLockDirectory(resourcePath);
    // Preserve the existing resource key so older participating writers still exclude one another.
    const key = createHash("sha256").update(scope === "project" ? `project-root\0${resourcePath}` : resourcePath).digest("hex");
    const lockPath = path.join(directory, `${key}.lock`);
    const deadline = performance.now() + timeoutMs;
    while (true) {
        let handle;
        let token;
        if (scope === "project") {
            const existing = await resourceLockFile(lockPath, resourcePath, uid, 2n);
            const published = existing ? undefined : await publishRecoverableProjectLock(lockPath, resourcePath, "project");
            handle = published?.handle;
            token = published?.token;
        }
        else {
            try {
                handle = await open(lockPath, "wx", 0o600);
                token = randomUUID();
            }
            catch (error) {
                if (!isSystemError(error, "EEXIST")) {
                    throw resourceLockError(resourcePath, `Cannot acquire the project-resource lock: ${error instanceof Error ? error.message : String(error)}.`);
                }
            }
        }
        if (!handle || !token) {
            await resourceLockFile(lockPath, resourcePath, uid, scope === "project" ? 2n : 1n);
            if (scope === "project" && await recoverDeadProjectWriteLock(lockPath, resourcePath, uid))
                continue;
            const remaining = deadline - performance.now();
            if (remaining <= 0)
                throw resourceLockError(resourcePath, "Timed out waiting for another writer of this project resource.");
            await delay(Math.min(RESOURCE_LOCK_POLL_MS, remaining));
            continue;
        }
        let recorded = scope === "project";
        let callbackFailed = false;
        let callbackError;
        try {
            if (scope === "resource") {
                await handle.writeFile(JSON.stringify({ version: 1, token, pid: process.pid, acquiredAt: new Date().toISOString() }));
                await handle.sync();
                recorded = true;
            }
            if (await resolveProjectPath(root, candidate, pathOptions) !== resourcePath) {
                throw resourceLockError(resourcePath, "The authored resource resolved to a different canonical path while waiting for its lock.");
            }
            return await operation();
        }
        catch (error) {
            callbackFailed = true;
            callbackError = error;
            throw error;
        }
        finally {
            try {
                await releaseResourceLock(handle, lockPath, resourcePath, uid, recorded ? token : undefined);
            }
            catch (error) {
                if (callbackFailed)
                    throw new AggregateError([callbackError, error], "The project-resource operation failed and its lock could not be safely released.");
                throw error;
            }
        }
    }
}
/** Replace exact resource bytes without following its target symlink or leaking temporary files. */
export async function writeProjectBytesAtomic(root, candidate, value) {
    const absoluteCandidate = absoluteProjectPath(root, candidate);
    const resourcePath = await resolveProjectPath(root, absoluteCandidate, { allowRoot: false });
    const parentPath = path.dirname(resourcePath);
    await mkdir(parentPath, { recursive: true });
    const safeParent = await resolveProjectPath(root, parentPath, { mustExist: true });
    try {
        const entry = await lstat(absoluteCandidate);
        if (entry.isSymbolicLink()) {
            throw new GameStudioProjectError("UNSAFE_SYMLINK", `Refusing to overwrite symbolic link ${absoluteCandidate}`, absoluteCandidate);
        }
    }
    catch (error) {
        if (!isSystemError(error, "ENOENT"))
            throw error;
    }
    // Recheck after creating parents so an exchanged ancestor cannot escape the root.
    const confirmedTarget = await resolveProjectPath(root, absoluteCandidate, { allowRoot: false });
    if (path.dirname(confirmedTarget) !== safeParent || confirmedTarget !== resourcePath) {
        throw new GameStudioProjectError("UNSAFE_SYMLINK", `The native project resource location changed while preparing ${absoluteCandidate}`, absoluteCandidate);
    }
    const temporaryPath = path.join(safeParent, `.${path.basename(resourcePath)}.${process.pid}.${randomUUID()}.tmp`);
    let handle;
    try {
        handle = await open(temporaryPath, "wx", 0o600);
        await handle.writeFile(value);
        await handle.sync();
        await handle.close();
        handle = undefined;
        await rename(temporaryPath, resourcePath);
    }
    catch (error) {
        if (handle)
            await handle.close();
        await rm(temporaryPath, { force: true });
        throw error;
    }
}
/** Preserve the native, indented JSON resource encoding and trailing newline. */
export async function writeProjectJsonAtomic(root, candidate, value) {
    await writeProjectBytesAtomic(root, candidate, Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"));
}
export async function resourceRevision(root, candidate) {
    const resourcePath = await resolveProjectPath(root, candidate, { mustExist: true, allowRoot: false });
    return createHash("sha256").update(await readFile(resourcePath)).digest("hex");
}
/** Preserve the UUID-v5-compatible IDs used by existing scene and actor authoring. */
export function stableResourceId(...parts) {
    const bytes = createHash("sha256").update(parts.join("\u0000")).digest();
    bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
    bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
    const hexadecimal = bytes.subarray(0, 16).toString("hex");
    return `${hexadecimal.slice(0, 8)}-${hexadecimal.slice(8, 12)}-${hexadecimal.slice(12, 16)}-${hexadecimal.slice(16, 20)}-${hexadecimal.slice(20, 32)}`;
}
export function resourceSlug(value, fallback = "resource") {
    const slug = value
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
    return slug || fallback;
}
export function nextResourceIndex(resources) {
    return resources.reduce((highest, resource) => {
        const index = resource._index;
        return typeof index === "number" && Number.isFinite(index)
            ? Math.max(highest, index)
            : highest;
    }, -1) + 1;
}
//# sourceMappingURL=project-files.js.map