import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { constants, createReadStream } from "node:fs";
import { link, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile, } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectRom, runBuildCommand } from "./build.js";
import { assertSafePlatformPath, isPathWithinRoot, readPlatformEnvironmentVariable, runtimeExecutablePaths, sanitizeSubprocessEnvironment, verifyWindowsPrivatePath, } from "./platform.js";
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;
const MAX_ARTIFACT_FILES = 4_096;
const MAX_ARTIFACT_BYTES = 128 * 1024 * 1024;
const MANIFEST_FILENAME = ".codex-web-build.json";
const WASM_MAGIC = Buffer.from([0x00, 0x61, 0x73, 0x6d]);
const BUILD_LOCKS = new Map();
// Project-local files cannot authenticate themselves. Durable signing material
// belongs only to a private toolchain directory outside the selected project.
const PROCESS_WEB_BUILD_ATTESTATION_KEY = randomBytes(32);
const TRUSTED_WEB_BUILD_KEYS = new Map();
const MAX_WINDOWS_PUBLISH_RETRIES = 6;
function isInside(root, candidate, platform = process.platform) {
    return isPathWithinRoot(root, candidate, platform);
}
function samePath(left, right, platform = process.platform) {
    if (platform === "win32") {
        return path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
    }
    return left === right;
}
function runtimeOptions(options) {
    const platform = options.platform ?? process.platform;
    const delay = options.retryDelayMs ?? 20;
    if (!Number.isInteger(delay) || delay < 0 || delay > 1_000) {
        throw new Error("Web build retryDelayMs must be an integer between 0 and 1000.");
    }
    return {
        platform,
        localAppData: options.localAppData,
        inspectWindowsAcl: options.inspectWindowsAcl,
        rename: options.rename ?? rename,
        retryDelayMs: delay,
    };
}
function environmentValue(environment, name, platform) {
    const value = readPlatformEnvironmentVariable(environment, name, platform);
    return typeof value === "string" && value.trim() ? value : undefined;
}
function isSystemError(error, code) {
    return typeof error === "object" && error !== null && "code" in error && error.code === code;
}
async function exists(candidate) {
    try {
        await lstat(candidate);
        return true;
    }
    catch (error) {
        if (isSystemError(error, "ENOENT"))
            return false;
        throw error;
    }
}
async function resolveExistingFile(root, input, runtime) {
    assertSafePlatformPath(input, runtime.platform);
    const candidate = path.resolve(root, input);
    if (!isInside(root, candidate, runtime.platform))
        throw new Error(`Project input escapes the project root: ${input}`);
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink() || !metadata.isFile()) {
        throw new Error(`Project input must be a real regular file: ${input}`);
    }
    const canonical = await realpath(candidate);
    if (!samePath(canonical, candidate, runtime.platform) || !isInside(root, canonical, runtime.platform)) {
        throw new Error(`Project input resolves through a symbolic link or outside the project root: ${input}`);
    }
    return canonical;
}
async function resolveExistingAncestor(root, candidate, runtime) {
    let ancestor = candidate;
    while (true) {
        try {
            const canonical = await realpath(ancestor);
            if (!samePath(canonical, ancestor, runtime.platform) || !isInside(root, canonical, runtime.platform)) {
                throw new Error(`Web output resolves through a symbolic link or outside the project root: ${candidate}`);
            }
            return;
        }
        catch (error) {
            if (!isSystemError(error, "ENOENT"))
                throw error;
            const parent = path.dirname(ancestor);
            if (samePath(parent, ancestor, runtime.platform) || !isInside(root, parent, runtime.platform)) {
                throw new Error(`Web output escapes the project root: ${candidate}`);
            }
            ancestor = parent;
        }
    }
}
async function resolveOutput(root, input, runtime) {
    if (typeof input !== "string" || input.trim().length === 0 || input.includes("\0")) {
        throw new Error("Web output must name a non-empty project-relative build directory.");
    }
    assertSafePlatformPath(input, runtime.platform);
    const output = path.resolve(root, input);
    const buildRoot = path.join(root, "build");
    if (samePath(output, buildRoot, runtime.platform) || !isInside(buildRoot, output, runtime.platform)) {
        throw new Error("Web output must be a directory inside the selected project's build directory.");
    }
    await resolveExistingAncestor(root, output, runtime);
    if (await exists(output)) {
        const metadata = await lstat(output);
        if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
            throw new Error("Web output must be a real directory, not a file or symbolic link.");
        }
    }
    return output;
}
function cliCandidates(root, runtime) {
    return runtimeExecutablePaths(root, runtime.platform).cliCandidates;
}
async function canonicalToolchainRoot(candidate) {
    const root = await realpath(path.resolve(candidate));
    if (!(await stat(root)).isDirectory()) {
        throw new Error("The selected game toolchain root must name an existing directory.");
    }
    const local = path.join(root, ".local");
    if (await exists(local)) {
        const metadata = await lstat(local);
        if (metadata.isSymbolicLink()) {
            const canonical = await realpath(local);
            if (path.basename(canonical) !== ".local" || !(await stat(canonical)).isDirectory()) {
                throw new Error("A linked game toolchain must resolve to an actual .local directory.");
            }
            return path.dirname(canonical);
        }
    }
    return root;
}
async function discoverToolchainRoot(projectRoot, runtime, configuredRoot) {
    const explicitRoot = configuredRoot ?? process.env.GB_STUDIO_TOOLCHAIN_ROOT;
    if (explicitRoot)
        return canonicalToolchainRoot(explicitRoot);
    let current = projectRoot;
    for (let depth = 0; depth < 8; depth += 1) {
        if ((await Promise.all(cliCandidates(current, runtime).map((candidate) => exists(candidate)))).some(Boolean)) {
            return canonicalToolchainRoot(current);
        }
        const parent = path.dirname(current);
        if (parent === current)
            break;
        current = parent;
    }
    const packageRoot = await realpath(path.resolve(import.meta.dirname, ".."));
    if ((await Promise.all(cliCandidates(packageRoot, runtime).map((candidate) => exists(candidate)))).some(Boolean)) {
        return canonicalToolchainRoot(packageRoot);
    }
    return projectRoot;
}
async function findOfficialCli(projectRoot, runtime, configuredRoot) {
    const root = await discoverToolchainRoot(projectRoot, runtime, configuredRoot);
    for (const candidate of cliCandidates(root, runtime)) {
        if (!(await exists(candidate)))
            continue;
        const metadata = await lstat(candidate);
        if (metadata.isSymbolicLink() || !metadata.isFile()) {
            throw new Error("The official game CLI must be a real regular file.");
        }
        const canonical = await realpath(candidate);
        if (!isInside(root, canonical)) {
            throw new Error("The official game CLI resolves outside its selected toolchain root.");
        }
        return { cliPath: canonical, toolchainRoot: root };
    }
    throw new Error('The official GB Studio CLI is unavailable in the selected toolchain. Use the packaged setup skill to prepare runtime,build and bind the resulting toolchain before building. toolchain_doctor with tasks:["projectBuild"] checks readiness; it does not install dependencies.');
}
async function trustedOwnedDirectory(directory, uid, privateDirectory) {
    try {
        const metadata = await lstat(directory);
        return (!metadata.isSymbolicLink() && metadata.isDirectory() && metadata.uid === uid &&
            (metadata.mode & (privateDirectory ? 0o077 : 0o022)) === 0 &&
            (await realpath(directory)) === directory);
    }
    catch {
        return false;
    }
}
async function windowsPrivatePath(candidate, runtime, purpose) {
    return verifyWindowsPrivatePath(candidate, {
        platform: runtime.platform,
        purpose,
        inspectAcl: runtime.inspectWindowsAcl,
    });
}
async function windowsSigningDirectory(toolchainRoot, projectRoot, runtime) {
    const configured = runtime.localAppData ?? environmentValue(process.env, "LOCALAPPDATA", runtime.platform);
    if (!configured)
        return null;
    let localDirectory;
    try {
        assertSafePlatformPath(configured, runtime.platform);
        const requested = path.resolve(configured);
        const requestedMetadata = await lstat(requested);
        if (requestedMetadata.isSymbolicLink() || !requestedMetadata.isDirectory())
            return null;
        localDirectory = await realpath(requested);
        if (!samePath(localDirectory, requested, runtime.platform))
            return null;
        if (!(await windowsPrivatePath(localDirectory, runtime, "secret")))
            return null;
    }
    catch {
        return null;
    }
    const toolchainIdentity = createHash("sha256")
        .update(path.win32.normalize(toolchainRoot).toLowerCase())
        .digest("hex");
    let current = localDirectory;
    for (const segment of ["Codex", "GBStudio", "WebPreview", toolchainIdentity]) {
        current = path.join(current, segment);
        if (isInside(projectRoot, current, runtime.platform))
            return null;
        try {
            try {
                await mkdir(current, { mode: 0o700 });
            }
            catch (error) {
                if (!isSystemError(error, "EEXIST"))
                    return null;
            }
            const metadata = await lstat(current);
            if (metadata.isSymbolicLink() || !metadata.isDirectory() ||
                !samePath(await realpath(current), current, runtime.platform) ||
                !(await windowsPrivatePath(current, runtime, "secret")))
                return null;
        }
        catch {
            return null;
        }
    }
    return current;
}
async function loadTrustedSigningKey(toolchainRoot, projectRoot, runtime) {
    const windows = runtime.platform === "win32";
    const uid = !windows && typeof process.getuid === "function" ? process.getuid() : undefined;
    if (!windows && uid === undefined)
        return null;
    const localDirectory = windows
        ? undefined
        : path.join(toolchainRoot, ".local");
    if (!windows && !(await trustedOwnedDirectory(localDirectory, uid, false)))
        return null;
    const keyDirectory = windows
        ? await windowsSigningDirectory(toolchainRoot, projectRoot, runtime)
        : path.join(localDirectory, ".codex-web-cache");
    if (!keyDirectory)
        return null;
    const keyPath = path.join(keyDirectory, "attestation.key");
    try {
        if (!windows) {
            try {
                await mkdir(keyDirectory, { mode: 0o700 });
            }
            catch (error) {
                if (!isSystemError(error, "EEXIST"))
                    return null;
            }
            if (!(await trustedOwnedDirectory(keyDirectory, uid, true)))
                return null;
        }
        if (!(await exists(keyPath))) {
            const temporaryPath = path.join(keyDirectory, `.attestation-${randomBytes(12).toString("hex")}`);
            let created;
            try {
                created = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL |
                    (windows ? 0 : (constants.O_NOFOLLOW ?? 0)), 0o600);
                await created.writeFile(randomBytes(32));
                await created.sync();
            }
            finally {
                await created?.close();
            }
            try {
                // A hard link publishes a fully written private key atomically without
                // allowing simultaneous processes to replace one another's key.
                await link(temporaryPath, keyPath);
            }
            catch (error) {
                if (!isSystemError(error, "EEXIST"))
                    throw error;
            }
            finally {
                await unlink(temporaryPath).catch(() => { });
            }
        }
        const before = await lstat(keyPath);
        if (before.isSymbolicLink() || !before.isFile() ||
            !samePath(await realpath(keyPath), keyPath, runtime.platform) ||
            (windows && !(await windowsPrivatePath(keyPath, runtime, "secret"))))
            return null;
        const descriptor = await open(keyPath, constants.O_RDONLY | (windows ? 0 : (constants.O_NOFOLLOW ?? 0)));
        try {
            const metadata = await descriptor.stat();
            if (!metadata.isFile() || metadata.size !== 32 ||
                (!windows && (metadata.uid !== uid || (metadata.mode & 0o777) !== 0o600)))
                return null;
            const bytes = Buffer.alloc(33);
            const result = await descriptor.read(bytes, 0, bytes.length, 0);
            if (result.bytesRead !== 32)
                return null;
            const named = await lstat(keyPath);
            if (named.isSymbolicLink() || named.dev !== metadata.dev || named.ino !== metadata.ino ||
                !samePath(await realpath(keyPath), keyPath, runtime.platform) ||
                (windows
                    ? !(await windowsPrivatePath(keyDirectory, runtime, "secret")) ||
                        !(await windowsPrivatePath(keyPath, runtime, "secret"))
                    : !(await trustedOwnedDirectory(keyDirectory, uid, true)) ||
                        !(await trustedOwnedDirectory(localDirectory, uid, false))))
                return null;
            return Buffer.from(bytes.subarray(0, 32));
        }
        finally {
            await descriptor.close();
        }
    }
    catch {
        return null;
    }
}
async function signingKey(projectRoot, toolchainRoot, runtime) {
    // A project-owned or overlapping toolchain can be modified through normal
    // project authoring, so it must never contain a trusted durable secret.
    if (isInside(projectRoot, toolchainRoot, runtime.platform) ||
        isInside(toolchainRoot, projectRoot, runtime.platform)) {
        return PROCESS_WEB_BUILD_ATTESTATION_KEY;
    }
    const cacheKey = runtime.platform === "win32"
        ? `win32:${toolchainRoot.toLowerCase()}:${(runtime.localAppData ?? environmentValue(process.env, "LOCALAPPDATA", runtime.platform) ?? "").toLowerCase()}`
        : toolchainRoot;
    let trusted = TRUSTED_WEB_BUILD_KEYS.get(cacheKey);
    if (!trusted) {
        trusted = loadTrustedSigningKey(toolchainRoot, projectRoot, runtime);
        TRUSTED_WEB_BUILD_KEYS.set(cacheKey, trusted);
    }
    return (await trusted) ?? PROCESS_WEB_BUILD_ATTESTATION_KEY;
}
async function hashFile(filePath) {
    const digest = createHash("sha256");
    for await (const chunk of createReadStream(filePath))
        digest.update(chunk);
    return digest.digest("hex");
}
function updateHash(digest, value) {
    const encoded = Buffer.from(value, "utf8");
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(encoded.byteLength);
    digest.update(length).update(encoded);
}
async function hashSourceDirectory(root, directory, digest) {
    if (!(await exists(directory)))
        return;
    const metadata = await lstat(directory);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() || (await realpath(directory)) !== directory) {
        throw new Error("game source directories must be real directories inside the selected project.");
    }
    const entries = (await readdir(directory, { withFileTypes: true }))
        .sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
    for (const entry of entries) {
        const candidate = path.join(directory, entry.name);
        const entryMetadata = await lstat(candidate);
        if (entryMetadata.isSymbolicLink()) {
            throw new Error(`game source fingerprint refuses symbolic links: ${path.relative(root, candidate)}`);
        }
        if (entryMetadata.isDirectory()) {
            await hashSourceDirectory(root, candidate, digest);
            continue;
        }
        if (!entryMetadata.isFile()) {
            throw new Error(`game source fingerprint refuses non-regular files: ${path.relative(root, candidate)}`);
        }
        updateHash(digest, path.relative(root, candidate).split(path.sep).join("/"));
        updateHash(digest, await hashFile(candidate));
    }
}
async function sourceFingerprint(root, projectPath, revision) {
    const digest = createHash("sha256").update("codex-gb-studio\0web-export\0v1\0");
    if (revision !== undefined) {
        if (typeof revision !== "string" || revision.length === 0 || revision.length > 1_024 || revision.includes("\0")) {
            throw new Error("Project revision must be a non-empty string of at most 1024 characters.");
        }
        updateHash(digest, "indexed-revision");
        updateHash(digest, revision);
    }
    else {
        updateHash(digest, path.relative(root, projectPath).split(path.sep).join("/"));
        updateHash(digest, await hashFile(projectPath));
        await hashSourceDirectory(root, path.join(root, "project"), digest);
        await hashSourceDirectory(root, path.join(root, "assets"), digest);
    }
    // ProjectReadAccess revisions intentionally omit custom plugins, but those
    // extensions can alter the real ROM and web template. Always include them.
    updateHash(digest, "project-plugins");
    await hashSourceDirectory(root, path.join(root, "plugins"), digest);
    return digest.digest("hex");
}
async function collectArtifacts(root) {
    const files = [];
    let totalBytes = 0;
    async function visit(directory) {
        const entries = (await readdir(directory, { withFileTypes: true }))
            .sort((left, right) => Buffer.compare(Buffer.from(left.name), Buffer.from(right.name)));
        for (const entry of entries) {
            const candidate = path.join(directory, entry.name);
            const relative = path.relative(root, candidate).split(path.sep).join("/");
            if (relative === MANIFEST_FILENAME)
                continue;
            const metadata = await lstat(candidate);
            if (metadata.isSymbolicLink()) {
                throw new Error(`Official game web export must not contain symbolic links: ${relative}`);
            }
            if (metadata.isDirectory()) {
                await visit(candidate);
                continue;
            }
            if (!metadata.isFile()) {
                throw new Error(`Official game web export contains a non-regular artifact: ${relative}`);
            }
            files.push({ path: relative, sha256: await hashFile(candidate), sizeBytes: metadata.size });
            totalBytes += metadata.size;
            if (files.length > MAX_ARTIFACT_FILES || totalBytes > MAX_ARTIFACT_BYTES) {
                throw new Error("Official game web export exceeds its bounded artifact budget.");
            }
        }
    }
    await visit(root);
    return files;
}
async function validateArtifacts(root, sourceRevision, attestationKey) {
    const files = await collectArtifacts(root);
    const index = files.find((entry) => entry.path === "index.html" && entry.sizeBytes > 0);
    if (!index)
        throw new Error("Official game web export did not produce a real non-empty index.html.");
    const scripts = files.filter((entry) => entry.path.toLowerCase().endsWith(".js") && entry.sizeBytes > 0);
    if (scripts.length === 0)
        throw new Error("Official game web export did not produce its JavaScript player.");
    const wasmFiles = files.filter((entry) => entry.path.toLowerCase().endsWith(".wasm") && entry.sizeBytes >= 8);
    let validWasm = false;
    for (const candidate of wasmFiles) {
        const bytes = await readFile(path.join(root, candidate.path));
        if (bytes.subarray(0, WASM_MAGIC.length).equals(WASM_MAGIC)) {
            validWasm = true;
            break;
        }
    }
    if (!validWasm)
        throw new Error("Official game web export did not produce a valid WebAssembly emulator.");
    const roms = files.filter((entry) => /\.(?:gb|gbc)$/iu.test(entry.path));
    if (roms.length !== 1) {
        throw new Error("Official game web export must contain exactly one genuine Game Boy ROM.");
    }
    const rom = roms[0];
    const metadata = await inspectRom(path.join(root, rom.path), root);
    if (!metadata.valid)
        throw new Error("Official game web export contains an invalid Game Boy ROM.");
    const unsigned = {
        version: 1,
        builder: "gb-studio-cli",
        sourceRevision,
        indexPath: index.path,
        romPath: rom.path,
        files,
    };
    const signature = createHmac("sha256", attestationKey)
        .update("codex-gb-studio\0trusted-web-build\0v1\0")
        .update(JSON.stringify(unsigned))
        .digest("hex");
    return { ...unsigned, signature };
}
async function readCachedManifest(root, sourceRevision, attestationKey) {
    const manifestPath = path.join(root, MANIFEST_FILENAME);
    try {
        const metadata = await lstat(manifestPath);
        if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.size > MAX_ARTIFACT_BYTES)
            return null;
        const decoded = JSON.parse(await readFile(manifestPath, "utf8"));
        if (typeof decoded !== "object" || decoded === null ||
            !("version" in decoded) || decoded.version !== 1 ||
            !("builder" in decoded) || decoded.builder !== "gb-studio-cli" ||
            !("sourceRevision" in decoded) || decoded.sourceRevision !== sourceRevision ||
            !("indexPath" in decoded) || decoded.indexPath !== "index.html" ||
            !("romPath" in decoded) || typeof decoded.romPath !== "string" ||
            !("files" in decoded) || !Array.isArray(decoded.files) ||
            !("signature" in decoded) || typeof decoded.signature !== "string" ||
            !/^[a-f\d]{64}$/u.test(decoded.signature))
            return null;
        const actual = await validateArtifacts(root, sourceRevision, attestationKey);
        if (decoded.romPath !== actual.romPath ||
            JSON.stringify(decoded.files) !== JSON.stringify(actual.files) ||
            !timingSafeEqual(Buffer.from(decoded.signature, "hex"), Buffer.from(actual.signature, "hex")))
            return null;
        return actual;
    }
    catch {
        return null;
    }
}
async function trustedCompilerTemporaryParent(projectRoot, runtime) {
    const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
    const localData = runtime.localAppData ?? environmentValue(process.env, "LOCALAPPDATA", runtime.platform);
    const candidates = runtime.platform === "win32"
        ? [...(localData ? [path.join(localData, "Temp")] : []), os.tmpdir()]
        : [os.tmpdir(), "/tmp"];
    const inspected = new Set();
    for (const candidate of candidates) {
        try {
            assertSafePlatformPath(candidate, runtime.platform);
            const provided = path.resolve(candidate);
            const entry = await lstat(provided);
            // /tmp is a system alias for /private/tmp on macOS; arbitrary
            // environment-selected symbolic links are never trusted.
            if (entry.isSymbolicLink() && (runtime.platform === "win32" || provided !== "/tmp"))
                continue;
            const canonical = await realpath(provided);
            const identity = runtime.platform === "win32" ? canonical.toLowerCase() : canonical;
            if (inspected.has(identity) || isInside(projectRoot, canonical, runtime.platform))
                continue;
            inspected.add(identity);
            const metadata = await stat(canonical);
            if (!metadata.isDirectory())
                continue;
            if (runtime.platform === "win32") {
                if (await windowsPrivatePath(canonical, runtime, "temporary"))
                    return canonical;
                continue;
            }
            const privateOwned = uid !== undefined && metadata.uid === uid && (metadata.mode & 0o022) === 0;
            const stickySystem = (metadata.mode & 0o1000) !== 0 &&
                (metadata.uid === 0 || (uid !== undefined && metadata.uid === uid));
            if (privateOwned || stickySystem)
                return canonical;
        }
        catch {
            // Reject hostile, missing, and inaccessible environment candidates.
        }
    }
    throw new Error("No trusted system temporary directory exists outside the selected native game project.");
}
async function createIsolatedCompilerDirectory(projectRoot, runtime, resources) {
    const parent = await trustedCompilerTemporaryParent(projectRoot, runtime);
    const directory = await mkdtemp(path.join(parent, "gbs-web-"));
    resources.allocations.push({ kind: "temporary", path: directory, returnedAt: new Date().toISOString() });
    resources.temporary = await resourceIdentity(directory);
    try {
        const metadata = await lstat(directory);
        if (metadata.isSymbolicLink() || !metadata.isDirectory() ||
            !samePath(await realpath(directory), directory, runtime.platform) ||
            !samePath(path.dirname(directory), parent, runtime.platform) ||
            isInside(projectRoot, directory, runtime.platform) ||
            (runtime.platform === "win32" && !(await windowsPrivatePath(directory, runtime, "temporary")))) {
            throw new Error("The official game web compiler temporary directory is unsafe.");
        }
        return { directory, parent };
    }
    catch (error) {
        // The caller independently closes both allocations and preserves errors.
        throw error;
    }
}
async function removeIsolatedCompilerDirectory(directory, parent, runtime, expected) {
    if (!samePath(await realpath(parent), parent, runtime.platform)) {
        throw new Error("Refusing to remove a game web compiler directory from an altered temporary parent.");
    }
    if (!samePath(path.dirname(directory), parent, runtime.platform) ||
        !/^gbs-web-[A-Za-z\d]{6}$/u.test(path.basename(directory))) {
        throw new Error("Refusing to remove an unexpected game web compiler temporary directory.");
    }
    const metadata = await lstat(directory);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() ||
        metadata.dev !== expected.identity.dev || metadata.ino !== expected.identity.ino ||
        !samePath(await realpath(directory), directory, runtime.platform) ||
        (runtime.platform === "win32" && !(await windowsPrivatePath(directory, runtime, "temporary")))) {
        throw new Error("Refusing to remove a relocated game web compiler temporary directory.");
    }
    await rm(directory, { recursive: true, force: true });
}
async function resourceIdentity(directory) {
    const entry = await lstat(directory);
    if (!entry.isDirectory() || entry.isSymbolicLink() || await realpath(directory) !== directory) {
        throw new Error("Refusing an unsafe web-build resource directory.");
    }
    return { path: directory, identity: { dev: entry.dev, ino: entry.ino, uid: entry.uid, mode: entry.mode }, cleanup: "pending" };
}
async function verifyResource(resource) {
    const actual = await resourceIdentity(resource.path);
    if (JSON.stringify(actual.identity) !== JSON.stringify(resource.identity)) {
        throw new Error("Refusing to remove a replaced web-build resource directory.");
    }
}
async function sampleResource(resource) {
    const sample = {
        at: new Date().toISOString(), entries: 0, logicalBytes: 0, allocatedBytes: 0, complete: false,
    };
    resource.snapshot = sample;
    try {
        await verifyResource(resource);
        const visit = async (candidate) => {
            const entry = await lstat(candidate);
            if (++sample.entries > 32_768)
                throw new Error("Resource sample entry limit reached.");
            sample.logicalBytes += entry.size;
            sample.allocatedBytes += entry.blocks * 512;
            if (sample.logicalBytes > MAX_ARTIFACT_BYTES)
                throw new Error("Resource sample byte limit reached.");
            if (entry.isDirectory() && !entry.isSymbolicLink()) {
                for (const name of await readdir(candidate))
                    await visit(path.join(candidate, name));
            }
        };
        await visit(resource.path);
        await verifyResource(resource);
        sample.complete = true;
    }
    catch (error) {
        sample.error = error instanceof Error ? error.message : String(error);
    }
}
function exportIdentity(manifest) {
    return {
        rom: { ...manifest.files.find((entry) => entry.path === manifest.romPath) },
        index: { ...manifest.files.find((entry) => entry.path === manifest.indexPath) },
        inventorySha256: createHash("sha256").update(JSON.stringify(manifest.files)).digest("hex"),
        files: manifest.files.length,
        logicalBytes: manifest.files.reduce((sum, entry) => sum + entry.sizeBytes, 0),
    };
}
/** Preserve resource outcomes for public callers while keeping thrown validation errors. */
export function webBuildFailureResult(error) {
    return error instanceof Error && "webBuildResult" in error
        ? error.webBuildResult : undefined;
}
function compilerEnvironment(temporaryDirectory, runtime) {
    const result = sanitizeSubprocessEnvironment(process.env, runtime.platform, temporaryDirectory);
    const disallowed = new Set([
        "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "NODE_REPL_HISTORY",
        "BASH_ENV", "ENV", "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP",
        "PYTHONUSERBASE", "PYTHONWARNINGS", "VIRTUAL_ENV",
    ]);
    for (const name of Object.keys(result)) {
        const normalized = name.toUpperCase();
        if (disallowed.has(normalized) || normalized.startsWith("UV_") ||
            normalized === "TMPDIR" || normalized === "TMP" || normalized === "TEMP")
            delete result[name];
    }
    result.TMPDIR = temporaryDirectory;
    result.TMP = temporaryDirectory;
    result.TEMP = temporaryDirectory;
    return result;
}
function commandFailure(error) {
    if (!(error instanceof Error))
        return { exitCode: null, stdout: "", stderr: String(error) };
    const failure = error;
    return {
        exitCode: typeof failure.code === "number" ? failure.code : null,
        stdout: failure.stdout?.toString() ?? "",
        stderr: failure.stderr?.toString() || failure.message,
    };
}
async function retryPlatformRename(projectRoot, source, destination, runtime, expectedSource) {
    const attempts = runtime.platform === "win32" ? MAX_WINDOWS_PUBLISH_RETRIES : 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        if (runtime.platform === "win32") {
            for (const candidate of [source, destination]) {
                assertSafePlatformPath(candidate, runtime.platform);
                if (!isInside(projectRoot, candidate, runtime.platform)) {
                    throw new Error("Refusing to publish a web export outside the selected project.");
                }
                const parent = path.dirname(candidate);
                const parentMetadata = await lstat(parent);
                if (parentMetadata.isSymbolicLink() || !parentMetadata.isDirectory() ||
                    !samePath(await realpath(parent), parent, runtime.platform) ||
                    !isInside(projectRoot, parent, runtime.platform)) {
                    throw new Error("Refusing to publish through a relocated or reparse-point web output parent.");
                }
            }
            const sourceMetadata = await lstat(source);
            if (sourceMetadata.isSymbolicLink() || !sourceMetadata.isDirectory() ||
                !samePath(await realpath(source), source, runtime.platform)) {
                throw new Error("Refusing to publish a relocated or reparse-point web output directory.");
            }
            if (await exists(destination)) {
                throw new Error("Refusing to overwrite an unexpected web output inserted during publication.");
            }
        }
        try {
            // Sampling is best effort; publication must authenticate the allocation
            // immediately before each rename, including a platform retry.
            if (expectedSource)
                await verifyResource(expectedSource);
            await runtime.rename(source, destination);
            return;
        }
        catch (error) {
            const retryable = isSystemError(error, "EPERM") || isSystemError(error, "EBUSY") ||
                isSystemError(error, "EACCES") || isSystemError(error, "ENOTEMPTY");
            if (runtime.platform !== "win32" || !retryable || attempt + 1 >= attempts)
                throw error;
            const delay = runtime.retryDelayMs * (attempt + 1);
            if (delay > 0)
                await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
}
async function replaceOutput(root, staged, output, runtime, resources) {
    await resolveExistingAncestor(root, path.dirname(output), runtime);
    const staging = resources.staging;
    if (!staging || staging.path !== staged)
        throw new Error("Web publication has no matching staging allocation.");
    // Refuse before moving an existing export aside as well as at the rename.
    await verifyResource(staging);
    if (!(await exists(output))) {
        await retryPlatformRename(root, staged, output, runtime, staging);
        resources.staging.cleanup = "published";
        return;
    }
    const metadata = await lstat(output);
    if (metadata.isSymbolicLink() || !metadata.isDirectory() ||
        !samePath(await realpath(output), output, runtime.platform)) {
        throw new Error("Refusing to replace a relocated or symbolic-link game web output.");
    }
    const backup = await mkdtemp(path.join(path.dirname(output), ".web-previous-"));
    resources.allocations.push({ kind: "previous", path: backup, returnedAt: new Date().toISOString() });
    resources.previous = await resourceIdentity(backup);
    await verifyResource(resources.previous);
    await rm(backup, { recursive: true, force: true });
    resources.previous.cleanup = "removed";
    await retryPlatformRename(root, output, backup, runtime);
    resources.previous = await resourceIdentity(backup);
    resources.previous.cleanup = "retained";
    await sampleResource(resources.previous);
    try {
        await retryPlatformRename(root, staged, output, runtime, staging);
        resources.staging.cleanup = "published";
    }
    catch (error) {
        try {
            await verifyResource(resources.previous);
            await retryPlatformRename(root, backup, output, runtime);
            resources.previous.cleanup = "restored";
        }
        catch (rollbackError) {
            resources.previous.error = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
            resources.cleanupErrors.push(`Previous export rollback: ${resources.previous.error}`);
        }
        throw error;
    }
    await verifyResource(resources.previous);
    await rm(backup, { recursive: true, force: true });
    resources.previous.cleanup = "removed";
}
async function withOutputLock(output, operation) {
    const previous = BUILD_LOCKS.get(output) ?? Promise.resolve();
    const current = previous.catch(() => { }).then(operation);
    const cleanup = current.then(() => { }, () => { });
    BUILD_LOCKS.set(output, cleanup);
    try {
        return await current;
    }
    finally {
        if (BUILD_LOCKS.get(output) === cleanup)
            BUILD_LOCKS.delete(output);
    }
}
/** Export the real, official game/Binjgb web player without inventing an HTML wrapper. */
export async function buildWeb(options, platformOptions = {}) {
    const runtime = runtimeOptions(platformOptions);
    assertSafePlatformPath(options.projectRoot, runtime.platform);
    const root = await realpath(path.resolve(options.projectRoot));
    if (!(await stat(root)).isDirectory())
        throw new Error("The selected project root must be a real directory.");
    if (options.force !== undefined && typeof options.force !== "boolean") {
        throw new Error("force must be a boolean.");
    }
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > MAX_TIMEOUT_MS) {
        throw new Error(`timeoutMs must be an integer between 1000 and ${MAX_TIMEOUT_MS}.`);
    }
    const source = await resolveExistingFile(root, options.projectPath, runtime);
    if (path.extname(source).toLowerCase() !== ".gbsproj") {
        throw new Error("The official game web exporter requires a .gbsproj project file.");
    }
    const outputPath = await resolveOutput(root, options.outputPath ?? path.join("build", "web"), runtime);
    return withOutputLock(outputPath, async () => {
        const sourceRevision = await sourceFingerprint(root, source, options.revision);
        const official = await findOfficialCli(root, runtime, options.toolchainRoot);
        const cli = official.cliPath;
        const attestationKey = await signingKey(root, official.toolchainRoot, runtime);
        const command = process.execPath;
        const publishedArgs = [cli, "make:web", source, outputPath];
        const startedAt = performance.now();
        const resources = {
            allocations: [],
            attestation: {
                storage: attestationKey === PROCESS_WEB_BUILD_ATTESTATION_KEY ? "process-only" : "trusted-key-reused-or-created",
                // A process-local fallback does not prove that no durable allocation was attempted.
                persistentKeyBytes: attestationKey === PROCESS_WEB_BUILD_ATTESTATION_KEY ? null : 32,
                allocationObserved: false,
            },
            measurementScope: "bounded post-compiler samples, not peak usage; attestation directory allocation unobserved",
            cleanupErrors: [],
        };
        const result = {
            success: false, builder: "gb-studio-cli", command, args: publishedArgs,
            exitCode: null, stdout: "", stderr: "", durationMs: 0, outputPath,
            indexPath: null, romPath: null, cached: false, sourceRevision,
            sourceIdentityScope: options.revision === undefined
                ? "descriptor, project, assets and plugin contents" : "selected indexed revision plus plugin contents",
            execution: { status: "unrun" }, resources,
        };
        let failure;
        let temporary;
        try {
            if (options.signal?.aborted)
                throw Object.assign(new Error("The web build was cancelled before compilation."), { name: "AbortError" });
            if (!options.force && (await exists(outputPath))) {
                const cached = await readCachedManifest(outputPath, sourceRevision, attestationKey);
                if (cached) {
                    if (await sourceFingerprint(root, source, options.revision) !== sourceRevision) {
                        throw new Error("Selected web-build source revision or plugin contents changed during cache validation.");
                    }
                    result.success = true;
                    result.cached = true;
                    result.indexPath = path.join(outputPath, cached.indexPath);
                    result.romPath = path.join(outputPath, cached.romPath);
                    result.exportIdentity = exportIdentity(cached);
                    return result;
                }
            }
            if (options.cacheOnly)
                throw new Error("No unchanged, verified web export is available. Cache-only preview will not compile or replace it.");
            await mkdir(path.dirname(outputPath), { recursive: true });
            await resolveExistingAncestor(root, path.dirname(outputPath), runtime);
            const staging = await mkdtemp(path.join(path.dirname(outputPath), ".web-stage-"));
            resources.allocations.push({ kind: "staging", path: staging, returnedAt: new Date().toISOString() });
            resources.staging = await resourceIdentity(staging);
            temporary = await createIsolatedCompilerDirectory(root, runtime, resources);
            const actualArgs = [cli, "make:web", source, staging];
            const child = { descendants: "unobserved" };
            result.execution = { status: "attempted", args: actualArgs, cwd: root, child };
            try {
                const output = await runBuildCommand(command, actualArgs, {
                    cwd: root, timeoutMs, environment: compilerEnvironment(temporary.directory, runtime),
                    signal: options.signal, evidence: child,
                });
                result.stdout = output.stdout;
                result.stderr = output.stderr;
                result.exitCode = child.close?.code ?? null;
            }
            catch (error) {
                Object.assign(result, commandFailure(error));
                result.error = error instanceof Error ? error.message : String(error);
                return result;
            }
            // This is a second selected-input fingerprint, not a continuous source lock.
            if (await sourceFingerprint(root, source, options.revision) !== sourceRevision) {
                throw new Error("Selected web-build source revision or plugin contents changed during compilation.");
            }
            const manifest = await validateArtifacts(staging, sourceRevision, attestationKey);
            await writeFile(path.join(staging, MANIFEST_FILENAME), JSON.stringify(manifest, null, 2) + "\n", {
                encoding: "utf8", flag: "wx", mode: 0o600,
            });
            await sampleResource(resources.staging);
            await replaceOutput(root, staging, outputPath, runtime, resources);
            result.success = true;
            result.indexPath = path.join(outputPath, manifest.indexPath);
            result.romPath = path.join(outputPath, manifest.romPath);
            result.exportIdentity = exportIdentity(manifest);
            return result;
        }
        catch (error) {
            failure = error;
            result.error = error instanceof Error ? error.message : String(error);
            throw error;
        }
        finally {
            const child = result.execution.child;
            if (child?.spawnedAt)
                result.execution.status = "started";
            const unsettled = child?.cleanupWarning ?? (child?.startedAt && !child.close ? "Compiler close was not observed." : undefined);
            // One cleanup failure must neither hide the original error nor skip the other allocation.
            for (const [kind, resource] of [["staging", resources.staging], ["temporary", resources.temporary]]) {
                if (!resource || resource.cleanup === "published")
                    continue;
                if (unsettled) {
                    resource.cleanup = "unresolved";
                    resource.error = unsettled;
                    resources.cleanupErrors.push(kind + ": " + unsettled);
                    continue;
                }
                try {
                    await sampleResource(resource);
                    await verifyResource(resource);
                    if (kind === "temporary") {
                        await removeIsolatedCompilerDirectory(resource.path, temporary?.parent ?? path.dirname(resource.path), runtime, resource);
                    }
                    else
                        await rm(resource.path, { recursive: true, force: true });
                    resource.cleanup = "removed";
                }
                catch (error) {
                    resource.cleanup = "unresolved";
                    resource.error = error instanceof Error ? error.message : String(error);
                    resources.cleanupErrors.push(kind + ": " + resource.error);
                }
            }
            if (resources.cleanupErrors.length) {
                result.success = false;
                result.error ??= "Web-build resource cleanup was not confirmed.";
            }
            result.durationMs = Math.round(performance.now() - startedAt);
            if (failure instanceof Error)
                Object.assign(failure, { webBuildResult: result });
        }
    });
}
//# sourceMappingURL=web-build.js.map