#!/usr/bin/env node
/** Developer client: one foreground session, only the package's public MCP. */
import { createRequire } from "node:module";
import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

const publicTools = ["device", "setup", "flash", "play", "rom_inspect"];
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const isReadOnly = (tool, input) => tool === "rom_inspect" || (tool === "device" && ["status", "operation_status"].includes(input.command));
const message = (error) => error instanceof Error ? error.message : String(error);
const rejectedInput = (reason) => Object.assign(new Error(`Public tool input rejected before dispatch: ${reason}`), { code: "MCP_INPUT_INVALID", completion: "not-dispatched" });

// The published flat schemas keep tool clients compatible. Apply command-specific
// constraints before assuming ownership of a call the server cannot admit.
function validateCommand(tool, input) {
  if (tool === "device") {
    const allowed = { status: [], list_devices: ["requestId"], operation_status: ["operationId", "requestId"] };
    if (!Object.hasOwn(allowed, input.command)) throw rejectedInput("unknown device command");
    if (Object.keys(input).some((key) => key !== "command" && !allowed[input.command].includes(key))) throw rejectedInput("fields do not match the selected device command");
    if (input.command === "operation_status" && (input.operationId !== undefined) === (input.requestId !== undefined)) throw rejectedInput("operation_status needs exactly one of operationId or requestId");
  }
  if (tool === "setup") {
    const required = { install_drivers: "sessionId", detect_cartridge: "deviceToken" };
    if (!Object.hasOwn(required, input.command)) throw rejectedInput("unknown setup command");
    const field = required[input.command];
    if (input[field] === undefined || Object.keys(input).some((key) => !["command", "requestId", "confirm", field].includes(key))) throw rejectedInput(`the selected setup command requires only ${field} in addition to requestId and confirm`);
  }
  if (["setup", "flash", "play"].includes(tool) && input.confirm !== true) throw rejectedInput("the requested setup, live-play, or write action requires confirm:true");
}

/** Internal options supply test signals/timeouts; public calls retain their exact arguments. */
export async function openDeviceMcpSession({ packageRoot, workspaceRoot, signalSource = process, requestTimeoutMs = 60_000, maxBufferSize }) {
  const root = await realpath(packageRoot);
  const config = JSON.parse(await readFile(path.join(root, ".mcp.json"), "utf8")).mcpServers?.["modretro-chromatic"];
  if (!config || config.type !== "stdio" || typeof config.command !== "string"
    || !Array.isArray(config.args) || config.args.some((arg) => typeof arg !== "string")) {
    throw new Error("Select a compiled plugin with its ordinary modretro-chromatic stdio configuration.");
  }
  const runtime = await realpath(config.env?.GB_STUDIO_RUNTIME_ROOT ?? root);
  const manifest = JSON.parse(await readFile(path.join(runtime, "package.json"), "utf8"));
  let dependencies;
  if (manifest.bundledMcp === true) {
    dependencies = await import(pathToFileURL(path.join(runtime, "scripts/device-client-deps.mjs")).href);
  } else {
    const require = createRequire(path.join(runtime, "package.json"));
    dependencies = {
      ...await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js")).href),
      ...await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js")).href),
      ...await import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/validation/ajv")).href),
    };
  }
  const { Client, StdioClientTransport, getDefaultEnvironment, AjvJsonSchemaValidator } = dependencies;
  let pending; let inFlight = false; let stopped = false; let transportClosed = false;
  let closePromise; let deferredCloseCount = 0;
  const interruptions = []; const transportErrors = [];
  let interruptionCount = 0; let transportErrorCount = 0;
  // Also fences the SDK's own close-on-buffer-error path. No SDK internals,
  // detach, replacement server, or signal to an uncertain device operation.
  class DeviceTransport extends StdioClientTransport {
    async close() {
      if (pending && !transportClosed) { deferredCloseCount++; return; }
      return super.close();
    }
  }
  const transport = new DeviceTransport({
    command: config.command === "node" ? process.execPath : config.command,
    args: config.args, cwd: path.resolve(root, config.cwd ?? "."),
    env: { ...getDefaultEnvironment(), ...config.env,
      ...(workspaceRoot ? { GB_STUDIO_WORKSPACE_ROOT: await realpath(workspaceRoot) } : {}),
    }, stderr: "pipe", ...(maxBufferSize === undefined ? {} : { maxBufferSize }),
  });
  const stderrChunks = []; let stderrBytes = 0; let stderrRetainedBytes = 0;
  transport.stderr?.on("data", (chunk) => {
    const bytes = Buffer.from(chunk); stderrBytes += bytes.length;
    const keep = Math.min(bytes.length, 512 * 1024 - stderrRetainedBytes);
    if (keep > 0) { stderrChunks.push(Buffer.from(bytes.subarray(0, keep))); stderrRetainedBytes += keep; }
  });
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"].map((signal) => [signal, () => {
    stopped = true; interruptionCount++;
    if (interruptions.length < 16) interruptions.push(signal);
    process.stderr.write("No new action will start. Waiting for the original public MCP operation; no retry or device reset.\n");
  }]);
  const removeSignals = () => { for (const [signal, handler] of signals) signalSource.off(signal, handler); };
  for (const [signal, handler] of signals) signalSource.on(signal, handler);
  transport.onclose = () => { transportClosed = true; removeSignals(); };
  transport.onerror = (error) => { transportErrorCount++; if (transportErrors.length < 16) transportErrors.push(message(error)); };
  const client = new Client({ name: "modretro-public-device-client", version: "0.1.0" });
  function observe(result, initial = false) {
    if (!pending) return;
    const value = result.structuredContent;
    if (!isObject(value)) return;
    if (initial && result.isError && value.operationStarted === false) { pending = undefined; return; }
    if (initial && typeof value.operationId === "string") pending.operationId = value.operationId;
    const matches = pending.operationId ? value.operationId === pending.operationId
      : pending.requestId && value.requestId === pending.requestId;
    if (matches && ["succeeded", "failed"].includes(value.state)) { pending = undefined; return; }
    if (matches && typeof value.operationId === "string") pending.operationId = value.operationId;
    // Recover only a unique new discovery in this same dedicated server.
    // The baseline distinguishes a completed discovery from old history;
    // neither idle status nor OPERATION_UNKNOWN clears an uncertain dispatch.
    const baseline = pending.discoveryBaseline;
    if (!pending.operationId && !pending.requestId && baseline && value.sessionId === baseline.sessionId && Array.isArray(value.operations)) {
      const candidates = value.operations.filter((operation) => isObject(operation) && operation.command === "list_devices"
        && typeof operation.operationId === "string" && !baseline.operationIds.includes(operation.operationId));
      if (candidates.length === 1) pending.operationId = candidates[0].operationId;
    }
  }
  const state = () => ({
    packageRoot: root, runtimeRoot: runtime, transportClosed, stopped, pendingOperation: pending ? { ...pending } : null,
    deferredCloseCount, stderr: Buffer.concat(stderrChunks).toString("utf8"), stderrBytes,
    stderrTruncated: stderrRetainedBytes < stderrBytes, interruptions: [...interruptions], interruptionCount,
    transportErrors: [...transportErrors], transportErrorCount,
  });
  async function close() {
    stopped = true;
    if (pending && !transportClosed) return { closeDeferred: true, completion: "unverified", ...state() };
    if (!closePromise) closePromise = (async () => {
      try { await client.close(); return { clientCloseResolved: true }; }
      catch (error) { return { clientCloseError: message(error) }; }
      finally { removeSignals(); }
    })();
    return { ...await closePromise, ...state() };
  }
  let tools; const inputValidators = new Map();
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    tools = listed.tools.filter((entry) => ["device", "setup", "flash", "play"].includes(entry.name));
    if (tools.length !== 4 || listed.tools.some((entry) => entry.name.startsWith("chromatic_"))) throw new Error("The selected package does not expose device, setup, flash and play.");
    for (const entry of listed.tools.filter((entry) => publicTools.includes(entry.name))) {
      inputValidators.set(entry.name, new AjvJsonSchemaValidator().getValidator(entry.inputSchema));
    }
  } catch (error) {
    await close();
    throw error;
  }
  async function call(tool, input = {}, onAccepted) {
    if (!publicTools.includes(tool) || !isObject(input)) throw new Error("Use device, setup, flash, play, or rom_inspect with a JSON argument object.");
    if (inFlight) throw new Error("This client serializes requests in its original MCP session.");
    const validation = inputValidators.get(tool)?.(input);
    if (!validation?.valid) throw rejectedInput(validation?.errorMessage ?? "tool unavailable");
    validateCommand(tool, input);
    const readOnly = isReadOnly(tool, input);
    if ((stopped || pending) && !readOnly) throw new Error("A previous action is interrupted or unresolved. Only read its original status; do not start another action.");
    if (transportClosed) throw new Error("The original MCP transport closed. No replacement session or replay was started.");
    let initial; let result; let discoveryBaseline; let polls = 0; let dispatched = false;
    inFlight = true;
    try {
      let baseline;
      if (tool === "device" && input.command === "list_devices" && input.requestId === undefined) {
        discoveryBaseline = await client.callTool({ name: "device", arguments: { command: "status" } }, undefined, { timeout: requestTimeoutMs });
        const value = discoveryBaseline.structuredContent;
        if (discoveryBaseline.isError || typeof value?.sessionId !== "string" || !Array.isArray(value.operations)
          || value.operations.some((operation) => !isObject(operation) || typeof operation.operationId !== "string")) throw new Error("Could not bind this session's discovery history; no discovery was dispatched.");
        baseline = { sessionId: value.sessionId, operationIds: value.operations.map((operation) => operation.operationId) };
        if (stopped) throw new Error("Interrupted before discovery dispatch; no device action was started.");
      }
      if (!readOnly) pending = { tool, arguments: input, ...(baseline ? { discoveryBaseline: baseline } : {}),
        ...(typeof input.requestId === "string" ? { requestId: input.requestId } : {}) };
      dispatched = true;
      initial = await client.callTool({ name: tool, arguments: input }, undefined, { timeout: requestTimeoutMs });
      result = initial; observe(result, !readOnly);
      if (typeof result.structuredContent?.operationId === "string") onAccepted?.(result);
      while (result.structuredContent?.state === "running") {
        await delay(250);
        result = await client.callTool({ name: "device", arguments: { command: "operation_status", operationId: result.structuredContent.operationId } }, undefined, { timeout: requestTimeoutMs });
        polls++; observe(result);
      }
      return { tool, arguments: input, discoveryBaseline, initial, result, polls, completion: pending ? "unverified" : "observed", automaticRetry: false };
    } catch (error) {
      return { tool, arguments: input, discoveryBaseline, initial, result, polls, error: message(error),
        completion: dispatched ? "unverified" : "not-dispatched", automaticRetry: false };
    } finally { inFlight = false; }
  }
  async function reconcile() {
    if (!pending || transportClosed) return state();
    const query = pending.operationId ? { command: "operation_status", operationId: pending.operationId }
      : pending.requestId ? { command: "operation_status", requestId: pending.requestId } : { command: "status" };
    return call("device", query);
  }
  return { tools, call, close, reconcile, state };
}

/** One-shot mode is passive only; device workflows need the same-session API or --jsonl. */
export async function runDeviceMcp({ tool, arguments: input = {}, schemaOnly = false, ...options }) {
  if (!schemaOnly && (!isObject(input) || !isReadOnly(tool, input))) throw new Error("One-shot mode is passive only. Use --jsonl for discovery, setup, flash, and play in one MCP session.");
  const session = await openDeviceMcpSession(options);
  const result = schemaOnly ? { tools: session.tools } : await session.call(tool, input);
  return { ...result, ...await session.close() };
}

export async function runDeviceMcpJsonl(options, input = process.stdin, output = process.stdout) {
  const session = await openDeviceMcpSession(options);
  const lines = createInterface({ input, crlfDelay: Infinity, terminal: false });
  const iterator = lines[Symbol.asyncIterator]();
  const firstLine = iterator.next(); // Subscribe before ready can trigger a reply.
  const emit = (value) => output.write(JSON.stringify(value) + "\n");
  let pendingRequestId; let failed = false; let closing;
  emit({ event: "ready", ...session.state(), tools: session.tools });
  try {
    for (let item = await firstLine; !item.done; item = await iterator.next()) {
      const line = item.value;
      let request;
      try {
        if (Buffer.byteLength(line) > 65536) throw new Error("A client request must not exceed 64 KiB.");
        request = JSON.parse(line);
        if (!isObject(request) || typeof request.id !== "string" || request.id.length > 128) throw new Error("Each line needs a short string id.");
        if (request.close === true) break;
        if (!session.state().pendingOperation && isObject(request.arguments) && !isReadOnly(request.tool, request.arguments)) pendingRequestId = request.id;
        emit({ id: request.id, event: "dispatch", tool: request.tool, arguments: request.arguments });
        const result = await session.call(request.tool, request.arguments, (accepted) => emit({ id: request.id, event: "accepted", result: accepted }));
        if (result.error || result.result?.isError || result.completion === "unverified") failed = true;
        emit({ id: request.id, event: result.completion === "unverified" ? "unknown" : "result", ...result });
      } catch (error) { failed = true; emit({ ...(request?.id ? { id: request.id } : {}), event: "error", error: message(error),
        ...(error?.completion === "not-dispatched" ? { completion: "not-dispatched" } : {}), ...session.state() }); }
    }
  } finally {
    lines.close();
    closing = await session.close();
    if (closing.closeDeferred) emit({ event: "close-deferred", ...closing });
    // Remain a foreground owner after EOF: query only the original operation.
    // A broken transport/unknown result is never replaced by a forced close.
    let lastRecovery;
    while (closing.closeDeferred && !session.state().transportClosed) {
      await delay(1000);
      const original = session.state().pendingOperation;
      let recovered;
      try { recovered = await session.reconcile(); }
      catch (error) { recovered = { error: message(error), completion: "unverified" }; }
      const fingerprint = JSON.stringify(recovered);
      if (fingerprint !== lastRecovery) {
        emit({ id: pendingRequestId, event: recovered.completion === "observed" ? "result" : "unknown", recovered: true, original, ...recovered });
        lastRecovery = fingerprint;
      }
      closing = await session.close();
    }
    emit({ event: "closed", ...closing });
  }
  return { ...closing, failed: failed || Boolean(closing.pendingOperation || closing.clientCloseError) };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const args = process.argv.slice(2); const options = {};
    for (let index = 0; index < args.length; index++) {
      const key = args[index];
      if (key === "--schema") { options.schemaOnly = true; continue; }
      if (key === "--jsonl") { options.jsonl = true; continue; }
      if (!["--package", "--workspace", "--tool", "--arguments"].includes(key) || args[index + 1] === undefined) throw new Error("Usage: device-mcp.mjs --package <compiled-plugin> [--workspace <root>] (--jsonl | --schema | --tool <passive-tool> --arguments <JSON>)");
      const value = args[++index];
      if (key === "--package") options.packageRoot = value;
      if (key === "--workspace") options.workspaceRoot = value;
      if (key === "--tool") options.tool = value;
      if (key === "--arguments") options.arguments = JSON.parse(value);
    }
    if (!options.packageRoot) throw new Error("--package is required; no source or backend fallback is selected.");
    if (options.jsonl) {
      if (options.tool || options.schemaOnly) throw new Error("--jsonl owns one session; do not combine it with --tool or --schema.");
      const result = await runDeviceMcpJsonl(options);
      if (result.failed || result.interruptionCount) process.exitCode = 1;
    } else {
      const result = await runDeviceMcp(options);
      process.stdout.write(JSON.stringify(result) + "\n");
      if (result.error || result.result?.isError || result.result?.structuredContent?.success === false || result.interruptionCount) process.exitCode = 1;
    }
  } catch (error) { process.stderr.write(`${message(error)}\n`); process.exitCode = 1; }
}
