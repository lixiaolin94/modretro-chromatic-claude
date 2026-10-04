import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nativeEventSchema, nativeFatalSchema, nativeReadySchema, nativeResponseSchema } from "./native-protocol.js";
const MAX_LINE = 64 * 1024, MAX_REQUEST = 8192, MAX_STDERR = 8192;
export class NativeHelperError extends Error {
    uncertain;
    code;
    constructor(message, uncertain, code) {
        super(message);
        this.uncertain = uncertain;
        this.code = code;
    }
}
export async function verifyExecutable(filename, expectedSha256) {
    if (!path.isAbsolute(filename) || await realpath(filename) !== filename || !/^[a-f0-9]{64}$/.test(expectedSha256))
        throw new Error("Native capture helper must have a pinned canonical executable.");
    const named = await lstat(filename);
    if (!named.isFile() || named.nlink !== 1 || named.size < 1 || named.size > 16 * 1024 * 1024 || !(named.mode & 0o111) || (named.mode & 0o022))
        throw new Error("Native capture helper has unsafe permissions or size.");
    const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const before = await handle.stat(), digest = createHash("sha256"), buffer = Buffer.alloc(65536);
        let offset = 0;
        if (before.ino !== named.ino || before.dev !== named.dev || before.size !== named.size)
            throw new Error("Native capture helper changed before verification.");
        while (offset < before.size) {
            const read = await handle.read(buffer, 0, Math.min(buffer.length, before.size - offset), offset);
            if (!read.bytesRead)
                throw new Error("Native capture helper changed while reading.");
            digest.update(buffer.subarray(0, read.bytesRead));
            offset += read.bytesRead;
        }
        const after = await handle.stat();
        if (after.size !== before.size || after.ctimeMs !== before.ctimeMs || after.mtimeMs !== before.mtimeMs || digest.digest("hex") !== expectedSha256)
            throw new Error("Native capture helper did not match its release checksum.");
    }
    finally {
        await handle.close();
    }
}
/** One directly spawned, bounded JSONL helper. No shell, caller-supplied commands, paths or environment. */
export class NativeHelperProcess {
    child;
    ready;
    events;
    pending;
    buffer = Buffer.alloc(0);
    stderrBytes = 0;
    sequence = -1;
    terminal;
    exited = false;
    processClosed = false;
    outputEnded = false;
    drainTimer;
    exitCode = null;
    exitSignal = null;
    releaseConfirmed = false;
    fatalReported = false;
    closed;
    constructor(child, ready, events) {
        this.child = child;
        this.ready = ready;
        this.events = events;
    }
    static async launch(options) {
        if ((options.platform ?? process.platform) !== "darwin")
            throw new Error("Native device capture is currently available on macOS only. Emulator capture remains available.");
        await verifyExecutable(options.executable, options.sha256);
        const temporaryRoot = await realpath(os.tmpdir());
        const child = spawn(options.executable, ["--stdio"], { stdio: ["pipe", "pipe", "pipe"], shell: false, cwd: path.dirname(options.executable), env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8", TMPDIR: temporaryRoot } });
        return NativeHelperProcess.attach(child, options.onEvent);
    }
    /** Test seam accepts an inert in-memory process adapter; production uses only launch(). */
    static async attach(child, onEvent) {
        return new Promise((resolve, reject) => {
            let owner, startup = Buffer.alloc(0), startupStderr = 0, settled = false, exited = false;
            let exitCode = null, exitSignal = null;
            const fail = (error) => { if (owner)
                owner.fail(error);
            else if (!settled) {
                settled = true;
                clearTimeout(timer);
                if (!exited) {
                    child.kill("SIGTERM");
                    const killTimer = setTimeout(() => { if (!exited)
                        child.kill("SIGKILL"); }, 5000);
                    killTimer.unref?.();
                }
                reject(error);
            } };
            const timer = setTimeout(() => fail(new NativeHelperError("Native capture helper did not become ready.", false)), 15_000);
            timer.unref?.();
            child.on("error", () => fail(new NativeHelperError("Native capture helper process failed.", !!owner, "NATIVE_PROCESS_FAILED")));
            for (const [name, stream] of [["input", child.stdin], ["output", child.stdout], ["diagnostics", child.stderr]]) {
                stream.on("error", () => fail(new NativeHelperError(`Native capture ${name} pipe failed.`, !!owner, "NATIVE_PIPE_FAILED")));
            }
            child.once("exit", (code, signal) => {
                exited = true;
                exitCode = code;
                exitSignal = signal;
                if (owner)
                    owner.observeExit(code, signal);
                else if (code !== 0 || signal !== null)
                    fail(new NativeHelperError(`Native capture helper exited (${signal ?? code ?? "unknown"}) before becoming ready.`, false, "HELPER_EXITED"));
            });
            child.once("close", (code, signal) => {
                if (owner)
                    owner.observeClose(code, signal);
                else
                    fail(new NativeHelperError("Native capture helper closed before becoming ready.", false, "HELPER_EXITED"));
            });
            child.stdout.once("end", () => {
                if (owner)
                    owner.endOutput();
                else
                    fail(new NativeHelperError("Native capture output ended before becoming ready.", false, "NATIVE_OUTPUT_ENDED"));
            });
            child.stdout.once("close", () => {
                if (owner && !owner.outputEnded)
                    fail(new NativeHelperError("Native capture output closed before it was fully read.", true, "NATIVE_OUTPUT_ENDED"));
                else if (!owner)
                    fail(new NativeHelperError("Native capture output closed before becoming ready.", false, "NATIVE_OUTPUT_ENDED"));
            });
            child.stderr.on("data", (chunk) => {
                if (owner) {
                    owner.stderrBytes += chunk.length;
                    if (owner.stderrBytes > MAX_STDERR)
                        owner.fail(new NativeHelperError("Native capture helper diagnostics exceeded their bound.", !!owner.pending));
                }
                else {
                    startupStderr += chunk.length;
                    if (startupStderr > MAX_STDERR)
                        fail(new NativeHelperError("Native capture helper startup diagnostics exceeded their bound.", false));
                }
            });
            child.stdout.on("data", (chunk) => {
                if (owner) {
                    owner.consume(chunk);
                    return;
                }
                if (settled)
                    return;
                if (startup.length + chunk.length > MAX_LINE) {
                    fail(new NativeHelperError("Native capture startup response exceeded its bound.", false));
                    return;
                }
                startup = Buffer.concat([startup, chunk]);
                const newline = startup.indexOf(10);
                if (newline < 0)
                    return;
                try {
                    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(startup.subarray(0, newline)));
                    const fatal = nativeFatalSchema.safeParse(raw);
                    if (fatal.success) {
                        onEvent(fatal.data);
                        fail(new NativeHelperError(fatal.data.error.message, true, fatal.data.error.code));
                        return;
                    }
                    const ready = nativeReadySchema.parse(raw);
                    owner = new NativeHelperProcess(child, ready, onEvent);
                    owner.stderrBytes = startupStderr;
                    settled = true;
                    clearTimeout(timer);
                    if (exited)
                        owner.observeExit(exitCode, exitSignal);
                    resolve(owner);
                    if (startup.length > newline + 1)
                        owner.consume(startup.subarray(newline + 1));
                }
                catch {
                    fail(new NativeHelperError("Native capture helper returned an invalid startup message.", false));
                }
            });
        });
    }
    waitForDrain() {
        if (this.drainTimer || this.processClosed || this.terminal)
            return;
        this.drainTimer = setTimeout(() => this.fail(new NativeHelperError("Native capture process or pipe closure was not confirmed.", true, "NATIVE_CLOSE_UNCONFIRMED")), 5000);
        this.drainTimer.unref?.();
    }
    observeExit(code, signal) {
        this.exited = true;
        this.exitCode = code;
        this.exitSignal = signal;
        if (code !== 0 || signal !== null) {
            this.fail(new NativeHelperError(`Native capture helper exited (${signal ?? code ?? "unknown"}) without confirmed normal release.`, true, "HELPER_EXITED"));
            return;
        }
        // exit can precede the final stdout data. Keep reading until close, with a
        // bound in case a pipe stays open after the owned process has exited.
        this.waitForDrain();
    }
    endOutput() {
        this.outputEnded = true;
        if (this.buffer.length || this.pending || !this.releaseConfirmed) {
            this.fail(new NativeHelperError(this.buffer.length ? "Native capture output ended with an incomplete message." : "Native capture output ended without confirmed release and a final response.", true, this.exited ? "HELPER_EXITED" : "NATIVE_OUTPUT_ENDED"));
            return;
        }
        this.waitForDrain();
    }
    observeClose(code, signal) {
        this.processClosed = true;
        this.exited = true;
        this.exitCode = code;
        this.exitSignal = signal;
        clearTimeout(this.drainTimer);
        if (!this.outputEnded || this.buffer.length || this.pending || !this.releaseConfirmed || code !== 0 || signal !== null) {
            this.fail(new NativeHelperError(`Native capture helper exited (${signal ?? code ?? "unknown"}) without confirmed normal release and complete output.`, true, "HELPER_EXITED"));
        }
    }
    consume(chunk) {
        if (this.terminal)
            return;
        // Bound both a single read and buffered incomplete lines before allocation.
        if (chunk.length > MAX_LINE || this.buffer.length + chunk.length > MAX_LINE * 2) {
            this.fail(new NativeHelperError("Native capture output exceeded its bound.", !!this.pending));
            return;
        }
        this.buffer = Buffer.concat([this.buffer, chunk]);
        let newline;
        while ((newline = this.buffer.indexOf(10)) >= 0) {
            if (newline > MAX_LINE) {
                this.fail(new NativeHelperError("Native capture message exceeded its bound.", !!this.pending));
                return;
            }
            const line = this.buffer.subarray(0, newline);
            this.buffer = this.buffer.subarray(newline + 1);
            try {
                this.message(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line)));
            }
            catch {
                this.fail(new NativeHelperError("Native capture helper returned an invalid or mismatched message.", !!this.pending));
                return;
            }
            if (this.terminal)
                return;
        }
        if (this.buffer.length > MAX_LINE)
            this.fail(new NativeHelperError("Native capture message exceeded its bound.", !!this.pending));
    }
    identity(value) {
        if (value.sessionId !== this.ready.sessionId || value.stateSequence < this.sequence)
            throw new Error("Native capture identity or sequence changed.");
        this.sequence = value.stateSequence;
    }
    message(raw) {
        if (raw && typeof raw === "object" && "event" in raw) {
            const event = nativeEventSchema.parse(raw);
            if (event.event === "fatal") {
                if (event.sessionId !== this.ready.sessionId)
                    throw new Error("Native fatal event belongs to another session.");
                this.fatalReported = true;
                this.events(event);
                this.fail(new NativeHelperError(event.error.message, true, event.error.code));
                return;
            }
            this.identity(event.event === "status" ? event.status : event);
            if (event.event === "closed")
                this.releaseConfirmed = event.devicesReleased;
            this.events(event);
            return;
        }
        const response = nativeResponseSchema.parse(raw);
        if (!this.pending || response.requestId !== this.pending.id)
            throw new Error("Unexpected native completion.");
        this.identity(response.ok ? response.result : response);
        const pending = this.pending;
        this.pending = undefined;
        clearTimeout(pending.timer);
        if (response.ok)
            pending.resolve(response.result);
        else
            pending.reject(new NativeHelperError(response.error.message, false, response.error.code));
    }
    async request(action, fields = {}) {
        if (this.terminal || this.exited || this.outputEnded)
            throw this.terminal ?? new NativeHelperError("Native capture helper is closed.", true);
        if (this.pending)
            throw new NativeHelperError("A native capture operation is already pending.", false);
        const requestId = randomUUID();
        if ("requestId" in fields || "action" in fields)
            throw new Error("Reserved native request fields.");
        const bytes = Buffer.from(JSON.stringify({ requestId, action, ...fields }) + "\n");
        if (bytes.length > MAX_REQUEST)
            throw new Error("Native capture request exceeds its bound.");
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => { this.fail(new NativeHelperError("Native capture operation timed out; it will not be replayed. Check the original session result.", true)); }, action === "request_permission" ? 60_000 : 30_000);
            timer.unref?.();
            this.pending = { id: requestId, resolve, reject, timer };
            this.child.stdin.write(bytes, error => { if (error)
                this.fail(new NativeHelperError("Native capture request could not be delivered.", true)); });
        });
    }
    fail(error) {
        if (this.terminal)
            return;
        // Any post-ready transport failure leaves native finalization uncertain,
        // including a crash between commands when there is no pending request.
        error = new NativeHelperError(error.message, true, error instanceof NativeHelperError ? error.code : "NATIVE_TRANSPORT_FAILED");
        this.terminal = error;
        clearTimeout(this.drainTimer);
        if (!this.fatalReported) {
            this.fatalReported = true;
            this.events({ event: "fatal", sessionId: this.ready.sessionId, error: { code: error instanceof NativeHelperError && error.code ? error.code : "NATIVE_TRANSPORT_FAILED", message: error.message.slice(0, 512) }, devicesReleased: false });
        }
        if (this.pending) {
            clearTimeout(this.pending.timer);
            this.pending.reject(error);
            this.pending = undefined;
        }
        if (!this.exited) {
            this.child.kill("SIGTERM");
            const timer = setTimeout(() => { if (!this.exited)
                this.child.kill("SIGKILL"); }, 5000);
            timer.unref?.();
        }
    }
    requireConfirmedRelease() {
        if (this.terminal)
            throw new NativeHelperError(`Native capture remains without confirmed normal device release (exit: ${this.exitSignal ?? this.exitCode ?? "unknown"}). ${this.terminal.message}`, true, this.terminal instanceof NativeHelperError ? this.terminal.code : undefined);
        if (!this.processClosed || !this.outputEnded || !this.releaseConfirmed || this.exitCode !== 0 || this.exitSignal !== null)
            throw new NativeHelperError("Native capture helper exited without confirmed normal device release. Final capture state remains unconfirmed.", true);
    }
    close() {
        if (this.closed)
            return this.closed;
        this.closed = (async () => {
            if (this.processClosed) {
                this.requireConfirmedRelease();
                return;
            }
            if (!this.pending && !this.terminal && !this.exited && !this.outputEnded) {
                try {
                    await this.request("close");
                }
                catch { /* Preserve original failure; own process is terminated below. */ }
            }
            this.child.stdin.end();
            if (!this.processClosed)
                await new Promise(resolve => {
                    const completed = () => { clearTimeout(timer); resolve(); };
                    const timer = setTimeout(() => { this.child.removeListener("close", completed); this.fail(new NativeHelperError("Native capture shutdown was not confirmed.", true)); resolve(); }, 5000);
                    timer.unref?.();
                    this.child.once("close", completed);
                });
            this.requireConfirmedRelease();
        })();
        return this.closed;
    }
}
//# sourceMappingURL=native-helper.js.map