#!/usr/bin/env node

/** Build a source checkout without recursively depending on a package manager. */
import { spawnSync } from "node:child_process";
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function isFile(filename) {
  return statSync(filename, { throwIfNoEntry: false })?.isFile() === true;
}

export function preparePackage(options = {}) {
  const root = path.resolve(options.repositoryRoot ?? repositoryRoot);
  const source = isFile(path.join(root, "src", "server.ts"));
  const configuration = isFile(path.join(root, "tsconfig.json"));

  // npm's prepared archive deliberately ships dist/, not the TypeScript source
  // or development dependencies. Its install must not try to rebuild them.
  if (!source && !configuration && isFile(path.join(root, "dist", "server.js"))) {
    return { mode: "compiled", status: 0 };
  }
  if (!source || !configuration) {
    throw new Error("ModRetro Chromatic preparation requires a complete source checkout or a package containing dist/server.js.");
  }

  const compiler = path.join(root, "node_modules", "typescript", "bin", "tsc");
  if (!isFile(compiler)) {
    throw new Error(
      "ModRetro Chromatic source preparation needs the local TypeScript development dependency. " +
      "Install the checkout's development dependencies (for example, npm ci --include=dev), " +
      "then run node scripts/prepare.mjs. A prepared package does not need TypeScript.",
    );
  }

  const environment = { ...(options.environment ?? process.env) };
  for (const name of Object.keys(environment)) {
    if (["NODE_OPTIONS", "NODE_PATH"].includes(name.toUpperCase())) delete environment[name];
  }
  const result = (options.spawn ?? spawnSync)(process.execPath, [compiler, "--project", path.join(root, "tsconfig.json")], {
    cwd: root,
    env: environment,
    stdio: "inherit",
    shell: false,
    windowsHide: true,
    timeout: 120_000,
  });
  if (result.error) throw new Error(`ModRetro Chromatic TypeScript preparation could not run: ${result.error.message}`, { cause: result.error });
  if (result.status !== 0) {
    const error = new Error(`ModRetro Chromatic TypeScript preparation failed (${result.signal ?? `exit ${result.status ?? "unknown"}`}).`);
    error.exitCode = Number.isInteger(result.status) && result.status > 0 ? result.status : 1;
    throw error;
  }
  return { mode: "source", status: 0 };
}

if (process.argv[1] && realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    preparePackage();
  } catch (error) {
    console.error(error.message);
    process.exitCode = error.exitCode ?? 1;
  }
}
