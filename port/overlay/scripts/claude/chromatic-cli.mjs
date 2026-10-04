#!/usr/bin/env node
/**
 * Obtain the proprietary ModRetro Chromatic CLI for the Claude Code port.
 *
 * The upstream Codex plugin embeds the vendor binaries under a redistribution
 * permission that covers only the official Codex plugin. This port therefore
 * ships no vendor executable. Instead, on the user's own machine and at the
 * user's request, it downloads the official `@modretro/chromatic-cli-<target>`
 * npm package, verifies every byte against the pins the upstream plugin already
 * records, caches the verified files outside the plugin, and installs them in
 * the unpacked single-target layout that `scripts/chromatic-runtime.mjs`
 * natively supports.
 *
 * Usage:
 *   node scripts/claude/chromatic-cli.mjs status            # JSON report, no changes
 *   node scripts/claude/chromatic-cli.mjs install [--yes]   # cache or download, then install
 *   node scripts/claude/chromatic-cli.mjs restore           # cache only, never network (hook)
 */

import { createHash } from "node:crypto";
import {
  chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import {
  CHROMATIC_MEMBERS, CHROMATIC_ROOT, CHROMATIC_TARGETS, CHROMATIC_VERSION, selectChromaticTarget,
} from "../chromatic-runtime.mjs";

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const vendorRoot = path.join(pluginRoot, CHROMATIC_ROOT);
const COMMON = ["NOTICE.md", "PROVENANCE.json", "SBOM.json"];

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

/**
 * The verified-download cache lives in its own directory. It must not live in
 * the upstream dependency root: `scripts/setup.mjs` refuses to adopt a
 * non-empty root it does not own.
 */
function cacheRoot() {
  const configured = process.env.MODRETRO_CHROMATIC_CLI_CACHE?.trim();
  if (configured) return path.resolve(configured);
  const home = os.homedir();
  if (process.platform === "darwin") return path.join(home, "Library", "Application Support", "modretro-chromatic-claude");
  if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "modretro-chromatic-claude");
  return path.join(process.env.XDG_DATA_HOME || path.join(home, ".local", "share"), "modretro-chromatic-claude");
}

function provenanceFor(target) {
  const provenance = JSON.parse(readFileSync(path.join(vendorRoot, "PROVENANCE.json"), "utf8"));
  if (provenance.version !== CHROMATIC_VERSION) throw new Error(`PROVENANCE.json describes ${provenance.version}, expected ${CHROMATIC_VERSION}.`);
  const executable = CHROMATIC_TARGETS[target];
  const notice = `${target}/THIRD_PARTY_NOTICES.txt`;
  const files = provenance.files.filter((file) => file.path === executable || file.path === notice);
  const pkg = provenance.source.packages.find((entry) => entry.name === `@modretro/chromatic-cli-${target}`);
  if (files.length !== 2 || !pkg) throw new Error(`No pinned vendor package for ${target}.`);
  for (const file of files) {
    const pin = CHROMATIC_MEMBERS[file.path];
    if (!pin || pin.sha256 !== file.sha256 || pin.size !== file.bytes) throw new Error(`Provenance and runtime pins disagree for ${file.path}.`);
  }
  return { pkg, executable, notice };
}

/** Minimal ustar reader for the two regular files in the vendor package. */
function untar(bytes) {
  const out = new Map();
  let offset = 0;
  let longName;
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break;
    const field = (start, length) => header.subarray(start, start + length).toString("utf8").replace(/\0.*$/s, "");
    const size = Number.parseInt(field(124, 12).trim() || "0", 8);
    const type = field(156, 1) || "0";
    const prefix = field(345, 155);
    let name = longName ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    longName = undefined;
    const body = bytes.subarray(offset + 512, offset + 512 + size);
    if (type === "L") longName = body.toString("utf8").replace(/\0.*$/s, "");
    else if (type === "0" || type === "\0") out.set(name, Buffer.from(body));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return out;
}

function cacheDir(target) {
  return path.join(cacheRoot(), "chromatic-cli", CHROMATIC_VERSION, target);
}

function readVerified(file, pin) {
  if (!existsSync(file)) return undefined;
  const bytes = readFileSync(file);
  return bytes.length === pin.size && sha256(bytes) === pin.sha256 ? bytes : undefined;
}

function readCache(target, plan) {
  const dir = cacheDir(target);
  const executable = readVerified(path.join(dir, "bin", path.basename(plan.executable)), CHROMATIC_MEMBERS[plan.executable]);
  const notice = readVerified(path.join(dir, "THIRD_PARTY_NOTICES.txt"), CHROMATIC_MEMBERS[plan.notice]);
  return executable && notice ? { executable, notice } : undefined;
}

function writeFileAtomic(file, bytes, mode) {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o755 });
  const temporary = `${file}.tmp-${process.pid}`;
  writeFileSync(temporary, bytes, { mode });
  chmodSync(temporary, mode);
  renameSync(temporary, file);
}

async function download(target, plan) {
  const response = await fetch(plan.pkg.url);
  if (!response.ok) throw new Error(`Download failed (${response.status}) for ${plan.pkg.url}`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (archive.length !== plan.pkg.bytes || sha256(archive) !== plan.pkg.sha256) {
    throw new Error("The downloaded vendor archive does not match its pinned size and SHA-256. Nothing was installed.");
  }
  const entries = untar(gunzipSync(archive));
  const executable = entries.get(`package/bin/${path.basename(plan.executable)}`);
  const notice = entries.get("package/THIRD_PARTY_NOTICES.txt");
  for (const [bytes, name] of [[executable, plan.executable], [notice, plan.notice]]) {
    const pin = CHROMATIC_MEMBERS[name];
    if (!bytes || bytes.length !== pin.size || sha256(bytes) !== pin.sha256) throw new Error(`Archive member ${name} does not match its pin.`);
  }
  const dir = cacheDir(target);
  writeFileAtomic(path.join(dir, "bin", path.basename(plan.executable)), executable, 0o755);
  writeFileAtomic(path.join(dir, "THIRD_PARTY_NOTICES.txt"), notice, 0o644);
  writeFileAtomic(path.join(dir, "SOURCE.json"), Buffer.from(`${JSON.stringify({
    package: plan.pkg.name, version: plan.pkg.version, url: plan.pkg.url, archiveSha256: plan.pkg.sha256,
    license: plan.pkg.license, retrievedAt: new Date().toISOString(),
  }, null, 2)}\n`), 0o644);
  return { executable, notice };
}

function installedState(target, plan) {
  const executable = readVerified(path.join(vendorRoot, plan.executable), CHROMATIC_MEMBERS[plan.executable]);
  const notice = readVerified(path.join(vendorRoot, plan.notice), CHROMATIC_MEMBERS[plan.notice]);
  const manifest = JSON.parse(readFileSync(path.join(pluginRoot, "package.json"), "utf8"));
  return Boolean(executable && notice && manifest.bundledChromaticTarget === target && !("bundledChromaticFormat" in manifest));
}

function installInto(target, plan, files) {
  // The runtime rejects any unexpected entry, so keep only the pinned members.
  for (const entry of readdirSync(vendorRoot)) {
    if (!COMMON.includes(entry) && entry !== target) rmSync(path.join(vendorRoot, entry), { recursive: true, force: true });
  }
  chmodSync(vendorRoot, 0o755);
  writeFileAtomic(path.join(vendorRoot, plan.executable), files.executable, process.platform === "win32" ? 0o644 : 0o755);
  writeFileAtomic(path.join(vendorRoot, plan.notice), files.notice, 0o644);
  for (const dir of [path.join(vendorRoot, target), path.join(vendorRoot, target, "bin")]) chmodSync(dir, 0o755);
  const manifestPath = path.join(pluginRoot, "package.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  delete manifest.bundledChromaticFormat;
  manifest.bundledChromatic = CHROMATIC_VERSION;
  manifest.bundledChromaticTarget = target;
  writeFileAtomic(manifestPath, Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), 0o644);
}

async function main() {
  const [command = "status", ...flags] = process.argv.slice(2);
  const quiet = command === "restore";
  let target;
  try { target = selectChromaticTarget(); }
  catch (error) {
    if (quiet) return;
    throw error;
  }
  const plan = provenanceFor(target);
  const report = {
    target, version: CHROMATIC_VERSION, package: plan.pkg.name, license: plan.pkg.license,
    cache: cacheDir(target), installed: installedState(target, plan), cached: Boolean(readCache(target, plan)),
  };

  if (command === "status") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (command === "restore") {
    if (report.installed || !report.cached) return;
    installInto(target, plan, readCache(target, plan));
    return;
  }
  if (command !== "install") throw new Error(`Unknown command: ${command}`);
  if (report.installed) {
    console.log(JSON.stringify({ ...report, action: "already-installed" }, null, 2));
    return;
  }
  let files = readCache(target, plan);
  let action = "installed-from-cache";
  if (!files) {
    if (!flags.includes("--yes")) {
      console.log(JSON.stringify({
        ...report, action: "confirmation-required",
        message: `This downloads ModRetro's proprietary, closed-source ${plan.pkg.name}@${plan.pkg.version} (license ${plan.pkg.license}) from ${plan.pkg.url}, verifies it against pinned SHA-256 values, and installs it for this plugin. Re-run with --yes after the user agrees.`,
      }, null, 2));
      process.exitCode = 2;
      return;
    }
    files = await download(target, plan);
    action = "downloaded-and-installed";
  }
  installInto(target, plan, files);
  console.log(JSON.stringify({ ...report, installed: installedState(target, plan), cached: true, action }, null, 2));
}

main().catch((error) => {
  if (process.argv[2] === "restore") return;
  console.error(`chromatic-cli: ${error.message}`);
  process.exitCode = 1;
});
