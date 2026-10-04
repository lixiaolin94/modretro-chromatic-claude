#!/usr/bin/env node

import { detectDependencies, probeDependencies, DEPENDENCY_PROBES, DEPENDENCY_TASKS } from "./dependency-doctor.mjs";

function parseArguments(args) {
  const options = {};
  const probes = [];
  let json = false;
  const paths = { "--root": "setupRoot", "--runtime-root": "runtimeRoot", "--toolchain-root": "toolchainRoot", "--python": "pythonPath", "--node": "nodeExecutable" };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--json") { json = true; continue; }
    if (argument === "--help") return { help: true };
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new TypeError("A value is required after " + argument + ".");
    if (paths[argument]) options[paths[argument]] = value;
    else if (argument === "--task" && DEPENDENCY_TASKS.includes(value)) (options.tasks ??= []).push(value);
    else if (argument === "--probe" && DEPENDENCY_PROBES.includes(value)) probes.push(value);
    else throw new TypeError("Unknown doctor option or value: " + argument + ".");
  }
  return { options, probes, json };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write("Usage: node scripts/doctor.mjs [--root ABSOLUTE_SETUP_ROOT] [--runtime-root PATH] [--toolchain-root PATH] [--python PATH] [--node PATH] [--task authoring|projectBuild|cBuild|play|desktop] [--probe cli-version|gbdk-version|emulator-import] [--json]\nDefault: passive metadata detection for projectBuild and play. Repeat --task or --probe to select more than one. Probes explicitly execute local dependencies; no ROM is loaded.\n");
    return;
  }
  const cancellation = new AbortController();
  const cancel = () => cancellation.abort(new DOMException("Doctor probes were cancelled.", "AbortError"));
  process.once("SIGINT", cancel);
  process.once("SIGTERM", cancel);
  try {
    let report = await detectDependencies(args.options);
    cancellation.signal.throwIfAborted();
    if (args.probes.length) report = await probeDependencies(report, { probes: args.probes, signal: cancellation.signal });
    if (args.json) process.stdout.write(JSON.stringify(report, null, 2) + "\n");
    else {
      process.stdout.write("Dependency metadata inspection (does not establish executed health):\n");
      for (const item of report.components) {
        process.stdout.write("[" + item.status + "] " + item.id + (item.detectedVersion ? " (" + item.detectedVersion + "; requires " + item.requiredVersion + ")" : " (requires " + item.requiredVersion + ")") + "\n");
        if (item.path) process.stdout.write("  " + item.path + "\n");
        for (const evidence of item.detectionEvidence) process.stdout.write("  " + evidence + "\n");
      }
      for (const name of report.requestedTasks) process.stdout.write("[" + (report.tasks[name].ready ? "ready" : "not-ready") + "] task " + name + "\n");
      for (const result of report.probeResults ?? []) process.stdout.write("[probe-" + result.status + "] " + result.name + (result.executed ? "" : " (not executed)") + (result.error ? ": " + result.error : "") + "\n");
      for (const next of report.nextSteps) process.stdout.write("Next: " + next + "\n");
      process.stdout.write(report.ready ? "\nRequested tasks have compatible dependency metadata.\n" : "\nRequested tasks do not have complete compatible dependency metadata.\n");
      if (!args.probes.length) process.stdout.write("No dependency subprocesses were launched. Use an explicit --probe to check executed health.\n");
    }
    if (!report.ready || report.probesPassed === false) process.exitCode = 1;
  } finally {
    process.removeListener("SIGINT", cancel);
    process.removeListener("SIGTERM", cancel);
  }
}

await main().catch((error) => {
  process.stderr.write("Doctor failed: " + (error instanceof Error ? error.message : String(error)) + "\n");
  process.exitCode = error?.name === "AbortError" ? 130 : 1;
});
