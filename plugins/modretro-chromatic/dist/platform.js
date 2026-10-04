import { execFile } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
const UNSAFE_SUBPROCESS_VARIABLES = new Set([
    "NODE_OPTIONS",
    "NODE_PATH",
    "NODE_EXTRA_CA_CERTS",
    "NODE_REPL_HISTORY",
    "PYTHONPATH",
    "PYTHONHOME",
    "PYTHONSTARTUP",
    "PYTHONUSERBASE",
    "PYTHONWARNINGS",
    "PYTHONINSPECT",
    "PYTHONBREAKPOINT",
    "VIRTUAL_ENV",
    "CONDA_PREFIX",
    "BASH_ENV",
    "ENV",
]);
const TEMPORARY_VARIABLES = new Set(["TMP", "TEMP", "TMPDIR"]);
const WINDOWS_POWERSHELL_VARIABLES = new Set([
    "PSMODULEPATH",
    "PSMODULEANALYSISCACHEPATH",
    "PSEXECUTIONPOLICYPREFERENCE",
    "__PSLOCKDOWNPOLICY",
]);
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/iu;
const WINDOWS_DEVICE_NAMESPACE = /^[\\/]{2}[?.](?:[\\/]|$)/u;
/** Native joins keep injected Windows-layout fixtures runnable on Unix hosts. */
export function runtimeExecutablePaths(root, platform = process.platform) {
    const windows = platform === "win32";
    const apps = path.join(root, ".local", "apps");
    const vendorCli = path.join(root, ".local", "vendor", "gb-studio", "out", "cli", "gb-studio-cli.js");
    const macApplication = path.join(apps, "GB Studio.app");
    const macCli = path.join(macApplication, "Contents", "Resources", "app", "out", "cli", "gb-studio-cli.js");
    const windowsApplication = path.join(apps, "GB Studio");
    const windowsUnpacked = path.join(windowsApplication, "win-unpacked");
    const cliCandidates = windows
        ? [
            vendorCli,
            path.join(windowsApplication, "resources", "app", "out", "cli", "gb-studio-cli.js"),
            path.join(windowsUnpacked, "resources", "app", "out", "cli", "gb-studio-cli.js"),
        ]
        : [vendorCli, macCli];
    const desktopCandidates = windows
        ? [
            path.join(windowsApplication, "GB Studio-win32-x64", "gb-studio.exe"),
            path.join(windowsApplication, "gb-studio.exe"),
            path.join(windowsApplication, "GB Studio.exe"),
            path.join(windowsUnpacked, "GB Studio.exe"),
            path.join(windowsApplication, "app", "GB Studio.exe"),
        ]
        : platform === "darwin"
            ? [macApplication, path.join(path.sep, "Applications", "GB Studio.app")]
            : [path.join(apps, "gb-studio-linux.AppImage"), path.join(apps, "gb-studio-linux-arm64.AppImage")];
    return {
        gbdkCompiler: path.join(root, ".local", "gbdk", "bin", windows ? "lcc.exe" : "lcc"),
        emulatorPython: path.join(root, ".local", "pyboy-venv", windows ? "Scripts" : "bin", windows ? "python.exe" : "python"),
        cliCandidates,
        desktopCandidates,
    };
}
/** Select Windows lexical rules without making simulated Unix fixtures unusable. */
export function platformPath(root, platform = process.platform) {
    if (platform !== "win32")
        return path;
    if (path.sep !== "\\" &&
        root.startsWith("/") && !root.startsWith("//") && !root.includes("\\")) {
        return path.posix;
    }
    return path.win32;
}
/** Reject Windows-only alternate streams, device names, and ambiguous aliases. */
export function assertSafePlatformPath(input, platform = process.platform) {
    if (typeof input !== "string" || input.includes("\0")) {
        throw new TypeError("A filesystem path must be a string without NUL characters.");
    }
    if (platform !== "win32")
        return;
    if (input.length === 0)
        throw new TypeError("A Windows filesystem path cannot be empty.");
    if (WINDOWS_DEVICE_NAMESPACE.test(input)) {
        throw new TypeError("Windows device namespace paths are not permitted.");
    }
    if (/^[\\/]{2}/u.test(input)) {
        throw new TypeError("Windows network-share and UNC paths are not permitted.");
    }
    if (/^[A-Za-z]:(?![\\/])/u.test(input)) {
        throw new TypeError("Drive-relative Windows paths are ambiguous and are not permitted.");
    }
    const components = input.split(/[\\/]+/u);
    for (let index = 0; index < components.length; index += 1) {
        const component = components[index];
        if (component.length === 0 || component === "." || component === "..")
            continue;
        if (index === 0 && /^[A-Za-z]:$/u.test(component))
            continue;
        if (component.includes(":")) {
            throw new TypeError("Windows alternate data streams and embedded drive names are not permitted.");
        }
        if (/[<>"|?*\u0000-\u001f]/u.test(component)) {
            throw new TypeError("A Windows filesystem path contains a reserved character.");
        }
        if (/[. ]$/u.test(component)) {
            throw new TypeError("Windows filesystem path components cannot end with a dot or space.");
        }
        if (WINDOWS_RESERVED_NAME.test(component)) {
            throw new TypeError("Reserved Windows device filenames are not permitted.");
        }
    }
}
/** Check canonical or lexical containment with the selected platform's path rules. */
export function isPathWithinRoot(root, candidate, platform = process.platform) {
    try {
        assertSafePlatformPath(root, platform);
        assertSafePlatformPath(candidate, platform);
        const operations = platformPath(root, platform);
        if (!operations.isAbsolute(root))
            return false;
        const absoluteRoot = operations.resolve(root);
        const normalizedCandidate = operations === path.posix && platform === "win32"
            ? candidate.replaceAll("\\", "/")
            : candidate;
        const absoluteCandidate = operations.resolve(absoluteRoot, normalizedCandidate);
        const relative = operations.relative(platform === "win32" ? absoluteRoot.toLowerCase() : absoluteRoot, platform === "win32" ? absoluteCandidate.toLowerCase() : absoluteCandidate);
        return relative === "" ||
            (relative !== ".." && !relative.startsWith(`..${operations.sep}`) && !operations.isAbsolute(relative));
    }
    catch {
        return false;
    }
}
/** Resolve case-insensitive Windows environment names without permitting collisions. */
export function readPlatformEnvironmentVariable(environment, name, platform = process.platform) {
    if (platform !== "win32")
        return environment[name];
    const normalizedName = name.toUpperCase();
    let value;
    let found = false;
    for (const [key, candidate] of Object.entries(environment)) {
        if (key.toUpperCase() !== normalizedName)
            continue;
        if (found && candidate !== value) {
            throw new TypeError(`Conflicting case-insensitive Windows environment values exist for ${name}.`);
        }
        found = true;
        value = candidate;
    }
    return value;
}
function hasNoReparseAncestorsSync(candidate) {
    let current = candidate;
    while (true) {
        if (lstatSync(current).isSymbolicLink())
            return false;
        const parent = path.dirname(current);
        if (parent === current)
            return true;
        current = parent;
    }
}
function trustedWindowsCommandInterpreter(systemRoot, validator) {
    assertSafePlatformPath(systemRoot, "win32");
    const operations = platformPath(systemRoot, "win32");
    if (!operations.isAbsolute(systemRoot)) {
        throw new TypeError("The Windows SystemRoot must be an absolute, canonical local directory.");
    }
    const requested = operations.resolve(systemRoot);
    const candidate = operations.join(requested, "System32", "cmd.exe");
    assertSafePlatformPath(candidate, "win32");
    if (validator !== undefined && process.platform !== "win32") {
        if (!validator(requested, candidate)) {
            throw new TypeError("The Windows SystemRoot or command interpreter failed trusted validation.");
        }
        return { systemRoot: requested, commandPath: candidate };
    }
    try {
        const rootMetadata = lstatSync(requested);
        if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory() || !hasNoReparseAncestorsSync(requested)) {
            throw new Error("SystemRoot is not a real directory");
        }
        const canonicalRoot = realpathSync.native(requested);
        if (operations.relative(requested, canonicalRoot) !== "") {
            throw new Error("SystemRoot resolves through a redirected path");
        }
        const commandMetadata = lstatSync(candidate);
        if (commandMetadata.isSymbolicLink() || !commandMetadata.isFile() || !hasNoReparseAncestorsSync(candidate)) {
            throw new Error("cmd.exe is not a real regular executable");
        }
        const canonicalCommand = realpathSync.native(candidate);
        if (operations.relative(candidate, canonicalCommand) !== "") {
            throw new Error("cmd.exe resolves through a redirected path");
        }
        return { systemRoot: canonicalRoot, commandPath: canonicalCommand };
    }
    catch (error) {
        throw new TypeError(`The Windows SystemRoot must contain a trusted, canonical System32/cmd.exe: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/** Keep operating-system launch variables while excluding hostile project configuration. */
export function sanitizeSubprocessEnvironment(environment, platform = process.platform, trustedTemporaryDirectory, options = {}) {
    const windows = platform === "win32";
    const output = {};
    const preserved = new Map();
    const certificateAuthority = options.preserveCertificateAuthority
        ? readPlatformEnvironmentVariable(environment, "NODE_EXTRA_CA_CERTS", platform)
        : undefined;
    const configuredSystemRoot = windows
        ? readPlatformEnvironmentVariable(environment, "SystemRoot", "win32")
        : undefined;
    // Even values that will be replaced must not have conflicting Windows aliases.
    if (windows) {
        readPlatformEnvironmentVariable(environment, "COMSPEC", "win32");
        for (const variable of WINDOWS_POWERSHELL_VARIABLES) {
            readPlatformEnvironmentVariable(environment, variable, "win32");
        }
    }
    if (windows && configuredSystemRoot === undefined && process.platform === "win32") {
        throw new TypeError("Windows subprocess execution requires a trusted absolute SystemRoot.");
    }
    const commandInterpreter = windows && configuredSystemRoot !== undefined
        ? trustedWindowsCommandInterpreter(configuredSystemRoot, options.validateWindowsSystemRoot)
        : undefined;
    for (const [key, value] of Object.entries(environment)) {
        const normalized = windows ? key.toUpperCase() : key;
        if (UNSAFE_SUBPROCESS_VARIABLES.has(normalized) ||
            normalized.startsWith("UV_") ||
            (windows && WINDOWS_POWERSHELL_VARIABLES.has(normalized)) ||
            (windows && (normalized === "COMSPEC" || normalized === "SYSTEMROOT")) ||
            (trustedTemporaryDirectory !== undefined && TEMPORARY_VARIABLES.has(normalized))) {
            continue;
        }
        if (windows) {
            const previous = preserved.get(normalized);
            if (previous !== undefined) {
                if (previous.value !== value) {
                    throw new TypeError(`Conflicting case-insensitive Windows environment values exist for ${key}.`);
                }
                continue;
            }
            preserved.set(normalized, { key, value });
        }
        output[key] = value;
    }
    if (trustedTemporaryDirectory !== undefined) {
        assertSafePlatformPath(trustedTemporaryDirectory, platform);
        output.TMPDIR = trustedTemporaryDirectory;
        output.TMP = trustedTemporaryDirectory;
        output.TEMP = trustedTemporaryDirectory;
    }
    if (certificateAuthority !== undefined)
        output.NODE_EXTRA_CA_CERTS = certificateAuthority;
    if (commandInterpreter !== undefined) {
        output.SystemRoot = commandInterpreter.systemRoot;
        output.COMSPEC = commandInterpreter.commandPath;
    }
    return output;
}
const WINDOWS_ACL_PROBE = [
    "$ErrorActionPreference = 'Stop'",
    "$target = [System.IO.Path]::GetFullPath($env:CODEX_GB_ACL_TARGET)",
    "$purpose = $env:CODEX_GB_ACL_PURPOSE",
    "$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()",
    "$user = $identity.User.Value",
    "$acl = if ([System.IO.Directory]::Exists($target)) { " +
        "[System.IO.Directory]::GetAccessControl($target) " +
        "} else { [System.IO.File]::GetAccessControl($target) }",
    "$owner = $acl.GetOwner([System.Security.Principal.SecurityIdentifier]).Value",
    "if ($owner -ne $user) { exit 11 }",
    "$trusted = @($user, 'S-1-5-18', 'S-1-5-32-544')",
    "$dangerous = [System.Security.AccessControl.FileSystemRights]::Write -bor " +
        "[System.Security.AccessControl.FileSystemRights]::Modify -bor " +
        "[System.Security.AccessControl.FileSystemRights]::FullControl -bor " +
        "[System.Security.AccessControl.FileSystemRights]::Delete -bor " +
        "[System.Security.AccessControl.FileSystemRights]::ChangePermissions -bor " +
        "[System.Security.AccessControl.FileSystemRights]::TakeOwnership",
    "$readable = [System.Security.AccessControl.FileSystemRights]::Read -bor " +
        "[System.Security.AccessControl.FileSystemRights]::ReadAndExecute",
    "$currentAllowed = $false",
    "foreach ($rule in $acl.GetAccessRules($true, $true, " +
        "[System.Security.Principal.SecurityIdentifier])) {",
    "  $sid = $rule.IdentityReference.Value",
    "  if ($rule.AccessControlType -ne [System.Security.AccessControl.AccessControlType]::Allow) { continue }",
    "  if ($sid -eq $user -and ($rule.FileSystemRights -band $dangerous) -ne 0) { $currentAllowed = $true }",
    "  if ($trusted -contains $sid) { continue }",
    "  if (($rule.FileSystemRights -band $dangerous) -ne 0) { exit 12 }",
    "  if ($purpose -eq 'secret' -and ($rule.FileSystemRights -band $readable) -ne 0) { exit 13 }",
    "}",
    "if (-not $currentAllowed) { exit 14 }",
    "[Console]::Out.Write('trusted')",
].join("\n");
async function hasNoReparseAncestors(candidate) {
    let current = candidate;
    while (true) {
        const metadata = await lstat(current);
        if (metadata.isSymbolicLink())
            return false;
        const parent = path.dirname(current);
        if (parent === current)
            return true;
        current = parent;
    }
}
/** Validate real Windows ownership/ACLs, or an explicitly injected test inspector. */
export async function verifyWindowsPrivatePath(candidate, options = {}) {
    const platform = options.platform ?? process.platform;
    if (platform !== "win32")
        return false;
    const purpose = options.purpose ?? "temporary";
    if (purpose !== "temporary" && purpose !== "secret")
        return false;
    try {
        assertSafePlatformPath(candidate, platform);
        const requested = path.resolve(candidate);
        const metadata = await lstat(requested);
        if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile()))
            return false;
        const canonical = await realpath(requested);
        const operations = platformPath(requested, platform);
        if (operations.relative(requested, canonical) !== "" || !(await hasNoReparseAncestors(canonical))) {
            return false;
        }
        if (options.inspectAcl !== undefined)
            return (await options.inspectAcl(canonical, purpose)) === true;
        if (process.platform !== "win32")
            return false;
        const root = readPlatformEnvironmentVariable(process.env, "SystemRoot", "win32");
        if (!root || !path.isAbsolute(root))
            return false;
        assertSafePlatformPath(root, "win32");
        const systemRoot = await realpath(root);
        if (path.win32.relative(root, systemRoot) !== "" || !(await hasNoReparseAncestors(systemRoot)))
            return false;
        const powershell = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
        const executable = await lstat(powershell);
        if (executable.isSymbolicLink() || !executable.isFile() || !(await hasNoReparseAncestors(powershell)))
            return false;
        if (path.win32.relative(powershell, await realpath(powershell)) !== "")
            return false;
        const environment = sanitizeSubprocessEnvironment(process.env, "win32");
        for (const key of Object.keys(environment)) {
            if (["CODEX_GB_ACL_TARGET", "CODEX_GB_ACL_PURPOSE"].includes(key.toUpperCase()))
                delete environment[key];
        }
        environment.CODEX_GB_ACL_TARGET = canonical;
        environment.CODEX_GB_ACL_PURPOSE = purpose;
        const encoded = Buffer.from(WINDOWS_ACL_PROBE, "utf16le").toString("base64");
        const result = await execFileAsync(powershell, ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
            cwd: systemRoot,
            env: environment,
            timeout: 10_000,
            maxBuffer: 16 * 1024,
            windowsHide: true,
            encoding: "utf8",
        });
        return result.stdout.trim() === "trusted";
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=platform.js.map