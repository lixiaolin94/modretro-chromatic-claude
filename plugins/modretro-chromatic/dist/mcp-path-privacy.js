import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isPathWithinRoot, platformPath } from "./platform.js";
/** Stable replacement that preserves response shapes without identifying a host path. */
export const REDACTED_MCP_PATH = "[path outside authorized workspace]";
const PATH_BODY = String.raw `[^\s"'\x60<>[\]{}(),;|]*`;
const PATH_TOKEN = new RegExp(String.raw `(?:file:(?:\/\/|\\\/\\\/)(?:localhost)?(?:\/|\\\/)?|(?<![A-Za-z\d_.:\/-])(?:[A-Za-z]:[\\/]|\\?\/|%2F))${PATH_BODY}`, "gu");
const WINDOWS_PATH_TOKEN = new RegExp(String.raw `(?:file:(?:\/\/|\\\/\\\/)(?:localhost)?(?:\/|\\\/)?|(?<![A-Za-z\d_.:\/-])(?:[A-Za-z]:(?:[\\/]|%5[cC]|%2[fF])|\\\\(?:\?\\|\.\\)?|\/\/(?=[^\/\s])|(?:%5[cC]){2}|\\?\/|%2F))${PATH_BODY}`, "giu");
function escapeExpression(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function physicallyResolved(candidate, platform) {
    const paths = platformPath(candidate, platform);
    if (!paths.isAbsolute(candidate))
        return undefined;
    // A lexical Windows drive or UNC path cannot be resolved on the Unix hosts
    // used by platform-injected tests. Actual Windows always verifies realpath.
    if (platform === "win32" && process.platform !== "win32" && paths === path.win32) {
        return paths.normalize(paths.resolve(candidate));
    }
    const missing = [];
    let existing = paths.resolve(candidate);
    while (true) {
        try {
            const resolved = realpathSync.native(existing);
            return paths.resolve(resolved, ...missing.reverse());
        }
        catch (error) {
            if (!(error instanceof Error) || !("code" in error) ||
                (error.code !== "ENOENT" && error.code !== "ENOTDIR")) {
                return undefined;
            }
            const parent = paths.dirname(existing);
            if (parent === existing)
                return undefined;
            missing.push(paths.basename(existing));
            existing = parent;
        }
    }
}
function rootAliases(root, platform) {
    if (root === undefined || root.trim().length === 0 || !platformPath(root, platform).isAbsolute(root)) {
        return new Set();
    }
    const paths = platformPath(root, platform);
    const aliases = new Set([paths.resolve(root)]);
    const physical = physicallyResolved(root, platform);
    if (physical !== undefined)
        aliases.add(physical);
    for (const alias of [...aliases]) {
        if (platform === "win32") {
            aliases.add(alias.replaceAll("\\", "/"));
            aliases.add(alias.replaceAll("\\", "\\\\"));
        }
        const encoded = encodeURI(alias);
        aliases.add(encoded);
        aliases.add(alias.replaceAll("/", "\\/"));
        aliases.add(encoded.replaceAll("/", "\\/"));
    }
    return aliases;
}
function candidatePath(value, platform) {
    let decoded = value.replaceAll("\\/", "/");
    if (decoded.toLowerCase().startsWith("file://")) {
        try {
            decoded = fileURLToPath(decoded, { windows: platform === "win32" });
        }
        catch {
            decoded = decoded.replace(/^file:\/\/(?:localhost)?/, "");
        }
    }
    if (decoded.includes("%")) {
        try {
            decoded = decodeURIComponent(decoded);
        }
        catch {
            // Invalid percent encoding cannot turn an external path into an authorized path.
        }
    }
    return platformPath(decoded, platform).isAbsolute(decoded) ||
        /^[A-Za-z]:[\\/]/.test(decoded) ||
        (platform === "win32" && /^[A-Za-z]:(?![\\/])/.test(decoded))
        ? decoded
        : undefined;
}
function rootExpression(root, platform) {
    const escaped = platform === "win32"
        ? [...root].map((character) => character === "\\" || character === "/"
            ? "[\\\\/]"
            : escapeExpression(character)).join("")
        : escapeExpression(root);
    if (platform === "win32") {
        return new RegExp(String.raw `(?<![A-Za-z\d_.-])(?:file:(?:\/\/|\\\/\\\/)(?:localhost)?)?${escaped}(?=$|[\\/\s"'\x60<>[\]{}(),;|]|%(?:2[fF]|5[cC]))(?:(?:[\\/]|%(?:2[fF]|5[cC]))${PATH_BODY})?`, "giu");
    }
    return new RegExp(String.raw `(?<![A-Za-z\d_.-])(?:file:(?:\/\/|\\\/\\\/)(?:localhost)?)?${escaped}(?=$|[\\/\s"'\x60<>[\]{}(),;|])(?:[\\/]${PATH_BODY})?`, "gu");
}
function stringSanitizer(options) {
    const platform = options.platform ?? process.platform;
    const configuredRoot = options.workspaceRoot;
    const getWorkspace = typeof configuredRoot === "function"
        ? configuredRoot
        : () => configuredRoot;
    return (input) => {
        const configuredWorkspace = getWorkspace();
        const physicalWorkspace = configuredWorkspace === undefined
            ? undefined
            : physicallyResolved(configuredWorkspace, platform);
        const workspaceRoots = new Set();
        for (const alias of [configuredWorkspace, ...(options.workspaceAliases ?? [])]) {
            if (alias === undefined)
                continue;
            const physicalAlias = physicallyResolved(alias, platform);
            if (physicalWorkspace !== undefined && physicalAlias !== undefined &&
                isPathWithinRoot(physicalWorkspace, physicalAlias, platform) &&
                isPathWithinRoot(physicalAlias, physicalWorkspace, platform)) {
                for (const root of rootAliases(alias, platform))
                    workspaceRoots.add(root);
            }
        }
        const secrets = new Set();
        for (const root of [
            options.runtimeRoot,
            options.toolchainRoot,
            options.pythonPath,
            options.home,
            ...(options.homeAliases ?? []),
            process.execPath,
        ]) {
            for (const alias of rootAliases(root, platform))
                secrets.add(alias);
        }
        const protectedValues = [];
        let placeholderPrefix = "\u0000codex-gb-authorized-";
        while (input.includes(placeholderPrefix))
            placeholderPrefix += "-";
        // Tool result fields often contain one whole filesystem path, which may
        // legitimately contain spaces. Preserve or redact the complete value before
        // applying text-oriented tokenization to compiler prose.
        const completeCandidate = candidatePath(input, platform);
        if (completeCandidate !== undefined) {
            const physical = physicallyResolved(completeCandidate, platform);
            return physicalWorkspace !== undefined && physical !== undefined &&
                isPathWithinRoot(physicalWorkspace, physical, platform)
                ? input
                : REDACTED_MCP_PATH;
        }
        let sanitized = input;
        for (const root of [...workspaceRoots].sort((left, right) => right.length - left.length)) {
            sanitized = sanitized.replace(rootExpression(root, platform), (matched) => {
                const candidate = candidatePath(matched, platform);
                const physical = candidate === undefined ? undefined : physicallyResolved(candidate, platform);
                if (physicalWorkspace === undefined || physical === undefined ||
                    !isPathWithinRoot(physicalWorkspace, physical, platform)) {
                    return REDACTED_MCP_PATH;
                }
                const index = protectedValues.push(matched) - 1;
                return `${placeholderPrefix}${index}\u0000`;
            });
        }
        for (const root of [...secrets].sort((left, right) => right.length - left.length)) {
            sanitized = sanitized.replace(rootExpression(root, platform), REDACTED_MCP_PATH);
        }
        sanitized = sanitized.replace(platform === "win32" ? WINDOWS_PATH_TOKEN : PATH_TOKEN, (matched) => {
            const candidate = candidatePath(matched, platform);
            const physical = candidate === undefined ? undefined : physicallyResolved(candidate, platform);
            if (physicalWorkspace !== undefined && physical !== undefined &&
                isPathWithinRoot(physicalWorkspace, physical, platform)) {
                return matched;
            }
            return REDACTED_MCP_PATH;
        });
        for (let index = 0; index < protectedValues.length; index += 1) {
            sanitized = sanitized.replace(`${placeholderPrefix}${index}\u0000`, protectedValues[index]);
        }
        return sanitized;
    };
}
function redactValue(value, sanitizeString) {
    if (typeof value === "string")
        return sanitizeString(value);
    if (Array.isArray(value))
        return value.map((entry) => redactValue(entry, sanitizeString));
    if (value === null || typeof value !== "object")
        return value;
    const record = value;
    const preserveBinary = record.type === "image" || record.type === "audio";
    const output = {};
    for (const [key, entry] of Object.entries(record)) {
        let sanitizedKey = sanitizeString(key);
        if (Object.hasOwn(output, sanitizedKey)) {
            let suffix = 2;
            while (Object.hasOwn(output, `${sanitizedKey}#${suffix}`))
                suffix += 1;
            sanitizedKey = `${sanitizedKey}#${suffix}`;
        }
        output[sanitizedKey] = preserveBinary && key === "data" ? entry : redactValue(entry, sanitizeString);
    }
    return output;
}
/**
 * Create an opt-in MCP response sanitizer. Direct build/doctor calls remain untouched;
 * only a server explicitly configured with workspace-only visibility is affected.
 */
export function createMcpPathPrivacy(options) {
    if (options.visibility === undefined || options.visibility.trim().length === 0) {
        return (value) => value;
    }
    if (options.visibility !== "workspace-only") {
        throw new Error("GB_STUDIO_MCP_PATH_VISIBILITY must be unset or workspace-only.");
    }
    const sanitizeString = stringSanitizer(options);
    return (value) => redactValue(value, sanitizeString);
}
//# sourceMappingURL=mcp-path-privacy.js.map