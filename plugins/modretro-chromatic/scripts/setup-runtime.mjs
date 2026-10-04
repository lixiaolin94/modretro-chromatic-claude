/**
 * Prepare a compiled package in caller-owned staging, without executing its scripts.
 *
 * The caller holds the setup-root lock and owns promotion, quarantine and cleanup.
 * This module never reuses or removes an existing destination. Failure preserves
 * the new runtime and npm operation directory and reports the last known phase.
 *
 * The shipped runtime lock is the production-only projection (omit dev:true
 * entries and root devDependencies) of the public partner package-lock.json at
 * OpenAI-Partners/ext-openai-modretro@0a263ffb121cebc569c85e3012534d13a5268987.
 * Preserve its exact dependency versions/integrities; do not copy the private
 * checkout's registry URLs into this portable installer. Release root versions
 * are rebased in the owned destination, never by editing the installed payload.
 */

import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, lstat, mkdir, open, readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { ensureOwnedDirectory, runSetupCommand, setupEnvironment } from "./setup-io.mjs";
import {
  CHROMATIC_PACKED, CHROMATIC_STORAGE_SOURCES, CHROMATIC_VERSION, chromaticRequiredPaths, chromaticTargetFromManifest, chromaticFormatFromManifest,
  requireChromaticHostTarget, verifyChromaticBundle, verifyChromaticRecords,
} from "./chromatic-runtime.mjs";

const PACKAGE_NAME = "modretro-chromatic";
const MAX_FILES = 4096;
// Match the universal package limits in prepare-plugin-payload.mjs and start-mcp.mjs.
const MAX_BYTES = 136 * 1024 * 1024;
const MAX_FILE_BYTES = 24 * 1024 * 1024;
const AUTOMATIC_PACKAGE_FILES = new Set(["LICENSE", "README.md", "THIRD_PARTY_NOTICES.md"]);
const LOCAL_ONLY_FILES = new Set(["package.json", "package-lock.json", ".codex-plugin/local-payload.json", ".gitignore", ".npmignore"]);
const PRIVATE_DIRECTORIES = new Set([".git", ".agents", ".codex", ".local", "node_modules", "vendor", "artifacts", ".cache", "__pycache__", "coverage", "save-states", "src", "tests", "test"]);
const WRECKLIGHT_MANIFEST = "examples/wrecklight/MANIFEST.json";
const WRECKLIGHT_MANIFEST_PIN = Object.freeze({ bytes: 228142, sha256: "239d182ec218f5bc4145f58dc3c4ed3ec5ad3fc1425356c63c79269b659f9cdc" });

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");
const key = (value) => process.platform === "win32" ? value.toLowerCase() : value;
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const stableObject = (value) => JSON.stringify(Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b))));

async function writeRuntimeFile(filename, bytes, mode) {
  const handle = await open(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    await handle.writeFile(bytes);
    // setup.sh intentionally uses umask 077. Publish the pinned mode only
    // after writing, through the same exclusively created file descriptor.
    await handle.chmod(mode);
  } finally { await handle.close(); }
}

function within(root, candidate) {
  const relative = path.relative(key(root), key(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative));
}

function absolute(value, label) {
  if (typeof value !== "string" || !path.isAbsolute(value) || /[\u0000-\u001f]/u.test(value)) {
    throw new Error(label + " must be an explicit absolute path.");
  }
  return path.resolve(value);
}

async function metadata(filename) {
  try { return await lstat(filename); }
  catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
    throw error;
  }
}

/** Reject links/junctions in owned write paths and copied package members. */
async function unlinked(filename, { allowMissing = false } = {}) {
  const selected = path.resolve(filename);
  const root = path.parse(selected).root;
  let current = root;
  for (const component of selected.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const entry = await metadata(current);
    if (!entry) {
      if (allowMissing) continue;
      throw new Error("Required path is missing: " + current);
    }
    if (entry.isSymbolicLink() || key(await realpath(current)) !== key(current)) {
      throw new Error("Runtime preparation cannot traverse a symbolic link or junction: " + current);
    }
  }
  return selected;
}

async function directory(filename, label) {
  const selected = await realpath(absolute(filename, label));
  if (!(await stat(selected)).isDirectory()) throw new Error(label + " must be a directory.");
  return selected;
}

function relativeFile(filename) {
  if (typeof filename !== "string" || filename.length === 0 || filename.length > 1024 || /[\\:<>"|?*\u0000-\u001f]/u.test(filename)) {
    throw new Error("Invalid runtime package member: " + filename);
  }
  const components = filename.split("/");
  if (components.length > 32 || components.some((part) => !part || part === "." || part === ".." || /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) {
    throw new Error("Invalid runtime package member: " + filename);
  }
  return filename;
}

function runtimeMember(filename) {
  // Maintainer compression input is not a second runtime representation.
  return !LOCAL_ONLY_FILES.has(filename) && !CHROMATIC_STORAGE_SOURCES.includes(filename);
}

function assertPublicMember(filename, enginePaths = new Set()) {
  relativeFile(filename);
  const lower = filename.toLowerCase();
  const parts = lower.split("/");
  const basename = parts.at(-1);
  if (parts.some((part) => PRIVATE_DIRECTORIES.has(part) && !(part === "src" && enginePaths.has(filename))) || basename === ".npmrc" || basename === ".ds_store" ||
    basename === ".env" || basename.startsWith(".env.") || /\.(?:sav|ram|rtc|state|pyc|pyo)$/u.test(basename) ||
    /\.test\.[cm]?[jt]sx?$/u.test(basename) || /\.(?:playtest|gbstate)\.json$/u.test(basename) ||
    /^dist\/playtest\.(?:js|js\.map|d\.ts)$/u.test(lower) || /^scripts\/dogfood-/u.test(lower) ||
    lower === "scripts/integration-smoke.mjs" || lower === "scripts/test-isolated.mjs") {
    throw new Error("Refusing private or test-only runtime package member: " + filename);
  }
}

// Pin native game inputs independently of the preparation receipt. Only the
// exact delivered manifest can authorize engine/src files and ancestors.
async function bundledEngineSourcePolicy(root) {
  const paths = new Set();
  const members = new Map();
  const pins = new Map();
  if (!await metadata(path.join(root, WRECKLIGHT_MANIFEST))) return { paths, members, pins };
  const manifest = await regularBytes(root, WRECKLIGHT_MANIFEST);
  assertBundledSourceBytes(WRECKLIGHT_MANIFEST, manifest, WRECKLIGHT_MANIFEST_PIN);
  const parsed = JSON.parse(manifest.bytes.toString("utf8"));
  for (const member of parsed.files) {
    const engineSource = /^plugins\/[^/]+\/engine\/src\//u.test(member.path);
    if (!engineSource && !/^plugins\/[^/]+\/(?:engine\/include|events)\//u.test(member.path)) continue;
    const filename = "examples/wrecklight/" + member.path;
    relativeFile(filename);
    pins.set(filename, member);
    if (!engineSource) continue;
    members.set(filename, member);
    const components = filename.split("/");
    for (let index = 1; index <= components.length; index++) paths.add(components.slice(0, index).join("/"));
  }
  return { paths, members, pins };
}

function assertBundledSourceBytes(filename, actual, expected) {
  if (expected && (actual.bytes.length !== expected.bytes || digest(actual.bytes) !== expected.sha256 || actual.mode !== 0o644)) {
    throw new Error("Bundled Wrecklight engine source or manifest differs from its pin: " + filename);
  }
}

function requireBundledManifest(files, policy) {
  const paths = new Set(files.map((file) => file.path));
  if ([...paths].some((filename) => policy.pins.has(filename)) && !paths.has(WRECKLIGHT_MANIFEST)) {
    throw new Error("Bundled Wrecklight engine source requires its pinned manifest in the distribution.");
  }
}

async function regularBytes(root, relative, limit = MAX_FILE_BYTES) {
  relativeFile(relative);
  const filename = path.join(root, ...relative.split("/"));
  if (!within(root, filename)) throw new Error("Package member escapes its root: " + relative);
  await unlinked(filename);
  const before = await lstat(filename);
  if (!before.isFile() || before.size > limit) throw new Error("Package member is not a bounded regular file: " + relative);
  const handle = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new Error("Package member changed while opening: " + relative);
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    if (bytes.length !== before.size || after.size !== before.size || after.mtimeMs !== opened.mtimeMs) {
      throw new Error("Package member changed while reading: " + relative);
    }
    await unlinked(filename);
    return { bytes, mode: before.mode & 0o111 ? 0o755 : 0o644 };
  } finally { await handle.close(); }
}

async function objectFile(root, relative) {
  const result = JSON.parse((await regularBytes(root, relative, 1024 * 1024)).bytes.toString("utf8"));
  if (!isObject(result)) throw new Error(relative + " must contain a JSON object.");
  return result;
}

/** Resolve only the npm installed beside the explicitly selected Node binary. */
export async function resolveRuntimeNpm({ nodeExecutable }) {
  const selectedNode = await realpath(absolute(nodeExecutable, "Node executable"));
  if (!(await lstat(selectedNode)).isFile()) throw new Error("Node executable must be a regular file.");
  await access(selectedNode, constants.X_OK);
  const nodeDirectory = path.dirname(selectedNode);
  const candidates = [
    path.join(nodeDirectory, "node_modules", "npm"),
    path.resolve(nodeDirectory, "..", "lib", "node_modules", "npm"),
  ];
  for (const npmRoot of candidates) {
    if (!await metadata(npmRoot)) continue;
    await unlinked(npmRoot);
    const manifest = await objectFile(npmRoot, "package.json");
    if (manifest.name !== "npm" || typeof manifest.version !== "string") throw new Error("The selected Node installation has an invalid npm manifest.");
    if (!/^\d+\.\d+\.\d+(?:[-+].*)?$/u.test(manifest.version) || Number(manifest.version.split(".")[0]) < 9) {
      throw new Error("The selected Node installation needs npm 9 or newer for the reviewed lockfile format.");
    }
    await regularBytes(npmRoot, "bin/npm-cli.js", 1024 * 1024);
    return { nodeExecutable: selectedNode, npmCli: path.join(npmRoot, "bin", "npm-cli.js"), npmVersion: manifest.version };
  }
  throw new Error("The selected Node installation has no sibling npm-cli.js; choose a Node distribution containing npm.");
}

/** The product allowlist uses literal positive paths and ordinary exclusion globs. */
function exclusion(pattern) {
  let result = "";
  for (let index = 0; index < pattern.length; index++) {
    const character = pattern[index];
    if (character === "*" && pattern[index + 1] === "*") {
      index++;
      if (pattern[index + 1] === "/") { index++; result += "(?:.*/)?"; }
      else result += ".*";
    } else if (character === "*") result += "[^/]*";
    else if (character === "?") result += "[^/]";
    else if (character === "[") {
      const end = pattern.indexOf("]", index + 1);
      if (end < 0 || !/^[A-Za-z0-9-]+$/u.test(pattern.slice(index + 1, end))) throw new Error("Unsupported package exclusion: " + pattern);
      result += pattern.slice(index, end + 1); index = end;
    } else result += /[\\^$+.()|{}]/u.test(character) ? "\\" + character : character;
  }
  return new RegExp("^" + result + "(?:/.*)?$", "u");
}

async function distributionFiles(packageRoot, packageManifest) {
  const chromaticTarget = chromaticTargetFromManifest(packageManifest);
  const chromaticFormat = chromaticFormatFromManifest(packageManifest);
  requireChromaticHostTarget(chromaticTarget);
  const enginePolicy = await bundledEngineSourcePolicy(packageRoot);
  const records = new Map();
  let visited = 0;
  let totalBytes = 0;
  const seen = new Set();
  async function add(relative, receiptRecord) {
    assertPublicMember(relative, enginePolicy.members);
    if (!runtimeMember(relative)) return;
    const identity = relative.toLowerCase();
    if (seen.has(identity)) throw new Error("Duplicate or case-aliased runtime member: " + relative);
    seen.add(identity);
    const file = await regularBytes(packageRoot, relative);
    assertBundledSourceBytes(relative, file, relative === WRECKLIGHT_MANIFEST ? WRECKLIGHT_MANIFEST_PIN : enginePolicy.pins.get(relative));
    const sha256 = digest(file.bytes);
    if (receiptRecord && (receiptRecord.sha256 !== sha256 || receiptRecord.size !== file.bytes.length || receiptRecord.mode !== file.mode)) {
      throw new Error("Prepared payload member differs from its receipt: " + relative);
    }
    totalBytes += file.bytes.length;
    if (seen.size > MAX_FILES || totalBytes > MAX_BYTES) throw new Error("Compiled runtime package exceeds its copy limits.");
    records.set(relative, { path: relative, ...file, sha256 });
  }

  const receiptPresent = await metadata(path.join(packageRoot, ".codex-plugin", "local-payload.json"));
  if (!receiptPresent && Array.isArray(packageManifest.files) && packageManifest.files.length > 0) {
    if (!packageManifest.files.every((entry) => typeof entry === "string")) throw new Error("The package files allowlist must contain strings.");
    const excluded = packageManifest.files.filter((entry) => entry.startsWith("!")).map((entry) => exclusion(entry.slice(1)));
    const selected = packageManifest.files.filter((entry) => !entry.startsWith("!")).map((entry) => entry.replace(/\/$/u, ""));
    async function visit(relative) {
      if (excluded.some((pattern) => pattern.test(relative))) return;
      relativeFile(relative);
      if (!runtimeMember(relative)) return;
      if (++visited > MAX_FILES * 2) throw new Error("Compiled runtime package contains too many entries.");
      const filename = path.join(packageRoot, ...relative.split("/"));
      const entry = await metadata(filename);
      if (!entry) return;
      await unlinked(filename);
      if (entry.isDirectory()) {
        assertPublicMember(relative, enginePolicy.paths);
        for (const child of (await readdir(filename)).sort()) await visit(relative + "/" + child);
      } else if (!records.has(relative)) await add(relative);
    }
    for (const relative of selected) await visit(relative);
    for (const filename of AUTOMATIC_PACKAGE_FILES) {
      if (await metadata(path.join(packageRoot, filename)) && !records.has(filename)) await add(filename);
    }
  } else {
    // Prepared Codex payloads intentionally have files:[] and scripts:{}.
    const receipt = await objectFile(packageRoot, ".codex-plugin/local-payload.json");
    if (receipt.schemaVersion !== 1 || receipt.pluginName !== PACKAGE_NAME || !Array.isArray(receipt.files) || receipt.files.length > MAX_FILES) {
      throw new Error("A package without a files allowlist requires its prepared local-payload receipt.");
    }
    const identities = new Set();
    let packageVerified = false;
    for (const entry of receipt.files) {
      if (!isObject(entry)) throw new Error("Invalid local-payload file receipt.");
      relativeFile(entry.path);
      if (identities.has(entry.path.toLowerCase())) throw new Error("Duplicate local-payload file receipt.");
      identities.add(entry.path.toLowerCase());
      if (entry.path === "package.json") {
        const actual = await regularBytes(packageRoot, "package.json", 1024 * 1024);
        if (entry.sha256 !== digest(actual.bytes) || entry.size !== actual.bytes.length || entry.mode !== actual.mode) throw new Error("Prepared payload package manifest differs from its receipt.");
        packageVerified = true;
      }
      if (runtimeMember(entry.path)) await add(entry.path, entry);
    }
    if (!packageVerified) throw new Error("Prepared local-payload receipt does not identify its package manifest.");
  }
  for (const required of [".codex-plugin/plugin.json", ".mcp.json", "dist/server.js", "scripts/start-mcp.mjs", "scripts/chromatic-runtime.mjs", "scripts/setup-io.mjs", "scripts/emulator_worker.py", "scripts/runtime-package.json", "scripts/runtime-package-lock.json"]) {
    if (!records.has(required)) throw new Error("Compiled distribution is missing a required runtime member: " + required);
  }
  if (packageManifest.bundledChromatic !== undefined) {
    if (packageManifest.bundledChromatic !== CHROMATIC_VERSION) throw new Error("Unsupported bundled Chromatic release.");
    for (const required of chromaticRequiredPaths(chromaticTarget, chromaticFormat)) {
      if (!records.has(required)) throw new Error("Compiled distribution is missing bundled Chromatic member: " + required);
    }
    verifyChromaticBundle(packageRoot, { target: chromaticTarget, format: chromaticFormat });
    verifyChromaticRecords([...records.values()], { target: chromaticTarget, format: chromaticFormat });
  }
  requireBundledManifest([...records.values()], enginePolicy);
  return [...records.values()].sort((left, right) => left.path.localeCompare(right.path, "en"));
}

const fileInventory = (files) => files.map(({ path: filename, mode, bytes, sha256 }) => ({ path: filename, mode, size: bytes.length, sha256 }));

async function inspectSource(packageRoot) {
  const root = await directory(packageRoot, "Package root");
  const manifestFile = await regularBytes(root, "package.json", 1024 * 1024);
  const manifest = JSON.parse(manifestFile.bytes.toString("utf8"));
  if (!isObject(manifest)) throw new Error("The source package manifest must be a JSON object.");
  const files = await distributionFiles(root, manifest);
  const inventory = [...fileInventory(files), { path: "package.json", mode: manifestFile.mode, size: manifestFile.bytes.length, sha256: digest(manifestFile.bytes) }]
    .sort((left, right) => left.path.localeCompare(right.path, "en"));
  return { root, manifest, files, sourceSha256: digest(JSON.stringify(inventory)) };
}

/** Passive identity of the complete reviewed input, before portable rewrites. */
export async function inspectRuntimeSource({ packageRoot }) {
  return (await inspectSource(packageRoot)).sourceSha256;
}

/**
 * Passive verification of a promoted runtime against its preparation receipt.
 * node_modules is npm-owned and inspected separately by dependency doctor; every
 * other member must match the copied distribution or the exact manifest/lock.
 */
export async function verifyPreparedRuntime({ runtimeRoot, provenance }) {
  const root = absolute(runtimeRoot, "Prepared runtime root");
  await unlinked(root);
  if (!(await lstat(root)).isDirectory()) throw new Error("Prepared runtime must be a real directory.");
  const modules = await metadata(path.join(root, "node_modules"));
  if (!modules?.isDirectory() || modules.isSymbolicLink()) throw new Error("Prepared runtime must retain its real npm-owned node_modules directory.");
  if (!isObject(provenance) || provenance.status !== "prepared" || !Array.isArray(provenance.files) ||
    provenance.files.length < 1 || provenance.files.length > MAX_FILES ||
    ![provenance.distributionSha256, provenance.manifestSha256, provenance.lockSha256].every((value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value))) {
    throw new Error("Prepared runtime has no bounded complete distribution receipt.");
  }
  const enginePolicy = await bundledEngineSourcePolicy(root);
  const expectedFiles = new Set(["package.json", "package-lock.json"]);
  const expectedDirectories = new Set([""]);
  const identities = new Set();
  let totalBytes = 0;
  for (const entry of provenance.files) {
    if (!isObject(entry)) throw new Error("Invalid prepared runtime file receipt.");
    assertPublicMember(entry.path, enginePolicy.members);
    if (!runtimeMember(entry.path) || identities.has(entry.path.toLowerCase()) ||
      ![0o644, 0o755].includes(entry.mode) || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > MAX_FILE_BYTES ||
      typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/u.test(entry.sha256)) throw new Error("Invalid or duplicate prepared runtime file receipt: " + entry.path);
    totalBytes += entry.size;
    if (totalBytes > MAX_BYTES) throw new Error("Prepared runtime receipt exceeds its total size bound.");
    identities.add(entry.path.toLowerCase()); expectedFiles.add(entry.path);
    const pieces = entry.path.split("/");
    for (let index = 1; index < pieces.length; index++) expectedDirectories.add(pieces.slice(0, index).join("/"));
  }
  if (digest(JSON.stringify(provenance.files)) !== provenance.distributionSha256) throw new Error("Prepared runtime inventory no longer matches its recorded digest.");
  requireBundledManifest(provenance.files, enginePolicy);
  for (const required of [".codex-plugin/plugin.json", ".mcp.json", "dist/server.js", "scripts/start-mcp.mjs", "scripts/chromatic-runtime.mjs", "scripts/setup-io.mjs", "scripts/emulator_worker.py", "scripts/runtime-package.json", "scripts/runtime-package-lock.json"]) {
    if (!expectedFiles.has(required)) throw new Error("Prepared runtime inventory lacks a required member: " + required);
  }
  let visited = 0;
  async function visit(directoryName, prefix = "") {
    for (const entry of await readdir(directoryName, { withFileTypes: true })) {
      if (++visited > MAX_FILES * 2) throw new Error("Prepared runtime has too many directory entries.");
      const relative = prefix ? prefix + "/" + entry.name : entry.name;
      if (entry.isSymbolicLink()) throw new Error("Prepared runtime has a redirected member: " + relative);
      if (relative === "node_modules") {
        if (!entry.isDirectory()) throw new Error("Prepared runtime node_modules must be a real directory.");
        await unlinked(path.join(root, "node_modules"));
        continue;
      }
      if (entry.isDirectory()) {
        if (!expectedDirectories.has(relative)) throw new Error("Prepared runtime has an unlisted directory: " + relative);
        await visit(path.join(directoryName, entry.name), relative);
      } else if (!entry.isFile() || !expectedFiles.has(relative)) throw new Error("Prepared runtime has an unlisted member: " + relative);
    }
  }
  await visit(root);
  for (const entry of provenance.files) {
    const actual = await regularBytes(root, entry.path);
    assertBundledSourceBytes(entry.path, actual, entry.path === WRECKLIGHT_MANIFEST ? WRECKLIGHT_MANIFEST_PIN : enginePolicy.pins.get(entry.path));
    if (actual.bytes.length !== entry.size || actual.mode !== entry.mode || digest(actual.bytes) !== entry.sha256) {
      throw new Error("Prepared runtime distribution member changed: " + entry.path);
    }
  }
  let manifest;
  for (const [filename, hash] of [["package.json", provenance.manifestSha256], ["package-lock.json", provenance.lockSha256]]) {
    const actual = await regularBytes(root, filename, 1024 * 1024);
    if (digest(actual.bytes) !== hash) throw new Error("Prepared runtime manifest/lock changed: " + filename);
    if (filename === "package.json") manifest = JSON.parse(actual.bytes.toString("utf8"));
  }
  const chromaticTarget = chromaticTargetFromManifest(manifest);
  const chromaticFormat = chromaticFormatFromManifest(manifest);
  requireChromaticHostTarget(chromaticTarget);
  if (manifest.bundledChromatic === CHROMATIC_VERSION) verifyChromaticBundle(root, { target: chromaticTarget, format: chromaticFormat });
  return true;
}

function validateManifests(source, manifest, lock) {
  if (source.name !== PACKAGE_NAME || typeof source.version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u.test(source.version)) {
    throw new Error("Runtime preparation requires a versioned modretro-chromatic package.");
  }
  const allowed = new Set(["name", "version", "description", "private", "type", "main", "engines", "license", "dependencies"]);
  if (!isObject(manifest.dependencies) || Object.keys(manifest).some((field) => !allowed.has(field)) ||
    manifest.name !== PACKAGE_NAME || manifest.private !== true || manifest.type !== "module" || manifest.main !== "./dist/server.js" ||
    stableObject(manifest.dependencies) !== stableObject(source.dependencies) || stableObject(manifest.engines) !== stableObject(source.engines)) {
    throw new Error("The shipped runtime manifest does not match this package's reviewed production dependencies.");
  }
  if (lock.lockfileVersion !== 3 || lock.name !== PACKAGE_NAME || !isObject(lock.packages) || !isObject(lock.packages[""]) ||
    stableObject(lock.packages[""].dependencies) !== stableObject(manifest.dependencies) || lock.packages[""].devDependencies !== undefined) {
    throw new Error("The shipped runtime lock does not match its production manifest.");
  }
  for (const [filename, entry] of Object.entries(lock.packages)) {
    if (filename === "") continue;
    relativeFile(filename);
    if (!filename.startsWith("node_modules/") || !isObject(entry) || entry.dev || entry.link || typeof entry.version !== "string") {
      throw new Error("The runtime lock contains a non-production registry package: " + filename);
    }
    const resolved = new URL(entry.resolved);
    if (resolved.origin !== "https://registry.npmjs.org" || resolved.username || resolved.password || resolved.search || resolved.hash ||
      !/^sha(?:256|384|512)-[A-Za-z0-9+/=]+$/u.test(entry.integrity ?? "")) {
      throw new Error("Runtime dependencies require public-registry URLs and integrity hashes: " + filename);
    }
  }
  for (const dependency of Object.keys(manifest.dependencies)) {
    if (!lock.packages["node_modules/" + dependency]) throw new Error("The runtime lock is missing direct dependency " + dependency);
  }
  return {
    manifest: { ...manifest, version: source.version },
    lock: { ...lock, version: source.version, packages: { ...lock.packages, "": { ...lock.packages[""], version: source.version } } },
  };
}

/** Restore a portable source eligible for a NEW payload; never retain old bindings. */
function portablePluginFiles(files, version) {
  const manifestFile = files.find((file) => file.path === ".codex-plugin/plugin.json");
  const manifest = JSON.parse(manifestFile.bytes.toString("utf8"));
  if (!isObject(manifest) || manifest.name !== PACKAGE_NAME || typeof manifest.version !== "string" ||
    manifest.version.split("+")[0] !== version.split("+")[0]) {
    throw new Error("The distributed plugin manifest does not match this package release.");
  }
  manifestFile.bytes = jsonBytes({ ...manifest, version: version.split("+")[0] });
  manifestFile.sha256 = digest(manifestFile.bytes);
  const configuration = files.find((file) => file.path === ".mcp.json");
  const original = JSON.parse(configuration.bytes.toString("utf8"));
  if (!isObject(original?.mcpServers?.["modretro-chromatic"])) throw new Error("The distributed plugin is missing its ModRetro Chromatic MCP launcher.");
  configuration.bytes = jsonBytes({ mcpServers: { "modretro-chromatic": {
    // Allow the 600-second compiler limit plus source validation and cleanup.
    tool_timeout_sec: 900,
    type: "stdio", cwd: ".", command: "node", args: ["./scripts/start-mcp.mjs"], env: { GB_STUDIO_LOG_LEVEL: "info" },
  } } });
  configuration.sha256 = digest(configuration.bytes);
}

function npmEnvironment(parent, shared) {
  const result = { ...shared };
  const networkNpm = new Set(["NPM_CONFIG_CA", "NPM_CONFIG_CAFILE", "NPM_CONFIG_PROXY", "NPM_CONFIG_HTTPS_PROXY", "NPM_CONFIG_NOPROXY"]);
  const seen = new Map();
  for (const [name, value] of Object.entries(parent ?? {})) {
    if (value === undefined) continue;
    const normalized = name.toUpperCase();
    if (!networkNpm.has(normalized)) continue;
    if (seen.has(normalized) && seen.get(normalized) !== value) throw new Error("Conflicting environment aliases for " + name);
    seen.set(normalized, value);
    result[normalized.toLowerCase()] = value;
  }
  return {
    ...result, npm_config_registry: "https://registry.npmjs.org", npm_config_strict_ssl: "true", npm_config_global: "false",
    npm_config_ignore_scripts: "true", npm_config_audit: "false", npm_config_fund: "false", npm_config_update_notifier: "false",
  };
}

export class RuntimePreparationError extends Error {
  constructor(message, { cause, phase, runtimeRoot, operationRoot, cancelled, execution }) {
    super(message, { cause });
    this.name = "RuntimePreparationError";
    this.code = cancelled ? "RUNTIME_PREPARATION_CANCELLED" : "RUNTIME_PREPARATION_FAILED";
    this.phase = phase; this.runtimeRoot = runtimeRoot; this.operationRoot = operationRoot;
    // Preserve process-exit/cleanup evidence at this boundary as well as in the
    // original cause. The setup coordinator must retain its lock if exit was
    // not observed, even though this wrapper adds a runtime-specific phase.
    this.details = { ...(execution ?? {}), ...(cause?.details ?? {}), phase, runtimeRoot, operationRoot };
  }
}

/**
 * Explicit apply only. setupRoot already exists and is owned/locked by caller.
 * runtimeRoot is a fresh nonexistent child, commonly inside caller staging.
 * runCommand is an injectable executor for unit tests; no npm runs on import.
 */
export async function prepareRuntime({ packageRoot, runtimeRoot, setupRoot, nodeExecutable, environment = process.env, signal, onProgress, runCommand = runSetupCommand }) {
  let phase = "preflight"; let operationRoot; let destination; let execution;
  const cancelled = () => { if (signal?.aborted) throw new Error("Runtime preparation was cancelled."); };
  const progress = (next, message) => { phase = next; onProgress?.({ phase, message }); cancelled(); };
  try {
    cancelled();
    const source = await directory(packageRoot, "Package root");
    const owned = await directory(setupRoot, "Owned setup root");
    destination = absolute(runtimeRoot, "Runtime destination");
    await unlinked(owned); await unlinked(destination, { allowMissing: true });
    if (!within(owned, destination) || key(owned) === key(destination) || within(source, destination) || within(destination, source) || within(source, owned)) {
      throw new Error("Runtime staging must be a child of an owned setup root separate from the source package.");
    }
    if (await metadata(destination)) throw new Error("Runtime destination already exists; caller must select a fresh staging child.");
    if (!(await stat(path.dirname(destination))).isDirectory()) throw new Error("Runtime destination parent must already exist in caller-owned staging.");
    const npm = await resolveRuntimeNpm({ nodeExecutable });
    if (within(source, npm.nodeExecutable) || within(destination, npm.nodeExecutable) || within(source, npm.npmCli) || within(destination, npm.npmCli)) {
      throw new Error("Selected Node and npm must be outside the source package and runtime destination.");
    }
    const inspected = await inspectSource(source);
    const sourceManifest = inspected.manifest;
    const files = inspected.files;
    const reviewedManifest = JSON.parse(files.find((file) => file.path === "scripts/runtime-package.json").bytes.toString("utf8"));
    const reviewedLock = JSON.parse(files.find((file) => file.path === "scripts/runtime-package-lock.json").bytes.toString("utf8"));
    if (!isObject(reviewedManifest) || !isObject(reviewedLock)) throw new Error("Runtime dependency manifests must contain JSON objects.");
    const prepared = validateManifests(sourceManifest, reviewedManifest, reviewedLock);
    const sourceSha256 = inspected.sourceSha256;
    portablePluginFiles(files, prepared.manifest.version);
    // Literal inventory entries work for both built checkouts and files:[]
    // cached payloads, without shipping source/dev files or stale cache markers.
    prepared.manifest.files = files.map((file) => file.path);
    prepared.manifest.scripts = {};
    if (sourceManifest.bundledChromatic === CHROMATIC_VERSION) {
      prepared.manifest.bundledChromatic = sourceManifest.bundledChromatic;
      const chromaticTarget = chromaticTargetFromManifest(sourceManifest);
      if (chromaticTarget !== undefined) prepared.manifest.bundledChromaticTarget = chromaticTarget;
      const chromaticFormat = chromaticFormatFromManifest(sourceManifest);
      if (chromaticFormat !== undefined) prepared.manifest.bundledChromaticFormat = chromaticFormat;
      prepared.manifest.license = "SEE LICENSE IN THIRD_PARTY_NOTICES.md";
      prepared.lock.packages[""].license = prepared.manifest.license;
    }
    const manifestBytes = jsonBytes(prepared.manifest); const lockBytes = jsonBytes(prepared.lock);
    const copiedFiles = fileInventory(files);
    cancelled();
    // The caller holds this setup root's lock. Only npm's integrity-checked
    // archive cache is shared; temporary files, config and logs stay per attempt.
    const npmCachePath = path.join(owned, "cache", "npm");
    if (within(destination, npmCachePath) || within(npmCachePath, destination)) {
      throw new Error("Runtime staging must remain separate from the shared npm cache.");
    }
    if (within(source, npmCachePath) || within(npmCachePath, source)) {
      throw new Error("The source package must remain separate from the shared npm cache.");
    }
    const npmCache = await ensureOwnedDirectory(owned, npmCachePath);
    progress("copy", "Copying reviewed compiled runtime into fresh owned staging.");
    await mkdir(destination, { mode: 0o700 });
    for (const file of files) {
      cancelled();
      const filename = path.join(destination, ...file.path.split("/"));
      await unlinked(path.dirname(filename), { allowMissing: true });
      await mkdir(path.dirname(filename), { recursive: true, mode: 0o700 });
      await unlinked(path.dirname(filename));
      await writeRuntimeFile(filename, file.bytes, file.mode);
    }
    await writeRuntimeFile(path.join(destination, "package.json"), manifestBytes, 0o644);
    await writeRuntimeFile(path.join(destination, "package-lock.json"), lockBytes, 0o644);
    operationRoot = path.join(owned, ".runtime-prepare-" + randomUUID());
    await mkdir(operationRoot, { mode: 0o700 });
    const sharedEnvironment = await setupEnvironment({ setupRoot: operationRoot, nodeExecutable: npm.nodeExecutable, environment, platform: process.platform });
    const npmLogs = await ensureOwnedDirectory(operationRoot, path.join(operationRoot, "logs", "npm"));
    const env = npmEnvironment(environment, { ...sharedEnvironment, npm_config_cache: npmCache, npm_config_logs_dir: npmLogs });
    progress("npm", "Installing locked production dependencies with scripts disabled and owned npm storage.");
    const result = await runCommand(npm.nodeExecutable, [npm.npmCli, "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--workspaces=false", "--global=false", "--prefix", destination], {
      cwd: destination, env, signal, onProgress, label: "Runtime npm dependencies", timeoutMs: 10 * 60_000,
    });
    execution = result;
    cancelled();
    if (result?.cancelled) throw new Error("Runtime dependency installation was cancelled after its npm process closed.");
    if (result?.timedOut) throw new Error("Runtime dependency installation exceeded its bounded npm timeout.");
    if (result?.exitObserved === false || result?.cleanupErrors?.length) throw new Error("Runtime npm process cleanup was not confirmed; preserve the setup lock and partial state.");
    const exitCode = result?.exitCode ?? result?.status;
    if (exitCode !== 0) throw new Error("Locked production npm installation failed (status " + exitCode + "): " + String(result?.stderr ?? "").slice(-4096));
    progress("verify", "Checking installed production package versions without importing them.");
    await unlinked(destination);
    for (const dependency of Object.keys(prepared.manifest.dependencies)) {
      const metadataPath = "node_modules/" + dependency + "/package.json";
      const installed = await objectFile(destination, metadataPath);
      if (installed.name !== dependency || installed.version !== prepared.lock.packages["node_modules/" + dependency].version) {
        throw new Error("Prepared runtime dependency metadata does not match its lock: " + dependency);
      }
    }
    for (const file of files) {
      cancelled();
      if (digest((await regularBytes(destination, file.path)).bytes) !== file.sha256) {
        throw new Error("A copied distribution member changed during dependency installation: " + file.path);
      }
    }
    if (digest(await readFile(path.join(destination, "package.json"))) !== digest(manifestBytes) ||
      digest(await readFile(path.join(destination, "package-lock.json"))) !== digest(lockBytes)) {
      throw new Error("The prepared runtime manifest or lock changed during dependency installation.");
    }
    cancelled();
    return { status: "prepared", runtimeRoot: destination, operationRoot, ...npm, packageVersion: prepared.manifest.version,
      manifestSha256: digest(manifestBytes), lockSha256: digest(lockBytes), sourceSha256,
      distributionSha256: digest(JSON.stringify(copiedFiles)), files: copiedFiles, filesCopied: files.length };
  } catch (cause) {
    throw new RuntimePreparationError("Runtime preparation failed during " + phase + "; any owned partial staging is preserved. " + cause.message, {
      cause, phase, runtimeRoot: destination ?? runtimeRoot, operationRoot, cancelled: signal?.aborted === true || cause?.code === "ABORT_ERR",
      execution,
    });
  }
}
