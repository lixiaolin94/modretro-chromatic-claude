/** Explicit, individually selected installers. The caller owns consent, locking and promotion. */
import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, readdir, realpath, rename, rmdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { DEPENDENCY_CATALOG, DESKTOP_RELEASES, GBDK_RELEASES, SOURCE_RELEASES, UV_RELEASES } from "./dependency-catalog.mjs";
import { patchWindowsCliConstants } from "./setup-compiler.mjs";
import {
  SetupIoError, assertOwnedPath, checkSetupAbort, copySetupTree, downloadArchive,
  ensureOwnedDirectory, extractArchive, makeSetupExecutable, runSetupCommand,
  setupEnvironment, setupSha256File, writeSetupJson,
} from "./setup-io.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const output = (result) => String(result?.stdout ?? "").trim();
const componentIds = new Set(["gbdk", "cli", "uv", "emulator", "desktop"]);
const BUILD_METADATA_PATH = "src/apps/shared/webpack.plugins.js";

async function present(filename) { try { return await lstat(filename); } catch (error) { if (error.code === "ENOENT") return undefined; throw error; } }

async function regular(context, filename, maximumBytes = 512 * 1024 * 1024) {
  await assertOwnedPath(context.setupRoot, filename);
  const entry = await lstat(filename);
  if (!entry.isFile() || entry.size > maximumBytes) throw new SetupIoError("INVALID_COMPONENT", "A prepared dependency is missing a bounded regular file.", { path: filename });
  return filename;
}

async function ownedText(context, filename, maximumBytes = 1024 * 1024) { await regular(context, filename, maximumBytes); return readFile(filename, "utf8"); }

async function emptyPlaceholder(context, filename) {
  const entry = await present(filename);
  if (!entry) return;
  await assertOwnedPath(context.setupRoot, filename);
  if (!entry.isDirectory() || (await readdir(filename)).length) throw new SetupIoError("INVALID_COMPONENT", "Pinned source has a nonempty dependency placeholder; it was not overwritten.", { path: filename });
  await rmdir(filename);
}

function releaseEvidence(downloaded, release) {
  return { source: release.url, sha256: release.sha256, archive: release.archive, bytes: downloaded.bytes, cacheReused: downloaded.reused === true, quarantined: downloaded.quarantined ?? [] };
}

async function command(context, executable, args, { label, cwd = context.stageRoot, env = context.env, timeoutMs } = {}) {
  checkSetupAbort(context.signal);
  return context.io.runSetupCommand(executable, args, { cwd, env, platform: context.platform, signal: context.signal, onProgress: context.onProgress, label, timeoutMs });
}

async function fetched(context, release, label) {
  const downloaded = await context.io.downloadArchive(release, context);
  const destination = path.join(context.stageRoot, label);
  await context.io.extractArchive(downloaded.path, destination, context, { format: release.archive.endsWith(".zip") ? "zip" : "tar.gz" });
  return { root: destination, downloaded, provenance: releaseEvidence(downloaded, release) };
}

async function soleDirectory(context, directory, expectedName) {
  const entries = await readdir(directory, { withFileTypes: true });
  if (entries.length !== 1 || !entries[0].isDirectory() || entries[0].isSymbolicLink() || (expectedName && entries[0].name !== expectedName)) throw new SetupIoError("INVALID_COMPONENT", "Pinned source archive does not contain its expected single directory.", { path: directory, expected: expectedName });
  const selected = path.join(directory, entries[0].name);
  await assertOwnedPath(context.setupRoot, selected);
  return selected;
}

async function gbdk(context) {
  const release = GBDK_RELEASES[context.nativePlatform];
  const archive = await fetched(context, release, "gbdk-release");
  const preparedPath = await soleDirectory(context, archive.root, "gbdk");
  const executable = await regular(context, path.join(preparedPath, "bin", context.platform === "win32" ? "lcc.exe" : "lcc"));
  const header = path.join(preparedPath, "include", "gbdk", "version.h");
  if (!/^\s*#\s*define\s+__GBDK_VERSION\s+450(?:\s|$)/mu.test(await ownedText(context, header))) throw new SetupIoError("INCOMPATIBLE_COMPONENT", "The authenticated GBDK release does not identify version 4.5.0.");
  if (context.platform !== "win32") await makeSetupExecutable(context.setupRoot, executable);
  // GBDK 4.5 lcc expands its install prefix through a 128-byte token buffer.
  // Probe from the compiler root with a trusted short prefix; keep the absolute
  // executable and its bytes unchanged, without changing any project build path.
  await command(context, executable, ["-v"], { label: "Verify the selected GBDK compiler", cwd: preparedPath, env: { ...context.env, GBDKDIR: "./" } });
  return { preparedPath, version: release.version, provenance: { type: "official-release", ...archive.provenance, verification: ["SHA-256", "GBDK version header", "lcc -v"] }, files: [{ path: "bin/" + path.basename(executable), ...await context.io.setupSha256File(executable) }, { path: "include/gbdk/version.h", ...await context.io.setupSha256File(header) }] };
}

async function uv(context) {
  const release = UV_RELEASES[context.nativePlatform];
  const archive = await fetched(context, release, "uv-release");
  const filename = context.platform === "win32" ? "uv.exe" : "uv";
  let preparedPath = archive.root;
  if (!(await present(path.join(preparedPath, filename)))) preparedPath = await soleDirectory(context, archive.root);
  const executable = await regular(context, path.join(preparedPath, filename));
  if (context.platform !== "win32") await makeSetupExecutable(context.setupRoot, executable);
  const versionOutput = output(await command(context, executable, ["--version"], { label: "Verify the selected uv installer" }));
  if (!new RegExp("^uv " + release.version.replaceAll(".", "\\.") + "(?:\\s|$)", "u").test(versionOutput)) throw new SetupIoError("INCOMPATIBLE_COMPONENT", "The uv installer did not report its pinned version.", { expected: release.version, detected: versionOutput });
  return { preparedPath, version: release.version, provenance: { type: "official-release", ...archive.provenance, verification: ["SHA-256", "uv --version"] }, files: [{ path: filename, ...await context.io.setupSha256File(executable) }] };
}

/** Source archives have no .git; replace only the two build-metadata lookups. */
export function patchArchiveBuildMetadata(source) {
  const importLine = 'const { GitRevisionPlugin } = require("git-revision-webpack-plugin");\n';
  const creation = 'const gitRevisionPlugin = new GitRevisionPlugin({\n  commithashCommand: "rev-list --max-count=1 --no-merges --abbrev-commit HEAD",\n});\n';
  const versionCall = "gitRevisionPlugin.version()";
  const commitCall = "gitRevisionPlugin.commithash()";
  for (const token of [importLine, creation, versionCall, commitCall]) if (source.split(token).length !== 2) throw new SetupIoError("SOURCE_PATCH_MISMATCH", "Pinned GB Studio build metadata differs from the reviewed source-archive adaptation.");
  const updated = source.replace(importLine, "").replace(creation, "").replace(versionCall, JSON.stringify("v" + DEPENDENCY_CATALOG.cli.installVersion)).replace(commitCall, JSON.stringify(DEPENDENCY_CATALOG.cli.commit.slice(0, 7)));
  if (/GitRevisionPlugin|gitRevisionPlugin/u.test(updated)) throw new SetupIoError("SOURCE_PATCH_MISMATCH", "Unexpected Git revision plugin use remains after the bounded metadata adaptation.");
  return { source: updated, receipt: { path: BUILD_METADATA_PATH, purpose: "Use pinned release/commit build metadata without a Git checkout; no engine change", beforeSha256: hash(source), afterSha256: hash(updated), version: "v" + DEPENDENCY_CATALOG.cli.installVersion, abbreviatedCommit: DEPENDENCY_CATALOG.cli.commit.slice(0, 7) } };
}

async function cli(context) {
  const source = await fetched(context, SOURCE_RELEASES.cli, "cli-source");
  const preparedPath = await soleDirectory(context, source.root, "gb-studio-" + DEPENDENCY_CATALOG.cli.commit);
  const sourcePackage = JSON.parse(await ownedText(context, path.join(preparedPath, "package.json")));
  if (sourcePackage.version !== DEPENDENCY_CATALOG.cli.installVersion || sourcePackage.packageManager !== "yarn@" + SOURCE_RELEASES.yarn.version + "+sha256." + SOURCE_RELEASES.yarn.executableSha256) throw new SetupIoError("SOURCE_PIN_MISMATCH", "Pinned GB Studio source version or package-manager integrity differs from the setup catalog.");
  const gbvmSource = await fetched(context, SOURCE_RELEASES.gbvm, "gbvm-source");
  const gbvmRoot = await soleDirectory(context, gbvmSource.root, "gbvm-" + DEPENDENCY_CATALOG.cli.gbvmCommit);
  const engineDestination = path.join(preparedPath, "appData", "engine", "gbvm");
  await emptyPlaceholder(context, engineDestination);
  await context.io.copySetupTree(gbvmRoot, engineDestination, context);

  const compilerRoot = path.join(context.toolchainRoot, ".local", "gbdk");
  await assertOwnedPath(context.setupRoot, compilerRoot);
  if (!/^\s*#\s*define\s+__GBDK_VERSION\s+450(?:\s|$)/mu.test(await ownedText(context, path.join(compilerRoot, "include", "gbdk", "version.h")))) throw new SetupIoError("MISSING_PREREQUISITE", "Install the selected GBDK 4.5.0 component before building the official CLI.");
  const copiedCompiler = path.join(preparedPath, "buildTools", context.nativePlatform, "gbdk");
  await emptyPlaceholder(context, copiedCompiler);
  await context.io.copySetupTree(compilerRoot, copiedCompiler, context);

  const metadataFile = path.join(preparedPath, ...BUILD_METADATA_PATH.split("/"));
  const patched = patchArchiveBuildMetadata(await ownedText(context, metadataFile));
  // This patch shortens the source. Publish a complete replacement atomically;
  // an r+ write would leave stale trailing bytes behind the intended patch.
  const replacement = metadataFile + ".codex-setup-" + randomUUID();
  await assertOwnedPath(context.setupRoot, replacement, { allowMissing: true });
  await writeFile(replacement, patched.source, { flag: "wx", mode: 0o644 });
  checkSetupAbort(context.signal);
  await assertOwnedPath(context.setupRoot, metadataFile);
  if ((await context.io.setupSha256File(metadataFile)).sha256 !== patched.receipt.beforeSha256) throw new SetupIoError("SOURCE_PATCH_MISMATCH", "The pinned metadata source changed before its atomic replacement.");
  await rename(replacement, metadataFile);
  if ((await context.io.setupSha256File(metadataFile)).sha256 !== patched.receipt.afterSha256) throw new SetupIoError("SOURCE_PATCH_MISMATCH", "The written metadata patch does not match its recorded bytes.");
  const patches = [patched.receipt];
  if (context.platform === "win32") {
    const constantsPath = path.join(preparedPath, "src", "consts.ts");
    const before = await context.io.setupSha256File(await regular(context, constantsPath));
    await patchWindowsCliConstants(constantsPath, { platform: context.platform });
    patches.push({ path: "src/consts.ts", purpose: "Normalize Windows separators in the pinned CLI source root lookup", beforeSha256: before.sha256, afterSha256: (await context.io.setupSha256File(constantsPath)).sha256 });
  }

  const yarnSource = await fetched(context, SOURCE_RELEASES.yarn, "yarn-source");
  const yarnRoot = await soleDirectory(context, yarnSource.root, "package");
  const yarnExecutable = await regular(context, path.join(yarnRoot, "bin", "yarn.js"));
  if ((await context.io.setupSha256File(yarnExecutable)).sha256 !== SOURCE_RELEASES.yarn.executableSha256) throw new SetupIoError("CHECKSUM_MISMATCH", "Yarn executable differs from the upstream packageManager integrity pin.");
  await command(context, context.nodeExecutable, [yarnExecutable, "install", "--immutable"], { cwd: preparedPath, label: "Install the pinned official CLI build dependencies" });
  const electronDirectory = path.join(preparedPath, "node_modules", "electron");
  await assertOwnedPath(context.setupRoot, electronDirectory);
  const electronPath = path.join(electronDirectory, "path.txt");
  if (!(await present(electronPath))) await writeFile(electronPath, "electron", { flag: "wx", mode: 0o644 });
  else if ((await ownedText(context, electronPath, 1024)).trim() !== "electron") throw new SetupIoError("INVALID_COMPONENT", "Unexpected Electron path metadata in the new headless build tree.");
  const webpack = await regular(context, path.join(preparedPath, "node_modules", "webpack", "bin", "webpack.js"));
  await command(context, context.nodeExecutable, [webpack, "--config", "src/apps/gb-studio-cli/webpack.cli.config.js"], { cwd: preparedPath, env: { ...context.env, NO_TYPE_CHECKING: "1" }, label: "Compile the official GB Studio CLI" });
  const executable = await regular(context, path.join(preparedPath, "out", "cli", "gb-studio-cli.js"));
  const versionOutput = output(await command(context, context.nodeExecutable, [executable, "--version"], { label: "Verify the compiled official CLI" }));
  if (![DEPENDENCY_CATALOG.cli.installVersion, "v" + DEPENDENCY_CATALOG.cli.installVersion].includes(versionOutput)) throw new SetupIoError("INCOMPATIBLE_COMPONENT", "The compiled official CLI did not report the pinned version.", { detected: versionOutput });
  const provenance = { type: "official-source-archives", sourceCommit: DEPENDENCY_CATALOG.cli.commit, gbvmCommit: DEPENDENCY_CATALOG.cli.gbvmCommit, archives: [source.provenance, gbvmSource.provenance, yarnSource.provenance], buildMetadataPatches: patches, packageManager: sourcePackage.packageManager, dependencyLock: await context.io.setupSha256File(path.join(preparedPath, "yarn.lock")), gbdkVersion: DEPENDENCY_CATALOG.gbdk.installVersion, verification: ["Pinned archive SHA-256 values", "Yarn --immutable", "Compiled CLI --version"], desktopRequired: false };
  await writeSetupJson(context.setupRoot, path.join(preparedPath, ".codex-setup-source.json"), provenance);
  return { preparedPath, version: DEPENDENCY_CATALOG.cli.installVersion, provenance, files: [{ path: "out/cli/gb-studio-cli.js", ...await context.io.setupSha256File(executable) }] };
}

function inside(root, filename) { const relative = path.relative(root, filename); return relative === "" || (relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative)); }

/** Venv entrypoints may link to a managed Python; retain the venv invocation path. */
async function ownedPython(context, filename) {
  if (!path.isAbsolute(filename)) throw new SetupIoError("UNSAFE_PYTHON", "Python discovery did not return an absolute owned executable.");
  await assertOwnedPath(context.setupRoot, path.dirname(filename));
  const canonical = await realpath(filename);
  if (!inside(path.resolve(context.setupRoot), canonical)) throw new SetupIoError("UNSAFE_PYTHON", "Python discovery escaped the owned setup root.", { path: filename });
  await regular(context, canonical);
  return filename;
}

/** uv-generated hashes are retained per install, not misrepresented as catalog-wide pins. */
export function parseResolvedRequirements(source) {
  if (source.length > 512 * 1024) throw new SetupIoError("INVALID_REQUIREMENTS", "Resolved Python requirements exceed their limit.");
  const logical = source.replace(/\\\r?\n/gu, " ").split(/\r?\n/u).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  const seen = new Set();
  const packages = logical.map((line) => {
    const match = /^([A-Za-z0-9][A-Za-z0-9._-]*)==([A-Za-z0-9.+!-]+)((?:\s+--hash=sha256:[a-f0-9]{64})+)$/u.exec(line);
    if (!match) throw new SetupIoError("INVALID_REQUIREMENTS", "uv resolution contains a non-pinned, non-hashed, or non-registry requirement.");
    const name = match[1].toLowerCase().replace(/[_.]+/gu, "-");
    if (seen.has(name)) throw new SetupIoError("INVALID_REQUIREMENTS", "Resolved Python requirements contain duplicate distributions.");
    seen.add(name);
    return { name, version: match[2], allowedDistributionSha256: [...match[3].matchAll(/--hash=sha256:([a-f0-9]{64})/gu)].map((found) => found[1]) };
  });
  if (!packages.length || packages.length > 128) throw new SetupIoError("INVALID_REQUIREMENTS", "Resolved Python requirement count is invalid.");
  for (const [name, version] of [["pyboy", DEPENDENCY_CATALOG.pyboy.installVersion], ["pillow", DEPENDENCY_CATALOG.pillow.installVersion]]) if (!packages.some((entry) => entry.name === name && entry.version === version)) throw new SetupIoError("INCOMPATIBLE_COMPONENT", "Resolved Python requirements changed a selected dependency pin.", { name, version });
  return packages;
}

async function emulator(context) {
  if (!context.finalPath || !path.isAbsolute(context.finalPath)) throw new SetupIoError("MISSING_FINAL_PATH", "Python environments require a fresh final owned path; they cannot be promoted by renaming.");
  await assertOwnedPath(context.setupRoot, context.finalPath, { allowMissing: true });
  if (await present(context.finalPath)) throw new SetupIoError("DESTINATION_EXISTS", "The Python environment destination already exists. The setup owner must quarantine its known-owned failed attempt before retrying.", { path: context.finalPath });
  const uvExecutable = await regular(context, path.join(context.setupRoot, "uv", context.nativePlatform, context.platform === "win32" ? "uv.exe" : "uv"));
  const uvVersion = output(await command(context, uvExecutable, ["--version"], { label: "Verify the owned uv installer" }));
  if (!uvVersion.startsWith("uv " + DEPENDENCY_CATALOG.uv.installVersion + " ") && uvVersion !== "uv " + DEPENDENCY_CATALOG.uv.installVersion) throw new SetupIoError("INCOMPATIBLE_COMPONENT", "Install the pinned uv component before the direct-play emulator.");
  const common = ["--no-config"];
  const managedInstall = ["python", "install", "--no-bin", "--no-registry", DEPENDENCY_CATALOG.python.installVersion];
  await command(context, uvExecutable, [...common, ...managedInstall], { label: "Install the selected managed CPython" });
  // setupEnvironment already sets UV_PYTHON_PREFERENCE=only-managed. uv rejects
  // combining that explicit preference with its redundant --managed-python flag.
  const discovered = output(await command(context, uvExecutable, [...common, "python", "find", "--no-project", "--no-python-downloads", DEPENDENCY_CATALOG.python.installVersion], { label: "Locate the selected managed CPython" }));
  if (discovered.includes("\n") || !inside(path.join(context.setupRoot, "python"), discovered)) throw new SetupIoError("UNSAFE_PYTHON", "uv did not select Python from the explicitly owned managed installation.");
  const managedPython = await ownedPython(context, discovered);
  const pythonVersion = output(await command(context, managedPython, ["-I", "-c", "import platform; print(platform.python_version())"], { label: "Verify the selected CPython version" }));
  if (pythonVersion !== DEPENDENCY_CATALOG.python.installVersion) throw new SetupIoError("INCOMPATIBLE_COMPONENT", "The managed Python does not report its selected version.", { expected: DEPENDENCY_CATALOG.python.installVersion, detected: pythonVersion });

  const input = path.join(context.stageRoot, "emulator-requirements.in");
  const resolved = path.join(context.stageRoot, "emulator-requirements.txt");
  await writeFile(input, `pyboy==${DEPENDENCY_CATALOG.pyboy.installVersion}\npillow==${DEPENDENCY_CATALOG.pillow.installVersion}\n`, { flag: "wx", mode: 0o600 });
  const registry = ["--default-index", "https://pypi.org/simple", "--only-binary", ":all:", "--no-sources", "--no-python-downloads"];
  await command(context, uvExecutable, [...common, "pip", "compile", input, "--python", managedPython, "--generate-hashes", "--no-header", "--no-annotate", "--output-file", resolved, ...registry], { label: "Resolve and hash the selected emulator wheels" });
  const requirements = await ownedText(context, resolved, 512 * 1024);
  const packages = parseResolvedRequirements(requirements);
  await ensureOwnedDirectory(context.setupRoot, path.dirname(context.finalPath));
  await command(context, uvExecutable, [...common, "venv", "--no-project", "--no-python-downloads", "--python", managedPython, context.finalPath], { label: "Create the final-path direct-play environment" });
  await assertOwnedPath(context.setupRoot, context.finalPath);
  const pythonExecutable = await ownedPython(context, path.join(context.finalPath, context.platform === "win32" ? "Scripts" : "bin", context.platform === "win32" ? "python.exe" : "python"));
  await command(context, uvExecutable, [...common, "pip", "install", "--python", pythonExecutable, "--require-hashes", "--requirements", resolved, ...registry], { label: "Install the verified emulator wheels" });
  const probe = "import importlib.metadata as m,json,platform,sys; import pyboy; from PIL import Image; print(json.dumps({'python':platform.python_version(),'pyboy':m.version('pyboy'),'pillow':m.version('pillow'),'prefix':sys.prefix,'basePrefix':sys.base_prefix,'distributions':sorted([{'name':d.metadata['Name'],'version':d.version} for d in m.distributions()],key=lambda d:d['name'].lower())}))";
  let detected;
  try { detected = JSON.parse(output(await command(context, pythonExecutable, ["-I", "-c", probe], { label: "Verify direct-play Python imports" }))); }
  catch (error) {
    // In particular, do not hide unconfirmed process cleanup from the lock owner.
    if (error instanceof SetupIoError) throw error;
    throw new SetupIoError("COMPONENT_PROBE_FAILED", "The new direct-play environment did not return its Python/import readiness report.", { path: context.finalPath }, error);
  }
  if (detected.python !== DEPENDENCY_CATALOG.python.installVersion || detected.pyboy !== DEPENDENCY_CATALOG.pyboy.installVersion || detected.pillow !== DEPENDENCY_CATALOG.pillow.installVersion || path.resolve(detected.prefix ?? "") !== path.resolve(context.finalPath) || detected.prefix === detected.basePrefix || !Array.isArray(detected.distributions)) throw new SetupIoError("INCOMPATIBLE_COMPONENT", "The new Python environment does not match its selected versions or final path.", { detected, finalPath: context.finalPath });
  const installed = new Map(detected.distributions.map((entry) => [String(entry.name).toLowerCase().replace(/[_.]+/gu, "-"), entry.version]));
  if (installed.size !== packages.length || packages.some((entry) => installed.get(entry.name) !== entry.version)) throw new SetupIoError("INCOMPATIBLE_COMPONENT", "Installed emulator distributions disagree with the verified requirements lock.");
  const retainedRequirements = path.join(context.finalPath, ".codex-setup-requirements.txt");
  await writeFile(retainedRequirements, requirements, { flag: "wx", mode: 0o600 });
  const provenance = { type: "uv-managed-python-and-pypi-wheels", uvVersion: DEPENDENCY_CATALOG.uv.installVersion, uv: await context.io.setupSha256File(uvExecutable), pythonVersion, managedPython, pythonExecutableSha256: (await context.io.setupSha256File(await realpath(managedPython))).sha256, registry: "https://pypi.org/simple", pyboyVersion: detected.pyboy, pillowVersion: detected.pillow, requirementsSha256: hash(requirements), resolvedPackages: packages, wheelPolicy: "Prebuilt wheels only; per-install resolved distribution hashes, not globally pre-pinned transitives or proof of one selected wheel archive", verification: ["Pinned managed Python version", "Hash-required wheel installation", "Python/PyBoy/Pillow imports and environment prefix"], nonRelocatable: true };
  await writeSetupJson(context.setupRoot, path.join(context.finalPath, ".codex-setup-emulator.json"), provenance);
  return { preparedPath: context.finalPath, promotion: "already-final", version: DEPENDENCY_CATALOG.pyboy.installVersion, provenance, files: [{ path: ".codex-setup-requirements.txt", sha256: hash(requirements), bytes: Buffer.byteLength(requirements) }] };
}

async function findApplication(context, directory, name, depth = 0) {
  if (depth > 4) return undefined;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const candidate = path.join(directory, entry.name);
    await assertOwnedPath(context.setupRoot, candidate);
    if (name(entry)) return candidate;
    if (entry.isDirectory()) { const nested = await findApplication(context, candidate, name, depth + 1); if (nested) return nested; }
  }
  return undefined;
}

async function desktop(context) {
  const release = DESKTOP_RELEASES[context.nativePlatform];
  const downloaded = await context.io.downloadArchive(release, context);
  const provenance = { type: "optional-official-desktop-release", ...releaseEvidence(downloaded, release), launched: false, operatingSystemRegistered: false };
  if (context.platform === "linux") {
    const preparedPath = path.join(context.stageRoot, release.archive);
    await context.io.copySetupTree(downloaded.path, preparedPath, context);
    await makeSetupExecutable(context.setupRoot, preparedPath);
    return { preparedPath, version: release.version, provenance, status: "prepared-not-launched", nextSteps: ["Launch this optional AppImage explicitly when needed; system FUSE/desktop integration was not installed or tested."] };
  }
  const extracted = path.join(context.stageRoot, "desktop-release");
  try { await context.io.extractArchive(downloaded.path, extracted, context, { format: "zip" }); }
  catch (error) {
    if (context.platform !== "darwin" || error.code !== "UNSUPPORTED_ARCHIVE_LINK") throw error;
    return { preparedPath: downloaded.path, promotion: "manual", status: "downloaded-not-installed", version: release.version, provenance, ready: false, nextSteps: ["The authenticated macOS desktop archive contains application framework links. Extract the verified ZIP with the operating system into an application location you explicitly choose; setup did not extract, register, or launch the desktop editor."] };
  }
  const application = context.platform === "darwin"
    ? await findApplication(context, extracted, (entry) => entry.isDirectory() && entry.name === "GB Studio.app")
    : await findApplication(context, extracted, (entry) => entry.isFile() && ["gb-studio.exe", "gb studio.exe"].includes(entry.name.toLowerCase()));
  if (!application) throw new SetupIoError("INVALID_COMPONENT", "The optional official archive does not contain its expected desktop application.");
  return { preparedPath: context.platform === "darwin" ? application : path.dirname(application), version: release.version, provenance, status: "prepared-not-launched", nextSteps: ["The desktop editor is optional and has not been launched or registered with the operating system."] };
}

/** Parent supplies a fresh stageRoot under its marked, locked setupRoot. */
export async function installComponent(id, options) {
  if (!componentIds.has(id)) throw new SetupIoError("UNKNOWN_COMPONENT", "Unknown setup component: " + id);
  checkSetupAbort(options.signal);
  const context = { ...options, platform: options.platform ?? process.platform, arch: options.arch ?? process.arch };
  context.nativePlatform = context.platform + "-" + context.arch;
  if (!GBDK_RELEASES[context.nativePlatform] || !UV_RELEASES[context.nativePlatform]) throw new SetupIoError("UNSUPPORTED_PLATFORM", "Packaged component setup does not support this platform/architecture.", { platform: context.nativePlatform });
  for (const name of ["setupRoot", "stageRoot", "toolchainRoot", "nodeExecutable"]) if (typeof context[name] !== "string" || !path.isAbsolute(context[name])) throw new SetupIoError("INVALID_CONTEXT", "Component setup requires an explicit absolute " + name + ".");
  await assertOwnedPath(context.setupRoot, context.stageRoot);
  if (!(await lstat(context.stageRoot)).isDirectory() || (await readdir(context.stageRoot)).length) throw new SetupIoError("DESTINATION_EXISTS", "Component setup requires fresh empty caller-owned staging.", { path: context.stageRoot });
  await assertOwnedPath(context.setupRoot, context.toolchainRoot, { allowMissing: true });
  context.io = { downloadArchive, extractArchive, copySetupTree, runSetupCommand, setupSha256File, ...options.io };
  context.env = await setupEnvironment(context);
  context.onProgress?.({ phase: "component-prepare", component: id, platform: context.nativePlatform });
  try { return await ({ gbdk, cli, uv, emulator, desktop })[id](context); }
  catch (error) {
    if (error instanceof SetupIoError) { error.details = { ...error.details, component: id, stageRoot: context.stageRoot, ...(id === "emulator" ? { finalPath: context.finalPath, nonRelocatable: true } : {}) }; throw error; }
    throw new SetupIoError(error.code ?? "COMPONENT_INSTALL_FAILED", error.message ?? "Component setup failed.", { component: id, stageRoot: context.stageRoot, ...(id === "emulator" ? { finalPath: context.finalPath, nonRelocatable: true } : {}) }, error);
  }
}
