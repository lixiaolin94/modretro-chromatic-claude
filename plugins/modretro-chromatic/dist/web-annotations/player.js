/// <reference lib="dom" />
import { connectInputOwner } from "./input-owner.js";
import { createInputLatch, remapSelectKey } from "./input.js";
import { mountAudioControl } from "./audio.js";
import { mountRecordingControl } from "./recording.js";
import { captureSaveState, restoreSaveState, serializeSaveState } from "./save-state.js";
import { createPlayerView } from "./view.js";
import { mountFlashControl } from "./flash.js";
import { mountPreviewErrorDialog } from "./error-dialog.js";
const INPUT_METHODS = {
    up: "setJoypUp", down: "setJoypDown", left: "setJoypLeft", right: "setJoypRight",
    a: "setJoypA", b: "setJoypB", select: "setJoypSelect", start: "setJoypStart",
};
async function digest(bytes) {
    const result = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
    return Array.from(new Uint8Array(result), value => value.toString(16).padStart(2, "0")).join("");
}
/** A single local save attempt. An uncertain response never triggers an automatic retry. */
export async function savePreviewCapture(capture, generation, current) {
    if (!current() || !/^[a-f0-9]{32}$/.test(generation))
        throw new Error("The preview changed before saving. Keep the browser download.");
    const metadata = JSON.stringify(capture.metadata);
    if (new TextEncoder().encode(metadata).byteLength > 2 * 1024 * 1024)
        throw new Error("The capture metadata is too large to save.");
    const form = new FormData();
    form.set("kind", capture.kind);
    form.set("metadata", metadata);
    form.set("media", capture.media, capture.kind === "screenshot" ? "screenshot.png" : capture.media.type.startsWith("video/mp4") ? "recording.mp4" : "recording.webm");
    const response = await fetch("./codex-captures", {
        method: "POST", mode: "same-origin", redirect: "error", cache: "no-store",
        headers: { "x-codex-preview-capture": generation, ...(capture.origin ? { "x-codex-recording-view": capture.origin.viewId, "x-codex-recording-generation": String(capture.origin.generation) } : {}), ...(capture.managed ? { "x-codex-recording-id": capture.managed.id, "x-codex-recording-view": capture.managed.viewId, "x-codex-recording-generation": String(capture.managed.generation) } : {}) }, body: form,
    });
    if (!response.body)
        throw new Error("The capture save could not be confirmed. Keep the browser download.");
    const reader = response.body.getReader();
    const chunks = [];
    let size = 0;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > 16 * 1024)
                throw new Error("The capture save response was too large. Keep the browser download.");
            chunks.push(value);
        }
    }
    finally {
        await reader.cancel().catch(() => { });
        reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let at = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, at);
        at += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (!response.ok) {
        let message = text.trim();
        try {
            const error = JSON.parse(text);
            if (typeof error?.error === "string")
                message = error.error;
        }
        catch { /* Early route refusals are bounded plain text. */ }
        throw new Error(message.slice(0, 500) || "The capture save could not be confirmed. Keep the browser download.");
    }
    let result;
    try {
        result = JSON.parse(text);
    }
    catch {
        throw new Error("The capture save returned an invalid result. Keep the browser download.");
    }
    if (!result || typeof result !== "object" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(result.id) ||
        result.kind !== capture.kind || result.bytes !== capture.media.size || typeof result.path !== "string" || !result.path ||
        typeof result.metadataPath !== "string" || !result.metadataPath || !/^[a-f0-9]{64}$/.test(result.sha256) ||
        typeof result.createdAt !== "string" || !Number.isFinite(Date.parse(result.createdAt)) ||
        result.url !== `./codex-captures/${result.id}/media` || result.metadataUrl !== `./codex-captures/${result.id}/metadata`) {
        throw new Error("The capture save returned an invalid result. Keep the browser download.");
    }
    return result;
}
/** Verify the exact loaded cartridge and runtime before state or device actions. */
export async function verifyPreviewGame(player, context, current) {
    const base = new URL(".", location.href);
    const romUrl = new URL(context.romPath, base);
    if (romUrl.origin !== base.origin || !romUrl.pathname.startsWith(base.pathname))
        throw new Error("The cartridge is outside this preview.");
    const [romResponse, runtimeResponse] = await Promise.all([fetch(romUrl), fetch(new URL("js/binjgb.wasm", base))]);
    if (!romResponse.ok || !runtimeResponse.ok)
        throw new Error("The game build is unavailable. Reopen its preview.");
    const rom = new Uint8Array(await romResponse.arrayBuffer());
    const runtime = new Uint8Array(await runtimeResponse.arrayBuffer());
    if (!current())
        throw new Error("The game preview changed before its build could be verified.");
    if (!context.runtimeSha256 || player.module.codexRuntimeSha256 !== context.runtimeSha256 || await digest(runtime) !== context.runtimeSha256) {
        throw new Error("The game runtime changed. Reopen the preview before continuing.");
    }
    if (rom.length < 0x150 || rom.length > 8 * 1024 * 1024 || runtime.length > 16 * 1024 * 1024)
        throw new Error("This game build cannot use portable states.");
    const loaded = player.module.HEAPU8.subarray(player.romDataPtr, player.romDataPtr + rom.length);
    if (loaded.length !== rom.length || !loaded.every((value, index) => value === rom[index]) || await digest(rom) !== context.romSha256) {
        throw new Error("The game build changed. Reopen its preview before continuing.");
    }
    if (!current())
        throw new Error("The game preview changed before its build could be verified.");
    return { romSha256: context.romSha256, runtimeSha256: context.runtimeSha256, sourceRevision: context.sourceRevision, cartridgeType: rom[0x147] };
}
export function mountPlayerControls(canvas, original, context, isCurrent) {
    const player = original;
    let sourceMode = "emulator";
    let pausedBeforeDevice = true;
    let deviceControls;
    const view = createPlayerView(canvas, document.title.trim());
    const errorDialog = mountPreviewErrorDialog(view.root, { ...context }, releaseModalInputs);
    const restoreSelectKey = remapSelectKey(player.keyFuncs, player.setJoypSelect.bind(player));
    view.setKeyboardHints(Object.keys(player.keyFuncs));
    const audioControl = mountAudioControl(player.audio, Audio.ctx, () => vm.volume);
    const recordingControl = mountRecordingControl(canvas, () => audioControl.capture(), view.recording, {
        romSha256: context.romSha256, runtimeSha256: context.runtimeSha256, sourceRevision: context.sourceRevision,
    }, context.captures ? async (capture) => {
        const currentCapture = () => !disposed && isCurrent();
        await verifyPreviewGame(player, context, currentCapture);
        return savePreviewCapture(capture, context.captures.generation, currentCapture);
    } : undefined, view.lastCapture, releaseModalInputs, () => sourceMode === "emulator", view.notices);
    let annotations = null;
    let prepareRestart;
    let disposed = false;
    let busy = false;
    let unusable = false;
    let message = "";
    let errorMessage = "";
    let previousVolume = vm.volume > 0 ? vm.volume : 0.5;
    let identity;
    const cleanups = [];
    const timers = new Set();
    const keyboardButtons = new Map();
    const noticeKeys = new Set();
    let resumedPointer = null;
    let toolbarPointer = null;
    let lastViewState = "";
    const deviceAvailable = !!context.deviceView && context.deviceCaptureAvailability?.supported !== false;
    view.setDeviceUnavailable(deviceAvailable ? undefined : context.deviceCaptureAvailability?.reason ?? "Device capture is not available in this preview. Emulation and Install remain available.");
    const toolbarActions = new Map();
    function listen(target, name, handler, options) {
        target.addEventListener(name, handler, options);
        cleanups.push(() => target.removeEventListener(name, handler, options));
    }
    const current = () => !disposed && isCurrent();
    const flash = context.flash && /^[a-f0-9]{32}$/.test(context.flash.generation)
        ? mountFlashControl(view.root, context.flash.generation, current, async () => { await verifyPreviewGame(player, context, current); }, context.sourceRevision) : undefined;
    const latch = createInputLatch({
        ticks: () => player.ticks,
        enabled: () => sourceMode === "emulator" && current() && !busy && !unusable && !player.isPaused && !annotations?.active(),
        set(key, down) {
            if (current())
                player[INPUT_METHODS[key]](down);
            view.gameButtons.get(key)?.classList.toggle("pressed", down);
        },
    });
    const remoteInput = connectInputOwner(player.module, player.e, {
        available: () => sourceMode === "emulator" && current() && !busy && !unusable && !player.isPaused && !player.isRewinding &&
            !annotations?.active() && !document.hidden && !view.root.querySelector("dialog[open]"),
        frame: () => Math.floor(player.ticks / 70_224),
    });
    function inputReadiness() {
        const state = remoteInput?.readiness() ?? { generation: 0, ready: false, reason: "unsupported_runtime" };
        // A controller's first poll may not emit its already-held buttons. Do not
        // take ownership while any browser gamepad is connected or unreadable.
        try {
            if (typeof navigator.getGamepads === "function" && [...navigator.getGamepads()].some(pad => pad?.connected)) {
                return { ...state, ready: false, reason: "human_controller" };
            }
        }
        catch {
            return { ...state, ready: false, reason: "human_controller_unknown" };
        }
        return state;
    }
    function refresh() {
        const recordingState = recordingControl.recordingState();
        const recordingBusy = recordingState.pending || recordingState.released === false || ["recording", "stopping", "saving", "unknown"].includes(recordingState.phase);
        view.deviceMode.disabled = !deviceAvailable || busy || recordingBusy;
        view.emulationMode.disabled = busy || (sourceMode === "device" && !!deviceControls && !deviceControls.canLeave());
        // Native capture can change without changing the emulator's cached view state.
        flash?.setCaptureBusy(!!deviceControls && !deviceControls.canLeave());
        if (!current())
            return;
        if (remoteInput?.active() && (player.isPaused || player.isRewinding || document.hidden || annotations?.active()))
            remoteInput.cancel("lifecycle");
        const annotating = annotations?.active() ?? false;
        const viewState = JSON.stringify([player.isPaused, vm.volume, annotating, busy, unusable, !!annotations, message]);
        if (viewState === lastViewState)
            return;
        lastViewState = viewState;
        audioControl.setMuted(vm.volume === 0);
        view.setPaused(player.isPaused);
        view.setMuted(vm.volume === 0);
        view.setAnnotating(annotating);
        view.play.disabled = busy || unusable;
        view.sound.disabled = busy || unusable;
        view.restart.disabled = busy;
        view.history.disabled = busy || unusable || !context.playerPath;
        view.annotate.disabled = !annotations || busy || unusable;
        flash?.setPlayerUnavailable(busy || unusable);
        for (const button of view.gameButtons.values())
            button.disabled = busy || unusable || player.isPaused;
        view.show(message || (annotating ? "Esc closes annotations (again if the editor is open). Hold Space to use the controls." : ""));
    }
    function show(value) { message = value; refresh(); }
    function showError(value) {
        if (!current())
            return;
        // The bridge also uses this entry point for non-error annotation guidance.
        if (!value || value === "Finish rewinding before annotating the game.") {
            show(value);
            return;
        }
        errorMessage = value;
        const kind = unusable ? "player-restart"
            : value.startsWith("Automatic save failed") ? "automatic-save"
                : value.startsWith("Saved progress could not be reopened") ? "saved-progress"
                    : /annotation/i.test(value) ? "annotations" : "player-action";
        releaseInputs();
        show("");
        errorDialog.show(kind, value);
    }
    function clearMessage(expected) {
        if (message === expected)
            show("");
        if (errorMessage === expected) {
            errorMessage = "";
            errorDialog.close();
        }
    }
    function input(key, source, down) {
        if (down)
            latch.press(key, source);
        else
            latch.release(key, source);
    }
    function releaseInputs() {
        remoteInput?.cancel("lifecycle");
        latch.clear();
        keyboardButtons.clear();
    }
    function releaseModalInputs() {
        releaseInputs();
        // A modal captures keyup as well as keydown. Release the official player's
        // held keyboard buttons without pausing an active canvas recording.
        if (current() && !unusable)
            for (const method of Object.values(INPUT_METHODS))
                player[method](false);
    }
    function pause() {
        releaseInputs();
        player.windowBlur();
        player.cancelAnimationFrame();
        player.audio.pause();
        refresh();
    }
    async function leaveAnnotations() {
        if (annotations?.active() && !await annotations.exit()) {
            show("Close annotations with Esc, or hold Space and click a control.");
            return false;
        }
        if (!current())
            return false;
        annotations?.clear();
        return true;
    }
    async function resume() {
        if (!await leaveAnnotations() || unusable)
            return;
        releaseInputs();
        player.windowBlur();
        if (player.isPaused)
            player.resume();
        show("");
    }
    async function action(operation) {
        if (!current() || busy || toolbarPointer)
            return;
        view.rememberSourceFocus();
        busy = true;
        show("");
        try {
            await operation();
        }
        catch (error) {
            showError(error instanceof Error ? error.message : "The action could not be completed.");
        }
        finally {
            busy = false;
            refresh();
            view.restoreSourceFocus();
        }
    }
    async function stateAction(operation) {
        if (!current() || busy || toolbarPointer || unusable)
            throw new Error("The game preview is unavailable or busy.");
        busy = true;
        refresh();
        try {
            return await operation();
        }
        finally {
            busy = false;
            refresh();
        }
    }
    async function prepareState() {
        if (!current())
            throw new Error("The game preview changed before its state could be read.");
        if (player.isRewinding)
            throw new Error("Finish rewinding before saving or opening a state.");
        pause();
        identity ??= verifyPreviewGame(player, context, current).catch(error => { identity = undefined; throw error; });
        const result = await identity;
        if (!current())
            throw new Error("The game preview changed before its state could be read.");
        return result;
    }
    async function loadState(text, build) {
        const restored = await restoreSaveState(player, text, build, () => current() && player.isPaused && !player.isRewinding && !annotations?.active());
        if (!current())
            throw new Error("The game preview changed before its state could be opened.");
        if (restored.status !== "restored") {
            unusable = restored.rollback === "failed";
            const error = unusable ? "The state could not be restored safely. Restart the game before continuing." : "The state could not be opened. Your previous game state is preserved.";
            if (unusable)
                showError(error);
            throw new Error(error);
        }
        // Rewind history belongs to the prior timeline. Recreate the vendor's
        // existing helper, with the same allocation and input callback.
        try {
            player.rewind.destroy();
            player.rewind = new Rewind(player.module, player.e);
            player.lastRafSec = 0;
            player.leftoverTicks = 0;
            audioControl.resetTime();
            player.windowBlur();
            player.video.uploadTexture();
            player.video.renderTexture();
        }
        catch {
            unusable = true;
            throw new Error("The state opened, but playback could not be prepared. Restart the game before continuing.");
        }
        show("");
        return restored.file.frame;
    }
    function resumedClick(event, button) {
        const pointer = event;
        if (!resumedPointer || resumedPointer.button !== button || !event.isTrusted ||
            (typeof pointer.pointerId === "number" && pointer.pointerId !== resumedPointer.id))
            return false;
        resumedPointer = null;
        return true;
    }
    function forgetPointerAfterClick() {
        const sequence = resumedPointer;
        const timer = setTimeout(() => { if (resumedPointer === sequence)
            resumedPointer = null; timers.delete(timer); }, 0);
        timers.add(timer);
    }
    function cancelToolbarPointer() {
        toolbarPointer = null;
        resumedPointer = null;
    }
    // Native selection intercepts at Document capture. A real mouse gesture on
    // our own controls can request the public exit API at Window capture. Only
    // release over the same button commits its action; dragging away cancels it.
    // Do not cancel native events, infer targets by coordinates, or bypass a
    // rejected exit. Space-click remains the host's supported fallback.
    listen(window, "pointerdown", raw => {
        const event = raw;
        if (!event.isTrusted || !event.isPrimary || event.pointerType !== "mouse" || event.button !== 0)
            return;
        cancelToolbarPointer();
        const nativeAnnotations = annotations;
        if (!current() || !nativeAnnotations?.active() || busy)
            return;
        const button = event.composedPath().find(node => toolbarActions.has(node));
        if (!button || button.disabled)
            return;
        resumedPointer = { id: event.pointerId, button };
        // Native exit can resume the player before pointerup. Preserve the user's
        // original Resume intent instead of toggling that newly running game off.
        const operation = button === view.play || button === view.annotate ? resume : toolbarActions.get(button);
        let exit;
        try {
            exit = nativeAnnotations.exit().catch(() => false);
        }
        catch {
            exit = Promise.resolve(false);
        }
        toolbarPointer = { id: event.pointerId, button, exit, operation };
    }, true);
    listen(window, "pointerup", raw => {
        const event = raw;
        if (!event.isTrusted || !event.isPrimary || event.pointerType !== "mouse" || event.button !== 0 ||
            event.pointerId !== resumedPointer?.id)
            return;
        const sequence = toolbarPointer;
        toolbarPointer = null;
        forgetPointerAfterClick();
        if (!sequence || sequence.id !== event.pointerId || !current() || sequence.button.disabled ||
            !event.composedPath().includes(sequence.button))
            return;
        void action(async () => {
            if (!await sequence.exit) {
                show("Close annotations with Esc, or hold Space and click a control.");
                return;
            }
            if (current())
                await sequence.operation();
        });
    }, true);
    listen(window, "pointercancel", raw => {
        if (raw.pointerId !== resumedPointer?.id)
            return;
        toolbarPointer = null;
        forgetPointerAfterClick();
    }, true);
    async function togglePlay() { if (player.isPaused || annotations?.active())
        await resume();
    else
        pause(); }
    async function toggleAnnotations() {
        if (annotations?.active()) {
            await resume();
            return;
        }
        releaseInputs();
        show("");
        annotations?.start();
        refresh();
    }
    async function toggleSound() {
        if (!await leaveAnnotations())
            return;
        if (vm.volume > 0) {
            previousVolume = vm.volume;
            vm.volume = 0;
            audioControl.setMuted(true);
        }
        else {
            vm.volume = previousVolume;
            audioControl.setMuted(false);
            if (!player.isPaused)
                player.audio.resume();
        }
        refresh();
    }
    async function resetGame() {
        if (!await leaveAnnotations())
            return;
        releaseInputs();
        if (!unusable)
            vm.updateExtRam();
        if (context.playerPath === "codex-player-control") {
            if (!prepareRestart)
                throw new Error("Wait for the preview connection before restarting.");
            await prepareRestart();
            if (!current())
                throw new Error("The preview changed before restart completed.");
        }
        sessionStorage.setItem(`codex-preview-fresh:${context.romSha256}:${context.sourceRevision}`, "1");
        location.reload();
    }
    async function openHistory() {
        if (view.history.getAttribute("aria-expanded") === "true") {
            view.hideHistory();
            return;
        }
        const stillRequested = view.beginHistoryRequest();
        if (!await leaveAnnotations())
            return;
        if (!stillRequested())
            return;
        pause();
        const response = await fetch("./codex-states", { mode: "same-origin", redirect: "error", cache: "no-store" });
        if (!response.ok)
            throw new Error("Saved moments are unavailable.");
        const result = await response.json();
        if (!current() || !stillRequested())
            return;
        view.showHistory(result.states, id => {
            void action(async () => {
                if (!/^[a-f0-9]{64}$/.test(id))
                    throw new Error("Invalid saved moment.");
                const state = await fetch(`./codex-states/${id}.gbstate.json`, { mode: "same-origin", redirect: "error", cache: "no-store" });
                if (!state.ok)
                    throw new Error("This saved moment is unavailable.");
                const text = await state.text();
                const build = await prepareState();
                annotations?.clear();
                await loadState(text, build);
            });
        });
    }
    async function selectSource(mode) {
        if (mode === "device" && (!deviceAvailable || !context.deviceView))
            return;
        if (mode === sourceMode || !await leaveAnnotations())
            return;
        if (mode === "emulator") {
            if (deviceControls && !deviceControls.canLeave())
                return;
            deviceControls?.setVisible(false);
            sourceMode = mode;
            view.setSourceMode(mode);
            if (!pausedBeforeDevice)
                await resume();
            return;
        }
        const capture = recordingControl.recordingState();
        if (capture.pending || capture.released === false || ["recording", "stopping", "saving", "unknown"].includes(capture.phase))
            return;
        pausedBeforeDevice = player.isPaused;
        pause();
        sourceMode = mode;
        view.setSourceMode(mode);
        if (!deviceControls) {
            try {
                const base = new URL("./codex-device-view/", location.href);
                const module = await import(new URL("device-capture/native-client.js", base).href);
                if (!current())
                    return;
                deviceControls = module.mountNativeCapture(view.deviceView, { base, embedded: true, toolbarHost: view.deviceActions, footerHost: view.deviceFooter, onChange: refresh });
            }
            catch {
                sourceMode = "emulator";
                view.setSourceMode("emulator");
                if (!pausedBeforeDevice)
                    await resume();
                throw new Error("The device view could not open. Your game preview is still available.");
            }
        }
        deviceControls?.setVisible(true);
    }
    for (const [button, mode] of [[view.emulationMode, "emulator"], [view.deviceMode, "device"]]) {
        toolbarActions.set(button, () => selectSource(mode));
        listen(button, "click", event => { if (!resumedClick(event, button))
            void action(() => selectSource(mode)); });
    }
    for (const [button, operation] of [
        [view.play, togglePlay], [view.annotate, toggleAnnotations], [view.sound, toggleSound],
        [view.restart, resetGame], [view.history, openHistory],
        [view.moreToggle, async () => { if (await leaveAnnotations())
                view.toggleMore(); }],
    ]) {
        toolbarActions.set(button, operation);
        listen(button, "click", event => { if (!resumedClick(event, button))
            void action(operation); });
    }
    if (flash) {
        const openFlash = async () => {
            if (!await leaveAnnotations())
                return;
            pause();
            await flash.open();
        };
        toolbarActions.set(flash.button, openFlash);
        listen(flash.button, "click", event => { if (!flash.button.disabled && !resumedClick(event, flash.button))
            void action(openFlash); });
    }
    for (const [key, button] of view.gameButtons) {
        let sequence = 0;
        const pointers = new Map();
        listen(button, "pointerdown", raw => {
            const event = raw;
            if (event.button !== 0)
                return;
            event.preventDefault();
            button.focus({ preventScroll: true });
            button.setPointerCapture(event.pointerId);
            const source = `pointer-${event.pointerId}-${++sequence}`;
            pointers.set(event.pointerId, source);
            input(key, source, true);
        });
        for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
            listen(button, name, raw => {
                const id = raw.pointerId;
                const press = pointers.get(id);
                if (!press)
                    return;
                pointers.delete(id);
                latch.release(key, press, { immediate: name !== "pointerup" });
            });
        }
        listen(button, "click", raw => {
            if (raw.detail !== 0)
                return;
            input(key, "accessible-click", true);
            input(key, "accessible-click", false);
        });
    }
    const keyboard = (raw) => {
        const event = raw;
        const physicalKey = event.code || event.key;
        if (noticeKeys.has(physicalKey)) {
            if (event.type === "keyup")
                noticeKeys.delete(physicalKey);
            event.stopImmediatePropagation();
            return;
        }
        if (sourceMode === "device") {
            // Let the device's own tabs/inputs receive the event before stopping it
            // at the host below. Window capture would swallow their keyboard UI.
            if ([view.deviceView, view.deviceActions, view.deviceFooter].some(host => event.composedPath().includes(host)))
                return;
            if (Object.hasOwn(player.keyFuncs, event.key.toLowerCase()) || event.key === " ")
                event.stopImmediatePropagation();
            return;
        }
        // Revoke remote input before any focused-control handler stops propagation.
        if (event.type === "keydown")
            remoteInput?.cancel("human_input");
        const heldButton = keyboardButtons.get(physicalKey);
        if (event.type === "keyup" && heldButton) {
            keyboardButtons.delete(physicalKey);
            input(heldButton, `keyboard-${physicalKey}`, false);
            event.stopImmediatePropagation();
            event.preventDefault();
            return;
        }
        const target = event.target;
        if (event.type === "keydown" && target?.closest("#codex-player .cgv-status, #codex-player .cgv-color-feedback") &&
            (Object.hasOwn(player.keyFuncs, event.key.toLowerCase()) || event.key === " "))
            noticeKeys.add(physicalKey);
        // The host owns its Escape and Space shortcuts while selecting annotations.
        if (event.key === "Escape" || (event.key === " " && annotations?.active()))
            return;
        if (target?.closest("[data-preview-flash], [data-preview-recording], [data-preview-error]") && (Object.hasOwn(player.keyFuncs, event.key.toLowerCase()) || event.key === " ")) {
            // Preserve native select/checkbox/button defaults without game hotkeys.
            event.stopImmediatePropagation();
            return;
        }
        if (target?.closest("#codex-history-menu"))
            return;
        const button = target?.closest("#codex-player button");
        const key = button?.dataset.gameButton;
        if (key && (event.key === "Enter" || event.key === " ")) {
            event.stopImmediatePropagation();
            event.preventDefault();
            if (event.type === "keydown") {
                const pressed = heldButton ?? key;
                keyboardButtons.set(physicalKey, pressed);
                input(pressed, `keyboard-${physicalKey}`, true);
            }
        }
        else if ((button || target?.closest("#codex-player .cgv-install-slot") || target?.closest("#codex-player .cgv-device-choice")) && !key && (Object.hasOwn(player.keyFuncs, event.key.toLowerCase()) || event.key === " ")) {
            // Stop the game's global hotkeys, preserving native button activation.
            event.stopImmediatePropagation();
        }
        else if ((busy || unusable) && Object.hasOwn(player.keyFuncs, event.key.toLowerCase())) {
            event.stopImmediatePropagation();
            if (!event.metaKey && !event.ctrlKey && !event.altKey)
                event.preventDefault();
        }
    };
    listen(window, "keydown", keyboard, true);
    listen(window, "keyup", keyboard, true);
    listen(view.notices, "keydown", raw => {
        const event = raw;
        const target = event.target;
        if (target?.closest("#codex-player .cgv-status, #codex-player .cgv-color-feedback") &&
            (Object.hasOwn(player.keyFuncs, event.key.toLowerCase()) || event.key === " "))
            event.stopPropagation();
    });
    for (const host of [view.deviceView, view.deviceActions, view.deviceFooter])
        for (const type of ["keydown", "keyup"])
            listen(host, type, raw => {
                const event = raw;
                if (Object.hasOwn(player.keyFuncs, event.key.toLowerCase()) || event.key === " ")
                    event.stopPropagation();
            });
    listen(window, "blur", () => { noticeKeys.clear(); releaseInputs(); cancelToolbarPointer(); });
    listen(window, "pagehide", () => remoteInput?.cancel("closed"));
    listen(window, "pointerdown", () => remoteInput?.cancel("human_input"), true);
    listen(window, "gamepadconnected", () => remoteInput?.unknownHuman());
    listen(window, "gamepaddisconnected", () => remoteInput?.unknownHuman());
    listen(document, "visibilitychange", () => { if (document.hidden) {
        releaseInputs();
        cancelToolbarPointer();
    } });
    const poll = window.setInterval(refresh, 150);
    refresh();
    return {
        setAnnotations(value) { remoteInput?.cancel("lifecycle"); annotations = value; refresh(); }, refresh, show: showError, clearMessage,
        recordingState: () => recordingControl.recordingState(),
        recordingReply: reply => recordingControl.recordingReply(reply),
        bindRecordingView: id => recordingControl.bindView(id),
        beginRecordingRetirement: () => recordingControl.beginRetirement(),
        beforeRestart: prepare => { prepareRestart = prepare; },
        inputReadiness,
        async holdInput(command) {
            const rejected = () => ({ id: command.id, generation: command.generation, outcome: "rejected", reason: "unavailable",
                applied: false, requestedDurationMs: command.durationMs, observedHoldMs: 0,
                startFrame: Math.floor(player.ticks / 70_224), endFrame: Math.floor(player.ticks / 70_224), mcpButtonsReleased: true });
            if (!remoteInput || !inputReadiness().ready)
                return rejected();
            try {
                identity ??= verifyPreviewGame(player, context, current).catch(error => { identity = undefined; throw error; });
                await identity;
            }
            catch {
                return rejected();
            }
            if (!current() || !inputReadiness().ready)
                return rejected();
            return remoteInput.hold(command);
        },
        renewInput(id, until) { remoteInput?.renew(id, until); },
        cancelInput(reason) { remoteInput?.cancel(reason); },
        captureState() {
            return stateAction(async () => {
                const build = await prepareState();
                const state = await captureSaveState(player, build, document.title || "Game preview");
                if (!current())
                    throw new Error("The game preview changed before its state could be captured.");
                return serializeSaveState(state);
            });
        },
        async captureBackgroundState() {
            if (!current() || busy || unusable || player.isRewinding)
                throw new Error("The game is busy.");
            identity ??= verifyPreviewGame(player, context, current).catch(error => { identity = undefined; throw error; });
            const build = await identity;
            if (!current() || busy || unusable || player.isRewinding)
                throw new Error("The game is busy.");
            // captureSaveState copies native state and both framebuffers synchronously
            // before hashing. Playback continues while the detached bytes are hashed.
            const state = await captureSaveState(player, build, document.title || "Game preview");
            if (!current())
                throw new Error("The game preview changed during capture.");
            return serializeSaveState(state);
        },
        restoreState(text) {
            return stateAction(async () => {
                if (annotations?.active())
                    throw new Error("Close annotation mode before reopening a saved state.");
                const build = await prepareState();
                annotations?.clear();
                return loadState(text, build);
            });
        },
        dispose() {
            if (disposed)
                return;
            cancelToolbarPointer();
            releaseInputs();
            latch.dispose();
            remoteInput?.dispose();
            recordingControl.dispose();
            deviceControls?.dispose();
            restoreSelectKey();
            audioControl.dispose();
            flash?.dispose();
            errorDialog.dispose();
            disposed = true;
            for (const cleanup of cleanups)
                cleanup();
            for (const timer of timers)
                clearTimeout(timer);
            window.clearInterval(poll);
            view.destroy();
        },
    };
}
//# sourceMappingURL=player.js.map