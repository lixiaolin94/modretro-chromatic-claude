#!/usr/bin/env node

/** Portable launcher for the existing Unix setup and the experimental Windows x64 setup. */

import { execFile, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SCRIPT_DIRECTORY = path.dirname(SCRIPT_PATH);
const PLUGIN_ROOT = path.resolve(SCRIPT_DIRECTORY, "..");
const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 32_768;
const MAX_EXTRACTED_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_CENTRAL_DIRECTORY_BYTES = 64 * 1024 * 1024;
const PROGRESS_INTERVAL_MS = 30_000;
const MAX_PROGRESS_UPDATES = 60;
const COREPACK_REMEDIATION = "Use a current supported Node.js 22 or 24 LTS, run `npm install --global corepack@latest`, ensure the npm global directory is on PATH, then rerun setup.";
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const WINDOWS_INVALID_COMPONENT = /[<>:"|?*\u0000-\u001f]|[. ]$/u;
const UNSAFE_ENVIRONMENT_KEYS = new Set([
  "BASH_ENV",
  "COMSPEC",
  "COREPACK_HOME",
  "COREPACK_DEFAULT_TO_LATEST",
  "COREPACK_ENABLE_AUTO_PIN",
  "COREPACK_ENABLE_DOWNLOAD_PROMPT",
  "COREPACK_ENABLE_PROJECT_SPEC",
  "COREPACK_ENABLE_STRICT",
  "COREPACK_ENABLE_UNSAFE_CUSTOM_URLS",
  "COREPACK_ENV_FILE",
  "COREPACK_INTEGRITY_KEYS",
  "ENV",
  "NODE_OPTIONS",
  "NODE_PATH",
  "NODE_EXTRA_CA_CERTS",
  "NODE_REPL_HISTORY",
  "PYTHONPATH",
  "PYTHONHOME",
  "PYTHONSTARTUP",
  "PYTHONUSERBASE",
  "PYTHONWARNINGS",
  "PSMODULEPATH",
  "PSMODULEANALYSISCACHEPATH",
  "PSEXECUTIONPOLICYPREFERENCE",
  "__PSLOCKDOWNPOLICY",
  "VIRTUAL_ENV",
  "TMP",
  "TEMP",
  "TMPDIR",
  "TAR_OPTIONS",
  "TAR_READER_OPTIONS",
  "TAR_WRITER_OPTIONS",
  "YARN_NO_PROXY",
  "YARN_NPM_MINIMAL_AGE_GATE",
  "YARN_GLOBAL_FOLDER",
  "YARN_CACHE_FOLDER",
  "YARN_ENABLE_GLOBAL_CACHE",
]);

export const WINDOWS_TOOLCHAIN_RELEASES = Object.freeze({
  gbStudio: Object.freeze({
    version: "4.3.2",
    commit: "ccb891b2670134ba8237416772eea4ed09d34e1e",
    gbvmCommit: "bd6f41cc5e05cbe6601dcc7f8e2db89bed527fe3",
    archive: "gb-studio-windows-64bit-standalone.zip",
    sha256: "9afea7d8f3920991c3562fd69fa8a98aed7f29d231aa468bb4dbcf123b60db80",
  }),
  gbdk: Object.freeze({
    version: "4.5.0",
    archive: "gbdk-win64.zip",
    sha256: "266854ce92e3064871c5b28cd3436cc2a6cb136af9e7cf617140108f8c1c5890",
  }),
  platform: "win32-x64",
});

class SetupUsageError extends Error {
  exitCode = 2;
}

const SETUP_USAGE = [
  "Usage: node scripts/setup-compiler.mjs [--headless] [--with-cli] [--with-desktop] [--use-existing] [--dry-run]",
  "  macOS defaults to the verified desktop editor and GBDK.",
  "  Linux defaults to headless official project compilation and GBDK.",
  "  Experimental Windows x64 setup defaults to the official headless compiler and GBDK.",
  "  --use-existing executes version probes; --dry-run prints an unverified plan without running tools.",
  "  For installed plugins, use packaged setup.mjs (or setup.sh/setup.ps1) with an external dependency root.",
].join("\n");

function systemError(error, code) {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function samePath(left, right, platform = process.platform) {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function withinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function metadataIfPresent(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (systemError(error, "ENOENT")) return undefined;
    throw error;
  }
}

/** Legacy developer installers must never add files to a prepared immutable payload. */
export async function assertLegacySetupMutableRoot(root) {
  let candidate = path.resolve(root);
  for (;;) {
    let immutable = await metadataIfPresent(path.join(candidate, ".codex-plugin", "local-payload.json")) !== undefined;
    const manifest = path.join(candidate, ".codex-plugin", "plugin.json");
    const metadata = await metadataIfPresent(manifest);
    if (!immutable && metadata?.isSymbolicLink()) {
      throw new Error("Legacy setup cannot establish a mutable root through a linked plugin manifest. Use packaged setup.mjs with an external dependency root.");
    }
    if (!immutable && metadata?.isFile() && !metadata.isSymbolicLink()) {
      const version = JSON.parse(await readFile(manifest, "utf8")).version;
      immutable = typeof version === "string" && version.includes("+codex.payload.");
    }
    if (immutable) {
      throw new Error("Legacy setup cannot write into an immutable plugin payload or cache. " +
        "Use packaged setup.mjs (or setup.sh/setup.ps1) with an external dependency root.");
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) return;
    candidate = parent;
  }
}

async function requireRealDirectory(candidate, label, platform) {
  const metadata = await metadataIfPresent(candidate);
  if (!metadata || metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error(`${label} must be a real existing directory: ${candidate}`);
  }
  const canonical = await realpath(candidate);
  if (!samePath(canonical, candidate, platform)) {
    throw new Error(`${label} must not resolve through a symbolic link or junction: ${candidate}`);
  }
  return canonical;
}

async function requireRealFile(candidate, label, platform) {
  const metadata = await metadataIfPresent(candidate);
  if (!metadata || metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} must be a real regular file: ${candidate}`);
  }
  if (!samePath(await realpath(candidate), candidate, platform)) {
    throw new Error(`${label} must not resolve through a symbolic link or junction: ${candidate}`);
  }
  return candidate;
}

async function ensureManagedDirectory(root, candidate, platform) {
  const resolved = path.resolve(candidate);
  if (!withinRoot(root, resolved)) {
    throw new Error(`A managed GB Studio path escapes its trusted toolchain: ${candidate}`);
  }
  const parts = path.relative(root, resolved).split(path.sep).filter(Boolean);
  let current = root;
  await requireRealDirectory(current, "The trusted game toolchain root", platform);
  for (const segment of parts) {
    current = path.join(current, segment);
    const metadata = await metadataIfPresent(current);
    if (!metadata) {
      await mkdir(current);
    } else if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new Error(`A managed game toolchain path must be a real directory: ${current}`);
    }
    await requireRealDirectory(current, "A managed game toolchain path", platform);
  }
  return current;
}

async function assertManagedPathSafe(root, candidate, platform) {
  const resolved = path.resolve(candidate);
  if (!withinRoot(root, resolved)) {
    throw new Error(`A managed GB Studio path escapes its trusted toolchain: ${candidate}`);
  }
  let current = root;
  for (const segment of path.relative(root, resolved).split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    const metadata = await metadataIfPresent(current);
    if (!metadata) return;
    if (metadata.isSymbolicLink()) {
      throw new Error(`A managed game toolchain path must not be a symbolic link or junction: ${current}`);
    }
    if (!samePath(await realpath(current), current, platform)) {
      throw new Error(`A managed game toolchain path resolves through a junction: ${current}`);
    }
  }
}

/** Windows environment-variable names are case-insensitive; never keep poisoned aliases. */
export function sanitizeWindowsBootstrapEnvironment(environment = process.env, temporaryDirectory) {
  const sanitized = {};
  const retained = new Map();
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    const normalized = name.toUpperCase();
    if (retained.has(normalized)) {
      if (retained.get(normalized) !== value) {
        throw new Error(`The Windows bootstrap environment contains conflicting case-insensitive ${normalized} values.`);
      }
      continue;
    }
    retained.set(normalized, value);
    if (
      UNSAFE_ENVIRONMENT_KEYS.has(normalized) ||
      normalized.startsWith("UV_") ||
      normalized.startsWith("GIT_")
    ) continue;
    sanitized[normalized === "PATH" ? "PATH" : name] = value;
  }
  if (temporaryDirectory !== undefined) {
    sanitized.TMP = temporaryDirectory;
    sanitized.TEMP = temporaryDirectory;
    sanitized.TMPDIR = temporaryDirectory;
  }
  return sanitized;
}

export function parseWindowsSetupArguments(arguments_) {
  const options = {
    headless: false,
    withCli: true,
    withDesktop: false,
    useExisting: false,
    dryRun: false,
    help: false,
  };
  for (const argument of arguments_) {
    switch (argument) {
      case "--headless":
        options.headless = true;
        break;
      case "--with-cli":
        options.withCli = true;
        break;
      case "--with-desktop":
        options.withDesktop = true;
        break;
      case "--use-existing":
        options.useExisting = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--help":
      case "-h":
        options.help = true;
        break;
      default:
        throw new SetupUsageError(`Unknown ModRetro Chromatic setup option: ${argument}`);
    }
  }
  if (options.headless && options.withDesktop) {
    throw new SetupUsageError("--headless and --with-desktop cannot be combined.");
  }
  return options;
}

function gbStudioSetupPlan(options, selected, logger) {
  const platform = options.platform ?? process.platform;
  const architecture = options.arch ?? process.arch;
  const environment = options.environment ?? process.env;
  const configuredRoot = platform === "win32"
    ? caseInsensitiveValue(environment, "GB_STUDIO_TOOLCHAIN_ROOT")
    : environment.GB_STUDIO_TOOLCHAIN_ROOT;
  const toolchainRoot = path.resolve(options.workingDirectory ?? options.cwd ?? process.cwd(), options.toolchainRoot ??
    configuredRoot ?? options.pluginRoot ?? PLUGIN_ROOT);
  const withCli = platform === "win32" || platform === "linux" || selected.headless || selected.useExisting || (options.args ?? []).includes("--with-cli");
  const withDesktop = selected.withDesktop || (platform === "darwin" && !selected.headless && !selected.useExisting);
  const components = [`GBDK ${WINDOWS_TOOLCHAIN_RELEASES.gbdk.version}`,
    ...(withCli ? [`official GB Studio ${WINDOWS_TOOLCHAIN_RELEASES.gbStudio.version} CLI`] : []),
    ...(withDesktop ? [`optional GB Studio ${WINDOWS_TOOLCHAIN_RELEASES.gbStudio.version} desktop editor`] : [])];
  logger("[dry-run] Plan only; no tools were run and dependency health is unverified.");
  logger(`[dry-run] Target ${platform}-${architecture}; dependency destination ${path.join(toolchainRoot, ".local")}.`);
  logger(`[dry-run] Would ${selected.useExisting ? "verify the existing" : "verify/reuse or prepare"} ${components.join(", ")}.`);
  logger("[dry-run] Installed plugins should use packaged setup.mjs (or setup.sh/setup.ps1) with an external dependency root.");
  return { schemaVersion: 1, dryRun: true, verified: false, installed: false, platform: `${platform}-${architecture}`,
    toolchainRoot, components, useExisting: selected.useExisting };
}

function validateArchiveName(name, seen) {
  if (
    !name || name.includes("\u0000") || name.startsWith("/") || name.startsWith("\\") ||
    /^[A-Za-z]:/u.test(name)
  ) {
    throw new Error(`The verified release archive contains an unsafe absolute entry: ${JSON.stringify(name)}`);
  }
  const directory = name.endsWith("/") || name.endsWith("\\");
  const components = name.split(/[\\/]/u);
  if (directory) components.pop();
  if (components.length === 0 || components.length > 128) {
    throw new Error(`The verified release archive contains an invalid entry: ${JSON.stringify(name)}`);
  }
  for (const component of components) {
    if (
      component.length === 0 || component.length > 255 || component === "." || component === ".." ||
      WINDOWS_INVALID_COMPONENT.test(component) || WINDOWS_RESERVED_NAME.test(component)
    ) {
      throw new Error(`The verified release archive contains an unsafe Windows path: ${JSON.stringify(name)}`);
    }
  }
  const normalized = components.join("/").toLowerCase();
  if (seen.has(normalized)) {
    throw new Error(`The verified release archive contains case-insensitive duplicate paths: ${name}`);
  }
  seen.add(normalized);
  return { path: normalized, directory };
}

/** Read the entire authenticated ZIP directory before either Windows extractor runs. */
async function inspectZipEntries(archivePath) {
  const handle = await open(archivePath, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size < 22 || metadata.size > MAX_ARCHIVE_BYTES) {
      throw new Error("The verified release archive has an invalid or oversized ZIP payload.");
    }
    const tailSize = Math.min(metadata.size, 65_557);
    const tail = Buffer.alloc(tailSize);
    await handle.read(tail, 0, tailSize, metadata.size - tailSize);
    let end = -1;
    for (let index = tail.length - 22; index >= 0; index -= 1) {
      if (tail.readUInt32LE(index) === 0x06054b50 && index + 22 + tail.readUInt16LE(index + 20) === tail.length) {
        end = index;
        break;
      }
    }
    if (end < 0) throw new Error("The verified release archive has no valid ZIP central directory.");
    const disk = tail.readUInt16LE(end + 4);
    const centralDisk = tail.readUInt16LE(end + 6);
    const diskEntries = tail.readUInt16LE(end + 8);
    const entryCount = tail.readUInt16LE(end + 10);
    const centralSize = tail.readUInt32LE(end + 12);
    const centralOffset = tail.readUInt32LE(end + 16);
    if (
      disk !== 0 || centralDisk !== 0 || diskEntries !== entryCount ||
      entryCount === 0 || entryCount === 0xffff || entryCount > MAX_ARCHIVE_ENTRIES ||
      centralSize === 0xffff_ffff || centralOffset === 0xffff_ffff ||
      centralSize > MAX_CENTRAL_DIRECTORY_BYTES ||
      centralOffset + centralSize > metadata.size - (tail.length - end)
    ) {
      throw new Error("The verified release archive uses an unsupported or unsafe ZIP layout.");
    }
    const central = Buffer.alloc(centralSize);
    await handle.read(central, 0, centralSize, centralOffset);
    let offset = 0;
    let extractedBytes = 0;
    const names = new Set();
    const manifest = [];
    for (let index = 0; index < entryCount; index += 1) {
      if (offset + 46 > central.length || central.readUInt32LE(offset) !== 0x02014b50) {
        throw new Error("The verified release archive has a malformed ZIP central-directory entry.");
      }
      const flags = central.readUInt16LE(offset + 8);
      const compressedBytes = central.readUInt32LE(offset + 20);
      const uncompressedBytes = central.readUInt32LE(offset + 24);
      const nameBytes = central.readUInt16LE(offset + 28);
      const extraBytes = central.readUInt16LE(offset + 30);
      const commentBytes = central.readUInt16LE(offset + 32);
      const diskNumber = central.readUInt16LE(offset + 34);
      const attributes = central.readUInt32LE(offset + 38);
      const next = offset + 46 + nameBytes + extraBytes + commentBytes;
      if (
        next > central.length || diskNumber !== 0 || (flags & 1) !== 0 ||
        compressedBytes === 0xffff_ffff || uncompressedBytes === 0xffff_ffff
      ) {
        throw new Error("The verified release archive has an unsupported, encrypted, or ZIP64 entry.");
      }
      const unixType = (attributes >>> 16) & 0o170000;
      if (unixType === 0o120000 || (attributes & 0x0400) !== 0) {
        throw new Error("The verified release archive contains a symbolic link or Windows reparse point.");
      }
      const name = central.subarray(offset + 46, offset + 46 + nameBytes).toString("utf8");
      manifest.push({ ...validateArchiveName(name, names), size: uncompressedBytes });
      extractedBytes += uncompressedBytes;
      if (extractedBytes > MAX_EXTRACTED_BYTES) {
        throw new Error("The verified release archive exceeds its maximum extracted size.");
      }
      offset = next;
    }
    if (offset !== central.length) throw new Error("The verified release ZIP central directory contains trailing data.");
    const kinds = new Map(manifest.map((entry) => [entry.path, entry.directory]));
    for (const entry of manifest) {
      const components = entry.path.split("/");
      for (let index = 1; index < components.length; index += 1) {
        if (kinds.get(components.slice(0, index).join("/")) === false) {
          throw new Error("The verified release ZIP contains a file used as a directory.");
        }
      }
    }
    return { entries: entryCount, extractedBytes, manifest };
  } finally {
    await handle.close();
  }
}

/** Preserve the public, bounded ZIP-validation summary. */
export async function validateZipEntries(archivePath) {
  const { entries, extractedBytes } = await inspectZipEntries(archivePath);
  return { entries, extractedBytes };
}

async function defaultSha256File(filename) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  return digest.digest("hex");
}

async function defaultDownload(url, destination) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30 * 60_000);
  try {
    let requested = new URL(url);
    let response;
    for (let redirects = 0; redirects < 8; redirects += 1) {
      if (
        requested.protocol !== "https:" ||
        (requested.hostname !== "github.com" &&
          requested.hostname !== "objects.githubusercontent.com" &&
          requested.hostname !== "release-assets.githubusercontent.com" &&
          !requested.hostname.endsWith(".githubusercontent.com"))
      ) {
        throw new Error(`Official release download refused an untrusted redirect: ${requested.href}`);
      }
      response = await fetch(requested, { redirect: "manual", signal: controller.signal });
      if (response.status < 300 || response.status >= 400) break;
      const location = response.headers.get("location");
      if (!location) throw new Error("Official release download returned a redirect without a destination.");
      requested = new URL(location, requested);
      response = undefined;
    }
    if (!response || !response.ok || response.body === null) {
      throw new Error(`Official release download failed safely: ${response?.status ?? "too many redirects"} ${url}`);
    }
    let total = 0;
    const boundSize = new Transform({
      transform(chunk, _encoding, callback) {
        total += chunk.byteLength;
        callback(total > MAX_ARCHIVE_BYTES ? new Error("The official release archive exceeds its size limit.") : null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body), boundSize, createWriteStream(destination, { flags: "wx", mode: 0o600 }));
  } finally {
    clearTimeout(timeout);
  }
}

async function defaultRunCommand(command, arguments_, options) {
  const result = await execFileAsync(command, arguments_, {
    cwd: options.cwd,
    env: options.env,
    windowsHide: true,
    shell: false,
    encoding: "utf8",
    timeout: options.timeout ?? 30 * 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

async function withProgress(context, label, operation) {
  const started = Date.now();
  let updates = 0;
  const elapsed = () => `${Math.round((Date.now() - started) / 1_000)}s`;
  context.logger(`${label}...`);
  const timer = setInterval(() => {
    if (updates < MAX_PROGRESS_UPDATES) {
      updates += 1;
      context.logger(`${label}: still running (${elapsed()}).`);
    }
  }, PROGRESS_INTERVAL_MS);
  timer.unref?.();
  try {
    const result = await operation();
    context.logger(`${label}: completed (${elapsed()}).`);
    return result;
  } catch (error) {
    context.logger(`${label}: failed (${elapsed()}).`);
    throw error;
  } finally {
    clearInterval(timer);
  }
}

function caseInsensitiveValue(environment, requested) {
  const normalized = requested.toUpperCase();
  const match = Object.entries(environment).find(([name]) => name.toUpperCase() === normalized);
  return match?.[1];
}

async function trustedExecutable(candidate, label, context) {
  if (!path.isAbsolute(candidate)) throw new Error(`${label} must use a trusted absolute executable path.`);
  const canonical = await realpath(candidate);
  await requireRealFile(canonical, label, context.platform);
  for (const untrustedRoot of [context.pluginRoot, context.toolchainRoot, context.localRoot, context.workingDirectory]) {
    if (untrustedRoot !== undefined && withinRoot(untrustedRoot, canonical)) {
      throw new Error(`${label} must not execute from an untrusted project or toolchain: ${canonical}`);
    }
  }
  return canonical;
}

async function resolveGitExecutable(context) {
  if (context.configuredGitExecutable !== undefined) {
    return trustedExecutable(context.configuredGitExecutable, "The trusted Git executable", context);
  }
  const configuredPath = caseInsensitiveValue(context.environment, "PATH") ?? "";
  for (const directory of configuredPath.split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, "git.exe");
    try {
      return await trustedExecutable(candidate, "The trusted Git executable", context);
    } catch {
      // Reject missing aliases and any Git executable inside the checkout, vendor, or project.
    }
  }
  throw new Error("ModRetro Chromatic setup requires a trusted Git installation outside the selected project and toolchain.");
}

async function resolvePowerShell(environment, context, override) {
  const systemRoot = context.systemRoot ?? caseInsensitiveValue(environment, "SystemRoot") ?? "C:\\Windows";
  const candidate = override ?? path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  if (override === undefined) {
    await requireRealFile(candidate, "The trusted Windows PowerShell executable", context.platform);
  }
  return trustedExecutable(candidate, "The trusted Windows PowerShell executable", context);
}

async function resolveWindowsTar(context) {
  if (context.systemRoot === undefined) {
    throw new Error("Windows ZIP extraction requires a trusted SystemRoot to locate System32/tar.exe.");
  }
  const candidate = path.join(context.systemRoot, "System32", "tar.exe");
  await requireRealFile(candidate, "The trusted Windows System32 tar.exe", context.platform);
  return trustedExecutable(candidate, "The trusted Windows System32 tar.exe", context);
}

/** Each extractor gets an owned, empty directory; failed attempts are never mixed. */
async function extractionAttempt(destination, manifest, context, extract) {
  const staging = await mkdtemp(path.join(path.dirname(destination), ".extract-attempt-"));
  try {
    try {
      await extract(staging);
    } catch (error) {
      return { error };
    }
    // Validation failures are not extractor failures and must not trigger a fallback.
    await assertExtractedArchiveComplete(staging, manifest, context.platform);
    await requireRealDirectory(destination, "The empty release extraction destination", context.platform);
    if ((await readdir(destination)).length !== 0) {
      throw new Error("The release extraction destination is no longer empty; nothing was installed.");
    }
    for (const entry of await readdir(staging)) {
      await rename(path.join(staging, entry), path.join(destination, entry));
    }
    return {};
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function defaultExtractArchive(archivePath, destination, options) {
  const manifest = options.archiveManifest ?? (await inspectZipEntries(archivePath)).manifest;
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$null = [System.Reflection.Assembly]::Load('System.IO.Compression.FileSystem')",
    "[System.IO.Compression.ZipFile]::ExtractToDirectory($env:CODEX_GBS_ARCHIVE_PATH, $env:CODEX_GBS_DESTINATION_PATH)",
  ].join("\n");
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  const powershell = await extractionAttempt(destination, manifest, options, async (staging) => {
    const executable = await resolvePowerShell(options.environment, options, options.powershellPath);
    await options.runCommand(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], {
      cwd: options.scriptDirectory,
      env: {
        ...options.environment,
        CODEX_GBS_ARCHIVE_PATH: archivePath,
        CODEX_GBS_DESTINATION_PATH: staging,
      },
    });
  });
  if (!("error" in powershell)) return;

  options.logger("PowerShell ZIP extraction was unavailable or failed; retrying the verified archive with Windows System32 tar.exe.");
  const tar = await extractionAttempt(destination, manifest, options, async (staging) => {
    const executable = await resolveWindowsTar(options);
    await options.runCommand(executable, ["-xf", archivePath, "-C", staging], {
      cwd: options.scriptDirectory,
      env: options.environment,
    });
  });
  if ("error" in tar) {
    throw new Error(
      "The verified release could not be extracted by Windows PowerShell or trusted System32/tar.exe. Repair either Windows component, then rerun setup.",
      { cause: new AggregateError([powershell.error, tar.error]) },
    );
  }
}

async function ensureVerifiedArchive({ root, downloads, release, url, platform, download, sha256File }) {
  await ensureManagedDirectory(root, downloads, platform);
  const destination = path.join(downloads, release.archive);
  await assertManagedPathSafe(root, destination, platform);
  if (!(await metadataIfPresent(destination))) {
    const temporary = path.join(downloads, `.download-${randomUUID()}`);
    try {
      await download(url, temporary);
      await requireRealFile(temporary, "The downloaded official release archive", platform);
      const actual = await sha256File(temporary);
      if (actual !== release.sha256) {
        throw new Error(`Official release SHA-256 verification failed; archive was not installed: ${release.archive}`);
      }
      await rename(temporary, destination);
    } finally {
      await rm(temporary, { force: true }).catch(() => {});
    }
  }
  await requireRealFile(destination, "The cached official release archive", platform);
  if ((await sha256File(destination)) !== release.sha256) {
    throw new Error(`Official release SHA-256 verification failed; cached archive was not installed: ${release.archive}`);
  }
  const { manifest } = await inspectZipEntries(destination);
  return { archive: destination, manifest };
}

async function assertExtractedTreeSafe(root, platform, depth = 0, visit, relativeRoot = root) {
  if (depth > 128) throw new Error("The extracted release archive exceeds its maximum directory depth.");
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const candidate = path.join(root, entry.name);
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink()) {
      throw new Error(`The extracted release archive contains a symbolic link or junction: ${candidate}`);
    }
    if (!samePath(await realpath(candidate), candidate, platform)) {
      throw new Error(`The extracted release archive contains a redirected filesystem entry: ${candidate}`);
    }
    if (visit) visit(path.relative(relativeRoot, candidate).split(path.sep).join("/").toLowerCase(), metadata);
    if (metadata.isDirectory()) await assertExtractedTreeSafe(candidate, platform, depth + 1, visit, relativeRoot);
    else if (!metadata.isFile()) throw new Error(`The extracted release archive contains a non-file: ${candidate}`);
  }
}

async function assertExtractedArchiveComplete(root, manifest, platform) {
  const expected = new Map();
  for (const entry of manifest) {
    const components = entry.path.split("/");
    for (let index = 1; index < components.length; index += 1) {
      expected.set(components.slice(0, index).join("/"), { directory: true });
    }
    expected.set(entry.path, entry);
  }
  const remaining = new Set(expected.keys());
  await assertExtractedTreeSafe(root, platform, 0, (relative, metadata) => {
    const entry = expected.get(relative);
    if (!entry) {
      throw new Error(`The extracted release archive contains an undeclared entry: ${relative}`);
    }
    if (!remaining.has(relative)) {
      throw new Error(`The extracted release archive contains a case-insensitive duplicate entry: ${relative}`);
    }
    if (entry.directory !== metadata.isDirectory() || (!entry.directory && entry.size !== metadata.size)) {
      throw new Error(`The extracted release archive is incomplete or has an incorrect entry size: ${relative}`);
    }
    remaining.delete(relative);
  });
  if (remaining.size !== 0) {
    throw new Error(`The extracted release archive is incomplete; missing entry: ${remaining.values().next().value}`);
  }
}

async function discoverDesktopExecutable(directory, platform, depth = 0) {
  if (depth > 5) return undefined;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`The GB Studio desktop application contains a symbolic link: ${candidate}`);
    if (entry.isFile() && ["gb-studio.exe", "gb studio.exe"].includes(entry.name.toLowerCase())) {
      return requireRealFile(candidate, "The official GB Studio desktop application", platform);
    }
    if (entry.isDirectory()) {
      const found = await discoverDesktopExecutable(candidate, platform, depth + 1);
      if (found) return found;
    }
  }
  return undefined;
}

const ORIGINAL_CLI_TEST = 'const isCli = __dirname.indexOf("out/cli") > -1;';
const ORIGINAL_CLI_ROOT = 'rootDir = __dirname.substring(0, __dirname.lastIndexOf("out/cli"));';
const PATCHED_CLI_TEST = 'const normalizedCliDirectory = __dirname.replace(/\\\\/g, "/");\nconst isCli = normalizedCliDirectory.indexOf("out/cli") > -1;';
const PATCHED_CLI_ROOT = 'rootDir = __dirname.substring(0, normalizedCliDirectory.lastIndexOf("out/cli"));';

function patchedWindowsCliSource(original) {
  if (
    original.split(ORIGINAL_CLI_TEST).length !== 2 ||
    original.split(ORIGINAL_CLI_ROOT).length !== 2 ||
    original.includes("normalizedCliDirectory")
  ) {
    throw new Error("The pinned GB Studio CLI constants do not match the expected Windows compatibility patch.");
  }
  return original.replace(ORIGINAL_CLI_TEST, PATCHED_CLI_TEST).replace(ORIGINAL_CLI_ROOT, PATCHED_CLI_ROOT);
}

/** Patch only the exact verified GB Studio 4.3.2 CLI Windows-separator defect. */
export async function patchWindowsCliConstants(constantsPath, options = {}) {
  const platform = options.platform ?? process.platform;
  await requireRealFile(constantsPath, "The verified GB Studio constants source", platform);
  const original = await readFile(constantsPath, "utf8");
  if (original.includes(PATCHED_CLI_TEST) && original.includes(PATCHED_CLI_ROOT)) return false;
  const updated = patchedWindowsCliSource(original);
  await writeFile(constantsPath, updated, { encoding: "utf8", flag: "r+" });
  return true;
}

async function resolveCorepackScript(executable, context, override) {
  if (override !== undefined) return trustedExecutable(override, "The trusted Corepack JavaScript launcher", context);
  const directory = path.dirname(executable);
  const candidates = [
    path.join(directory, "node_modules", "corepack", "dist", "corepack.js"),
    path.join(directory, "..", "lib", "node_modules", "corepack", "dist", "corepack.js"),
    path.join(directory, "node_modules", "corepack", "dist", "corepack.cjs"),
  ];
  // `npm install --global corepack` may use a separate Windows npm prefix.
  // Execute its JavaScript with trusted Node, never a PATH-provided .cmd shim.
  const configuredPath = caseInsensitiveValue(context.environment, "PATH") ?? "";
  for (const entry of configuredPath.split(path.delimiter)) {
    const prefix = entry.trim().replace(/^"(.*)"$/u, "$1");
    if (!prefix || !path.isAbsolute(prefix)) continue;
    candidates.push(path.join(prefix, "node_modules", "corepack", "dist", "corepack.js"));
    candidates.push(path.join(prefix, "node_modules", "corepack", "dist", "corepack.cjs"));
  }
  for (const candidate of new Set(candidates)) {
    if (await metadataIfPresent(candidate)) {
      try {
        return await trustedExecutable(path.resolve(candidate), "The trusted Corepack JavaScript launcher", context);
      } catch {
        // A project-local or redirected launcher must not shadow a trusted installation.
      }
    }
  }
  throw new Error(
    "ModRetro Chromatic setup could not find trusted Corepack beside Node.js or on an absolute PATH entry. " +
      COREPACK_REMEDIATION,
  );
}

function commandOutput(result) {
  if (typeof result === "string") return result.trim();
  return String(result?.stdout ?? "").trim();
}

function managedCorepackEnvironment(context) {
  return {
    ...context.environment,
    COREPACK_HOME: context.corepackHome,
    COREPACK_DEFAULT_TO_LATEST: "0",
    COREPACK_ENABLE_AUTO_PIN: "0",
    COREPACK_ENABLE_DOWNLOAD_PROMPT: "0",
    COREPACK_ENABLE_PROJECT_SPEC: "1",
    COREPACK_ENABLE_STRICT: "1",
    COREPACK_ENABLE_UNSAFE_CUSTOM_URLS: "0",
    COREPACK_ENV_FILE: "0",
  };
}

async function verifyCorepack(corepack, context) {
  try {
    const version = commandOutput(await context.runCommand(context.nodeExecutable, [corepack, "--version"], {
      cwd: context.scriptDirectory,
      env: managedCorepackEnvironment(context),
      timeout: 15_000,
    }));
    if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/u.test(version)) {
      throw new Error("The Corepack launcher did not report a valid version.");
    }
  } catch (error) {
    throw new Error(`The trusted Corepack launcher could not run with the selected Node.js. ${COREPACK_REMEDIATION}`, { cause: error });
  }
}

async function verifyCompiler(compiler, header, context) {
  await requireRealFile(compiler, "The GBDK 4.5.0 Windows compiler", context.platform);
  await requireRealFile(header, "The GBDK 4.5.0 version header", context.platform);
  const source = await readFile(header, "utf8");
  if (!/^\s*#\s*define\s+__GBDK_VERSION\s+450(?:\s|$)/mu.test(source)) {
    throw new Error(`The existing GBDK installation does not report the required 4.5.0 release: ${header}`);
  }
  await context.runCommand(compiler, ["-v"], { cwd: context.scriptDirectory, env: context.environment });
}

async function verifyCli(cli, context) {
  await requireRealFile(cli, "The official GB Studio 4.3.2 CLI", context.platform);
  const output = commandOutput(await context.runCommand(context.nodeExecutable, [cli, "--version"], {
    cwd: context.scriptDirectory,
    env: context.environment,
  }));
  if (output !== WINDOWS_TOOLCHAIN_RELEASES.gbStudio.version && output !== `v${WINDOWS_TOOLCHAIN_RELEASES.gbStudio.version}`) {
    throw new Error(`The official GB Studio CLI reported ${output}; expected ${WINDOWS_TOOLCHAIN_RELEASES.gbStudio.version}.`);
  }
}

async function installGbdk(local, paths, context) {
  await assertManagedPathSafe(local, paths.gbdkRoot, context.platform);
  if (await metadataIfPresent(paths.compiler)) {
    await verifyCompiler(paths.compiler, paths.versionHeader, context);
    return;
  }
  if (await metadataIfPresent(paths.gbdkRoot)) {
    throw new Error(`The existing GBDK installation is incomplete; repair it manually: ${paths.gbdkRoot}`);
  }
  const { archive, manifest } = await withProgress(context, `Preparing verified GBDK ${WINDOWS_TOOLCHAIN_RELEASES.gbdk.version} archive`, () => ensureVerifiedArchive({
    root: local,
    downloads: paths.downloads,
    release: WINDOWS_TOOLCHAIN_RELEASES.gbdk,
    url: `https://github.com/gbdk-2020/gbdk-2020/releases/download/${WINDOWS_TOOLCHAIN_RELEASES.gbdk.version}/${WINDOWS_TOOLCHAIN_RELEASES.gbdk.archive}`,
    platform: context.platform,
    download: context.download,
    sha256File: context.sha256File,
  }));
  const staging = await mkdtemp(path.join(local, ".extract-gbdk-"));
  try {
    await withProgress(context, `Extracting verified GBDK ${WINDOWS_TOOLCHAIN_RELEASES.gbdk.version}`, async () => {
      await context.extractArchive(archive, staging, { ...context, archiveManifest: manifest });
      await assertExtractedArchiveComplete(staging, manifest, context.platform);
    });
    const extracted = path.join(staging, "gbdk");
    await requireRealDirectory(extracted, "The extracted GBDK release", context.platform);
    await requireRealFile(path.join(extracted, "bin", "lcc.exe"), "The extracted GBDK Windows compiler", context.platform);
    await rename(extracted, paths.gbdkRoot);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  await verifyCompiler(paths.compiler, paths.versionHeader, context);
}

async function installDesktop(local, paths, context) {
  await ensureManagedDirectory(local, paths.apps, context.platform);
  await assertManagedPathSafe(local, paths.desktopRoot, context.platform);
  if (await metadataIfPresent(paths.desktopRoot)) {
    await requireRealDirectory(paths.desktopRoot, "The existing GB Studio desktop application", context.platform);
    const executable = await discoverDesktopExecutable(paths.desktopRoot, context.platform);
    if (!executable) throw new Error("The existing GB Studio desktop application does not contain gb-studio.exe or GB Studio.exe.");
    return executable;
  }
  const { archive, manifest } = await withProgress(context, `Preparing verified GB Studio ${WINDOWS_TOOLCHAIN_RELEASES.gbStudio.version} desktop archive`, () => ensureVerifiedArchive({
    root: local,
    downloads: paths.downloads,
    release: WINDOWS_TOOLCHAIN_RELEASES.gbStudio,
    url: `https://github.com/chrismaltby/gb-studio/releases/download/v${WINDOWS_TOOLCHAIN_RELEASES.gbStudio.version}/${WINDOWS_TOOLCHAIN_RELEASES.gbStudio.archive}`,
    platform: context.platform,
    download: context.download,
    sha256File: context.sha256File,
  }));
  const staging = await mkdtemp(path.join(paths.apps, ".extract-desktop-"));
  try {
    await withProgress(context, `Extracting verified GB Studio ${WINDOWS_TOOLCHAIN_RELEASES.gbStudio.version} desktop`, async () => {
      await context.extractArchive(archive, staging, { ...context, archiveManifest: manifest });
      await assertExtractedArchiveComplete(staging, manifest, context.platform);
    });
    if (!(await discoverDesktopExecutable(staging, context.platform))) {
      throw new Error("The verified GB Studio Windows standalone release did not contain gb-studio.exe or GB Studio.exe.");
    }
    await rename(staging, paths.desktopRoot);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  return discoverDesktopExecutable(paths.desktopRoot, context.platform);
}

function isSchannelCredentialsFailure(error) {
  const description = [error?.message, error?.stderr, error?.stdout].map((value) => String(value ?? "")).join("\n");
  return /\bschannel\b/iu.test(description) && /\bSEC_E_NO_CREDENTIALS\b/u.test(description);
}

async function runTrustedGit(git, arguments_, context, cwd, options = {}) {
  const securityOptions = [
    "-c", `core.hooksPath=${context.disabledHooksDirectory}`,
    "-c", "core.fsmonitor=false",
  ];
  const run = async (argumentsToRun) => {
    await requireRealDirectory(context.disabledHooksDirectory, "The disabled Git hooks directory", context.platform);
    if ((await readdir(context.disabledHooksDirectory)).length !== 0) {
      throw new Error("The trusted disabled Git hooks directory must remain empty.");
    }
    return context.runCommand(git, [...securityOptions, ...argumentsToRun], { cwd, env: context.environment });
  };
  try {
    return await run(arguments_);
  } catch (error) {
    if (!options.network || context.platform !== "win32" || !isSchannelCredentialsFailure(error)) throw error;
    context.logger("Git Schannel credentials are unavailable; retrying this network operation once with OpenSSL and normal TLS verification.");
    const retryArguments = options.retryArguments?.() ?? arguments_;
    return run(["-c", "http.sslBackend=openssl", ...retryArguments]);
  }
}

function normalizeSourceNewlines(value) {
  return value.replace(/\r\n/g, "\n");
}

async function verifyPinnedWorktree(git, paths, context) {
  const changes = commandOutput(await runTrustedGit(
    git,
    ["diff", "--no-ext-diff", "--name-only", "HEAD", "--"],
    context,
    paths.vendor,
  )).split(/\r?\n/u).map((entry) => entry.trim()).filter(Boolean);
  if (changes.length > 1 || (changes.length === 1 && changes[0] !== "src/consts.ts")) {
    throw new Error(`The pinned GB Studio checkout contains untrusted tracked changes: ${changes.join(", ")}`);
  }
  const pristineResult = await runTrustedGit(git, ["show", "HEAD:src/consts.ts"], context, paths.vendor);
  const pristine = normalizeSourceNewlines(typeof pristineResult === "string" ? pristineResult : String(pristineResult.stdout ?? ""));
  const expectedPatch = patchedWindowsCliSource(pristine);
  const constantsPath = path.join(paths.vendor, "src", "consts.ts");
  await requireRealFile(constantsPath, "The verified GB Studio constants source", context.platform);
  const actual = normalizeSourceNewlines(await readFile(constantsPath, "utf8"));
  if (changes.length === 0 ? actual !== pristine : actual !== expectedPatch) {
    throw new Error("The pinned GB Studio constants contain changes beyond the exact approved Windows compatibility patch.");
  }
}

async function ensureOfficialCli(local, paths, context) {
  await assertManagedPathSafe(local, paths.vendor, context.platform);
  if (await metadataIfPresent(paths.cli)) {
    await verifyCli(paths.cli, context);
    return;
  }
  await ensureManagedDirectory(local, path.dirname(paths.vendor), context.platform);
  const git = context.gitExecutable ?? await resolveGitExecutable(context);
  if (!(await metadataIfPresent(paths.vendor))) {
    // Git can leave a partial clone behind after a TLS failure. Each retry owns
    // a fresh destination; never remove or reset a preexisting vendor checkout.
    const staging = await mkdtemp(path.join(path.dirname(paths.vendor), ".clone-gb-studio-"));
    let cloned = path.join(staging, "checkout");
    const cloneArguments = () => [
      "clone", "--depth", "1", "--branch", `v${WINDOWS_TOOLCHAIN_RELEASES.gbStudio.version}`,
      "https://github.com/chrismaltby/gb-studio.git", cloned,
    ];
    try {
      await withProgress(context, `Fetching official GB Studio ${WINDOWS_TOOLCHAIN_RELEASES.gbStudio.version} source`, () => runTrustedGit(
        git,
        cloneArguments(),
        context,
        context.scriptDirectory,
        {
          network: true,
          retryArguments: () => {
            cloned = path.join(staging, "checkout-openssl");
            return cloneArguments();
          },
        },
      ));
      await requireRealDirectory(cloned, "The downloaded official GB Studio checkout", context.platform);
      if (await metadataIfPresent(paths.vendor)) {
        throw new Error(`The GB Studio vendor destination appeared during setup; it was not replaced: ${paths.vendor}`);
      }
      await rename(cloned, paths.vendor);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  await requireRealDirectory(paths.vendor, "The official GB Studio checkout", context.platform);
  await requireRealDirectory(path.join(paths.vendor, ".git"), "The official GB Studio Git checkout", context.platform);
  const head = commandOutput(await runTrustedGit(git, ["rev-parse", "HEAD"], context, paths.vendor));
  if (head !== WINDOWS_TOOLCHAIN_RELEASES.gbStudio.commit) {
    throw new Error(`The official GB Studio checkout has commit ${head}; expected ${WINDOWS_TOOLCHAIN_RELEASES.gbStudio.commit}.`);
  }
  // A trusted HEAD does not authenticate a mutable preexisting worktree.
  await verifyPinnedWorktree(git, paths, context);
  await withProgress(context, "Fetching pinned GBVM engine source", () => runTrustedGit(
    git,
    ["submodule", "update", "--init", "--depth", "1", "appData/engine/gbvm"],
    context,
    paths.vendor,
    { network: true },
  ));
  const gbvmHead = commandOutput(await runTrustedGit(
    git,
    ["-C", "appData/engine/gbvm", "rev-parse", "HEAD"],
    context,
    paths.vendor,
  ));
  if (gbvmHead !== WINDOWS_TOOLCHAIN_RELEASES.gbStudio.gbvmCommit) {
    throw new Error(`The official GBVM source has commit ${gbvmHead}; expected ${WINDOWS_TOOLCHAIN_RELEASES.gbStudio.gbvmCommit}.`);
  }
  await verifyPinnedWorktree(git, paths, context);

  const platformTools = path.join(paths.vendor, "buildTools", WINDOWS_TOOLCHAIN_RELEASES.platform);
  await requireRealDirectory(path.join(paths.vendor, "buildTools"), "The official GB Studio build-tools root", context.platform);
  await requireRealDirectory(platformTools, "The official GB Studio Windows x64 build tools", context.platform);
  const copiedGbdk = path.join(platformTools, "gbdk");
  if (await metadataIfPresent(copiedGbdk)) {
    await requireRealDirectory(copiedGbdk, "The official GB Studio Windows GBDK directory", context.platform);
    await requireRealFile(path.join(copiedGbdk, "bin", "lcc.exe"), "The official GB Studio Windows GBDK compiler", context.platform);
  } else {
    await cp(paths.gbdkRoot, copiedGbdk, { recursive: true, force: false, errorOnExist: true, verbatimSymlinks: false });
    await assertExtractedTreeSafe(copiedGbdk, context.platform);
  }

  // Pin both upstream Git identities before making the one narrow source compatibility fix.
  await patchWindowsCliConstants(path.join(paths.vendor, "src", "consts.ts"), { platform: context.platform });
  await verifyPinnedWorktree(git, paths, context);

  const corepack = context.corepackScript ?? await resolveCorepackScript(context.nodeExecutable, context, context.corepackPath);
  // Corepack trusts metadata in an existing executable cache without rehashing
  // the cached package-manager bytes. Never execute a preexisting cached Yarn.
  await assertManagedPathSafe(local, context.corepackHome, context.platform);
  await mkdir(context.corepackHome, { mode: 0o700 });
  await requireRealDirectory(context.corepackHome, "The fresh owned Corepack cache", context.platform);
  await ensureManagedDirectory(local, paths.yarnGlobal, context.platform);
  const yarnEnvironment = {
    ...managedCorepackEnvironment(context),
    YARN_ENABLE_GLOBAL_CACHE: "true",
    YARN_GLOBAL_FOLDER: paths.yarnGlobal,
    ELECTRON_SKIP_BINARY_DOWNLOAD: "1",
  };
  await withProgress(context, "Installing pinned GB Studio dependencies", () => context.runCommand(context.nodeExecutable, [corepack, "yarn", "install", "--immutable"], {
    cwd: paths.vendor,
    env: yarnEnvironment,
  }));

  const electron = path.join(paths.vendor, "node_modules", "electron");
  await requireRealDirectory(electron, "The official GB Studio Electron dependency", context.platform);
  const electronPath = path.join(electron, "path.txt");
  const existingElectronPath = await metadataIfPresent(electronPath);
  if (existingElectronPath && (existingElectronPath.isSymbolicLink() || !existingElectronPath.isFile())) {
    throw new Error(`Official GB Studio Electron metadata must be a real regular file: ${electronPath}`);
  }
  if (!existingElectronPath) await writeFile(electronPath, "electron", { flag: "wx" });

  const webpack = path.join(paths.vendor, "node_modules", "webpack", "bin", "webpack.js");
  await requireRealFile(webpack, "The official GB Studio webpack compiler", context.platform);
  await withProgress(context, "Compiling the official GB Studio CLI", () => context.runCommand(context.nodeExecutable, [webpack, "--config", "./src/apps/gb-studio-cli/webpack.cli.config.js"], {
    cwd: paths.vendor,
    env: { ...yarnEnvironment, NO_TYPE_CHECKING: "1" },
  }));
  await verifyCli(paths.cli, context);
}

function windowsSetupSelection(options) {
  const arguments_ = options.args ?? [];
  const selected = parseWindowsSetupArguments(arguments_);
  const platform = options.platform ?? process.platform;
  const architecture = options.arch ?? process.arch;
  if (!selected.help && !selected.dryRun && (platform !== "win32" || architecture !== "x64")) {
    throw new Error(`Experimental native ModRetro Chromatic setup supports Windows x64 only; received ${platform} ${architecture}.`);
  }
  const logger = options.logger ?? ((message) => process.stdout.write(`${message}\n`));
  return { platform, selected, logger };
}

async function prepareWindowsSetup(options, selected, platform, logger) {
  const environment = options.environment ?? process.env;
  // Reject ambiguous PATH/SystemRoot/GB_* aliases before trusting any Windows setting.
  const sanitizedEnvironment = sanitizeWindowsBootstrapEnvironment(environment);
  const pluginRoot = await realpath(path.resolve(options.pluginRoot ?? PLUGIN_ROOT));
  const requestedToolchain = options.toolchainRoot ??
    caseInsensitiveValue(sanitizedEnvironment, "GB_STUDIO_TOOLCHAIN_ROOT") ?? pluginRoot;
  const toolchainRoot = await realpath(path.resolve(requestedToolchain));
  await requireRealDirectory(toolchainRoot, "The selected game toolchain root", platform);
  let local = path.join(toolchainRoot, ".local");
  const existingLocal = await metadataIfPresent(local);
  if (existingLocal?.isSymbolicLink()) {
    local = await realpath(local);
    if (path.basename(local).toLowerCase() !== ".local") {
      throw new Error(`A linked game toolchain must resolve to an actual .local directory: ${local}`);
    }
    await requireRealDirectory(local, "The linked game toolchain", platform);
  } else if (existingLocal && !existingLocal.isDirectory()) {
    throw new Error(`The game toolchain .local path is not a directory: ${local}`);
  }
  if (!existingLocal && selected.useExisting) {
    throw new Error(`The existing game toolchain .local directory is unavailable: ${local}`);
  }
  if (existingLocal) {
    local = await requireRealDirectory(local, "The game toolchain .local directory", platform);
  }
  if (!selected.useExisting) {
    await assertLegacySetupMutableRoot(toolchainRoot);
    await assertLegacySetupMutableRoot(local);
  }

  const paths = {
    downloads: path.join(local, "downloads"),
    apps: path.join(local, "apps"),
    desktopRoot: path.join(local, "apps", "GB Studio"),
    gbdkRoot: path.join(local, "gbdk"),
    compiler: path.join(local, "gbdk", "bin", "lcc.exe"),
    versionHeader: path.join(local, "gbdk", "include", "gbdk", "version.h"),
    vendor: path.join(local, "vendor", "gb-studio"),
    cli: path.join(local, "vendor", "gb-studio", "out", "cli", "gb-studio-cli.js"),
    yarnGlobal: path.join(local, ".yarn", "global"),
    yarnCache: path.join(local, ".yarn", "cache"), // Preserve validation of an existing legacy cache.
  };
  for (const managed of [
    paths.downloads, paths.apps, paths.desktopRoot, paths.gbdkRoot, paths.vendor,
    paths.yarnGlobal, paths.yarnCache,
  ]) {
    await assertManagedPathSafe(local, managed, platform);
    if (await metadataIfPresent(managed)) {
      await requireRealDirectory(managed, "A managed game toolchain directory", platform);
    }
  }

  const context = {
    platform,
    pluginRoot,
    toolchainRoot,
    localRoot: local,
    workingDirectory: options.workingDirectory ?? process.cwd(),
    scriptDirectory: options.scriptDirectory ?? path.join(pluginRoot, "scripts"),
    nodeExecutable: options.nodeExecutable ?? process.execPath,
    configuredGitExecutable: options.gitExecutable,
    corepackPath: options.corepackPath,
    corepackHome: path.join(local, `.corepack-preflight-${randomUUID()}`),
    powershellPath: options.powershellPath,
    environment: sanitizedEnvironment,
    runCommand: options.runCommand ?? defaultRunCommand,
    download: options.download ?? defaultDownload,
    sha256File: options.sha256File ?? defaultSha256File,
    extractArchive: options.extractArchive ?? defaultExtractArchive,
    logger,
  };
  await assertManagedPathSafe(local, context.corepackHome, platform);
  if (await metadataIfPresent(context.corepackHome)) {
    throw new Error("The read-only Corepack preflight cache path must not already exist.");
  }
  await requireRealDirectory(context.scriptDirectory, "The trusted plugin script directory", platform);
  context.nodeExecutable = await trustedExecutable(context.nodeExecutable, "The trusted Node.js executable", context);
  const configuredSystemRoot = caseInsensitiveValue(sanitizedEnvironment, "SystemRoot");
  if (!configuredSystemRoot && process.platform === "win32") {
    throw new Error("Experimental Windows setup requires a trusted, explicitly available SystemRoot.");
  }
  if (configuredSystemRoot) {
    const systemRoot = await requireRealDirectory(configuredSystemRoot, "The trusted Windows SystemRoot", platform);
    context.systemRoot = systemRoot;
    context.commandShell = await trustedExecutable(
      path.join(systemRoot, "System32", "cmd.exe"),
      "The trusted Windows command interpreter",
      context,
    );
    context.environment.COMSPEC = context.commandShell;
  }
  return { environment, toolchainRoot, local, localExists: Boolean(existingLocal), paths, context };
}

async function resolveInstallPrerequisites(selected, paths, context) {
  if (!selected.withCli) return false;
  if (selected.useExisting || await metadataIfPresent(paths.cli)) {
    await verifyCli(paths.cli, context);
    return false;
  }
  context.gitExecutable = await resolveGitExecutable(context);
  context.corepackScript = await resolveCorepackScript(context.nodeExecutable, context, context.corepackPath);
  await verifyCorepack(context.corepackScript, context);
  return true;
}

/** Explicit executable prerequisite probes; --dry-run is a separate passive plan. */
export async function preflightWindowsGbStudio(options = {}) {
  const { platform, selected, logger } = windowsSetupSelection(options);
  if (selected.help) {
    logger(SETUP_USAGE);
    return { help: true };
  }
  if (selected.dryRun) return gbStudioSetupPlan(options, selected, logger);
  const { toolchainRoot, local, paths, context } = await prepareWindowsSetup(options, selected, platform, logger);
  const requiresCliBuild = await resolveInstallPrerequisites(selected, paths, context);
  return {
    platform: WINDOWS_TOOLCHAIN_RELEASES.platform,
    toolchainRoot,
    localRoot: local,
    cli: paths.cli,
    nodeExecutable: context.nodeExecutable,
    gitExecutable: context.gitExecutable,
    corepackScript: context.corepackScript,
    requiresCliBuild,
  };
}

/** Dependency-injected native Windows implementation; tests can run safely on non-Windows hosts. */
export async function setupWindowsGbStudio(options = {}) {
  const { platform, selected, logger } = windowsSetupSelection(options);
  if (selected.help) {
    logger(SETUP_USAGE);
    return { help: true };
  }
  if (selected.dryRun) return gbStudioSetupPlan(options, selected, logger);
  const { environment, local, localExists, paths, context } = await prepareWindowsSetup(options, selected, platform, logger);

  if (selected.useExisting) {
    await verifyCompiler(paths.compiler, paths.versionHeader, context);
    await verifyCli(paths.cli, context);
    let desktop;
    if (selected.withDesktop) {
      await requireRealDirectory(paths.desktopRoot, "The existing GB Studio desktop application", platform);
      desktop = await discoverDesktopExecutable(paths.desktopRoot, platform);
      if (!desktop) throw new Error("The existing GB Studio desktop application does not contain gb-studio.exe or GB Studio.exe.");
    }
    logger(`Verified existing official GB Studio ${WINDOWS_TOOLCHAIN_RELEASES.gbStudio.version} CLI: ${paths.cli}`);
    logger(`Verified existing GBDK ${WINDOWS_TOOLCHAIN_RELEASES.gbdk.version} compiler: ${paths.compiler}`);
    return { platform: WINDOWS_TOOLCHAIN_RELEASES.platform, compiler: paths.compiler, cli: paths.cli, desktop, reused: true };
  }

  logger("Checking trusted Windows bootstrap prerequisites...");
  await resolveInstallPrerequisites(selected, paths, context);
  if (!localExists) await mkdir(local);
  await requireRealDirectory(local, "The game toolchain .local directory", platform);
  const temporary = await mkdtemp(path.join(local, ".bootstrap-"));
  context.corepackHome = path.join(temporary, "corepack");
  context.environment = sanitizeWindowsBootstrapEnvironment(environment, temporary);
  if (context.commandShell) context.environment.COMSPEC = context.commandShell;
  try {
    context.disabledHooksDirectory = path.join(temporary, "disabled-git-hooks");
    await mkdir(context.disabledHooksDirectory);
    await installGbdk(local, paths, context);
    const desktop = selected.withDesktop ? await installDesktop(local, paths, context) : undefined;
    if (selected.withCli) await ensureOfficialCli(local, paths, context);
    logger(desktop
      ? `GB Studio ${WINDOWS_TOOLCHAIN_RELEASES.gbStudio.version} desktop editor: ${desktop}`
      : "GB Studio desktop editor: optional; headless project compilation requires no GUI.");
    logger(`GBDK ${WINDOWS_TOOLCHAIN_RELEASES.gbdk.version} compiler: ${paths.compiler}`);
    logger(`Official GB Studio ${WINDOWS_TOOLCHAIN_RELEASES.gbStudio.version} CLI: ${paths.cli}`);
    return { platform: WINDOWS_TOOLCHAIN_RELEASES.platform, compiler: paths.compiler, cli: paths.cli, desktop, reused: false };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

function dispatchUnixSetup(arguments_, options = {}) {
  const script = path.join(options.pluginRoot ?? PLUGIN_ROOT, "scripts", "setup-compiler.sh");
  return new Promise((resolve, reject) => {
    // Preserve the tracked executable's existing #!/usr/bin/env bash semantics exactly.
    const child = spawn(script, arguments_, {
      cwd: options.cwd ?? process.cwd(),
      env: options.environment ?? process.env,
      stdio: "inherit",
      shell: false,
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code !== null) resolve(code);
      else resolve(128 + (os.constants.signals[signal] ?? 1));
    });
  });
}

/** Plan/help are passive on every platform; real apply retains the platform-specific installers. */
export async function dispatchGbStudioSetup(arguments_ = process.argv.slice(2), options = {}) {
  const selected = parseWindowsSetupArguments(arguments_);
  const logger = options.logger ?? ((message) => process.stdout.write(`${message}\n`));
  if (selected.help) {
    logger(SETUP_USAGE);
    return 0;
  }
  if (selected.dryRun) {
    gbStudioSetupPlan({ ...options, args: arguments_ }, selected, logger);
    return 0;
  }
  const platform = options.platform ?? process.platform;
  if (platform === "darwin" || platform === "linux") {
    return (options.dispatchUnix ?? dispatchUnixSetup)(arguments_, options);
  }
  if (platform === "win32") {
    await setupWindowsGbStudio({ ...options, args: arguments_, platform });
    return 0;
  }
  throw new Error(`Unsupported ModRetro Chromatic setup platform: ${platform}.`);
}

if (process.argv[1] && samePath(process.argv[1], SCRIPT_PATH)) {
  try {
    process.exitCode = await dispatchGbStudioSetup();
  } catch (error) {
    process.stderr.write(`ModRetro Chromatic setup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error instanceof SetupUsageError ? error.exitCode : 1;
  }
}
