import { spawn } from "node:child_process";
import { NativeHelperError } from "./native-helper.js";
/** Owns one direct native child, its bounded pipes, and its original close result. */
export class LinuxCaptureProcess {
    child;
    record;
    finished;
    failure;
    closed = false;
    stopping;
    escalation;
    constructor(child, purpose, pipes, diagnostics) {
        this.child = child;
        const record = { purpose, ...(child.pid === undefined ? {} : { pid: child.pid }), startedAt: new Date().toISOString(), spawnObserved: false, streamsSettled: false, stderr: "" };
        this.record = record;
        child.once("spawn", () => { this.record.spawnObserved = true; });
        child.once("error", error => this.abort(error));
        child.stdin?.on("error", error => { if (!this.closed)
            this.abort(error); });
        child.once("exit", (code, signal) => { this.record.exitCode = code; this.record.signal = signal; this.record.exitedAt = new Date().toISOString(); });
        const close = new Promise(resolve => child.once("close", () => {
            this.closed = true;
            this.record.closedAt = new Date().toISOString();
            clearTimeout(this.escalation);
            resolve();
        }));
        let stderrBytes = 0;
        const consumers = { ...pipes, 2: (bytes) => {
                stderrBytes += bytes.length;
                diagnostics.bytes += bytes.length;
                if (stderrBytes > 64 * 1024 || diagnostics.bytes > 64 * 1024)
                    throw new Error("Linux capture diagnostics exceeded their 64 KiB session bound.");
                this.record.stderr += bytes.toString("utf8");
            } };
        const streams = Object.entries(consumers).map(async ([index, consume]) => {
            const stream = child.stdio[Number(index)];
            if (!stream) {
                this.abort(new Error("Linux capture did not return a required pipe."));
                return;
            }
            try {
                for await (const bytes of stream)
                    await consume(Buffer.from(bytes));
            }
            catch (error) {
                this.abort(error instanceof Error ? error : new Error(String(error)));
            }
        });
        this.finished = (async () => {
            await close;
            await Promise.all(streams);
            record.streamsSettled = true;
            if (this.failure)
                record.error = this.failure.message.slice(0, 2000);
            return { record, ...(this.failure ? { error: this.failure } : {}) };
        })();
    }
    static launch(executable, args, purpose, pipes, deviceFd, diagnostics = { bytes: 0 }) {
        // Additional outputs are fixed child pipes; the only inherited file is the
        // revalidated video node. No shell, network, user environment, or PATH lookup.
        const stdio = ["pipe", "pipe", "pipe", "ignore", "ignore", "ignore", deviceFd ?? "ignore"];
        for (const index of Object.keys(pipes).map(Number))
            stdio[index] = "pipe";
        const child = spawn(executable, args, { stdio, shell: false, env: { PATH: "/usr/bin:/bin", LANG: "C", LC_ALL: "C" } });
        return new LinuxCaptureProcess(child, purpose, pipes, diagnostics);
    }
    abort(error) {
        this.failure ??= error;
        if (this.closed)
            return;
        this.child.kill("SIGTERM");
        this.escalation ??= setTimeout(() => { if (!this.closed)
            this.child.kill("SIGKILL"); }, 3000);
        this.escalation.unref?.();
    }
    fail(error) { this.abort(error); }
    input(bytes) { this.child.stdin?.end(bytes); }
    async wait(maximumMs) {
        let timer;
        try {
            return await Promise.race([this.finished, new Promise((resolve, reject) => {
                    timer = setTimeout(() => { this.abort(new Error("Linux capture operation timed out.")); this.stop().then(resolve, reject); }, maximumMs);
                })]);
        }
        finally {
            clearTimeout(timer);
        }
    }
    stop() {
        if (this.stopping)
            return this.stopping;
        this.stopping = (async () => {
            if (!this.closed) {
                this.child.stdin?.end("q\n");
                this.escalation ??= setTimeout(() => { this.escalation = undefined; this.abort(new Error("Linux capture required termination after its close deadline.")); }, 5000);
                this.escalation.unref?.();
            }
            let timer;
            try {
                return await Promise.race([this.finished, new Promise((_, reject) => {
                        timer = setTimeout(() => { if (!this.closed)
                            this.child.kill("SIGKILL"); reject(new NativeHelperError("Linux capture process or pipe closure is unconfirmed.", true, "LINUX_CLOSE_UNKNOWN")); }, 12_000);
                    })]);
            }
            finally {
                clearTimeout(timer);
            }
        })();
        return this.stopping;
    }
}
//# sourceMappingURL=linux-process.js.map