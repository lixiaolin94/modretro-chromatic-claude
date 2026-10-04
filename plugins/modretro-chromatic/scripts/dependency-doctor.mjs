import { constants } from "node:fs";
import { access, lstat, open, opendir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DEPENDENCY_CATALOG, NODE_RELEASES, SUPPORTED_SETUP_PLATFORMS } from "./dependency-catalog.mjs";
import { runSetupCommand, setupSha256File } from "./setup-io.mjs";

export const DEPENDENCY_TASKS = Object.freeze(["authoring", "projectBuild", "cBuild", "play", "desktop"]);
export const DEPENDENCY_PROBES = Object.freeze(["cli-version", "gbdk-version", "emulator-import"]);
const DEFAULT_TASKS = ["projectBuild", "play"];
const COMPONENTS = ["node", "runtime", "cli", "gbdk", "python", "pyboy", "pillow", "desktop", "uv"];
const TASK_COMPONENTS = {
  authoring: ["node", "runtime"],
  projectBuild: ["node", "runtime", "cli", "gbdk"],
  cBuild: ["node", "runtime", "gbdk"],
  play: ["node", "runtime", "cli", "gbdk", "python", "pyboy", "pillow"],
  desktop: ["desktop"],
};
const contexts = new WeakMap();
const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_PROBE_BYTES = 64 * 1024;
const UNSAFE_ENV = new Set([
  "NODE_OPTIONS", "NODE_PATH", "NODE_EXTRA_CA_CERTS", "NODE_REPL_HISTORY", "PYTHONPATH", "PYTHONHOME",
  "PYTHONSTARTUP", "PYTHONUSERBASE", "PYTHONWARNINGS", "PYTHONINSPECT", "PYTHONBREAKPOINT",
  "PYTHONEXECUTABLE", "__PYVENV_LAUNCHER__",
  "VIRTUAL_ENV", "CONDA_PREFIX", "BASH_ENV", "ENV", "LD_PRELOAD", "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "DYLD_FRAMEWORK_PATH",
  "PSMODULEPATH", "PSMODULEANALYSISCACHEPATH", "PSEXECUTIONPOLICYPREFERENCE", "__PSLOCKDOWNPOLICY",
]);

function environmentValue(environment, name, platform) {
  if (platform !== "win32") return environment[name] || undefined;
  const values = Object.entries(environment).filter(([key, value]) => key.toUpperCase() === name.toUpperCase() && value !== undefined).map(([, value]) => value);
  if (new Set(values).size > 1) throw new TypeError(`Conflicting case-insensitive Windows environment values exist for ${name}.`);
  return values[0] || undefined;
}

function absolute(candidate, label) {
  if (typeof candidate !== "string" || candidate.length > 4096 || /[\u0000-\u001f]/u.test(candidate) || !path.isAbsolute(candidate)) {
    throw new TypeError(`${label} must be an absolute path without control characters.`);
  }
  if (process.platform === "win32" && (/^[\\/]{2}/u.test(candidate) || candidate.split(/[\\/]+/u).some((part, index) =>
    (part.includes(":") && !(index === 0 && /^[a-z]:$/iu.test(part))) || /[. ]$/u.test(part) ||
    /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part)))) {
    throw new TypeError(`${label} must not contain a Windows network, device, stream, or ambiguous alias.`);
  }
  return path.resolve(candidate);
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function missing(error) { return error?.code === "ENOENT" || error?.code === "ENOTDIR"; }

async function directory(candidate, label) {
  const selected = absolute(candidate, label);
  try {
    const canonical = await realpath(selected);
    if (!(await stat(canonical)).isDirectory()) throw new TypeError(`${label} must name a directory.`);
    return canonical;
  } catch (error) {
    if (error?.code === "ENOENT") return selected;
    throw error;
  }
}

async function toolchainOwner(candidate) {
  const selected = await directory(candidate, "Toolchain root");
  const local = path.join(selected, ".local");
  try {
    if (!(await lstat(local)).isSymbolicLink()) return selected;
    const canonical = await realpath(local);
    if (path.basename(canonical) !== ".local" || !(await stat(canonical)).isDirectory()) {
      throw new TypeError("A linked toolchain must resolve to an actual .local directory.");
    }
    return path.dirname(canonical);
  } catch (error) {
    if (missing(error)) return selected;
    throw error;
  }
}

async function regular(candidate, root, executable = false, platform = process.platform) {
  const canonical = await realpath(candidate);
  if (root && !within(root, canonical)) throw new Error("A dependency file resolves outside its selected root.");
  const metadata = await stat(canonical);
  if (!metadata.isFile() || metadata.size === 0) throw new Error("A dependency file must be a nonempty regular file.");
  if (executable) await access(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
  return canonical;
}

async function boundedText(candidate, root, limit = MAX_METADATA_BYTES) {
  await regular(candidate, root);
  const handle = await open(candidate, "r");
  try {
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size > limit) throw new Error("Dependency metadata exceeds its regular-file size bound.");
    const buffer = Buffer.alloc(limit + 1);
    let count = 0;
    while (count < buffer.length) {
      const result = await handle.read(buffer, count, buffer.length - count, count);
      if (result.bytesRead === 0) break;
      count += result.bytesRead;
    }
    if (count > limit) throw new Error("Dependency metadata exceeds its size bound.");
    return buffer.toString("utf8", 0, count);
  } finally { await handle.close(); }
}

async function object(candidate, root) {
  const contents = await boundedText(candidate, root);
  let parsed;
  try { parsed = JSON.parse(contents); }
  catch (cause) { throw new Error(`Dependency metadata could not be read as JSON: ${candidate}`, { cause }); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`Dependency metadata must be an object: ${candidate}`);
  return parsed;
}

async function optionalObject(candidate, root) {
  try { return await object(candidate, root); } catch (error) { if (missing(error)) return undefined; throw error; }
}

async function executableHash(candidate, root) {
  return (await setupSha256File(await regular(candidate, root))).sha256;
}

function version(value) {
  if (typeof value !== "string") return undefined;
  const matched = value.trim().match(/^v?(\d+)\.(\d+)(?:\.(\d+))?$/u);
  return matched ? `${Number(matched[1])}.${Number(matched[2])}.${Number(matched[3] ?? 0)}` : undefined;
}

function compatible(id, detected, requiredVersion) {
  const normalized = version(detected);
  if (!normalized) return false;
  const parts = normalized.split(".").map(Number);
  const definition = DEPENDENCY_CATALOG[id];
  switch (definition.versionPolicy) {
    case "minimum": return parts[0] >= Number(definition.requiredVersion);
    case "minor": return `${parts[0]}.${parts[1]}` === definition.requiredVersion;
    case "range": return parts[0] === 11 || parts[0] === 12;
    default: return normalized === version(requiredVersion ?? definition.requiredVersion);
  }
}

function nextStep(id, roots, platform = process.platform) {
  if (id === "node") return `Use the packaged setup bootstrap to provision a compatible Node executable under ${roots.nodeRoot}; selecting or activating a different bound executable is separate.`;
  const group = ["python", "pyboy", "pillow", "uv"].includes(id) ? "emulator" : ["cli", "gbdk"].includes(id) ? "build" : id;
  const quote = (value) => "'" + (platform === "win32" ? value.replaceAll("'", "''") : value.replaceAll("'", "'\\''")) + "'";
  return `Run ${platform === "win32" ? "& " : ""}${quote(process.execPath)} ${quote(path.join(roots.packageRoot, "scripts", "setup.mjs"))} plan --root ${quote(roots.setupRoot)} --components ${group}. Review the plan before apply; existing bound roots are inspection-only.`;
}

function component(id, roots, provenance, platform) {
  return { id, status: "missing", requiredVersion: DEPENDENCY_CATALOG[id].requiredVersion, provenance,
    detectionEvidence: [], probeStatus: "not-run", nextSteps: [nextStep(id, roots, platform)],
    ...(DEPENDENCY_CATALOG[id].installerOnly ? { installerOnly: true } : {}) };
}

function detected(result, detectedVersion, evidence) {
  if (!version(detectedVersion)) throw new Error(`The ${result.id} version metadata is missing or malformed.`);
  result.detectedVersion = detectedVersion;
  result.detectionEvidence.push(evidence);
  result.status = compatible(result.id, detectedVersion, result.requiredVersion) ? "ready" : "incompatible";
  if (result.status === "ready") result.nextSteps = [];
  return result;
}

async function detectFile(result, inspect) {
  let primaryExists = false;
  try { if (result.path) { await lstat(result.path); primaryExists = true; } } catch { /* Classified by inspection below. */ }
  try { await inspect(); } catch (error) {
    result.status = missing(error) && !primaryExists ? "missing" : "broken";
    result.detectionEvidence.push(error instanceof Error ? error.message : String(error));
  }
  return result;
}

async function resolveRoots(options, environment, platform) {
  const supplied = options.resolvedRoots ?? {};
  const packageRoot = await directory(options.packageRoot ?? supplied.packageRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), "Package root");
  const selectedSetup = options.setupRoot ?? supplied.setupRoot ?? environmentValue(environment, "GB_STUDIO_SETUP_ROOT", platform);
  const explicitSetup = selectedSetup !== undefined;
  const home = environmentValue(environment, platform === "win32" ? "USERPROFILE" : "HOME", platform) ?? os.homedir();
  const dataRoot = platform === "darwin" ? path.join(home, "Library", "Application Support")
    : platform === "win32" ? (environmentValue(environment, "LOCALAPPDATA", platform) ?? path.join(home, "AppData", "Local"))
    : (environmentValue(environment, "XDG_DATA_HOME", platform) ?? path.join(home, ".local", "share"));
  const setupRoot = await directory(selectedSetup ?? path.join(dataRoot, "modretro-chromatic"), "Setup root");
  let receipt;
  const receiptEvidence = [];
  if (!explicitSetup) {
    try {
      receipt = await optionalObject(path.join(packageRoot, ".codex-plugin", "local-payload.json"), packageRoot);
      if (receipt && (receipt.schemaVersion !== 1 || receipt.pluginName !== "modretro-chromatic")) throw new Error("Unsupported local-payload receipt.");
      if (receipt) for (const key of ["runtimeRoot", "toolchainRoot", "nodeExecutable"]) absolute(receipt[key], `Receipt ${key}`);
    } catch (error) { receipt = undefined; receiptEvidence.push(`Local payload inspection receipt was ignored: ${error.message}`); }
  }
  const bound = (name) => explicitSetup ? undefined : environmentValue(environment, name, platform);
  const selectedRuntime = options.runtimeRoot ?? supplied.runtimeRoot ?? bound("GB_STUDIO_RUNTIME_ROOT") ?? receipt?.runtimeRoot;
  const selectedToolchain = options.toolchainRoot ?? supplied.toolchainRoot ?? bound("GB_STUDIO_TOOLCHAIN_ROOT") ?? receipt?.toolchainRoot;
  const origin = (option, resolved, envName, fromReceipt, fallback) => option !== undefined ? "explicit option"
    : resolved !== undefined ? "explicit resolved root" : bound(envName) !== undefined ? `environment ${envName}`
      : fromReceipt !== undefined ? "local-payload inspection receipt (not activated or reverified)" : fallback;
  const bundled = (await optionalObject(path.join(packageRoot, "package.json"), packageRoot))?.bundledMcp === true;
  const roots = {
    packageRoot, setupRoot,
    runtimeRoot: await directory(selectedRuntime ?? (bundled ? packageRoot : path.join(setupRoot, "runtime")), "Runtime root"),
    toolchainRoot: await toolchainOwner(selectedToolchain ?? path.join(setupRoot, "toolchain")),
    nodeRoot: await directory(options.nodeRoot ?? supplied.nodeRoot ?? path.join(setupRoot, "node"), "Managed Node root"),
  };
  return { roots, receipt, receiptEvidence, explicitSetup,
    nodeExecutable: options.nodeExecutable ?? supplied.nodeExecutable ?? bound("GB_STUDIO_NODE") ?? receipt?.nodeExecutable,
    pythonPath: options.pythonPath ?? bound("GB_STUDIO_PYTHON"),
    provenance: {
      runtime: origin(options.runtimeRoot, supplied.runtimeRoot, "GB_STUDIO_RUNTIME_ROOT", receipt?.runtimeRoot, "external setup runtime sibling"),
      toolchain: origin(options.toolchainRoot, supplied.toolchainRoot, "GB_STUDIO_TOOLCHAIN_ROOT", receipt?.toolchainRoot, "external setup toolchain sibling"),
      node: origin(options.nodeExecutable, supplied.nodeExecutable, "GB_STUDIO_NODE", receipt?.nodeExecutable, "managed receipt or current Node process"),
      python: origin(options.pythonPath, undefined, "GB_STUDIO_PYTHON", undefined, "selected toolchain virtual environment"),
      setup: explicitSetup ? "explicit setup root" : "operating-system external data root",
    } };
}

async function detectNode(result, context) {
  const { roots, platform, arch } = context;
  const receiptPath = path.join(roots.nodeRoot, `${platform}-${arch}`, "receipt.json");
  let receipt;
  try {
    receipt = await optionalObject(receiptPath, roots.nodeRoot);
    const release = NODE_RELEASES[`${platform}-${arch}`];
    if (receipt && (receipt.schemaVersion !== 1 || receipt.owner !== "codex-gb-studio-setup" || receipt.platform !== `${platform}-${arch}` ||
      !release || receipt.version !== release.version || receipt.sourceUrl !== release.url || receipt.archiveSha256 !== release.sha256 ||
      !/^[a-f0-9]{64}$/u.test(receipt.executableSha256) || !within(path.dirname(receiptPath), absolute(receipt.executablePath, "Managed Node executable")))) {
      throw new Error("Managed Node receipt does not describe this platform and managed root.");
    }
    if (receipt && await executableHash(receipt.executablePath, roots.nodeRoot) !== receipt.executableSha256) throw new Error("Managed Node executable SHA-256 does not match its receipt.");
  } catch (error) {
    receipt = undefined;
    result.detectionEvidence.push(`Managed Node receipt: ${error.message}`);
    if (!context.nodeExecutable || within(roots.nodeRoot, context.nodeExecutable)) {
      result.path = context.nodeExecutable ?? receiptPath;
      result.status = "broken";
      return;
    }
  }
  const selected = context.nodeExecutable ?? receipt?.executablePath ?? process.execPath;
  result.path = absolute(selected, "Node executable");
  context.nodeExecutable = result.path;
  await detectFile(result, async () => {
    const canonical = await regular(result.path, undefined, true, platform);
    if (canonical === await realpath(process.execPath)) {
      detected(result, process.versions.node, "Current Node process version; no subprocess launched.");
    } else if (receipt?.executablePath === result.path) {
      detected(result, receipt.version, `Managed Node version from ${receiptPath}; catalog archive identity and executable SHA-256 match, but executable health has not been probed.`);
    } else {
      const header = path.resolve(path.dirname(result.path), "..", "include", "node", "node_version.h");
      const source = await boundedText(header, undefined, 64 * 1024);
      const parts = ["MAJOR", "MINOR", "PATCH"].map((key) => source.match(new RegExp(`^\\s*#\\s*define\\s+NODE_${key}_VERSION\\s+(\\d+)`, "mu"))?.[1]);
      if (parts.some((part) => part === undefined)) throw new Error("Node version metadata is missing or malformed.");
      detected(result, parts.join("."), `Node version header: ${header}; binary has not been executed.`);
    }
  });
}

async function detectRuntime(result, context) {
  const { packageRoot, runtimeRoot } = context.roots;
  result.path = runtimeRoot;
  await detectFile(result, async () => {
    const source = await optionalObject(path.join(packageRoot, "package.json"), packageRoot)
      ?? await optionalObject(path.join(packageRoot, ".codex-plugin", "plugin.json"), packageRoot);
    const required = source?.version?.split("+")[0] ?? context.receipt?.sourceVersion;
    if (!version(required)) throw new Error("Source runtime package version is not known.");
    result.requiredVersion = required;
    const installed = await object(path.join(runtimeRoot, "package.json"), runtimeRoot);
    if (installed.name !== "modretro-chromatic") throw new Error("Runtime package identity is not modretro-chromatic.");
    await regular(path.join(runtimeRoot, "dist", "server.js"), runtimeRoot);
    for (const name of ["emulator_worker.py", "dependency-doctor.mjs", "dependency-catalog.mjs", "node-releases.tsv", "setup-io.mjs"]) {
      await regular(path.join(runtimeRoot, "scripts", name), runtimeRoot);
    }
    const starter = await object(path.join(runtimeRoot, "examples", "starter", "project.gbsproj"), runtimeRoot);
    if (starter._resourceType !== "project" || typeof starter.name !== "string" || !starter.name.trim()) throw new Error("The packaged native game starter metadata is malformed.");
    if (installed.bundledMcp === true) {
      await regular(path.join(runtimeRoot, "scripts", "device-client-deps.mjs"), runtimeRoot);
      detected(result, installed.version, "Bundled MCP entrypoint, device client, worker and starter are present; no modules imported.");
      return;
    }
    const lock = await optionalObject(path.join(packageRoot, "scripts", "runtime-package-lock.json"), packageRoot)
      ?? await optionalObject(path.join(runtimeRoot, "package-lock.json"), runtimeRoot);
    for (const name of ["@modelcontextprotocol/sdk", "pngjs", "zod"]) {
      const dependency = await object(path.join(runtimeRoot, "node_modules", ...name.split("/"), "package.json"), runtimeRoot);
      const expected = lock?.packages?.[`node_modules/${name}`]?.version;
      if (!expected || dependency.name !== name || dependency.version !== expected) throw new Error(`Runtime dependency metadata does not match its reviewed lock: ${name}.`);
    }
    detected(result, installed.version, "Runtime entrypoint, worker, starter and direct production dependency metadata match the package and lock; no modules imported.");
  });
}

function cliCandidates(root, platform) {
  const vendor = path.join(root, ".local", "vendor", "gb-studio");
  const apps = path.join(root, ".local", "apps");
  const directories = platform === "win32" ? [vendor,
    path.join(apps, "GB Studio", "resources", "app"), path.join(apps, "GB Studio", "win-unpacked", "resources", "app")]
    : [vendor, path.join(apps, "GB Studio.app", "Contents", "Resources", "app")];
  return directories.map((directory) => ({ directory, executable: path.join(directory, "out", "cli", "gb-studio-cli.js") }));
}

async function firstPresent(candidates) {
  for (const candidate of candidates) {
    try { await lstat(candidate); return candidate; } catch (error) { if (!missing(error)) throw error; }
  }
  return candidates[0];
}

async function detectCli(result, context) {
  const root = context.roots.toolchainRoot;
  const candidates = cliCandidates(root, context.platform);
  result.path = await firstPresent(candidates.map((candidate) => candidate.executable));
  await detectFile(result, async () => {
    await regular(result.path, root);
    const packagePath = path.resolve(path.dirname(result.path), "..", "..", "package.json");
    const metadata = await object(packagePath, root);
    if (metadata.name !== "gb-studio") throw new Error("CLI package metadata is not the official gb-studio package.");
    const cliRoot = path.dirname(packagePath);
    await object(path.join(cliRoot, "appData", "engine", "engine.json"), root);
    await regular(path.join(cliRoot, "appData", "engine", "gbvm", "include", "vm.h"), root);
    const compilerRoot = path.join(cliRoot, "buildTools", `${context.platform}-${context.arch}`, "gbdk");
    await regular(path.join(compilerRoot, "bin", context.platform === "win32" ? "lcc.exe" : "lcc"), root, true, context.platform);
    const header = await boundedText(path.join(compilerRoot, "include", "gbdk", "version.h"), root, 64 * 1024);
    if (!/^\s*#\s*define\s+__GBDK_VERSION\s+450(?:\s|$)/mu.test(header)) throw new Error("The CLI's embedded GBDK version metadata is incompatible.");
    detected(result, metadata.version, `CLI artifact, package version, engine metadata, VM header and platform GBDK resources: ${packagePath}; --version was not run.`);
  });
}

async function detectGbdk(result, context) {
  const root = context.roots.toolchainRoot;
  result.path = path.join(root, ".local", "gbdk", "bin", context.platform === "win32" ? "lcc.exe" : "lcc");
  await detectFile(result, async () => {
    await regular(result.path, root, true, context.platform);
    const header = path.join(root, ".local", "gbdk", "include", "gbdk", "version.h");
    const source = await boundedText(header, root, 64 * 1024);
    const encoded = source.match(/^\s*#\s*define\s+__GBDK_VERSION\s+(\d{3})(?:\s|$)/mu)?.[1];
    if (!encoded) throw new Error("GBDK version header is missing its version definition.");
    detected(result, encoded.split("").join("."), `GBDK version header: ${header}; lcc was not executed.`);
  });
}

async function pythonMetadata(result, context) {
  const windows = context.platform === "win32";
  result.path = absolute(context.pythonPath ?? path.join(context.roots.toolchainRoot, ".local", "pyboy-venv", windows ? "Scripts" : "bin", windows ? "python.exe" : "python"), "Python executable");
  context.pythonPath = result.path;
  context.venvRoot = path.dirname(path.dirname(result.path));
  await detectFile(result, async () => {
    // A venv executable normally links to its base interpreter. Keep the venv's
    // invocation path: replacing it with realpath would change package selection.
    await regular(result.path, undefined, true, context.platform);
    const configPath = path.join(context.venvRoot, "pyvenv.cfg");
    const config = await boundedText(configPath, context.venvRoot, 64 * 1024);
    if (/^\s*include-system-site-packages\s*=\s*true\s*$/imu.test(config)) throw new Error("The configured Python environment includes system site packages.");
    // uv may record only major.minor; preserve that precision in the report.
    const detectedVersion = config.match(/^\s*version(?:_info)?\s*=\s*(\d+\.\d+(?:\.\d+)?)(?:\.(?:alpha|beta|candidate|final)\.\d+)?[\t ]*$/imu)?.[1];
    if (!detectedVersion) throw new Error("Python version is not recorded in pyvenv.cfg.");
    context.pythonVersion = detectedVersion;
    detected(result, detectedVersion, `Python virtual-environment version: ${configPath}; no interpreter launched.`);
  });
}

async function distributionMetadata(result, context) {
  const id = result.id;
  const minor = (context.pythonVersion ?? DEPENDENCY_CATALOG.python.requiredVersion).split(".").slice(0, 2).join(".");
  const site = context.platform === "win32" ? path.join(context.venvRoot, "Lib", "site-packages")
    : path.join(context.venvRoot, "lib", `python${minor}`, "site-packages");
  result.path = site;
  await detectFile(result, async () => {
    const matches = [];
    const entries = await opendir(site);
    let count = 0;
    for await (const entry of entries) {
      if (++count > 4096) throw new Error("Python metadata directory exceeds its entry bound.");
      if (entry.name.toLowerCase().startsWith(`${id}-`) && entry.name.endsWith(".dist-info")) matches.push(entry.name);
    }
    if (matches.length === 0) { result.status = "missing"; result.detectionEvidence.push(`No ${id} dist-info metadata in the selected environment.`); return; }
    if (matches.length !== 1) throw new Error(`Multiple ${id} distributions make package selection ambiguous.`);
    const metadataPath = path.join(site, matches[0], "METADATA");
    result.path = metadataPath;
    const source = await boundedText(metadataPath, context.venvRoot, 256 * 1024);
    if (source.match(/^Name:\s*(.+)$/imu)?.[1]?.trim().toLowerCase() !== id) throw new Error(`Unexpected ${id} distribution name.`);
    const detectedVersion = source.match(/^Version:\s*(.+)$/imu)?.[1]?.trim();
    await regular(path.join(site, id === "pillow" ? "PIL" : "pyboy", "__init__.py"), context.venvRoot);
    detected(result, detectedVersion, `Distribution METADATA and module entrypoint: ${metadataPath}; no imports or ABI checks performed.`);
  });
}

async function detectDesktop(result, context) {
  const root = context.roots.toolchainRoot;
  const apps = path.join(root, ".local", "apps");
  const windows = path.join(apps, "GB Studio");
  const candidates = context.platform === "darwin" ? [path.join(apps, "GB Studio.app")]
    : context.platform === "win32" ? [path.join(windows, "GB Studio-win32-x64", "gb-studio.exe"), path.join(windows, "gb-studio.exe"), path.join(windows, "GB Studio.exe"), path.join(windows, "win-unpacked", "GB Studio.exe"), path.join(windows, "app", "GB Studio.exe")]
      : [path.join(apps, "gb-studio-linux.AppImage"), path.join(apps, "gb-studio-linux-arm64.AppImage")];
  result.path = await firstPresent(candidates);
  await detectFile(result, async () => {
    if (context.platform === "darwin") {
      const plist = path.join(result.path, "Contents", "Info.plist");
      const contents = await boundedText(plist, root, 256 * 1024);
      const value = contents.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/u)?.[1];
      if (!value) throw new Error("Desktop version is not available as passive plist metadata.");
      detected(result, value, `Desktop Info.plist: ${plist}; application was not launched.`);
    } else {
      await regular(result.path, root);
      const metadata = context.platform === "win32" ? await optionalObject(path.join(path.dirname(result.path), "resources", "app", "package.json"), root) : undefined;
      if (metadata) { detected(result, metadata.version, "Extracted desktop package version; application was not launched."); return; }
      const receipt = await optionalObject(path.join(context.roots.setupRoot, "receipts", "desktop.json"), context.roots.setupRoot);
      const expectedDestination = context.platform === "win32" ? windows : result.path;
      if (!receipt || receipt.owner !== "codex-gb-studio-setup" || receipt.id !== "desktop" || receipt.destination !== expectedDestination || !["prepared", "ready"].includes(receipt.status)) throw new Error("Desktop exists but has no compatible passive version metadata; app.asar is not a CLI.");
      detected(result, receipt.version, "Managed desktop receipt version; application was not launched.");
    }
  });
}

async function detectUv(result, context) {
  result.path = path.join(context.roots.setupRoot, "uv", `${context.platform}-${context.arch}`, context.platform === "win32" ? "uv.exe" : "uv");
  await detectFile(result, async () => {
    await regular(result.path, context.roots.setupRoot, true, context.platform);
    const receipt = await object(path.join(context.roots.setupRoot, "receipts", "uv.json"), context.roots.setupRoot);
    if (receipt.owner !== "codex-gb-studio-setup" || receipt.id !== "uv" || receipt.destination !== path.dirname(result.path) || !["prepared", "ready"].includes(receipt.status)) throw new Error("uv receipt does not match the managed executable directory.");
    detected(result, receipt.version, "Declared version from the owned uv setup receipt; uv was not executed. Installer prerequisite only.");
  });
}

/** Inspect bounded local metadata only. Never launch/import a dependency or write files. */
export async function detectDependencies(options = {}) {
  const environment = { ...(options.environment ?? process.env) };
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const requestedTasks = [...new Set(options.tasks ?? options.requestedTasks ?? DEFAULT_TASKS)];
  if (requestedTasks.length === 0 || requestedTasks.some((task) => !DEPENDENCY_TASKS.includes(task))) throw new TypeError("Select at least one supported dependency task.");
  const resolved = await resolveRoots(options, environment, platform);
  const context = { ...resolved, environment, platform, arch };
  const components = COMPONENTS.map((id) => component(id, resolved.roots,
    `${resolved.provenance[id === "runtime" ? "runtime" : id === "node" ? "node" : ["python", "pyboy", "pillow"].includes(id) ? "python" : id === "uv" ? "setup" : "toolchain"]}; expected source: ${DEPENDENCY_CATALOG[id].source}`, platform));
  const byId = Object.fromEntries(components.map((item) => [item.id, item]));
  await detectNode(byId.node, context);
  await detectRuntime(byId.runtime, context);
  await detectCli(byId.cli, context);
  await detectGbdk(byId.gbdk, context);
  await pythonMetadata(byId.python, context);
  await distributionMetadata(byId.pyboy, context);
  await distributionMetadata(byId.pillow, context);
  await detectDesktop(byId.desktop, context);
  await detectUv(byId.uv, context);
  if (!SUPPORTED_SETUP_PLATFORMS.includes(`${platform}-${arch}`)) {
    for (const item of components) {
      item.status = "unsupported";
      item.detectionEvidence.push(`Managed setup does not support ${platform}-${arch}.`);
      item.nextSteps = [`Use a supported setup platform: ${SUPPORTED_SETUP_PLATFORMS.join(", ")}.`];
    }
  }
  const tasks = Object.fromEntries(DEPENDENCY_TASKS.map((name) => [name, {
    ready: TASK_COMPONENTS[name].every((id) => byId[id].status === "ready"), requiredComponents: [...TASK_COMPONENTS[name]],
  }]));
  const report = { schemaVersion: 1, mode: "detect", readinessBasis: "compatible-metadata", platform, arch,
    roots: resolved.roots, requestedTasks, components, tasks, ready: requestedTasks.every((name) => tasks[name].ready),
    nextSteps: [...resolved.receiptEvidence, ...new Set(requestedTasks.flatMap((name) => tasks[name].requiredComponents.flatMap((id) => byId[id].nextSteps)))],
  };
  context.components = Object.fromEntries(components.map((item) => [item.id, { ...item }]));
  context.roots = { ...resolved.roots };
  contexts.set(report, context);
  return report;
}

async function probeEnvironment(context) {
  const output = {};
  const aliases = new Map();
  for (const [key, value] of Object.entries(context.environment)) {
    if (value === undefined) continue;
    const normalized = key.toUpperCase();
    if (context.platform === "win32") {
      if (aliases.has(normalized) && aliases.get(normalized) !== value) throw new TypeError(`Conflicting case-insensitive Windows environment values exist for ${key}.`);
      aliases.set(normalized, value);
    }
    if (UNSAFE_ENV.has(normalized) || normalized.startsWith("UV_") || normalized.startsWith("DYLD_") || normalized === "COMSPEC") continue;
    output[key] = value;
  }
  if (context.platform === "win32") {
    const systemRoot = environmentValue(context.environment, "SystemRoot", "win32");
    if (!systemRoot) throw new TypeError("Windows probes require a trusted absolute SystemRoot.");
    const requested = absolute(systemRoot, "Windows SystemRoot");
    const canonical = await realpath(requested);
    if (canonical !== requested || (await lstat(requested)).isSymbolicLink()) throw new TypeError("Windows SystemRoot must not resolve through a redirected path.");
    const command = path.join(canonical, "System32", "cmd.exe");
    if (await regular(command, canonical) !== command || (await lstat(command)).isSymbolicLink()) throw new TypeError("Windows SystemRoot requires a real System32/cmd.exe.");
    for (const key of Object.keys(output)) if (key.toUpperCase() === "SYSTEMROOT") delete output[key];
    output.SystemRoot = canonical;
    output.COMSPEC = command;
  }
  return output;
}

function aborted(signal) {
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new DOMException("Dependency probe was cancelled.", "AbortError");
}

async function executeProbe(command, args, options) {
  const capture = (value) => ({
    executed: Number.isSafeInteger(value.pid),
    exitObserved: value.exitObserved === true,
    cleanupErrors: (value.cleanupErrors ?? []).map((message) => String(message).slice(0, 512)).slice(0, 8),
    output: (String(value.stdout ?? "") + "\n" + String(value.stderr ?? "")).trim().slice(-4096),
  });
  try {
    // Only the import-safe command/hash helpers are shared with setup. In
    // particular, setupEnvironment (which prepares storage) is never called.
    const result = await runSetupCommand(command, args, { ...options, label: "Dependency probe",
      timeoutMs: 10_000, maxOutputBytes: MAX_PROBE_BYTES,
      platform: os.type() === "Windows_NT" ? "win32" : os.type() === "Darwin" ? "darwin" : "linux",
    });
    return { status: result.outputTruncated ? "fail" : "pass", ...capture(result),
      ...(result.outputTruncated ? { error: "Probe output exceeded its bounded capture." } : {}) };
  } catch (error) {
    const details = error.details ?? {};
    const captured = capture(details);
    if (options.signal?.aborted) {
      const reason = options.signal.reason instanceof Error ? options.signal.reason : new DOMException("Dependency probe was cancelled.", "AbortError");
      const cleanup = captured.cleanupErrors.length ? " Owned subprocess cleanup could not be fully confirmed." : "";
      throw Object.assign(new Error(reason.message + cleanup, { cause: error }), {
        name: reason.name, code: "ABORT_ERR", exitObserved: captured.exitObserved, cleanupErrors: captured.cleanupErrors,
      });
    }
    return { status: "fail", ...captured,
      error: String(details.exitCode ?? details.signal ?? error.code ?? error.message).slice(0, 512) };
  }
}

/** Execute only named, bounded health checks for a report produced in this process. */
export async function probeDependencies(report, { probes, signal } = {}) {
  const context = contexts.get(report);
  if (!context) throw new TypeError("Probe a fresh report returned by detectDependencies; serialized reports are inspection-only.");
  if (!Array.isArray(probes) || probes.length === 0 || probes.length > DEPENDENCY_PROBES.length || probes.some((name) => !DEPENDENCY_PROBES.includes(name)) || new Set(probes).size !== probes.length) {
    throw new TypeError("Select one or more distinct named dependency probes.");
  }
  aborted(signal);
  let environment;
  let environmentError;
  try { environment = await probeEnvironment(context); } catch (error) { aborted(signal); environmentError = error; }
  const results = [];
  const components = report.components.map((item) => ({ ...item }));
  const specs = {
    "cli-version": { ids: ["cli"], required: ["node", "cli"], command: context.nodeExecutable, args: [context.components.cli.path, "--version"] },
    "gbdk-version": { ids: ["gbdk"], required: ["gbdk"], command: context.components.gbdk.path, args: ["-v"],
      cwd: path.dirname(path.dirname(context.components.gbdk.path)) },
    "emulator-import": { ids: ["python", "pyboy", "pillow"], required: ["python", "pyboy", "pillow"], command: context.pythonPath,
      args: ["-I", "-B", "-c", "import pyboy, PIL; from importlib.metadata import version; print('PyBoy ' + version('pyboy') + ', Pillow ' + version('pillow'))"] },
  };
  for (const name of probes) {
    aborted(signal);
    const spec = specs[name];
    const unavailable = spec.required.filter((id) => context.components[id].status !== "ready");
    let result;
    if (unavailable.length) {
      result = { status: "fail", error: `Compatible metadata is required before execution: ${unavailable.join(", ")}.`, output: "", executed: false };
    } else if (environmentError) {
      result = { status: "fail", error: String(environmentError.message ?? environmentError).slice(0, 512), output: "", executed: false };
    } else {
      try {
        if (await realpath(context.roots.toolchainRoot) !== context.roots.toolchainRoot) throw new Error("The selected toolchain directory was redirected after detection.");
        await regular(spec.command, name === "gbdk-version" ? context.roots.toolchainRoot : undefined, true, context.platform);
        if (name === "cli-version") await regular(context.components.cli.path, context.roots.toolchainRoot);
        const env = { ...environment };
        const certificateAuthority = environmentValue(context.environment, "NODE_EXTRA_CA_CERTS", context.platform);
        if (name !== "emulator-import" && certificateAuthority !== undefined) env.NODE_EXTRA_CA_CERTS = certificateAuthority;
        // GBDK 4.5's version probe expands argv[0] into a small native prefix
        // buffer. A fixed relative GBDKDIR avoids path-length-dependent crashes;
        // this does not change the standalone C build invocation.
        if (name === "gbdk-version") {
          for (const key of Object.keys(env)) if (key.toUpperCase() === "GBDKDIR") delete env[key];
          env.GBDKDIR = "./";
        }
        const cwd = spec.cwd ?? context.roots.toolchainRoot;
        if (!within(context.roots.toolchainRoot, await realpath(cwd))) throw new Error("The probe working directory resolves outside its selected toolchain root.");
        result = await executeProbe(spec.command, spec.args, { cwd, env, signal });
      } catch (error) {
        if (signal?.aborted && (error.name === "AbortError" || error.code === "ABORT_ERR")) throw error;
        aborted(signal);
        result = { status: "fail", error: String(error.message ?? error).slice(0, 512), output: "", executed: false };
      }
      if (result.status === "pass" && name === "cli-version" && !result.output.split(/\s+/u).some((token) => version(token) === DEPENDENCY_CATALOG.cli.requiredVersion)) {
        result.status = "fail"; result.error = "CLI --version did not report the required version.";
      }
      if (result.status === "pass" && name === "emulator-import" && !/PyBoy 2\.7\.0, Pillow (?:11|12)\.\d+\.\d+/u.test(result.output)) {
        result.status = "fail"; result.error = "Emulator imports did not report compatible package versions.";
      }
    }
    results.push({ name, components: spec.ids, ...result });
    for (const item of components) if (spec.ids.includes(item.id)) {
      item.probeStatus = result.status;
      if (result.status === "fail") item.nextSteps = [...new Set([...item.nextSteps, nextStep(item.id, context.roots, context.platform)])];
    }
  }
  const probed = { ...report, mode: "probe", components, probeResults: results, probesPassed: results.every((result) => result.status === "pass"),
    nextSteps: [...new Set([...report.nextSteps, ...components.filter((item) => item.probeStatus === "fail").flatMap((item) => item.nextSteps)])] };
  contexts.set(probed, context);
  return probed;
}
