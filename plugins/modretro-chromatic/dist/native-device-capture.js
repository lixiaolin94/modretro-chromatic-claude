import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { CHROMATIC_PACKED_V2, readPackedDeviceArtwork } from "../scripts/chromatic-runtime.mjs";
import { PreviewCaptureStore, validatePng } from "./web-preview-captures.js";
import { listenLoopback } from "./loopback-listener.js";
import { DEVICE_CAPTURE_IMAGES } from "./device-capture/page.js";
import { NATIVE_CAPTURE_PAGE } from "./device-capture/native-page.js";
import { NativeHelperProcess, NativeHelperError } from "./device-capture/native-helper.js";
import { LinuxNativeHelper } from "./device-capture/linux-helper.js";
import { NativeCaptureFiles, readBoundedCaptureAsset } from "./device-capture/native-files.js";
import { NativeCacheMetrics } from "./device-capture/native-cache-metrics.js";
import { ServiceStageTrace } from "./device-capture/service-stage-trace.js";
import { nativeInventorySchema, nativeStatusSchema, nativeImageSchema, nativeFrameReleaseSchema, nativeClockSchema, nativeSelectionSchema, nativeRecordingSchema, NATIVE_LIMITS } from "./device-capture/native-protocol.js";
export { nativeSelectionSchema as deviceSelectionSchema } from "./device-capture/native-protocol.js";
const SESSION_BYTES = 256 * 1024 * 1024, MAX_REQUEST = 16 * 1024;
const NEXT_FRAME_WAIT_MS = 250, MAX_FRAME_WAITERS = 4;
const ASSETS = ["device-capture/native-client.js", "device-capture/native-timing-diagnostics.js", "device-capture/device-picker.js", "device-capture/native-entry.js", "device-capture/native-page.js", "device-capture/page.js", "web-annotations/error-dialog.js", "web-annotations/recording-protocol.js", "web-annotations/native.js", "web-annotations/targets.js", "web-annotations/view.js"];
class CaptureDisabledError extends Error {
    constructor() { super("Enable device capture in Settings → Connection first. Claude can open that settings tab for you."); }
}
class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
function json(res, status, value) { res.statusCode = status; res.setHeader("Content-Type", "application/json; charset=utf-8"); res.end(JSON.stringify(value)); }
function single(req, name) { return req.rawHeaders.filter((value, index) => index % 2 === 0 && value.toLowerCase() === name).length === 1; }
function frameMatchesStatus(status, image) {
    return status?.connection === "connected" && !!status.latestFrame && status.sessionId === image.sessionId && status.latestFrame.connectionId === image.connectionId && status.sourceGeneration === image.sourceGeneration;
}
async function readBody(req) {
    const length = req.headers["content-length"];
    if (!single(req, "content-length") || typeof length !== "string" || !/^[0-9]+$/.test(length) || Number(length) < 1 || Number(length) > MAX_REQUEST || req.headers["transfer-encoding"] !== undefined)
        throw new HttpError(413, "A bounded Content-Length is required.");
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
        size += chunk.length;
        if (size > Number(length))
            throw new HttpError(413, "Request exceeds its bound.");
        chunks.push(chunk);
    }
    if (size !== Number(length))
        throw new HttpError(400, "Incomplete request.");
    try {
        return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    }
    catch {
        throw new HttpError(400, "Invalid JSON.");
    }
}
const controlSchema = z.object({ sessionId: z.string().uuid(), generation: z.number().int().nonnegative(), action: z.enum(["list_devices", "permission_status", "open_settings", "connect", "disconnect", "screenshot", "live_frame", "start_recording", "stop_recording", "close", "enable", "disable"]), durationMs: z.number().int().min(1000).max(600000).optional(), inventoryId: z.string().uuid().optional(), selection: nativeSelectionSchema.optional(), audio: z.boolean().optional(), tab: z.enum(["connection", "recording"]).optional() }).strict();
const afterIdentitySchema = z.object({ nativeSessionId: z.string().uuid(), frameId: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER), sha256: z.string().regex(/^[a-f0-9]{64}$/), connectionId: z.string().uuid().optional(), sourceGeneration: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), previewSequence: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional() }).strict();
/** Native capture owns the device; this authenticated browser is a display and explicit settings surface. */
export class NativeDeviceCaptureService {
    options;
    active;
    opening = false;
    disposed = false;
    closedPort;
    constructor(options) {
        this.options = options;
    }
    get permissionRequired() { return (this.options.platform ?? process.platform) !== "linux"; }
    availability() {
        const platform = this.options.platform ?? process.platform;
        return platform === "darwin" || platform === "linux" && ["arm64", "x64"].includes(process.arch) && !!this.options.linuxHelperManifest || this.options.helperFactory
            ? { supported: true }
            : { supported: false, reason: `Device capture is not available on ${platform === "win32" ? "Windows" : platform} in this build. Emulation and Install remain available.` };
    }
    get busy() { return this.opening || !!this.active; }
    status(captureId, includeTrace = false) {
        const a = this.active;
        const capabilities = { backend: this.permissionRequired ? "native-macos" : "native-linux", permissionRequired: this.permissionRequired, audioSupported: this.permissionRequired };
        if (!a)
            return { active: false, source: "physical-uvc", ...capabilities, diagnosticTraceEnabled: false, ...(includeTrace ? { diagnosticTrace: { state: "unavailable", reason: "no-session" } } : {}) };
        const recording = captureId ? a.recordings.get(captureId) : [...a.recordings.values()].at(-1);
        const describe = (r) => r && { captureId: r.captureId, state: r.state, durationMs: r.durationMs, deadline: r.deadline, result: r.result, error: r.error, uncertain: r.uncertain, native: r.native, retainedPath: r.retainedPath };
        let trace, previousTrace;
        if (includeTrace) {
            if (!a.diagnosticTraceEnabled)
                trace = { state: "unavailable", reason: "disabled" };
            else if (a.traceFailed)
                trace = { state: "unavailable", reason: "instrumentation-failed" };
            else if (!a.stageTrace)
                trace = { state: "unavailable", reason: a.frameReleaseFailure ? "unconfirmed-frame-release" : a.traceAwaitingPassive ? "awaiting-prior-operation" : "no-connected-frame" };
            else
                try {
                    const now = performance.now();
                    trace = a.stageTrace.snapshot(now);
                    previousTrace = a.previousStageTrace?.snapshot(now);
                }
                catch {
                    a.traceFailed = true;
                    trace = { state: "unavailable", reason: "instrumentation-failed" };
                    previousTrace = undefined;
                }
        }
        return { active: true, source: "physical-uvc", ...capabilities, sessionId: a.sessionId, generation: a.generation, url: this.url(a), enabled: a.enabled, diagnosticTraceEnabled: a.diagnosticTraceEnabled, ...(includeTrace ? { diagnosticTrace: trace, ...(previousTrace ? { previousDiagnosticTrace: previousTrace } : {}), ...(a.traceTransitionPending && !a.frameReleaseFailure ? { diagnosticTraceTransition: { state: a.traceAwaitingPassive ? "awaiting-prior-operation" : "awaiting-next-identified-status", coverage: "unattributed" } } : {}) } : {}), synthetic: this.options.reviewFixture === true,
            supported: this.availability().supported, observation: a.observation, devices: a.devices, devicesListedAt: a.devicesAt, busy: a.working && !a.passive, error: a.error, nativeFailure: a.nativeFailure, frameReleaseFailure: a.frameReleaseFailure, frameIdentityFailure: a.frameIdentityFailure, settingsRequest: a.settingsRequest, settingsTab: a.settingsTab,
            recording: describe(recording), latestCompletedRecording: describe([...a.recordings.values()].reverse().find(r => r.result)), savedCaptures: a.captures.size, savedBytes: a.totalBytes, closing: !!a.closing, revoked: a.revoked,
            lastCapture: [...a.captures.values()].at(-1), latestFrame: a.latest?.metadata, previewCacheMetrics: a.cacheMetrics?.snapshot(performance.now()), selectionEvidence: "Native device labels and source timestamps; cartridge ROM and game render FPS are not authenticated." };
    }
    url(a) { return `http://127.0.0.1:${a.port}/${a.token}/`; }
    current(a) { if (this.active !== a || a.revoked || a.closing || !this.options.isSelected(a.projectRoot, a.generation))
        throw new HttpError(409, "This capture session no longer belongs to the selected project."); }
    async open(projectRoot, generation, diagnosticTrace) {
        if (this.disposed || this.opening)
            throw new Error("Capture service is closed or already opening.");
        if (this.active) {
            const a = this.active;
            if (a.projectRoot !== projectRoot || a.generation !== generation)
                throw new Error("Close the existing capture session before changing projects.");
            if (diagnosticTrace !== undefined && diagnosticTrace !== a.diagnosticTraceEnabled) {
                if (a.revoked || a.closing || a.starting || a.working || a.passive || a.helper && a.observation?.connection !== "disconnected" || [...a.recordings.values()].some(r => ["starting", "recording", "finishing"].includes(r.state)))
                    throw new Error("Diagnostic tracing can only be changed while the existing capture session is disconnected and idle.");
                a.diagnosticTraceEnabled = diagnosticTrace;
                a.stageTrace = undefined;
                a.previousStageTrace = undefined;
                a.traceAwaitingPassive = false;
                a.traceTransitionPending = false;
                a.tracePendingObservation = undefined;
                a.traceWatermark = undefined;
                a.traceFailed = false;
            }
            return this.status();
        }
        this.opening = true;
        try {
            if (!this.options.isSelected(projectRoot, generation))
                throw new Error("Select a project first.");
            const assets = new Map();
            for (const name of ASSETS)
                assets.set(name, await readFile(path.join(this.options.assetsRoot, name)));
            const artRoot = this.options.deviceAssetsRoot ?? path.resolve(this.options.assetsRoot, "../assets/devices");
            const packed = this.options.deviceAssetsFormat === CHROMATIC_PACKED_V2.format ? readPackedDeviceArtwork(artRoot) : undefined;
            for (const name of DEVICE_CAPTURE_IMAGES) {
                const data = packed ? packed.get(path.basename(name)) : await readBoundedCaptureAsset(path.join(artRoot, path.basename(name)), 3 * 1024 * 1024);
                if (!data || data.length > 3 * 1024 * 1024 || data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP")
                    throw new Error("Device artwork is invalid.");
                assets.set(name, data);
            }
            let a;
            const server = createServer((req, res) => {
                if (!a) {
                    res.destroy();
                    return;
                }
                if (a.requests >= 16) {
                    json(res, 503, { error: "Capture server is busy." });
                    return;
                }
                a.requests++;
                let released = false;
                const release = () => { if (!released) {
                    released = true;
                    a.requests--;
                } };
                res.once("close", release);
                res.once("finish", release);
                void this.handle(req, res, a).catch(error => { if (res.headersSent)
                    res.destroy();
                else
                    json(res, error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500, { error: error instanceof HttpError ? error.message : "The local capture request failed." }); });
            });
            server.requestTimeout = 15000;
            server.headersTimeout = 5000;
            server.keepAliveTimeout = 1000;
            server.maxHeadersCount = 32;
            await listenLoopback(server, this.closedPort);
            const address = server.address();
            if (!address || typeof address === "string")
                throw new Error("Could not open local capture view.");
            const sessionId = randomUUID();
            a = { server, port: address.port, token: randomBytes(32).toString("hex"), sessionId, generation, projectRoot, assets, store: new PreviewCaptureStore({ projectRoot, identity: { source: "physical-uvc", sessionId, generation } }), enabled: !this.permissionRequired, diagnosticTraceEnabled: diagnosticTrace === true, enableGeneration: 0, revokePending: false, settingsTab: "connection", working: false, revoked: false, settingsRequest: 0, requests: 0, reads: 0, totalBytes: 0, captures: new Map(), recordings: new Map(), frames: new Map(), frameWaiters: new Set() };
            if (this.disposed || !this.options.isSelected(projectRoot, generation)) {
                await new Promise(resolve => server.close(() => resolve()));
                throw new Error("Capture selection changed while opening.");
            }
            this.active = a;
            return this.status();
        }
        finally {
            this.opening = false;
        }
    }
    trace(a, fn) { if (!a.diagnosticTraceEnabled || a.traceFailed)
        return; try {
        fn();
    }
    catch {
        a.traceFailed = true;
    } }
    observeTrace(a, status, now, observedVia = "status-response", sample = true) {
        if (!a.diagnosticTraceEnabled || a.traceFailed || a.closing || a.revoked || this.active !== a)
            return;
        this.trace(a, () => {
            // The helper parses stdout in sequence, but promise continuations can
            // run after a newer event from the same stdout chunk. This watermark is
            // trace-only; it does not change the capture service's observation.
            const watermark = a.traceWatermark;
            if (watermark?.sessionId === status.sessionId && status.stateSequence < watermark.stateSequence)
                return;
            a.traceWatermark = { sessionId: status.sessionId, stateSequence: status.stateSequence };
            const remember = () => {
                const previous = a.tracePendingObservation?.status;
                if (!previous || previous.sessionId !== status.sessionId || status.stateSequence >= previous.stateSequence)
                    a.tracePendingObservation = { status, observedVia };
            };
            if (a.traceAwaitingPassive) {
                remember();
                return;
            }
            const end = (reason) => {
                const old = a.stageTrace;
                if (old && !old.ended && a.passive) {
                    a.traceAwaitingPassive = true;
                    a.traceTransitionPending = true;
                    remember();
                }
                old?.end(reason, now);
            };
            if (!a.enabled || status.connection !== "connected") {
                end(!a.enabled ? "capture-disabled" : status.connection === "disconnected" ? "disconnected" : status.connection === "failed" ? "failed" : "control-transition");
                return;
            }
            // Without frame identity a connected status cannot establish continuity
            // with the previous connection. Preserve its trace but do not mix it
            // with events from an unidentifiable connection.
            if (!status.latestFrame) {
                end("identity-unavailable");
                return;
            }
            if (!a.stageTrace || a.stageTrace.ended || !a.stageTrace.matches(status)) {
                end("connection-change");
                if (a.traceAwaitingPassive)
                    return;
                if (a.passive) {
                    a.traceAwaitingPassive = true;
                    a.traceTransitionPending = true;
                    remember();
                    return;
                }
                if (a.stageTrace)
                    a.previousStageTrace = a.stageTrace;
                a.stageTrace = new ServiceStageTrace(a.sessionId, a.generation, status, now, a.traceTransitionPending === true);
                a.traceTransitionPending = false;
            }
            if (sample)
                a.stageTrace.sample(status, now, observedVia);
        });
    }
    async ensure(a) {
        this.current(a);
        if (a.helper)
            return;
        if (a.starting)
            return a.starting;
        a.starting = (async () => {
            const onEvent = (event) => {
                if (this.active !== a || a.revoked)
                    return;
                if (event.event === "fatal") {
                    a.nativeFailure = { ...event.error, devicesReleased: false };
                    a.error = event.error.message;
                    a.enabled = false;
                    a.latest = undefined;
                    a.cacheMetrics?.end("failed", performance.now());
                    if (a.diagnosticTraceEnabled)
                        this.trace(a, () => a.stageTrace?.end("failed", performance.now()));
                    if (a.observation)
                        a.observation = { ...a.observation, connection: "failed", latestFrame: null, lastError: event.error };
                    this.wakeFrameWaiters(a);
                    for (const recording of a.recordings.values())
                        if (["starting", "recording", "finishing"].includes(recording.state)) {
                            recording.state = "failed";
                            recording.uncertain = true;
                            recording.error = event.error.message;
                            clearTimeout(recording.timer);
                        }
                }
                else if (event.event === "status") {
                    a.observation = event.status;
                    if (a.diagnosticTraceEnabled)
                        this.observeTrace(a, event.status, performance.now(), "native-status-event");
                    if (a.latest && !frameMatchesStatus(event.status, a.latest.metadata))
                        a.latest = undefined;
                    if (event.status.connection !== "connected")
                        a.cacheMetrics?.end(event.status.connection === "disconnected" ? "disconnected" : event.status.connection === "failed" ? "failed" : "control-transition", performance.now());
                    this.wakeFrameWaiters(a);
                }
                else if (event.event === "closed") {
                    if (!event.devicesReleased)
                        a.error = "Native device release was not confirmed.";
                }
                else
                    a.publishing = (a.publishing ?? Promise.resolve()).then(() => this.finish(a, event.recording)).catch(error => { a.error = String(error instanceof Error ? error.message : error); });
            };
            if (this.options.helperFactory)
                a.helper = await this.options.helperFactory(onEvent);
            else if ((this.options.platform ?? process.platform) === "linux") {
                if (!this.options.linuxHelperManifest || !["arm64", "x64"].includes(process.arch))
                    throw new Error("This build does not contain a capture backend for this Linux architecture.");
                const pin = (file) => z.object({ file: z.literal(file), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
                const bytes = await readBoundedCaptureAsset(this.options.linuxHelperManifest, 4096);
                const manifest = z.object({ protocolVersion: z.literal(1), architectures: z.object({ arm64: pin("arm64/ffmpeg"), x64: pin("x64/ffmpeg") }).strict() }).strict().parse(JSON.parse(bytes.toString("utf8")));
                const selected = manifest.architectures[process.arch];
                a.helper = await LinuxNativeHelper.launch({ executable: path.join(path.dirname(this.options.linuxHelperManifest), selected.file), sha256: selected.sha256, onEvent });
            }
            else {
                if ((this.options.platform ?? process.platform) !== "darwin")
                    throw new Error("Native device capture is currently available on macOS only. Emulator capture remains available.");
                if (!this.options.helperManifest)
                    throw new Error("The verified native capture helper is not included in this build.");
                const bytes = await readBoundedCaptureAsset(this.options.helperManifest, 4096);
                const manifest = z.object({ protocolVersion: z.literal(1), file: z.literal("chromatic-capture-helper"), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(JSON.parse(bytes.toString("utf8")));
                a.helper = await NativeHelperProcess.launch({ executable: path.join(path.dirname(this.options.helperManifest), manifest.file), sha256: manifest.sha256, onEvent });
            }
            try {
                a.files = await NativeCaptureFiles.create(a.helper.ready.sessionDir);
                this.current(a);
                this.schedule(a);
            }
            catch (error) {
                try {
                    await a.helper.close();
                    a.helper = undefined;
                }
                catch (cleanupError) {
                    a.revoked = true;
                    a.enabled = false;
                    a.latest = undefined;
                    a.error = `Native capture startup failed and device release is unconfirmed: ${cleanupError instanceof Error ? cleanupError.message : String(cleanupError)}`;
                    throw new NativeHelperError(a.error, true);
                }
                throw error;
            }
        })();
        try {
            await a.starting;
        }
        finally {
            a.starting = undefined;
        }
    }
    pollInterval(a) { return this.permissionRequired && a.enabled && a.observation?.connection === "connected" ? 1000 / 60 : 100; }
    schedule(a, delay = this.pollInterval(a)) { if (a.polling || a.revoked || a.closing)
        return; a.polling = setTimeout(() => { a.polling = undefined; void this.poll(a); }, delay); a.polling.unref?.(); }
    async poll(a) {
        if (a.revoked || a.closing || this.active !== a)
            return;
        const started = performance.now();
        if (!this.options.isSelected(a.projectRoot, a.generation)) {
            a.error = "The selected project changed.";
            await this.shutdown(a).catch(() => { });
            return;
        }
        if (a.helper && !a.working) {
            a.working = true;
            const passive = Promise.resolve().then(async () => {
                const cycleStarted = performance.now();
                let metrics;
                try {
                    const statusStarted = performance.now(), statusTrace = a.stageTrace, readingStatus = !a.revokePending;
                    if (a.diagnosticTraceEnabled && readingStatus)
                        this.trace(a, () => statusTrace?.begin("status", statusStarted));
                    try {
                        if (a.revokePending) {
                            a.observation = nativeStatusSchema.parse(await a.helper.request("disconnect"));
                            a.revokePending = false;
                        }
                        else
                            a.observation = nativeStatusSchema.parse(await a.helper.request("status"));
                    }
                    catch (error) {
                        if (a.diagnosticTraceEnabled && readingStatus)
                            this.trace(a, () => statusTrace?.finish("status", false, performance.now()));
                        throw error;
                    }
                    const statusFinished = performance.now();
                    if (a.diagnosticTraceEnabled && readingStatus)
                        this.trace(a, () => statusTrace?.finish("status", true, statusFinished));
                    if (a.diagnosticTraceEnabled)
                        this.observeTrace(a, a.observation, statusFinished);
                    if (a.observation.lastError)
                        a.error = a.observation.lastError.message;
                    if (a.observation.connection !== "connected" || !a.enabled) {
                        a.cacheMetrics?.end(!a.enabled ? "capture-disabled" : a.observation.connection === "disconnected" ? "disconnected" : a.observation.connection === "failed" ? "failed" : "control-transition", statusFinished);
                        a.latest = undefined;
                        this.wakeFrameWaiters(a);
                    }
                    else if (!a.observation.latestFrame) {
                        a.latest = undefined;
                        this.wakeFrameWaiters(a);
                    }
                    else if (!a.frameReleaseFailure) {
                        if (a.latest && !frameMatchesStatus(a.observation, a.latest.metadata)) {
                            a.latest = undefined;
                            this.wakeFrameWaiters(a);
                        }
                        if (!a.cacheMetrics || !a.cacheMetrics.matchesStatus(a.observation) || a.cacheMetrics.restartable()) {
                            a.cacheMetrics?.end("connection-change", statusFinished);
                            a.cacheMetrics = NativeCacheMetrics.forStatus(a.observation, statusFinished);
                        }
                        metrics = a.cacheMetrics;
                        metrics?.sample("status", statusFinished - statusStarted, statusFinished);
                        if (a.observation.latestFrame.frameId !== a.latest?.metadata.frameId || a.observation.latestFrame.connectionId !== a.latest?.metadata.connectionId) {
                            const selectedStatus = a.observation, acquisitionStarted = performance.now(), acquisitionTrace = a.stageTrace;
                            metrics?.attempted(acquisitionStarted);
                            if (a.diagnosticTraceEnabled)
                                this.trace(a, () => acquisitionTrace?.begin("acquisition", acquisitionStarted));
                            let frame;
                            try {
                                frame = await this.readImage(a, "live_frame");
                            }
                            catch (error) {
                                const failedAt = performance.now();
                                if (a.diagnosticTraceEnabled)
                                    this.trace(a, () => acquisitionTrace?.finish("acquisition", false, failedAt));
                                metrics?.failed(failedAt);
                                if (a.frameReleaseFailure) {
                                    metrics?.end("failed", failedAt);
                                    if (a.diagnosticTraceEnabled)
                                        this.trace(a, () => acquisitionTrace?.end("failed", failedAt));
                                }
                                throw error;
                            }
                            const completed = performance.now();
                            if (a.diagnosticTraceEnabled)
                                this.trace(a, () => acquisitionTrace?.finish("acquisition", true, completed, frame.readDurationMs));
                            metrics?.sample("acquisition", completed - acquisitionStarted, completed);
                            metrics?.sample("fileRead", frame.readDurationMs, completed);
                            metrics?.validated(frame.metadata, completed);
                            if (!a.revoked && !a.closing && a.enabled && this.active === a && this.options.isSelected(a.projectRoot, a.generation)) {
                                if (frameMatchesStatus(selectedStatus, frame.metadata) && frameMatchesStatus(a.observation, frame.metadata)) {
                                    a.frameIdentityFailure = undefined;
                                    const publishedAt = a.diagnosticTraceEnabled ? performance.now() : completed;
                                    if (a.diagnosticTraceEnabled && Number.isFinite(publishedAt) && publishedAt >= 0)
                                        frame.cachePublishedAtMs = publishedAt;
                                    a.latest = frame;
                                    if (a.diagnosticTraceEnabled)
                                        this.trace(a, () => acquisitionTrace?.publish(frame.metadata, publishedAt));
                                    metrics?.published(frame.metadata, completed);
                                    this.wakeFrameWaiters(a);
                                }
                                else {
                                    if (a.diagnosticTraceEnabled)
                                        this.trace(a, () => acquisitionTrace?.mismatch(completed));
                                    metrics?.identityMismatch(completed);
                                    a.frameIdentityFailure = { code: "FRAME_IDENTITY_MISMATCH", message: "The native frame identity did not match connected status; the frame was not published." };
                                    if (a.latest && !frameMatchesStatus(a.observation, a.latest.metadata))
                                        a.latest = undefined;
                                    this.wakeFrameWaiters(a);
                                }
                            }
                        }
                    }
                }
                catch (error) {
                    if (!a.revoked && !(error instanceof NativeHelperError && error.code === "NO_VIDEO_FRAME"))
                        a.error = error instanceof Error ? error.message : String(error);
                }
                finally {
                    const now = performance.now();
                    metrics?.sample("poll", now - cycleStarted, now);
                    a.working = false;
                    a.passive = undefined;
                    if (a.diagnosticTraceEnabled) {
                        const pending = a.tracePendingObservation;
                        a.tracePendingObservation = undefined;
                        a.traceAwaitingPassive = false;
                        if (pending)
                            this.observeTrace(a, pending.status, now, pending.observedVia, false);
                    }
                }
            });
            a.passive = passive;
            await passive;
        }
        // One acquisition at a time. Work consumes the interval rather than adding
        // a second fixed delay after every status/read/release cycle.
        this.schedule(a, Math.max(0, this.pollInterval(a) - (performance.now() - started)));
    }
    async readImage(a, action) {
        const helper = a.helper, raw = await helper.request(action);
        const record = raw && typeof raw === "object" ? raw : undefined;
        const hasLease = !!record && Object.hasOwn(record, "leaseId");
        const parsedLease = hasLease ? z.string().uuid().safeParse(record.leaseId) : undefined;
        let frame, failed = false, firstError;
        try {
            const image = nativeImageSchema.parse(raw);
            if (image.sessionId !== helper.ready.sessionId)
                throw new Error("Native image belongs to another session.");
            if (image.format !== (action === "live_frame" ? "jpeg" : "png"))
                throw new Error(action === "live_frame" ? "Native preview must be JPEG." : "Native screenshots must be PNG.");
            const started = performance.now(), bytes = await a.files.image(image);
            if (image.format === "png")
                validatePng(bytes, { width: image.width, height: image.height });
            const metadata = { ...image };
            delete metadata.leaseId;
            frame = { bytes, metadata, readDurationMs: performance.now() - started };
        }
        catch (error) {
            failed = true;
            firstError = error;
        }
        if (hasLease) {
            try {
                if (!parsedLease?.success)
                    throw new Error("Native frame lease ID is invalid.");
                const leaseId = parsedLease.data;
                if (record.sessionId !== helper.ready.sessionId)
                    throw new Error("Native frame lease belongs to another session.");
                const released = nativeFrameReleaseSchema.parse(await helper.request("release_frame", { leaseId }));
                if (released.sessionId !== helper.ready.sessionId || released.leaseId !== leaseId || typeof record.stateSequence !== "number" || released.stateSequence < record.stateSequence)
                    throw new Error("Native frame release identity did not match.");
            }
            catch (error) {
                const releaseError = error instanceof Error ? error.message : String(error);
                a.frameReleaseFailure = { ...(parsedLease?.success ? { leaseId: parsedLease.data } : {}), error: releaseError, uncertain: true };
                a.latest = undefined;
                a.enabled = false;
                this.wakeFrameWaiters(a);
                const primary = failed ? (firstError instanceof Error ? firstError.message : String(firstError)) : "Native frame release was not confirmed.";
                throw new NativeHelperError(`${primary} Frame release is uncertain: ${releaseError}`, true, "FRAME_RELEASE_UNCONFIRMED");
            }
        }
        if (failed)
            throw firstError;
        return frame;
    }
    frameHeaders(res, frame) {
        const image = frame.metadata;
        res.setHeader("X-Chromatic-Native-Session-Id", image.sessionId);
        res.setHeader("X-Chromatic-State-Sequence", String(image.stateSequence));
        res.setHeader("X-Chromatic-Frame-Id", String(image.frameId));
        res.setHeader("X-Chromatic-Source-Pts", String(image.sourcePTS));
        res.setHeader("X-Chromatic-Frame-Sha256", image.sha256);
        res.setHeader("X-Chromatic-Frame-Width", String(image.width));
        res.setHeader("X-Chromatic-Frame-Height", String(image.height));
        res.setHeader("X-Chromatic-Read-Duration-Ms", String(frame.readDurationMs));
        if (frame.cachePublishedAtMs !== undefined && Number.isFinite(frame.cachePublishedAtMs) && frame.cachePublishedAtMs >= 0)
            res.setHeader("X-Chromatic-Cache-Published-At-Ms", String(frame.cachePublishedAtMs));
        res.setHeader("Server-Timing", `native-file;dur=${frame.readDurationMs.toFixed(3)}`);
        if (image.connectionId !== undefined)
            res.setHeader("X-Chromatic-Connection-Id", image.connectionId);
        if (image.previewSequence !== undefined)
            res.setHeader("X-Chromatic-Preview-Sequence", String(image.previewSequence));
        if (image.sourceGeneration !== undefined)
            res.setHeader("X-Chromatic-Source-Generation", String(image.sourceGeneration));
        if (image.sourceClock !== undefined)
            res.setHeader("X-Chromatic-Source-Clock", image.sourceClock);
        if (image.timing) {
            res.setHeader("X-Chromatic-Timing-Clock", image.timing.clock);
            res.setHeader("X-Chromatic-Callback-Received-At-Ms", String(image.timing.callbackReceivedAtMs));
            res.setHeader("X-Chromatic-Encode-Started-At-Ms", String(image.timing.encodeStartedAtMs));
            res.setHeader("X-Chromatic-Encode-Finished-At-Ms", String(image.timing.encodeFinishedAtMs));
            res.setHeader("X-Chromatic-Published-At-Ms", String(image.timing.publishedAtMs));
            const timing = image.timing;
            for (const [header, value] of [["Preview-Queued-At-Ms", timing.previewQueuedAtMs], ["Hash-Finished-At-Ms", timing.hashFinishedAtMs], ["File-Written-At-Ms", timing.fileWrittenAtMs]])
                if (value !== undefined)
                    res.setHeader(`X-Chromatic-${header}`, String(value));
        }
    }
    wakeFrameWaiters(a) { for (const wake of [...a.frameWaiters])
        wake(); }
    afterIdentity(req) {
        const name = "x-chromatic-after-identity", raw = req.headers[name];
        if (raw === undefined)
            return;
        if (!single(req, name) || typeof raw !== "string" || raw.length > 512)
            throw new HttpError(400, "Invalid previous frame identity.");
        let value;
        try {
            value = JSON.parse(raw);
        }
        catch {
            throw new HttpError(400, "Invalid previous frame identity.");
        }
        const parsed = afterIdentitySchema.safeParse(value);
        if (!parsed.success)
            throw new HttpError(400, "Invalid previous frame identity.");
        return parsed.data;
    }
    newerFrame(a, after) {
        this.current(a);
        if (!a.enabled || a.observation?.connection !== "connected" || !a.observation.latestFrame || !a.latest)
            throw new HttpError(404, "No native frame has arrived.");
        const frame = a.latest, image = frame.metadata;
        if (!frameMatchesStatus(a.observation, image))
            throw new HttpError(409, "The native connection changed while reading a frame.");
        if (!after)
            return frame;
        if (after.nativeSessionId !== image.sessionId || after.connectionId !== image.connectionId || after.sourceGeneration !== image.sourceGeneration || (after.previewSequence === undefined) !== (image.previewSequence === undefined))
            throw new HttpError(409, "The previous frame belongs to a different connection.");
        const previous = after.previewSequence ?? after.frameId, current = image.previewSequence ?? image.frameId;
        if (current < previous)
            throw new HttpError(409, "The native preview sequence regressed.");
        if (current > previous)
            return frame;
        if (after.frameId !== image.frameId || after.sha256 !== image.sha256)
            throw new HttpError(409, "The previous frame identity changed.");
        return;
    }
    validateFrameResponse(a, frame) {
        this.current(a);
        if (!a.enabled || a.observation?.connection !== "connected" || !a.observation.latestFrame || !a.latest)
            throw new HttpError(409, "The native connection changed while reading a frame.");
        if (!frameMatchesStatus(a.observation, frame.metadata) || frame.metadata.sessionId !== a.latest.metadata.sessionId || frame.metadata.connectionId !== a.latest.metadata.connectionId || frame.metadata.sourceGeneration !== a.latest.metadata.sourceGeneration)
            throw new HttpError(409, "The native connection changed while reading a frame.");
    }
    waitFrameChange(a, req, res, delay) {
        if (a.frameWaiters.size >= MAX_FRAME_WAITERS)
            throw new HttpError(429, "Too many pending frame requests.");
        return new Promise(resolve => {
            let settled = false, timer;
            const socket = req.socket;
            const finish = (open) => { if (settled)
                return; settled = true; if (timer)
                clearTimeout(timer); a.frameWaiters.delete(changed); res.off("close", closed); req.off("aborted", closed); socket.off("close", closed); resolve(open); };
            const changed = () => finish(true), closed = () => finish(false);
            a.frameWaiters.add(changed);
            res.once("close", closed);
            req.once("aborted", closed);
            socket.once("close", closed);
            timer = setTimeout(() => finish(true), delay);
            timer.unref?.();
            if (res.destroyed || req.aborted || socket.destroyed)
                finish(false);
        });
    }
    async waitNextFrame(a, req, res, after) {
        const deadline = performance.now() + NEXT_FRAME_WAIT_MS;
        let waitDurationMs = 0;
        for (;;) {
            const frame = this.newerFrame(a, after);
            if (frame)
                return { frame, abandoned: false, waitDurationMs };
            const remaining = deadline - performance.now();
            if (req.method === "HEAD" || remaining <= 0)
                return { abandoned: false, waitDurationMs };
            const started = performance.now(), open = await this.waitFrameChange(a, req, res, remaining);
            waitDurationMs += Math.max(0, performance.now() - started);
            if (!open)
                return { abandoned: true, waitDurationMs };
        }
    }
    // Optional diagnostic sample. Never compete for the helper's single IPC
    // slot: a busy poll or control simply leaves this sample unavailable.
    async frameClock(a, frame) {
        if (!this.permissionRequired)
            return { reason: "unsupported" };
        if (!a.helper || !a.enabled || a.observation?.connection !== "connected" || !frame.metadata.connectionId || !frame.metadata.timing)
            return { reason: "invalid" };
        if (a.working)
            return { reason: "busy" };
        a.working = true;
        const work = (async () => {
            try {
                const parsed = nativeClockSchema.safeParse(await a.helper.request("clock"));
                if (!parsed.success || parsed.data.sessionId !== frame.metadata.sessionId || parsed.data.uptimeMs < frame.metadata.timing.publishedAtMs)
                    return { reason: "invalid" };
                return { clock: parsed.data.uptimeMs };
            }
            catch {
                return { reason: "error" };
            }
            finally {
                a.working = false;
                a.passive = undefined;
            }
        })();
        a.passive = work.then(() => { });
        return work;
    }
    async waitForPassive(a) {
        const passive = a.passive;
        if (!passive)
            return;
        let timeout;
        try {
            await Promise.race([passive, new Promise((_, reject) => { timeout = setTimeout(() => reject(new HttpError(409, "Device status is still being read. Try again.")), 2000); })]);
        }
        finally {
            if (timeout)
                clearTimeout(timeout);
        }
        this.current(a);
    }
    async control(action, durationMs, configuration, settingsTab) {
        const a = this.active;
        if (!a)
            return { success: action === "close", error: action === "close" ? undefined : "Open a capture session first.", status: this.status() };
        if (action === "close" && a.closing) {
            if (durationMs !== undefined || configuration)
                throw new Error("Unexpected close fields.");
            await a.closing;
            return { success: true, status: this.status() };
        }
        this.current(a);
        if (action === "open_settings") {
            a.settingsTab = settingsTab ?? "connection";
            a.settingsRequest++;
            return { success: true, status: this.status() };
        }
        if (durationMs !== undefined && (action !== "start_recording" || !Number.isInteger(durationMs) || durationMs < 1000 || durationMs > 600000))
            throw new Error("durationMs is valid only for recording, from 1000 to 600000.");
        if (action !== "connect" && configuration)
            throw new Error("Device selection applies only to connect.");
        if (action === "close") {
            await this.shutdown(a);
            return { success: true, status: this.status() };
        }
        await this.waitForPassive(a);
        if (a.working)
            throw new HttpError(409, "A capture operation is still finishing. Check status.");
        a.working = true;
        a.error = undefined;
        const enableGeneration = a.enableGeneration;
        try {
            await this.ensure(a);
            if (action === "list_devices") {
                a.devices = nativeInventorySchema.parse(await a.helper.request("list"));
                a.devicesAt = Date.now();
                return { success: true, devices: a.devices, status: this.status() };
            }
            if (action === "permission_status") {
                a.observation = nativeStatusSchema.parse(await a.helper.request("permission_status"));
                return { success: true, status: this.status() };
            }
            if (["connect", "screenshot", "live_frame", "start_recording"].includes(action) && a.frameReleaseFailure)
                throw new NativeHelperError("Close this capture session after its unconfirmed frame release.", true, "FRAME_RELEASE_UNCONFIRMED");
            if (["connect", "screenshot", "live_frame", "start_recording"].includes(action) && !a.enabled)
                throw new CaptureDisabledError();
            if (action === "connect") {
                if (!configuration || !a.devices || configuration.inventoryId !== a.devices.inventoryId || !a.devicesAt || Date.now() - a.devicesAt >= 60000)
                    throw new Error("Refresh devices and use the exact selection from the current list.");
                const s = nativeSelectionSchema.parse(configuration.selection);
                if (!a.devices.videoDevices.some(d => d.deviceId === s.videoId && d.label === s.videoLabel) || (s.audioId && !a.devices.audioDevices.some(d => d.deviceId === s.audioId && d.label === s.audioLabel)))
                    throw new Error("The selection is not in this session's current device list.");
                if (s.audioId && !this.permissionRequired)
                    throw new Error("USB audio capture is not supported on Linux in this build. Use video only.");
                if (s.audioId) {
                    // Passive connected status can carry a bounded permission snapshot.
                    // Recheck before using it to decide whether a new connection may start.
                    const observationBefore = a.observation;
                    const fresh = nativeStatusSchema.parse(await a.helper.request("permission_status"));
                    this.current(a);
                    if (!a.enabled || enableGeneration !== a.enableGeneration)
                        throw new CaptureDisabledError();
                    if (!a.devicesAt || Date.now() - a.devicesAt >= 60000)
                        throw new Error("Refresh devices and use the exact selection from the current list.");
                    // A status event may arrive before this response's continuation.
                    if (a.observation === observationBefore)
                        a.observation = fresh;
                    if (fresh.permissions.audio !== "authorized") {
                        if (a.observation !== fresh && a.observation?.permissions.audio === "authorized")
                            throw new Error("USB audio permission changed while connecting. Refresh Connection settings and try again.");
                        throw new Error("Enable USB audio in Connection settings to request microphone permission.");
                    }
                }
                a.observation = nativeStatusSchema.parse(await a.helper.request("connect", { inventoryId: configuration.inventoryId, selection: { videoDeviceId: s.videoId, ...(s.audioId ? { audioDeviceId: s.audioId } : {}) }, previewFps: this.permissionRequired ? 60 : 10 }));
                if (!a.enabled || enableGeneration !== a.enableGeneration) {
                    a.observation = nativeStatusSchema.parse(await a.helper.request("disconnect"));
                    throw new CaptureDisabledError();
                }
                if (a.observation.connection !== "connected" || a.observation.selection?.videoDeviceId !== s.videoId || a.observation.selection?.audioDeviceId !== s.audioId)
                    throw new Error("The native connection did not match the selected Chromatic.");
            }
            else if (action === "start_recording") {
                if (a.observation?.connection !== "connected")
                    throw new Error("Connect your Chromatic before recording.");
                if ([...a.recordings.values()].some(r => ["starting", "recording", "finishing"].includes(r.state)))
                    throw new Error("A recording is already active or finishing.");
                if (a.recordings.size >= 2 || SESSION_BYTES - a.totalBytes < NATIVE_LIMITS.maxRecordingBytes)
                    throw new Error("This session reached its recording quota. Save your captures and close the session.");
                const captureId = randomUUID(), duration = durationMs ?? 180000;
                const recording = { captureId, state: "starting", durationMs: duration, deadline: new Date(Date.now() + duration).toISOString() };
                a.recordings.set(captureId, recording);
                recording.timer = setTimeout(() => { if (["starting", "recording", "finishing"].includes(recording.state)) {
                    recording.state = "failed";
                    recording.error = "Native recording deadline passed without a final receipt.";
                    a.error = recording.error;
                    void a.helper?.close().catch(() => { });
                } }, duration + 20000);
                recording.timer.unref?.();
                void a.helper.request("start_recording", { captureId, durationMs: duration }).then(value => { a.observation = nativeStatusSchema.parse(value); if (!a.enabled || enableGeneration !== a.enableGeneration) {
                    a.revokePending = true;
                    throw new CaptureDisabledError();
                } if (a.observation.recording?.captureId !== captureId)
                    throw new Error("Native recording ID did not match."); if (recording.state === "starting")
                    recording.state = "recording"; }).catch(error => { recording.state = "failed"; recording.error = error instanceof Error ? error.message : String(error); a.error = recording.error; clearTimeout(recording.timer); }).finally(() => { a.working = false; });
                return { success: true, accepted: true, captureId, deadline: recording.deadline, status: this.status(captureId) };
            }
            else if (action === "screenshot" || action === "live_frame") {
                const frame = await this.readImage(a, action), image = frame.metadata, bytes = frame.bytes;
                if (action === "live_frame") {
                    const id = randomUUID();
                    a.frames.set(id, frame);
                    while (a.frames.size > 2)
                        a.frames.delete(a.frames.keys().next().value);
                    return { success: true, frameId: id, frameMetadata: image, image: { data: bytes.toString("base64"), mimeType: "image/jpeg" }, status: this.status() };
                }
                if (a.captures.size >= 32 || a.totalBytes + bytes.length > SESSION_BYTES)
                    throw new Error("Capture session quota reached.");
                a.totalBytes += bytes.length;
                const capture = await a.store.save({ kind: "screenshot", mimeType: "image/png", media: bytes, metadata: this.metadata(a, image) });
                a.captures.set(capture.id, capture);
                return { success: true, capture: { ...capture, url: this.url(a) + "captures/" + capture.id }, image: { data: bytes.toString("base64"), mimeType: "image/png" }, status: this.status() };
            }
            else {
                if (action !== "stop_recording")
                    a.latest = undefined;
                if (action === "disconnect") {
                    const now = performance.now();
                    a.cacheMetrics?.end("control-transition", now);
                    if (a.diagnosticTraceEnabled)
                        this.trace(a, () => a.stageTrace?.end("control-transition", now));
                }
                this.wakeFrameWaiters(a);
                a.observation = nativeStatusSchema.parse(await a.helper.request(action));
                await a.publishing;
            }
            return { success: true, status: this.status() };
        }
        catch (error) {
            if (a.frameReleaseFailure) {
                const now = performance.now();
                a.cacheMetrics?.end("failed", now);
                if (a.diagnosticTraceEnabled)
                    this.trace(a, () => a.stageTrace?.end("failed", now));
            }
            a.error = error instanceof Error ? error.message : String(error);
            return { success: false, error: a.error, code: error instanceof CaptureDisabledError ? "CAPTURE_NOT_ENABLED" : error instanceof NativeHelperError ? error.code : undefined, uncertain: error instanceof NativeHelperError && error.uncertain, status: this.status() };
        }
        finally {
            if (action !== "start_recording" || ![...a.recordings.values()].some(r => r.state === "starting"))
                a.working = false;
        }
    }
    metadata(a, value) { return { ...value, source: "physical-uvc", synthetic: this.options.reviewFixture === true, sessionId: a.sessionId, generation: a.generation, nativeSessionId: a.helper?.ready.sessionId, authentication: "Native source timestamps and selected device labels only; cartridge ROM is unknown." }; }
    async finish(a, result) {
        const recording = a.recordings.get(result.captureId);
        if (!recording)
            return;
        if (recording.native) {
            if (JSON.stringify(recording.native) !== JSON.stringify(result))
                throw new Error("Native recording has conflicting final receipts.");
            return;
        }
        recording.native = result;
        recording.state = "finishing";
        if (recording.timer)
            clearTimeout(recording.timer);
        try {
            result = nativeRecordingSchema.parse(result);
            if (!result.basename || !result.sha256 || !result.bytes)
                throw new Error(result.error?.message ?? "No native video file was finalized.");
            if (result.state !== "complete") {
                const retained = await a.files.verifiedFile(result);
                recording.retainedPath = retained.path;
                await retained.handle.close();
                throw new Error(result.error?.message ?? "Native recording is partial. Its original file is retained; ask Claude to inspect the recording status.");
            }
            if (a.totalBytes + result.bytes > SESSION_BYTES)
                throw new Error("Session publication quota exceeded.");
            const file = await a.files.verifiedFile(result);
            a.totalBytes += result.bytes;
            try {
                let offset = 0, sequence = 0;
                const buffer = Buffer.alloc(Math.min(1024 * 1024, file.bytes));
                while (offset < file.bytes) {
                    const { bytesRead } = await file.handle.read(buffer, 0, Math.min(buffer.length, file.bytes - offset), offset);
                    if (!bytesRead)
                        throw new Error("Native video changed during publication.");
                    await a.store.appendVideo(result.captureId, sequence++, result.format === "webm" ? "video/webm" : "video/mp4", buffer.subarray(0, bytesRead));
                    offset += bytesRead;
                }
                const capture = await a.store.finishVideo(result.captureId, this.metadata(a, result));
                if (capture.sha256 !== result.sha256)
                    throw new Error("Published video did not match the native final receipt.");
                recording.result = capture;
                recording.state = "complete";
                a.captures.set(capture.id, capture);
            }
            finally {
                await file.handle.close();
            }
        }
        catch (error) {
            recording.state = result.state === "partial" ? "partial" : "failed";
            recording.error = error instanceof Error ? error.message : String(error);
            a.error = recording.error;
        }
    }
    async setEnabled(enabled, includeAudio = false) {
        const a = this.active;
        if (!a)
            throw new Error("Open a capture session first.");
        this.current(a);
        if (enabled && a.frameReleaseFailure)
            return { success: false, error: "Close this capture session after its unconfirmed frame release.", uncertain: true, status: this.status() };
        if (!this.permissionRequired)
            return { success: false, error: "Linux capture has no Enable step. Use Connect or Disconnect; USB audio is not supported in this build.", status: this.status() };
        const requestedGeneration = a.enableGeneration;
        if (!enabled) {
            a.enabled = false;
            a.latest = undefined;
            a.enableGeneration++;
            a.revokePending = true;
            const now = performance.now();
            a.cacheMetrics?.end("capture-disabled", now);
            if (a.diagnosticTraceEnabled)
                this.trace(a, () => a.stageTrace?.end("capture-disabled", now));
            this.wakeFrameWaiters(a);
            if (a.working)
                return { success: true, accepted: true, status: this.status() };
        }
        if (enabled) {
            await this.waitForPassive(a);
            if (requestedGeneration !== a.enableGeneration)
                return { success: false, error: "Capture was turned off.", status: this.status() };
        }
        if (a.working)
            throw new HttpError(409, "A capture operation is still finishing.");
        a.working = true;
        const enableGeneration = a.enableGeneration;
        const check = () => { this.current(a); if (enableGeneration !== a.enableGeneration)
            throw new CaptureDisabledError(); };
        try {
            await this.ensure(a);
            check();
            if (!enabled) {
                a.observation = nativeStatusSchema.parse(await a.helper.request("disconnect"));
                a.revokePending = false;
                await a.publishing;
            }
            else {
                a.observation = nativeStatusSchema.parse(await a.helper.request("permission_status"));
                check();
                if (a.observation.permissions.video === "not_determined") {
                    check();
                    a.observation = nativeStatusSchema.parse(await a.helper.request("request_permission", { media: "video" }));
                    check();
                }
                if (a.observation.permissions.video !== "authorized")
                    throw new Error("Camera access is not enabled for the native capture helper. Allow it in macOS Privacy & Security, then try Enable device capture again.");
                if (includeAudio && a.observation.permissions.audio === "not_determined") {
                    check();
                    a.observation = nativeStatusSchema.parse(await a.helper.request("request_permission", { media: "audio" }));
                    check();
                }
                if (includeAudio && a.observation.permissions.audio !== "authorized")
                    throw new Error("USB audio needs microphone access for the native capture helper. Allow it in macOS Privacy & Security, or use video only.");
                check();
                a.enabled = true;
            }
            a.error = undefined;
            return { success: true, status: this.status() };
        }
        catch (error) {
            a.error = error instanceof Error ? error.message : String(error);
            return { success: false, error: a.error, status: this.status() };
        }
        finally {
            a.working = false;
        }
    }
    async readCapture(id) {
        const a = this.active;
        if (!a)
            return { success: false, error: "Open a capture session first.", status: this.status() };
        this.current(a);
        const frame = id ? a.frames.get(id) : undefined;
        if (frame)
            return { success: true, frameId: id, frameMetadata: frame.metadata, image: { data: frame.bytes.toString("base64"), mimeType: frame.metadata.format === "png" ? "image/png" : "image/jpeg" }, status: this.status() };
        const record = id ? a.recordings.get(id)?.result ?? a.captures.get(id) : [...a.recordings.values()].reverse().find(r => r.result)?.result;
        if (!record)
            return { success: false, error: "No completed capture is available for that ID.", status: this.status(id) };
        const capture = { ...record, url: this.url(a) + "captures/" + record.id };
        if (record.kind === "video")
            return { success: true, capture, status: this.status(id) };
        const file = await a.store.read(record.id);
        this.current(a);
        if (!file)
            throw new Error("Saved screenshot was not found.");
        return { success: true, capture, image: { data: file.bytes.toString("base64"), mimeType: "image/png" }, status: this.status(id) };
    }
    async dispose() { this.disposed = true; if (this.active)
        await this.shutdown(this.active); }
    async shutdown(a) {
        if (a.closing)
            return a.closing;
        let ready;
        a.closeReady = new Promise(resolve => { ready = resolve; });
        a.closing = (async () => {
            if (a.polling)
                clearTimeout(a.polling);
            await a.starting?.catch(() => { });
            let failure, failed = false;
            const remember = (error) => { if (!failed) {
                failed = true;
                failure = error;
            } };
            // Filesystem reads do not inherit the helper's request timeout. Give the
            // original lease/read a bounded grace, but always ask native Stop to run.
            if (a.passive) {
                let timer;
                try {
                    await Promise.race([a.passive, new Promise((_, reject) => { timer = setTimeout(() => reject(new NativeHelperError("The native preview read did not settle within the shutdown grace period.", true, "PASSIVE_READ_UNSETTLED")), 2000); })]);
                }
                catch (error) {
                    remember(error);
                }
                finally {
                    if (timer)
                        clearTimeout(timer);
                }
            }
            try {
                await a.helper?.close();
            }
            catch (error) {
                remember(error);
            }
            try {
                await a.publishing;
            }
            catch (error) {
                remember(error);
            }
            a.revoked = true;
            a.enabled = false;
            a.latest = undefined;
            for (const r of a.recordings.values())
                if (r.timer)
                    clearTimeout(r.timer);
            try {
                await a.store.closeVideoUploads();
            }
            catch (error) {
                remember(error);
            }
            const listenerClosed = new Promise(resolve => {
                const timer = setTimeout(() => a.server.closeAllConnections(), 5000);
                timer.unref?.();
                try {
                    a.server.close(error => { clearTimeout(timer); if (error)
                        remember(error); resolve(); });
                }
                catch (error) {
                    clearTimeout(timer);
                    remember(error);
                    resolve();
                }
                try {
                    a.server.closeIdleConnections();
                }
                catch (error) {
                    remember(error);
                }
            });
            // An HTTP close request itself keeps this listener open. Report native
            // cleanup first, while retaining ownership until that response drains.
            if (failed)
                a.error = `Native shutdown is unconfirmed: ${failure instanceof Error ? failure.message : String(failure)} This session remains reserved; do not start a replacement capture.`;
            ready({ failed, ...(failed ? { error: a.error } : {}) });
            await listenerClosed;
            this.closedPort = a.port;
            if (failed) {
                a.error = `Native shutdown is unconfirmed: ${failure instanceof Error ? failure.message : String(failure)} This session remains reserved; do not start a replacement capture.`;
                throw failure;
            }
            if (this.active === a)
                this.active = undefined;
        })();
        const now = performance.now();
        a.cacheMetrics?.end("shutdown-started", now);
        if (a.diagnosticTraceEnabled)
            this.trace(a, () => a.stageTrace?.end("shutdown-started", now));
        this.wakeFrameWaiters(a);
        return a.closing;
    }
    async handle(req, res, a) {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        res.setHeader("X-Frame-Options", "DENY");
        res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self'; img-src 'self' blob:; media-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
        res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        const origin = `http://127.0.0.1:${a.port}`;
        if (!single(req, "host") || req.headers.host !== `127.0.0.1:${a.port}` || (req.headers.origin !== undefined && (!single(req, "origin") || req.headers.origin !== origin)) || (req.headers["sec-fetch-site"] !== undefined && !["same-origin", "none"].includes(String(req.headers["sec-fetch-site"]))))
            throw new HttpError(403, "Local same-origin requests only.");
        const match = /^\/([a-f0-9]{64})\/(.*)$/.exec(req.url ?? "");
        if (!match || !timingSafeEqual(Buffer.from(match[1]), Buffer.from(a.token)))
            throw new HttpError(404, "Not found.");
        const route = match[2];
        if (/[?#%\\]/.test(route))
            throw new HttpError(404, "Not found.");
        this.current(a);
        await this.serveRoute(req, res, a, route, origin);
    }
    /** The selected emulator's authenticated listener can host this same view. No second device owner or cross-origin browser access. */
    async servePreview(req, res, projectRoot, generation, route, origin) {
        try {
            const authority = new URL(origin);
            if (authority.protocol !== "http:" || authority.hostname !== "127.0.0.1" || !single(req, "host") || req.headers.host !== authority.host ||
                (req.headers.origin !== undefined && (!single(req, "origin") || req.headers.origin !== origin)) ||
                (req.headers["sec-fetch-site"] !== undefined && !["same-origin", "none"].includes(String(req.headers["sec-fetch-site"]))))
                throw new HttpError(403, "Local same-origin requests only.");
            if (!this.options.isSelected(projectRoot, generation) || /[?#%\\]/.test(route) || !(["status", "control", "live-frame", "live-frame-timed", "live-frame-next", "live-frame-next-timed"].includes(route) || ASSETS.includes(route) || DEVICE_CAPTURE_IMAGES.includes(route) || /^captures\/[a-f0-9-]{36}(?:\/metadata)?$/.test(route)))
                throw new HttpError(404, "Not found.");
            // Opening display state is inert: only explicit control requests may start the helper.
            await this.open(projectRoot, generation);
            const a = this.active;
            this.current(a);
            if (a.projectRoot !== projectRoot || a.generation !== generation)
                throw new HttpError(409, "Capture selection changed.");
            if (a.requests >= 16)
                throw new HttpError(503, "Capture server is busy.");
            a.requests++;
            try {
                await this.serveRoute(req, res, a, route, origin);
            }
            finally {
                a.requests--;
            }
        }
        catch (error) {
            if (res.headersSent)
                res.destroy();
            else
                json(res, error instanceof HttpError ? error.status : error instanceof z.ZodError ? 400 : 500, { error: error instanceof HttpError ? error.message : "The local capture request failed." });
        }
    }
    async serveRoute(req, res, a, route, origin) {
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Referrer-Policy", "no-referrer");
        res.setHeader("Cache-Control", "no-store");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
        if (req.method === "GET" || req.method === "HEAD") {
            if (route === "status") {
                json(res, 200, this.status());
                return;
            }
            let bytes, type;
            if (route === "") {
                bytes = Buffer.from(this.options.reviewFixture ? NATIVE_CAPTURE_PAGE.replace("</main>", '<aside style="position:fixed;z-index:110;bottom:8px;left:12px;right:12px;padding:5px 10px;text-align:center;font:11px system-ui;background:#fffce8;color:#4e4216;border:1px solid #dccf86;border-radius:8px">Synthetic native UI review · no camera, microphone, or physical device</aside></main>') : NATIVE_CAPTURE_PAGE);
                type = "text/html; charset=utf-8";
            }
            else if (a.assets.has(route)) {
                bytes = a.assets.get(route);
                type = DEVICE_CAPTURE_IMAGES.includes(route) ? "image/webp" : "text/javascript; charset=utf-8";
            }
            else if (["live-frame", "live-frame-timed", "live-frame-next", "live-frame-next-timed"].includes(route)) {
                const next = route === "live-frame-next" || route === "live-frame-next-timed";
                let frame;
                if (next) {
                    const after = this.afterIdentity(req), result = await this.waitNextFrame(a, req, res, after);
                    if (result.abandoned || res.destroyed || req.aborted)
                        return;
                    res.setHeader("X-Chromatic-Wait-Duration-Ms", String(result.waitDurationMs));
                    const selected = result.frame ?? this.newerFrame(a, after);
                    if (!selected) {
                        res.statusCode = 204;
                        res.end();
                        return;
                    }
                    frame = selected;
                }
                else {
                    if (!a.enabled || !a.latest || !frameMatchesStatus(a.observation, a.latest.metadata))
                        throw new HttpError(404, "No native frame has arrived.");
                    frame = a.latest;
                }
                if ((route === "live-frame-timed" || route === "live-frame-next-timed") && req.method === "GET") {
                    const clock = await this.frameClock(a, frame);
                    this.validateFrameResponse(a, frame);
                    if (clock.clock !== undefined)
                        res.setHeader("X-Chromatic-Clock-Sample-Ms", String(clock.clock));
                    else if (next && clock.reason)
                        res.setHeader("X-Chromatic-Clock-Unavailable-Reason", clock.reason);
                }
                if (next)
                    this.validateFrameResponse(a, frame);
                bytes = frame.bytes;
                type = "image/jpeg";
                this.frameHeaders(res, frame);
            }
            else if (/^captures\/[a-f0-9-]{36}(?:\/metadata)?$/.test(route)) {
                if (a.reads >= 2)
                    throw new HttpError(429, "Two capture reads are already active.");
                a.reads++;
                try {
                    const [, id, part] = route.split("/");
                    if (!a.captures.has(id))
                        throw new HttpError(404, "Capture not found.");
                    const file = await a.store.open(id, part === "metadata" ? "metadata" : "media");
                    if (!file)
                        throw new HttpError(404, "Capture not found.");
                    try {
                        this.current(a);
                        res.setHeader("Content-Type", file.mimeType);
                        res.setHeader("Content-Length", file.bytes);
                        if (file.record.kind === "video" && part !== "metadata")
                            res.setHeader("Content-Disposition", `attachment; filename="${path.basename(file.record.path)}"`);
                        if (req.method === "HEAD")
                            res.end();
                        else
                            await pipeline(file.handle.createReadStream({ start: 0, end: file.bytes - 1, autoClose: false }), res);
                    }
                    finally {
                        await file.handle.close();
                    }
                    return;
                }
                finally {
                    a.reads--;
                }
            }
            else
                throw new HttpError(404, "Not found.");
            res.setHeader("Content-Type", type);
            res.setHeader("Content-Length", bytes.length);
            res.end(req.method === "HEAD" ? undefined : bytes);
            return;
        }
        if (req.method !== "POST")
            throw new HttpError(405, "Use GET, HEAD or POST.");
        if (req.headers.origin !== origin)
            throw new HttpError(403, "POST requires the exact local Origin.");
        if (!single(req, "content-type") || req.headers["content-type"] !== "application/json" || req.headers["content-encoding"] !== undefined)
            throw new HttpError(415, "Unencoded JSON required.");
        if (route !== "control")
            throw new HttpError(404, "Not found.");
        const value = controlSchema.parse(await readBody(req));
        this.current(a);
        if (value.sessionId !== a.sessionId || value.generation !== a.generation)
            throw new HttpError(409, "Capture session identity changed.");
        if (value.action === "enable" || value.action === "disable") {
            if (value.durationMs !== undefined || value.selection !== undefined || value.inventoryId !== undefined)
                throw new HttpError(400, "Unexpected settings fields.");
            json(res, 200, await this.setEnabled(value.action === "enable", value.audio ?? false));
            return;
        }
        if (value.tab !== undefined && value.action !== "open_settings")
            throw new HttpError(400, "tab applies only to open_settings.");
        if (value.audio !== undefined)
            throw new HttpError(400, "Audio permission applies only to Enable device capture.");
        if (value.action === "connect" ? (!value.inventoryId || !value.selection) : (value.inventoryId !== undefined || value.selection !== undefined))
            throw new HttpError(400, "Current inventory and selection are required only for connect.");
        if (value.action === "close") {
            if (value.durationMs !== undefined)
                throw new HttpError(400, "durationMs applies only to recording.");
            const closing = this.shutdown(a);
            void closing.catch(() => { });
            const ready = await a.closeReady;
            if (!res.destroyed)
                json(res, 200, { success: !ready.failed, ...(ready.failed ? { uncertain: true, error: ready.error } : {}), listenerClosurePending: true, status: this.status() });
            return;
        }
        json(res, 200, await this.control(value.action, value.durationMs, value.inventoryId && value.selection ? { inventoryId: value.inventoryId, selection: value.selection } : undefined, value.tab));
    }
}
//# sourceMappingURL=native-device-capture.js.map