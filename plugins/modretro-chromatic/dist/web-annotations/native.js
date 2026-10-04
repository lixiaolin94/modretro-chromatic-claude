/// <reference lib="dom" />
/**
 * Native annotation bridge adapted from Dominik Kundel's Chromatic simulator
 * (OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex, PR #5). The existing
 * Binjgb player owns capture, playback, and temporary color previews.
 */
import { frameTarget, metadata, toGamePoint, viewportRect, } from "./targets.js";
/** A user-clicked diagnostic handoff. Acceptance is not a chat-delivery receipt. */
export function requestDiagnosticAnnotation(element, metadata) {
    const api = element.ownerDocument.oai?.annotation;
    if (!element.isConnected || !api?.request)
        return { accepted: false, reason: "unsupported" };
    try {
        const result = api.request(element, { mode: "default", enterAnnotationMode: true, metadata });
        if (!result || typeof result.accepted !== "boolean")
            return { accepted: false, reason: "exception" };
        return result.accepted ? { accepted: true } : { accepted: false, reason: "declined" };
    }
    catch {
        return { accepted: false, reason: "exception" };
    }
}
const colorValue = /^#[\da-f]{6}$/i;
const maxSnapshotIdLength = 256;
const maxTargetIdLength = 512;
const exitTimeoutMs = 1500;
/** Optional host integration; absence or rejection never pauses the player. */
export function connectAnnotations(canvas, api, hooks) {
    let disposed = false;
    let selected = null;
    let snapshotId = null;
    let observedMode = null;
    let modeObservation = 0;
    let entryPending = false;
    let entryCancellationRequested = false;
    let pendingExit;
    const ownerDocument = canvas.ownerDocument;
    const issuedTargets = new Set();
    let surface;
    let controls;
    function isActive() {
        if (disposed)
            return null;
        let active = observedMode;
        if (api?.isActive) {
            try {
                const value = api.isActive();
                active = typeof value === "boolean" ? value : null;
            }
            catch {
                active = null;
            }
        }
        if (active === true) {
            entryPending = false;
            entryCancellationRequested = false;
            if (pendingExit)
                pendingExit.sawActive = true;
        }
        return active;
    }
    function hasPendingEntry() {
        if (disposed)
            return false;
        if (entryPending)
            isActive();
        return entryPending;
    }
    function queryConfirmsExit(waiter) {
        // A queued entry can still report the previous inactive mode. Seeing that
        // same false value after queuing its cancellation is not an exit receipt.
        return isActive() === false && (!waiter.needsActiveTransition || waiter.sawActive);
    }
    function finishExit(exited) {
        const waiter = pendingExit;
        if (!waiter)
            return;
        pendingExit = undefined;
        if (exited) {
            entryPending = false;
            entryCancellationRequested = false;
        }
        clearTimeout(waiter.timeout);
        clearInterval(waiter.poll);
        waiter.resolve(exited);
    }
    const modeHandler = (event) => {
        if (disposed || event.target !== ownerDocument)
            return;
        const detail = event.detail;
        if (!detail || typeof detail !== "object" || !("active" in detail) || typeof detail.active !== "boolean")
            return;
        const current = api?.isActive ? isActive() : null;
        if (current !== null && current !== detail.active)
            return;
        if (!detail.active && entryPending && !pendingExit && !entryCancellationRequested) {
            // An earlier inactive notification cannot cancel a newly queued entry,
            // or make the player's mode-change callback resume it prematurely.
            return;
        }
        modeObservation++;
        const changed = observedMode !== detail.active;
        observedMode = detail.active;
        if (detail.active) {
            entryPending = false;
            entryCancellationRequested = false;
            if (pendingExit)
                pendingExit.sawActive = true;
        }
        else {
            entryPending = false;
            entryCancellationRequested = false;
        }
        // Settle before notifying the player: its callback may dispose this bridge.
        if (!detail.active)
            finishExit(true);
        if (changed)
            hooks.modeChanged?.(detail.active);
    };
    async function exitSelection() {
        if (disposed)
            return false;
        if (pendingExit)
            return pendingExit.promise;
        const active = isActive();
        if (!entryPending && active === false)
            return true;
        if (!api?.toggle)
            return false;
        let resolve;
        const promise = new Promise((settle) => { resolve = settle; });
        const waiter = {
            promise, resolve, needsActiveTransition: entryPending && active !== true, sawActive: active === true,
        };
        pendingExit = waiter;
        try {
            // Keep this synchronous with the user's click. The host requires transient
            // activation; acceptance only means it queued the mode-change request.
            if (!api.toggle(false).accepted)
                finishExit(false);
            else if (entryPending)
                entryCancellationRequested = true;
        }
        catch {
            finishExit(false);
        }
        if (pendingExit !== waiter)
            return promise;
        if (queryConfirmsExit(waiter)) {
            finishExit(true);
            return promise;
        }
        waiter.timeout = setTimeout(() => {
            if (pendingExit === waiter)
                finishExit(queryConfirmsExit(waiter));
        }, exitTimeoutMs);
        if (api.isActive) {
            waiter.poll = setInterval(() => {
                if (pendingExit === waiter && queryConfirmsExit(waiter))
                    finishExit(true);
            }, 50);
        }
        return promise;
    }
    function currentSnapshot() {
        const snapshot = hooks.snapshot();
        return snapshot && snapshot.id.length > 0 && snapshot.id.length <= maxSnapshotIdLength
            ? snapshot : null;
    }
    function belongsTo(snapshot, target) {
        const prefix = `${snapshot.id}:`;
        return target.id.length > prefix.length && target.id.length <= maxTargetIdLength && target.id.startsWith(prefix);
    }
    function currentTarget(id) {
        if (!id || id.length > maxTargetIdLength || !issuedTargets.has(id))
            return undefined;
        const snapshot = currentSnapshot();
        if (!snapshot || snapshot.id !== snapshotId)
            return undefined;
        const target = hooks.target(id);
        return target?.id === id && belongsTo(snapshot, target) ? target : undefined;
    }
    function targetControls(id) {
        return (hooks.controls?.(id) ?? []).filter((control) => control.type === "color" && typeof control.callback === "string" &&
            control.callback.length > 0 && control.callback.length <= 80 &&
            typeof control.currentValue === "string" && colorValue.test(control.currentValue)).slice(0, 4).map((control) => ({ ...control }));
    }
    function refreshControls() {
        if (disposed)
            return;
        const target = currentTarget(selected);
        try {
            controls?.update({
                controls: target ? targetControls(target.id) : [],
                controlsHeading: target?.name ?? "Game preview",
            });
        }
        catch {
            // Unsupported controls do not disable read-only canvas annotations.
            try {
                controls?.dispose();
            }
            catch { /* Continue without custom controls. */ }
            controls = undefined;
        }
    }
    function clearScope() {
        selected = null;
        snapshotId = null;
        issuedTargets.clear();
        refreshControls();
        hooks.select(null, null);
    }
    function bindSnapshot(snapshot) {
        if (snapshotId !== snapshot.id) {
            clearScope();
            snapshotId = snapshot.id;
        }
    }
    const options = {
        element: canvas,
        hitTest({ clientX, clientY, signal }) {
            if (disposed || signal?.aborted)
                return null;
            const bounds = hooks.viewport?.() ?? canvas.getBoundingClientRect();
            const point = toGamePoint(bounds, clientX, clientY);
            if (!point)
                return null;
            hooks.freeze();
            const snapshot = currentSnapshot();
            if (!snapshot || signal?.aborted)
                return null;
            bindSnapshot(snapshot);
            const target = hooks.targetAt(point.x, point.y);
            if (!target || !belongsTo(snapshot, target) || hooks.target(target.id)?.id !== target.id)
                return null;
            issuedTargets.add(target.id);
            return {
                id: target.id,
                name: target.name,
                role: `game-${target.kind}`,
                metadata: metadata(snapshot, target),
                rect: viewportRect(target.rect, bounds),
            };
        },
        renderSelection({ selectedId, hoveredId }) {
            if (disposed)
                return;
            const next = currentTarget(selectedId)?.id ?? null;
            if (selected !== next) {
                selected = next;
                refreshControls();
            }
            hooks.select(next, currentTarget(hoveredId)?.id ?? null);
        },
    };
    const handler = (event) => {
        if (disposed || !controls || event.target !== canvas)
            return;
        const detail = event.detail;
        if (!detail || typeof detail !== "object")
            return;
        const value = detail;
        if (value.action !== "preview" && value.action !== "preview-original" && value.action !== "reset")
            return;
        if (typeof value.callback !== "string" || typeof value.value !== "string" || !colorValue.test(value.value))
            return;
        const scope = value.virtualTarget;
        if (!scope || typeof scope.targetId !== "string" || typeof scope.surfaceId !== "string" ||
            !scope.surfaceId || scope.surfaceId.length > maxTargetIdLength)
            return;
        const target = currentTarget(scope.targetId);
        if (!target || !targetControls(target.id).some((control) => control.callback === value.callback))
            return;
        hooks.control({
            action: value.action,
            callback: value.callback,
            value: value.value,
            virtualTarget: { surfaceId: scope.surfaceId, targetId: scope.targetId },
        });
    };
    function disposeHandles() {
        try {
            surface?.dispose();
        }
        catch { /* Host failure must not prevent other cleanup. */ }
        try {
            controls?.dispose();
        }
        catch { /* Ordinary preview remains usable. */ }
        surface = undefined;
        controls = undefined;
    }
    function invalidate() {
        if (disposed)
            return;
        try {
            surface?.invalidate();
        }
        catch { /* A detached host must not interrupt playback. */ }
    }
    if (api?.registerSurface) {
        try {
            controls = api.registerControls?.({
                targets: canvas, controls: [], controlsHeading: "Game preview", controlsMode: "replace",
            });
            surface = api.registerSurface(options);
            canvas.addEventListener("oaiannotationcontrolchange", handler);
        }
        catch {
            disposed = true;
            disposeHandles();
        }
    }
    if (!disposed)
        ownerDocument?.addEventListener("oaiannotationmodechange", modeHandler);
    return {
        get available() { return !disposed && !!surface; },
        options,
        isActive,
        hasPendingEntry,
        exitSelection,
        startSelection() {
            if (disposed || !surface)
                return { accepted: false, reason: "unsupported" };
            const previousObservation = modeObservation;
            const previouslyPending = entryPending;
            const previousCancellation = entryCancellationRequested;
            entryPending = true;
            entryCancellationRequested = false;
            let result;
            try {
                if (api?.toggle) {
                    result = api.toggle(true);
                }
                else if (api?.request) {
                    // A live player may have no capture yet. Do not pause, clear an
                    // existing selection, or fabricate capture metadata before acceptance.
                    const snapshot = currentSnapshot();
                    result = api.request(canvas, {
                        mode: "default", enterAnnotationMode: true,
                        metadata: snapshot ? metadata(snapshot, frameTarget(snapshot)) : {},
                    });
                }
                else {
                    entryPending = previouslyPending;
                    entryCancellationRequested = previousCancellation;
                    return { accepted: false, reason: "unsupported" };
                }
                if (!result || typeof result.accepted !== "boolean")
                    throw new TypeError("Invalid annotation entry response.");
            }
            catch {
                entryPending &&= previouslyPending;
                entryCancellationRequested = entryPending && previousCancellation;
                return { accepted: false, reason: "exception" };
            }
            if (result.accepted === true) {
                finishExit(false);
                if (modeObservation === previousObservation && observedMode !== true)
                    observedMode = null;
                isActive();
                clearScope();
                hooks.freeze();
                const snapshot = currentSnapshot();
                if (snapshot)
                    snapshotId = snapshot.id;
                return { accepted: true };
            }
            entryPending &&= previouslyPending;
            entryCancellationRequested = entryPending && previousCancellation;
            return { accepted: false, reason: "declined" };
        },
        invalidate,
        refreshControls,
        clear() {
            if (disposed)
                return;
            clearScope();
            invalidate();
        },
        dispose() {
            if (disposed)
                return;
            disposed = true;
            entryPending = false;
            entryCancellationRequested = false;
            selected = null;
            snapshotId = null;
            issuedTargets.clear();
            finishExit(false);
            ownerDocument?.removeEventListener("oaiannotationmodechange", modeHandler);
            canvas.removeEventListener("oaiannotationcontrolchange", handler);
            disposeHandles();
        },
    };
}
//# sourceMappingURL=native.js.map