import { access, lstat, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { assertSafePlatformPath, isPathWithinRoot, readPlatformEnvironmentVariable, runtimeExecutablePaths } from "./platform.js";
// Shared by compilation and reviewed dependency inspection. Selection is not
// a trust claim: reviewed consumers independently match their expected bytes.
function configuredEnvironmentValue(name) {
    return readPlatformEnvironmentVariable(process.env, name);
}
async function exists(candidate) {
    try {
        await access(candidate);
        return true;
    }
    catch {
        return false;
    }
}
async function resolveExistingWithinRoot(root, input) {
    assertSafePlatformPath(input);
    const absolute = path.resolve(root, input);
    if (!isPathWithinRoot(root, absolute))
        throw new Error(`Path escapes the project root: ${input}`);
    const canonical = await realpath(absolute);
    if (!isPathWithinRoot(root, canonical))
        throw new Error(`Path resolves outside the project root: ${input}`);
    return canonical;
}
function gbStudioCliCandidates(toolchainRoot) {
    return runtimeExecutablePaths(toolchainRoot).cliCandidates;
}
async function hasLocalToolchain(candidate) {
    const executables = runtimeExecutablePaths(candidate);
    const markers = [
        executables.gbdkCompiler,
        path.join(candidate, ".local", "apps", "GB Studio.app"),
        path.join(candidate, ".local", "apps", "GB Studio", "GB Studio.exe"),
        path.join(candidate, ".local", "apps", "GB Studio", "gb-studio.exe"),
        path.join(candidate, ".local", "apps", "GB Studio", "GB Studio-win32-x64", "gb-studio.exe"),
        path.join(candidate, ".local", "apps", "GB Studio", "win-unpacked", "GB Studio.exe"),
        path.join(candidate, ".local", "apps", "GB Studio", "app", "GB Studio.exe"),
        executables.emulatorPython,
        ...executables.cliCandidates,
    ];
    const results = await Promise.all(markers.map((marker) => exists(marker)));
    return results.some(Boolean);
}
async function canonicalToolchainOwner(candidate) {
    const root = await realpath(path.resolve(candidate));
    if (!(await stat(root)).isDirectory()) {
        throw new Error("The selected game toolchain root must name an existing directory.");
    }
    const localDirectory = path.join(root, ".local");
    try {
        if (!(await lstat(localDirectory)).isSymbolicLink()) {
            return root;
        }
        const canonicalLocal = await realpath(localDirectory);
        if (path.basename(canonicalLocal) !== ".local" || !(await stat(canonicalLocal)).isDirectory()) {
            throw new Error("A linked game toolchain must resolve to an actual .local directory.");
        }
        return path.dirname(canonicalLocal);
    }
    catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ENOENT") {
            return root;
        }
        throw error;
    }
}
export async function resolveToolchainRoot(projectRoot, configuredRoot) {
    const explicitRoot = configuredRoot ?? configuredEnvironmentValue("GB_STUDIO_TOOLCHAIN_ROOT");
    if (explicitRoot) {
        return canonicalToolchainOwner(explicitRoot);
    }
    let ancestor = projectRoot;
    for (let depth = 0; depth < 8; depth += 1) {
        if (await hasLocalToolchain(ancestor)) {
            return canonicalToolchainOwner(ancestor);
        }
        const parent = path.dirname(ancestor);
        if (parent === ancestor) {
            break;
        }
        ancestor = parent;
    }
    const packageRoot = await realpath(path.resolve(import.meta.dirname, ".."));
    if (await hasLocalToolchain(packageRoot)) {
        return canonicalToolchainOwner(packageRoot);
    }
    return projectRoot;
}
export async function findGbStudioCli(toolchainRoot) {
    for (const candidate of gbStudioCliCandidates(toolchainRoot)) {
        if (await exists(candidate)) {
            return resolveExistingWithinRoot(toolchainRoot, candidate);
        }
    }
    return null;
}
/** Re-run this selection at each strong dependency observation; never retain
 * a formerly selected candidate when a higher-priority one has appeared. */
export async function selectProjectCompiler(projectRoot, configuredRoot) {
    const toolchainRoot = await resolveToolchainRoot(projectRoot, configuredRoot);
    const cliPath = await findGbStudioCli(toolchainRoot);
    return { toolchainRoot, cliPath, compilerRoot: cliPath ? path.resolve(path.dirname(cliPath), "..", "..") : null };
}
//# sourceMappingURL=compiler-selection.js.map