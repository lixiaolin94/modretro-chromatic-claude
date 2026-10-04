#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, readdir, realpath, rename, rmdir, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEPENDENCY_CATALOG, DESKTOP_RELEASES, GBDK_RELEASES, SOURCE_RELEASES, SUPPORTED_SETUP_PLATFORMS, UV_RELEASES } from "./dependency-catalog.mjs";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Keep the existing ownership schema so explicitly selected legacy roots remain reusable.
const OWNER = "codex-gb-studio-setup";
const MARKER = ".gb-studio-setup.json";
const GROUPS = ["runtime", "build", "emulator", "desktop"];
const PROBES = ["cli-version", "gbdk-version", "emulator-import"];
const DEFAULT_COMPONENTS = ["runtime", "build", "emulator"];
const MAX_JSON_BYTES = 1024 * 1024;

function usageError(message) {
  return Object.assign(new Error(message), { code: "SETUP_USAGE", exitCode: 2 });
}

function csv(value, allowed, flag) {
  const values = value.split(",");
  if (!values.length || values.some((entry) => !allowed.includes(entry)) || new Set(values).size !== values.length) {
    throw usageError(`${flag} must contain distinct values from ${allowed.join(", ")}.`);
  }
  return values;
}

export function parseSetupArguments(argv) {
  const result = { command: "doctor", components: [...DEFAULT_COMPONENTS], probes: [], json: false, yes: false, dryRun: false, help: false };
  const seen = new Set();
  let index = 0;
  if (argv[0] && !argv[0].startsWith("-")) {
    if (!["doctor", "plan", "apply"].includes(argv[0])) throw usageError(`Unknown setup command: ${argv[0]}`);
    result.command = argv[index++];
  }
  const originalCommand = result.command;
  for (; index < argv.length; index++) {
    const flag = argv[index] === "-h" ? "--help" : argv[index];
    if (seen.has(flag)) throw usageError(`Duplicate setup option: ${flag}`);
    seen.add(flag);
    if (["--root", "--components", "--probes"].includes(flag)) {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw usageError(`Missing value for ${flag}.`);
      if (flag === "--root") {
        if (!path.isAbsolute(value)) throw usageError("--root must be an absolute dependency root.");
        result.root = path.resolve(value);
      } else if (flag === "--components") result.components = csv(value, GROUPS, flag);
      else result.probes = csv(value, PROBES, flag);
    } else if (flag === "--json") result.json = true;
    else if (flag === "--yes") result.yes = true;
    else if (flag === "--dry-run") result.dryRun = true;
    else if (["--help", "-h"].includes(flag)) result.help = true;
    else throw usageError(`Unknown setup option: ${flag}`);
  }
  if (result.dryRun) result.command = "plan";
  if (result.probes.length && result.command !== "doctor") throw usageError("--probes is only supported by doctor, never plan or dry-run.");
  if (result.yes && originalCommand !== "apply") throw usageError("--yes is only supported by apply.");
  return result;
}

export function defaultSetupRoot(environment = process.env, platform = process.platform) {
  const configured = environment.GB_STUDIO_SETUP_ROOT;
  if (configured) {
    if (!path.isAbsolute(configured)) throw usageError("GB_STUDIO_SETUP_ROOT must be absolute.");
    return path.resolve(configured);
  }
  const parent = platform === "win32" ? environment.LOCALAPPDATA
    : platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support")
      : environment.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  if (!parent || !path.isAbsolute(parent)) throw usageError("A per-user data directory is unavailable; supply --root with an absolute owned directory.");
  return path.join(parent, "modretro-chromatic");
}

function within(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

async function info(candidate) {
  try { return await lstat(candidate); }
  catch (error) { if (error.code === "ENOENT") return undefined; throw error; }
}

async function jsonFile(filename) {
  const metadata = await info(filename);
  if (!metadata) return undefined;
  if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_JSON_BYTES) throw new Error(`Expected a bounded regular JSON file: ${filename}`);
  const value = JSON.parse(await readFile(filename, "utf8"));
  if (!value || Array.isArray(value) || typeof value !== "object") throw new Error(`Expected a JSON object: ${filename}`);
  return value;
}

async function noLinks(candidate) {
  const absolute = path.resolve(candidate);
  let current = path.parse(absolute).root;
  for (const part of absolute.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const metadata = await info(current);
    if (!metadata) break;
    if (metadata.isSymbolicLink()) throw new Error(`Setup paths must not traverse symbolic links or junctions: ${current}`);
  }
}

export async function validateSetupRoot(root, packageRoot = PACKAGE_ROOT) {
  if (!path.isAbsolute(root) || path.dirname(root) === root) throw new Error("Select a dedicated absolute dependency directory, not a filesystem root.");
  const requested = path.resolve(root);
  await noLinks(requested);
  let ancestor = requested;
  const missingParts = [];
  while (!await info(ancestor)) { missingParts.unshift(path.basename(ancestor)); ancestor = path.dirname(ancestor); }
  const selected = path.join(await realpath(ancestor), ...missingParts);
  const source = await realpath(packageRoot);
  if (within(source, selected) || within(selected, source) || /[/\\]\.(?:codex|agents)[/\\]plugins[/\\]cache(?:[/\\]|$)/iu.test(selected)) {
    throw new Error("Dependencies must stay outside the plugin source and immutable cache; select a separate owned --root.");
  }
  await noLinks(selected);
  const metadata = await info(selected);
  if (metadata && !metadata.isDirectory()) throw new Error(`The setup root is not a directory: ${selected}`);
  const marker = await jsonFile(path.join(selected, MARKER));
  if (marker && (marker.schemaVersion !== 1 || marker.owner !== OWNER)) throw new Error("This dependency root belongs to another installer.");
  if (metadata && !marker && (await readdir(selected)).length) {
    throw new Error("Refusing a nonempty unowned dependency root. Use a new empty --root; existing toolchains are not adopted or replaced.");
  }
  return { root: selected, owned: Boolean(marker), exists: Boolean(metadata) };
}

async function atomicJson(filename, value) {
  await noLinks(path.dirname(filename));
  const previous = await info(filename);
  if (previous && (!previous.isFile() || previous.isSymbolicLink())) throw new Error(`Refusing a redirected setup record: ${filename}`);
  const temporary = `${filename}.partial-${randomUUID()}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
  await rename(temporary, filename);
}

async function ownRoot(root, packageRoot) {
  const validation = await validateSetupRoot(root, packageRoot);
  if (!validation.exists) await mkdir(root, { recursive: true, mode: 0o700 });
  await noLinks(root);
  if (!validation.owned) await writeFile(path.join(root, MARKER), `${JSON.stringify({ schemaVersion: 1, owner: OWNER })}\n`, { flag: "wx", mode: 0o600 });
}

export async function acquireSetupLock(root, runId = randomUUID()) {
  const directory = path.join(root, ".setup-lock");
  try { await mkdir(directory, { mode: 0o700 }); }
  catch (error) {
    if (error.code !== "EEXIST") throw error;
    const owner = await jsonFile(path.join(directory, "owner.json"));
    throw Object.assign(new Error(`Another setup owns ${directory}. Do not delete a live lock. If its recorded process has ended, preserve/move this lock directory before retrying.`), { code: "SETUP_LOCKED", lockOwner: owner ?? null, lockPath: directory });
  }
  const owner = { schemaVersion: 1, owner: OWNER, pid: process.pid, startedAt: new Date().toISOString(), runId, phase: "dependencies" };
  try { await writeFile(path.join(directory, "owner.json"), `${JSON.stringify(owner)}\n`, { flag: "wx", mode: 0o600 }); }
  catch (error) { await rmdir(directory).catch(() => {}); throw error; }
  return async () => {
    const actual = await jsonFile(path.join(directory, "owner.json"));
    const entries = await readdir(directory);
    if (actual?.runId !== runId || actual?.pid !== process.pid || entries.length !== 1 || entries[0] !== "owner.json") throw new Error("Setup lock changed; it was preserved instead of removing another owner's state.");
    await unlink(path.join(directory, "owner.json"));
    await rmdir(directory);
  };
}

function componentOrder(groups) {
  const result = [];
  if (groups.includes("runtime")) result.push("runtime");
  if (groups.includes("build")) result.push("gbdk", "cli");
  if (groups.includes("emulator")) result.push("uv", "emulator");
  if (groups.includes("desktop")) result.push("desktop");
  return result;
}

function tasksFor(groups) {
  return [groups.includes("runtime") && "authoring", groups.includes("build") && "projectBuild", groups.includes("emulator") && "play", groups.includes("desktop") && "desktop"].filter(Boolean);
}

function componentIds(id) { return id === "emulator" ? ["python", "pyboy", "pillow"] : [id]; }
function metadataReady(report, id) { return componentIds(id).every((name) => report.components.some((entry) => entry.id === name && entry.status === "ready")); }

function destinations(root, platform, arch) {
  const toolchain = path.join(root, "toolchain", ".local");
  const target = `${platform}-${arch}`;
  return {
    runtime: path.join(root, "runtime"), gbdk: path.join(toolchain, "gbdk"), cli: path.join(toolchain, "vendor", "gb-studio"),
    uv: path.join(root, "uv", target), emulator: path.join(toolchain, "pyboy-venv"),
    desktop: path.join(toolchain, "apps", platform === "darwin" ? "GB Studio.app" : platform === "win32" ? "GB Studio" : DESKTOP_RELEASES[target]?.archive ?? "GB Studio"),
  };
}

function sourcesFor(id, target) {
  if (id === "gbdk") return [GBDK_RELEASES[target]].filter(Boolean);
  if (id === "cli") return Object.values(SOURCE_RELEASES);
  if (id === "uv") return [UV_RELEASES[target]].filter(Boolean);
  if (id === "desktop") return [DESKTOP_RELEASES[target]].filter(Boolean);
  if (id === "runtime") return [{ source: "This compiled plugin distribution and its reviewed public npm lock", registry: "https://registry.npmjs.org", lifecycleScripts: false }];
  return [{ source: DEPENDENCY_CATALOG.python.source, version: DEPENDENCY_CATALOG.python.installVersion }, { source: "https://pypi.org/simple", packages: [`pyboy==${DEPENDENCY_CATALOG.pyboy.installVersion}`, `pillow==${DEPENDENCY_CATALOG.pillow.installVersion}`] }];
}

export async function planSetup(options = {}) {
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  const environment = options.environment ?? process.env;
  let root = path.resolve(options.root ?? defaultSetupRoot(environment, platform));
  const packageRoot = options.packageRoot ?? PACKAGE_ROOT;
  const bundled = (await jsonFile(path.join(packageRoot, "package.json")))?.bundledMcp === true;
  const requested = options.components ?? DEFAULT_COMPONENTS;
  const groups = bundled ? requested.filter((entry) => entry !== "runtime") : requested;
  if ((!groups.length && !bundled) || groups.some((entry) => !GROUPS.includes(entry)) || new Set(groups).size !== groups.length) throw usageError("Invalid setup components.");
  let rootIssue;
  try { root = (await validateSetupRoot(root, packageRoot)).root; } catch (error) { rootIssue = error.message; }
  let lock;
  if (!rootIssue && await info(path.join(root, ".setup-lock"))) {
    await noLinks(path.join(root, ".setup-lock"));
    lock = { path: path.join(root, ".setup-lock"), owner: await jsonFile(path.join(root, ".setup-lock", "owner.json")) ?? null, automaticRecovery: false };
    rootIssue = "An installer lock exists. Inspect its recorded owner; do not retry or remove a live lock.";
  }
  const { detectDependencies } = await import("./dependency-doctor.mjs");
  const report = await (options.detect ?? detectDependencies)({ packageRoot, setupRoot: root, runtimeRoot: bundled ? packageRoot : path.join(root, "runtime"), toolchainRoot: path.join(root, "toolchain"), pythonPath: path.join(root, "toolchain", ".local", "pyboy-venv", platform === "win32" ? "Scripts" : "bin", platform === "win32" ? "python.exe" : "python"), environment, platform, arch, requestedTasks: tasksFor(groups) });
  const target = `${platform}-${arch}`;
  const targets = destinations(root, platform, arch);
  const supported = SUPPORTED_SETUP_PLATFORMS.includes(target);
  const components = componentOrder(groups).map((id) => {
    const ready = id === "uv" && metadataReady(report, "emulator") ? true : metadataReady(report, id);
    return { id, action: ready ? "reuse-after-check" : "install-or-repair", destination: targets[id], version: id === "runtime" ? report.components.find((entry) => entry.id === "runtime")?.requiredVersion : id === "emulator" ? `Python ${DEPENDENCY_CATALOG.python.installVersion}; PyBoy ${DEPENDENCY_CATALOG.pyboy.installVersion}; Pillow ${DEPENDENCY_CATALOG.pillow.installVersion}` : DEPENDENCY_CATALOG[id].installVersion, sources: sourcesFor(id, target) };
  });
  return {
    schemaVersion: 1, mode: "plan", passive: true, platform: target, supported,
    root, bundledRuntime: bundled, roots: report.roots, components, requestedComponents: [...groups], report,
    canApply: supported && !rootIssue, ...(rootIssue ? { rootIssue } : {}), ...(lock ? { lock } : {}),
    writes: [bundled ? "Only the selected owned dependency root: downloads, caches, staging, component receipts and toolchain. The installed plugin is unchanged." : "Only the selected owned root: downloads, caches, staging, component receipts, runtime, toolchain and a separately prepared plugin payload"],
    consentRequired: true, activation: "not-selected",
    nextSteps: [rootIssue || (!supported ? "This platform has no packaged installer; no changes will be attempted." : "Review versions, sources and destinations, then run apply with --yes for these components."), "Doctor metadata checks do not execute a compiler or import emulator packages. Explicit apply verifies tools and may download/build dependencies.", "Installation into Codex, plugin refresh, PATH/profile edits, desktop launch and access changes are separate actions."],
  };
}

async function hashFile(filename) {
  const metadata = await lstat(filename);
  if (!metadata.isFile() && !metadata.isSymbolicLink()) throw new Error(`Expected a regular component file: ${filename}`);
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of createReadStream(filename)) {
    size += chunk.length;
    if (size > 512 * 1024 * 1024) throw new Error("Component identity file is oversized.");
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function sourceIdentity(packageRoot) {
  const { inspectRuntimeSource } = await import("./setup-runtime.mjs");
  return inspectRuntimeSource({ packageRoot });
}

function primaryFile(id, destination, platform) {
  return path.join(destination, ...(id === "runtime" ? ["dist", "server.js"] : id === "cli" ? ["out", "cli", "gb-studio-cli.js"] : id === "gbdk" ? ["bin", platform === "win32" ? "lcc.exe" : "lcc"] : id === "emulator" ? [platform === "win32" ? "Scripts" : "bin", platform === "win32" ? "python.exe" : "python"] : [platform === "win32" ? "uv.exe" : "uv"]));
}

/** Probe failures may be returned reports, not thrown subprocess errors. */
function assertProbeCleanup(checked) {
  const unconfirmed = (checked.probeResults ?? []).filter((result) => result.exitObserved === false);
  if (!unconfirmed.length) return;
  const first = unconfirmed[0];
  throw Object.assign(new Error("A dependency probe did not confirm owned subprocess cleanup. Do not repair or retry until process-tree exit is confirmed."), {
    code: "PROBE_CLEANUP_UNCONFIRMED",
    details: {
      exitObserved: false,
      ...(typeof first.leaderExitObserved === "boolean" ? { leaderExitObserved: first.leaderExitObserved } : {}),
      ...(Number.isSafeInteger(first.pid) ? { pid: first.pid } : {}),
      cleanupErrors: unconfirmed.flatMap((result) => result.cleanupErrors ?? []),
      stdout: unconfirmed.map((result) => result.output ?? "").join("\n"),
      stderr: unconfirmed.map((result) => result.error ?? "").join("\n"),
    },
  });
}

function serializedError(error) {
  let execution;
  const recovery = {};
  let current = error;
  for (let depth = 0; current && depth < 5; depth++, current = current.cause) {
    const details = current.details;
    if (details && typeof details === "object") {
      // Download/storage recovery is independent of subprocess cleanup. Keep
      // explicit bounded diagnostics without serializing arbitrary error data.
      for (const name of ["source", "path", "partialPath", "cachePath", "expected", "actual"]) {
        if (recovery[name] === undefined && typeof details[name] === "string") recovery[name] = details[name].slice(0, 4096);
      }
      for (const name of ["attempt", "timeoutMs"]) {
        if (recovery[name] === undefined && Number.isSafeInteger(details[name])) recovery[name] = details[name];
      }
      for (const name of ["quarantineConfirmed", "retryStopped"]) {
        if (recovery[name] === undefined && typeof details[name] === "boolean") recovery[name] = details[name];
      }
      if (recovery.quarantineError === undefined && details.quarantineError && typeof details.quarantineError === "object") {
        recovery.quarantineError = {
          code: String(details.quarantineError.code ?? "UNKNOWN").slice(0, 128),
          message: String(details.quarantineError.message ?? "Quarantine failed").slice(0, 1024),
        };
      }
      for (const name of ["quarantined", "cleanupErrors"]) {
        if (recovery[name] === undefined && Array.isArray(details[name]) && typeof details.exitObserved !== "boolean") {
          recovery[name] = details[name].slice(0, 8).map((entry) => String(entry).slice(0, 1024));
        }
      }
    }
    if (details && typeof details.exitObserved === "boolean") {
      execution = { exitObserved: details.exitObserved, ...(typeof details.leaderExitObserved === "boolean" ? { leaderExitObserved: details.leaderExitObserved } : {}), pid: details.pid, exitCode: details.exitCode,
        cleanupErrors: Array.isArray(details.cleanupErrors) ? details.cleanupErrors.slice(0, 8).map((entry) => String(entry).slice(0, 1024)) : [],
        stdoutTail: String(details.stdout ?? "").slice(-8192), stderrTail: String(details.stderr ?? "").slice(-8192) };
      break;
    }
  }
  return { message: String(error?.message ?? error).slice(0, 8192), ...(error?.code ? { code: error.code } : {}), ...(error?.phase ? { phase: error.phase } : {}), ...(Object.keys(recovery).length ? { details: recovery } : {}), ...(execution ? { execution } : {}) };
}

export async function applySetup(options = {}) {
  if (options.yes !== true) throw usageError("No changes made. Review plan, then explicitly authorize downloads and changes with apply --yes.");
  if (options.dryRun) return planSetup(options);
  const plan = await planSetup(options);
  if (!plan.canApply) throw Object.assign(new Error(plan.rootIssue ?? "Unsupported setup platform."), { code: "SETUP_PREFLIGHT", plan });
  if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Use the packaged shell/PowerShell bootstrap to install a supported Node runtime first.");
  const packageRoot = options.packageRoot ?? PACKAGE_ROOT;
  const platform = options.platform ?? process.platform;
  const arch = options.arch ?? process.arch;
  if (platform !== process.platform || arch !== process.arch) {
    if (!options.installComponent) throw new Error("Cross-platform installation is unsupported; platform overrides are for isolated fixture adapters only.");
  }
  const root = plan.root;
  await ownRoot(root, packageRoot);
  const runId = randomUUID();
  const release = await acquireSetupLock(root, runId);
  const run = { schemaVersion: 1, owner: OWNER, runId, platform: plan.platform, startedAt: new Date().toISOString(), status: "running", root, selectedComponents: plan.requestedComponents, components: [], activation: "not-selected" };
  const onProgress = options.onProgress ?? (() => {});
  const signal = options.signal;
  const receiptRoot = path.join(root, "receipts");
  const targets = destinations(root, platform, arch);
  const cancelled = () => signal?.aborted;
  try {
    for (const directory of [receiptRoot, path.join(root, "runs"), path.join(root, "staging"), path.join(root, "quarantine"), path.join(root, "toolchain", ".local")]) {
      await noLinks(directory);
      await mkdir(directory, { recursive: true, mode: 0o700 });
    }
    const identity = plan.requestedComponents.includes("runtime") ? await sourceIdentity(packageRoot) : undefined;
    const { detectDependencies, probeDependencies } = await import("./dependency-doctor.mjs");
    const detect = options.detect ?? detectDependencies;
    const probe = options.probe ?? probeDependencies;
    const reportOptions = { packageRoot, setupRoot: root, runtimeRoot: plan.bundledRuntime ? packageRoot : targets.runtime, toolchainRoot: path.join(root, "toolchain"), pythonPath: primaryFile("emulator", targets.emulator, platform), environment: options.environment ?? process.env, platform, arch, requestedTasks: tasksFor(plan.requestedComponents) };
    const persist = async () => {
      await atomicJson(path.join(root, "runs", `${runId}.json`), run);
      await atomicJson(path.join(root, "last-run.json"), run);
    };
    await persist();
    for (const component of plan.components) {
      const id = component.id;
      if (cancelled() || run.unsafeToRetry) { run.components.push({ id, status: "not-run", reason: run.unsafeToRetry ? "Owned process exit is unconfirmed" : "cancelled" }); continue; }
      const prerequisite = id === "cli" ? "gbdk" : id === "emulator" ? "uv" : undefined;
      if (prerequisite && run.components.some((item) => item.id === prerequisite && ["failed", "blocked", "cancelled"].includes(item.status))) {
        run.components.push({ id, status: "blocked", reason: `${prerequisite} did not become ready` });
        await persist(); continue;
      }
      const entry = { id, destination: targets[id], startedAt: new Date().toISOString(), status: "checking" };
      run.components.push(entry);
      onProgress({ phase: id, message: `Checking ${id}` });
      const receiptPath = path.join(receiptRoot, `${id}.json`);
      let prior;
      try {
        await noLinks(targets[id]);
        prior = await jsonFile(receiptPath);
        if (prior && (prior.owner !== OWNER || prior.id !== id || prior.destination !== targets[id])) throw new Error(`Invalid ${id} ownership receipt; it was not replaced.`);
        let report = await detect(reportOptions);
        // A healthy existing emulator needs no installer-only uv installation.
        if (id === "uv" && metadataReady(report, "emulator")) {
          const checked = await probe(report, { probes: ["emulator-import"], signal });
          entry.probes = checked.probeResults;
          assertProbeCleanup(checked);
          if (checked.probesPassed) {
            Object.assign(entry, { status: "not-needed", reason: "Existing emulator import check passed" });
            await persist(); continue;
          }
        }
        let ready = metadataReady(report, id);
        if (ready && id === "runtime") {
          ready = prior?.status === "ready" && prior.sourceIdentity === identity;
          if (ready) {
            const { verifyPreparedRuntime } = await import("./setup-runtime.mjs");
            try { await verifyPreparedRuntime({ runtimeRoot: targets.runtime, provenance: prior.provenance }); }
            catch (error) { ready = false; entry.repairReason = error.message; }
          }
        }
        if (ready && prior?.primarySha256 && id !== "desktop") {
          ready = await hashFile(primaryFile(id, targets[id], platform)).then((hash) => hash === prior.primarySha256, () => false);
        }
        const namedProbe = id === "cli" ? "cli-version" : id === "gbdk" ? "gbdk-version" : id === "emulator" ? "emulator-import" : undefined;
        if (ready && namedProbe) {
          const checked = await probe(report, { probes: [namedProbe], signal });
          entry.probes = checked.probeResults;
          assertProbeCleanup(checked);
          ready = checked.probesPassed === true;
        }
        if (ready) {
          Object.assign(entry, { status: "reused", evidence: namedProbe ? "metadata-and-explicit-probe" : "compatible-metadata-and-receipt" });
          await persist(); continue;
        }
        if (cancelled()) throw Object.assign(new Error("Setup cancelled before installation."), { code: "ABORT_ERR" });
        if (await info(targets[id])) {
          if (!prior?.ownedDestination) throw new Error(`Refusing to repair an unowned occupied component: ${targets[id]}. Preserve it and select a new root.`);
          const quarantine = path.join(root, "quarantine", `${id}-${runId}`);
          await rename(targets[id], quarantine);
          entry.preservedPrevious = quarantine;
        }
        const stageRoot = path.join(root, "staging", `${id}-${runId}`);
        await mkdir(stageRoot, { mode: 0o700 });
        const intent = { schemaVersion: 1, owner: OWNER, id, destination: targets[id], stageRoot, runId, ownedDestination: true, status: "installing", sourceIdentity: id === "runtime" ? identity : undefined };
        await atomicJson(receiptPath, intent);
        Object.assign(entry, { status: "installing", stageRoot });
        await persist();
        onProgress({ phase: id, message: `Preparing ${id} in the selected dependency root` });
        const context = { packageRoot, setupRoot: root, toolchainRoot: path.join(root, "toolchain"), nodeExecutable: process.execPath, stageRoot, finalPath: targets[id], environment: options.environment ?? process.env, platform, arch, signal, onProgress };
        let prepared;
        if (options.installComponent) prepared = await options.installComponent(id, context);
        else if (id === "runtime") {
          const { prepareRuntime } = await import("./setup-runtime.mjs");
          const result = await prepareRuntime({ ...context, runtimeRoot: path.join(stageRoot, "runtime") });
          prepared = { preparedPath: result.runtimeRoot, version: result.packageVersion, provenance: result };
        } else {
          const { installComponent } = await import("./setup-components.mjs");
          prepared = await installComponent(id, context);
        }
        if (cancelled()) throw Object.assign(new Error("Setup cancelled after component preparation; retained staging is recorded."), { code: "ABORT_ERR" });
        if (!prepared || typeof prepared.preparedPath !== "string" || !within(root, prepared.preparedPath)) throw new Error("Installer returned a path outside its owned dependency root.");
        if (prepared.promotion === "manual" || prepared.status === "downloaded-not-installed") {
          Object.assign(entry, { status: "manual-step-required", preparedPath: prepared.preparedPath, nextSteps: prepared.nextSteps ?? ["Extract the verified optional desktop archive using the operating system. The editor was not launched."] });
          await atomicJson(receiptPath, { ...intent, status: "downloaded-not-installed", provenance: prepared.provenance, preparedPath: prepared.preparedPath });
          await persist(); continue;
        }
        if (prepared.promotion === "already-final") {
          if (prepared.preparedPath !== targets[id] || id !== "emulator") throw new Error("Unexpected non-relocatable component result.");
        } else {
          if (!within(stageRoot, prepared.preparedPath)) throw new Error("Prepared component must belong to this operation's staging directory.");
          await noLinks(path.dirname(targets[id]));
          await mkdir(path.dirname(targets[id]), { recursive: true, mode: 0o700 });
          if (await info(targets[id])) throw new Error("Component destination appeared during setup; it was preserved.");
          await rename(prepared.preparedPath, targets[id]);
        }
        if (id === "runtime") {
          const { verifyPreparedRuntime } = await import("./setup-runtime.mjs");
          await verifyPreparedRuntime({ runtimeRoot: targets.runtime, provenance: prepared.provenance });
        }
        await atomicJson(receiptPath, { ...intent, status: "prepared", version: prepared.version, provenance: prepared.provenance });
        report = await detect(reportOptions);
        if (!metadataReady(report, id)) throw new Error(`Prepared ${id} did not pass shared metadata detection; its partial outcome is retained.`);
        if (namedProbe) {
          const checked = await probe(report, { probes: [namedProbe], signal });
          entry.probes = checked.probeResults;
          assertProbeCleanup(checked);
          if (!checked.probesPassed) throw new Error(`Prepared ${id} failed its explicit ${namedProbe} probe.`);
        }
        const primarySha256 = id === "desktop" ? undefined : await hashFile(primaryFile(id, targets[id], platform));
        const receipt = { ...intent, status: "ready", completedAt: new Date().toISOString(), version: prepared.version, primarySha256, provenance: prepared.provenance };
        await atomicJson(receiptPath, receipt);
        Object.assign(entry, { status: "prepared", version: prepared.version, primarySha256, completedAt: receipt.completedAt, provenance: prepared.provenance });
        await persist();
      } catch (error) {
        Object.assign(entry, { status: cancelled() || error.code === "ABORT_ERR" ? "cancelled" : "failed", error: serializedError(error), completedAt: new Date().toISOString() });
        if (entry.error.execution?.exitObserved === false) run.unsafeToRetry = true;
        const current = await jsonFile(receiptPath).catch(() => undefined);
        if (current?.runId === runId) await atomicJson(receiptPath, { ...current, status: entry.status, error: entry.error });
        await persist();
      }
    }
    run.report = await detect(reportOptions);
    const errors = run.components.filter((entry) => ["failed", "blocked", "cancelled", "manual-step-required"].includes(entry.status));
    // A prior component probe does not override a later missing dependency.
    // uv is installer-only; an already usable emulator does not require it.
    const notReady = plan.components.filter((entry) => entry.id !== "uv" && !metadataReady(run.report, entry.id)).map((entry) => entry.id);
    if (notReady.length) run.readinessError = {
      code: "SETUP_INCOMPLETE",
      message: `The final dependency check is not ready for: ${notReady.join(", ")}.`,
      components: notReady,
    };
    run.status = cancelled() ? "cancelled" : errors.length || notReady.length ? "partial" : "complete";
    if (run.status === "complete" && plan.requestedComponents.includes("runtime") && metadataReady(run.report, "runtime")) {
      try {
        const preparation = { source: targets.runtime, runtimeRoot: targets.runtime, toolchainRoot: path.join(root, "toolchain"), outputRoot: path.join(root, "payloads"), environment: options.environment ?? process.env };
        if (options.preparePayload) run.preparedPlugin = await options.preparePayload(preparation);
        else {
          const { setupEnvironment, runSetupCommand } = await import("./setup-io.mjs");
          const env = await setupEnvironment({ setupRoot: root, nodeExecutable: process.execPath, environment: preparation.environment, platform, arch });
          const completed = await runSetupCommand(process.execPath, [path.join(packageRoot, "scripts", "prepare-plugin-payload.mjs"), "--source", targets.runtime, "--runtime-root", targets.runtime, "--toolchain-root", preparation.toolchainRoot, "--output-root", preparation.outputRoot, "--json"], { cwd: targets.runtime, env, signal, onProgress, timeoutMs: 120_000 });
          run.preparedPlugin = JSON.parse(completed.stdout.trim());
        }
        run.launchConfiguration = { mcpServers: { "modretro-chromatic": { type: "stdio", command: process.execPath, args: [path.join(run.preparedPlugin.payloadPath, "scripts", "start-mcp.mjs")], env: { GB_STUDIO_RUNTIME_ROOT: targets.runtime, GB_STUDIO_TOOLCHAIN_ROOT: path.join(root, "toolchain") } } } };
        await atomicJson(path.join(root, "prepared-mcp.json"), run.launchConfiguration);
      } catch (error) { run.status = "partial"; run.preparationError = serializedError(error); if (run.preparationError.execution?.exitObserved === false) run.unsafeToRetry = true; }
    }
    run.completedAt = new Date().toISOString();
    run.nextSteps = run.status === "complete"
      ? [run.preparedPlugin ? "Dependencies and future launch configuration are prepared. This did not install or refresh the plugin in Codex." : "The selected dependency components are prepared; no new plugin payload or launch configuration was requested.",
        ...(!plan.requestedComponents.includes("build") ? ["Game builds and official browser previews were not selected. A new playable game needs build dependencies; add emulator for local stepped play."] : []),
        run.preparedPlugin ? "Use doctor with named probes to recheck this root. Install or refresh the prepared plugin in Codex, then verify its tools in a new task." : "Dependencies are ready. Continue the requested build or playtest with the existing installed plugin; do not recreate or reinstall it."]
      : ["Inspect retained component errors and paths; successful components are preserved.", "Retry the same explicit apply command after resolving the reported cause. Known-owned partial components are preserved under quarantine before retry.", "A stale setup lock is never stolen or used to kill a process. Verify its recorded owner has ended before preserving/moving that lock."];
    await persist();
  } catch (error) {
    run.status = cancelled() ? "cancelled" : "partial";
    run.error = serializedError(error);
    if (run.error.execution?.exitObserved === false) run.unsafeToRetry = true;
    run.completedAt = new Date().toISOString();
    // Root/lock failures may prevent recording. Return the in-memory outcome too.
    await atomicJson(path.join(root, "last-run.json"), run).catch((failure) => { run.recordingError = serializedError(failure); });
  } finally {
    if (run.unsafeToRetry) run.cleanupError = { message: "An owned process may still be running. Installer lock retained; verify process-tree exit before any retry.", lockPath: path.join(root, ".setup-lock") };
    else {
      try { await release(); }
      catch (error) { run.cleanupError = serializedError(error); }
    }
  }
  if (run.cleanupError) {
    await atomicJson(path.join(root, "last-run.json"), run).catch((error) => { run.recordingError = serializedError(error); });
    await atomicJson(path.join(root, "runs", `${runId}.json`), run).catch(() => {});
  }
  return run;
}

export const SETUP_USAGE = `ModRetro Chromatic packaged setup (does not install or refresh the Codex plugin)
Usage: setup.sh|setup.ps1 [doctor|plan|apply] [--root ABSOLUTE_PATH]
  --components runtime,build,emulator,desktop  Default: runtime,build,emulator
  --probes cli-version,gbdk-version,emulator-import  Doctor only; explicitly executes these checks
  --yes      Required by apply before downloads or changes
  --dry-run  Passive plan; never downloads, installs or probes
  --json     Machine-readable result
  --help     This help
Doctor without --root inspects configured/recorded bindings. Plan/apply target the
owned per-user root; pass the same --root to doctor to inspect that target.
Node bootstrap is a prerequisite; the desktop editor is optional for build/play.
`;

function printResult(result, json) {
  if (json) { process.stdout.write(`${JSON.stringify(result, null, 2)}\n`); return; }
  if (result.mode === "plan") {
    process.stdout.write(`Passive setup plan: ${result.platform}\nRoot: ${result.root}\n`);
    for (const item of result.components) {
      process.stdout.write(`[${item.action}] ${item.id} ${item.version ?? ""}\n  ${item.destination}\n`);
      for (const source of item.sources) process.stdout.write(`  Source: ${source.url ?? source.source}${source.sha256 ? ` (SHA-256 ${source.sha256})` : ""}\n`);
    }
    for (const next of result.nextSteps) process.stdout.write(`${next}\n`);
  } else if (result.components?.some((entry) => "requiredVersion" in entry)) {
    process.stdout.write(`Doctor: ${result.mode}; readiness based on ${result.readinessBasis}\n`);
    for (const entry of result.components) process.stdout.write(`[${entry.status}] ${entry.id}: required ${entry.requiredVersion}, detected ${entry.detectedVersion ?? "unknown"}\n  ${entry.path ?? "No selected path"}\n`);
    for (const [name, task] of Object.entries(result.tasks)) process.stdout.write(`${name}: ${task.ready ? "ready by metadata" : "not ready"}\n`);
    if (result.probeResults) process.stdout.write(`Explicit probes: ${JSON.stringify(result.probeResults)}\n`);
    for (const next of result.nextSteps ?? []) process.stdout.write(`${next}\n`);
  } else {
    process.stdout.write(`Setup ${result.status}; activation: ${result.activation}\nRoot: ${result.root}\n`);
    for (const entry of result.components ?? []) process.stdout.write(`[${entry.status}] ${entry.id}${entry.error ? `: ${entry.error.message}` : ""}\n`);
    if (result.preparedPlugin) process.stdout.write(`Prepared future plugin: ${result.preparedPlugin.payloadPath}\n`);
    if (result.readinessError) process.stdout.write(`Final readiness: ${result.readinessError.message}\n`);
    if (result.preparationError) process.stdout.write(`Payload preparation: ${result.preparationError.message}\n`);
    if (result.cleanupError) process.stdout.write(`Cleanup failure: ${result.cleanupError.message}\n`);
    for (const next of result.nextSteps ?? []) process.stdout.write(`${next}\n`);
  }
}

export async function runSetup(argv = process.argv.slice(2), options = {}) {
  const selected = parseSetupArguments(argv);
  if (selected.help) return { help: SETUP_USAGE };
  if (selected.command === "plan") return planSetup({ ...options, ...selected });
  if (selected.command === "apply") return applySetup({ ...options, ...selected });
  const { detectDependencies, probeDependencies } = await import("./dependency-doctor.mjs");
  const report = await detectDependencies({ packageRoot: options.packageRoot ?? PACKAGE_ROOT, ...(selected.root ? { setupRoot: selected.root } : {}), environment: options.environment ?? process.env, requestedTasks: tasksFor(selected.components) });
  return selected.probes.length ? probeDependencies(report, { probes: selected.probes, signal: options.signal }) : report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Setup cancelled by the operator."));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const result = await runSetup(process.argv.slice(2), { signal: controller.signal, onProgress: ({ phase, message, label, elapsedMs }) => process.stderr.write(`[${phase}] ${message ?? label ?? "Working"}${elapsedMs === undefined ? "" : ` (${Math.round(elapsedMs / 1000)}s)`}\n`) });
    if (result.help) process.stdout.write(result.help);
    else printResult(result, process.argv.includes("--json"));
    if (controller.signal.aborted || result.status === "cancelled") process.exitCode = 130;
    else if (result.status && result.status !== "complete") process.exitCode = 1;
    else if (result.mode === "plan" && !result.canApply) process.exitCode = 1;
    else if (["detect", "probe"].includes(result.mode) && (!result.ready || result.probesPassed === false)) process.exitCode = 1;
    if (result.cleanupError) process.exitCode = 1;
  } catch (error) {
    if (process.argv.includes("--json")) process.stdout.write(`${JSON.stringify({ status: "rejected", error: serializedError(error), ...(error.lockOwner ? { lockOwner: error.lockOwner } : {}), ...(error.plan ? { plan: error.plan } : {}) })}\n`);
    else process.stderr.write(`ModRetro Chromatic setup: ${error.message}\n`);
    process.exitCode = error.exitCode ?? 1;
  } finally {
    process.off("SIGINT", cancel);
    process.off("SIGTERM", cancel);
  }
}
