/** Minimal stdio MCP client that launches a plugin's server the way .mcp.json does. */

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

export function startPluginServer(pluginRoot, { env = {}, timeoutMs = 120_000 } = {}) {
  const mcp = JSON.parse(readFileSync(path.join(pluginRoot, ".mcp.json"), "utf8")).mcpServers["modretro-chromatic"];
  const child = spawn("node", [path.join(pluginRoot, "scripts", "start-mcp.mjs")], {
    cwd: pluginRoot,
    env: { ...process.env, ...mcp.env, CLAUDE_PLUGIN_ROOT: pluginRoot, ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let buffer = "";
  let stderr = "";
  const waiting = new Map();
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (!line.trim()) continue;
      const message = JSON.parse(line);
      waiting.get(message.id)?.(message);
    }
  });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  let nextId = 1;

  const request = (method, params, ms = timeoutMs) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`${method} timed out. stderr: ${stderr.slice(-800)}`)), ms);
    waiting.set(id, (message) => { clearTimeout(timer); waiting.delete(id); resolve(message); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });

  const call = async (name, args = {}, ms) => {
    const reply = await request("tools/call", { name, arguments: args }, ms);
    const content = reply.result?.content ?? [];
    const text = content.filter((item) => item.type === "text").map((item) => item.text).join("\n")
      || JSON.stringify(reply.error ?? reply.result);
    let json;
    try { json = reply.result?.structuredContent ?? JSON.parse(text); } catch { json = undefined; }
    return {
      reply, text, json,
      images: content.filter((item) => item.type === "image"),
      isError: Boolean(reply.result?.isError || reply.error),
    };
  };

  const initialize = async () => {
    const init = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "port-test", version: "0" } });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
    return init.result;
  };

  return { child, request, call, initialize, stderr: () => stderr, close: () => child.kill("SIGTERM") };
}
