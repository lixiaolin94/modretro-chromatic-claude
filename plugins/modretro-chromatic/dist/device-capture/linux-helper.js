import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdtemp, open, realpath, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NativeHelperError, verifyExecutable } from "./native-helper.js";
import { NativeCaptureFiles } from "./native-files.js";
import { scanChromaticVideoNodes, openBoundLinuxVideo } from "./linux-device.js";
import { LinuxFrameStream } from "./linux-frame-stream.js";
import { LinuxPacketStats } from "./linux-packet-stats.js";
import { LinuxCaptureProcess } from "./linux-process.js";
import { NATIVE_LIMITS } from "./native-protocol.js";
const permissions = { video: "not_required", audio: "not_supported" };
const prefix = ["-hide_banner", "-loglevel", "info", "-nostats", "-xerror", "-max_alloc", "67108864"];
const deviceAccess = { scan: scanChromaticVideoNodes, open: openBoundLinuxVideo, launch: LinuxCaptureProcess.launch };
/** Linux implementation of the same capture protocol, using a pinned V4L2/VP8 executable. */
export class LinuxNativeHelper {
    executable;
    events;
    io;
    ready;
    sequence = 0;
    nodes = new Map();
    inventory;
    node;
    producer;
    recording;
    recordings = 0;
    screenshots = 0;
    frameId = 0;
    sourceGeneration = 0;
    latest;
    latestImage;
    previewFiles = [];
    connection = "disconnected";
    lastError = null;
    closing;
    cancelled = false;
    unresolved;
    operation;
    processes = [];
    owned = [];
    diagnostics = { bytes: 0 };
    constructor(executable, directory, events, io = deviceAccess) {
        this.executable = executable;
        this.events = events;
        this.io = io;
        this.ready = { event: "ready", protocolVersion: 1, sessionId: randomUUID(), stateSequence: 0, sessionDir: directory, platform: "Linux", limits: NATIVE_LIMITS };
    }
    static async launch(options) {
        if (process.platform !== "linux")
            throw new Error("The Linux capture backend requires a Linux host.");
        await verifyExecutable(options.executable, options.sha256);
        const directory = await mkdtemp(path.join(await realpath(os.tmpdir()), "chromatic-native-capture-"));
        await NativeCaptureFiles.create(directory);
        return new LinuxNativeHelper(options.executable, directory, options.onEvent);
    }
    /** Inert test seam. The production launch path always uses the fixed device implementation above. */
    static async attach(directory, events, io) {
        await NativeCaptureFiles.create(directory);
        return new LinuxNativeHelper("/test-only/ffmpeg", directory, events, io);
    }
    next() { return { sessionId: this.ready.sessionId, stateSequence: ++this.sequence }; }
    assertOpen() { if (this.cancelled)
        throw new Error("Linux capture is closing."); }
    remember(process) {
        this.processes.push(process.record);
        this.owned.push(process);
        return process;
    }
    capacity() { if (this.processes.length >= 64)
        throw new Error("This capture session reached its process-evidence bound. Close it before starting another session."); }
    status() {
        const r = this.recording;
        return { ...this.next(), connection: this.connection,
            selection: this.node ? { videoDeviceId: this.node.id, videoLabel: this.node.label, player: this.node.player } : null,
            permissions, source: this.latest ? { width: this.latest.width, height: this.latest.height, firstPTS: this.producer?.firstPTS ?? null, lastPTS: this.latest.sourcePTS, videoSamples: this.producer?.frameCount ?? 0, audioSamples: 0 } : null,
            recording: r?.final ?? (r ? { captureId: r.id, state: "recording", durationMs: Math.min(performance.now() - r.started, r.requested + 15000), requestedDurationMs: r.requested, deadlineUnixMs: r.deadline,
                videoSamples: r.stats.count, audioSamples: 0, droppedVideoSamples: null, droppedAudioSamples: 0 } : null),
            latestFrame: this.latestImage ? { frameId: this.latestImage.frameId, basename: this.latestImage.basename, bytes: this.latestImage.bytes, sha256: this.latestImage.sha256,
                width: this.latestImage.width, height: this.latestImage.height, sourcePTS: this.latestImage.sourcePTS, format: "jpeg" } : null, lastError: this.lastError,
            processes: this.processes.map(record => ({ ...record })), sampleEvidence: "encoded-output", sourceGeneration: this.sourceGeneration, sourceClock: "ffmpeg-relative-input" };
    }
    async isCapture(node) {
        this.capacity();
        this.assertOpen();
        const fd = await this.io.open(node);
        let process;
        try {
            process = this.remember(this.io.launch(this.executable, [...prefix, "-nostdin", "-f", "v4l2", "-list_formats", "all", "-i", "/proc/self/fd/6"], "video-capabilities", { 1: bytes => { if (bytes.length)
                    throw new Error("Unexpected video capability output."); } }, fd.fd, this.diagnostics));
        }
        finally {
            try {
                await fd.close();
            }
            catch {
                throw new NativeHelperError("Linux video descriptor closure is unconfirmed.", true, "LINUX_CLOSE_UNKNOWN");
            }
        }
        {
            const result = await process.wait(5000);
            const text = result.record.stderr;
            if (result.error || !result.record.spawnObserved || !Number.isSafeInteger(result.record.pid) || result.record.pid <= 0 || !result.record.streamsSettled || !result.record.closedAt || result.record.signal !== null)
                throw result.error ?? new Error("Linux video query did not close completely.");
            if (/Not a video capture device|The device does not support the streaming I\/O method/.test(text))
                return false;
            if (result.record.exitCode !== 0)
                throw new Error(`Cannot query the selected Chromatic video node. Check Linux USB/video access. ${text.slice(-1900)}`);
            // FFmpeg can suppress the terminal ENUM_FMT errno. Empty output is not
            // evidence of a metadata node; only the explicit capability errors above
            // establish that classification.
            if (!/(?:Raw       |Compressed):\s+(?!Unsupported\b)\S+\s+:.*:\s+\d+x\d+/.test(text))
                throw new Error("The Linux video query returned no supported formats. Device availability is unconfirmed; reconnect or check the device before another attempt.");
            return true;
        }
    }
    async list() {
        if (this.producer)
            throw new Error("Disconnect before refreshing Linux video devices.");
        const { total, candidates } = await this.io.scan();
        const accepted = [];
        for (const node of candidates.slice(0, 8))
            if (await this.isCapture(node))
                accepted.push(node);
        this.assertOpen();
        this.nodes = new Map(accepted.slice(0, 4).map(node => [node.id, node]));
        this.inventory = { ...this.next(), inventoryId: randomUUID(), permissions,
            videoDevices: [...this.nodes.values()].map(node => ({ deviceId: node.id, label: node.label, player: node.player, formats: [] })), audioDevices: [],
            counts: { video: { total, unlabeled: 0, unsupported: total - candidates.length + Math.min(candidates.length, 8) - accepted.length, omitted: Math.max(candidates.length - 8, 0) + Math.max(accepted.length - 4, 0) }, audio: { total: 0, unlabeled: 0, unsupported: 0, omitted: 0 } } };
        return this.inventory;
    }
    async startProducer(recording) {
        this.capacity();
        this.assertOpen();
        if (this.producer || !this.node)
            throw new Error("The previous Linux producer must close before another can start.");
        const node = this.node, fd = await this.io.open(node);
        let resolveFirst;
        const first = new Promise(resolve => { resolveFirst = resolve; });
        let producer;
        const preview = new LinuxFrameStream(frame => {
            if (this.producer !== producer)
                return;
            producer.frameCount++;
            producer.firstPTS ??= frame.sourcePTS;
            producer.lastFrameAt = Date.now();
            this.frameId++;
            this.latest = frame;
            resolveFirst();
        });
        const args = [...prefix, "-copyts", "-start_at_zero", "-f", "v4l2", "-i", "/proc/self/fd/6"];
        const pipes = { 1: bytes => preview.pushBytes(bytes), 3: bytes => preview.pushMetadata(bytes) };
        if (recording) {
            args.push("-map", "0:v:0", "-an", "-vf", "scale=iw*8:ih*8:flags=neighbor", "-c:v", "libvpx", "-deadline", "realtime", "-cpu-used", "8", "-b:v", "8M", "-enc_time_base", "1:1000000", "-fps_mode", "passthrough", "-f", "tee", "[f=webm]pipe:4|[f=framehash:hash=sha256:format_version=1:flush_packets=1]pipe:5");
            pipes[4] = async (bytes) => {
                if (recording.bytes + bytes.length > NATIVE_LIMITS.maxRecordingBytes) {
                    recording.reason = "limit";
                    throw new Error("Linux recording reached its byte limit; its partial file is retained.");
                }
                let offset = 0;
                while (offset < bytes.length) {
                    const result = await recording.file.write(bytes, offset, bytes.length - offset);
                    if (!result.bytesWritten)
                        throw new Error("Linux recording write stopped.");
                    recording.digest.update(bytes.subarray(offset, offset + result.bytesWritten));
                    recording.bytes += result.bytesWritten;
                    offset += result.bytesWritten;
                }
            };
            pipes[5] = bytes => recording.stats.push(bytes);
        }
        args.push("-map", "0:v:0", "-an", "-c:v", "mjpeg", "-q:v", "3", "-pix_fmt", "yuvj420p", "-enc_time_base", "1:1000000", "-fps_mode", "passthrough", "-f", "tee", "[f=image2pipe:flush_packets=1]pipe:1|[f=framehash:hash=sha256:format_version=1:flush_packets=1]pipe:3");
        try {
            this.assertOpen();
            if (recording && performance.now() >= recording.expires)
                throw new Error("Recording deadline expired while opening the selected device.");
            const process = this.remember(this.io.launch(this.executable, args, recording ? "recording" : "preview", pipes, fd.fd, this.diagnostics));
            producer = { process, preview, first, recording, frameCount: 0, lastFrameAt: Date.now(), generation: ++this.sourceGeneration };
            this.producer = producer;
            if (recording)
                recording.generation = producer.generation;
            producer.watchdog = setInterval(() => { if (Date.now() - producer.lastFrameAt >= 10000)
                process.fail(new Error("The selected Chromatic stopped providing complete video frames.")); }, 1000);
            producer.watchdog.unref?.();
        }
        finally {
            try {
                await fd.close();
            }
            catch {
                throw new NativeHelperError("Linux video descriptor closure is unconfirmed.", true, "LINUX_CLOSE_UNKNOWN");
            }
        }
        void producer.process.finished.then(() => { if (!producer.stop)
            void this.finishProducer(producer, "error").catch(error => { if (error instanceof NativeHelperError && error.uncertain)
                this.fatal(error); }); });
        let timer;
        try {
            await Promise.race([first, producer.process.finished.then(() => { throw new Error("Linux capture exited before its first complete frame."); }), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("No frame arrived from the selected Chromatic.")), 10000); })]);
            this.assertOpen();
            if (this.producer !== producer)
                throw new Error("Linux producer closed during connection.");
            this.connection = "connected";
        }
        catch (error) {
            producer.process.fail(error instanceof Error ? error : new Error(String(error)));
            await this.finishProducer(producer, "error");
            throw error;
        }
        finally {
            clearTimeout(timer);
        }
    }
    fatal(error) {
        const message = error instanceof Error ? error.message : String(error);
        this.cancelled = true;
        this.unresolved = error instanceof Error ? error : new Error(message);
        this.lastError = { code: "LINUX_CLOSE_UNKNOWN", message: message.slice(0, 2000) };
        this.connection = "failed";
        this.events({ event: "fatal", sessionId: this.ready.sessionId, error: this.lastError, devicesReleased: false });
    }
    finishProducer(producer, reason) {
        if (producer.stop)
            return producer.stop;
        producer.stop = (async () => {
            clearInterval(producer.watchdog);
            const result = await producer.process.stop();
            let error = result.error ?? (reason === "error" ? new Error("Linux capture ended before its requested stop or deadline.") : undefined);
            if (!result.record.spawnObserved || result.record.exitCode !== 0 || result.record.signal !== null)
                error ??= new Error(`Linux capture exited with ${result.record.signal ?? result.record.exitCode ?? "unknown status"}.`);
            try {
                producer.preview.finish();
                producer.recording?.stats.finish();
            }
            catch (failure) {
                error ??= failure;
            }
            if (this.producer === producer) {
                this.producer = undefined;
                this.latest = undefined;
                this.latestImage = undefined;
                this.connection = error ? "failed" : "disconnected";
            }
            const r = producer.recording;
            if (r) {
                clearTimeout(r.timer);
                r.error ??= error;
                try {
                    await r.file.sync();
                }
                catch (failure) {
                    r.error ??= failure;
                }
                await r.file.close();
                const durationMs = Math.min(Math.max(0, performance.now() - r.started), r.requested + 15000);
                r.final = { captureId: r.id, state: r.error ? r.bytes ? "partial" : "failed" : "complete", basename: r.bytes ? r.basename : null, format: "webm", bytes: r.bytes,
                    sha256: r.bytes ? r.digest.digest("hex") : null, durationMs, requestedDurationMs: r.requested, videoSamples: r.stats.count, audioSamples: 0,
                    droppedVideoSamples: null, droppedAudioSamples: 0, reason: r.reason === "limit" ? "limit" : reason,
                    error: r.error ? { code: "LINUX_RECORDING_FAILED", message: r.error.message.slice(0, 2000) } : null, devicesReleased: true,
                    processes: this.processes.map(record => ({ ...record })), sampleEvidence: "encoded-output",
                    encodedDurationMs: Math.max(0, ((r.stats.lastPTS ?? 0) - (r.stats.firstPTS ?? 0) + r.stats.lastDuration) * 1000), sourceGeneration: r.generation, sourceClock: "ffmpeg-relative-input" };
                this.events({ event: "recording_finished", ...this.next(), recording: r.final });
            }
            if (error)
                this.lastError = { code: "LINUX_CAPTURE_FAILED", message: error.message.slice(0, 2000) };
            this.events({ event: "status", status: this.status() });
            if (error && !r)
                throw new NativeHelperError(error.message, false, "LINUX_CAPTURE_FAILED");
            if (r && !error && !r.error && !this.cancelled && ["stop", "duration"].includes(reason))
                await this.startProducer();
        })();
        return producer.stop;
    }
    async writeImage(frame, png = false) {
        const frameId = this.frameId, sourceGeneration = this.sourceGeneration;
        let bytes = frame.bytes;
        if (png) {
            this.capacity();
            if (++this.screenshots > NATIVE_LIMITS.maxScreenshots)
                throw new Error("Screenshot limit reached.");
            const chunks = [];
            let length = 0;
            const process = this.remember(this.io.launch(this.executable, [...prefix, "-f", "image2pipe", "-c:v", "mjpeg", "-i", "pipe:0", "-frames:v", "1", "-c:v", "png", "-f", "image2pipe", "pipe:1"], "screenshot", { 1: chunk => { length += chunk.length; if (length > NATIVE_LIMITS.maxScreenshotBytes)
                    throw new Error("PNG exceeds its byte limit."); chunks.push(chunk); } }, undefined, this.diagnostics));
            process.input(bytes);
            const result = await process.wait(5000);
            if (result.error || result.record.exitCode !== 0 || result.record.signal !== null)
                throw result.error ?? new Error("Linux PNG encoding failed.");
            bytes = Buffer.concat(chunks);
        }
        const basename = `${png ? "snapshot" : "preview"}-${randomUUID()}.${png ? "png" : "jpeg"}`;
        const file = await open(path.join(this.ready.sessionDir, basename), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
        let stat;
        try {
            await file.writeFile(bytes);
            stat = await file.stat();
        }
        finally {
            await file.close();
        }
        if (!png) {
            this.previewFiles.push({ name: basename, stat });
            while (this.previewFiles.length > 2) {
                const old = this.previewFiles.shift(), filename = path.join(this.ready.sessionDir, old.name), current = await lstat(filename);
                if (current.ino !== old.stat.ino || current.dev !== old.stat.dev || !current.isFile() || current.nlink !== 1)
                    throw new Error("Owned preview file changed before retirement.");
                await unlink(filename);
            }
        }
        const image = { ...this.next(), frameId, basename, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), width: frame.width, height: frame.height, sourcePTS: frame.sourcePTS, format: png ? "png" : "jpeg", sourceGeneration, sourceClock: "ffmpeg-relative-input" };
        if (!png)
            this.latestImage = image;
        return image;
    }
    request(action, fields = {}) {
        if (action === "close")
            return this.close();
        if (this.operation)
            return Promise.reject(new Error("A Linux capture operation is still finishing."));
        const operation = this.perform(action, fields);
        this.operation = operation;
        return operation.catch(error => { if (error instanceof NativeHelperError && error.uncertain) {
            this.cancelled = true;
            this.fatal(error);
        } throw error; })
            .finally(() => { if (this.operation === operation)
            this.operation = undefined; });
    }
    async perform(action, fields) {
        this.assertOpen();
        if (action === "list")
            return this.list();
        if (action === "status" || action === "permission_status") {
            if (this.latest && this.latestImage?.frameId !== this.frameId)
                await this.writeImage(this.latest);
            return this.status();
        }
        if (action === "request_permission")
            throw new Error("Linux capture does not request macOS permissions.");
        if (action === "connect") {
            const selection = fields.selection;
            if (selection?.audioDeviceId)
                throw new Error("Linux USB audio is not supported in this build.");
            const node = selection?.videoDeviceId ? this.nodes.get(selection.videoDeviceId) : undefined;
            if (!node || fields.inventoryId !== this.inventory?.inventoryId || this.producer)
                throw new Error("Refresh and select the exact Linux Chromatic before connecting.");
            this.node = node;
            this.connection = "connecting";
            this.lastError = null;
            await this.startProducer();
            return this.status();
        }
        if (action === "live_frame" || action === "screenshot") {
            if (!this.latest || this.connection !== "connected")
                throw new NativeHelperError("No complete Linux video frame has arrived.", false, "NO_VIDEO_FRAME");
            return this.writeImage(this.latest, action === "screenshot");
        }
        if (action === "start_recording") {
            const duration = fields.durationMs, id = fields.captureId;
            if (!Number.isInteger(duration) || Number(duration) < 1000 || Number(duration) > NATIVE_LIMITS.maxDurationMs || typeof id !== "string" || !/^[a-f0-9-]{36}$/.test(id))
                throw new Error("Invalid Linux recording request.");
            if (!this.producer || this.connection !== "connected" || this.producer.recording || this.recordings >= 2)
                throw new Error("Connect before recording; at most two recordings are allowed per session.");
            // Start the one deadline BEFORE preview closure and re-open, never reset it.
            const started = performance.now(), deadline = Date.now() + Number(duration), expires = started + Number(duration);
            await this.finishProducer(this.producer, "stop");
            this.assertOpen();
            if (performance.now() >= expires)
                throw new Error("Recording deadline expired during preview closure.");
            const basename = `capture-${id}.webm`, file = await open(path.join(this.ready.sessionDir, basename), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
            const r = { id, basename, file, bytes: 0, digest: createHash("sha256"), stats: new LinuxPacketStats(), requested: Number(duration), started, deadline, expires, reason: "stop" };
            this.recording = r;
            this.recordings++;
            r.timer = setTimeout(() => { if (this.producer?.recording === r)
                void this.finishProducer(this.producer, "duration").catch(error => this.fatal(error)); }, expires - performance.now());
            try {
                await this.startProducer(r);
            }
            catch (error) {
                clearTimeout(r.timer);
                if (!r.final && !this.producer && !(error instanceof NativeHelperError && error.uncertain)) {
                    await file.close();
                    r.final = { captureId: r.id, state: "failed", basename: null, format: "webm", bytes: 0, sha256: null, durationMs: Math.min(performance.now() - started, r.requested + 15000), requestedDurationMs: r.requested,
                        videoSamples: 0, audioSamples: 0, droppedVideoSamples: null, droppedAudioSamples: 0, reason: "error", error: { code: "LINUX_RECORDING_NOT_STARTED", message: String(error instanceof Error ? error.message : error).slice(0, 2000) }, devicesReleased: true, sampleEvidence: "encoded-output", processes: this.processes.map(record => ({ ...record })) };
                    this.events({ event: "recording_finished", ...this.next(), recording: r.final });
                }
                throw error;
            }
            return this.status();
        }
        if (action === "stop_recording" || action === "disconnect") {
            if (this.producer)
                await this.finishProducer(this.producer, action === "disconnect" ? "disconnect" : "stop");
            return this.status();
        }
        throw new Error("Unknown Linux capture action.");
    }
    close() {
        if (this.closing)
            return this.closing;
        this.cancelled = true;
        this.closing = (async () => {
            await this.operation?.catch(() => { });
            if (this.producer)
                await this.finishProducer(this.producer, "close").catch(error => { if (!(error instanceof NativeHelperError) || error.uncertain)
                    throw error; });
            for (const process of this.owned)
                if (!process.record.closedAt || !process.record.streamsSettled)
                    await process.stop();
            if (this.recording && !this.recording.final)
                await this.recording.file.close();
            if (this.unresolved)
                throw this.unresolved;
            this.connection = "closed";
            this.events({ event: "closed", ...this.next(), devicesReleased: true });
        })();
        return this.closing;
    }
}
//# sourceMappingURL=linux-helper.js.map