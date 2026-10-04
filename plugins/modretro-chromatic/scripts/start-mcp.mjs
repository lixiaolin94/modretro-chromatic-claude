#!/usr/bin/env node

/**
 * Start this plugin's MCP server even when Codex cached this launcher.
 *
 * Codex plugin caches need not contain gitignored build output, npm dependencies,
 * or a multi-gigabyte local Game Boy toolchain. Keep this script dependency-free
 * and use only its own prepared runtime, an intentionally linked runtime, or
 * an explicitly configured checkout before starting the actual MCP server.
 */

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync, constants, existsSync, fstatSync, lstatSync, openSync, readSync,
  readdirSync, realpathSync, statSync, readFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromaticTargetFromManifest, chromaticFormatFromManifest, requireChromaticHostTarget } from "./chromatic-runtime.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const localPayloadReceiptPath = ".codex-plugin/local-payload.json";
const localPayloadName = "modretro-chromatic";
const localPayloadLimits = {
  receiptBytes: 1024 * 1024,
  files: 4096,
  // Match prepare-plugin-payload.mjs and setup-runtime.mjs copy limits.
  fileBytes: 24 * 1024 * 1024,
  totalBytes: 136 * 1024 * 1024,
};
const packagedSetupGuidance = "From a trusted compiled package, use scripts/setup.sh (macOS/Linux) or scripts/setup.ps1 (Windows) to run doctor, then plan with a new owned --root. Only explicitly authorized apply may prepare a replacement; plugin installation and activation remain separate.";
const localPayloadRepair = `ModRetro Chromatic prepared runtime changed. Do not edit the immutable payload. ${packagedSetupGuidance}`;
const unsafeLauncherVariables = new Set([
  "BASH_ENV",
  "ENV",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONHOME",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "PYTHONUSERBASE",
  "PYTHONWARNINGS",
  "UV_CONFIG_FILE",
  "UV_ENV_FILE",
  "UV_PROJECT",
  "UV_PROJECT_ENVIRONMENT",
  "UV_PYTHON",
  "UV_PYTHON_INSTALL_DIR",
  "UV_PYTHON_PREFERENCE",
  "UV_WORKING_DIR",
  "VIRTUAL_ENV",
]);

function readEnvironment(environment, name, platform) {
  if (platform !== "win32") return environment[name];
  const target = name.toUpperCase();
  let value;
  let found = false;

  for (const [key, candidate] of Object.entries(environment)) {
    if (key.toUpperCase() !== target) continue;
    if (found && candidate !== value) {
      throw new Error(`Conflicting case-insensitive Windows environment values exist for ${name}.`);
    }
    found = true;
    value = candidate;
  }
  return value;
}

function deleteEnvironmentAliases(environment, name, platform) {
  if (platform !== "win32") {
    delete environment[name];
    return;
  }
  const normalized = name.toUpperCase();
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === normalized) delete environment[key];
  }
}

/** Select only signals that are actually supported by the current platform. */
export function mcpLauncherSignals(platform = process.platform) {
  return platform === "win32"
    ? ["SIGINT", "SIGTERM"]
    : ["SIGINT", "SIGTERM", "SIGHUP"];
}

/** Preserve enterprise registry/CA settings without inheriting executable hooks. */
export function prepareMcpLauncherEnvironment({
  environment = process.env,
  platform = process.platform,
  runtimeRoot,
  pluginRoot = packageRoot,
  defaultToolchainRoot,
  workingDirectory = process.cwd(),
}) {
  const childEnvironment = {};
  const seen = new Map();

  for (const [key, value] of Object.entries(environment)) {
    const normalized = platform === "win32" ? key.toUpperCase() : key;
    if (unsafeLauncherVariables.has(normalized)) continue;

    if (platform === "win32") {
      const previous = seen.get(normalized);
      if (previous !== undefined) {
        if (previous.value !== value) {
          throw new Error(`Conflicting case-insensitive Windows environment values exist for ${key}.`);
        }
        continue;
      }
      seen.set(normalized, { value });
    }
    childEnvironment[key] = value;
  }

  for (const name of ["GB_STUDIO_RUNTIME_ROOT", "GB_STUDIO_TOOLCHAIN_ROOT", "GB_STUDIO_PLUGIN_ROOT"]) {
    deleteEnvironmentAliases(childEnvironment, name, platform);
  }
  childEnvironment.GB_STUDIO_RUNTIME_ROOT = runtimeRoot;
  childEnvironment.GB_STUDIO_PLUGIN_ROOT = pluginRoot;

  const configuredToolchain = readEnvironment(environment, "GB_STUDIO_TOOLCHAIN_ROOT", platform)?.trim();
  childEnvironment.GB_STUDIO_TOOLCHAIN_ROOT = configuredToolchain
    ? path.resolve(workingDirectory, configuredToolchain)
    : defaultToolchainRoot;

  // The host replaces cwd before launching cached plugins. Only explicitly
  // configured roots can authorize a workspace; the runtime checkout never can.
  for (const variable of ["GB_STUDIO_WORKSPACE_ROOT", "GB_STUDIO_PROJECT_ROOT"]) {
    const configuredRoot = readEnvironment(environment, variable, platform)?.trim();
    deleteEnvironmentAliases(childEnvironment, variable, platform);
    if (configuredRoot) {
      childEnvironment[variable] = path.resolve(workingDirectory, configuredRoot);
    }
  }

  return childEnvironment;
}

function resolvePreparedRuntime(candidate) {
  const candidateServerPath = path.join(candidate, "dist", "server.js");

  try {
    if (!statSync(candidateServerPath).isFile()) {
      return undefined;
    }

    // A cached plugin can intentionally link dist/ to a prepared checkout.
    // Node resolves imports from the real server location, so validate the SDK
    // beside that exact runtime instead of borrowing an unrelated installation.
    const serverPath = realpathSync(candidateServerPath);
    const runtimeRoot = realpathSync(path.resolve(path.dirname(serverPath), ".."));
    const manifestPath = path.join(runtimeRoot, "package.json");
    if (existsSync(manifestPath) && JSON.parse(readFileSync(manifestPath, "utf8")).bundledMcp === true) {
      return { runtimeRoot, serverPath };
    }
    const sdkPath = path.join(runtimeRoot, "node_modules", "@modelcontextprotocol", "sdk");
    if (!statSync(sdkPath).isDirectory()) {
      return undefined;
    }
    const resolvedSdk = realpathSync(sdkPath);
    const relativeSdk = path.relative(runtimeRoot, resolvedSdk);
    if (
      relativeSdk === ".." ||
      relativeSdk.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeSdk)
    ) {
      return undefined;
    }

    return { runtimeRoot, serverPath };
  } catch {
    return undefined;
  }
}

function canonicalPathKey(candidate) {
  const resolved = path.resolve(candidate);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function payloadDigest(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function isPayloadObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safePayloadPath(relative) {
  if (
    typeof relative !== "string" || !relative || relative.length > 1024 ||
    /[\\\\:<>"|?*\u0000-\u001f]/u.test(relative) ||
    path.posix.isAbsolute(relative) || path.win32.isAbsolute(relative)
  ) throw new Error("The local payload contains an unsafe relative path.");
  const components = relative.split("/");
  if (components.length > 32 || components.some((part) =>
    !part || part === "." || part === ".." || /[. ]$/u.test(part) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)
  )) throw new Error("The local payload contains an unsafe relative path.");
  return components;
}

/** Reject links and junctions inside an already canonical, explicitly selected root. */
function unlinkedPayloadMember(root, relative) {
  const components = safePayloadPath(relative);
  let selected = root;
  let metadata;
  for (let index = 0; index < components.length; index++) {
    selected = path.join(selected, components[index]);
    metadata = lstatSync(selected);
    if (
      metadata.isSymbolicLink() ||
      canonicalPathKey(realpathSync(selected)) !== canonicalPathKey(selected)
    ) throw new Error(`The local payload member traverses a link or junction: ${relative}`);
    if (index < components.length - 1 && !metadata.isDirectory()) {
      throw new Error(`The local payload member has a non-directory parent: ${relative}`);
    }
  }
  return { selected, metadata };
}

function samePayloadFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size &&
    left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

/** Hash a bounded regular file without following a replaced leaf or allocating its full size. */
function inspectPayloadFile(root, relative, { limit = localPayloadLimits.fileBytes, retainBytes = false } = {}) {
  const { selected, metadata: before } = unlinkedPayloadMember(root, relative);
  if (!before.isFile() || before.size > limit) {
    throw new Error(`The local payload member is not a bounded regular file: ${relative}`);
  }
  const descriptor = openSync(selected, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || !samePayloadFile(before, opened)) {
      throw new Error(`The local payload member changed while opening it: ${relative}`);
    }
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, Math.max(1, before.size + 1)));
    const chunks = [];
    let size = 0;
    for (;;) {
      const count = readSync(descriptor, buffer, 0, Math.min(buffer.length, limit - size + 1), null);
      if (count === 0) break;
      size += count;
      if (size > limit || size > before.size) {
        throw new Error(`The local payload member grew while reading it: ${relative}`);
      }
      const chunk = buffer.subarray(0, count);
      hash.update(chunk);
      if (retainBytes) chunks.push(Buffer.from(chunk));
    }
    const after = fstatSync(descriptor);
    const current = unlinkedPayloadMember(root, relative).metadata;
    if (size !== before.size || !samePayloadFile(opened, after) || !samePayloadFile(after, current)) {
      throw new Error(`The local payload member changed while reading it: ${relative}`);
    }
    return {
      size,
      mode: before.mode & 0o111 ? 0o755 : 0o644,
      sha256: hash.digest("hex"),
      ...(retainBytes ? { contents: Buffer.concat(chunks, size) } : {}),
    };
  } finally {
    closeSync(descriptor);
  }
}

function payloadJson(contents, label) {
  let parsed;
  try { parsed = JSON.parse(contents.toString("utf8")); }
  catch { throw new Error(`The ${label} is not valid JSON.`); }
  if (!isPayloadObject(parsed)) throw new Error(`The ${label} must be a JSON object.`);
  return parsed;
}

function payloadInventory(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > localPayloadLimits.files) {
    throw new Error(`The ${label} is missing or oversized.`);
  }
  const seen = new Set();
  let totalBytes = 0;
  let previousPath;
  return value.map((entry) => {
    if (!isPayloadObject(entry) || Object.keys(entry).length !== 4 ||
      !["path", "mode", "size", "sha256"].every((key) => Object.hasOwn(entry, key))) {
      throw new Error(`The ${label} contains a malformed file record.`);
    }
    safePayloadPath(entry.path);
    const key = process.platform === "win32" ? entry.path.toLowerCase() : entry.path;
    if (entry.path === localPayloadReceiptPath || seen.has(key) ||
      (previousPath !== undefined && previousPath.localeCompare(entry.path, "en") >= 0) ||
      ![0o644, 0o755].includes(entry.mode) || !Number.isSafeInteger(entry.size) ||
      entry.size < 0 || entry.size > localPayloadLimits.fileBytes ||
      typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sha256)) {
      throw new Error(`The ${label} contains an invalid or duplicate file record.`);
    }
    totalBytes += entry.size;
    if (totalBytes > localPayloadLimits.totalBytes) throw new Error(`The ${label} exceeds its byte limit.`);
    previousPath = entry.path;
    seen.add(key);
    return { path: entry.path, mode: entry.mode, size: entry.size, sha256: entry.sha256 };
  });
}

function isRuntimePayloadFile(relative) {
  return relative.startsWith("dist/") || relative.startsWith("assets/devices/") || relative === "scripts/emulator_worker.py" ||
    ["scripts/dependency-doctor.mjs", "scripts/dependency-catalog.mjs", "scripts/node-releases.tsv", "scripts/setup-io.mjs", "scripts/chromatic.mjs", "scripts/chromatic-runtime.mjs"].includes(relative) ||
    relative.startsWith("third-party/chromatic-cli/") ||
    (relative.startsWith("native/capture/macos/") || relative.startsWith("native/capture/linux/")) || relative.startsWith("native-game-plugin/") || relative.startsWith("examples/");
}

/** An immutable cache has no runtime dependencies, toolchain, or unrecorded files. */
function assertExactPayloadTree(root, records, additionalFiles = []) {
  const expected = new Set([...records.map((entry) => entry.path), ...additionalFiles]);
  const directories = new Set([""]);
  for (const relative of expected) {
    const components = safePayloadPath(relative);
    for (let index = 1; index < components.length; index++) {
      directories.add(components.slice(0, index).join("/"));
    }
  }
  const found = new Set();
  function visit(relativeDirectory) {
    const directory = relativeDirectory
      ? unlinkedPayloadMember(root, relativeDirectory)
      : { selected: root, metadata: lstatSync(root) };
    if (!directory.metadata.isDirectory()) throw new Error("The local payload contains a non-directory parent.");
    for (const entry of readdirSync(directory.selected, { withFileTypes: true })) {
      const relative = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      safePayloadPath(relative);
      if (entry.isSymbolicLink()) throw new Error(`The local payload contains a link: ${relative}`);
      if (entry.isDirectory()) {
        if (!directories.has(relative)) throw new Error(`The local payload contains an unexpected directory: ${relative}`);
        visit(relative);
      } else {
        if (!entry.isFile() || !expected.has(relative) || found.has(relative)) {
          throw new Error(`The local payload contains an unexpected file: ${relative}`);
        }
        found.add(relative);
      }
    }
  }
  visit("");
  if (found.size !== expected.size) throw new Error("The local payload is incomplete.");
}

function matchingPayloadFile(root, record, { retainBytes = false, checkMode = true } = {}) {
  const actual = inspectPayloadFile(root, record.path, { retainBytes });
  if ((checkMode && actual.mode !== record.mode) || actual.size !== record.size || actual.sha256 !== record.sha256) {
    throw new Error(`The recorded file no longer matches: ${record.path}`);
  }
  return actual.contents;
}

function hasPreparedPayloadManifest(pluginRoot) {
  try {
    const manifest = payloadJson(inspectPayloadFile(realpathSync(pluginRoot), ".codex-plugin/plugin.json", {
      limit: localPayloadLimits.receiptBytes, retainBytes: true,
    }).contents, "plugin manifest");
    return manifest.name === localPayloadName && typeof manifest.version === "string" &&
      manifest.version.includes("+codex.payload.");
  } catch {
    // Receipt-free generic packages never required a manifest or its format.
    return false;
  }
}

/**
 * Verify a machine-local prepared payload before executing checkout code.
 * Ordinary packages without a receipt intentionally retain the legacy launcher.
 */
export function verifyLocalPayloadRuntime({ pluginRoot = packageRoot, runtimeRoot } = {}) {
  try {
    try { lstatSync(path.join(pluginRoot, ...localPayloadReceiptPath.split("/"))); }
    catch (error) {
      if (error.code === "ENOENT" || error.code === "ENOTDIR") {
        if (hasPreparedPayloadManifest(pluginRoot)) throw new Error("The prepared plugin's local payload receipt is missing.");
        return undefined;
      }
      throw error;
    }
    const cachedRoot = realpathSync(pluginRoot);
    if (!statSync(cachedRoot).isDirectory()) throw new Error("The cached plugin root is not a directory.");
    const receipt = payloadJson(inspectPayloadFile(cachedRoot, localPayloadReceiptPath, {
      limit: localPayloadLimits.receiptBytes, retainBytes: true,
    }).contents, "local payload receipt");
    if (receipt.schemaVersion !== 1 || receipt.pluginName !== localPayloadName ||
      typeof receipt.sourceVersion !== "string" || receipt.sourceVersion.length > 200 ||
      typeof receipt.version !== "string" || receipt.version.length > 200 ||
      typeof receipt.payloadId !== "string" || !/^[a-f0-9]{64}$/u.test(receipt.payloadId) ||
      !isPayloadObject(receipt.runtime) || receipt.runtime.packageName !== localPayloadName ||
      typeof receipt.runtime.version !== "string" || receipt.runtime.version !== receipt.sourceVersion.split("+")[0]) {
      throw new Error("The local payload receipt has an unsupported identity or schema.");
    }
    for (const key of ["runtimeRoot", "toolchainRoot", "nodeExecutable"]) {
      if (typeof receipt[key] !== "string" || !path.isAbsolute(receipt[key]) || /[\u0000-\u001f]/u.test(receipt[key])) {
        throw new Error(`The local payload receipt has an invalid ${key}.`);
      }
    }
    if (typeof runtimeRoot !== "string" ||
      canonicalPathKey(realpathSync(runtimeRoot)) !== canonicalPathKey(receipt.runtimeRoot) ||
      canonicalPathKey(realpathSync(receipt.runtimeRoot)) !== canonicalPathKey(receipt.runtimeRoot) ||
      !statSync(receipt.runtimeRoot).isDirectory()) {
      throw new Error("The selected prepared runtime does not match the recorded canonical runtime root.");
    }
    const selectedRuntime = realpathSync(runtimeRoot);
    const files = payloadInventory(receipt.files, "payload inventory");
    const runtimeFiles = payloadInventory(receipt.runtime.files, "runtime inventory");
    if (payloadDigest(JSON.stringify(files)) !== receipt.payloadId ||
      JSON.stringify(runtimeFiles) !== JSON.stringify(files.filter((entry) => isRuntimePayloadFile(entry.path)))) {
      throw new Error("The local payload receipt inventories do not match their recorded identity.");
    }
    const byPath = new Map(files.map((entry) => [entry.path, entry]));
    for (const required of [".codex-plugin/plugin.json", ".mcp.json", "package.json", "scripts/start-mcp.mjs", "scripts/chromatic-runtime.mjs", "scripts/emulator_worker.py", "dist/server.js"]) {
      if (!byPath.has(required)) throw new Error(`The local payload receipt is missing ${required}.`);
    }
    assertExactPayloadTree(cachedRoot, files, [localPayloadReceiptPath]);
    const jsonFiles = new Map();
    for (const record of files) {
      const retainBytes = [".codex-plugin/plugin.json", ".mcp.json", "package.json"].includes(record.path);
      const contents = matchingPayloadFile(cachedRoot, record, { retainBytes });
      if (retainBytes) jsonFiles.set(record.path, payloadJson(contents, record.path));
    }
    const pluginManifest = jsonFiles.get(".codex-plugin/plugin.json");
    const packageManifest = jsonFiles.get("package.json");
    const mcpConfiguration = jsonFiles.get(".mcp.json")?.mcpServers?.["modretro-chromatic"];
    if (pluginManifest.name !== localPayloadName || pluginManifest.version !== receipt.version ||
      packageManifest.name !== localPayloadName || packageManifest.version !== receipt.runtime.version) {
      throw new Error("The cached plugin or package version does not match its receipt.");
    }
    const sourceManifest = Buffer.from(`${JSON.stringify({ ...pluginManifest, version: receipt.sourceVersion }, null, 2)}\n`);
    const originalFiles = files.map((entry) => entry.path === ".codex-plugin/plugin.json"
      ? { ...entry, size: sourceManifest.length, sha256: payloadDigest(sourceManifest) }
      : entry);
    const expectedVersion = `${receipt.runtime.version}+codex.payload.${payloadDigest(JSON.stringify(originalFiles)).slice(0, 24)}`;
    if (receipt.version !== expectedVersion) throw new Error("The cached plugin version is not bound to its prepared contents.");
    if (!isPayloadObject(mcpConfiguration) || mcpConfiguration.command !== receipt.nodeExecutable ||
      mcpConfiguration.env?.GB_STUDIO_RUNTIME_ROOT !== receipt.runtimeRoot ||
      mcpConfiguration.env?.GB_STUDIO_TOOLCHAIN_ROOT !== receipt.toolchainRoot) {
      throw new Error("The cached MCP launcher configuration does not match its receipt.");
    }
    const selectedPackage = payloadJson(inspectPayloadFile(selectedRuntime, "package.json", {
      limit: localPayloadLimits.receiptBytes, retainBytes: true,
    }).contents, "prepared runtime package manifest");
    if (selectedPackage.name !== localPayloadName || selectedPackage.version !== receipt.runtime.version) {
      throw new Error("The selected prepared runtime package name or version changed.");
    }
    const target = chromaticTargetFromManifest(packageManifest);
    const format = chromaticFormatFromManifest(packageManifest);
    if (chromaticTargetFromManifest(selectedPackage) !== target) {
      throw new Error("The cached plugin and selected runtime target different platforms.");
    }
    if (chromaticFormatFromManifest(selectedPackage) !== format) throw new Error("Runtime and package Chromatic formats differ.");
    requireChromaticHostTarget(target);
    const distFiles = runtimeFiles.filter((entry) => entry.path.startsWith("dist/"))
      .map((entry) => ({ ...entry, path: entry.path.slice("dist/".length) }));
    const runtimeDist = unlinkedPayloadMember(selectedRuntime, "dist");
    if (!runtimeDist.metadata.isDirectory()) throw new Error("The selected prepared runtime has no real dist directory.");
    assertExactPayloadTree(runtimeDist.selected, distFiles);
    const chromaticPrefix = "third-party/chromatic-cli/";
    const chromaticFiles = runtimeFiles.filter((entry) => entry.path.startsWith(chromaticPrefix));
    if (chromaticFiles.length) {
      const nativeRoot = unlinkedPayloadMember(selectedRuntime, chromaticPrefix.slice(0, -1));
      if (!nativeRoot.metadata.isDirectory()) throw new Error("The bundled Chromatic runtime is not a real directory.");
      assertExactPayloadTree(nativeRoot.selected, chromaticFiles.map((entry) => ({ ...entry, path: entry.path.slice(chromaticPrefix.length) })));
    }
    const capturePrefixes = ["native/capture/macos/", "native/capture/linux/"];
    for (const capturePrefix of capturePrefixes) {
      const captureFiles = runtimeFiles.filter((entry) => entry.path.startsWith(capturePrefix));
      if (captureFiles.length) {
        const captureRoot = unlinkedPayloadMember(selectedRuntime, capturePrefix.slice(0, -1));
        if (!captureRoot.metadata.isDirectory()) throw new Error("The native capture runtime is not a real directory.");
        assertExactPayloadTree(captureRoot.selected, captureFiles.map((entry) => ({ ...entry, path: entry.path.slice(capturePrefix.length) })));
      }
    }
    const samplePrefix = "examples/wrecklight/";
    const sampleFiles = runtimeFiles.filter((entry) => entry.path.startsWith(samplePrefix));
    if (sampleFiles.length) {
      const sampleRoot = unlinkedPayloadMember(selectedRuntime, samplePrefix.slice(0, -1));
      if (!sampleRoot.metadata.isDirectory()) throw new Error("The bundled Wrecklight sample is not a real directory.");
      assertExactPayloadTree(sampleRoot.selected, sampleFiles.map((entry) => ({ ...entry, path: entry.path.slice(samplePrefix.length) })));
    }
    for (const record of runtimeFiles) matchingPayloadFile(selectedRuntime, record, { checkMode: capturePrefixes.some(prefix => record.path.startsWith(prefix)) || record.path.startsWith(chromaticPrefix) || record.path.startsWith(samplePrefix) });
    return receipt;
  } catch (error) {
    throw new Error(`${localPayloadRepair} ${error.message}`, { cause: error });
  }
}

function verifyLauncherPlatform(root) {
  const selected = realpathSync(root);
  try { lstatSync(path.join(selected, "package.json")); }
  catch (error) {
    // Preserve legacy receipt-free launchers that have no package manifest.
    if (error.code === "ENOENT") return;
    throw error;
  }
  const manifest = payloadJson(inspectPayloadFile(selected, "package.json", {
    limit: localPayloadLimits.receiptBytes, retainBytes: true,
  }).contents, "launcher package manifest");
  requireChromaticHostTarget(chromaticTargetFromManifest(manifest));
  chromaticFormatFromManifest(manifest);
}

function startMcpLauncher() {
  verifyLauncherPlatform(packageRoot);
  const platform = process.platform;
  const requestedRuntimeRoot = readEnvironment(process.env, "GB_STUDIO_RUNTIME_ROOT", platform)?.trim();
  const candidateRoot = path.resolve(requestedRuntimeRoot || packageRoot);
  const preparedRuntime = resolvePreparedRuntime(candidateRoot);
  verifyLocalPayloadRuntime({ runtimeRoot: preparedRuntime?.runtimeRoot });

  if (!preparedRuntime) {
    const selection = requestedRuntimeRoot
      ? "the explicitly configured runtime"
      : "this installed plugin";
    console.error(
      `ModRetro Chromatic MCP could not find a prepared runtime for ${selection}. ` +
        `${packagedSetupGuidance} ` +
        `Inspected: ${candidateRoot}`,
    );
    process.exitCode = 1;
    return;
  }

  const { runtimeRoot, serverPath } = preparedRuntime;
  verifyLauncherPlatform(runtimeRoot);
  const localToolchainPath = path.join(runtimeRoot, ".local");
  const bundled = existsSync(path.join(runtimeRoot, "package.json")) && JSON.parse(readFileSync(path.join(runtimeRoot, "package.json"), "utf8")).bundledMcp === true;
  const home = readEnvironment(process.env, platform === "win32" ? "USERPROFILE" : "HOME", platform) || os.homedir();
  const dataRoot = platform === "darwin" ? path.join(home, "Library", "Application Support")
    : platform === "win32" ? readEnvironment(process.env, "LOCALAPPDATA", platform) || path.join(home, "AppData", "Local")
      : readEnvironment(process.env, "XDG_DATA_HOME", platform) || path.join(home, ".local", "share");
  const setupRoot = readEnvironment(process.env, "GB_STUDIO_SETUP_ROOT", platform) || path.join(dataRoot, "modretro-chromatic");
  if (!path.isAbsolute(setupRoot)) throw new Error("The dependency setup root must be absolute.");
  let defaultToolchainRoot = bundled ? path.join(setupRoot, "toolchain") : runtimeRoot;
  if (existsSync(localToolchainPath)) {
    const resolvedLocal = realpathSync(localToolchainPath);
    if (!statSync(resolvedLocal).isDirectory() || path.basename(resolvedLocal).toLowerCase() !== ".local") {
      throw new Error("The trusted local game toolchain must resolve to a real .local directory.");
    }
    defaultToolchainRoot = path.dirname(resolvedLocal);
  }

  const childEnvironment = prepareMcpLauncherEnvironment({
    environment: process.env,
    platform,
    runtimeRoot,
    pluginRoot: realpathSync(packageRoot),
    defaultToolchainRoot,
  });
  const child = spawn(process.execPath, [serverPath, ...process.argv.slice(2)], {
    cwd: runtimeRoot,
    env: childEnvironment,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });

  const forwardSignal = (signal) => {
    if (!child.killed && child.exitCode === null) {
      child.kill(signal);
    }
  };
  const cleanupChild = () => forwardSignal("SIGTERM");
  const handlers = new Map();
  for (const signal of mcpLauncherSignals(platform)) {
    const handler = () => forwardSignal(signal);
    handlers.set(signal, handler);
    process.on(signal, handler);
  }
  process.once("exit", cleanupChild);

  const removeHandlers = () => {
    for (const [signal, handler] of handlers) process.removeListener(signal, handler);
    process.removeListener("exit", cleanupChild);
  };

  child.once("error", (error) => {
    removeHandlers();
    console.error(`ModRetro Chromatic MCP could not start ${serverPath}: ${error.message}`);
    process.exitCode = 1;
  });

  child.once("exit", (code, signal) => {
    removeHandlers();
    if (code !== null) {
      process.exitCode = code;
    } else {
      const signalCode = signal === null ? 0 : os.constants.signals[signal] || 0;
      process.exitCode = 128 + signalCode;
    }
  });
}

const invokedEntrypoint = process.argv[1];
if (
  invokedEntrypoint &&
  realpathSync(fileURLToPath(import.meta.url)) === realpathSync(path.resolve(invokedEntrypoint))
) {
  try {
    startMcpLauncher();
  } catch (error) {
    console.error(`ModRetro Chromatic MCP could not start safely: ${error.message}`);
    process.exitCode = 1;
  }
}
