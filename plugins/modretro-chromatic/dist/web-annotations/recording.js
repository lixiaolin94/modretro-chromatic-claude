/// <reference lib="dom" />
import { RecordingController } from "./recording-controller.js";
import { parseRecordingSaved } from "./recording-protocol.js";
import { mountPreviewErrorDialog } from "./error-dialog.js";
import { ICONS } from "./view.js";
const MAX_BYTES = 128 * 1024 * 1024;
const MAX_VISIBILITY_CHANGES = 256;
const stamp = () => ({ utc: new Date().toISOString(), monotonicMs: performance.now() });
/** Records live browser media only. It never drives or pauses the emulator. */
export class CanvasRecording {
    canvas;
    audio;
    callbacks;
    #state = "idle";
    #recorder;
    #release;
    #start;
    #end;
    #detach;
    #limitTimer;
    #releaseConfirmed = true;
    #audio = {};
    constructor(canvas, audio, callbacks) {
        this.canvas = canvas;
        this.audio = audio;
        this.callbacks = callbacks;
    }
    get releaseConfirmed() { return this.#releaseConfirmed; }
    get state() { return this.#state; }
    get audioState() { return { ...this.#audio }; }
    get elapsedMs() { return this.#start ? (this.#end?.monotonicMs ?? performance.now()) - this.#start.monotonicMs : 0; }
    #setState(state) { this.#state = state; this.callbacks.state?.(state); }
    start() {
        if (this.#state !== "idle")
            return;
        let videoStream;
        let audioCapture;
        let recorder;
        const chunks = [];
        const events = [];
        let bytes = 0;
        let failure;
        let startEvent;
        let stopRequested;
        let omittedBytes = 0;
        let stopVisibility = () => { };
        let released = false, releaseAttempted = false;
        this.#releaseConfirmed = false;
        this.#audio = {};
        const safeStamp = () => { try {
            const value = stamp();
            if (!Number.isFinite(value.monotonicMs))
                throw new Error();
            return value;
        }
        catch {
            failure ??= "Recording timing could not be measured.";
            return { utc: new Date(0).toISOString(), monotonicMs: 0 };
        } };
        const release = () => {
            if (releaseAttempted)
                return;
            releaseAttempted = true;
            if (this.#limitTimer) {
                try {
                    clearTimeout(this.#limitTimer);
                }
                catch {
                    failure ??= "Recording timer cleanup was unconfirmed.";
                }
            }
            this.#limitTimer = undefined;
            let confirmed = true;
            for (const track of videoStream?.getTracks() ?? []) {
                try {
                    track.stop();
                }
                catch {
                    confirmed = false;
                }
            }
            try {
                audioCapture?.release();
            }
            catch {
                confirmed = false;
            }
            for (const track of audioCapture?.stream?.getTracks() ?? [])
                if (track.readyState !== "ended") {
                    try {
                        track.stop();
                    }
                    catch {
                        confirmed = false;
                    }
                }
            released = confirmed;
            this.#releaseConfirmed = confirmed;
            this.#release = undefined;
        };
        try {
            if (typeof MediaRecorder === "undefined" || typeof MediaStream === "undefined" || typeof this.canvas.captureStream !== "function") {
                throw new Error("Video recording is unavailable in this browser.");
            }
            videoStream = this.canvas.captureStream(60);
            audioCapture = this.audio();
            const videoTracks = videoStream.getVideoTracks();
            const audioTracks = audioCapture.stream?.getAudioTracks() ?? [];
            if (videoTracks.length !== 1 || (audioCapture.unavailableReason ? audioTracks.length !== 0 : audioTracks.length !== 1) || [...videoTracks, ...audioTracks].some(track => track.readyState === "ended")) {
                throw new Error("Recording needs a live game video track and game audio track.");
            }
            this.#audio = { audioIncluded: audioTracks.length === 1, ...(audioCapture.unavailableReason ? { audioUnavailableReason: audioCapture.unavailableReason } : {}) };
            const stream = new MediaStream([...videoTracks, ...audioTracks]);
            const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/mp4"].find(type => MediaRecorder.isTypeSupported(type));
            recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
            this.#start = safeStamp();
            this.#end = undefined;
            const startRequested = this.#start;
            const ownerDocument = this.canvas.ownerDocument;
            const visibilityState = () => {
                const state = ownerDocument?.visibilityState;
                return state === "visible" || state === "hidden" ? state : "unavailable";
            };
            const visibility = {
                atStart: { ...startRequested, state: visibilityState() },
                changes: [],
                omittedChanges: 0,
            };
            if (typeof ownerDocument?.addEventListener === "function" && typeof ownerDocument?.removeEventListener === "function") {
                let observing = true;
                const changed = () => {
                    if (visibility.changes.length < MAX_VISIBILITY_CHANGES)
                        visibility.changes.push({ ...safeStamp(), state: visibilityState() });
                    else
                        visibility.omittedChanges++;
                };
                ownerDocument.addEventListener("visibilitychange", changed);
                stopVisibility = () => {
                    if (!observing)
                        return;
                    observing = false;
                    ownerDocument.removeEventListener("visibilitychange", changed);
                };
            }
            const width = this.canvas.width, height = this.canvas.height;
            recorder.onstart = () => { startEvent = safeStamp(); };
            recorder.ondataavailable = event => {
                if (this.#state === "disposed")
                    return;
                if (bytes + event.data.size > MAX_BYTES || events.length >= 10_000) {
                    failure ??= "Recording exceeded its local memory limit. Please record a shorter clip.";
                    omittedBytes += event.data.size;
                    this.stop();
                    return;
                }
                bytes += event.data.size;
                if (event.data.size)
                    chunks.push(event.data);
                events.push({ bytes: event.data.size, timecode: Number.isFinite(event.timecode) ? event.timecode : null, eventTimestamp: event.timeStamp, receivedAtMs: safeStamp().monotonicMs });
            };
            recorder.onerror = () => { stopVisibility(); failure ??= "The browser could not finish this recording."; this.stop(); };
            recorder.onstop = () => {
                const stopped = safeStamp();
                this.#end = stopped;
                const diagnostics = {
                    mimeType: recorder.mimeType, startEventObserved: !!startEvent, dataEvents: events.length,
                    zeroByteEvents: events.filter(event => event.bytes === 0).length, bytes, omittedBytes,
                    startRequestedAt: startRequested.utc, stoppedAt: stopped.utc, elapsedMs: Math.max(0, stopped.monotonicMs - startRequested.monotonicMs),
                    visibilityAtStart: visibility.atStart.state, visibilityAtStop: visibilityState(),
                    videoTrackAtStop: videoTracks[0].readyState, audioTrackAtStop: audioTracks[0]?.readyState ?? "not-included",
                };
                release();
                this.#detach?.();
                this.#recorder = undefined;
                this.#requestStop = undefined;
                this.#detach = undefined;
                if (this.#state === "disposed")
                    return;
                this.#setState("idle");
                if (failure)
                    this.callbacks.error?.(failure, diagnostics);
                if (!chunks.length) {
                    if (!failure)
                        this.callbacks.error?.("The recording was empty. No video file was saved; the encoding failure cause is unknown.", diagnostics);
                    return;
                }
                const video = new Blob(chunks, { type: recorder.mimeType });
                this.callbacks.complete?.({ video, metadata: {
                        schemaVersion: 1, source: audioTracks.length ? "live-game-canvas-and-game-audio" : "live-game-canvas", mimeType: video.type, ...this.#audio,
                        status: failure ? "partial" : "complete", error: failure ?? null, omittedBytes, releaseConfirmed: released,
                        bytes: video.size, width, height, maxVideoFramesPerSecond: 60,
                        startRequested, startEvent: startEvent ?? null, stopRequested: stopRequested ?? null, stopEvent: stopped,
                        elapsedMs: stopped.monotonicMs - startRequested.monotonicMs,
                        timing: "Original encoded media timestamps; event times use performance.now(). Not emulator frames.",
                        chunks: events, visibility,
                    } });
            };
            // Retain the actual stop-request event separately from encoded media time.
            const requestStop = () => {
                stopRequested ??= safeStamp();
                if (recorder.state !== "inactive")
                    recorder.stop();
            };
            this.#requestStop = requestStop;
            this.#detach = () => {
                stopVisibility();
                recorder.onstop = recorder.ondataavailable = recorder.onerror = recorder.onstart = null;
            };
            this.#release = release;
            this.#recorder = recorder;
            recorder.start(1000);
            this.#setState("recording");
            this.#limitTimer = setTimeout(() => {
                if (this.#recorder !== recorder)
                    return;
                // Classify the existing deadline before the hard stop can emit its final media event.
                try {
                    this.callbacks.beforeLimitStop?.();
                }
                catch {
                    failure ??= "Recording timing could not be confirmed.";
                }
                finally {
                    this.stop();
                }
            }, 600_000);
        }
        catch (error) {
            stopVisibility();
            if (recorder) {
                recorder.onstop = recorder.ondataavailable = recorder.onerror = recorder.onstart = null;
                try {
                    if (recorder.state !== "inactive")
                        recorder.stop();
                }
                catch { /* Release all acquired tracks below. */ }
            }
            release();
            this.#recorder = undefined;
            this.#requestStop = undefined;
            this.#detach = undefined;
            this.#setState("idle");
            this.callbacks.error?.(error instanceof Error ? error.message : "Recording could not start.");
        }
    }
    #requestStop;
    stop() {
        if (this.#state !== "recording")
            return;
        this.#setState("stopping");
        try {
            this.#requestStop?.();
        }
        catch (error) {
            this.#release?.();
            this.callbacks.error?.(error instanceof Error ? error.message : "Recording stop could not be confirmed.");
        }
    }
    dispose() {
        if (this.#state === "disposed")
            return;
        const active = this.#recorder;
        this.#setState("disposed");
        try {
            if (active && active.state !== "inactive")
                this.#requestStop?.();
        }
        finally {
            try {
                this.#release?.();
            }
            finally {
                this.#detach?.();
            }
        }
        this.#recorder = undefined;
        this.#requestStop = undefined;
        this.#detach = undefined;
    }
}
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024;
/** Captures the game only; an optional callback saves to the existing local preview server. */
export function mountRecordingControl(canvas, audio, host, identity, saveCapture, lastCapture, onErrorOpen, isVisible = () => true, noticeHost) {
    const doc = host.ownerDocument;
    host.dataset.previewRecording = "";
    const element = (tag, className) => {
        const node = doc.createElement(tag);
        node.className = className;
        return node;
    };
    const action = (label, className = "") => {
        const control = element("button", ("cgv-action " + className).trim());
        control.type = "button";
        control.textContent = label;
        return control;
    };
    const icon = (path, filled = false) => {
        const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        const shape = doc.createElementNS("http://www.w3.org/2000/svg", "path");
        shape.setAttribute("d", path);
        if (filled)
            shape.setAttribute("fill", "currentColor");
        svg.append(shape);
        return svg;
    };
    const actions = element("div", "cgv-capture-actions");
    actions.setAttribute("role", "group");
    actions.setAttribute("aria-label", "Game captures");
    const screenshot = action("", "cgv-capture-button cgv-screenshot-button");
    screenshot.dataset.action = "screenshot";
    screenshot.setAttribute("aria-label", "Screenshot");
    screenshot.dataset.tooltip = "Screenshot";
    screenshot.append(icon("M3 7h4l2-3h6l2 3h4v13H3ZM16 13a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z"));
    const button = action("", "cgv-capture-button cgv-record-button");
    button.dataset.action = "record-video";
    button.setAttribute("aria-description", "Keep the preview visible while recording.");
    const recordIcon = element("span", "cgv-record-idle");
    recordIcon.append(icon(ICONS.record));
    const badge = element("span", "cgv-record-indicator");
    badge.setAttribute("aria-hidden", "true");
    const stopIcon = element("span", "cgv-record-stop");
    stopIcon.append(icon("M6 6h12v12H6Z", true));
    const elapsed = element("time", "cgv-record-time");
    elapsed.textContent = "0:00";
    badge.append(stopIcon, elapsed);
    badge.hidden = true;
    button.append(recordIcon, badge);
    actions.append(screenshot, button);
    const toast = element("div", "cgv-capture-toast");
    toast.setAttribute("role", "region");
    toast.setAttribute("aria-label", "Capture result");
    toast.tabIndex = -1;
    toast.hidden = true;
    const toastHeading = element("div", "cgv-toast-heading");
    const status = element("span", "cgv-capture-status");
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    const dismiss = action("", "cgv-toast-dismiss");
    dismiss.setAttribute("aria-label", "Dismiss");
    dismiss.dataset.tooltip = "Dismiss capture notification";
    dismiss.append(icon("M6 6l12 12M18 6 6 18"));
    toastHeading.append(status, dismiss);
    const detail = element("p", "cgv-toast-detail");
    const links = element("div", "cgv-toast-actions");
    const copyInput = element("input", "cgv-copy-path");
    copyInput.readOnly = true;
    copyInput.setAttribute("aria-label", "Saved capture path");
    copyInput.hidden = true;
    toast.append(toastHeading, detail, links, copyInput);
    host.append(actions);
    (noticeHost ?? host).append(toast);
    const errorDialog = mountPreviewErrorDialog(host, identity, onErrorOpen);
    let viewId = "";
    let captureOrigin;
    let disposed = false;
    let takingScreenshot = false;
    let pending;
    let latest;
    let toastMode = "message";
    let hovered = false;
    let dismissTimer;
    const clearDismissTimer = () => {
        if (dismissTimer !== undefined)
            clearTimeout(dismissTimer);
        dismissTimer = undefined;
    };
    const hideToast = (restoreFocus = false) => {
        if (pending)
            return;
        clearDismissTimer();
        const hadFocus = toast.contains(doc.activeElement);
        toast.hidden = true;
        hovered = false;
        if (restoreFocus && hadFocus && !button.disabled)
            button.focus({ preventScroll: true });
    };
    const scheduleDismiss = () => {
        clearDismissTimer();
        if (disposed || toast.hidden || toastMode !== "saved" || pending || hovered || toast.contains(doc.activeElement))
            return;
        dismissTimer = setTimeout(() => {
            dismissTimer = undefined;
            if (!disposed && toastMode === "saved" && !pending && !hovered && !toast.contains(doc.activeElement))
                hideToast();
        }, 8000);
    };
    const showToast = (mode, message, description, canDismiss) => {
        clearDismissTimer();
        toastMode = mode;
        toast.dataset.state = mode;
        status.textContent = message;
        detail.textContent = description;
        detail.title = "";
        detail.hidden = !description;
        dismiss.hidden = !canDismiss;
        copyInput.hidden = true;
        copyInput.value = "";
        links.replaceChildren();
        toast.hidden = false;
    };
    const refreshElapsed = () => {
        const seconds = Math.max(0, Math.floor(recording.elapsedMs / 1000));
        elapsed.textContent = Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
        elapsed.dateTime = "PT" + seconds + "S";
        const description = "Elapsed time " + elapsed.textContent + (recording.audioState.audioIncluded === false ? ". Video only; game audio is unavailable." : "") + ". Keep the preview visible while recording.";
        if (button.getAttribute("aria-description") !== description)
            button.setAttribute("aria-description", description);
    };
    const refreshControls = (state = recording.state) => {
        const active = state === "recording";
        const label = active ? "Stop recording" : state === "stopping" ? "Finishing recording" : "Record video";
        button.setAttribute("aria-label", label);
        button.dataset.tooltip = label + ". Keep the preview visible while recording.";
        button.dataset.recording = String(active || state === "stopping");
        button.disabled = disposed || (controller.blocked && !active) || state === "disposed" || state === "stopping" || (!active && (takingScreenshot || !!pending));
        button.setAttribute("aria-pressed", String(active));
        screenshot.disabled = disposed || controller.blocked || state !== "idle" || takingScreenshot || !!pending;
        screenshot.setAttribute("aria-label", takingScreenshot ? "Capturing screenshot" : "Screenshot");
        screenshot.dataset.tooltip = takingScreenshot ? "Capturing screenshot" : "Screenshot";
        badge.hidden = !active && state !== "stopping";
        recordIcon.hidden = !badge.hidden;
        if (badge.hidden)
            button.setAttribute("aria-description", "Keep the preview visible while recording.");
        if (lastCapture)
            lastCapture.disabled = disposed || !latest || !!pending || takingScreenshot;
        if (!badge.hidden)
            refreshElapsed();
    };
    const releaseLocalUrls = (capture) => {
        if (capture.mediaUrl)
            URL.revokeObjectURL(capture.mediaUrl);
        if (capture.metadataUrl)
            URL.revokeObjectURL(capture.metadataUrl);
        capture.mediaUrl = capture.metadataUrl = undefined;
    };
    const link = (label, url, filename) => {
        const anchor = element("a", "cgv-capture-link");
        anchor.href = url;
        anchor.textContent = label;
        if (filename)
            anchor.download = filename;
        // The containing Codex built-in browser manages this link; never invoke an OS opener.
        else {
            anchor.target = "_blank";
            anchor.rel = "noopener";
        }
        return anchor;
    };
    const basename = (path) => path.split(/[\\/]/).pop() || "capture";
    const showSaved = () => {
        if (!latest || pending || disposed)
            return;
        const entry = latest;
        showToast("saved", "Saved", entry.partial ? "Partial video saved. Playback may be incomplete."
            : entry.file.kind === "screenshot" ? "Screenshot saved locally." : "Video saved locally.", true);
        let downloadUrl = entry.file.url;
        if (entry.file.kind === "video") {
            const url = new URL(downloadUrl, doc.baseURI);
            url.searchParams.set("download", "1");
            downloadUrl = url.href;
        }
        else
            links.append(link("Open", entry.file.url));
        links.append(link("Download", downloadUrl, basename(entry.file.path)), link(entry.file.kind === "video" ? "Timing" : "Details", entry.file.metadataUrl, basename(entry.file.metadataPath)));
        const copyPath = action("Copy path", "cgv-toast-action");
        copyPath.addEventListener("click", () => {
            const stillCurrent = () => !disposed && latest === entry && !pending && toastMode === "saved";
            const revealPath = () => {
                if (!stillCurrent())
                    return;
                copyInput.value = entry.file.path;
                copyInput.hidden = false;
                copyInput.focus({ preventScroll: true });
                copyInput.select();
                detail.textContent = "Copy the selected path.";
            };
            try {
                const clipboard = doc.defaultView?.navigator.clipboard;
                if (!clipboard) {
                    revealPath();
                    return;
                }
                void clipboard.writeText(entry.file.path).then(() => {
                    if (stillCurrent())
                        detail.textContent = "Path copied.";
                }, revealPath);
            }
            catch {
                revealPath();
            }
        });
        links.append(copyPath);
        scheduleDismiss();
    };
    const renderPending = () => {
        if (!pending || disposed)
            return;
        const capture = pending;
        try {
            capture.mediaUrl ??= URL.createObjectURL(capture.media);
        }
        catch { /* Keep the original Blob. */ }
        try {
            capture.metadataUrl ??= URL.createObjectURL(new Blob([JSON.stringify(capture.metadata, null, 2) + "\n"], { type: "application/json" }));
        }
        catch { /* A metadata download failure must not discard the media. */ }
        const partial = capture.metadata.status === "partial";
        showToast("pending", capture.saving ? "Saving…" : "Save not confirmed", (partial ? "Partial recording. " : "") + (capture.saving ? "Saving to this project on your device."
            : "Download this copy before leaving."), false);
        if (capture.mediaUrl) {
            if (capture.kind === "screenshot")
                links.append(link("Open", capture.mediaUrl));
            links.append(link("Download", capture.mediaUrl, capture.filename));
        }
        if (capture.metadataUrl)
            links.append(link(capture.kind === "video" ? "Timing" : "Details", capture.metadataUrl, capture.metadataFilename));
        if (!capture.mediaUrl || !capture.metadataUrl) {
            const prepare = action("Prepare downloads", "cgv-toast-action");
            prepare.addEventListener("click", () => { if (!disposed && pending === capture)
                renderPending(); });
            links.append(prepare);
        }
        const discard = action("Discard unsaved", "cgv-toast-action");
        discard.disabled = capture.saving || !!capture.managed;
        discard.addEventListener("click", () => {
            if (disposed || pending !== capture || capture.saving || capture.managed)
                return;
            releaseLocalUrls(capture);
            pending = undefined;
            refreshControls();
            hideToast(true);
        });
        links.append(discard);
    };
    const localAssetUrl = (value) => {
        if (typeof value !== "string" || !value || /^[a-z][a-z\d+.-]*:/i.test(value) || value.startsWith("//"))
            throw new Error("The saved file URL is not local to this preview.");
        const base = new URL(doc.baseURI);
        const url = new URL(value, base);
        if (url.origin !== base.origin || url.username || url.password)
            throw new Error("The saved file URL is not local to this preview.");
        return url.href;
    };
    const acceptCapture = async (capture) => {
        if (disposed)
            return;
        const stem = (capture.kind === "screenshot" ? "screenshot" : "gameplay") + "-" + new Date().toISOString().replace(/[:.]/g, "-");
        const extension = capture.kind === "screenshot" ? "png" : capture.media.type.startsWith("video/mp4") ? "mp4" : "webm";
        const result = { ...capture, origin: capture.origin ?? { viewId, generation: controller.captureGeneration() }, metadata: { ...capture.metadata, game: { ...identity } },
            filename: stem + "." + extension, metadataFilename: stem + "-" + (capture.kind === "video" ? "timing" : "details") + ".json", saving: !!saveCapture };
        pending = result;
        renderPending();
        refreshControls();
        if (!saveCapture)
            return;
        try {
            // One save attempt only. An uncertain reply keeps the original browser copy.
            const file = await saveCapture({ kind: result.kind, media: result.media, metadata: result.metadata, origin: result.origin, ...(result.managed ? { managed: result.managed } : {}) });
            if (disposed || pending !== result)
                return;
            if (file.kind !== result.kind || file.bytes !== result.media.size || typeof file.path !== "string" || !file.path
                || typeof file.metadataPath !== "string" || !file.metadataPath)
                throw new Error("The local save response did not confirm this capture.");
            if (result.managed)
                controller.saved(parseRecordingSaved(file));
            latest = { file: { ...file, url: localAssetUrl(file.url), metadataUrl: localAssetUrl(file.metadataUrl) },
                partial: result.metadata.status === "partial" };
            pending = undefined;
            try {
                showSaved();
            }
            finally {
                releaseLocalUrls(result);
            }
        }
        catch (error) {
            if (disposed || pending !== result)
                return;
            result.saving = false;
            renderPending();
            errorDialog.show("capture-save", error instanceof Error ? error.message : "The local save did not finish.");
        }
        finally {
            if (!disposed)
                refreshControls();
        }
    };
    const recording = new CanvasRecording(canvas, audio, {
        beforeLimitStop: () => controller.tick(),
        state(state) { refreshControls(state); },
        error(message, diagnostics) {
            if (recording.state === "idle")
                controller.failed(message, recording.releaseConfirmed, diagnostics);
            if (!disposed)
                errorDialog.show(diagnostics?.bytes === 0 ? "recording-empty" : "recording", diagnostics ? `${message}\n${JSON.stringify(diagnostics, null, 2)}` : message, diagnostics);
        },
        complete({ video, metadata }) {
            const owner = controller.ownership();
            if (owner)
                controller.captured(metadata.releaseConfirmed === true);
            void acceptCapture({ kind: "video", media: video, origin: captureOrigin, metadata: controller.metadata(metadata), ...(owner ? { managed: { ...owner, viewId } } : {}) });
        },
    });
    const controller = new RecordingController({
        busy: () => recording.state !== "idle" || takingScreenshot || !!pending,
        visible: () => doc.visibilityState === "visible" && isVisible(),
        available: () => !disposed && isVisible() && !!saveCapture && typeof MediaRecorder !== "undefined" && typeof canvas.captureStream === "function",
        start: () => { captureOrigin = { viewId, generation: controller.captureGeneration() }; hideToast(); recording.start(); return recording.state === "recording"; },
        stop: () => recording.stop(),
        acceptSaved: (file) => {
            const capture = pending;
            if (!capture || !capture.managed || file.bytes !== capture.media.size || file.mimeType !== capture.media.type)
                return false;
            if (file.url !== `./codex-captures/${file.id}/media` || file.metadataUrl !== `./codex-captures/${file.id}/metadata`)
                return false;
            latest = { file: { ...file, url: localAssetUrl(file.url), metadataUrl: localAssetUrl(file.metadataUrl) }, partial: capture.metadata.status === "partial" };
            pending = undefined;
            try {
                showSaved();
            }
            finally {
                releaseLocalUrls(capture);
            }
            return true;
        },
        changed: () => refreshControls(),
        error: message => { if (!disposed)
            errorDialog.show("recording", message); },
    });
    const recordClick = () => {
        if (!isVisible())
            return;
        if (recording.state === "recording") {
            controller.stop("Stopped by the user.");
            recording.stop();
        }
        else if (!disposed && !takingScreenshot && !pending && recording.state === "idle" && controller.humanStart()) {
            captureOrigin = { viewId, generation: controller.captureGeneration() };
            hideToast();
            recording.start();
        }
    };
    const screenshotClick = async () => {
        if (!isVisible() || disposed || takingScreenshot || pending || recording.state !== "idle" || !controller.humanStart())
            return;
        hideToast();
        takingScreenshot = true;
        refreshControls();
        try {
            const width = canvas.width, height = canvas.height;
            if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 4_194_304) {
                throw new Error("Screenshot dimensions exceed the supported limit.");
            }
            if (typeof canvas.toBlob !== "function")
                throw new Error("Screenshots are unavailable in this browser.");
            const captureRequested = stamp();
            const media = await new Promise((resolve, reject) => canvas.toBlob(blob => {
                if (blob)
                    resolve(blob);
                else
                    reject(new Error("The game screenshot could not be captured."));
            }, "image/png"));
            if (disposed)
                return;
            if (!media.size || media.size > MAX_SCREENSHOT_BYTES || media.type !== "image/png")
                throw new Error("The screenshot must be a PNG no larger than 8 MiB.");
            await acceptCapture({ kind: "screenshot", media, metadata: {
                    schemaVersion: 1, source: "live-game-canvas", status: "complete", mimeType: media.type,
                    bytes: media.size, width, height, captureRequested, encodedAt: stamp(),
                } });
        }
        catch (error) {
            if (!disposed)
                errorDialog.show("screenshot", error instanceof Error ? error.message : "The screenshot could not be captured.");
        }
        finally {
            takingScreenshot = false;
            if (!disposed)
                refreshControls();
        }
    };
    const openLast = () => {
        if (disposed || pending || !latest)
            return;
        showSaved();
        links.querySelector("a")?.focus({ preventScroll: true });
    };
    const dismissClick = () => hideToast(true);
    const entered = () => { hovered = true; clearDismissTimer(); };
    const left = () => { hovered = false; scheduleDismiss(); };
    const focused = () => clearDismissTimer();
    const blurred = () => queueMicrotask(() => { if (!disposed)
        scheduleDismiss(); });
    button.addEventListener("click", recordClick);
    screenshot.addEventListener("click", screenshotClick);
    dismiss.addEventListener("click", dismissClick);
    lastCapture?.addEventListener("click", openLast);
    toast.addEventListener("pointerenter", entered);
    toast.addEventListener("pointerleave", left);
    toast.addEventListener("focusin", focused);
    toast.addEventListener("focusout", blurred);
    const timer = setInterval(() => { if (recording.state === "recording" || recording.state === "stopping")
        refreshElapsed(); }, 250);
    const beforeUnload = (event) => {
        if (recording.state === "recording" || recording.state === "stopping" || takingScreenshot || pending) {
            event.preventDefault();
            event.returnValue = "";
        }
    };
    doc.defaultView?.addEventListener("beforeunload", beforeUnload);
    refreshControls();
    return { recordingState: () => {
            const state = controller.state(), owner = controller.ownership();
            return { ...state, ...(owner && state.owner === "mcp" && captureOrigin?.generation === owner.generation ? recording.audioState : {}) };
        }, recordingReply: reply => controller.apply(reply), bindView: id => { viewId = id; }, beginRetirement: () => controller.beginRetirement(), dispose() {
            if (disposed)
                return;
            disposed = true;
            clearInterval(timer);
            clearDismissTimer();
            controller.dispose();
            recording.dispose();
            errorDialog.dispose();
            if (pending)
                releaseLocalUrls(pending);
            pending = undefined;
            latest = undefined;
            button.removeEventListener("click", recordClick);
            screenshot.removeEventListener("click", screenshotClick);
            dismiss.removeEventListener("click", dismissClick);
            lastCapture?.removeEventListener("click", openLast);
            if (lastCapture)
                lastCapture.disabled = true;
            toast.removeEventListener("pointerenter", entered);
            toast.removeEventListener("pointerleave", left);
            toast.removeEventListener("focusin", focused);
            toast.removeEventListener("focusout", blurred);
            toast.remove();
            doc.defaultView?.removeEventListener("beforeunload", beforeUnload);
            host.replaceChildren();
        } };
}
//# sourceMappingURL=recording.js.map