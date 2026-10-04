/// <reference lib="dom" />
import { DEVICE_COLORS, DEVICE_COLOR_KEY, mountControlTooltips } from "../web-annotations/view.js";
import { requestDiagnosticAnnotation } from "../web-annotations/native.js";
import { mountPreviewErrorDialog } from "../web-annotations/error-dialog.js";
import { NATIVE_CAPTURE_VIEW } from "./native-page.js";
import { mountDevicePicker } from "./device-picker.js";
import { createTimingDiagnostics } from "./native-timing-diagnostics.js";
/** Diagnostic only: bounded browser-clock observations, never image content. */
class BrowserStageTrace {
    key;
    identity;
    buckets = Array(60);
    highWater = {};
    beatAt;
    activity;
    lastPublished = -Infinity;
    lastValidAtMs;
    clockAnomalyCount = 0;
    lastClockAnomaly = null;
    lastEventAtMs = null;
    lastEvent = null;
    lastAtMs = {};
    inFlight = null;
    endedAtMs;
    endReason;
    startedAtMs;
    constructor(key, identity, startedAtMs, activity) {
        this.key = key;
        this.identity = identity;
        const valid = Number.isFinite(startedAtMs) && startedAtMs >= 0 && Number.isSafeInteger(Math.floor(startedAtMs));
        this.startedAtMs = valid ? startedAtMs : 0;
        this.beatAt = this.startedAtMs;
        this.lastValidAtMs = this.startedAtMs;
        this.activity = activity;
        if (!valid)
            this.anomaly(!Number.isFinite(startedAtMs) ? "nonfinite" : startedAtMs < 0 ? "negative" : "unsafe-index");
    }
    anomaly(reason) { this.clockAnomalyCount = Math.min(1000000, this.clockAnomalyCount + 1); this.lastClockAnomaly = reason; }
    validTime(now) { if (!Number.isFinite(now)) {
        this.anomaly("nonfinite");
        return false;
    } if (now < 0) {
        this.anomaly("negative");
        return false;
    } if (now < this.lastValidAtMs) {
        this.anomaly("backward");
        return false;
    } if (!Number.isSafeInteger(Math.floor(now)) || !Number.isSafeInteger(Math.floor((now - this.startedAtMs) / 1000))) {
        this.anomaly("unsafe-index");
        return false;
    } this.lastValidAtMs = now; return true; }
    get lastValidTime() { return this.lastValidAtMs; }
    get isEnded() { return this.endedAtMs !== undefined; }
    index(now) { return Math.max(0, Math.floor((now - this.startedAtMs) / 1000)); }
    bucket(index) { const slot = index % 60; let value = this.buckets[slot]; if (!value || value.index !== index) {
        value = { index, activeObservedMs: 0, pausedObservedMs: 0, hiddenObservedMs: 0, controlObservedMs: 0, unavailableObservedMs: 0, events: {}, stages: {} };
        this.buckets[slot] = value;
    } return value; }
    // A delayed event loop is unknown coverage, not proof of a quiet interval.
    heartbeat(now, activity) {
        if (this.endedAtMs !== undefined || !this.validTime(now))
            return;
        if (now - this.beatAt <= 500) {
            let at = this.beatAt;
            while (at < now) {
                const index = this.index(at), end = Math.min(now, this.startedAtMs + (index + 1) * 1000);
                if (!(end > at)) {
                    this.anomaly("unsafe-index");
                    break;
                }
                const bucket = this.bucket(index), delta = end - at;
                if (this.activity === "active")
                    bucket.activeObservedMs += delta;
                else {
                    bucket.pausedObservedMs += delta;
                    if (this.activity === "hidden")
                        bucket.hiddenObservedMs += delta;
                    else if (this.activity === "control")
                        bucket.controlObservedMs += delta;
                    else
                        bucket.unavailableObservedMs += delta;
                }
                at = end;
            }
        }
        this.beatAt = now;
        this.activity = activity;
    }
    event(name, now) { if (this.endedAtMs !== undefined || !this.validTime(now))
        return; const b = this.bucket(this.index(now)); b.events[name] = Math.min(1000000, (b.events[name] ?? 0) + 1); this.lastEvent = name; this.lastEventAtMs = now; this.lastAtMs[name] = now; }
    stage(name, identity, now, duration) {
        if (this.endedAtMs !== undefined || !this.validTime(now))
            return false;
        const sequence = identity.previewSequence ?? identity.frameId, previous = this.highWater[name];
        if (previous !== undefined && sequence <= previous)
            return false;
        this.highWater[name] = sequence;
        const b = this.bucket(this.index(now)), frame = { frameId: identity.frameId, ...(identity.previewSequence === undefined ? {} : { previewSequence: identity.previewSequence }) };
        const validDuration = duration !== undefined && Number.isFinite(duration) && duration >= 0 ? duration : null;
        const existing = b.stages[name];
        if (existing) {
            existing.count = Math.min(1000000, existing.count + 1);
            existing.last = frame;
            existing.lastAtMs = now;
            if (validDuration !== null)
                existing.maxDurationMs = Math.max(existing.maxDurationMs ?? 0, validDuration);
        }
        else
            b.stages[name] = { count: 1, first: frame, last: frame, lastAtMs: now, maxDurationMs: validDuration };
        this.lastEvent = name;
        this.lastEventAtMs = now;
        this.lastAtMs[name] = now;
        return true;
    }
    anchor(identity, service, browser, nativeTiming) { if (this.endedAtMs !== undefined || !this.validTime(browser))
        return; const b = this.bucket(this.index(browser)), correlatable = this.identity.connectionId !== null || this.identity.sourceGeneration !== null, anchor = { frameId: identity.frameId, ...(identity.previewSequence === undefined ? {} : { previewSequence: identity.previewSequence }), serviceCachePublishedAtMs: correlatable && service !== null && Number.isFinite(service) && service >= 0 ? service : null, browserSubmittedAtMs: browser, nativeTiming }; if (b.anchors)
        b.anchors.last = anchor;
    else
        b.anchors = { first: anchor, last: anchor }; }
    phase(value, now) { if (this.endedAtMs !== undefined || !this.validTime(now))
        return; this.inFlight = value ? { phase: value, startedAtMs: now } : null; }
    end(reason, now) { if (this.endedAtMs !== undefined)
        return; this.endedAtMs = this.validTime(now) ? now : this.lastValidAtMs; this.endReason = reason; }
    snapshot(now, force = false, previousPublication = -Infinity) {
        if (!this.validTime(now))
            now = this.lastValidAtMs;
        if (!force && now - Math.max(this.lastPublished, previousPublication) < 1000)
            return;
        this.lastPublished = now;
        const through = this.endedAtMs ?? now, index = this.index(through), first = Math.max(0, index - 59), rows = [];
        for (let i = first; i <= index; i++) {
            const found = this.buckets[i % 60], bucket = found?.index === i ? found : undefined, durationMs = Math.max(0, Math.min(1000, through - (this.startedAtMs + i * 1000))), activeObservedMs = Math.min(durationMs, bucket?.activeObservedMs ?? 0), pausedObservedMs = Math.min(durationMs - activeObservedMs, bucket?.pausedObservedMs ?? 0);
            rows.push({ index: i, startOffsetMs: i * 1000, durationMs, partial: durationMs < 1000, coverage: { activeObservedMs, pausedObservedMs, hiddenObservedMs: bucket?.hiddenObservedMs ?? 0, controlObservedMs: bucket?.controlObservedMs ?? 0, unavailableObservedMs: bucket?.unavailableObservedMs ?? 0, unknownMs: Math.max(0, durationMs - activeObservedMs - pausedObservedMs) }, events: bucket ? { ...bucket.events } : null, stages: bucket ? { ...bucket.stages } : null, ...(bucket?.anchors ? { anchors: { first: { ...bucket.anchors.first }, last: { ...bucket.anchors.last } } } : {}) });
        }
        const connectionContinuity = this.identity.connectionId !== null ? (this.identity.sourceGeneration !== null ? "connection-id-and-source-generation" : "connection-id") : (this.identity.sourceGeneration !== null ? "source-generation" : "unverified");
        const result = { version: 1, scope: "observed browser events; unknown coverage and paused intervals are not source inactivity; RAF is an opportunity, not scanout", clock: "browser-performance-now", coverageMethod: "inferred between render heartbeats at most 500ms apart; longer gaps are unknown, not proof of inactivity", eventCounting: "classifications may overlap and are not exclusive request outcomes", retentionScope: "up to 60 one-second buckets including the current partial bucket", clockAnomalyCount: this.clockAnomalyCount, lastClockAnomaly: this.lastClockAnomaly, anchorClock: "service-performance-now; native system-uptime; same response only, clocks not aligned; legacy continuity may be unverified", connectionContinuity, durationAttribution: "maxima belong to the bucket where the stage completed, including operations started earlier", durationScope: { delivered: "fetch start to body; includes service wait", decoded: "decode start to accepted decode", submitted: "accepted decode to DOM submission", rafOpportunities: "submission to RAF callback" }, ...this.identity, startedAtMs: this.startedAtMs, observedThroughMs: through, endedAtMs: this.endedAtMs ?? null, endReason: this.endReason ?? null, activity: this.activity, inFlight: this.inFlight, lastEvent: this.lastEvent, lastEventAtMs: this.lastEventAtMs, lastAtMs: { ...this.lastAtMs }, windowSeconds: 60, evictedBuckets: first, serializationOmittedBuckets: 0, buckets: rows };
        let json = JSON.stringify(result);
        while (json.length > 65536 && result.buckets.length > 1) {
            result.buckets.shift();
            result.serializationOmittedBuckets++;
            json = JSON.stringify(result);
        }
        return json;
    }
}
/** Mount the same explicit-consent device controls standalone or inside the current game preview. */
export function mountNativeCapture(root, options = {}) {
    const scope = options.embedded ? root.shadowRoot ?? root.attachShadow({ mode: "open" }) : root;
    if (options.embedded)
        scope.innerHTML = NATIVE_CAPTURE_VIEW;
    // Move the actual controls, retaining one set of handlers and state. A separate
    // shadow host keeps their existing styles without leaking them into the player.
    const toolbar = options.embedded && options.toolbarHost ? scope.querySelector(".toolbar") : undefined;
    const toolbarScope = toolbar ? options.toolbarHost.shadowRoot ?? options.toolbarHost.attachShadow({ mode: "open" }) : undefined;
    if (toolbarScope && toolbar) {
        const layout = document.createElement("style");
        layout.textContent = ":host{display:block}.toolbar{position:relative;bottom:auto;width:auto;height:44px;margin:0;white-space:nowrap}.feed-title{display:none}";
        toolbarScope.replaceChildren(...Array.from(scope.querySelectorAll("style"), style => style.cloneNode(true)), layout, toolbar);
    }
    // The shared host overlays notices above Install without changing its position.
    const footer = options.embedded && options.footerHost ? scope.querySelector(".capture-notices") : undefined;
    const footerScope = footer ? options.footerHost.shadowRoot ?? options.footerHost.attachShadow({ mode: "open" }) : undefined;
    if (footerScope && footer) {
        footer.append(scope.querySelector("#saved"));
        footerScope.replaceChildren(...Array.from(scope.querySelectorAll("style"), style => style.cloneNode(true)), footer);
    }
    const element = (id) => (scope.querySelector(`#${id}`) ?? toolbar?.querySelector(`#${id}`) ?? footer?.querySelector(`#${id}`));
    const base = options.base ?? new URL("../", import.meta.url), app = element("capture-app"), frame = element("video");
    const camera = element("camera"), enable = element("capture-enable");
    const picker = mountDevicePicker(scope, id => { camera.value = id; camera.dispatchEvent(new Event("change")); });
    const errorDialog = mountPreviewErrorDialog(element("capture-app")), settings = element("settings-dialog");
    // Counters are unique validated HTTP frames, successful decodes, DOM submissions,
    // and latest-submission RAF opportunities, not source frames or display scanout.
    if (options.embedded)
        element("device-shell").src = new URL("assets/devices/chromatic-codex.webp", base).href;
    let state = { active: false }, pending = 0, statusPolling = false, settingsRequest = 0, inventoryId = "", lastCapture = "", lastFrame, frameUrl, lastError = "", toastTimer;
    let frameGeneration = 0, framePolling = false, frameFallback = false, frameTimer, frameController, pageActive = true, statusRetryAt = 0;
    let statusController, statusRefreshPending = false, statusRecoveryActive = false;
    let measurement, frameRaf, rafFrame;
    let stageTrace, stageTracePublishedAt = -Infinity;
    const timingDiagnostic = window.location?.hash === "#chromatic-timing-v2";
    let diagnosticRequests = 0;
    let pendingEnable = false, listingDevices = false, discoveryFailed = false, revoking = false, visible = true, disposed = false, displayedError = "", connectionMessage = "";
    let frameError = "", videoOptionsKey = "";
    const identityErrorMessage = "The device video could not be verified. Reconnect your Chromatic.";
    let displayDevices;
    let activeStateKey = "", dismissedStateKey = "", activeRecoveryPath = "", dismissedRecoveryPath = "";
    if (footer) {
        for (const id of ["state", "view-feedback", "recovery", "screenshot-recovery"]) {
            const notice = element(id);
            notice.setAttribute("role", "button");
            notice.setAttribute("aria-live", "polite");
            notice.title = "Dismiss message";
            notice.tabIndex = 0;
            const dismiss = () => { if (id === "state")
                dismissedStateKey = activeStateKey;
            else if (id === "recovery")
                dismissedRecoveryPath = activeRecoveryPath; notice.textContent = ""; if (id === "recovery" || id === "screenshot-recovery")
                notice.hidden = true; };
            notice.addEventListener("click", dismiss);
            notice.addEventListener("keydown", event => { if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                dismiss();
            } });
        }
    }
    let uncertainRequest;
    const blocked = () => !!uncertainRequest || !!pending || !!state.busy || !!state.revoked || !!state.closing || state.nativeFailure?.devicesReleased === false || !!state.recording && (state.recording.uncertain === true || ["starting", "recording", "finishing"].includes(state.recording.state));
    const knownOperation = () => !!pending || !!uncertainRequest || ["connected", "connecting"].includes(state.observation?.connection ?? "") || !!state.recording || !!state.nativeFailure;
    function requestResolved(next) {
        const request = uncertainRequest;
        if (!request || next.sessionId !== request.before.sessionId || next.generation !== request.before.generation || next.busy)
            return false;
        const { action, before, fields } = request;
        if (action === "start_recording")
            return !!next.recording && next.recording.captureId !== before.recording?.captureId;
        if (action === "screenshot")
            return next.lastCapture?.kind === "screenshot" && next.lastCapture.id !== before.lastCapture?.id;
        if (action === "connect") {
            const selected = fields.selection;
            return next.observation?.connection === "connected" && next.observation.selection?.videoDeviceId === selected?.videoId && next.observation.selection?.audioDeviceId === selected?.audioId;
        }
        if (action === "enable")
            return next.enabled === true && (before.enabled !== true || fields.audio === true && before.observation?.permissions?.audio !== "authorized" && next.observation?.permissions?.audio === "authorized");
        if (action === "disable")
            return next.enabled === false;
        if (action === "disconnect" || action === "stop_recording")
            return (action === "stop_recording" || next.observation?.connection === "disconnected") && (!before.recording || next.recording?.captureId === before.recording.captureId && ["complete", "partial", "failed"].includes(next.recording.state) && !next.recording.uncertain);
        return false;
    }
    function showError(error, requested = true) {
        if (disposed)
            return;
        const text = error instanceof Error ? error.message : String(error);
        if (!requested && !knownOperation()) {
            connectionMessage = "The device view is disconnected. Retry when you want to connect.";
            render();
            return;
        }
        lastError = text;
        if (visible && text !== displayedError) {
            displayedError = text;
            errorDialog.show("device-capture", text);
        }
    }
    async function request(action, fields = {}) {
        if (uncertainRequest)
            throw new Error("The previous device action is unconfirmed. Check its status before another action.");
        if (pending && action !== "disable")
            throw new Error("A capture operation is still finishing.");
        if (action === "disable" && revoking)
            throw new Error("Capture disable is already pending.");
        if (!state.active)
            throw new Error("This capture session is closed.");
        const before = state;
        let acknowledged = false;
        noteTrace("controlStart");
        invalidateFrame(false);
        pending++;
        if (action === "disable")
            revoking = true;
        if (action === "list_devices") {
            listingDevices = true;
            discoveryFailed = false;
        }
        render();
        try {
            const response = await fetch(new URL("control", base), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId: state.sessionId, generation: state.generation, action, ...fields }), credentials: "omit", cache: "no-store", signal: AbortSignal.timeout(65000) });
            const value = await response.json();
            if (value.status && !disposed) {
                accept(value.status);
                acknowledged = true;
            }
            if (!response.ok && response.status >= 400 && response.status < 500)
                acknowledged = true;
            if (!response.ok || !value.success)
                throw new Error(value.error ?? "The capture action could not finish.");
            if (!acknowledged)
                throw new Error("The device action returned no status.");
            return value;
        }
        catch (error) {
            if (action === "list_devices")
                discoveryFailed = true;
            if (!acknowledged && !["list_devices", "permission_status", "open_settings", "live_frame"].includes(action)) {
                uncertainRequest = { action, before, fields };
                throw new Error("The device action is unconfirmed because its reply was lost. Check the original status; do not retry the action.");
            }
            throw error;
        }
        finally {
            pending--;
            noteTrace("controlEnd");
            if (action === "disable")
                revoking = false;
            if (action === "list_devices")
                listingDevices = false;
            render();
            void pollStatus();
            scheduleFrame();
        }
    }
    function run(action) { void action().catch(error => showError(error)); }
    function settingsTab(name, focus = false) { picker.close(); for (const kind of ["connection", "recording"]) {
        const tab = element(`settings-${kind}`);
        tab.setAttribute("aria-selected", String(kind === name));
        tab.tabIndex = kind === name ? 0 : -1;
        element(`settings-${kind}-panel`).hidden = kind !== name;
        if (focus && kind === name)
            tab.focus();
    } }
    function openSettings(tab = "connection") { settingsTab(tab); if (!settings.open)
        settings.showModal(); element("settings-title").focus({ preventScroll: true }); }
    function render() {
        if (disposed)
            return;
        options.onChange?.(blocked());
        publishMeasurement();
        publishStageTrace();
        const permissionRequired = state.permissionRequired !== false, audioSupported = state.audioSupported !== false;
        const needsEnable = permissionRequired && (!state.enabled || !!state.observation?.permissions && state.observation.permissions.audio !== "authorized");
        element("capture-permission-help").hidden = !needsEnable;
        element("capture-device-field").hidden = needsEnable;
        element("permission-status").hidden = !permissionRequired;
        const connection = state.observation?.connection ?? "disconnected", connected = connection === "connected" && !!state.enabled, recording = !!state.recording && ["starting", "recording", "finishing"].includes(state.recording.state), busy = !!pending || !!state.busy || !!uncertainRequest;
        const discovering = !!state.enabled && !needsEnable && !discoveryFailed && (pendingEnable || listingDevices);
        const uncertain = !!uncertainRequest || state.recording?.uncertain === true || state.nativeFailure?.devicesReleased === false;
        element("record").hidden = recording && !uncertain;
        element("record").disabled = busy || uncertain || !connected || !state.enabled;
        element("stop").hidden = !recording || uncertain;
        element("stop").disabled = !!pending || !!state.busy;
        element("stop").setAttribute("aria-label", "Stop recording");
        const recovery = element("recovery"), recoveryPath = state.recording?.retainedPath ?? "";
        if (recoveryPath !== activeRecoveryPath) {
            activeRecoveryPath = recoveryPath;
            dismissedRecoveryPath = "";
        }
        recovery.hidden = !recoveryPath || recoveryPath === dismissedRecoveryPath;
        recovery.textContent = "A partial recording was saved. Ask Claude to recover it.";
        element("device-empty").hidden = connected;
        element("device-empty-message").textContent = discovering ? "Finding your Chromatic…" : !state.enabled ? "Device capture is off." : "Connect your Chromatic to see its live view.";
        element("empty-settings").textContent = !permissionRequired ? "Connect" : !state.enabled ? "Enable capture…" : "Connection settings";
        element("empty-settings").hidden = discovering;
        element("empty-settings").disabled = busy;
        const inventoryFresh = !!state.devices && (state.devicesListedAt === undefined || Date.now() - state.devicesListedAt < 60000);
        const selectedVideo = displayDevices?.videoDevices.find(device => device.deviceId === camera.value), matches = matchingAudio(selectedVideo);
        const soleDevice = displayDevices?.videoDevices.length === 1 && !!selectedVideo, singleDevice = element("single-device");
        singleDevice.hidden = !soleDevice;
        const singleLabel = soleDevice ? selectedVideo.label : "";
        if (singleDevice.textContent !== singleLabel)
            singleDevice.textContent = singleLabel;
        enable.hidden = !needsEnable || connected || recording;
        enable.disabled = busy || !state.active || !state.supported || pendingEnable;
        element("connect").hidden = connected || recording || needsEnable;
        element("connect").disabled = busy || discovering || needsEnable || !state.enabled || !camera.value || !inventoryFresh || (audioSupported && matches.length !== 1);
        element("disconnect").hidden = !connected && !recording;
        element("disconnect").disabled = busy;
        element("screenshot").disabled = busy || !connected;
        element("refresh").disabled = busy || connected || recording || !state.enabled || needsEnable;
        camera.disabled = busy || discovering || connected || recording || !state.enabled || needsEnable;
        picker.render(displayDevices?.videoDevices ?? [], camera.value, camera.disabled, !!soleDevice);
        if (discovering && !displayDevices?.videoDevices.length)
            element("device-picker-value").textContent = "Finding your Chromatic…";
        element("duration").disabled = recording || uncertain;
        if (!connected) {
            frame.hidden = true;
            lastFrame = undefined;
            frameError = "";
            if (frameUrl) {
                URL.revokeObjectURL(frameUrl);
                frameUrl = undefined;
                frame.removeAttribute("src");
            }
        }
        const elapsed = state.recording ? Math.max(0, Math.min(state.recording.durationMs, state.recording.durationMs - (Date.parse(state.recording.deadline) - Date.now()))) : 0;
        const label = uncertain ? ""
            : recording ? `● REC ${Math.floor(elapsed / 60000)}:${String(Math.floor(elapsed / 1000) % 60).padStart(2, "0")}`
                : connectionMessage ? connectionMessage : !state.active ? "Device view disconnected — reopen it to connect."
                    : connection === "failed" ? "Connection interrupted — check Settings."
                        : connection === "connecting" ? "Connecting to your Chromatic…"
                            : "";
        const stateKey = recording ? "recording" : label;
        if (stateKey !== activeStateKey) {
            activeStateKey = stateKey;
            dismissedStateKey = "";
        }
        element("state").textContent = stateKey === dismissedStateKey ? "" : label;
        element("state").dataset.recording = String(recording);
        element("connection-hint").textContent = connectionMessage || (!state.active ? "Reopen the device view to connect." : !state.supported ? "Device capture is not supported on this platform." : discovering || discoveryFailed ? "" : state.enabled && state.devices && !state.devices.videoDevices.length ? "Connect and power on your Chromatic, then refresh." : state.enabled && state.devices && !inventoryFresh ? "Refresh devices to connect." : "");
        element("audio-hint").textContent = state.enabled && !busy && audioSupported && selectedVideo && matches.length !== 1 ? (matches.length ? "Multiple matching USB audio inputs found. Check the connection, then refresh." : "USB audio not found. Check the connection, then refresh.") : "";
        element("guidance").textContent = audioSupported ? "" : "USB audio is not available on Linux.";
        element("permission-status").textContent = pendingEnable && needsEnable ? "Waiting for macOS permission…" : "";
        const source = state.observation?.source;
        element("details").textContent = source ? `${source.width} × ${source.height} · ${source.videoSamples} native video samples` : "";
        const sound = element("sound");
        sound.disabled = true;
        sound.dataset.tooltip = audioSupported ? "Live audio playback is not available. USB audio is included in recordings." : "USB audio capture is not supported on Linux in this build.";
        sound.setAttribute("aria-label", sound.dataset.tooltip);
        element("annotate").disabled = !connected;
    }
    function matchingAudio(video) {
        return video?.player ? state.devices?.audioDevices.filter(device => device.player === video.player) ?? [] : [];
    }
    function accept(value) {
        if (disposed)
            return;
        if (requestResolved(value))
            uncertainRequest = undefined;
        if (value.sessionId !== state.sessionId || value.generation !== state.generation)
            discoveryFailed = false;
        if (frameStateIdentity(value) !== frameStateIdentity(state))
            invalidateFrame(true);
        const sameSession = value.active && value.enabled && value.sessionId === state.sessionId && value.generation === state.generation;
        if (value.devices)
            displayDevices = value.devices;
        else if (!sameSession || !(value.busy || pending))
            displayDevices = undefined;
        inventoryId = value.devices?.inventoryId ?? "";
        const videos = displayDevices?.videoDevices ?? [], previous = camera.value;
        const nextOptionsKey = JSON.stringify(videos.map(device => [device.deviceId, device.label]));
        if (nextOptionsKey !== videoOptionsKey) {
            videoOptionsKey = nextOptionsKey;
            camera.replaceChildren(new Option("Select device", ""), ...videos.map(d => new Option(d.label, d.deviceId)));
        }
        camera.value = videos.some(d => d.deviceId === previous) ? previous : videos.length === 1 ? videos[0].deviceId : "";
        if (measurement && measurement.key !== measurementKey(value))
            endMeasurement(measurement, "connection-change");
        state = value;
        syncStageTrace();
        connectionMessage = "";
        if (visible && (value.settingsRequest ?? 0) > settingsRequest) {
            settingsRequest = value.settingsRequest;
            openSettings(value.settingsTab);
        }
        if (value.lastCapture && value.lastCapture.id !== lastCapture) {
            lastCapture = value.lastCapture.id;
            const saved = element("saved");
            saved.hidden = false;
            const link = document.createElement("a");
            link.href = new URL(`captures/${value.lastCapture.id}`, base).href;
            link.textContent = value.lastCapture.kind === "video" ? "Download clip" : "View image";
            link.target = "_blank";
            link.rel = "noopener";
            const copy = document.createElement("button");
            copy.textContent = "Copy path";
            const path = value.lastCapture.path;
            copy.addEventListener("click", () => { void navigator.clipboard.writeText(path).catch(showError); });
            saved.replaceChildren(document.createTextNode(value.lastCapture.kind === "video" ? "Recording saved. " : "Screenshot saved. "), link, document.createTextNode(" · "), copy);
            clearTimeout(toastTimer);
            toastTimer = setTimeout(() => { saved.hidden = true; }, 8000);
        }
        const identityError = !!value.frameIdentityFailure && value.active && value.enabled && value.observation?.connection === "connected";
        if (identityError)
            frameError = "";
        if (!identityError && displayedError === identityErrorMessage) {
            errorDialog.close();
            displayedError = "";
            if (lastError === identityErrorMessage)
                lastError = "";
        }
        if (value.error)
            showError(value.error, false);
        else if (identityError && !uncertainRequest)
            showError(identityErrorMessage, false);
        if (!value.error && !identityError && !uncertainRequest && !frameError) {
            lastError = "";
            displayedError = "";
        }
        render();
        scheduleFrame();
    }
    function displayActive() { return !disposed && visible && pageActive && document.visibilityState !== "hidden"; }
    function frameStateIdentity(value) { return JSON.stringify([value.active, value.sessionId, value.generation, value.enabled, value.busy, value.revoked, value.closing, value.observation?.sessionId, value.observation?.connection, value.observation?.selection?.videoDeviceId, value.observation?.latestFrame?.connectionId ?? value.latestFrame?.connectionId, value.observation?.sourceGeneration ?? value.latestFrame?.sourceGeneration, !!value.latestFrame, value.frameIdentityFailure?.code]); }
    function canReadFrame() { return displayActive() && state.active && state.enabled && state.observation?.connection === "connected" && !!state.latestFrame && !pending && !state.busy && !uncertainRequest && !state.revoked && !state.closing && !state.frameReleaseFailure && !state.frameIdentityFailure && state.nativeFailure?.devicesReleased !== false; }
    function measurementKey(value) { return JSON.stringify([value.sessionId, value.generation, value.observation?.sessionId ?? value.latestFrame?.sessionId, value.observation?.connection, value.observation?.latestFrame?.connectionId ?? value.latestFrame?.connectionId, value.observation?.sourceGeneration ?? value.latestFrame?.sourceGeneration]); }
    // The service cache may be empty without changing the native connection. Its
    // native observation, not the cached frame, is the continuity authority.
    function traceKey(value) { return JSON.stringify([value.sessionId, value.generation, value.observation?.sessionId, value.observation?.connection, value.observation?.latestFrame?.connectionId ?? null, value.observation?.sourceGeneration ?? null]); }
    function traceActivity() { if (!displayActive())
        return "hidden"; if (pending || state.busy || uncertainRequest || statusRecoveryActive)
        return "control"; return canReadFrame() ? "active" : "unavailable"; }
    function withTrace(trace, work) { if (!trace || trace !== stageTrace)
        return; try {
        work(trace);
    }
    catch { /* Diagnostic failures cannot interrupt the feed. */ } }
    function noteTrace(event) { if (!stageTrace)
        return; withTrace(stageTrace, value => value.event(event, performance.now())); }
    function finishStageTrace(reason, previous = false) { if (!stageTrace)
        return; withTrace(stageTrace, value => { const now = performance.now(); value.heartbeat(now, traceActivity()); value.end(reason, now); const json = value.snapshot(value.lastValidTime, true); if (json !== undefined) {
        if (previous)
            frame.dataset.captureStageTraceEnded = json;
        else
            frame.dataset.captureStageTrace = json;
        stageTracePublishedAt = value.lastValidTime;
    } }); }
    function syncStageTrace() {
        try {
            if (state.diagnosticTraceEnabled !== true) {
                stageTrace = undefined;
                delete frame.dataset.captureStageTrace;
                delete frame.dataset.captureStageTraceEnded;
                return;
            }
            const key = traceKey(state), connected = state.active && state.enabled && !state.revoked && !state.closing && state.observation?.connection === "connected" && !!state.observation.latestFrame;
            if (stageTrace && (!connected || stageTrace.key !== key || stageTrace.isEnded && connected)) {
                if (!stageTrace.isEnded || connected)
                    finishStageTrace("connection-change", connected);
                if (connected) {
                    stageTrace = undefined;
                    delete frame.dataset.captureStageTrace;
                }
            }
            if (!connected || stageTrace || disposed)
                return;
            const uuid = (value) => typeof value === "string" && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value) ? value : null;
            const number = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
            stageTrace = new BrowserStageTrace(key, { serviceSessionId: uuid(state.sessionId), serviceGeneration: number(state.generation), nativeSessionId: uuid(state.observation?.sessionId), connectionId: uuid(state.observation?.latestFrame?.connectionId), sourceGeneration: number(state.observation?.sourceGeneration) }, performance.now(), traceActivity());
        }
        catch { /* Do not make diagnostics a prerequisite for display. */ }
    }
    function publishStageTrace() { if (!stageTrace)
        return; withTrace(stageTrace, value => { value.heartbeat(performance.now(), traceActivity()); const now = value.lastValidTime, json = value.snapshot(now, false, stageTracePublishedAt); if (json !== undefined) {
        frame.dataset.captureStageTrace = json;
        stageTracePublishedAt = now;
    } }); }
    function endMeasurement(value, reason, now = performance.now()) {
        if (value.endedAtMs !== undefined)
            return;
        if (rafFrame?.measurement === value && rafFrame.clockSample) {
            value.diagnostics?.missRaf();
            rafFrame.clockSample = undefined;
        }
        value.endedAtMs = Math.min(value.startedAtMs + 60000, Math.max(value.startedAtMs, now));
        value.endReason = reason;
    }
    function measurementOpen(value, now = performance.now()) {
        if (now - value.startedAtMs >= 60000)
            endMeasurement(value, "window-complete", now);
        return value.endedAtMs === undefined;
    }
    function frameMeasurement() {
        const key = measurementKey(state);
        const distribution = () => ({ buckets: Array(60).fill(0), intervalsMs: [], observedIntervals: 0, longestGapMs: null });
        if (!measurement || measurement.key !== key) {
            const startedAtMs = performance.now();
            let diagnostics;
            if (timingDiagnostic)
                try {
                    diagnostics = createTimingDiagnostics(startedAtMs);
                }
                catch { /* Diagnostic setup must not stop the live view. */ }
            measurement = { key, serviceSessionId: state.sessionId, serviceGeneration: state.generation, nativeSessionId: state.observation?.sessionId ?? state.latestFrame?.sessionId, connectionId: state.observation?.latestFrame?.connectionId ?? state.latestFrame?.connectionId, sourceGeneration: state.observation?.sourceGeneration ?? state.latestFrame?.sourceGeneration, startedAtMs, counts: { delivered: 0, decoded: 0, submitted: 0, rafOpportunities: 0, duplicates: 0, errors: 0, stale: 0 }, firstAtMs: {}, lastAtMs: {}, sequences: {}, unobservedPreviewSequences: null, sequenceGapCounterSaturated: false, distributions: { delivered: distribution(), decoded: distribution(), submitted: distribution(), rafOpportunities: distribution() }, diagnostics };
        }
        return measurement;
    }
    function countFrame(value, counter, now = performance.now()) {
        if (!measurementOpen(value, now))
            return false;
        // One fixed window, scalar high-water marks, and bounded timing samples only.
        value.counts[counter] = Math.min(100000, value.counts[counter] + 1);
        if (value.counts[counter] === 100000)
            endMeasurement(value, "counter-limit", now);
        return true;
    }
    function countUniqueFrame(value, stage, identity, now = performance.now()) {
        const sequence = identity.previewSequence ?? identity.frameId, previous = value.sequences[stage];
        if (previous !== undefined && sequence <= previous)
            return;
        value.sequences[stage] = sequence;
        if (countFrame(value, stage, now)) {
            const samples = value.distributions[stage], bucket = Math.min(59, Math.floor(Math.max(0, now - value.startedAtMs) / 1000)), last = value.lastAtMs[stage];
            samples.buckets[bucket] = samples.buckets[bucket] + 1;
            if (last !== undefined) {
                const interval = now - last;
                samples.observedIntervals++;
                samples.longestGapMs = Math.max(samples.longestGapMs ?? 0, interval);
                if (samples.intervalsMs.length < 4096)
                    samples.intervalsMs.push(interval);
            }
            value.firstAtMs[stage] ??= now;
            value.lastAtMs[stage] = now;
        }
    }
    function summarizeDistributions(value, now) {
        const observedThroughMs = value.endedAtMs ?? now, elapsedMs = Math.max(0, observedThroughMs - value.startedAtMs), completeSeconds = Math.min(60, Math.floor(elapsedMs / 1000));
        if (value.summary && (value.summary.finalized || value.endedAtMs === undefined && now - value.summary.calculatedAtMs < 1000))
            return value.summary;
        const percentile = (sorted, fraction) => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? null;
        const stage = (name) => {
            const samples = value.distributions[name], rates = samples.buckets.slice(0, completeSeconds).sort((a, b) => a - b), intervals = samples.intervalsMs.slice().sort((a, b) => a - b);
            return { oneSecondRatesFps: { min: rates[0] ?? null, mean: rates.length ? rates.reduce((sum, count) => sum + count, 0) / rates.length : null, p50: percentile(rates, 0.5), p95: percentile(rates, 0.95), p99: percentile(rates, 0.99), max: rates.at(-1) ?? null },
                ...(completeSeconds < 60 ? { partialSecond: { durationMs: elapsedMs - completeSeconds * 1000, uniqueCount: samples.buckets[completeSeconds] } } : {}),
                interframe: { observedIntervals: samples.observedIntervals, retainedIntervals: intervals.length, intervalLimitReached: intervals.length === 4096, omittedIntervals: samples.observedIntervals - intervals.length, p50Ms: percentile(intervals, 0.5), p95Ms: percentile(intervals, 0.95), p99Ms: percentile(intervals, 0.99), longestGapMs: samples.longestGapMs } };
        };
        // Sorting is limited to once per second, plus the final window snapshot.
        return value.summary = { calculatedAtMs: now, observedThroughMs, elapsedMs, finalized: value.endedAtMs !== undefined, partialWindow: elapsedMs < 60000, completeSeconds, counterLimitReached: value.endReason === "counter-limit", stages: { delivered: stage("delivered"), decoded: stage("decoded"), submitted: stage("submitted"), rafOpportunities: stage("rafOpportunities") } };
    }
    function publishMeasurement() {
        if (!measurement)
            return;
        const value = measurement, now = performance.now();
        measurementOpen(value, now);
        const elapsedMs = Math.max(0, (value.endedAtMs ?? now) - value.startedAtMs);
        // Browser elapsed time includes view/control pauses. Native uptime and source
        // PTS stay separate; an RAF callback is not proof that a display showed a frame.
        frame.dataset.captureMetrics = JSON.stringify({ version: 1, clock: "browser-performance-now", clockAlignment: "not-aligned-to-native", rafMeaning: "callback-opportunity-not-physical-presentation", windowLimitMs: 60000, counterLimit: 100000, intervalLimitPerStage: 4096, percentileMethod: "nearest-rank", intervalScope: "between-same-connection-unique-events; quantiles use retained intervals", sequenceGapScope: "encoded preview sequences not observed between delivered frames; includes upstream and view pauses, not source drops; first and last censored", unobservedPreviewSequences: value.unobservedPreviewSequences, sequenceGapCounterSaturated: value.sequenceGapCounterSaturated, serviceSessionId: value.serviceSessionId, serviceGeneration: value.serviceGeneration, nativeSessionId: value.nativeSessionId, connectionId: value.connectionId, sourceGeneration: value.sourceGeneration, sequenceBasis: value.sequenceBasis, startedAtMs: value.startedAtMs, endedAtMs: value.endedAtMs, endReason: value.endReason, elapsedMs, counts: value.counts, firstAtMs: value.firstAtMs, lastAtMs: value.lastAtMs, distribution: summarizeDistributions(value, now) });
        if (value.diagnostics)
            frame.dataset.captureDiagnostics = JSON.stringify({ ...value.diagnostics.summary(now, value.endedAtMs), serviceSessionId: value.serviceSessionId, serviceGeneration: value.serviceGeneration, nativeSessionId: value.nativeSessionId, connectionId: value.connectionId, sourceGeneration: value.sourceGeneration });
        else
            delete frame.dataset.captureDiagnostics;
    }
    function observeRaf(value, identity, generation, submittedAt, trace, clockSample) {
        if (!measurementOpen(value) && (!trace || trace !== stageTrace)) {
            if (clockSample)
                value.diagnostics?.missRaf();
            return;
        }
        if (rafFrame?.clockSample)
            rafFrame.measurement.diagnostics?.missRaf();
        rafFrame = { measurement: value, identity, generation, submittedAt, trace, clockSample };
        if (frameRaf !== undefined)
            return;
        frameRaf = requestAnimationFrame(() => { frameRaf = undefined; const pending = rafFrame; rafFrame = undefined; if (pending && pending.generation === frameGeneration && canReadFrame()) {
            const now = performance.now();
            if (measurementOpen(pending.measurement)) {
                countUniqueFrame(pending.measurement, "rafOpportunities", pending.identity);
                if (pending.clockSample)
                    pending.measurement.diagnostics?.observeRaf(pending.clockSample, now, Date.now());
                publishMeasurement();
            }
            else if (pending.clockSample)
                pending.measurement.diagnostics?.missRaf();
            if (pending.trace)
                withTrace(pending.trace, trace => trace.stage("rafOpportunities", pending.identity, now, now - pending.submittedAt));
        }
        else if (pending?.clockSample)
            pending.measurement.diagnostics?.missRaf(); });
    }
    function invalidateFrame(clear) { frameGeneration++; frameFallback = false; clearTimeout(frameTimer); frameTimer = undefined; frameController?.abort(); if (frameRaf !== undefined)
        cancelAnimationFrame(frameRaf); frameRaf = undefined; if (rafFrame?.clockSample)
        rafFrame.measurement.diagnostics?.missRaf(); rafFrame = undefined; lastFrame = undefined; if (clear) {
        frame.hidden = true;
        if (frameUrl)
            URL.revokeObjectURL(frameUrl);
        frameUrl = undefined;
        frame.removeAttribute("src");
        for (const name of ["nativeSessionId", "frameId", "frameSha256", "sourcePts", "transferMs", "transferScope", "serviceWaitMs", "decodeMs", "connectionId", "previewSequence", "sourceGeneration", "callbackToPublishMs"])
            delete frame.dataset[name];
    } publishMeasurement(); }
    function scheduleFrame(delay = 0) { if (frameTimer !== undefined || framePolling || statusRecoveryActive || !canReadFrame())
        return; frameTimer = setTimeout(() => { frameTimer = undefined; void pollFrame(); }, delay); }
    function frameIdentity(response) {
        const header = (name) => response.headers.get(`X-Chromatic-${name}`);
        const number = (name, integer = false, minimum = 0) => { const raw = header(name), value = raw === null ? NaN : Number(raw); if (raw === null || !raw.trim() || !Number.isFinite(value) || value < minimum || integer && !Number.isSafeInteger(value))
            throw new Error("The native preview frame metadata was invalid."); return value; };
        const uuid = (name, optional = false) => { const value = header(name); if (value === null && optional)
            return undefined; if (value === null || !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value))
            throw new Error("The native preview frame identity was invalid."); return value; };
        const sha256 = header("Frame-Sha256");
        if (!sha256 || !/^[a-f0-9]{64}$/.test(sha256))
            throw new Error("The native preview frame checksum was missing or invalid.");
        const identity = { nativeSessionId: uuid("Native-Session-Id"), frameId: number("Frame-Id", true), sha256, sourcePTS: number("Source-Pts"), width: number("Frame-Width", true, 1), height: number("Frame-Height", true, 1) };
        if (identity.width > 4096 || identity.height > 4096 || identity.width * identity.height > 8_388_608)
            throw new Error("The native preview dimensions exceeded their limit.");
        identity.connectionId = uuid("Connection-Id", true);
        if (header("Preview-Sequence") !== null)
            identity.previewSequence = number("Preview-Sequence", true, 1);
        if (header("Source-Generation") !== null)
            identity.sourceGeneration = number("Source-Generation", true);
        const timing = ["Callback-Received-At-Ms", "Encode-Started-At-Ms", "Encode-Finished-At-Ms", "Published-At-Ms"];
        if (header("Timing-Clock") !== null || timing.some(name => header(name) !== null)) {
            if (header("Timing-Clock") !== "system-uptime")
                throw new Error("The native preview clock was not recognized.");
            const values = timing.map(name => number(name));
            if (values.some((value, index) => index > 0 && value < values[index - 1]))
                throw new Error("The native preview timing was out of order.");
            [identity.callbackMs, identity.encodeStartedMs, identity.encodeFinishedMs, identity.publishedMs] = values;
            identity.callbackToPublishMs = values[3] - values[0];
        }
        const detail = ["Preview-Queued-At-Ms", "Hash-Finished-At-Ms", "File-Written-At-Ms"];
        if (detail.some(name => header(name) !== null)) {
            if (detail.some(name => header(name) === null) || identity.callbackMs === undefined || identity.encodeStartedMs === undefined || identity.encodeFinishedMs === undefined || identity.publishedMs === undefined)
                throw new Error("The native preview timing was incomplete.");
            const [queued, hash, written] = detail.map(name => number(name));
            if (queued < identity.callbackMs || queued > identity.encodeStartedMs || hash < identity.encodeFinishedMs || written < hash || written > identity.publishedMs)
                throw new Error("The native preview timing was out of order.");
            identity.previewQueuedMs = queued;
            identity.hashFinishedMs = hash;
            identity.fileWrittenMs = written;
        }
        if (header("Read-Duration-Ms") !== null)
            identity.readMs = number("Read-Duration-Ms");
        if (header("Wait-Duration-Ms") !== null)
            identity.waitMs = number("Wait-Duration-Ms");
        return identity;
    }
    async function pollStatus(force = false) {
        if (!displayActive())
            return;
        // An aborted request keeps the slot until it settles; coalesce resets into one refresh.
        if (force) {
            const changed = !statusRecoveryActive;
            statusRecoveryActive = true;
            if (changed)
                publishStageTrace();
            statusRefreshPending = true;
            if (statusPolling)
                statusController?.abort();
        }
        if (statusPolling || pending || !statusRefreshPending && performance.now() < statusRetryAt)
            return;
        const recovery = statusRefreshPending;
        statusRefreshPending = false;
        statusPolling = true;
        const generation = frameGeneration, controller = new AbortController();
        statusController = controller;
        let accepted = false;
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]);
        try {
            const response = await fetch(new URL("status", base), { credentials: "omit", cache: "no-store", signal });
            if (!response.ok)
                throw new Error("The local capture session is not responding.");
            const next = await response.json();
            if (signal.aborted)
                throw signal.reason;
            if (generation === frameGeneration && !pending && displayActive()) {
                statusRetryAt = 0;
                accept(next);
                accepted = true;
            }
        }
        catch (error) {
            if (!controller.signal.aborted && generation === frameGeneration && displayActive()) {
                statusRetryAt = performance.now() + 1000;
                showError(error, false);
            }
        }
        finally {
            statusPolling = false;
            statusController = undefined;
            if (recovery) {
                if (!accepted && generation !== frameGeneration && !disposed)
                    statusRefreshPending = true;
                else {
                    statusRecoveryActive = false;
                    publishStageTrace();
                    scheduleFrame(500);
                }
            }
            if (statusRefreshPending && displayActive() && !pending)
                void pollStatus();
        }
    }
    async function pollFrame() {
        if (framePolling || !canReadFrame())
            return;
        framePolling = true;
        const generation = frameGeneration, controller = new AbortController(), metrics = frameMeasurement(), trace = stageTrace;
        frameController = controller;
        publishMeasurement();
        let next, image, failed = false, noChange = false, capacity = false, settled = false, handled = false, stale = false, errorCounted = false, timedOut = false, timedResponse = false, timeout;
        const clockAttempted = !!metrics.diagnostics && measurementOpen(metrics) && diagnosticRequests++ % 10 === 0;
        if (clockAttempted)
            metrics.diagnostics?.noteTimedRequest();
        const countStale = () => { if (!stale) {
            stale = true;
            countFrame(metrics, "stale");
            if (trace)
                withTrace(trace, value => value.event("stale", performance.now()));
        } };
        const countError = () => { if (!errorCounted) {
            errorCounted = true;
            countFrame(metrics, "errors");
            if (trace)
                withTrace(trace, value => value.event("error", performance.now()));
        } };
        controller.signal.addEventListener("abort", () => { if (!timedOut)
            countStale(); image?.removeAttribute("src"); if (next) {
            URL.revokeObjectURL(next);
            next = undefined;
        } }, { once: true });
        const current = () => { const valid = generation === frameGeneration && !controller.signal.aborted && canReadFrame(); if (!valid && !timedOut)
            countStale(); return valid; };
        const work = (async () => {
            const wallStartedAt = Date.now(), fetchStarted = performance.now();
            if (trace)
                withTrace(trace, value => { value.event("request", fetchStarted); value.phase("fetch", fetchStarted); });
            // Only advance the cursor after a frame was actually submitted. A failed
            // decode must be able to retry the same verified frame on the next request.
            const fallback = frameFallback;
            frameFallback = false;
            const after = !fallback && lastFrame && { nativeSessionId: lastFrame.nativeSessionId, frameId: lastFrame.frameId, sha256: lastFrame.sha256, connectionId: lastFrame.connectionId, sourceGeneration: lastFrame.sourceGeneration, previewSequence: lastFrame.previewSequence };
            const route = fallback ? (clockAttempted ? "live-frame-timed" : "live-frame") : (clockAttempted ? "live-frame-next-timed" : "live-frame-next");
            const response = await fetch(new URL(route, base), { credentials: "omit", cache: "no-store", signal: controller.signal, ...(after ? { headers: { "X-Chromatic-After-Identity": JSON.stringify(after) } } : {}) });
            const headersAt = performance.now();
            if (trace)
                withTrace(trace, value => value.event(response.status === 200 ? "http200" : response.status === 204 ? "http204" : response.status === 404 ? "http404" : response.status === 409 ? "http409" : response.status === 429 ? "http429" : "httpOther", headersAt));
            if (clockAttempted && measurementOpen(metrics, headersAt)) {
                timedResponse = true;
                const raw = response.headers.get("X-Chromatic-Clock-Sample-Ms"), hasClock = raw !== null && !!raw.trim() && Number.isFinite(Number(raw)) && Number(raw) >= 0, unavailable = response.headers.get("X-Chromatic-Clock-Unavailable-Reason");
                const reason = unavailable === "busy" || unavailable === "unsupported" || unavailable === "invalid" || unavailable === "error" ? unavailable : undefined;
                metrics.diagnostics?.noteTimedResponse(hasClock, hasClock ? undefined : reason);
            }
            if (!current())
                return;
            if (response.status === 204) {
                noChange = true;
                return;
            }
            if (response.status === 409) {
                if (!statusRecoveryActive) {
                    invalidateFrame(true);
                    void pollStatus(true);
                }
                failed = true;
                return;
            }
            if (response.status === 429) {
                capacity = true;
                frameFallback = true;
                return;
            }
            if (response.status === 404) {
                countError();
                if (!statusRecoveryActive) {
                    invalidateFrame(true);
                    void pollStatus(true);
                }
                failed = true;
                return;
            }
            if (!response.ok)
                throw new Error("The native preview frame could not be read.");
            const identity = frameIdentity(response), expectedNative = state.observation?.sessionId ?? state.latestFrame?.sessionId, expectedConnection = state.observation?.latestFrame?.connectionId ?? state.latestFrame?.connectionId, expectedSource = state.observation?.sourceGeneration ?? state.latestFrame?.sourceGeneration;
            if (!expectedNative || identity.nativeSessionId !== expectedNative || expectedConnection !== undefined && identity.connectionId !== expectedConnection || expectedSource !== undefined && identity.sourceGeneration !== expectedSource)
                throw new Error("The native preview frame belongs to a different connection.");
            const blob = await response.blob();
            const bodyAt = performance.now();
            if (!current())
                return;
            if (!blob.size || blob.size > 1024 * 1024 || blob.type !== "image/jpeg")
                throw new Error("The native preview frame was invalid.");
            const length = response.headers.get("Content-Length");
            if (length !== null && Number(length) !== blob.size)
                throw new Error("The native preview frame was incomplete.");
            const basis = identity.previewSequence === undefined ? "source-frame-id" : "preview-sequence", incoming = identity.previewSequence ?? identity.frameId;
            if (metrics.sequenceBasis && metrics.sequenceBasis !== basis)
                throw new Error("The native preview sequence basis changed within its connection.");
            metrics.sequenceBasis = basis;
            const previous = metrics.latest?.previewSequence ?? metrics.latest?.frameId;
            if (previous !== undefined && incoming < previous) {
                countStale();
                return;
            }
            if (previous === incoming) {
                if (metrics.latest.sha256 !== identity.sha256)
                    throw new Error("The native preview frame identity changed its bytes.");
                countFrame(metrics, "duplicates");
            }
            else {
                if (basis === "preview-sequence" && measurementOpen(metrics)) {
                    const gaps = (metrics.unobservedPreviewSequences ?? 0) + (previous === undefined ? 0 : incoming - previous - 1);
                    metrics.unobservedPreviewSequences = Math.min(100000, gaps);
                    if (gaps >= 100000)
                        metrics.sequenceGapCounterSaturated = true;
                }
                metrics.latest = identity;
                countUniqueFrame(metrics, "delivered", identity);
                if (trace)
                    withTrace(trace, value => value.stage("delivered", identity, bodyAt, bodyAt - fetchStarted));
            }
            publishMeasurement();
            if (lastFrame && (lastFrame.previewSequence ?? lastFrame.frameId) === incoming)
                return;
            const transferMs = bodyAt - fetchStarted;
            next = URL.createObjectURL(blob);
            image = new Image();
            image.src = next;
            const decodeStarted = performance.now();
            if (trace)
                withTrace(trace, value => value.phase("decode", decodeStarted));
            await image.decode();
            const decodedAt = performance.now();
            if (image.naturalWidth !== identity.width || image.naturalHeight !== identity.height)
                throw new Error("The native preview decoded dimensions did not match.");
            countUniqueFrame(metrics, "decoded", identity);
            if (!current())
                return;
            if (trace)
                withTrace(trace, value => value.stage("decoded", identity, decodedAt, decodedAt - decodeStarted));
            const old = frameUrl;
            frame.src = next;
            const submittedAt = performance.now();
            frame.hidden = false;
            frameUrl = next;
            next = undefined;
            lastFrame = identity;
            frameError = "";
            frame.dataset.nativeSessionId = identity.nativeSessionId;
            frame.dataset.frameId = String(identity.frameId);
            frame.dataset.frameSha256 = identity.sha256;
            frame.dataset.sourcePts = String(identity.sourcePTS);
            frame.dataset.transferMs = String(transferMs);
            frame.dataset.transferScope = identity.waitMs === undefined ? "fetch-to-body-immediate-request" : "fetch-to-body-includes-service-wait";
            if (identity.waitMs === undefined)
                delete frame.dataset.serviceWaitMs;
            else
                frame.dataset.serviceWaitMs = String(identity.waitMs);
            frame.dataset.decodeMs = String(performance.now() - decodeStarted);
            for (const name of ["connectionId", "previewSequence", "sourceGeneration", "callbackToPublishMs"]) {
                if (identity[name] === undefined)
                    delete frame.dataset[name];
                else
                    frame.dataset[name] = String(identity[name]);
            }
            const previousSubmission = metrics.sequences.submitted;
            countUniqueFrame(metrics, "submitted", identity);
            if (trace)
                withTrace(trace, value => {
                    if (!value.stage("submitted", identity, submittedAt, submittedAt - decodedAt))
                        return;
                    const raw = response.headers.get("X-Chromatic-Cache-Published-At-Ms"), service = raw !== null && raw.trim() ? Number(raw) : null;
                    const nativeTiming = identity.callbackMs !== undefined && identity.encodeStartedMs !== undefined && identity.encodeFinishedMs !== undefined && identity.publishedMs !== undefined ? { clock: "system-uptime", callbackReceivedAtMs: identity.callbackMs, ...(identity.previewQueuedMs === undefined ? {} : { previewQueuedAtMs: identity.previewQueuedMs }), encodeStartedAtMs: identity.encodeStartedMs, encodeFinishedAtMs: identity.encodeFinishedMs, ...(identity.hashFinishedMs === undefined ? {} : { hashFinishedAtMs: identity.hashFinishedMs }), ...(identity.fileWrittenMs === undefined ? {} : { fileWrittenAtMs: identity.fileWrittenMs }), publishedAtMs: identity.publishedMs } : null;
                    value.anchor(identity, service, submittedAt, nativeTiming);
                });
            let clockSample;
            if (metrics.diagnostics && measurementOpen(metrics, submittedAt) && (previousSubmission === undefined || incoming > previousSubmission)) {
                const rawClock = response.headers.get("X-Chromatic-Clock-Sample-Ms"), clock = rawClock === null || !rawClock.trim() ? undefined : Number(rawClock);
                try {
                    clockSample = metrics.diagnostics.observe(image, { startedAt: fetchStarted, headersAt, bodyAt, decodeStartedAt: decodeStarted, decodedAt, submittedAt, wallStartedAt, wallSubmittedAt: Date.now(), clockSampleMs: clockAttempted && Number.isFinite(clock) ? clock : undefined, readMs: identity.readMs, waitMs: identity.waitMs, callbackMs: identity.callbackMs, previewQueuedMs: identity.previewQueuedMs, encodeStartedMs: identity.encodeStartedMs, encodeFinishedMs: identity.encodeFinishedMs, hashFinishedMs: identity.hashFinishedMs, fileWrittenMs: identity.fileWrittenMs, publishedMs: identity.publishedMs, clockAttempted });
                }
                catch { /* Diagnostics cannot interrupt capture or cleanup. */ }
            }
            observeRaf(metrics, identity, generation, submittedAt, trace, clockSample);
            if (!state.error) {
                lastError = "";
                displayedError = "";
            }
            if (old)
                URL.revokeObjectURL(old);
        })();
        const finish = () => { clearTimeout(timeout); if (clockAttempted && !timedResponse && measurementOpen(metrics))
            metrics.diagnostics?.noteTimedNoResponse(); if (next)
            URL.revokeObjectURL(next); if (frameController === controller)
            frameController = undefined; framePolling = false; if (trace)
            withTrace(trace, value => value.phase(null, performance.now())); publishMeasurement(); scheduleFrame(failed ? 500 : capacity ? 100 : noChange ? 25 : 0); };
        // A timed-out decoder may settle later. Keep the single in-flight latch until
        // it does, so a stuck decoder cannot accumulate replacement requests.
        void work.then(() => { settled = true; if (handled)
            finish(); }, () => { settled = true; if (handled)
            finish(); });
        try {
            await Promise.race([work, new Promise((_, reject) => { timeout = setTimeout(() => { timedOut = true; countError(); if (trace)
                    withTrace(trace, value => value.event("timeout", performance.now())); controller.abort(); image?.removeAttribute("src"); reject(new Error("The native preview frame timed out.")); }, 5000); })]);
        }
        catch (error) {
            failed = true;
            if (generation === frameGeneration) {
                countError();
                if (displayActive() && !pending) {
                    frameError = error instanceof Error ? error.message : String(error);
                    showError(error, false);
                }
            }
            else
                countStale();
        }
        finally {
            handled = true;
            if (settled)
                finish();
        }
    }
    element("refresh").addEventListener("click", () => run(() => request("list_devices")));
    enable.addEventListener("click", () => { if (!state.active || pendingEnable || state.enabled && state.observation?.permissions?.audio === "authorized")
        return; pendingEnable = true; void (async () => { await request("enable", { audio: true }); if (state.enabled && !disposed) {
        await request("list_devices");
        if (state.devices?.videoDevices.length === 1) {
            camera.value = state.devices.videoDevices[0].deviceId;
            await connectSelected();
            settings.close();
        }
    } })().catch(showError).finally(() => { pendingEnable = false; render(); }); });
    camera.addEventListener("change", () => render());
    async function connectSelected() { const video = state.devices?.videoDevices.find(d => d.deviceId === camera.value), matches = matchingAudio(video); if (!state.devices || state.devicesListedAt !== undefined && Date.now() - state.devicesListedAt >= 60000)
        throw new Error("Refresh devices and use the exact selection from the current list."); if (!video)
        throw new Error("Select a Chromatic from the current device list."); if (state.audioSupported !== false && matches.length !== 1)
        throw new Error("Matching USB audio could not be resolved. Check the connection and refresh devices."); const sound = matches[0]; return request("connect", { inventoryId, selection: { videoId: video.deviceId, videoLabel: video.label, ...(state.audioSupported !== false && sound ? { audioId: sound.deviceId, audioLabel: sound.label } : {}) } }); }
    element("connect").addEventListener("click", () => run(connectSelected));
    for (const [id, action] of [["disconnect", "disconnect"], ["screenshot", "screenshot"]])
        element(id).addEventListener("click", () => run(() => request(action)));
    element("stop").addEventListener("click", () => { if (!uncertainRequest && !state.recording?.uncertain && state.nativeFailure?.devicesReleased !== false && state.recording && ["starting", "recording", "finishing"].includes(state.recording.state))
        run(() => request("stop_recording")); });
    element("empty-settings").addEventListener("click", () => {
        if (state.permissionRequired !== false && !state.enabled) {
            openSettings();
            return;
        }
        run(async () => {
            await request("list_devices");
            const devices = state.devices?.videoDevices ?? [];
            if (devices.length !== 1) {
                openSettings();
                if (!devices.length)
                    throw new Error("No supported Chromatic video device was found. Check USB, power, and access to the video device.");
                return;
            }
            camera.value = devices[0].deviceId;
            await connectSelected();
        });
    });
    element("record").addEventListener("click", () => run(() => request("start_recording", { durationMs: Number(element("duration").value) * 1000 })));
    for (const host of [app, ...(toolbar ? [toolbar] : []), ...(footer ? [footer] : [])])
        for (const button of Array.from(host.querySelectorAll("button[title]")))
            button.dataset.tooltip = button.title;
    const disposeTooltips = mountControlTooltips(app), disposeToolbarTooltips = toolbar ? mountControlTooltips(toolbar) : undefined, disposeFooterTooltips = footer ? mountControlTooltips(footer) : undefined;
    let selectedColor = DEVICE_COLORS[0], colorGeneration = 0;
    function paint() { if (visible && !disposed) {
        document.body.style.setProperty("--cgv-background", selectedColor.background);
        document.body.style.setProperty("--cgv-ink", selectedColor.ink);
    } for (const color of DEVICE_COLORS)
        element(`skin-${color.id}`).setAttribute("aria-pressed", String(color.id === selectedColor.id)); }
    async function chooseColor(color) { const generation = ++colorGeneration; if (color.id === selectedColor.id)
        return; const image = document.createElement("img"); image.className = "shell"; image.id = "device-shell"; image.alt = ""; image.setAttribute("aria-hidden", "true"); image.draggable = false; image.src = new URL(`assets/devices/chromatic-${color.id}.webp`, base).href; try {
        await image.decode();
        if (generation !== colorGeneration)
            return;
        element("device-shell").replaceWith(image);
        selectedColor = color;
        paint();
        try {
            localStorage.setItem(DEVICE_COLOR_KEY, color.id);
        }
        catch { /* Optional preference only. */ }
    }
    catch {
        element("view-feedback").textContent = "That color could not load. Try another color.";
    } }
    for (const color of DEVICE_COLORS)
        element(`skin-${color.id}`).addEventListener("click", () => { void chooseColor(color); });
    paint();
    try {
        const stored = DEVICE_COLORS.find(c => c.id === localStorage.getItem(DEVICE_COLOR_KEY));
        if (stored)
            void chooseColor(stored);
    }
    catch { /* Optional preference only. */ }
    element("annotate").addEventListener("click", () => { const result = requestDiagnosticAnnotation(frame, { Source: "Native Chromatic live feed", Request: "Help review this device view. Native video does not authenticate the installed ROM." }); element("view-feedback").textContent = result.accepted ? "Ready to send. Send the annotation to ask Claude about this view." : "Use the browser's annotation button to share this view with Claude."; });
    element("settings-open").addEventListener("click", () => openSettings());
    element("settings-close").addEventListener("click", () => settings.close());
    settings.addEventListener("close", () => { picker.close(); element("settings-open").focus({ preventScroll: true }); });
    for (const kind of ["connection", "recording"]) {
        const tab = element(`settings-${kind}`);
        tab.addEventListener("click", () => settingsTab(kind));
        tab.addEventListener("keydown", event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
            event.preventDefault();
            settingsTab(event.key === "Home" ? "connection" : event.key === "End" ? "recording" : kind === "connection" ? "recording" : "connection", true);
        } });
    }
    // Hiding or closing this display must not cancel a native recording.
    const pagehide = () => { pageActive = false; invalidateFrame(true); noteTrace("visibilityHidden"); publishStageTrace(); };
    const pageshow = () => { pageActive = true; noteTrace(displayActive() ? "visibilityVisible" : "visibilityHidden"); publishStageTrace(); void pollStatus(); scheduleFrame(); };
    const visibility = () => { invalidateFrame(true); noteTrace(displayActive() ? "visibilityVisible" : "visibilityHidden"); publishStageTrace(); if (displayActive()) {
        void pollStatus();
        scheduleFrame();
    } };
    window.addEventListener("pagehide", pagehide);
    window.addEventListener("pageshow", pageshow);
    document.addEventListener("visibilitychange", visibility);
    render();
    void pollStatus();
    const pollTimer = setInterval(() => { void pollStatus(); }, 500), renderTimer = setInterval(render, 250);
    return {
        canLeave: () => !blocked(),
        setVisible(value) { const changed = visible !== value; if (changed)
            invalidateFrame(true); visible = value; if (changed) {
            noteTrace(displayActive() ? "visibilityVisible" : "visibilityHidden");
            publishStageTrace();
        } if (!value) {
            errorDialog.close();
            settings.close();
            displayedError = "";
        }
        else {
            paint();
            try {
                const stored = DEVICE_COLORS.find(c => c.id === localStorage.getItem(DEVICE_COLOR_KEY));
                if (stored)
                    void chooseColor(stored);
            }
            catch { /* Optional preference only. */ }
            if (lastError)
                showError(lastError);
            void pollStatus();
            scheduleFrame();
        } },
        dispose() { disposed = true; invalidateFrame(true); finishStageTrace("disposed"); if (measurement)
            endMeasurement(measurement, "disposed"); publishMeasurement(); picker.dispose(); colorGeneration++; clearInterval(pollTimer); clearInterval(renderTimer); clearTimeout(toastTimer); window.removeEventListener("pagehide", pagehide); window.removeEventListener("pageshow", pageshow); document.removeEventListener("visibilitychange", visibility); disposeTooltips(); disposeToolbarTooltips?.(); disposeFooterTooltips?.(); toolbarScope?.replaceChildren(); footerScope?.replaceChildren(); errorDialog.dispose(); },
    };
}
//# sourceMappingURL=native-client.js.map