#!/usr/bin/env node
/**
 * Smoke-test a generated plugin without Claude Code:
 *   node port/smoke.mjs [plugins/modretro-chromatic]
 *
 * Starts the MCP server exactly as .mcp.json does, checks the tool surface and
 * Claude-facing wording, calls read-only tools, and round-trips the pixel-grid
 * helper. It never touches USB, downloads, or user projects.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPluginServer } from "./lib/mcp-client.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pluginRoot = path.resolve(process.argv[2] ?? path.join(repoRoot, "plugins", "modretro-chromatic"));
const failures = [];
const check = (condition, message) => { console.log(`${condition ? "ok  " : "FAIL"} ${message}`); if (!condition) failures.push(message); };

// ---- manifests
const mcp = JSON.parse(readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8")).mcpServers["modretro-chromatic"];
const manifest = JSON.parse(readFileSync(path.join(pluginRoot, ".claude-plugin", "plugin.json"), "utf8"));
check(manifest.name === "modretro-chromatic", "plugin.json name");
check(mcp.type === "stdio" && mcp.args[0] === "${CLAUDE_PLUGIN_ROOT}/scripts/start-mcp.mjs", ".mcp.json launcher");

// ---- MCP server
const server = startPluginServer(pluginRoot, { timeoutMs: 60_000 });
const { call } = server;

try {
  const init = await server.initialize();
  const instructions = init?.instructions ?? "";
  check(init?.serverInfo?.name === "modretro-chromatic", `server ${init?.serverInfo?.name} ${init?.serverInfo?.version}`);
  check(!instructions.includes("Codex"), "server instructions mention no Codex");
  check(instructions.includes("Browser pane"), "server instructions point at the Browser pane");

  const tools = (await server.request("tools/list", {})).result.tools;
  check(tools.length >= 81, `${tools.length} tools exposed`);
  const codexy = tools.filter((tool) => /Codex/.test(tool.description ?? ""));
  check(codexy.length === 0, `no tool description mentions Codex${codexy.length ? `: ${codexy.map((t) => t.name).join(", ")}` : ""}`);

  const status = await call("session_status");
  check(!status.isError, "session_status responds");
  const doctor = await call("toolchain_doctor");
  check(!doctor.isError, "toolchain_doctor responds");
  try {
    const summary = JSON.parse(doctor.text);
    console.log(`     toolchain: ${JSON.stringify(summary.tasks ?? summary.summary ?? Object.keys(summary)).slice(0, 300)}`);
  } catch { console.log(`     toolchain: ${doctor.text.slice(0, 300)}`); }
  const device = await call("device", { command: "status" });
  console.log(`     device status: ${device.text.slice(0, 300).replace(/\s+/g, " ")}`);
} catch (error) {
  check(false, error.message);
} finally {
  server.close();
}

// ---- pixel-grid round trip
{
  const dir = mkdtempSync(path.join(os.tmpdir(), "pxg-smoke-"));
  const helper = path.join(pluginRoot, "scripts", "claude", "pixel-grid.mjs");
  const pxg = execFileSync("node", [helper, "template", "sprite"]).toString().replace(/\.{16}\n$/, "....KKKKKKKK....\n");
  writeFileSync(path.join(dir, "a.pxg"), pxg);
  const rendered = JSON.parse(execFileSync("node", [helper, "render", path.join(dir, "a.pxg")]).toString());
  check(rendered.ok && rendered.width === 16 && rendered.height === 16, "pixel-grid render + checks");
  const extracted = JSON.parse(execFileSync("node", [helper, "extract", path.join(dir, "a.png"), "--out", path.join(dir, "b.pxg"), "--profile", "sprite"]).toString());
  const body = (file) => readFileSync(file, "utf8").split("---\n")[1];
  check(extracted.ok && body(path.join(dir, "a.pxg")) === body(path.join(dir, "b.pxg")), "pixel-grid PNG -> pxg round trip is exact");
}

// ---- vendor CLI helper (read-only)
{
  const status = JSON.parse(execFileSync("node", [path.join(pluginRoot, "scripts", "claude", "chromatic-cli.mjs"), "status"]).toString());
  check(typeof status.target === "string", `chromatic-cli status: target ${status.target}, installed ${status.installed}, cached ${status.cached}`);
}

console.log(failures.length ? `\n${failures.length} check(s) failed` : "\nall checks passed");
process.exitCode = failures.length ? 1 : 0;
