#!/usr/bin/env node

/** Stage only the npm distribution, never a checkout's toolchain or dependencies. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync, closeSync, constants, existsSync, fchmodSync, fstatSync, linkSync, lstatSync, mkdirSync, mkdtempSync,
  openSync, readFileSync, readdirSync, realpathSync, renameSync, rmdirSync, rmSync, statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";
import { bundleMcp } from "./bundle-mcp.mjs";
import { setupCrc32 } from "./setup-io.mjs";
import {
  CHROMATIC_MEMBERS, CHROMATIC_PACKED, CHROMATIC_PACKED_V2, CHROMATIC_NOTICE_PACK, CHROMATIC_ARTWORK_PACK, CHROMATIC_ARTWORK_MEMBERS, CHROMATIC_STORAGE_SOURCES, CHROMATIC_ROOT, CHROMATIC_TARGETS, CHROMATIC_VERSION, chromaticRequiredPaths, chromaticTargetFromManifest, chromaticFormatFromManifest,
  requireChromaticHostTarget, verifyChromaticBundle, verifyChromaticRecords,
} from "./chromatic-runtime.mjs";

const PLUGIN_NAME = "modretro-chromatic";
const SCRIPT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT_PATH = ".codex-plugin/local-payload.json";
const DISTRIBUTION_MANIFEST = "distribution.json";
const MAX_FILES = 4096;
// Include the universal native bundle, declarations, sample and device artwork.
// Keep copy limits aligned with setup-runtime.mjs and start-mcp.mjs.
const MAX_FILE_BYTES = 24 * 1024 * 1024;
const MAX_TOTAL_BYTES = 136 * 1024 * 1024;
const FORBIDDEN_DIRECTORIES = new Set([
  ".git", ".agents", ".codex", ".local", "node_modules", "vendor", "artifacts",
  ".cache", "__pycache__", "coverage", "save-states",
]);

function canonicalKey(candidate) {
  const resolved = path.resolve(candidate);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isWithin(root, candidate) {
  const relative = path.relative(canonicalKey(root), canonicalKey(candidate));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function inspect(candidate) {
  try { return lstatSync(candidate); }
  catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return undefined;
    throw error;
  }
}

function readObject(candidate, label) {
  const contents = readFileSync(candidate, "utf8");
  let value;
  try { value = JSON.parse(contents); }
  catch (cause) { throw new Error(`${label} could not be read as JSON: ${candidate}`, { cause }); }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object: ${candidate}`);
  }
  return value;
}

function realDirectory(candidate, label) {
  const result = realpathSync(path.resolve(candidate));
  if (!statSync(result).isDirectory()) throw new Error(`${label} must be a directory: ${candidate}`);
  return result;
}

function assertUnlinkedPath(candidate, label) {
  const absolute = path.resolve(candidate);
  const parsed = path.parse(absolute);
  let current = parsed.root;
  for (const component of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const metadata = inspect(current);
    if (metadata === undefined) continue;
    if (metadata.isSymbolicLink() || canonicalKey(realpathSync(current)) !== canonicalKey(current)) {
      throw new Error(`${label} must not traverse a symbolic link or directory junction: ${current}`);
    }
  }
  return absolute;
}

export function isForbiddenPayloadPath(filename) {
  if (typeof filename !== "string" || !filename || filename.length > 1024 || /[\\:<>"|?*\u0000-\u001f]/u.test(filename)) return true;
  const pieces = filename.split("/");
  if (pieces.length > 32 || pieces.some((part) => !part || part === "." || part === ".." || /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) return true;
  if (path.posix.isAbsolute(filename) || path.win32.isAbsolute(filename)) return true;
  const lower = pieces.map((part) => part.toLowerCase());
  if (lower.some((part) => FORBIDDEN_DIRECTORIES.has(part))) return true;
  if (["src", "test", "tests"].includes(lower[0])) return true;
  const basename = lower.at(-1);
  return basename === ".npmrc" || basename === ".ds_store" || basename === ".env" ||
    basename.startsWith(".env.") || /\.(?:sav|ram|rtc|state|pyc|pyo)$/u.test(basename) ||
    /\.test\.[cm]?[jt]sx?$/u.test(basename) || /\.(?:playtest|gbstate)\.json$/u.test(basename) ||
    /^dist\/(?:device-capture(?:-jobs)?|device-capture\/(?:client|media|protocol))\.(?:js|js\.map|d\.ts)$/u.test(filename) ||
    /^dist\/playtest\.(?:js|js\.map|d\.ts)$/u.test(filename) ||
    /^scripts\/dogfood-[^/]+\.mjs$/u.test(filename) || filename === "scripts/integration-smoke.mjs" || filename === RECEIPT_PATH;
}

function regularFileBytes(root, relative, limit = MAX_FILE_BYTES) {
  const filename = path.join(root, ...relative.split("/"));
  if (!isWithin(root, filename)) throw new Error(`Distribution member escapes its package: ${relative}`);
  assertUnlinkedPath(filename, "Distribution member");
  const before = lstatSync(filename);
  if (!before.isFile() || before.isSymbolicLink()) throw new Error(`Distribution member is not a regular file: ${relative}`);
  if (before.size > limit) throw new Error(`Distribution member exceeds ${limit} bytes: ${relative}`);
  const descriptor = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) {
      throw new Error(`Distribution member changed while opening it: ${relative}`);
    }
    const contents = readFileSync(descriptor);
    const after = fstatSync(descriptor);
    if (contents.length !== before.size || after.size !== before.size || after.mtimeMs !== opened.mtimeMs) {
      throw new Error(`Distribution member changed while reading it: ${relative}`);
    }
    assertUnlinkedPath(filename, "Distribution member");
    return { contents, mode: before.mode & 0o111 ? 0o755 : 0o644 };
  } finally { closeSync(descriptor); }
}

function digest(contents) { return createHash("sha256").update(contents).digest("hex"); }

function writePayloadFile(filename, contents, mode) {
  const descriptor = openSync(filename, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    writeFileSync(descriptor, contents);
    // Do not let the bootstrap's private umask change pinned member modes.
    fchmodSync(descriptor, mode);
  } finally { closeSync(descriptor); }
}

/** Windows environment names are case-insensitive, including plain test objects. */
export function normalizePayloadEnvironment(environment = process.env, platform = process.platform) {
  const result = {};
  const seen = new Map();
  for (const [key, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    const identity = platform === "win32" ? key.toUpperCase() : key;
    if (seen.has(identity)) {
      if (seen.get(identity) !== value) throw new Error(`Conflicting case-insensitive Windows environment values for ${key}.`);
      continue;
    }
    seen.set(identity, value);
    result[platform === "win32" ? identity : key] = value;
  }
  return result;
}

function environmentValue(environment, name) {
  return environment[process.platform === "win32" ? name.toUpperCase() : name];
}

function npmEnvironment(environment) {
  const child = {};
  const forbidden = new Set([
    "NODE_OPTIONS", "NODE_PATH", "BASH_ENV", "ENV", "NPM_CONFIG_PREFIX", "NPM_CONFIG_GLOBAL",
    "NPM_CONFIG_WORKSPACE", "NPM_CONFIG_WORKSPACES", "NPM_CONFIG_INCLUDE_WORKSPACE_ROOT",
  ]);
  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined && !forbidden.has(key.toUpperCase())) child[key] = value;
  }
  return child;
}

function explicitNpmConfig(source, environment, name) {
  const values = [...new Set(Object.entries(environment)
    .filter(([key]) => key.toUpperCase() === name).map(([, value]) => value))];
  if (values.length > 1) throw new Error(`Conflicting environment aliases for ${name}.`);
  if (!values[0]) return Buffer.alloc(0);
  // Match npm's path-valued configuration: trim, environment substitution,
  // then home expansion. A literal ~/ path must not become an empty snapshot.
  const selected = values[0].trim().replace(/(?<!\\)(\\*)\$\{([^${}?]+)(\?)?\}/gu, (match, escapes, variable, optional) => {
    if (escapes.length % 2) return match.slice((escapes.length + 1) / 2);
    return escapes.slice(escapes.length / 2) + (environmentValue(environment, variable) ?? (optional ? "" : `\${${variable}}`));
  });
  if (!selected || selected === os.devNull) return Buffer.alloc(0);
  const home = environmentValue(environment, "HOME") || os.homedir();
  const filename = (process.platform === "win32" ? /^~[/\\]/u : /^~\//u).test(selected)
    ? path.resolve(source, home, selected.slice(2)) : path.resolve(source, selected);
  if (!inspect(filename)) return Buffer.alloc(0); // npm permits a missing config.
  const resolved = realpathSync(filename);
  const metadata = lstatSync(resolved);
  if (!metadata.isFile() || metadata.size > 1024 * 1024) {
    throw new Error(`Explicit npm configuration must be a bounded regular file: ${filename}`);
  }
  return regularFileBytes(path.dirname(resolved), path.basename(resolved), 1024 * 1024).contents;
}

/** Keep pack's writes out of the user's cache, including in a dry run. */
function withNpmInspection(source, outputRoot, environment, run) {
  // Preserve explicitly selected policy/auth settings without loading default
  // user/global config. These private snapshots never enter the payload.
  const configs = [explicitNpmConfig(source, environment, "NPM_CONFIG_USERCONFIG"),
    explicitNpmConfig(source, environment, "NPM_CONFIG_GLOBALCONFIG")];
  const created = [];
  let scratch;
  let scratchIdentity;
  let failure;
  const sameDirectory = (directory, expected) => {
    assertUnlinkedPath(directory, "npm inspection storage");
    const actual = inspect(directory);
    if (!actual?.isDirectory() || actual.dev !== expected.dev || actual.ino !== expected.ino) {
      throw new Error(`npm inspection directory changed identity: ${directory}`);
    }
  };
  try {
    const missing = [];
    let parent = outputRoot;
    while (!inspect(parent)) { missing.push(parent); parent = path.dirname(parent); }
    assertUnlinkedPath(parent, "npm inspection parent");
    if (!lstatSync(parent).isDirectory()) throw new Error(`npm inspection parent is not a directory: ${parent}`);
    for (const directory of missing.reverse()) {
      assertUnlinkedPath(path.dirname(directory), "npm inspection parent");
      mkdirSync(directory, { mode: 0o700 });
      created.push([directory, lstatSync(directory)]);
    }
    assertUnlinkedPath(outputRoot, "npm inspection output");
    scratch = mkdtempSync(path.join(outputRoot, ".npm-inspect-"));
    scratchIdentity = lstatSync(scratch);
    const cache = path.join(scratch, "cache");
    const logs = path.join(scratch, "logs");
    const temporary = path.join(scratch, "tmp");
    for (const directory of [cache, logs, temporary]) mkdirSync(directory, { mode: 0o700 });
    const userConfig = path.join(scratch, "user.npmrc");
    const globalConfig = path.join(scratch, "global.npmrc");
    writePayloadFile(userConfig, configs[0], 0o600);
    writePayloadFile(globalConfig, configs[1], 0o600);
    const env = npmEnvironment(environment);
    for (const key of Object.keys(env)) {
      if (["NPM_CONFIG_CACHE", "NPM_CONFIG_LOGS_DIR", "NPM_CONFIG_USERCONFIG", "NPM_CONFIG_GLOBALCONFIG", "TMP", "TEMP", "TMPDIR"].includes(key.toUpperCase())) delete env[key];
    }
    Object.assign(env, { TMP: temporary, TEMP: temporary, TMPDIR: temporary,
      npm_config_cache: cache, npm_config_logs_dir: logs,
      npm_config_userconfig: userConfig, npm_config_globalconfig: globalConfig });
    // CLI precedence also fences redirects in the source project's .npmrc.
    return run(env, ["--cache", cache, "--logs-dir", logs, "--userconfig", userConfig,
      "--globalconfig", globalConfig, "--prefix", source, "--global=false"]);
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    try {
      if (scratch) {
        sameDirectory(scratch, scratchIdentity);
        rmSync(scratch, { recursive: true });
      }
      for (const [directory, identity] of created.reverse()) {
        sameDirectory(directory, identity);
        try { rmdirSync(directory); }
        catch (error) {
          // Another preparation may now use a parent we created. Never remove
          // its contents, or any pre-existing output directory.
          if (error.code !== "ENOTEMPTY" && error.code !== "EEXIST") throw error;
        }
      }
    } catch (cleanupError) {
      if (failure) throw new AggregateError([failure, cleanupError], `${failure.message}; npm inspection cleanup failed: ${cleanupError.message}`);
      throw cleanupError;
    }
  }
}

/** Invoke npm's installed JavaScript entrypoint directly, including on Windows. */
function managedExecutableRoots(sourceRoot, runtimeRoot, toolchainRoot, selectedToolchainRoot, environment) {
  const roots = new Set([sourceRoot, runtimeRoot, toolchainRoot, selectedToolchainRoot]);
  for (const selected of [...roots]) {
    const local = path.join(selected, ".local");
    if (existsSync(local)) roots.add(path.dirname(realpathSync(local)));
  }
  for (const name of ["GB_STUDIO_WORKSPACE_ROOT", "GB_STUDIO_PROJECT_ROOT"]) {
    const configured = environmentValue(environment, name)?.trim();
    if (!configured) continue;
    const selected = path.resolve(configured);
    try { roots.add(statSync(selected).isFile() ? path.dirname(realpathSync(selected)) : realpathSync(selected)); }
    catch { roots.add(selected); }
  }
  const current = realpathSync(process.cwd());
  // Running from one's home or a drive root must not ban an ordinary NVM/global
  // installation. Explicit source/runtime/toolchain/project roots still apply.
  if (canonicalKey(current) !== canonicalKey(os.homedir()) && current !== path.parse(current).root) roots.add(current);
  return [...roots];
}

function resolveNpmCli(rejectedRoots, environment) {
  const nodeDirectory = path.dirname(realpathSync(process.execPath));
  const candidates = [
    path.join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(nodeDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
  ];
  const configured = environmentValue(environment, "npm_execpath");
  if (configured && path.isAbsolute(configured)) candidates.push(configured);
  for (const entry of (environmentValue(environment, "PATH") ?? "").split(path.delimiter)) {
    const directory = entry.trim().replace(/^"(.*)"$/u, "$1");
    if (!directory || !path.isAbsolute(directory)) continue;
    candidates.push(path.join(directory, "node_modules", "npm", "bin", "npm-cli.js"));
    candidates.push(path.join(directory, "npm"));
  }
  for (const candidate of candidates) {
    try {
      const resolved = realpathSync(candidate);
      if (rejectedRoots.some((root) => isWithin(root, resolved)) || path.basename(resolved) !== "npm-cli.js" || !statSync(resolved).isFile()) continue;
      if (readObject(path.resolve(path.dirname(resolved), "..", "package.json"), "npm manifest").name !== "npm") continue;
      return resolved;
    } catch { /* Try another installed npm location. */ }
  }
  throw new Error("Could not locate npm's installed npm-cli.js beside trusted Node or on an absolute PATH outside the selected checkout.");
}

// Follow npm pack's directory inventory without constructing its throwaway
// level-9 gzip tarball. Resolve each dependency from its actual consumer so
// nested npm dependency layouts use the same versions as libnpmpack/Pacote.
// This runs in a child with the existing isolated npm environment and bounds.
const NPM_INVENTORY_PROGRAM = String.raw`
const fs = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const [npmCli, source, rejectedRootsJson, ...storageArgs] = process.argv.slice(1);
const npmRoot = fs.realpathSync(path.dirname(path.dirname(npmCli)));
const rejectedRoots = JSON.parse(rejectedRootsJson);
const within = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === "" || relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
};
const unsupported = () => { throw Object.assign(new Error("Unsupported npm inventory layout or API"), { code: "NPM_INVENTORY_UNSUPPORTED" }); };
let supportedLayout = true;
const resolve = (consumer, name) => {
  let entry;
  try { entry = fs.realpathSync(createRequire(consumer).resolve(name)); }
  catch (error) {
    if (["MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED", "ENOENT"].includes(error.code)) return undefined;
    throw error;
  }
  if (rejectedRoots.some(root => within(root, entry))) throw new Error("npm inventory dependency resolves inside a managed project: " + name);
  // Distro-split layouts can still use the established trusted npm CLI. Never
  // directly load their external modules in this optimization's fast path.
  if (!within(npmRoot, entry) || !fs.statSync(entry).isFile()) supportedLayout = false;
  return entry;
};
const consumer = (relative) => {
  const expected = path.join(npmRoot, relative);
  let entry;
  try { entry = fs.realpathSync(expected); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    supportedLayout = false;
    return expected;
  }
  if (rejectedRoots.some(root => within(root, entry))) throw new Error("npm inventory consumer resolves inside a managed project: " + relative);
  if (!within(npmRoot, entry) || !fs.statSync(entry).isFile()) supportedLayout = false;
  return entry;
};
async function inventory() {
  // Match the installed CLI's consumers, including lib/node_modules overrides.
  // Missing or external consumer files disable the optimization, but we still
  // check the known dependency chain before invoking the trusted CLI fallback.
  const packConsumer = consumer("lib/commands/pack.js");
  const configConsumer = consumer("lib/npm.js");
  const libpack = resolve(packConsumer, "libnpmpack");
  const arborist = libpack && resolve(libpack, "@npmcli/arborist");
  const pacote = libpack && resolve(libpack, "pacote");
  const packlistEntry = pacote && resolve(pacote, "npm-packlist");
  const configEntry = resolve(configConsumer, "@npmcli/config");
  const definitionsEntry = resolve(configConsumer, "@npmcli/config/lib/definitions");
  // Complete every resolvable entrypoint's trust check before selecting the
  // compatibility fallback. A safe split dependency cannot hide a later
  // dependency redirected into the checkout.
  if (!supportedLayout || ![libpack, arborist, pacote, packlistEntry, configEntry, definitionsEntry].every(Boolean)) unsupported();
  const Arborist = require(arborist);
  const packlist = require(packlistEntry);
  const Config = require(configEntry);
  const { definitions, flatten, nerfDarts, shorthands } = require(definitionsEntry);
  if (typeof Arborist !== "function" || typeof Arborist.prototype?.loadActual !== "function" || typeof packlist !== "function"
      || typeof Config !== "function" || typeof Config.prototype?.load !== "function" || typeof Config.prototype?.validate !== "function"
      || typeof Config.prototype?.get !== "function"
      || !definitions || typeof flatten !== "function" || !shorthands) unsupported();
  // Match npm's config load/validation before file selection. The explicit CLI
  // options keep workspace selection, lifecycle scripts, and storage fenced.
  const config = new Config({ npmPath: npmRoot, definitions, flatten, nerfDarts, shorthands,
    argv: [process.execPath, npmCli, "pack", "--dry-run", "--json", "--ignore-scripts", "--workspaces=false", ...storageArgs] });
  await config.load();
  config.validate();
  const workspaces = config.get("workspaces");
  const workspace = config.get("workspace");
  if ((workspaces !== null && typeof workspaces !== "boolean") || !Array.isArray(workspace)) unsupported();
  if (workspaces === false && workspace.length) {
    throw new Error("Cannot use --no-workspaces and --workspace at the same time");
  }
  const tree = await new Arborist({ path: source }).loadActual();
  if (!tree.package._id) throw new Error("Invalid package, must have name and version");
  // The launcher fixes prefix to source and disables workspace selection.
  // Omit workspaces, as npm pack does for --workspaces=false.
  const files = await packlist(tree, { path: source, prefix: source });
  process.stdout.write(JSON.stringify([{ name: tree.package.name, files: files.map(path => ({ path })) }]));
}
inventory().catch(error => {
  if (error.code === "NPM_INVENTORY_UNSUPPORTED") {
    process.stdout.write("NPM_INVENTORY_UNSUPPORTED\n"); process.exitCode = 78;
  } else { process.stderr.write(error.message + "\n"); process.exitCode = 1; }
});
`;

function npmDistributionFiles(source, rejectedRoots, environment, outputRoot) {
  const npmCli = resolveNpmCli(rejectedRoots, environment);
  const result = withNpmInspection(source, outputRoot, environment, (env, storageArgs) => {
    const started = performance.now();
    let execution = spawnSync(realpathSync(process.execPath), [
      "--input-type=commonjs", "--eval", NPM_INVENTORY_PROGRAM, npmCli, source, JSON.stringify(rejectedRoots), ...storageArgs,
    ], {
      cwd: source, env, shell: false, windowsHide: true,
      encoding: "utf8", timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
    });
    if (!execution.error && execution.status === 78 && execution.stdout === "NPM_INVENTORY_UNSUPPORTED\n") {
      const remaining = 60_000 - Math.ceil(performance.now() - started);
      if (remaining <= 0) throw new Error("npm package inspection exceeded its 60-second deadline.");
      execution = spawnSync(realpathSync(process.execPath), [
        npmCli, "pack", "--dry-run", "--json", "--ignore-scripts", "--workspaces=false", ...storageArgs,
      ], { cwd: source, env, shell: false, windowsHide: true,
        encoding: "utf8", timeout: remaining, maxBuffer: 4 * 1024 * 1024 });
    }
    if (execution.error || execution.status !== 0) {
      throw new Error(`npm could not inspect the distributable package: ${execution.error?.message ?? execution.stderr?.trim() ?? "unknown failure"}`);
    }
    return execution;
  });
  let packages;
  try { packages = JSON.parse(result.stdout); }
  catch (cause) {
    throw new Error(`npm package inspection returned invalid JSON for ${source}.`, { cause });
  }
  if (!Array.isArray(packages) || packages.length !== 1 || packages[0]?.name !== PLUGIN_NAME || !Array.isArray(packages[0]?.files)) {
    throw new Error("npm pack did not report exactly one modretro-chromatic package.");
  }
  const files = packages[0].files.map((file) => file.path);
  if (files.length > MAX_FILES - 3 || new Set(files).size !== files.length) throw new Error("The distribution file list is oversized or contains duplicate paths.");
  for (const filename of files) {
    if (isForbiddenPayloadPath(filename)) throw new Error(`Refusing forbidden distribution member: ${filename}`);
  }
  return files.sort();
}

function preparedRuntime(candidate) {
  const runtimeRoot = realDirectory(candidate, "Prepared runtime");
  const required = ["dist/server.js", "scripts/emulator_worker.py"];
  for (const filename of required) {
    const selected = path.join(runtimeRoot, filename);
    if (!statSync(selected).isFile() || !isWithin(runtimeRoot, realpathSync(selected))) {
      throw new Error(`Prepared runtime is incomplete or redirected: ${selected}`);
    }
  }
  const sdk = realDirectory(path.join(runtimeRoot, "node_modules", "@modelcontextprotocol", "sdk"), "Installed MCP SDK");
  if (!isWithin(runtimeRoot, sdk)) throw new Error("The installed MCP SDK must belong to the selected prepared runtime.");
  return runtimeRoot;
}

function resolveToolchainRoot(candidate) {
  const selected = realDirectory(candidate, "Toolchain root");
  const local = path.join(selected, ".local");
  if (!existsSync(local)) return selected;
  const resolved = realDirectory(local, "Existing local toolchain");
  if (path.basename(resolved).toLowerCase() !== ".local") throw new Error("The existing toolchain must resolve to a real .local directory.");
  return path.dirname(resolved);
}

function isRuntimeFile(filename) {
  return filename.startsWith("dist/") || filename.startsWith("assets/devices/") || filename === "scripts/emulator_worker.py" ||
    ["scripts/dependency-doctor.mjs", "scripts/dependency-catalog.mjs", "scripts/node-releases.tsv", "scripts/setup-io.mjs", "scripts/chromatic.mjs", "scripts/chromatic-runtime.mjs"].includes(filename) ||
    filename.startsWith("third-party/chromatic-cli/") ||
    (filename.startsWith("native/capture/macos/") || filename.startsWith("native/capture/linux/")) || filename.startsWith("native-game-plugin/") || filename.startsWith("examples/");
}

function assertExactRuntimeSubtree(runtimeRoot, files, subtree = "dist") {
  const expectedFiles = new Set(files.filter((file) => file.path.startsWith(`${subtree}/`)).map((file) => file.path));
  const expectedDirectories = new Set([subtree]);
  for (const filename of expectedFiles) {
    const components = filename.split("/");
    for (let index = 1; index < components.length; index++) expectedDirectories.add(components.slice(0, index).join("/"));
  }
  const found = new Set();
  const repair = subtree === "dist" ? "Clean its generated dist directory and run npm run build" : subtree.startsWith("native/capture/") ? "Restore the pinned native capture runtime" : "Restore the intact bundled Wrecklight sample";
  const reject = (relative) => {
    throw new Error(`The selected runtime ${subtree} has an unlisted or redirected entry: ${relative}. ${repair} before preparing the plugin again.`);
  };
  function visit(relative) {
    const directory = path.join(runtimeRoot, ...relative.split("/"));
    assertUnlinkedPath(directory, "Prepared runtime dist");
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) reject(child);
      if (entry.isDirectory()) {
        if (!expectedDirectories.has(child)) reject(child);
        visit(child);
      } else {
        if (!entry.isFile() || !expectedFiles.has(child)) reject(child);
        found.add(child);
      }
    }
  }
  visit(subtree);
  if (found.size !== expectedFiles.size) {
    throw new Error(`The selected runtime ${subtree} is incomplete. ${repair} before preparing the plugin again.`);
  }
}

function assertRuntimeMatchesSource(sourceRoot, runtimeRoot, packageJson, files) {
  if (canonicalKey(sourceRoot) === canonicalKey(runtimeRoot)) return;
  const runtimePackage = readObject(path.join(runtimeRoot, "package.json"), "Runtime package manifest");
  if (runtimePackage.name !== packageJson.name || runtimePackage.version !== packageJson.version) {
    throw new Error("The selected runtime package identity/release does not match the distributable source; prepare that exact release first.");
  }
  const target = chromaticTargetFromManifest(packageJson);
  const format = chromaticFormatFromManifest(packageJson);
  if (chromaticTargetFromManifest(runtimePackage) !== target) {
    throw new Error("The selected runtime platform does not match the distributable source.");
  }
  if (chromaticFormatFromManifest(runtimePackage) !== format) throw new Error("Runtime and package Chromatic formats differ.");
  assertExactRuntimeSubtree(runtimeRoot, files);
  for (const subtree of ["native/capture/macos", "native/capture/linux"]) {
    if (files.some((file) => file.path.startsWith(`${subtree}/`))) assertExactRuntimeSubtree(runtimeRoot, files, subtree);
  }
  if (files.some((file) => file.path.startsWith("examples/wrecklight/"))) assertExactRuntimeSubtree(runtimeRoot, files, "examples/wrecklight");
  if (packageJson.bundledChromatic === CHROMATIC_VERSION) verifyChromaticBundle(runtimeRoot, { target, format });
  for (const file of files) {
    if (!isRuntimeFile(file.path)) continue;
    const actual = regularFileBytes(runtimeRoot, file.path);
    if (digest(actual.contents) !== file.sha256 || ((file.path.startsWith("native/capture/macos/") || file.path.startsWith("native/capture/linux/")) && actual.mode !== file.mode)) {
      throw new Error(`The selected runtime does not match the distributable source: ${file.path}. Build the selected release before registering it.`);
    }
  }
}

function buildPlan(options) {
  const portable = options.portable === true;
  const selfContained = options.selfContained === true;
  if (selfContained && !portable) throw new Error("--self-contained requires --portable.");
  const compactRequested = options.compact === true;
  if (options.compact !== undefined && typeof options.compact !== "boolean") throw new Error("compact must be a boolean.");
  if (compactRequested && !portable) throw new Error("--compact requires --portable.");
  if (options.portable !== undefined && typeof options.portable !== "boolean") throw new Error("portable must be a boolean.");
  if (options.zip !== undefined && typeof options.zip !== "boolean") throw new Error("zip must be a boolean.");
  if (options.zip && !portable) throw new Error("--zip requires --portable; machine-local payloads cannot be uploaded.");
  if (options.target !== undefined && !portable) throw new Error("--target is only available with --portable; local payloads retain their source platform.");
  if (portable && (options.runtimeRoot !== undefined || options.toolchainRoot !== undefined)) {
    throw new Error("A portable distribution cannot bind a local runtime or toolchain.");
  }
  if (portable && process.platform === "win32") {
    throw new Error("Portable distributions must be prepared on a POSIX host to preserve pinned file modes.");
  }
  const environment = normalizePayloadEnvironment(options.environment ?? process.env);
  const sourceRoot = realDirectory(options.source ?? SCRIPT_ROOT, "Plugin source");
  const packageJson = readObject(path.join(sourceRoot, "package.json"), "Package manifest");
  const pluginJson = readObject(path.join(sourceRoot, ".codex-plugin", "plugin.json"), "Plugin manifest");
  if (packageJson.name !== PLUGIN_NAME || pluginJson.name !== PLUGIN_NAME || typeof pluginJson.version !== "string") {
    throw new Error(`The selected source must declare a versioned ${PLUGIN_NAME} plugin.`);
  }
  if (pluginJson.version.split("+")[0] !== packageJson.version) throw new Error("Package and plugin release versions differ; finish the release metadata before staging.");
  if (!Array.isArray(packageJson.files) || packageJson.files.length === 0) throw new Error("The selected package needs an explicit reviewed npm files allowlist.");
  const sourceTarget = chromaticTargetFromManifest(packageJson);
  const sourceFormat = chromaticFormatFromManifest(packageJson);
  const target = options.target === undefined ? sourceTarget
    : chromaticTargetFromManifest({ ...packageJson, bundledChromaticTarget: options.target });
  if (sourceTarget !== undefined && sourceTarget !== target) throw new Error("A platform distribution cannot be retargeted to another platform.");
  // Keep the established package:upload --target shortcut. Explicit platform
  // selection retains the raw targeted format instead of shipping all six.
  const compact = compactRequested && target === undefined;
  const format = compact ? sourceFormat ?? CHROMATIC_PACKED_V2.format : sourceFormat;
  if (format !== undefined && target !== undefined) throw new Error("Packed distributions are universal; use the raw source for an explicit --target package.");
  if (!portable) requireChromaticHostTarget(target);
  const distributionPackage = { ...packageJson, ...(selfContained ? { bundledMcp: true } : {}), ...(target === undefined ? {} : { bundledChromaticTarget: target }),
    ...(format === undefined ? {} : { bundledChromaticFormat: format }) };
  const runtimeRoot = portable ? sourceRoot : preparedRuntime(options.runtimeRoot ?? sourceRoot);
  const selectedToolchainRoot = portable ? sourceRoot
    : realDirectory(options.toolchainRoot ?? environmentValue(environment, "GB_STUDIO_TOOLCHAIN_ROOT") ?? runtimeRoot, "Selected toolchain root");
  const toolchainRoot = portable ? sourceRoot : resolveToolchainRoot(selectedToolchainRoot);
  const nodeExecutable = realpathSync(process.execPath);
  const rejectedExecutableRoots = managedExecutableRoots(sourceRoot, runtimeRoot, toolchainRoot, selectedToolchainRoot, environment);
  if (rejectedExecutableRoots.some((root) => isWithin(root, nodeExecutable))) {
    throw new Error("The Node executable must be installed outside the selected source, runtime, toolchain, and project directories.");
  }
  const outputRoot = assertUnlinkedPath(options.outputRoot ?? path.join(sourceRoot, "artifacts", portable ? "plugin-distributions" : "plugin-payloads"), "Payload output root");
  if (isWithin(sourceRoot, outputRoot) && !isWithin(path.join(sourceRoot, "artifacts"), outputRoot)) {
    throw new Error("A payload output root inside the checkout must be beneath its ignored artifacts directory.");
  }
  for (const root of new Set([sourceRoot, runtimeRoot, toolchainRoot])) {
    for (const directory of [".local", "node_modules", "vendor"]) {
      if (isWithin(path.join(root, directory), outputRoot)) throw new Error("Payload output must not be inside a runtime dependency or toolchain directory.");
    }
  }
  const files = [];
  let totalBytes = 0;
  const standalone = selfContained ? bundleMcp(sourceRoot) : undefined;
  const sourceFiles = npmDistributionFiles(sourceRoot, rejectedExecutableRoots, environment, outputRoot);
  if (packageJson.bundledChromatic === CHROMATIC_VERSION) {
    for (const required of chromaticRequiredPaths(sourceTarget, sourceFormat)) {
      if (!sourceFiles.includes(required)) throw new Error(`The distribution is missing bundled Chromatic member: ${required}`);
    }
    // Authenticate the complete source bundle before selecting any platform.
    verifyChromaticBundle(sourceRoot, { target: sourceTarget, format: sourceFormat });
  }
  const packing = new Map(compact && sourceFormat === undefined ? [
    [CHROMATIC_PACKED_V2.source, `${CHROMATIC_ROOT}/${CHROMATIC_PACKED_V2.member}`],
    [CHROMATIC_NOTICE_PACK.source, `${CHROMATIC_ROOT}/${CHROMATIC_NOTICE_PACK.member}`],
    [CHROMATIC_ARTWORK_PACK.source, `assets/devices/${CHROMATIC_ARTWORK_PACK.member}`],
  ] : []);
  for (const source of packing.keys()) if (!sourceFiles.includes(source)) {
    throw new Error(`The compact distribution requires its pinned source stream in the package allowlist: ${source}`);
  }
  const selectedVendorPaths = new Set(chromaticRequiredPaths(target, format));
  for (const filename of sourceFiles) {
    if (compact && (filename.startsWith("examples/wrecklight/") || (filename.startsWith("dist/") && filename.endsWith(".d.ts")))) continue;
    if (packing.size && filename.startsWith(CHROMATIC_ROOT + "/") && !selectedVendorPaths.has(filename)) continue;
    if (packing.size && filename.startsWith("assets/devices/") && Object.hasOwn(CHROMATIC_ARTWORK_MEMBERS, filename.slice("assets/devices/".length))) {
      const source = regularFileBytes(sourceRoot, filename), pin = CHROMATIC_ARTWORK_MEMBERS[filename.slice("assets/devices/".length)];
      if (source.contents.length !== pin.size || digest(source.contents) !== pin.sha256 || source.mode !== pin.mode) {
        throw new Error(`Device artwork differs from its packed source pin: ${filename}`);
      }
      continue;
    }
    if (CHROMATIC_STORAGE_SOURCES.includes(filename) && !packing.has(filename)) continue;
    const destinationName = packing.get(filename) ?? filename;
    if (portable && target !== undefined && filename.startsWith(CHROMATIC_ROOT + "/") && !selectedVendorPaths.has(filename)) continue;
    let { contents, mode } = regularFileBytes(sourceRoot, filename);
    if (portable && filename.startsWith(CHROMATIC_ROOT + "/")) {
      // Publish the pinned portable mode, not a foreign host's normalized mode.
      const member = [CHROMATIC_PACKED, CHROMATIC_PACKED_V2, CHROMATIC_NOTICE_PACK]
        .find((pack) => filename === `${CHROMATIC_ROOT}/${pack.member}`) ?? CHROMATIC_MEMBERS[filename.slice(CHROMATIC_ROOT.length + 1)];
      if (!member) throw new Error(`Unrecognized bundled Chromatic member: ${filename}`);
      mode = member.mode;
    }
    if (filename === ".codex-plugin/plugin.json") {
      // Canonicalize before deriving the generated cache version so the
      // launcher can reconstruct and verify that identity from the payload.
      contents = Buffer.from(`${JSON.stringify(pluginJson, null, 2)}\n`);
      mode = 0o644;
    }
    if (filename === ".mcp.json") {
      contents = Buffer.from(`${JSON.stringify({ mcpServers: { "modretro-chromatic": {
        // Keep installed tools alive through the bounded compiler and validation.
        tool_timeout_sec: 900,
        type: "stdio", cwd: ".", command: portable ? "node" : nodeExecutable, args: ["./scripts/start-mcp.mjs"],
        env: portable ? { GB_STUDIO_LOG_LEVEL: "info" }
          : { GB_STUDIO_LOG_LEVEL: "info", GB_STUDIO_RUNTIME_ROOT: runtimeRoot, GB_STUDIO_TOOLCHAIN_ROOT: toolchainRoot },
      } } }, null, 2)}\n`);
      mode = 0o644;
    }
    if (filename === "package.json") {
      // Local update payloads must not be repacked with absolute launch paths.
      // Portable distributions retain the reviewed package allowlist instead.
      contents = Buffer.from(`${JSON.stringify(portable ? distributionPackage
        : { ...distributionPackage, private: true, files: [], scripts: {} }, null, 2)}\n`);
      mode = 0o644;
    }
    if (standalone && filename === "dist/server.js") {
      const sourceVersion = contents.toString("utf8").match(/\b(?:const|var)\s+SERVER_VERSION\s*=\s*["']([^"']+)["']/u)?.[1];
      if (sourceVersion !== packageJson.version) throw new Error("The compiled MCP server version is stale; run npm run build first.");
      contents = standalone.contents;
    }
    if (standalone && filename === "scripts/device-client-deps.mjs") contents = standalone.clientContents;
    if (contents.length > MAX_FILE_BYTES) throw new Error(`Distribution member exceeds byte limit: ${filename}`);
    totalBytes += contents.length;
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error(`The distributable payload exceeds ${MAX_TOTAL_BYTES} bytes.`);
    files.push({ path: destinationName, contents, mode, size: contents.length, sha256: digest(contents) });
  }
  if (standalone) {
    const contents = standalone.notices;
    if (contents.length > MAX_FILE_BYTES || totalBytes + contents.length > MAX_TOTAL_BYTES) {
      throw new Error("Bundled dependency notices exceed distribution byte limits.");
    }
    files.push({ path: "licenses/bundled-javascript.txt", contents, mode: 0o644, size: contents.length, sha256: digest(contents) });
    totalBytes += contents.length;
  }
  for (const filename of portable ? [] : [".gitignore", ".npmignore"]) {
    const contents = Buffer.from("*\n");
    files.push({ path: filename, contents, mode: 0o644, size: contents.length, sha256: digest(contents) });
    totalBytes += contents.length;
  }
  files.sort((left, right) => left.path.localeCompare(right.path, "en"));
  if (packageJson.bundledChromatic !== undefined) {
    if (packageJson.bundledChromatic !== CHROMATIC_VERSION) throw new Error("Unsupported bundled Chromatic release.");
    for (const required of chromaticRequiredPaths(target, format)) {
      if (!files.some((file) => file.path === required)) throw new Error(`The distribution is missing bundled Chromatic member: ${required}`);
    }
    verifyChromaticRecords(files, { target, format });
  }
  for (const required of [".codex-plugin/plugin.json", ".mcp.json", "package.json", "scripts/start-mcp.mjs", "scripts/chromatic-runtime.mjs", "scripts/emulator_worker.py", "dist/server.js"]) {
    if (!files.some((file) => file.path === required)) throw new Error(`The npm distribution is missing ${required}; run npm run build first.`);
  }
  if (options.zip) assertUploadIcons(pluginJson, files);
  const serverVersion = files.find((file) => file.path === "dist/server.js").contents.toString("utf8")
    .match(/\b(?:const|var)\s+SERVER_VERSION\s*=\s*["']([^"']+)["']/u)?.[1];
  if (serverVersion !== packageJson.version) throw new Error("The compiled MCP server version is stale or unrecognized; run npm run build in the selected source before staging.");
  if (!portable) assertRuntimeMatchesSource(sourceRoot, runtimeRoot, distributionPackage, files);
  const inventoryOf = () => files.map(({ path: filename, mode, size, sha256 }) => ({ path: filename, mode, size, sha256 }));
  // Codex caches by manifest version. Bind that version to the machine-local
  // launcher as well as the source bytes, without mutating the shipped release.
  const sourceVersion = pluginJson.version;
  const contentIdentity = digest(JSON.stringify(inventoryOf()));
  const version = `${sourceVersion.split("+")[0]}+codex.${portable ? "distribution" : "payload"}.${contentIdentity.slice(0, 24)}`;
  const manifestFile = files.find((file) => file.path === ".codex-plugin/plugin.json");
  const rewrittenManifest = Buffer.from(`${JSON.stringify({ ...pluginJson, version }, null, 2)}\n`);
  totalBytes += rewrittenManifest.length - manifestFile.size;
  Object.assign(manifestFile, { contents: rewrittenManifest, size: rewrittenManifest.length, sha256: digest(rewrittenManifest) });
  const inventory = inventoryOf();
  const payloadId = digest(JSON.stringify(inventory));
  const payloadPath = path.join(outputRoot, payloadId.slice(0, 32), PLUGIN_NAME);
  const runtime = { packageName: packageJson.name, version: packageJson.version, files: inventory.filter((file) => isRuntimeFile(file.path)) };
  const receipt = Buffer.from(`${JSON.stringify(portable ? {
    schemaVersion: 1, kind: "portable-distribution", pluginName: PLUGIN_NAME, sourceVersion, version,
    distributionId: payloadId, target: target ?? "universal", files: inventory,
  } : {
    schemaVersion: 1, pluginName: PLUGIN_NAME, sourceVersion, version, payloadId,
    runtimeRoot, toolchainRoot, nodeExecutable, runtime, files: inventory,
  }, null, 2)}\n`);
  if (receipt.length > 1024 * 1024 || totalBytes + receipt.length > MAX_TOTAL_BYTES) {
    throw new Error("The complete local payload and its receipt exceed the bounded distribution limits.");
  }
  return { sourceRoot, outputRoot, payloadPath, payloadId, runtimeRoot, toolchainRoot, nodeExecutable,
    sourceVersion, version, files, receipt, totalBytes: totalBytes + receipt.length, portable, target };
}

function assertUploadIcons(manifest, files) {
  if (files.some((file) => file.path === DISTRIBUTION_MANIFEST)) throw new Error("distribution.json belongs outside the uploaded plugin.");
  // Only the maintainer ZIP command needs the existing image dependency.
  const { PNG } = createRequire(import.meta.url)("pngjs");
  for (const field of ["composerIcon", "logo"]) {
    const reference = manifest.interface?.[field];
    const relative = typeof reference === "string" && reference.startsWith("./") ? reference.slice(2) : "";
    const icon = !isForbiddenPayloadPath(relative) && files.find((file) => file.path === relative);
    if (!icon) throw new Error(`Upload requires interface.${field} to reference a packaged local PNG.`);
    const png = icon.contents;
    if (png.length < 33 || !png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
        png.readUInt32BE(8) !== 13 || png.toString("ascii", 12, 16) !== "IHDR" ||
        png.readUInt32BE(16) === 0 || png.readUInt32BE(16) > 4096 || png.readUInt32BE(16) !== png.readUInt32BE(20)) {
      throw new Error(`Upload requires a square PNG no larger than 4096px for interface.${field}: ${reference}`);
    }
    try { PNG.sync.read(png, { checkCRC: true }); }
    catch (cause) { throw new Error(`Upload requires a complete, decodable PNG for interface.${field}: ${reference}`, { cause }); }
  }
}

// Parent-first, stable directory inventory shared by staging and ZIP publication.
function payloadDirectories(files) {
  const directories = new Set();
  for (const file of files) {
    const parts = file.path.split("/");
    for (let i = 1; i < parts.length; i++) directories.add(parts.slice(0, i).join("/"));
  }
  return [...directories].sort();
}

function createPayloadDirectory(directory) {
  mkdirSync(directory, { mode: 0o755 });
  // Only fresh directories inside our private staging tree are normalized.
  if (process.platform !== "win32") chmodSync(directory, 0o755);
}

/** ZIP32 is sufficient for the bounded payload. Exclude its outer container. */
function writeUploadZip(plan, zipPath) {
  const stagingRoot = mkdtempSync(path.join(plan.outputRoot, ".upload-"));
  const stagedZip = path.join(stagingRoot, "plugin.zip");
  let descriptor;
  try {
    descriptor = openSync(stagedZip, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    let offset = 0;
    const hash = createHash("sha256");
    const central = [];
    const append = (bytes) => { writeFileSync(descriptor, bytes); hash.update(bytes); offset += bytes.length; };
    const entries = [
      ...payloadDirectories(plan.files).map((directory) => ({
        path: directory + "/", contents: Buffer.alloc(0), size: 0, mode: 0o755, directory: true,
      })),
      ...plan.files,
    ];
    for (const file of entries) {
      const name = Buffer.from(file.path, "utf8");
      const deflated = deflateRawSync(file.contents, { level: 9 });
      const method = deflated.length < file.contents.length ? 8 : 0;
      const compressed = method === 8 ? deflated : file.contents;
      const crc = setupCrc32(file.contents);
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4);
      local.writeUInt16LE(0x0800, 6); // UTF-8 names; no encryption or data descriptors.
      local.writeUInt16LE(method, 8);
      local.writeUInt16LE(0x0021, 12); // Fixed 1980-01-01, independent of source mtimes.
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(compressed.length, 18);
      local.writeUInt32LE(file.size, 22);
      local.writeUInt16LE(name.length, 26);
      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt16LE(0x0314, 4); // Unix creator preserves the portable executable modes.
      local.copy(entry, 6, 4, 28);
      const unixMode = (file.directory ? 0o040000 : 0o100000) | file.mode;
      entry.writeUInt32LE(((unixMode << 16) | (file.directory ? 0x10 : 0)) >>> 0, 38);
      entry.writeUInt32LE(offset, 42);
      central.push(entry, name);
      append(local); append(name); append(compressed);
    }
    const centralOffset = offset;
    for (const bytes of central) append(bytes);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(entries.length, 8);
    end.writeUInt16LE(entries.length, 10);
    end.writeUInt32LE(offset - centralOffset, 12);
    end.writeUInt32LE(centralOffset, 16);
    append(end);
    fchmodSync(descriptor, 0o644);
    closeSync(descriptor); descriptor = undefined;
    assertUnlinkedPath(zipPath, "Upload ZIP");
    // Publish only a complete archive, without replacing an existing destination.
    linkSync(stagedZip, zipPath);
    return { zipPath, zipBytes: offset, zipSha256: hash.digest("hex") };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(stagingRoot, { recursive: true, force: true });
  }
}

function verifyExisting(plan) {
  const targetRoot = path.dirname(plan.payloadPath);
  const containerFiles = [".gitignore", ".npmignore", PLUGIN_NAME, ...(plan.portable ? [DISTRIBUTION_MANIFEST] : [])];
  if (!statSync(targetRoot).isDirectory() || readdirSync(targetRoot).sort().join("\n") !== containerFiles.sort().join("\n")) {
    throw new Error(`Refusing occupied immutable payload directory: ${targetRoot}`);
  }
  for (const marker of [".gitignore", ".npmignore"]) {
    if (regularFileBytes(targetRoot, marker).contents.toString("utf8") !== "*\n") throw new Error(`Immutable payload container marker changed: ${marker}`);
  }
  if (plan.portable) {
    const manifest = regularFileBytes(targetRoot, DISTRIBUTION_MANIFEST);
    if (manifest.mode !== 0o644 || !manifest.contents.equals(plan.receipt)) throw new Error("Portable distribution manifest changed.");
  }
  const expected = new Map(plan.files.map((file) => [file.path, { sha256: file.sha256, mode: file.mode }]));
  if (!plan.portable) expected.set(RECEIPT_PATH, { sha256: digest(plan.receipt), mode: 0o644 });
  const found = new Set();
  function visit(directory, prefix = "") {
    assertUnlinkedPath(directory, "Existing payload");
    const info = lstatSync(directory);
    if ((typeof process.getuid === "function" && info.uid !== process.getuid()) ||
        (process.platform !== "win32" && (info.mode & 0o022))) {
      throw new Error(`Unsafe existing payload directory ownership or permissions: ${directory}`);
    }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      const selected = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Existing immutable payload contains a link: ${relative}`);
      if (entry.isDirectory()) {
        if (isForbiddenPayloadPath(`${relative}/placeholder`)) throw new Error(`Existing immutable payload contains a forbidden directory: ${relative}`);
        visit(selected, relative);
      } else {
        if (!expected.has(relative) || found.has(relative)) throw new Error(`Existing immutable payload contains an unexpected file: ${relative}`);
        const actual = regularFileBytes(plan.payloadPath, relative);
        const pinned = expected.get(relative);
        if (digest(actual.contents) !== pinned.sha256 || actual.mode !== pinned.mode) {
          throw new Error(`Existing immutable payload changed: ${relative}`);
        }
        found.add(relative);
      }
    }
  }
  visit(plan.payloadPath);
  if (found.size !== expected.size) throw new Error("Existing immutable payload is incomplete; choose another output root or restore it explicitly.");
}

/** Stage a local update payload or an explicitly selected portable distribution. */
export function preparePluginPayload(options = {}) {
  const plan = buildPlan(options);
  const targetRoot = path.dirname(plan.payloadPath);
  let zipPath;
  if (options.zip) {
    const release = plan.sourceVersion.split("+")[0];
    if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(release)) throw new Error("Upload ZIP requires a semantic release version.");
    zipPath = path.join(plan.outputRoot, `modretro-chromatic-plugin-for-codex-${release}-${plan.target ?? "universal"}-upload.zip`);
    assertUnlinkedPath(zipPath, "Upload ZIP");
    if (inspect(zipPath)) throw new Error(`Upload ZIP already exists; use a new output root: ${zipPath}`);
  }
  let reused = false;
  if (inspect(targetRoot)) {
    verifyExisting(plan);
    reused = true;
  } else if (!options.dryRun) {
    mkdirSync(plan.outputRoot, { recursive: true });
    assertUnlinkedPath(plan.outputRoot, "Payload output root");
    const stagingRoot = mkdtempSync(path.join(plan.outputRoot, ".staging-"));
    const stagingPayload = path.join(stagingRoot, PLUGIN_NAME);
    try {
      for (const marker of [".gitignore", ".npmignore"]) writePayloadFile(path.join(stagingRoot, marker), "*\n", 0o644);
      if (plan.portable) writePayloadFile(path.join(stagingRoot, DISTRIBUTION_MANIFEST), plan.receipt, 0o644);
      createPayloadDirectory(stagingPayload);
      const stagedFiles = [...plan.files, ...(plan.portable ? [] : [{ path: RECEIPT_PATH, contents: plan.receipt, mode: 0o644 }])];
      for (const directory of payloadDirectories(stagedFiles)) createPayloadDirectory(path.join(stagingPayload, directory));
      for (const file of stagedFiles) {
        const destination = path.join(stagingPayload, ...file.path.split("/"));
        writePayloadFile(destination, file.contents, file.mode);
      }
      try { renameSync(stagingRoot, targetRoot); }
      catch (error) {
        if (!inspect(targetRoot)) throw error;
        verifyExisting(plan);
        reused = true;
      }
    } finally {
      if (inspect(stagingRoot)) rmSync(stagingRoot, { recursive: true, force: true });
    }
    verifyExisting(plan);
  }
  const archive = zipPath ? options.dryRun ? { zipPath } : writeUploadZip(plan, zipPath) : {};
  return {
    schemaVersion: 1, pluginName: PLUGIN_NAME, sourceVersion: plan.sourceVersion, version: plan.version, sourceRoot: plan.sourceRoot,
    payloadId: plan.payloadId, payloadPath: plan.payloadPath,
    ...(plan.portable ? {
      kind: "portable-distribution", target: plan.target ?? "universal",
      manifestPath: path.join(targetRoot, DISTRIBUTION_MANIFEST), manifestBytes: plan.receipt.length,
    } : { runtimeRoot: plan.runtimeRoot, toolchainRoot: plan.toolchainRoot, nodeExecutable: plan.nodeExecutable }),
    fileCount: plan.files.length + (plan.portable ? 0 : 1), totalBytes: plan.totalBytes, reused, dryRun: Boolean(options.dryRun),
    ...archive,
  };
}

function parseArguments(args) {
  const result = {};
  const names = { "--source": "source", "--runtime-root": "runtimeRoot", "--toolchain-root": "toolchainRoot", "--output-root": "outputRoot", "--target": "target" };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--dry-run") result.dryRun = true;
    else if (arg === "--portable") result.portable = true;
    else if (arg === "--self-contained") result.selfContained = true;
    else if (arg === "--compact") result.compact = true;
    else if (arg === "--zip") result.zip = true;
    else if (arg === "--json") result.json = true;
    else if (names[arg] && args[index + 1] && !args[index + 1].startsWith("--")) result[names[arg]] = args[++index];
    else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  return result;
}

if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const result = preparePluginPayload(options);
    if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
    else {
      process.stdout.write(`${result.dryRun ? "Would prepare" : result.reused ? "Verified existing" : "Prepared"} ${options.portable ? "portable distribution" : "local plugin payload"}: ${result.payloadPath}\n${result.fileCount} files, ${result.totalBytes} bytes; ${options.portable ? `target: ${result.target}` : `runtime: ${result.runtimeRoot}`}\n`);
      if (result.zipPath) process.stdout.write(`${result.dryRun ? "Would write" : "Upload ZIP"}: ${result.zipPath}\n${result.zipSha256 ? `SHA-256: ${result.zipSha256}\n` : ""}Distribution receipt (not uploaded): ${result.manifestPath}\n`);
    }
  } catch (error) {
    process.stderr.write(`Plugin payload preparation failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}
