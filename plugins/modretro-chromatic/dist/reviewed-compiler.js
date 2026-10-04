import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { selectProjectCompiler } from "./compiler-selection.js";
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_FILES = 128;
function digest(value) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
export function compilerProfileValid(profile) {
    return Boolean(profile.id) && profile.files.length > 0 && profile.files.length <= MAX_FILES
        && profile.files.some((file) => file.path === "out/cli/gb-studio-cli.js")
        && new Set(profile.files.map((file) => file.path)).size === profile.files.length
        && profile.files.every((file) => file.path.split("/").every((part) => part && part !== "." && part !== "..")
            && !/^[A-Za-z]:|[\\\0]/.test(file.path) && !path.isAbsolute(file.path)
            && Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= MAX_FILE_BYTES
            && /^[a-f0-9]{64}$/.test(file.sha256))
        && profile.files.reduce((sum, file) => sum + file.bytes, 0) <= MAX_TOTAL_BYTES;
}
export function compilerDependenciesValid(files) {
    // Reuse the same path, per-file, total-byte and count predicates. The CLI
    // sentinel is validation-only and never becomes an observed extra input.
    return compilerProfileValid({ id: "supplemental", files: [
            { path: "out/cli/gb-studio-cli.js", bytes: 0, sha256: "0".repeat(64) }, ...files,
        ] });
}
/** Read only the relevant named files of the compiler the ordinary build would
 * select. Re-resolve both before and after reading: a new preferred candidate
 * must invalidate a prepared write even when the old candidate is unchanged.
 * No project JS, compiler, patch function or resolver implementation is run. */
export async function observeReviewedCompiler(projectRoot, profiles, configuredRoot, dependencies = []) {
    const rows = [];
    const reads = new Map();
    let selection;
    let selectionAfter;
    let totalBytes = 0;
    const identity = (info) => [info.dev, info.ino, info.mode, info.nlink, info.uid, info.gid, info.size, info.mtimeMs, info.ctimeMs].join(":");
    const incomplete = (reason) => ({
        fingerprint: digest([profiles, dependencies, selection, selectionAfter, rows, reason]), reason,
    });
    try {
        if (!profiles.length || profiles.some((profile) => !compilerProfileValid(profile))
            || !compilerDependenciesValid(dependencies))
            return incomplete("No valid reviewed compiler profile or supplemental inputs");
        selection = await selectProjectCompiler(projectRoot, configuredRoot);
        if (!selection.cliPath || !selection.compilerRoot)
            return incomplete("The ordinary compiler selection is unavailable");
        const root = selection.compilerRoot;
        if (path.join(root, "out", "cli", "gb-studio-cli.js") !== selection.cliPath)
            return incomplete("Unsupported compiler layout");
        const names = new Set([...profiles.flatMap((profile) => profile.files.map((file) => file.path)), ...dependencies.map((file) => file.path)]);
        if (names.size > MAX_FILES)
            return incomplete("Reviewed compiler input count exceeds its bound");
        for (const relative of [...names].sort()) {
            const filename = path.join(root, ...relative.split("/"));
            const before = await lstat(filename);
            rows.push([relative, identity(before)]);
            if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
                || (process.getuid !== undefined && before.uid !== process.getuid()) || (before.mode & 0o022) !== 0
                || before.size > MAX_FILE_BYTES || totalBytes + before.size > MAX_TOTAL_BYTES
                || await realpath(filename) !== filename)
                return incomplete("Unsafe or excessive reviewed compiler input");
            const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
            try {
                if (identity(await handle.stat()) !== identity(before))
                    return incomplete("Reviewed compiler input changed before reading");
                const buffer = Buffer.alloc(before.size + 1);
                let length = 0;
                while (length < buffer.length) {
                    const result = await handle.read(buffer, length, buffer.length - length, length);
                    if (result.bytesRead === 0)
                        break;
                    length += result.bytesRead;
                }
                const bytes = buffer.subarray(0, length);
                totalBytes += bytes.length;
                const after = await handle.stat();
                const afterPath = await lstat(filename);
                if (bytes.length !== before.size || totalBytes > MAX_TOTAL_BYTES
                    || identity(before) !== identity(after) || identity(after) !== identity(afterPath)
                    || await realpath(filename) !== filename)
                    return incomplete("Reviewed compiler input changed while reading");
                const observation = { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), identity: identity(after) };
                reads.set(relative, observation);
                rows.push([relative, observation]);
            }
            finally {
                await handle.close();
            }
        }
        // The files are one observation, not independent first-seen baselines.
        for (const [relative, observed] of reads) {
            if (identity(await lstat(path.join(root, ...relative.split("/")))) !== observed.identity
                || await realpath(path.join(root, ...relative.split("/"))) !== path.join(root, ...relative.split("/")))
                return incomplete("Reviewed compiler input changed during the complete observation");
        }
        selectionAfter = await selectProjectCompiler(projectRoot, configuredRoot);
        if (JSON.stringify(selectionAfter) !== JSON.stringify(selection))
            return incomplete("Ordinary compiler selection changed during observation");
        const matched = profiles.filter((profile) => profile.files.every((file) => {
            const observed = reads.get(file.path);
            return observed?.bytes === file.bytes && observed.sha256 === file.sha256;
        }));
        if (matched.length !== 1)
            return incomplete(matched.length ? "Ambiguous reviewed compiler profiles" : "The selected compiler inputs differ from the reviewed profile");
        return { fingerprint: digest([profiles, dependencies, selection, rows]), profileId: matched[0].id,
            ...(dependencies.length ? { dependencies: dependencies.map(({ path: name }) => {
                    const observed = reads.get(name);
                    return { path: name, bytes: observed.bytes, sha256: observed.sha256 };
                }) } : {}) };
    }
    catch (error) {
        const code = error && typeof error === "object" && "code" in error ? String(error.code) : "UNAVAILABLE";
        return incomplete("Reviewed compiler observation failed: " + code);
    }
}
//# sourceMappingURL=reviewed-compiler.js.map