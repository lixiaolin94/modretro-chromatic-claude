#!/usr/bin/env node
/**
 * Reproducibly port the MIT-licensed "ModRetro Chromatic Plugin for Codex" to a
 * Claude Code plugin.
 *
 *   node port/port.mjs <upstream.zip | upstream-dir> [--out plugins/modretro-chromatic]
 *
 * The upstream tree is copied unchanged except for:
 *   1. Proprietary ModRetro Chromatic CLI binaries (and their packed notices) are
 *      NOT copied. Their redistribution permission covers only the official
 *      Codex plugin. `scripts/claude/chromatic-cli.mjs` fetches them on demand
 *      from ModRetro's own npm packages and verifies them against the pins.
 *   2. Packed device artwork is unpacked into plain WebP files, so the runtime
 *      reads it without the packed format flag.
 *   3. A small, count-checked set of text patches retargets user- and
 *      model-facing wording from Codex to Claude Code (browser, "ask Codex").
 *   4. Skills are renamed for Claude's `plugin:skill` namespace; their SKILL.md
 *      files are replaced by Claude-specific versions from port/overlay, while
 *      their references/assets/scripts are kept (patched).
 *   5. port/overlay is copied on top (.claude-plugin, .mcp.json, hooks, skills,
 *      scripts/claude, CLAUDE-PORT.md).
 *
 * Every patch declares how many matches it expects. If upstream changes and a
 * count differs, the port fails instead of silently producing a half-ported
 * plugin. Review the failing rule, adjust it, and re-run.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const overlayRoot = path.join(here, "overlay");

const args = process.argv.slice(2);
const input = args.find((arg) => !arg.startsWith("--"));
const outIndex = args.indexOf("--out");
const outRoot = path.resolve(outIndex >= 0 ? args[outIndex + 1] : path.join(repoRoot, "plugins", "modretro-chromatic"));
if (!input) {
  console.error("Usage: node port/port.mjs <upstream.zip | upstream-dir> [--out <plugin-dir>]");
  process.exit(1);
}

const EXPECTED_UPSTREAM = "1.0.33";
const SKILL_MAP = {
  "modretro-chromatic-authoring": "authoring",
  "modretro-chromatic-pixel-art": "pixel-art",
  "modretro-chromatic-rom-debugging": "rom-debugging",
  "chromatic-deployment": "deployment",
  "modretro-chromatic-setup": "setup",
};
const EXCLUDED = new Set([
  "third-party/chromatic-cli/executables-v2.br",
  "third-party/chromatic-cli/notices.br",
  "assets/devices/images.br",
  // Statically linked FFmpeg (LGPL-2.1) built with a patch that lives only in the
  // private upstream repository, so its corresponding source cannot be offered.
  // Only Linux physical-device capture depends on it.
  "native/capture/linux/x64/ffmpeg",
  "native/capture/linux/arm64/ffmpeg",
]);

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const log = (message) => console.log(`port: ${message}`);

// ---------------------------------------------------------------- input

function findUpstreamRoot(start, depth = 0) {
  if (existsSync(path.join(start, ".codex-plugin", "plugin.json"))) return start;
  if (depth > 3) return undefined;
  for (const entry of readdirSync(start, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "__MACOSX") continue;
    const found = findUpstreamRoot(path.join(start, entry.name), depth + 1);
    if (found) return found;
  }
  return undefined;
}

let sourceDigest;
let upstreamRoot;
const inputPath = path.resolve(input);
if (statSync(inputPath).isFile()) {
  sourceDigest = sha256(readFileSync(inputPath));
  const temporary = mkdtempSync(path.join(os.tmpdir(), "modretro-port-"));
  execFileSync("unzip", ["-q", inputPath, "-d", temporary]);
  upstreamRoot = findUpstreamRoot(temporary);
} else {
  upstreamRoot = findUpstreamRoot(inputPath);
}
if (!upstreamRoot) throw new Error("Could not find an upstream plugin root containing .codex-plugin/plugin.json.");

const upstreamPackage = JSON.parse(readFileSync(path.join(upstreamRoot, "package.json"), "utf8"));
const upstreamManifest = JSON.parse(readFileSync(path.join(upstreamRoot, ".codex-plugin", "plugin.json"), "utf8"));
if (upstreamPackage.name !== "modretro-chromatic") throw new Error(`Unexpected upstream package ${upstreamPackage.name}.`);
if (upstreamPackage.version !== EXPECTED_UPSTREAM) {
  log(`WARNING: upstream is ${upstreamPackage.version}; rules were written for ${EXPECTED_UPSTREAM}. Count checks will catch drift.`);
}
log(`upstream ${upstreamManifest.version} at ${upstreamRoot}`);

// ---------------------------------------------------------------- output

if (existsSync(outRoot)) {
  const owned = existsSync(path.join(outRoot, "PORT-MANIFEST.json"));
  if (!owned && readdirSync(outRoot).length) throw new Error(`${outRoot} exists and was not produced by this script; refusing to replace it.`);
  rmSync(outRoot, { recursive: true, force: true });
}
mkdirSync(outRoot, { recursive: true });
// Ownership marker first, so a failed run can be re-run; replaced at the end.
writeFileSync(path.join(outRoot, "PORT-MANIFEST.json"), `${JSON.stringify({ schemaVersion: 1, status: "incomplete" })}\n`);

const copied = [];
const removed = [];
function copyTree(relative = "") {
  for (const entry of readdirSync(path.join(upstreamRoot, relative), { withFileTypes: true })) {
    const rel = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.name === ".DS_Store" || entry.name === "__MACOSX") continue;
    if (rel === "skills") continue;
    if (EXCLUDED.has(rel)) { removed.push(rel); continue; }
    const from = path.join(upstreamRoot, rel);
    const to = path.join(outRoot, rel);
    if (entry.isDirectory()) { mkdirSync(to, { recursive: true }); copyTree(rel); }
    else if (entry.isFile()) { cpSync(from, to, { preserveTimestamps: false }); copied.push(rel); }
  }
}
copyTree();

// Skills: keep references/assets/scripts, drop Codex-only agents/openai.yaml.
for (const [from, to] of Object.entries(SKILL_MAP)) {
  const source = path.join(upstreamRoot, "skills", from);
  if (!existsSync(source)) throw new Error(`Upstream skill ${from} is missing.`);
  mkdirSync(path.join(outRoot, "skills", to), { recursive: true });
  for (const entry of readdirSync(source)) {
    if (entry === "SKILL.md" || entry === "agents") continue;
    cpSync(path.join(source, entry), path.join(outRoot, "skills", to, entry), { recursive: true });
  }
  // Keep the original Codex SKILL.md for reference, outside the skill folders.
  mkdirSync(path.join(outRoot, "docs", "upstream-skills"), { recursive: true });
  writeFileSync(path.join(outRoot, "docs", "upstream-skills", `${from}.md`), readFileSync(path.join(source, "SKILL.md")));
}
const extraSkills = readdirSync(path.join(upstreamRoot, "skills")).filter((name) => !(name in SKILL_MAP));
if (extraSkills.length) throw new Error(`Upstream added skills that have no Claude mapping: ${extraSkills.join(", ")}`);

// ---------------------------------------------------------------- device artwork

{
  const runtime = await import(pathToFileURL(path.join(upstreamRoot, "scripts", "chromatic-runtime.mjs")).href);
  const packed = readFileSync(path.join(upstreamRoot, "assets", "devices", "images.br"));
  const images = runtime.decodeDeviceArtwork(packed);
  for (const [name, bytes] of images) writeFileSync(path.join(outRoot, "assets", "devices", name), bytes);
  log(`unpacked ${images.size} device artwork files`);
}

// ---------------------------------------------------------------- package.json

{
  const manifest = JSON.parse(readFileSync(path.join(outRoot, "package.json"), "utf8"));
  delete manifest.bundledChromaticFormat; // unpacked layout; target is set by scripts/claude/chromatic-cli.mjs
  manifest.claudePort = { upstreamVersion: upstreamManifest.version, chromaticCli: "fetched on demand from npm" };
  writeFileSync(path.join(outRoot, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

// ---------------------------------------------------------------- text patches

const BROWSER_RULE_CODEX = "Open every `web_preview` or `device_capture` URL, including screenshot Open links, only in **Codex's built-in browser**. If it is unavailable or blocked, retain the URL and report the concrete limitation. Never launch or fall back to an external browser.";
const BROWSER_RULE_CLAUDE = "Open every `web_preview` or `device_capture` URL, including screenshot Open links, in **the host's built-in browser**. In the Claude Code desktop app that is the Browser pane (open the URL with its `preview_start`/`navigate` tool). If no built-in browser exists (for example Claude Code in a terminal), give the user the exact URL to open in their own browser; never post it anywhere else, and do not launch a browser from the shell unless the user asks. If the browser is blocked, retain the URL and report the concrete limitation.";

const report = [];
/** Apply `rules` to `files`; each rule must match exactly `count` times in total. */
function patch(label, files, rules) {
  const texts = new Map(files.map((file) => [file, readFileSync(path.join(outRoot, file), "utf8")]));
  for (const rule of rules) {
    let total = 0;
    for (const [file, text] of texts) {
      const pattern = rule.find instanceof RegExp ? rule.find : new RegExp(rule.find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g");
      const matches = text.match(pattern);
      if (!matches) continue;
      total += matches.length;
      texts.set(file, text.replace(pattern, rule.replace));
    }
    if (rule.count !== undefined && total !== rule.count) {
      throw new Error(`[${label}] expected ${rule.count} match(es) for ${String(rule.find).slice(0, 80)}…, found ${total}. Upstream changed; review this rule.`);
    }
    report.push({ label, rule: String(rule.find).slice(0, 100), matches: total });
  }
  for (const [file, text] of texts) writeFileSync(path.join(outRoot, file), text);
}

const distJs = [];
(function walk(rel) {
  for (const entry of readdirSync(path.join(outRoot, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) walk(child);
    else if (entry.name.endsWith(".js")) distJs.push(child);
  }
})("dist");

patch("runtime", distJs, [
  { find: "Ask Codex to enable local device access", replace: "Ask Claude to enable local device access", count: 2 },
  { find: "Codex can open that settings tab for you.", replace: "Claude can open that settings tab for you.", count: 3 },
  { find: "ask Codex to inspect the recording status.", replace: "ask Claude to inspect the recording status.", count: 2 },
  { find: "ask Codex for help", replace: "ask Claude for help", count: 2 },
  { find: "ask Codex to check the capture setup", replace: "ask Claude to check the capture setup", count: 1 },
  { find: "Ask Codex to check the plugin setup.", replace: "Ask Claude to check the plugin setup.", count: 1 },
  { find: "Ask Codex to recover it.", replace: "Ask Claude to recover it.", count: 1 },
  { find: "Send the annotation to ask Codex about this view.", replace: "Send the annotation to ask Claude about this view.", count: 1 },
  { find: "share this view with Codex.", replace: "share this view with Claude.", count: 1 },
  {
    find: "use web_preview to show a successful playable build early in Codex's built-in browser.",
    replace: "use web_preview to show a successful playable build early in the host's built-in browser (Claude Code desktop: the Browser pane; in a terminal, give the user the URL).",
    count: 1,
  },
  { find: "Device feeds also belong only in Codex's built-in browser.", replace: "Device feeds also belong in that built-in browser, or with the user when no built-in browser exists.", count: 1 },
  {
    find: "Open the selected project's official player only in Codex's built-in browser. If unavailable, locked or unreachable, keep the URL and state and report the browser limitation; do not launch an external browser.",
    replace: "Open the selected project's official player in the host's built-in browser (Claude Code desktop: the Browser pane). If there is no built-in browser, give the user the URL to open themselves; if it is locked or unreachable, keep the URL and state and report the browser limitation; do not launch a browser from the shell unless the user asks.",
    count: 1,
  },
  {
    find: "Open the selected project's physical Chromatic feed only in Codex's built-in browser; if unavailable, keep the URL and report the blocker without external-browser fallback.",
    replace: "Open the selected project's physical Chromatic feed in the host's built-in browser (Claude Code desktop: the Browser pane), or give the user the URL when none exists; if it is blocked, keep the URL and report the blocker.",
    count: 1,
  },
  { find: /Codex's built-in browser/g, replace: "the host's built-in browser", count: 0 },
]);

const skillMarkdown = [];
(function walk(rel) {
  for (const entry of readdirSync(path.join(outRoot, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) walk(child);
    else if (entry.name.endsWith(".md")) skillMarkdown.push(child);
  }
})("skills");

const operationalDocs = [
  "docs/agent-guide.md", "docs/stepped-playtesting.md", "docs/recorded-playtesting.md",
  "docs/chromatic-device-testing.md", "docs/wrecklight-remix.md", "docs/tilemaps.md",
  "docs/native-sprite-import.md", "docs/native-title-atlas.md", "docs/native-device-capture.md",
  "docs/runtime-validation.md", "docs/reviewed-custom-events.md", "docs/wrecklight-authoring.md",
  "docs/wrecklight-design.md", "docs/architecture.md",
].filter((file) => existsSync(path.join(outRoot, file)));

patch("guides", [...operationalDocs, ...skillMarkdown], [
  { find: BROWSER_RULE_CODEX, replace: BROWSER_RULE_CLAUDE, count: 3 },
  { find: "only in **Codex's built-in browser**", replace: "in **the host's built-in browser**" },
  { find: "Codex's built-in browser", replace: "the host's built-in browser" },
  { find: "In a supporting Codex/ChatGPT browser,", replace: "In a supporting Codex/ChatGPT browser (not available in Claude Code),", count: 1 },
  { find: "Codex provides the server namespace.", replace: "Claude Code provides the server namespace (tools appear as `mcp__plugin_modretro-chromatic_modretro-chromatic__<tool>`).", count: 1 },
  { find: "Codex plugin/MCP tools", replace: "Claude Code plugin/MCP tools", count: 1 },
  { find: "built-in Image Generation", replace: "an available image-generation tool", count: 2 },
  { find: "Image Generation", replace: "image generation" },
  // Remaining prose mentions of the agent. Leaves URLs (…-for-Codex), paths (.codex-…) and identifiers alone.
  { find: /(?<![-/.\w])Codex(?![-/\w]|\.\w)/g, replace: "Claude" },
]);

const BANNER = "> **Claude Code port:** this page describes the original Codex distribution. In the Claude Code port, Claude Code installs and updates the plugin (`/plugin`), so ignore marketplace registration, local payload, `register-personal-plugin` and `codex plugin` steps. Dependency commands (`scripts/setup.mjs doctor|plan|apply`, `toolchain_doctor`, `toolchain_prepare`) work unchanged. See [CLAUDE-PORT.md](../CLAUDE-PORT.md).\n\n";
for (const file of ["docs/setup.md", "docs/windows-setup.md", "docs/store-launcher.md", "docs/chromatic-preview-install-testing.md"]) {
  if (!existsSync(path.join(outRoot, file))) continue;
  const text = readFileSync(path.join(outRoot, file), "utf8");
  writeFileSync(path.join(outRoot, file), text.replace(/^(# .*\n\n?)/, `$1${BANNER}`));
}
{
  const notices = readFileSync(path.join(outRoot, "THIRD_PARTY_NOTICES.md"), "utf8");
  if (!notices.includes("## Linux native device capture")) throw new Error("THIRD_PARTY_NOTICES.md no longer has the Linux capture section; review the port note.");
  writeFileSync(path.join(outRoot, "THIRD_PARTY_NOTICES.md"), notices.replace("## Linux native device capture\n", "## Linux native device capture\n\n> **Claude Code port:** the Linux FFmpeg executables (`native/capture/linux/*/ffmpeg`) are **not included**. They were built with a modification that is published only in the private upstream source repository, so this port cannot offer their corresponding LGPL source. Linux physical-device capture is therefore unavailable; the section below describes the upstream build.\n"));
}
{
  const readme = readFileSync(path.join(outRoot, "README.md"), "utf8");
  writeFileSync(path.join(outRoot, "README.md"), `${BANNER.replace("../CLAUDE-PORT.md", "CLAUDE-PORT.md")}${readme}`);
}

// ---------------------------------------------------------------- overlay

cpSync(overlayRoot, outRoot, { recursive: true });
log("applied overlay");

// The runtime refuses unexpected entries in the vendor directory; make sure only
// the MIT-compatible notice/provenance documents remain until a fetch.
{
  const vendor = path.join(outRoot, "third-party", "chromatic-cli");
  const left = readdirSync(vendor).sort();
  if (left.join(",") !== "NOTICE.md,PROVENANCE.json,SBOM.json") throw new Error(`Unexpected vendor files: ${left.join(", ")}`);
}

// ---------------------------------------------------------------- manifest

writeFileSync(path.join(outRoot, "PORT-MANIFEST.json"), `${JSON.stringify({
  schemaVersion: 1,
  upstream: { name: upstreamManifest.name, version: upstreamManifest.version, repository: upstreamManifest.repository, archiveSha256: sourceDigest ?? null },
  generatedAt: new Date().toISOString(),
  skills: SKILL_MAP,
  removed,
  patches: report,
}, null, 2)}\n`);
log(`wrote ${outRoot} (${copied.length} upstream files, removed ${removed.length} vendor-packed files)`);
