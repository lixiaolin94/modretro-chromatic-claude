#!/usr/bin/env node

/** A small Windows front door; the existing setup scripts own installation. */

import { execFile, spawn } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  assertLegacySetupMutableRoot,
  preflightWindowsGbStudio,
  sanitizeWindowsBootstrapEnvironment,
} from "./setup-compiler.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const SOURCE_ROOT = path.resolve(path.dirname(SCRIPT_PATH), "..");
const OUTPUT_LIMIT = 1024 * 1024;
const PROGRESS_INTERVAL = 30_000;
const PYTHON_VERSION_PROGRAM = "import sys; print('.'.join(map(str, sys.version_info[:3])))";
const EMULATOR_VERSION_PROGRAM = [
  "import sys, pyboy, PIL",
  "from importlib.metadata import version",
  "assert sys.version_info[:2] == (3, 13)",
  "assert version('pyboy') == '2.7.0'",
  "assert int(version('Pillow').split('.')[0]) in (11, 12)",
  "print('.'.join(map(str, sys.version_info[:3])))",
].join("; ");

export const WINDOWS_SETUP_TIMEOUTS = Object.freeze({
  prerequisite: 15_000,
  dependencies: 15 * 60_000,
  build: 5 * 60_000,
  toolchain: 60 * 60_000,
  emulator: 20 * 60_000,
  doctor: 2 * 60_000,
  payload: 5 * 60_000,
  registration: 5 * 60_000,
});

const VALUE_OPTIONS = new Map([
  ["--toolchain-root", "toolchainRoot"],
  ["--payload-root", "payloadRoot"],
  ["--marketplace-root", "marketplaceRoot"],
  ["--marketplace-name", "marketplaceName"],
  ["--python", "python"],
]);
const FLAG_OPTIONS = new Map([
  ["--with-desktop", "withDesktop"],
  ["--skip-emulator", "skipEmulator"],
  ["--use-existing", "useExisting"],
  ["--replace-link", "replaceLink"],
  ["--dry-run", "dryRun"],
  ["--json", "json"],
  ["--help", "help"],
  ["-h", "help"],
]);

class SetupCommandError extends Error {}

export function parseWindowsFrontDoorArguments(arguments_) {
  const selected = {
    withDesktop: false,
    skipEmulator: false,
    useExisting: false,
    replaceLink: false,
    dryRun: false,
    json: false,
    help: false,
  };
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    const flag = FLAG_OPTIONS.get(argument);
    if (flag !== undefined) {
      selected[flag] = true;
      continue;
    }
    const key = VALUE_OPTIONS.get(argument);
    if (key === undefined) throw new Error(`Unknown Windows setup option: ${argument}`);
    const value = arguments_[++index];
    if (!value || value.startsWith("--") || value.includes("\0")) {
      throw new Error(`${argument} requires a nonempty value.`);
    }
    if (selected[key] !== undefined) throw new Error(`${argument} may only be supplied once.`);
    selected[key] = value;
  }
  if (selected.marketplaceName !== undefined && selected.marketplaceRoot === undefined) {
    throw new Error("--marketplace-name requires an explicitly selected --marketplace-root.");
  }
  return selected;
}

function environmentValue(environment, requested) {
  const matches = Object.entries(environment).filter(([name, value]) =>
    value !== undefined && name.toUpperCase() === requested.toUpperCase());
  if (new Set(matches.map(([, value]) => value)).size > 1) {
    throw new Error(`Conflicting case-insensitive Windows values for ${requested}.`);
  }
  return matches[0]?.[1];
}

function setEnvironmentValue(environment, name, value) {
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase() === name.toUpperCase()) delete environment[key];
  }
  environment[name] = value;
}

function samePath(left, right) {
  return path.resolve(left).toLowerCase() === path.resolve(right).toLowerCase();
}

function withinRoot(root, candidate) {
  const relative = path.relative(path.resolve(root).toLowerCase(), path.resolve(candidate).toLowerCase());
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function metadataIfPresent(candidate) {
  try {
    return await lstat(candidate);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return undefined;
    throw error;
  }
}

async function realEntry(candidate, kind, label) {
  if (!path.isAbsolute(candidate)) throw new Error(`${label} must use an absolute path.`);
  const metadata = await metadataIfPresent(candidate);
  if (!metadata || metadata.isSymbolicLink() ||
      (kind === "file" ? !metadata.isFile() : !metadata.isDirectory()) ||
      !samePath(await realpath(candidate), candidate)) {
    throw new Error(`${label} must be a real ${kind}, not a link or reparse point: ${candidate}`);
  }
  return await realpath(candidate);
}

async function trustedFile(candidate, rejectedRoots, label) {
  const canonical = await realEntry(candidate, "file", label);
  if (rejectedRoots.some((root) => root && withinRoot(root, canonical))) {
    throw new Error(`${label} must be installed outside the selected checkout and project.`);
  }
  return canonical;
}

async function trustedPathDirectories(environment, rejectedRoots) {
  const directories = [];
  for (const raw of (environmentValue(environment, "PATH") ?? "").split(";")) {
    const entry = raw.trim().replace(/^"(.*)"$/, "$1");
    if (!entry || !path.isAbsolute(entry)) continue;
    try {
      const canonical = await realpath(entry);
      if (!(await lstat(canonical)).isDirectory() ||
          rejectedRoots.some((root) => root && withinRoot(root, canonical))) continue;
      if (!directories.some((existing) => samePath(existing, canonical))) directories.push(canonical);
    } catch {
      // Missing, relative, or checkout-controlled PATH entries are not executable authorities.
    }
  }
  return directories;
}

async function findTrustedExecutable(names, environment, rejectedRoots) {
  for (const directory of await trustedPathDirectories(environment, rejectedRoots)) {
    for (const name of names) {
      try {
        return await trustedFile(path.join(directory, name), rejectedRoots, `The trusted ${name}`);
      } catch {
        // Keep looking; do not fall back to .cmd, aliases, the working directory, or a shell.
      }
    }
  }
  return undefined;
}

async function resolveNpmScript(nodeExecutable, environment, rejectedRoots) {
  const directories = [path.dirname(nodeExecutable), ...await trustedPathDirectories(environment, rejectedRoots)];
  for (const directory of directories) {
    for (const candidate of [
      path.join(directory, "node_modules", "npm", "bin", "npm-cli.js"),
      path.resolve(directory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
    ]) {
      try {
        return await trustedFile(candidate, rejectedRoots, "The trusted npm CLI");
      } catch {
        // A full Node installation or a trusted absolute npm-global prefix may supply npm.
      }
    }
  }
  throw new Error(
    "This Node installation has no usable npm CLI. Install a current supported Node.js 22 or 24 LTS " +
    "distribution with npm, reopen PowerShell, and rerun setup. Do not copy a bundled node.exe by itself.",
  );
}

function checkedVersion(output, name, minimumMajor) {
  const version = String(output ?? "").trim();
  const match = /^(?:v)?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/u.exec(version);
  if (!match || Number(match[1]) < minimumMajor) {
    throw new Error(`${name} did not report a supported version (requires ${minimumMajor} or newer).`);
  }
  return version;
}

/** PowerShell's single-quoted arguments are literal, including spaces, $, and backticks. */
export function formatPowerShellCommand(arguments_) {
  return `& ${arguments_.map((argument) => `'${String(argument).replaceAll("'", "''")}'`).join(" ")}`;
}

async function terminateChildTree(child, options) {
  if (!child.pid) return true;
  if ((options.platform ?? process.platform) === "win32") {
    try {
      const systemRoot = environmentValue(options.env ?? {}, "SystemRoot");
      if (!systemRoot) throw new Error("No trusted SystemRoot");
      const canonicalRoot = await realEntry(systemRoot, "directory", "The trusted Windows SystemRoot");
      const taskkill = await realEntry(path.join(canonicalRoot, "System32", "taskkill.exe"), "file", "The Windows process-tree terminator");
      await execFileAsync(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
        cwd: canonicalRoot, env: options.env, shell: false, windowsHide: true,
        timeout: 5_000, maxBuffer: 64 * 1024,
      });
      return true;
    } catch {
      child.kill("SIGKILL");
      return false;
    }
  }
  try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
  return true;
}

/** Bounded subprocesses never use a shell or echo raw command output and credentials. */
export async function runWindowsSetupCommand(command, arguments_, options = {}) {
  const timeout = options.timeout ?? WINDOWS_SETUP_TIMEOUTS.prerequisite;
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > WINDOWS_SETUP_TIMEOUTS.toolchain) {
    throw new Error("Windows setup command timeout is outside its supported limits.");
  }
  if (options.signal?.aborted) throw new SetupCommandError(`${options.label ?? "Windows setup command"} was cancelled.`);
  const label = options.label ?? "Windows setup command";
  const logger = options.logger ?? (() => {});
  const platform = options.platform ?? process.platform;
  const started = Date.now();
  const child = (options.spawn ?? spawn)(command, arguments_, {
    cwd: options.cwd, env: options.env, shell: false, windowsHide: true,
    detached: platform !== "win32", stdio: ["ignore", "pipe", "pipe"],
  });
  const output = { stdout: [], stderr: [] };
  const sizes = { stdout: 0, stderr: 0 };
  let stopReason;
  let terminating;
  let cleanupTimer;
  let rejectClose;
  let closed = false;
  const stop = (reason) => {
    if (stopReason !== undefined || closed) return;
    stopReason = reason;
    terminating = Promise.resolve().then(() => (options.terminateTree ?? terminateChildTree)(child, { ...options, platform })).catch(() => false);
    cleanupTimer = setTimeout(() => {
      child.kill("SIGKILL");
      rejectClose?.(new SetupCommandError(`${reason} Process cleanup did not finish within 10s.`));
    }, 10_000);
  };
  const collect = (stream, chunk) => {
    const buffer = Buffer.from(chunk);
    sizes[stream] += buffer.length;
    if (sizes[stream] > OUTPUT_LIMIT) {
      stop(`${label} exceeded its bounded output limit.`);
      return;
    }
    output[stream].push(buffer);
  };
  child.stdout?.on("data", (chunk) => collect("stdout", chunk));
  child.stderr?.on("data", (chunk) => collect("stderr", chunk));
  const onAbort = () => stop(`${label} was cancelled.`);
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted) onAbort();
  const timer = setTimeout(() => stop(`${label} timed out after ${Math.round(timeout / 1000)}s.`), timeout);
  const progress = options.progress === false ? undefined : setInterval(() => {
    logger(`${label}: still running (${Math.round((Date.now() - started) / 1000)}s).`);
  }, options.progressInterval ?? PROGRESS_INTERVAL);
  progress?.unref?.();
  try {
    const result = await new Promise((resolve, reject) => {
      rejectClose = reject;
      child.once("error", () => reject(new SetupCommandError(`${label} could not start. Check the executable and access permissions.`)));
      child.once("close", (code, signal) => {
        closed = true;
        resolve({ code, signal });
      });
    });
    const cleaned = terminating ? await terminating : true;
    if (stopReason !== undefined) throw new SetupCommandError(`${stopReason}${cleaned === false ? " Descendant-process cleanup could not be confirmed." : ""}`);
    if (result.code !== 0 || result.signal !== null) {
      throw new SetupCommandError(`${label} failed (${result.signal ?? `exit code ${result.code ?? "unknown"}`}).`);
    }
    return {
      stdout: Buffer.concat(output.stdout).toString("utf8"),
      stderr: Buffer.concat(output.stderr).toString("utf8"),
    };
  } finally {
    clearTimeout(timer);
    if (cleanupTimer !== undefined) clearTimeout(cleanupTimer);
    if (progress !== undefined) clearInterval(progress);
    options.signal?.removeEventListener("abort", onAbort);
  }
}

async function pythonVersion(executable, context, emulator = false) {
  try {
    const result = await context.run(executable, ["-I", "-c", emulator ? EMULATOR_VERSION_PROGRAM : PYTHON_VERSION_PROGRAM], {
      ...context.commandOptions, label: emulator ? "Existing PyBoy prerequisite" : "Python prerequisite",
      timeout: WINDOWS_SETUP_TIMEOUTS.prerequisite, progress: false,
    });
    const version = checkedVersion(result.stdout, "Python", 3);
    const [major, minor] = version.split(".").map(Number);
    if (major < 3 || (major === 3 && minor < 10)) return undefined;
    return version;
  } catch {
    return undefined;
  }
}

async function resolvePython(selected, context, localRoot) {
  const managed = path.join(localRoot, "pyboy-venv", "Scripts", "python.exe");
  const managedMetadata = await metadataIfPresent(managed);
  let managedPython;
  if (managedMetadata) managedPython = await realEntry(managed, "file", "The managed PyBoy interpreter");
  let registrationPython;
  if (selected.python !== undefined) {
    if (!path.isAbsolute(selected.python)) throw new Error("--python requires an absolute interpreter path.");
    registrationPython = samePath(selected.python, managed)
      ? await realEntry(selected.python, "file", "The managed registration Python interpreter")
      : await trustedFile(selected.python, context.rejectedRoots, "The selected registration Python interpreter");
    if (!await pythonVersion(registrationPython, context)) {
      throw new Error("The selected registration interpreter must be a working Python 3.10 or newer.");
    }
  } else if (managedPython && await pythonVersion(managedPython, context)) {
    registrationPython = managedPython;
  }
  const needsRegistration = selected.marketplaceRoot !== undefined;
  if (!selected.skipEmulator) {
    const healthy = managedPython && await pythonVersion(managedPython, context, true);
    if (!healthy) {
      const uv = await findTrustedExecutable(["uv.exe"], context.environment, context.rejectedRoots);
      if (!uv) {
        throw new Error(
          "Playtesting setup needs a trusted uv.exe on an absolute PATH entry to install its managed Python 3.13 runtime. " +
          "Install uv from https://docs.astral.sh/uv/, reopen PowerShell, or use --skip-emulator for authoring only.",
        );
      }
      await context.run(uv, ["--version"], {
        ...context.commandOptions, label: "uv prerequisite", timeout: WINDOWS_SETUP_TIMEOUTS.prerequisite, progress: false,
      });
    }
    return { registrationPython: registrationPython ?? managed, managedPython: managed, installsManagedPython: !healthy };
  }
  if (!registrationPython && needsRegistration) {
    const candidate = await findTrustedExecutable(["python.exe", "python3.exe"], context.environment, context.rejectedRoots);
    if (candidate && await pythonVersion(candidate, context)) registrationPython = candidate;
    if (!registrationPython) {
      throw new Error(
        "Workspace marketplace registration needs Python 3.10 or newer. Install Python, pass --python with its " +
        "absolute python.exe path, or omit --skip-emulator to provision the managed playtesting interpreter.",
      );
    }
  }
  return { registrationPython, managedPython: managed, installsManagedPython: false };
}

function parseObjectResult(result, label) {
  let parsed;
  try { parsed = JSON.parse(result.stdout); } catch { throw new Error(`${label} did not return valid JSON.`); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} did not return a JSON object.`);
  return parsed;
}

export const WINDOWS_SETUP_USAGE = [
  "Usage: node scripts/setup-windows.mjs [--toolchain-root PATH] [--with-desktop] [--skip-emulator]",
  "       [--use-existing] [--payload-root PATH] [--marketplace-root PATH] [--marketplace-name NAME]",
  "       [--python PATH] [--replace-link] [--dry-run] [--json]",
  "Prepares a Windows x64 checkout, official compiler, optional emulator, and lean plugin payload.",
  "Only an explicit --marketplace-root registers a workspace marketplace. Codex installation is a separate desktop-user step.",
  "--dry-run prints an unverified plan without running prerequisite probes or changing files.",
  "Installed plugins should use packaged setup.mjs (or setup.sh/setup.ps1) with an external dependency root.",
].join("\n");

function selectedSetupStages(selected) {
  const stages = ["Install JavaScript dependencies", "Build the MCP runtime", "Prepare the official game toolchain"];
  if (!selected.skipEmulator) stages.push("Prepare the PyBoy playtesting runtime");
  stages.push("Check the prepared runtime", "Prepare the lean plugin payload");
  if (selected.marketplaceRoot !== undefined) stages.push("Register the selected workspace marketplace");
  return stages;
}

/** Preflight, then delegate to the existing supported setup/build/registration paths. */
export async function runWindowsSetup(options = {}) {
  const selected = parseWindowsFrontDoorArguments(options.args ?? []);
  const logger = options.logger ?? ((message) => process.stderr.write(`${message}\n`));
  if (selected.help) {
    logger(WINDOWS_SETUP_USAGE);
    return { help: true, installed: false };
  }
  const platform = options.platform ?? process.platform;
  const architecture = options.arch ?? process.arch;
  if (platform !== "win32" || architecture !== "x64") {
    throw new Error(`The Windows front door supports Windows x64 only; received ${platform} ${architecture}. Use the existing setup:compiler and setup:emulator commands on macOS/Linux.`);
  }
  if (selected.python !== undefined && !path.isAbsolute(selected.python)) {
    throw new Error("--python requires an absolute interpreter path.");
  }
  if (selected.dryRun) {
    // A plan must work before npm, Corepack, uv, Python, or a dependency root exists.
    // These are lexical requested destinations, not verified physical bindings.
    const sourceRoot = path.resolve(options.sourceRoot ?? SOURCE_ROOT);
    const currentDirectory = options.cwd ?? process.cwd();
    const toolchainRoot = path.resolve(currentDirectory, selected.toolchainRoot ??
      environmentValue(options.environment ?? process.env, "GB_STUDIO_TOOLCHAIN_ROOT") ?? sourceRoot);
    const payloadRoot = path.resolve(currentDirectory, selected.payloadRoot ?? path.join(sourceRoot, "artifacts", "plugin-payloads"));
    const marketplaceRoot = selected.marketplaceRoot === undefined ? undefined : path.resolve(currentDirectory, selected.marketplaceRoot);
    const stages = selectedSetupStages(selected);
    logger("[dry-run] Plan only; no tools were run. Paths and prerequisite health are unverified.");
    logger(`[dry-run] Requested source ${sourceRoot}; toolchain ${toolchainRoot}; payload output ${payloadRoot}.`);
    logger("[dry-run] Apply requires Node.js >=22 with npm, official GB Studio 4.3.2 and GBDK 4.5.0; missing compiler setup also needs Git and Corepack.");
    if (!selected.skipEmulator) logger("[dry-run] Playtesting uses Python 3.13, PyBoy 2.7.0, Pillow >=11,<13; uv is needed for installation or repair.");
    if (selected.useExisting) logger("[dry-run] --use-existing verifies the existing official toolchain; it does not skip npm/runtime/payload stages or optional PyBoy repair.");
    for (const stage of stages) logger(`[dry-run] ${stage}`);
    return { schemaVersion: 1, platform: "win32-x64", sourceRoot, toolchainRoot, payloadRoot, marketplaceRoot, stages,
      dryRun: true, verified: false, installed: false };
  }
  checkedVersion(options.nodeVersion ?? process.versions.node, "Node.js", 22);
  const sourceRoot = await realEntry(await realpath(path.resolve(options.sourceRoot ?? SOURCE_ROOT)), "directory", "The plugin source checkout");
  await assertLegacySetupMutableRoot(sourceRoot);
  for (const relative of ["package.json", "package-lock.json", "scripts/prepare.mjs", "scripts/setup-compiler.mjs", "scripts/setup-emulator.mjs", "scripts/doctor.mjs", "scripts/prepare-plugin-payload.mjs", "scripts/register-personal-plugin.py"]) {
    await realEntry(path.join(sourceRoot, relative), "file", "The plugin setup source");
  }
  const manifest = JSON.parse(await readFile(path.join(sourceRoot, "package.json"), "utf8"));
  if (manifest.name !== "modretro-chromatic") throw new Error("The setup source is not a modretro-chromatic checkout.");
  const parentEnvironment = options.environment ?? process.env;
  const environment = sanitizeWindowsBootstrapEnvironment(parentEnvironment);
  const currentDirectory = options.cwd ?? process.cwd();
  const requestedToolchainRoot = await realEntry(
    await realpath(path.resolve(currentDirectory, selected.toolchainRoot ?? environmentValue(parentEnvironment, "GB_STUDIO_TOOLCHAIN_ROOT") ?? sourceRoot)),
    "directory", "The selected game toolchain root",
  );
  const requestedLocalRoot = path.join(requestedToolchainRoot, ".local");
  let physicalLocalRoot = requestedLocalRoot;
  if (await metadataIfPresent(requestedLocalRoot)) {
    physicalLocalRoot = await realEntry(await realpath(requestedLocalRoot), "directory", "The selected toolchain .local directory");
    if (path.basename(physicalLocalRoot).toLowerCase() !== ".local") {
      throw new Error("A linked game toolchain must resolve to an actual .local directory.");
    }
  }
  const rejectedRoots = [sourceRoot, currentDirectory, requestedToolchainRoot, physicalLocalRoot,
    path.dirname(physicalLocalRoot), environmentValue(parentEnvironment, "GB_STUDIO_PROJECT_ROOT")].filter(Boolean);
  const nodeExecutable = await trustedFile(await realpath(options.nodeExecutable ?? process.execPath), rejectedRoots, "The trusted Node.js executable");
  const run = options.runCommand ?? runWindowsSetupCommand;
  const commandOptions = { cwd: sourceRoot, env: environment, platform, signal: options.signal, logger };
  const npmScript = await resolveNpmScript(nodeExecutable, environment, rejectedRoots);
  logger("Checking Windows setup prerequisites...");
  let npmVersion;
  try {
    const result = await run(nodeExecutable, [npmScript, "--version"], {
      ...commandOptions, label: "npm prerequisite", timeout: WINDOWS_SETUP_TIMEOUTS.prerequisite, progress: false,
    });
    npmVersion = checkedVersion(result.stdout, "npm", 8);
  } catch {
    throw new Error("The installed npm CLI could not run with this Node executable. Install a current supported Node.js 22 or 24 LTS distribution with npm, reopen PowerShell, and retry.");
  }
  const toolchainArguments = [selected.withDesktop ? "--with-desktop" : "--headless", "--with-cli"];
  if (selected.useExisting) toolchainArguments.push("--use-existing");
  const toolchain = await (options.preflightGbStudio ?? preflightWindowsGbStudio)({
    platform, arch: architecture, args: toolchainArguments, pluginRoot: sourceRoot,
    toolchainRoot: requestedToolchainRoot, workingDirectory: currentDirectory,
    nodeExecutable, environment, logger,
    runCommand: (command, arguments_, settings) => run(command, arguments_, {
      ...commandOptions, ...settings, label: "Game compiler prerequisite",
      timeout: settings.timeout ?? WINDOWS_SETUP_TIMEOUTS.prerequisite, progress: false,
    }),
  });
  // A linked checkout .local is allowed by the existing installer; use its physical owner downstream.
  const toolchainRoot = path.dirname(toolchain.localRoot);
  setEnvironmentValue(environment, "GB_STUDIO_TOOLCHAIN_ROOT", toolchainRoot);
  const context = { run, environment, commandOptions, rejectedRoots };
  const python = await resolvePython(selected, context, toolchain.localRoot);
  const payloadRoot = path.resolve(currentDirectory, selected.payloadRoot ?? path.join(sourceRoot, "artifacts", "plugin-payloads"));
  const marketplaceRoot = selected.marketplaceRoot === undefined ? undefined : path.resolve(currentDirectory, selected.marketplaceRoot);
  const stages = selectedSetupStages(selected);
  logger(`Prerequisites ready: Node ${options.nodeVersion ?? process.versions.node}, npm ${npmVersion}.`);
  logger("Codex will not run from this setup process; installation belongs in the desktop user's terminal.");
  if (options.signal?.aborted) throw new Error("Windows setup was cancelled before installation.");

  async function stage(label, command, arguments_, timeout) {
    if (options.signal?.aborted) throw new SetupCommandError(`${label} was cancelled before it started.`);
    logger(`${label}...`);
    try {
      const result = await run(command, arguments_, { ...commandOptions, label, timeout });
      logger(`${label}: completed.`);
      return result;
    } catch (error) {
      logger(`${label}: failed.`);
      const diagnostic = error instanceof SetupCommandError ? error.message : `${label} failed.`;
      throw new Error(`${diagnostic} Rerun this supported command for its detailed diagnostic: ${formatPowerShellCommand([command, ...arguments_])}`);
    }
  }

  await stage(stages[0], nodeExecutable, [npmScript, "ci", "--include=dev", "--ignore-scripts", "--no-audit", "--no-fund"], WINDOWS_SETUP_TIMEOUTS.dependencies);
  await stage(stages[1], nodeExecutable, [path.join(sourceRoot, "scripts", "prepare.mjs")], WINDOWS_SETUP_TIMEOUTS.build);
  await stage(stages[2], nodeExecutable, [path.join(sourceRoot, "scripts", "setup-compiler.mjs"), ...toolchainArguments], WINDOWS_SETUP_TIMEOUTS.toolchain);
  if (!selected.skipEmulator) {
    await stage("Prepare the PyBoy playtesting runtime", nodeExecutable, [path.join(sourceRoot, "scripts", "setup-emulator.mjs")], WINDOWS_SETUP_TIMEOUTS.emulator);
  }
  const doctorArguments = [path.join(sourceRoot, "scripts", "doctor.mjs"),
    "--runtime-root", sourceRoot, "--toolchain-root", toolchainRoot, "--node", nodeExecutable,
    "--task", "projectBuild", "--probe", "cli-version", "--probe", "gbdk-version"];
  if (!selected.skipEmulator) doctorArguments.push("--task", "play", "--probe", "emulator-import");
  await stage("Check the prepared runtime", nodeExecutable, doctorArguments, WINDOWS_SETUP_TIMEOUTS.doctor);
  const payloadArguments = [path.join(sourceRoot, "scripts", "prepare-plugin-payload.mjs"), "--source", sourceRoot,
    "--runtime-root", sourceRoot, "--toolchain-root", toolchainRoot, "--output-root", payloadRoot, "--json"];
  const payload = parseObjectResult(await stage("Prepare the lean plugin payload", nodeExecutable, payloadArguments, WINDOWS_SETUP_TIMEOUTS.payload), "Plugin payload preparation");
  if (payload.pluginName !== "modretro-chromatic" || typeof payload.payloadPath !== "string" || typeof payload.version !== "string" || payload.dryRun) {
    throw new Error("Plugin payload preparation did not confirm a real modretro-chromatic payload.");
  }
  logger(`Prepared plugin payload ${payload.version} (${payload.fileCount ?? "unknown"} files, ${payload.totalBytes ?? "unknown"} bytes).`);

  const registrationArguments = ["-I", path.join(sourceRoot, "scripts", "register-personal-plugin.py"), "--source", sourceRoot,
    "--runtime-root", sourceRoot, "--toolchain-root", toolchainRoot, "--payload-root", payloadRoot];
  if (selected.replaceLink) registrationArguments.push("--replace-link");
  let marketplace;
  if (marketplaceRoot !== undefined) {
    const executable = await realEntry(python.registrationPython, "file", "The registration Python interpreter");
    marketplace = parseObjectResult(await stage("Register the selected workspace marketplace", executable, [
      ...registrationArguments, "--marketplace-root", marketplaceRoot,
      ...(selected.marketplaceName === undefined ? [] : ["--marketplace-name", selected.marketplaceName]), "--json",
    ], WINDOWS_SETUP_TIMEOUTS.registration), "Workspace marketplace registration");
    if (marketplace.registered !== true || marketplace.installed !== false || !Array.isArray(marketplace.handoff)) {
      throw new Error("Workspace marketplace registration did not confirm a registered, not-yet-installed marketplace.");
    }
    logger("The selected workspace marketplace is prepared. In a normal desktop-user PowerShell terminal, run:");
    for (const command of marketplace.handoff) {
      if (!Array.isArray(command) || !command.every((argument) => typeof argument === "string")) {
        throw new Error("Workspace marketplace registration returned an invalid handoff command.");
      }
      logger(`  ${formatPowerShellCommand(command)}`);
    }
  } else {
    const executable = python.registrationPython ?? "python";
    logger("No marketplace or personal profile was changed. To register for the current desktop user, open a normal PowerShell terminal and run:");
    logger(`  ${formatPowerShellCommand([executable, ...registrationArguments, "--confirm-user-profile"])} $env:USERPROFILE`);
    if (python.registrationPython === undefined) logger("  Use Python 3.10 or newer for that registration command.");
    logger("Then run the exact codex plugin add command printed by registration, followed by codex plugin list --json. Start a new Codex task after installation.");
    logger("Alternatively, rerun with an explicitly selected --marketplace-root to prepare a workspace marketplace.");
  }
  logger("Setup preparation is complete. Plugin installation has not been performed or verified.");
  return { schemaVersion: 1, platform: "win32-x64", sourceRoot, toolchainRoot, payloadRoot, payload, marketplace, dryRun: false, installed: false };
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    const selected = parseWindowsFrontDoorArguments(process.argv.slice(2));
    const result = await runWindowsSetup({ args: process.argv.slice(2), signal: controller.signal });
    if (selected.json) process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(`Windows setup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}
