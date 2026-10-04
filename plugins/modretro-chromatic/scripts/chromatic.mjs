#!/usr/bin/env node
/** Explicit vendor CLI entrypoint. No startup probe, retries, reset or forced timeout. */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CHROMATIC_FILES, CHROMATIC_TARGETS, resolveChromaticRuntime } from "./chromatic-runtime.mjs";

export const CHROMATIC_LIVE_DEFAULT_DURATION_SECONDS = 60;
export const CHROMATIC_LIVE_MIN_DURATION_SECONDS = 0.1;
export const CHROMATIC_LIVE_MAX_DURATION_SECONDS = 300;

function vendorEnvironment() {
  return Object.fromEntries(Object.entries(process.env).filter(([name]) =>
    !/^(?:DYLD_|LD_)/iu.test(name) && !["NODE_OPTIONS", "NODE_PATH"].includes(name.toUpperCase())));
}

export function systemElevationExecutable(platform, environment, { lstat = lstatSync, realpath = realpathSync.native } = {}) {
  let filename;
  if (platform === "linux") filename = "/usr/bin/pkexec";
  else {
    const roots = Object.entries(environment).filter(([name]) => name.toUpperCase() === "SYSTEMROOT").map(([, value]) => value);
    if (!roots.length || roots.some((value) => value !== roots[0]) || !/^[A-Za-z]:[\\/]/u.test(roots[0]) || /[\0\r\n]/u.test(roots[0])) {
      throw new Error("Driver setup needs one unambiguous absolute Windows SystemRoot.");
    }
    filename = path.win32.join(roots[0], "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  }
  const paths = platform === "win32" ? path.win32 : path.posix;
  let current = filename;
  while (true) {
    const entry = lstat(current);
    // Windows servicing legitimately hardlinks PowerShell into WinSxS. Trust
    // the host's SystemRoot; these path checks are not signature verification.
    if (entry.isSymbolicLink() || (current === filename ? !entry.isFile() || (platform !== "win32" && entry.nlink !== 1) : !entry.isDirectory())
      || paths.relative(current, realpath(current)) !== ""
      || (platform === "linux" && (entry.uid !== 0 || (entry.mode & 0o022)))) {
      throw new Error(`Driver setup requires an unredirected OS elevation executable: ${filename}`);
    }
    const parent = paths.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return filename;
}

/** Fixed driver-only consent route. Paths are data, never shell fragments. */
export function chromaticInvocation(runtime, args, {
  platform = process.platform, environment = vendorEnvironment(), resolveElevationExecutable = systemElevationExecutable, operationId = randomUUID(),
} = {}) {
  validateChromaticArguments(args);
  if (args[0] !== "install-drivers" || args.length !== 4 || !["linux", "win32"].includes(platform)) {
    return { command: runtime.executable, args, environment };
  }
  const executable = resolveElevationExecutable(platform, environment);
  if (typeof operationId !== "string" || !/^[A-Za-z0-9-]{1,128}$/u.test(operationId)) throw new Error("Invalid driver operation identity.");
  if (platform === "linux") return {
    command: executable, args: ["--disable-internal-agent", runtime.executable, ...args], environment,
    elevation: { method: "polkit", operationId, requestedExecutable: runtime.executable, requestedArgs: [...args],
      outputScope: "vendor-or-polkit", note: "OS desktop consent only; no terminal/password fallback. Numeric exit codes alone do not distinguish a polkit refusal from a vendor exit." },
  };
  const sha256 = CHROMATIC_FILES[CHROMATIC_TARGETS[runtime.platform]];
  if (!sha256) throw new Error("Driver setup requires an exact bundled Windows target.");
  const configuration = Buffer.from(JSON.stringify({ executable: runtime.executable, sha256, operationId }), "utf8").toString("base64");
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$config = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${configuration}')) | ConvertFrom-Json
$result = [ordered]@{ schemaVersion = 1; source = 'codex-chromatic-uac'; operationId = $config.operationId; executable = $config.executable; sha256 = $config.sha256; args = @('install-drivers','--format','json','--yes'); phase = 'verify'; launchAttempted = $false; vendorStdout = 'unobserved'; vendorStderr = 'unobserved' }
$child = $null
$locked = $null
$hasher = $null
try {
  $cursor = [IO.Path]::GetFullPath($config.executable)
  if ($cursor -cne $config.executable) { throw 'The bundled executable path changed.' }
  while ($cursor) {
    if (([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'A bundled executable ancestor is redirected.' }
    $parent = [IO.Path]::GetDirectoryName($cursor)
    if ($parent -eq $cursor) { break }
    $cursor = $parent
  }
  $locked = [IO.File]::Open($config.executable, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
  $hasher = [Security.Cryptography.SHA256]::Create()
  $actual = [BitConverter]::ToString($hasher.ComputeHash($locked)).Replace('-','').ToLowerInvariant()
  if ($actual -cne $config.sha256) { throw 'The bundled driver executable changed before OS consent.' }
  $start = New-Object Diagnostics.ProcessStartInfo
  $start.FileName = $config.executable
  $start.Arguments = 'install-drivers --format json --yes'
  $start.WorkingDirectory = [IO.Path]::GetDirectoryName($config.executable)
  $start.UseShellExecute = $true
  $start.Verb = 'runas'
  $child = New-Object Diagnostics.Process
  $child.StartInfo = $start
  $result.phase = 'request'
  $result.launchAttempted = $true
  [Console]::Error.WriteLine((@{ source = 'codex-chromatic-uac'; operationId = $config.operationId; event = 'consent-requested'; at = [DateTime]::UtcNow.ToString('o') } | ConvertTo-Json -Compress))
  if (-not $child.Start()) { throw 'Windows did not return a process handle.' }
  $result.phase = 'running'
  $result.vendorPid = $child.Id
  $result.startObservedAt = [DateTime]::UtcNow.ToString('o')
  [Console]::Error.WriteLine((@{ source = 'codex-chromatic-uac'; operationId = $config.operationId; event = 'vendor-started'; pid = $child.Id; at = $result.startObservedAt } | ConvertTo-Json -Compress))
  $child.WaitForExit()
  $result.vendorExitCode = $child.ExitCode
  $result.exitObservedAt = [DateTime]::UtcNow.ToString('o')
  $result.phase = 'closed'
  [Console]::Error.WriteLine((@{ source = 'codex-chromatic-uac'; operationId = $config.operationId; event = 'vendor-exited'; pid = $child.Id; exitCode = $child.ExitCode; at = $result.exitObservedAt } | ConvertTo-Json -Compress))
} catch {
  $failure = $_.Exception
  while ($failure.InnerException) { $failure = $failure.InnerException }
  $result.error = [ordered]@{ name = $failure.GetType().FullName; message = $failure.Message }
  if ($failure -is [ComponentModel.Win32Exception]) { $result.error.nativeErrorCode = $failure.NativeErrorCode }
} finally {
  $disposalErrors = @()
  foreach ($handle in @($child, $hasher, $locked)) {
    if ($handle) { try { $handle.Dispose() } catch { $disposalErrors += $_.Exception.Message } }
  }
  if ($disposalErrors.Count -eq 0) { $result.handlesDisposed = $true }
  else { $result.disposalError = $disposalErrors -join '; ' }
}
$result | ConvertTo-Json -Compress -Depth 4
if ($result.phase -eq 'closed' -and $result.vendorExitCode -eq 0 -and $result.handlesDisposed -eq $true -and -not $result.error) { exit 0 }
exit 1
`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  if (encoded.length > 24000) throw new Error("Driver setup command exceeds its Windows argument bound.");
  return {
    command: executable, args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded], environment,
    elevation: { method: "windows-run-as", operationId, requestedExecutable: runtime.executable, requestedArgs: [...args], sha256,
      outputScope: "os-broker-only", note: "Vendor stdout/stderr are unavailable through direct UAC. The broker reports only its observed vendor process handle and exit; this is not driver-health proof." },
  };
}

export function validateChromaticArguments(args) {
  if (!Array.isArray(args) || args.some((arg) => typeof arg !== "string" || arg.includes("\0"))) throw new Error("Chromatic arguments must be explicit strings.");
  if (!["--help", "-h", "--version", "-V", "help", "list-devices", "detect-cart", "reset-device", "write-homebrew", "install-drivers", "live-demo"].includes(args[0])) throw new Error("Select an explicit public Chromatic command; no default operation is run.");
  if (args[0] === "install-drivers") {
    const help = args.length === 2 && ["--help", "-h"].includes(args[1]);
    const install = args.length === 4 && args[1] === "--format" && args[2] === "json" && args[3] === "--yes";
    if (!help && !install) throw new Error("Driver installation requires: install-drivers --format json --yes. Obtain explicit human/system-administrator authorization for system changes first; use install-drivers --help for help only.");
  }
  if (args[0] === "write-homebrew" && !args.includes("--help") && !args.includes("-h")) {
    if (args.length !== 9 || !path.isAbsolute(args[1]) || args[2] !== "--player" || !/^[1-8]$/u.test(args[3]) ||
        args[4] !== "--expect-sha256" || !/^[a-f0-9]{64}$/u.test(args[5]) || args[6] !== "--format" || args[7] !== "json" || args[8] !== "--yes") {
      throw new Error("Writing requires: write-homebrew <absolute ROM> --player <number> --expect-sha256 <sha256> --format json --yes. Obtain permission for that exact write first.");
    }
  }
  if (args[0] === "live-demo" && !(args.length === 2 && ["--help", "-h"].includes(args[1]))) {
    const duration = Number(args[7]);
    const save = args.length === 12 && args[11] === "--no-save"
      || args.length === 13 && args[11] === "--save-dir" && path.isAbsolute(args[12]);
    if (!save || !path.isAbsolute(args[1] ?? "") || args[2] !== "--player" || !/^[1-8]$/u.test(args[3] ?? "")
      || args[4] !== "--expect-sha256" || !/^[a-f0-9]{64}$/u.test(args[5] ?? "") || args[6] !== "--duration"
      || !/^(?:\d+(?:\.\d+)?|\.\d+)$/u.test(args[7] ?? "") || !Number.isFinite(duration)
      || duration < CHROMATIC_LIVE_MIN_DURATION_SECONDS || duration > CHROMATIC_LIVE_MAX_DURATION_SECONDS
      || args[8] !== "--format" || args[9] !== "jsonl" || args[10] !== "--yes") {
      throw new Error("Live demo requires one absolute ROM, explicit player and SHA-256, a duration from 0.1 to 300 seconds, --format jsonl --yes, and exactly one of --no-save or --save-dir <absolute directory>.");
    }
  }
  return args;
}

export async function runChromatic(args, { root, platform, arch, glibcVersion, spawnChild = spawn, signalSource = process, resolveElevationExecutable, operationId } = {}) {
  validateChromaticArguments(args);
  const runtime = resolveChromaticRuntime({ root, platform, arch, glibcVersion });
  // Inherit normal vendor configuration, but never accept dynamic-loader injection.
  const env = vendorEnvironment();
  const launch = chromaticInvocation(runtime, args, { platform, environment: env, resolveElevationExecutable, operationId });
  const interruptions = [];
  const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((name) => [name, () => {
    interruptions.push(name);
    // Never abandon a live vendor process or add a write-interrupting kill/reset.
    console.error(`Chromatic wrapper received ${name}; waiting for the current vendor process to close. No retry or reset will run.`);
  }]);
  for (const [name, handler] of handlers) signalSource.on(name, handler);
  try {
    const child = spawnChild(launch.command, launch.args, { shell: false, stdio: "inherit", env: launch.environment, windowsHide: true });
    return await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal, pid: child.pid, interruptions }));
    });
  } finally {
    for (const [name, handler] of handlers) signalSource.off(name, handler);
  }
}

export const CHROMATIC_STREAM_LIMIT = 512 * 1024;

function errorFields(error) {
  const result = { name: error?.name ?? "Error", message: error?.message ?? String(error) };
  for (const key of ["code", "errno", "syscall", "path"]) {
    if (typeof error?.[key] === "string" || typeof error?.[key] === "number") result[key] = error[key];
  }
  return result;
}

/** Positive launch provenance: constructed only before a child exists. */
export class ChromaticNotStartedError extends Error {
  constructor(error) {
    super(error instanceof Error ? error.message : String(error), { cause: error });
    this.name = "ChromaticNotStartedError";
    this.code = typeof error?.code === "string" ? error.code : "CHROMATIC_NOT_STARTED";
  }
}

/** MCP transport: capture both pipes and own the original child through close.
 * A client timeout is not permission to interrupt a flash or start another one.
 * Overflow is reported, while the pipes continue draining without killing it.
 */
export async function runChromaticCaptured(args, {
  root, platform, arch, glibcVersion, spawnChild = spawn, signalSource = process, onEvent = () => {}, onOutput = () => {},
  resolveElevationExecutable, operationId,
} = {}) {
  let runtime, launch;
  try {
    validateChromaticArguments(args);
    runtime = resolveChromaticRuntime({ root, platform, arch, glibcVersion });
    launch = chromaticInvocation(runtime, args, { platform, resolveElevationExecutable, operationId });
  } catch (error) { throw new ChromaticNotStartedError(error); }
  const startedAt = new Date().toISOString();
  const interruptions = [];
  const observationErrors = [];
  const observationCounts = { failedCallbacks: 0, skippedCallbacks: 0 };
  const failedSinks = new Set();
  const observe = (sink, callback) => {
    if (failedSinks.has(sink)) { observationCounts.skippedCallbacks++; return; }
    try { callback(); } catch (error) {
      observationErrors.push({ ...errorFields(error), sink });
      observationCounts.failedCallbacks++;
      failedSinks.add(sink);
    }
  };
  const emit = (event) => {
    observe("events", () => onEvent(event));
  };
  const handlers = ["SIGINT", "SIGTERM", "SIGHUP"].map((name) => [name, () => {
    interruptions.push(name);
    emit({ type: "interruption", signal: name, at: new Date().toISOString() });
  }]);
  for (const [name, handler] of handlers) signalSource.on(name, handler);
  try {
    let child;
    try {
      child = spawnChild(launch.command, launch.args, {
        shell: false, stdio: ["ignore", "pipe", "pipe"], env: launch.environment, windowsHide: true,
      });
    } catch (error) { throw new ChromaticNotStartedError(error); }
    const result = {
      command: launch.command, args: [...launch.args], version: runtime.version, target: runtime.platform,
      ...(launch.elevation ? { elevation: launch.elevation } : {}),
      startedAt, ...(child.pid === undefined ? {} : { pid: child.pid }), interruptions, observationErrors, observationCounts,
    };
    emit({ type: "started", ...result });
    const streams = {};
    let elevationProgress = "";
    let progressOverflow = false;
    for (const name of ["stdout", "stderr"]) {
      const state = { bytes: 0, retainedBytes: 0, truncated: false, endObserved: false, closeObserved: false, chunks: [] };
      streams[name] = state;
      const stream = child[name];
      if (!stream) continue;
      stream.on("data", (value) => {
        const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
        state.bytes += bytes.length;
        const keep = Math.min(bytes.length, CHROMATIC_STREAM_LIMIT - state.retainedBytes);
        if (keep > 0) { state.chunks.push(Buffer.from(bytes.subarray(0, keep))); state.retainedBytes += keep; }
        state.truncated = state.bytes > state.retainedBytes;
        observe("output", () => onOutput(name, bytes));
        if (name === "stderr" && launch.elevation?.method === "windows-run-as" && !progressOverflow) {
          elevationProgress += bytes.toString("utf8");
          if (Buffer.byteLength(elevationProgress) > 4096) {
            progressOverflow = true; elevationProgress = "";
            observationErrors.push({ name: "ElevationProgressOverflow", message: "OS-broker progress exceeded its bound; raw stderr continues draining." });
          }
          let newline;
          while ((newline = elevationProgress.indexOf("\n")) >= 0) {
            const line = elevationProgress.slice(0, newline); elevationProgress = elevationProgress.slice(newline + 1);
            try {
              const event = JSON.parse(line);
              if (event.source === "codex-chromatic-uac" && event.operationId === launch.elevation.operationId
                && ["consent-requested", "vendor-started", "vendor-exited"].includes(event.event)) {
                emit({ type: "elevation-progress", scope: "os-broker-observation", source: event.source,
                  operationId: event.operationId, event: event.event, at: event.at,
                  ...(Object.hasOwn(event, "pid") ? { pid: event.pid } : {}),
                  ...(Object.hasOwn(event, "exitCode") ? { exitCode: event.exitCode } : {}) });
              }
            } catch { /* Non-protocol diagnostics remain in the complete raw stderr. */ }
          }
        }
      });
      stream.once("end", () => { state.endObserved = true; });
      stream.once("close", () => { state.closeObserved = true; });
      stream.once("error", (error) => { state.error = errorFields(error); });
    }
    return await new Promise((resolve) => {
      child.once("spawn", () => {
        result.spawn = { at: new Date().toISOString(), ...(child.pid === undefined ? {} : { pid: child.pid }) };
        emit({ type: "spawn", ...result.spawn });
      });
      child.once("error", (error) => {
        result.error = errorFields(error);
        emit({ type: "error", at: new Date().toISOString(), error: result.error });
        // Node emits close after a failed spawn too. Do not discard that boundary.
      });
      child.once("exit", (code, signal) => {
        result.exit = { code, signal, at: new Date().toISOString() };
        emit({ type: "exit", ...result.exit });
      });
      child.once("close", (code, signal) => {
        result.close = { code, signal, at: new Date().toISOString() };
        emit({ type: "close", ...result.close });
        // Node's own final-pipe listener can emit child.close before our
        // stream.close listener. Snapshot after that same event has finished.
        queueMicrotask(() => {
          for (const name of ["stdout", "stderr"]) {
            const { chunks, ...state } = streams[name];
            const bytes = Buffer.concat(chunks);
            const text = bytes.toString("utf8");
            result[name] = { ...state, text, utf8Valid: Buffer.from(text).equals(bytes) };
          }
          resolve(result);
        });
      });
    });
  } finally {
    for (const [name, handler] of handlers) signalSource.off(name, handler);
  }
}

if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const result = await runChromatic(process.argv.slice(2));
    if (result.signal || result.code === null || result.interruptions.length) console.error(`Chromatic command was interrupted or lacked a normal exit (vendor code ${result.code}, signal ${result.signal}); retain the original result and do not retry automatically.`);
    process.exitCode = !result.interruptions.length && Number.isInteger(result.code) ? result.code : 1;
  } catch (error) {
    console.error(`Chromatic command could not complete: ${error.message}. No retry was attempted.`);
    process.exitCode = 1;
  }
}
