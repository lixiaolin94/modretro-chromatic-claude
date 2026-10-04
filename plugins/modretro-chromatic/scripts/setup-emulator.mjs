#!/usr/bin/env node

import { spawnSync as defaultSpawnSync } from "node:child_process";
import { accessSync, constants, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SCRIPT_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const TRUSTED_UV_REGISTRY_VARIABLES = new Set([
  "UV_INDEX_URL",
  "UV_DEFAULT_INDEX",
  "UV_EXTRA_INDEX_URL",
]);
const UNSAFE_EXACT_VARIABLES = new Set([
  "BASH_ENV",
  "ENV",
  "VIRTUAL_ENV",
  "VIRTUAL_ENV_PROMPT",
  "PIP_CONFIG_FILE",
  "PIP_PREFIX",
  "PIP_TARGET",
]);

const SETUP_USAGE = "Usage: node scripts/setup-emulator.mjs [--dry-run] [--help]\n" +
  "Legacy developer setup for the optional PyBoy environment. --dry-run prints an unverified plan without running tools.\n" +
  "For installed plugins, use the packaged setup.mjs (or setup.sh/setup.ps1) entrypoint and an external dependency root.";

export function parseEmulatorSetupArguments(arguments_) {
  const selected = { dryRun: false, help: false };
  for (const argument of arguments_) {
    if (argument === "--dry-run") selected.dryRun = true;
    else if (argument === "--help" || argument === "-h") selected.help = true;
    else throw new Error(`Unknown emulator setup option: ${argument}`);
  }
  return selected;
}

function emulatorSetupPlan(options) {
  const platform = options.platform ?? process.platform;
  const architecture = options.arch ?? process.arch;
  const environment = options.environment ?? process.env;
  const scriptDirectory = path.resolve(options.scriptDirectory ?? DEFAULT_SCRIPT_DIRECTORY);
  const toolchainRoot = path.resolve(options.cwd ?? process.cwd(), options.toolchainRoot ??
    environmentValue(environment, "GB_STUDIO_TOOLCHAIN_ROOT", platform) ?? path.dirname(scriptDirectory));
  const pythonVersion = options.pythonVersion ?? environmentValue(environment, "GB_STUDIO_PYTHON_VERSION", platform) ?? "3.13";
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(pythonVersion)) {
    throw new Error(`The requested emulator Python version must be an explicit numeric version: ${pythonVersion}`);
  }
  const runtimeDirectory = path.join(toolchainRoot, ".local", "pyboy-venv");
  writeTo(options.stdout ?? process.stdout, `[dry-run] Plan only; no tools were run and dependency health is unverified.\n` +
    `[dry-run] Target ${platform}-${architecture}: Python ${pythonVersion}, PyBoy 2.7.0, Pillow >=11,<13.\n` +
    `[dry-run] Would verify/reuse or prepare the PyBoy environment at ${runtimeDirectory}.\n` +
    "[dry-run] Applying this legacy helper requires trusted uv when installation or repair is needed; installed plugins should use packaged setup.mjs with an external dependency root.");
  return { dryRun: true, verified: false, platform, architecture, toolchainRoot, runtimeDirectory, installed: false };
}

function assertMutableToolchain(filesystem, toolchainRoot) {
  let candidate = path.resolve(toolchainRoot);
  for (;;) {
    const receipt = path.join(candidate, ".codex-plugin", "local-payload.json");
    const manifest = path.join(candidate, ".codex-plugin", "plugin.json");
    let immutable = tryInspect(filesystem, receipt) !== undefined;
    const metadata = tryInspect(filesystem, manifest);
    if (!immutable && metadata?.isSymbolicLink()) {
      throw new Error("Legacy setup cannot establish a mutable root through a linked plugin manifest. Use packaged setup.mjs with an external dependency root.");
    }
    if (!immutable && metadata?.isFile() && !metadata.isSymbolicLink()) {
      const version = JSON.parse(filesystem.readFileSync(manifest, "utf8")).version;
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

/** Preserve enterprise registry/proxy configuration without inheriting interpreter redirects. */
export function sanitizeEmulatorSetupEnvironment(environment = process.env, platform = process.platform) {
  const sanitized = {};
  const acceptedWindowsNames = new Map();
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) continue;
    const canonicalName = name.toUpperCase();
    if (
      UNSAFE_EXACT_VARIABLES.has(canonicalName) ||
      canonicalName.startsWith("NODE_") ||
      canonicalName.startsWith("PYTHON") ||
      canonicalName.startsWith("CONDA_") ||
      (canonicalName.startsWith("UV_") && !TRUSTED_UV_REGISTRY_VARIABLES.has(canonicalName))
    ) {
      continue;
    }
    if (platform === "win32") {
      const existingValue = acceptedWindowsNames.get(canonicalName);
      if (existingValue !== undefined) {
        if (existingValue !== value) {
          throw new Error(`Conflicting case-insensitive Windows environment values for ${canonicalName}.`);
        }
        continue;
      }
      acceptedWindowsNames.set(canonicalName, value);
    }
    sanitized[name] = value;
  }
  return sanitized;
}

function environmentValue(environment, name, platform) {
  if (platform !== "win32") return environment[name];
  const normalizedName = name.toUpperCase();
  const matches = Object.entries(environment).filter(
    ([candidate, value]) => value !== undefined && candidate.toUpperCase() === normalizedName,
  );
  if (matches.length > 1 && new Set(matches.map(([, value]) => value)).size > 1) {
    throw new Error(`Conflicting case-insensitive Windows environment values for ${name}.`);
  }
  return matches[0]?.[1];
}

function normalizedPhysicalPath(candidate, platform) {
  const normalized = path.resolve(candidate);
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isInsideDirectory(directory, candidate, platform) {
  const relativePath = path.relative(
    normalizedPhysicalPath(directory, platform),
    normalizedPhysicalPath(candidate, platform),
  );
  return (
    relativePath === "" ||
    (relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath))
  );
}

function tryInspect(filesystem, candidate) {
  try {
    return filesystem.lstatSync(candidate);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return undefined;
    throw error;
  }
}

function assertPhysicalEntry(filesystem, candidate, expectedKind, platform, label) {
  const entry = tryInspect(filesystem, candidate);
  if (entry === undefined) {
    throw new Error(
      `The existing PyBoy environment is missing a regular ${label}: ${candidate}. ` +
        "Repair or relocate it manually; setup will not remove or recreate it.",
    );
  }
  if (entry.isSymbolicLink()) {
    throw new Error(
      `The ${label} must be a real ${expectedKind}, not a symbolic link or reparse point: ${candidate}. ` +
        "Repair or relocate it manually; setup will not replace it.",
    );
  }
  const hasExpectedKind = expectedKind === "directory" ? entry.isDirectory() : entry.isFile();
  if (!hasExpectedKind) {
    throw new Error(
      `The ${label} must be a real ${expectedKind}: ${candidate}. ` +
        "Repair or relocate it manually; setup will not remove or recreate it.",
    );
  }

  const physicalPath = filesystem.realpathSync(candidate);
  if (normalizedPhysicalPath(physicalPath, platform) !== normalizedPhysicalPath(candidate, platform)) {
    throw new Error(
      `The ${label} resolves through a symbolic link or reparse point: ${candidate}. ` +
        "Repair or relocate it manually; setup will not replace it.",
    );
  }
  return physicalPath;
}

function inspectExistingRuntime(filesystem, runtimeDirectory, platform) {
  assertPhysicalEntry(filesystem, runtimeDirectory, "directory", platform, "PyBoy environment");
  assertPhysicalEntry(
    filesystem,
    path.join(runtimeDirectory, "pyvenv.cfg"),
    "file",
    platform,
    "pyvenv.cfg",
  );
  const executableDirectory = path.join(runtimeDirectory, "Scripts");
  assertPhysicalEntry(filesystem, executableDirectory, "directory", platform, "Scripts directory");
  const pythonPath = path.join(executableDirectory, "python.exe");
  assertPhysicalEntry(filesystem, pythonPath, "file", platform, "Scripts/python.exe");
  filesystem.accessSync(pythonPath, constants.F_OK);
  return pythonPath;
}

function resolveUvExecutable({ filesystem, environment, platform, currentDirectory, selectedProject }) {
  const configuredPath = environmentValue(environment, "PATH", platform);
  if (!configuredPath) {
    throw new Error("The optional emulator setup requires a trusted uv.exe on PATH: https://docs.astral.sh/uv/");
  }

  const rejectedRoots = [currentDirectory, selectedProject].filter(Boolean);
  for (const rawEntry of configuredPath.split(";")) {
    const entry = rawEntry.trim().replace(/^"(.*)"$/, "$1");
    if (!entry || !(path.isAbsolute(entry) || path.win32.isAbsolute(entry))) continue;

    let directory;
    try {
      directory = filesystem.realpathSync(entry);
    } catch {
      continue;
    }
    if (rejectedRoots.some((root) => isInsideDirectory(root, directory, platform))) continue;

    const candidate = path.join(directory, "uv.exe");
    const metadata = tryInspect(filesystem, candidate);
    if (metadata === undefined || metadata.isSymbolicLink() || !metadata.isFile()) continue;

    let executable;
    try {
      executable = filesystem.realpathSync(candidate);
    } catch {
      continue;
    }
    if (normalizedPhysicalPath(executable, platform) !== normalizedPhysicalPath(candidate, platform)) continue;
    return executable;
  }

  throw new Error(
    "The optional emulator setup requires a trusted uv.exe on an absolute PATH entry outside the selected project: " +
      "https://docs.astral.sh/uv/",
  );
}

function writeTo(target, content) {
  if (!content) return;
  target.write(content.endsWith("\n") ? content : `${content}\n`);
}

function verificationProgram(pythonVersion) {
  const expectedParts = pythonVersion.split(".").slice(0, 2).map(Number);
  return [
    "import sys",
    "import pyboy",
    "import PIL",
    "from importlib.metadata import version",
    `expected_python = (${expectedParts[0]}, ${expectedParts[1]})`,
    "if sys.version_info[:2] != expected_python:",
    "    raise RuntimeError(f'Expected Python {expected_python[0]}.{expected_python[1]}, found {sys.version.split()[0]}')",
    "pyboy_version = version('pyboy')",
    "pillow_version = version('Pillow')",
    "if pyboy_version != '2.7.0':",
    "    raise RuntimeError(f'Expected PyBoy 2.7.0, found {pyboy_version}')",
    "try:",
    "    pillow_major = int(pillow_version.split('.', 1)[0])",
    "except (TypeError, ValueError) as error:",
    "    raise RuntimeError(f'Invalid Pillow version: {pillow_version}') from error",
    "if pillow_major not in (11, 12):",
    "    raise RuntimeError(f'Expected Pillow >=11,<13, found {pillow_version}')",
    "print('Python ' + sys.version.split()[0])",
    "print('PyBoy ' + pyboy_version)",
    "print('Pillow ' + pillow_version)",
  ].join("\n");
}

/** Install or verify the plugin-owned Windows x64 PyBoy environment without touching Unix setup. */
export function setupEmulator(options = {}) {
  const selected = parseEmulatorSetupArguments(options.argv ?? options.args ?? []);
  if (selected.help) {
    writeTo(options.stdout ?? process.stdout, SETUP_USAGE);
    return { help: true, installed: false };
  }
  if (selected.dryRun) return emulatorSetupPlan(options);
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    throw new Error("Native Node emulator setup is only supported on Windows; use runSetupEmulator on Unix.");
  }
  const architecture = options.arch ?? process.arch;
  if (architecture !== "x64") {
    throw new Error(`The native Windows PyBoy environment currently requires x64; received ${architecture}.`);
  }

  const filesystem = {
    accessSync,
    lstatSync,
    mkdirSync,
    readFileSync,
    realpathSync,
    ...options.filesystem,
  };
  const parentEnvironment = options.environment ?? process.env;
  const childEnvironment = sanitizeEmulatorSetupEnvironment(parentEnvironment, platform);
  const spawn = options.spawnSync ?? defaultSpawnSync;
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const currentDirectory = options.cwd ?? process.cwd();

  let trustedDirectory;
  try {
    trustedDirectory = filesystem.realpathSync(path.resolve(options.scriptDirectory ?? DEFAULT_SCRIPT_DIRECTORY));
  } catch {
    throw new Error("The trusted plugin scripts directory must be an existing physical directory.");
  }

  const configuredToolchain = options.toolchainRoot ?? environmentValue(parentEnvironment, "GB_STUDIO_TOOLCHAIN_ROOT", platform);
  let toolchainRoot;
  try {
    toolchainRoot = filesystem.realpathSync(path.resolve(configuredToolchain ?? path.dirname(trustedDirectory)));
    if (!filesystem.lstatSync(toolchainRoot).isDirectory()) throw new Error("not a directory");
  } catch {
    throw new Error(`The selected game toolchain root must be an existing directory: ${configuredToolchain ?? path.dirname(trustedDirectory)}`);
  }
  assertMutableToolchain(filesystem, toolchainRoot);

  const pythonVersion = options.pythonVersion ?? environmentValue(parentEnvironment, "GB_STUDIO_PYTHON_VERSION", platform) ?? "3.13";
  if (!/^\d+\.\d+(?:\.\d+)?$/.test(pythonVersion)) {
    throw new Error(`The requested emulator Python version must be an explicit numeric version: ${pythonVersion}`);
  }

  const localDirectory = path.join(toolchainRoot, ".local");
  const existingLocal = tryInspect(filesystem, localDirectory);
  if (existingLocal !== undefined) {
    assertPhysicalEntry(filesystem, localDirectory, "directory", platform, "managed .local directory");
  }
  const runtimeDirectory = path.join(localDirectory, "pyboy-venv");
  const existingRuntime = tryInspect(filesystem, runtimeDirectory) !== undefined;
  let pythonPath;
  if (existingRuntime) {
    pythonPath = inspectExistingRuntime(filesystem, runtimeDirectory, platform);
  }

  const subprocessOptions = {
    cwd: trustedDirectory,
    env: childEnvironment,
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  };

  function verify() {
    const result = spawn(pythonPath, ["-I", "-c", verificationProgram(pythonVersion)], {
      ...subprocessOptions,
      stdio: "pipe",
      maxBuffer: 1024 * 1024,
    });
    writeTo(stdout, result.stdout);
    writeTo(stderr, result.stderr);
    if (result.error) {
      writeTo(stderr, `Unable to verify the existing PyBoy interpreter: ${result.error.message}`);
      return false;
    }
    return result.status === 0 && result.signal == null;
  }

  if (existingRuntime && verify()) {
    writeTo(stdout, `Verified the optional PyBoy runtime at ${pythonPath}`);
    return { pythonPath, runtimeDirectory, created: false, repaired: false, reused: true };
  }

  if (existingRuntime) {
    writeTo(stderr, "The existing PyBoy runtime requires dependency repair; preserving its virtual environment.");
  }

  const uvExecutable = resolveUvExecutable({
    filesystem,
    environment: childEnvironment,
    platform,
    currentDirectory,
    selectedProject: environmentValue(parentEnvironment, "GB_STUDIO_PROJECT_ROOT", platform),
  });

  function runUv(args) {
    const result = spawn(uvExecutable, args, { ...subprocessOptions, stdio: "inherit" });
    if (result.error) {
      throw new Error(`Unable to run the trusted uv executable: ${result.error.message}`);
    }
    if (result.status !== 0 || result.signal != null) {
      throw new Error(
        `uv ${args[0]} failed with ${result.signal ?? `exit code ${result.status ?? "unknown"}`}; ` +
          "the existing environment was not removed or recreated.",
      );
    }
  }

  if (!existingRuntime) {
    if (existingLocal === undefined) {
      try {
        filesystem.mkdirSync(localDirectory, { mode: 0o700 });
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
    assertPhysicalEntry(filesystem, localDirectory, "directory", platform, "managed .local directory");
    runUv([
      "venv",
      "--no-project",
      "--no-config",
      "--directory",
      trustedDirectory,
      "--python",
      pythonVersion,
      runtimeDirectory,
    ]);
    assertPhysicalEntry(filesystem, localDirectory, "directory", platform, "managed .local directory");
    pythonPath = inspectExistingRuntime(filesystem, runtimeDirectory, platform);
  } else {
    pythonPath = inspectExistingRuntime(filesystem, runtimeDirectory, platform);
  }

  runUv([
    "pip",
    "install",
    "--no-config",
    "--no-sources",
    "--directory",
    trustedDirectory,
    "--python",
    pythonPath,
    "pyboy==2.7.0",
    "pillow>=11,<13",
  ]);

  assertPhysicalEntry(filesystem, localDirectory, "directory", platform, "managed .local directory");
  pythonPath = inspectExistingRuntime(filesystem, runtimeDirectory, platform);
  if (!verify()) {
    throw new Error(
      "The PyBoy environment could not import its required Python 3.13, PyBoy 2.7.0, and Pillow >=11,<13 runtimes. " +
        "Repair the existing environment and rerun setup; it was not removed or recreated.",
    );
  }

  writeTo(stdout, `Verified the optional PyBoy runtime at ${pythonPath}`);
  return {
    pythonPath,
    runtimeDirectory,
    created: !existingRuntime,
    repaired: existingRuntime,
    reused: false,
  };
}

/** Preserve the existing Unix bootstrap while exposing one portable npm entrypoint. */
export function runSetupEmulator(options = {}) {
  const arguments_ = options.argv ?? process.argv.slice(2);
  const selected = parseEmulatorSetupArguments(arguments_);
  if (selected.help) {
    writeTo(options.stdout ?? process.stdout, SETUP_USAGE);
    return 0;
  }
  if (selected.dryRun) {
    emulatorSetupPlan(options);
    return 0;
  }
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    setupEmulator({ ...options, argv: arguments_ });
    return 0;
  }

  const scriptDirectory = path.resolve(options.scriptDirectory ?? DEFAULT_SCRIPT_DIRECTORY);
  const scriptPath = path.join(scriptDirectory, "setup-emulator.sh");
  const spawn = options.spawnSync ?? defaultSpawnSync;
  const result = spawn(scriptPath, arguments_, {
    cwd: options.cwd ?? process.cwd(),
    env: options.environment ?? process.env,
    stdio: options.stdio ?? "inherit",
    shell: false,
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`Unable to launch the existing Unix emulator setup: ${result.error.message}`);
  }
  if (result.signal != null) return 128 + (os.constants.signals[result.signal] ?? 0);
  return result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = runSetupEmulator();
  } catch (error) {
    process.stderr.write(`Emulator setup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
