/// <reference lib="dom" />
import { copyFlashFailureDetails } from "./flash-diagnostics.js";
import { DIALOG_STYLES } from "./view.js";
class DeviceRequestRejected extends Error {
}
class PreviewConnectionError extends Error {
}
const journalAccessMessage = "Installation history is unavailable. Open Setup for help.";
class JournalAccessError extends Error {
    constructor() { super(journalAccessMessage); }
}
/** Only diagnostic identifiers and measured boundaries enter the copied report. */
function errorReport(snapshot, readFailed, sourceRevision, statusErrorCode, pending) {
    // A lost reply may leave a snapshot of a different operation. Never attach its
    // closure or ROM to the new pending request.
    const rejectedBeforeDispatch = statusErrorCode === "PREVIEW_STORAGE_UNAVAILABLE" || statusErrorCode === "PREVIEW_REQUEST_REJECTED";
    const latestOperation = !rejectedBeforeDispatch && (!pending || snapshot?.operation?.requestId === pending.requestId) ? snapshot?.operation : undefined;
    // Match the displayed error's precedence. A current discovery failure must
    // not inherit a previous flash's identity, closure evidence, or ROM.
    const discovery = !rejectedBeforeDispatch && !pending && !!snapshot?.discoveryError && latestOperation?.state !== "running"
        && latestOperation?.state !== "unresolved" && latestOperation?.cartridgeWrite !== "outcome-unverified";
    const operation = discovery ? snapshot?.discoveryError?.operation : latestOperation;
    // A disconnected preview is not evidence of a device operation. Preserve
    // operation recovery whenever a request, recorded operation or uncertainty exists.
    const previewConnection = statusErrorCode === "PREVIEW_CONNECTION_LOST" && !pending && !snapshot?.operation
        && !snapshot?.discoveryError?.operation && !snapshot?.blocked && !snapshot?.requestedOperationUnknown;
    const code = (value) => typeof value === "string" && /^[a-zA-Z0-9_.:-]{1,128}$/u.test(value) ? value : undefined;
    const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/u.test(value) ? value : undefined;
    const object = (value) => !!value && typeof value === "object" && !Array.isArray(value);
    const boundary = (value) => object(value) ? {
        ...(value.code === null || Number.isInteger(value.code) ? { code: value.code } : {}),
        ...(value.signal === null || code(value.signal) ? { signal: value.signal } : {}),
    } : undefined;
    const commands = (Array.isArray(operation?.diagnostics?.commands) ? operation.diagnostics.commands : []).slice(0, 16).filter(object).map(command => {
        const failureDetails = copyFlashFailureDetails(command.failureDetails);
        return {
            command: code(command.command), vendorCliVersion: code(command.version), target: code(command.target),
            ...(Number.isInteger(command.pid) ? { pid: command.pid } : {}),
            exit: boundary(command.exit), close: boundary(command.close), vendorCode: code(command.vendorCode),
            ...(typeof command.outputComplete === "boolean" ? { outputComplete: command.outputComplete } : {}),
            ...(failureDetails ? { failureDetails } : {}),
        };
    });
    return {
        schemaVersion: 1, source: "modretro-chromatic", statusReadFailed: readFailed && !rejectedBeforeDispatch && statusErrorCode !== "PREVIEW_RECOVERY_UNAVAILABLE", statusErrorCode: code(statusErrorCode),
        subject: previewConnection ? "preview-connection" : rejectedBeforeDispatch ? "request-not-dispatched" : discovery ? "discovery" : "operation",
        operationId: code(operation?.operationId), requestId: code(pending?.requestId ?? (!discovery ? latestOperation?.requestId : undefined)),
        requestScope: discovery || previewConnection ? undefined : "preview",
        command: code(operation?.command) ?? (pending ? pending.action === "flash" ? "flash" : "list_devices" : undefined),
        recordedState: code(operation?.state), stage: code(operation?.stage),
        errorCode: code(discovery ? snapshot?.discoveryError?.code : latestOperation?.error?.code),
        processCompletion: previewConnection ? undefined : rejectedBeforeDispatch ? "not-started" : code(operation?.diagnostics?.processCompletion) ?? "unconfirmed",
        cartridgeWrite: previewConnection ? undefined : rejectedBeforeDispatch ? "not-dispatched" : code(operation?.cartridgeWrite) ?? "unknown",
        rom: { sha256: discovery ? undefined : hash(latestOperation?.romSha256) },
        currentPreview: { sha256: hash(snapshot?.rom.sha256),
            ...(Number.isSafeInteger(snapshot?.rom.sizeBytes) ? { sizeBytes: snapshot.rom.sizeBytes } : {}),
            sourceRevision: typeof sourceRevision === "string" && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(sourceRevision) ? sourceRevision : undefined },
        commands,
    };
}
/** One visible-preview device observer and install/recovery controller, shared by both views. */
export function mountFlashControl(root, generation, current, verifyGame, sourceRevision) {
    const doc = root.ownerDocument;
    const node = (tag, text) => {
        const value = doc.createElement(tag);
        if (text)
            value.textContent = text;
        return value;
    };
    const button = node("button");
    const buttonLabel = node("span", "Install on Chromatic");
    button.type = "button";
    button.className = "cgv-install-button";
    button.disabled = true;
    button.dataset.action = "flash-to-device";
    button.setAttribute("aria-haspopup", "dialog");
    const icon = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.setAttribute("aria-hidden", "true");
    const iconPath = doc.createElementNS("http://www.w3.org/2000/svg", "path");
    const plugIcon = "M9 3v5m6-5v5M6 8h12M7 8v4a5 5 0 0 0 10 0V8m-5 9v4";
    const downloadIcon = "M12 3v12m-4-4 4 4 4-4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3";
    iconPath.setAttribute("d", plugIcon);
    icon.append(iconPath);
    button.append(icon, buttonLabel);
    const dialog = node("dialog");
    dialog.className = "cgv-dialog cgv-flash";
    dialog.dataset.previewFlash = "true";
    dialog.setAttribute("aria-labelledby", "cgv-flash-heading");
    dialog.setAttribute("aria-describedby", "cgv-flash-game");
    const heading = node("h2", "Install on Chromatic");
    heading.id = "cgv-flash-heading";
    heading.tabIndex = -1;
    const game = node("p", doc.title || "Current game");
    game.id = "cgv-flash-game";
    game.className = "cgv-flash-game";
    const select = node("select");
    select.id = "cgv-flash-device";
    select.setAttribute("aria-label", "Device");
    const picker = node("div");
    picker.className = "cgv-flash-picker";
    const deviceLabel = node("label", "Device");
    deviceLabel.htmlFor = select.id;
    const singleDevice = node("div");
    singleDevice.id = "cgv-flash-single-device";
    singleDevice.className = "cgv-flash-single-device";
    singleDevice.hidden = true;
    picker.append(deviceLabel, select, singleDevice);
    const warning = node("p", "This erases the cartridge’s current game, may erase saved progress, and makes no backup.");
    warning.id = "cgv-flash-warning";
    warning.className = "cgv-flash-warning";
    const review = node("button", "Install");
    review.type = "button";
    review.dataset.action = "review-install";
    const write = node("button", "Confirm Install");
    write.type = "button";
    write.dataset.action = "flash-game";
    const check = node("button", "Check status");
    check.type = "button";
    check.dataset.action = "flash-status";
    review.dataset.tooltip = "Review installation";
    write.dataset.tooltip = "Confirm installation on the selected cartridge";
    check.dataset.tooltip = "Check the original device operation";
    const close = node("button", "Close");
    close.type = "button";
    close.dataset.action = "close-flash";
    const actions = node("div");
    actions.className = "cgv-dialog-actions cgv-flash-actions";
    const newInstall = node("button", "Dismiss");
    newInstall.type = "button";
    newInstall.dataset.action = "dismiss-failure";
    newInstall.hidden = true;
    const progress = node("progress");
    progress.id = "cgv-flash-progress";
    progress.setAttribute("aria-label", "Device operation in progress");
    progress.hidden = true;
    const progressTrack = node("div");
    progressTrack.className = "cgv-flash-progress-track";
    progressTrack.hidden = true;
    progressTrack.append(progress);
    const progressNote = node("p", "Keep your Chromatic connected.");
    progressNote.id = "cgv-flash-progress-note";
    progressNote.className = "cgv-flash-progress-note";
    progressNote.hidden = true;
    const status = node("p");
    status.id = "cgv-flash-status";
    status.className = "cgv-flash-status cgv-dialog-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");
    status.hidden = true;
    const discoveryNotices = node("p");
    discoveryNotices.id = "cgv-flash-discovery-notices";
    discoveryNotices.className = "cgv-flash-status";
    discoveryNotices.setAttribute("role", "status");
    discoveryNotices.setAttribute("aria-live", "polite");
    discoveryNotices.hidden = true;
    const diagnosticText = node("pre");
    diagnosticText.id = "cgv-flash-diagnostic-text";
    diagnosticText.hidden = true;
    const copy = node("button", "Copy error");
    copy.type = "button";
    copy.dataset.action = "copy-error-diagnostics";
    actions.append(copy, close, check, newInstall, review, write);
    const handoff = node("p");
    handoff.id = "cgv-flash-handoff";
    handoff.className = "cgv-flash-reference";
    handoff.setAttribute("aria-live", "polite");
    handoff.hidden = true;
    const firmwareHelp = node("a", "Get ModRetro Updater");
    firmwareHelp.id = "cgv-firmware-help";
    firmwareHelp.setAttribute("href", "https://support.modretro.com/en_us/articles/chromatic-firmware-updater-ryhoYnzCx");
    firmwareHelp.setAttribute("target", "_blank");
    firmwareHelp.setAttribute("rel", "noopener noreferrer");
    firmwareHelp.className = "cgv-flash-reference";
    firmwareHelp.hidden = true;
    const content = node("div");
    content.className = "cgv-flash-content";
    content.append(game, picker, discoveryNotices, warning, status, progressTrack, progressNote, handoff, diagnosticText, firmwareHelp);
    dialog.append(heading, content, actions);
    const style = node("style");
    style.textContent = DIALOG_STYLES + `
.codex-game-view .cgv-install-button { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; max-width: 100%; min-height: 44px; margin: 0; padding: 8px 10px; border: 0; border-radius: 8px; background: var(--cgv-ink); color: var(--cgv-background); font: inherit; font-size: 12px; line-height: 18px; font-weight: 550; white-space: nowrap; }
.codex-game-view .cgv-install-button span { overflow: hidden; text-overflow: ellipsis; }
.codex-game-view .cgv-install-button[hidden] { display: none; }
.cgv-flash-reference { color: #75757b; overflow-wrap: anywhere; white-space: pre-wrap; font-size: 12px; line-height: 18px; }
.cgv-flash a { width: fit-content; text-underline-offset: 3px; }
.cgv-flash #cgv-firmware-help { display: inline-flex; align-items: center; min-height: 36px; box-sizing: border-box; padding: 6px 10px; border-radius: 8px; background: #f1f1f3; color: #27272b; font-size: 13px; font-weight: 550; }
.codex-game-view .cgv-install-button:hover:not(:disabled) { filter: brightness(.92); }
.codex-game-view .cgv-install-button:disabled { opacity: 1; background: color-mix(in srgb, var(--cgv-ink) 12%, var(--cgv-background)); color: color-mix(in srgb, var(--cgv-ink) 60%, var(--cgv-background)); cursor: default; pointer-events: none; }
.codex-game-view .cgv-install-note { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.cgv-dialog.cgv-flash { height: min(340px, calc(100svh - 32px)); overflow: hidden; }
.cgv-dialog.cgv-flash[data-state="error"] { height: min(340px, calc(100svh - 32px)); }
.cgv-dialog.cgv-flash[open] { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 14px; }
.cgv-flash-content { min-height: 0; overflow: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 12px; padding: 6px; margin: -6px; }
.cgv-flash .cgv-flash-game { color: #75757b; font-size: 13px; line-height: 20px; }
.cgv-flash .cgv-flash-warning { padding: 12px; border-radius: 10px; background: #faf6f4; color: #813d25; font-size: 14px; line-height: 21px; text-wrap: pretty; }
.cgv-flash-picker { display: flex; flex-direction: column; gap: 6px; }
.cgv-flash-picker label { color: #49494f; font-size: 12px; line-height: 18px; font-weight: 600; }
.cgv-dialog .cgv-flash-actions { gap: 4px; }
.cgv-dialog .cgv-flash-actions button { padding-inline: 6px; }
.cgv-flash-actions [data-action="copy-error-diagnostics"] { margin-right: auto; font-size: 12px; }
.cgv-flash select { width: 100%; margin: 0; }
.cgv-flash select[data-empty="true"] { color: #75757b; }
.cgv-flash-single-device { box-sizing: border-box; display: flex; align-items: center; min-height: 40px; padding: 8px 12px; border: 1px solid #dedee1; border-radius: 8px; background: #f8f8f9; color: #27272b; font-size: 13px; line-height: 20px; }
.cgv-flash .cgv-flash-status { color: #626268; font-size: 14px; line-height: 21px; white-space: pre-line; overflow-wrap: anywhere; }
.cgv-flash[data-state="error"] .cgv-dialog-status { border-color: #e5d8d2; background: #faf6f4; color: #813d25; }
.cgv-flash[data-state="running"] .cgv-flash-content, .cgv-flash[data-state="success"] .cgv-flash-content, .cgv-flash[data-state="error"] .cgv-flash-content { justify-content: safe center; }
.cgv-flash[data-state="running"] .cgv-dialog-status { padding: 0; border: 0; background: transparent; color: #27272b; font-size: 15px; font-weight: 600; }
.cgv-flash[data-state="success"] .cgv-dialog-status { display: flex; align-items: flex-start; gap: 10px; border-color: #cce4d2; background: #f1faf3; color: #28633b; }
.cgv-flash[data-state="success"] .cgv-dialog-status::before { content: ""; flex: none; width: 21px; height: 21px; border-radius: 50%; background: #d5efdb url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2328633b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m5 12 4 4L19 6'/%3E%3C/svg%3E") center/13px no-repeat; }
.cgv-flash[data-state="success"] .cgv-flash-actions [data-action="close-flash"][data-primary="true"] { background: #2c7042; color: #fff; }
.cgv-flash[data-state="success"] .cgv-flash-actions [data-action="close-flash"][data-primary="true"]:hover { background: #245c36; }
.cgv-flash-progress-track { position: relative; height: 6px; overflow: hidden; border-radius: 999px; background: #e1eee5; }
.cgv-flash-progress-track::after { content: ""; position: absolute; inset: 0 auto 0 0; width: 38%; border-radius: inherit; background: #398455; animation: cgv-flash-progress 1.5s ease-in-out infinite; }
.cgv-flash-progress-track progress { position: absolute; width: 1px; height: 1px; margin: 0; opacity: 0; }
@keyframes cgv-flash-progress { from { transform: translateX(-100%); } to { transform: translateX(263%); } }
@media(prefers-reduced-motion:reduce) { .cgv-flash-progress-track::after { animation: none; transform: translateX(80%); } }
.cgv-flash .cgv-flash-progress-note { color: #75757b; font-size: 12px; line-height: 18px; }
@media(max-height:320px) {
  .cgv-dialog.cgv-flash[open] { display: flex; overflow: auto; gap: 12px; padding: 12px; }
  .cgv-flash-content { flex: none; overflow: visible; padding: 0; margin: 0; }
  .cgv-flash-actions { flex: none; margin-top: auto; }
}

`;
    const permissionNote = node("p", journalAccessMessage);
    permissionNote.className = "cgv-install-note";
    permissionNote.id = "cgv-install-permission";
    permissionNote.hidden = true;
    permissionNote.setAttribute("role", "status");
    const installSlot = root.querySelector(".cgv-install-slot");
    installSlot.setAttribute("role", "group");
    installSlot.append(button);
    root.append(style, dialog, permissionNote);
    const storageKey = `codex-preview-flash:${location.pathname}`;
    let disposed = false;
    let busy = false;
    let submittingFlash = false;
    let refreshOnOpen = false;
    let recoveryUnavailable = false;
    let unknown = false;
    let readFailed = false;
    let connectionLost = false;
    let accessDenied = false;
    let playerUnavailable = false;
    let captureBusy = false;
    let confirming = false;
    let dismissedSuccess;
    let snapshot;
    let statusErrorCode;
    let handoffRevision = 0;
    let devicesKey = "";
    let manualDevice = "";
    let pending;
    let timer;
    let connectionTimer;
    try {
        const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
        if (saved && typeof saved.requestId === "string" && (saved.action === "discover" || saved.action === "flash"))
            pending = saved;
    }
    catch {
        recoveryUnavailable = true;
    }
    function say(message) {
        if (status.textContent !== message)
            status.textContent = message;
    }
    function reviewedOperation(reply = snapshot) {
        const review = reply?.newInstallReview;
        const operation = reply?.operation;
        return !!review && !!operation && review.operationId === operation.operationId && review.requestId === operation.requestId
            && (!pending || pending.action === "flash" && pending.requestId === operation.requestId)
            && review.generation === generation && operation.generation === generation
            && review.romSha256 === reply.rom.sha256 && operation.romSha256 === reply.rom.sha256;
    }
    function controls() {
        const freshDevices = snapshot?.available && !snapshot.blocked && !snapshot.discoveryError && !accessDenied
            ? snapshot.devices.filter(device => Date.parse(device.expiresAt) > Date.now()) : [];
        if (!freshDevices.some(device => device.token === select.value)) {
            const previous = select.value;
            select.value = freshDevices.length === 1 ? freshDevices[0].token : "";
            if (select.value !== previous)
                confirming = false;
        }
        const reviewed = reviewedOperation();
        const report = errorReport(snapshot, readFailed, sourceRevision, statusErrorCode, pending);
        const previewConnection = report.subject === "preview-connection";
        const installing = submittingFlash || snapshot?.operation?.command === "flash" && snapshot.operation.state === "running";
        const discovering = !snapshot || snapshot?.detecting || snapshot?.operation?.command === "list_devices" && snapshot.operation.state === "running";
        const successful = snapshot?.operation?.command === "flash" && snapshot.operation.state === "succeeded"
            && snapshot.operation.cartridgeWrite === "vendor-reported-success";
        const completed = !!snapshot && successful && snapshot.operation.generation === generation
            && snapshot.operation.romSha256 === snapshot.rom.sha256
            && snapshot.operation.operationId !== dismissedSuccess;
        const needsAttention = !reviewed && (pending?.action === "flash" || snapshot?.operation?.command === "flash" &&
            (snapshot.operation.state === "unresolved" || snapshot.operation.cartridgeWrite === "outcome-unverified"));
        // A setup failure is not a connected device. Keep existing operation
        // recovery reachable even when its journal can no longer be accessed.
        const setupRequired = accessDenied && !pending && !unknown && snapshot?.operation?.command !== "flash"
            && !(snapshot?.blocked && !discovering);
        // A retained background scan can predate the current write. The write's
        // live status takes precedence until it settles.
        const discoveryFailed = !!snapshot?.discoveryError && !installing;
        const diagnostics = discoveryFailed || !!snapshot?.discoveryNotices?.length || readFailed || !!snapshot && (!snapshot.available || snapshot.blocked && !discovering);
        const recovery = !setupRequired && !installing && (!!needsAttention || unknown || readFailed || !!snapshot?.blocked && !discovering);
        const settledFailure = !reviewed && !readFailed && !unknown && snapshot?.operation?.state === "failed" && snapshot.operation.diagnostics?.processCompletion === "closed";
        const activationRequired = settledFailure && snapshot?.operation?.diagnostics?.commands.some(command => !!command && typeof command === "object" && command.vendorCode === "feature.developer_mode_required");
        newInstall.textContent = reviewed ? "Choose device" : activationRequired ? "Check again" : "Dismiss";
        newInstall.hidden = readFailed || (reviewed ? !!snapshot?.devices.length : !settledFailure || !snapshot?.dismissalAvailable);
        newInstall.disabled = busy || captureBusy;
        const selecting = !setupRequired && !confirming && !installing && !completed && !recovery;
        const reviewing = !setupRequired && confirming && !installing && !completed && !recovery;
        const retainedInstall = installing || completed || settledFailure || needsAttention || unknown || !!pending;
        const detected = snapshot?.available && snapshot.devices.some(device => Date.parse(device.expiresAt) > Date.now());
        const canOpen = reviewed || setupRequired || retainedInstall || recovery || diagnostics || detected;
        button.disabled = playerUnavailable || !canOpen || captureBusy && !retainedInstall;
        iconPath.setAttribute("d", button.disabled ? plugIcon : downloadIcon);
        const description = setupRequired ? "Chromatic installation unavailable" : connectionLost ? "Preview connection lost" : installing ? "Installing on Chromatic…" : completed ? "Game installed" : settledFailure ? "Review installation failure" : unknown ? "Check device status" : captureBusy ? "Finish device capture to install" : diagnostics ? "Check device connection"
            : canOpen ? "Install on Chromatic" : discovering ? "Looking for your Chromatic…" : "Connect your Chromatic to install";
        buttonLabel.textContent = setupRequired ? "Setup" : connectionLost ? "Retry" : installing ? submittingFlash && snapshot?.operation?.state !== "running" ? "Preparing…" : "Writing…" : completed ? "Done" : settledFailure ? "Review" : unknown ? "Status" : captureBusy ? "Busy" : diagnostics ? "Check" : discovering && !canOpen ? "Finding Chromatic…" : "Install on Chromatic";
        button.dataset.tooltip = description;
        button.setAttribute("aria-label", buttonLabel.textContent === description ? description : `${buttonLabel.textContent}: ${description}`);
        // Disabled buttons cannot receive keyboard focus or our control tooltip.
        // Keep their explanation discoverable without enabling the install action.
        installSlot.tabIndex = button.disabled ? 0 : -1;
        if (button.disabled) {
            installSlot.dataset.tooltip = description;
            installSlot.setAttribute("aria-label", description);
        }
        else {
            delete installSlot.dataset.tooltip;
            installSlot.removeAttribute("aria-label");
        }
        permissionNote.hidden = !setupRequired;
        if (setupRequired)
            button.setAttribute("aria-describedby", permissionNote.id);
        else
            button.removeAttribute("aria-describedby");
        close.dataset.tooltip = completed ? "Done" : "Close device panel";
        const blocked = busy || captureBusy || unknown || readFailed || !snapshot || snapshot.blocked || !snapshot.available || !!snapshot.discoveryError;
        select.disabled = blocked || !freshDevices.length;
        select.dataset.empty = String(!select.value);
        select.hidden = freshDevices.length === 1;
        singleDevice.hidden = freshDevices.length !== 1;
        const singleLabel = freshDevices.length === 1 ? freshDevices[0].label : "";
        if (singleDevice.textContent !== singleLabel)
            singleDevice.textContent = singleLabel;
        review.disabled = write.disabled = blocked || !select.value;
        check.disabled = busy;
        // An in-flight write is necessarily unverified; only a settled or
        // unresolved outcome is an error, unless the status read itself failed.
        const errorVisible = readFailed || unknown || snapshot?.available === false || discoveryFailed || !reviewed &&
            (snapshot?.operation?.state === "failed" || snapshot?.operation?.state === "unresolved" ||
                snapshot?.operation?.state !== "running" && snapshot?.operation?.cartridgeWrite === "outcome-unverified");
        dialog.setAttribute("role", errorVisible ? "alertdialog" : "dialog");
        dialog.dataset.state = errorVisible ? "error" : completed ? "success" : installing ? "running" : "ready";
        progress.hidden = !installing || errorVisible;
        progressTrack.hidden = progress.hidden;
        progressNote.hidden = progress.hidden;
        discoveryNotices.hidden = installing || !snapshot?.discoveryNotices?.length;
        copy.hidden = !errorVisible;
        firmwareHelp.hidden = !activationRequired;
        const reportText = JSON.stringify(report, null, 2);
        if (diagnosticText.textContent !== (errorVisible ? reportText : "")) {
            handoffRevision++;
            handoff.textContent = "";
            handoff.hidden = true;
            diagnosticText.textContent = errorVisible ? reportText : "";
            diagnosticText.hidden = true;
        }
        check.textContent = previewConnection ? "Retry connection" : settledFailure ? "Refresh status" : "Check status";
        check.dataset.tooltip = previewConnection ? "Try reconnecting to this preview server"
            : settledFailure ? "Read this operation's recorded result again" : "Check the original device operation";
        picker.hidden = !selecting;
        game.hidden = !selecting;
        warning.hidden = !reviewing;
        review.hidden = !selecting;
        write.hidden = !reviewing;
        check.hidden = setupRequired || settledFailure && !discoveryFailed || !recovery && !discoveryFailed && !(installing && (readFailed || unknown));
        if (!discoveryFailed && (reviewing || selecting && successful || discovering && !readFailed && !unknown || !readFailed && !unknown && !snapshot?.blocked
            && snapshot?.operation?.command === "list_devices" && snapshot.operation.state === "succeeded" && snapshot.devices.length))
            status.hidden = true;
        heading.textContent = previewConnection ? "Game preview disconnected" : setupRequired ? "Chromatic installation unavailable" : installing && !errorVisible ? "Installing on Chromatic"
            : settledFailure ? activationRequired ? "Set up your Chromatic" : "Installation failed"
                : recovery || installing && errorVisible ? "Installation status" : discoveryFailed ? "Could not find your Chromatic"
                    : completed ? "Game installed" : reviewing ? "Confirm install" : "Install on Chromatic";
        dialog.setAttribute("aria-describedby", errorVisible ? status.id : selecting ? game.id : reviewing ? warning.id : status.id);
        close.textContent = completed ? "Done" : setupRequired || installing || recovery ? "Close" : "Cancel";
        close.hidden = settledFailure && !reviewed && !newInstall.hidden;
        const primary = setupRequired || completed ? close : settledFailure ? !newInstall.hidden ? newInstall : close
            : recovery || readFailed || unknown || discoveryFailed ? check : installing ? undefined
                : reviewing ? write : review;
        for (const action of [review, write, check, close, newInstall])
            action.dataset.primary = String(action === primary);
    }
    function remember(value) {
        if (value)
            sessionStorage.setItem(storageKey, JSON.stringify(value));
        else
            sessionStorage.removeItem(storageKey);
        pending = value;
    }
    async function request(payload) {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
            let response;
            let text;
            try {
                response = await fetch("./codex-device", {
                    method: "POST", mode: "same-origin", redirect: "error", cache: "no-store", signal: controller.signal,
                    headers: { "Content-Type": "application/json", "X-Codex-Preview-Device": "1" },
                    body: JSON.stringify({ ...payload, generation }),
                });
                text = await response.text();
            }
            catch {
                throw new PreviewConnectionError("Cannot reach the local preview server. Reopen the game preview to reconnect. This does not indicate that a Chromatic is connected.");
            }
            if (text.length > 65536)
                throw new Error("Device status was too large. Check the original operation in the plugin.");
            const reply = JSON.parse(text);
            if (!response.ok) {
                if (reply.code === "CHROMATIC_JOURNAL_ACCESS_DENIED")
                    throw new JournalAccessError();
                const message = reply.error || "The preview changed or device request was refused.";
                if (reply.admitted === false && (payload.action === "discover" || payload.action === "flash"))
                    throw new DeviceRequestRejected(message);
                throw new Error(message);
            }
            if (reply.generation !== generation || !Array.isArray(reply.devices))
                throw new Error("The device status belongs to a different preview.");
            return reply;
        }
        finally {
            clearTimeout(timeout);
        }
    }
    function render(reply) {
        snapshot = reply;
        discoveryNotices.textContent = reply.discoveryNotices?.some(item => item.code === "CHROMATIC_PLAYER_AMBIGUOUS") ? "Two Chromatics use the same player number. Choose different player numbers on the devices, then reconnect them." : reply.discoveryNotices?.length ? "Some devices could not be identified. Check their USB connections, or copy the error for help." : "";
        discoveryNotices.hidden = !reply.discoveryNotices?.length;
        statusErrorCode = undefined;
        readFailed = false;
        connectionLost = false;
        accessDenied = false;
        unknown = reply.requestedOperationUnknown === true;
        const key = JSON.stringify(reply.devices);
        if (key !== devicesKey) {
            devicesKey = key;
            const previous = select.value;
            const fresh = reply.devices.filter(device => Date.parse(device.expiresAt) > Date.now());
            const placeholder = node("option", fresh.length ? "Choose a device" : "No devices found");
            placeholder.value = "";
            select.replaceChildren(placeholder);
            for (const device of fresh) {
                const option = node("option", device.label);
                option.value = device.token;
                select.append(option);
            }
            select.value = fresh.some(device => device.token === manualDevice) ? manualDevice : fresh.length === 1 ? fresh[0].token : "";
            if (!fresh.some(device => device.token === manualDevice))
                manualDevice = "";
            if (select.value !== previous)
                confirming = false;
            if (reply.devices.length > 1)
                queueMicrotask(() => {
                    if (dialog.open && !disposed && current() && !select.hidden && !select.disabled && doc.activeElement === heading)
                        select.focus();
                });
        }
        const operation = reply.operation;
        status.hidden = !operation && !unknown && !reply.discoveryError && reply.available && !reply.blocked;
        const previousBuild = !!operation && (operation.generation !== generation || operation.romSha256 !== reply.rom.sha256);
        if (reviewedOperation(reply)) {
            status.hidden = false;
            say("Choose your Chromatic, then select Install to review the confirmation.");
        }
        else if (unknown)
            say(pending?.action === "flash" ? "The previous write’s outcome is unknown. Do not repeat it. Check the original operation in the plugin." : "The previous device request’s outcome is unknown. Check its original status in the plugin.");
        else if (operation?.state === "running") {
            say(operation.command === "list_devices" ? "Finding devices…"
                : operation.command !== "flash" ? "Checking device status…"
                    : operation.stage === "preparing" ? "Preparing installation…"
                        : operation.stage === "inspect-rom" ? "Checking the game…"
                            : operation.stage === "list-devices" ? "Checking your Chromatic…"
                                : "Installing the game…");
        }
        else if (operation?.state === "unresolved" || operation?.cartridgeWrite === "outcome-unverified") {
            const requiresUpdater = operation.diagnostics?.commands.some(command => !!command && typeof command === "object"
                && command.vendorCode === "feature.developer_mode_required");
            const cause = requiresUpdater ? operation.diagnostics?.processCompletion === "closed"
                ? "Install ModRetro Updater and activate Developer Mode on this computer. When finished, choose Check again to select your device. "
                : "Developer Mode could not be confirmed. "
                : "";
            if (operation.diagnostics?.processCompletion === "closed") {
                say(operation.state === "unresolved" ? `${cause}The command finished, but its final status is unresolved. Do not retry the write.`
                    : requiresUpdater ? `${cause}Installation was not confirmed.` : `${cause}The write’s effect on the cartridge is unverified.${reply.dismissalAvailable ? "" : " Do not retry the write."}`);
            }
            else {
                say(`${cause}${operation.cartridgeWrite === "outcome-unverified" ? "The command’s completion and effect on the cartridge are unconfirmed." : "The command’s completion is unconfirmed."} Keep your Chromatic connected and do not retry. Check status.`);
            }
        }
        else if (reply.discoveryError) {
            say(reply.blocked ? "Device search did not finish. Check status before trying again." : "Device search could not finish. Reopen this panel to try again, or copy the error for help.");
        }
        else if (operation?.state === "succeeded" && operation.command === "flash") {
            say(previousBuild ? "An earlier version was installed."
                : "Boot your Chromatic to play. Have fun!");
        }
        else if (operation?.state === "failed") {
            const requiresUpdater = operation.diagnostics?.commands.some(command => !!command && typeof command === "object"
                && command.vendorCode === "feature.developer_mode_required");
            say(requiresUpdater ? "Install ModRetro Updater and activate Developer Mode on this computer. When finished, choose Check again to select your device."
                : "The device operation could not finish. Copy the error for help.");
        }
        else if (!reply.available)
            say("Device installation is unavailable in this session. Ask Claude to check the plugin setup.");
        else if (reply.detecting)
            say("Looking for connected Chromatic devices…");
        else if (reply.blocked)
            say("Another device operation is pending. Check status before starting anything else.");
        else if (operation?.command === "list_devices") {
            say("");
            status.hidden = true;
        }
        else {
            say("");
            status.hidden = true;
        }
        const dismissedPending = reviewedOperation(reply) && pending?.action === "flash" && pending.requestId === operation?.requestId;
        if (dismissedPending || operation && operation.state !== "running" && operation.state !== "unresolved" && operation.cartridgeWrite !== "outcome-unverified") {
            try {
                remember(undefined);
            }
            catch {
                // Completion stops recovery in this page even if durable cleanup fails.
                // The retained ID can still recover the same terminal result on reload.
                pending = undefined;
            }
        }
        controls();
        if (dialog.open && (operation?.state === "running" || reply.detecting))
            timer = setTimeout(() => { void update(undefined, true); }, 500);
    }
    async function update(payload, background = false) {
        if (disposed || !current() || busy)
            return;
        if (recoveryUnavailable) {
            // An unreadable saved request is not proof that no write is pending.
            readFailed = unknown = true;
            statusErrorCode = "PREVIEW_RECOVERY_UNAVAILABLE";
            status.hidden = false;
            dialog.dataset.state = "error";
            say("Browser storage could not be read. A previous installation may still need recovery. Check the original operation in the plugin before starting another. Browser play is still available.");
            controls();
            return;
        }
        if (timer)
            clearTimeout(timer);
        if (!background && dialog.open)
            heading.focus({ preventScroll: true });
        submittingFlash = payload?.action === "flash";
        busy = true;
        controls();
        if (!background) {
            status.hidden = false;
            say(payload?.action === "flash" ? "Checking the game shown in this preview…" : "Checking device status…");
        }
        try {
            if (payload?.action === "flash") {
                try {
                    await verifyGame();
                    if (disposed || !current())
                        throw new Error("The game preview changed.");
                    if (!snapshot?.devices.some(device => device.token === payload.deviceToken && Date.parse(device.expiresAt) > Date.now()))
                        throw new Error("The device list expired. Reopen the install panel to refresh it.");
                }
                catch (error) {
                    throw new DeviceRequestRejected(`${error instanceof Error ? error.message : "The preview game could not be verified."} No device request was sent.`);
                }
            }
            const reply = await request(payload ?? { action: "status", ...(pending ? { requestId: pending.requestId } : {}) });
            if (!disposed && current())
                render(reply);
        }
        catch (error) {
            readFailed = true;
            connectionLost = error instanceof PreviewConnectionError;
            accessDenied = error instanceof JournalAccessError;
            statusErrorCode = accessDenied ? "CHROMATIC_JOURNAL_ACCESS_DENIED"
                : connectionLost ? "PREVIEW_CONNECTION_LOST" : error instanceof DeviceRequestRejected ? "PREVIEW_REQUEST_REJECTED" : "PREVIEW_STATUS_UNAVAILABLE";
            status.hidden = false;
            if (error instanceof DeviceRequestRejected) {
                try {
                    remember(undefined);
                }
                catch {
                    pending = undefined;
                }
                unknown = false;
                select.value = "";
                confirming = false;
            }
            else
                unknown = !!pending || accessDenied && unknown;
            if (accessDenied) {
                select.value = "";
                confirming = false;
            }
            dialog.dataset.state = "error";
            const writeNeedsRecovery = pending?.action === "flash" || snapshot?.operation?.command === "flash"
                && (snapshot.operation.state === "running" || snapshot.operation.state === "unresolved" || snapshot.operation.cartridgeWrite === "outcome-unverified");
            say(`${accessDenied ? "The installation record could not be read." : connectionLost ? "Connection to the preview was lost." : error instanceof DeviceRequestRejected ? "The request could not start. No device command was sent." : "The device status could not be checked."}${unknown || accessDenied && writeNeedsRecovery ? writeNeedsRecovery ? " The installation outcome is unknown. Keep your Chromatic connected and check status before trying again." : " Check status to recover the original request." : " Copy the error for help."}`);
            progress.hidden = true;
        }
        finally {
            busy = false;
            submittingFlash = false;
            if (!disposed) {
                controls();
                if (refreshOnOpen) {
                    refreshOnOpen = false;
                    const operation = snapshot?.operation;
                    const completed = operation?.command === "flash" && operation.state === "succeeded"
                        && operation.cartridgeWrite === "vendor-reported-success" && operation.generation === generation
                        && operation.romSha256 === snapshot?.rom.sha256 && operation.operationId !== dismissedSuccess;
                    const uncertainWrite = !reviewedOperation() && operation?.command === "flash"
                        && (operation.state === "unresolved" || operation.cartridgeWrite === "outcome-unverified");
                    // A click during a background read queues one scan. Existing scans and
                    // writes keep their original status and request identity.
                    if (dialog.open && current() && !captureBusy && !readFailed && !unknown && !pending && snapshot?.available
                        && !snapshot.blocked && !snapshot.detecting && operation?.state !== "running" && !completed && !uncertainWrite) {
                        void update({ action: "refresh" }, true);
                    }
                }
            }
        }
    }
    async function startInstall() {
        controls();
        if (busy || captureBusy || unknown || readFailed || !snapshot || snapshot.blocked || !snapshot.available || !select.value || !confirming)
            return;
        const requestId = crypto.randomUUID();
        try {
            remember({ requestId, action: "flash" });
        }
        catch {
            readFailed = true;
            statusErrorCode = "PREVIEW_STORAGE_UNAVAILABLE";
            confirming = false;
            status.hidden = false;
            dialog.dataset.state = "error";
            say("Browser storage is unavailable. No device request was sent.");
            controls();
            return;
        }
        await update({ action: "flash", requestId,
            deviceToken: select.value, acknowledgeErase: true, acknowledgeSaveLoss: true, acknowledgeNoBackup: true,
        });
    }
    function scheduleConnection(delay) {
        if (connectionTimer)
            clearTimeout(connectionTimer);
        if (!disposed && current() && !doc.hidden && !recoveryUnavailable) {
            connectionTimer = setTimeout(() => { void observeConnection(); }, delay);
        }
    }
    async function observeConnection() {
        if (disposed || !current() || doc.hidden || recoveryUnavailable)
            return;
        if (!dialog.open && !busy) {
            // A lost write response is recovered by its original ID, never by another write.
            await update(pending || unknown || captureBusy ? undefined : { action: "observe" }, true);
        }
        scheduleConnection(snapshot?.detecting || snapshot?.operation?.state === "running" ? 500 : 5_000);
    }
    const visibilityChanged = () => {
        if (connectionTimer)
            clearTimeout(connectionTimer);
        if (!doc.hidden)
            scheduleConnection(0);
    };
    doc.addEventListener("visibilitychange", visibilityChanged);
    doc.defaultView?.addEventListener("focus", visibilityChanged);
    review.addEventListener("click", () => {
        controls();
        if (review.disabled || review.hidden)
            return;
        confirming = true;
        controls();
        heading.focus({ preventScroll: true });
    });
    write.addEventListener("click", event => {
        // A second click on Install must not also confirm the newly revealed step.
        if (write.disabled || write.hidden || event.detail > 1)
            return;
        void startInstall();
    });
    check.addEventListener("click", () => { void update(); });
    newInstall.addEventListener("click", async () => {
        if (newInstall.hidden || newInstall.disabled || !snapshot?.operation)
            return;
        if (!reviewedOperation()) {
            const returnToInstall = newInstall.textContent === "Check again";
            await update({ action: "dismiss_failure", requestId: snapshot.operation.requestId,
                operationId: snapshot.operation.operationId, acknowledgePreviousOutcome: true });
            if (!disposed && current() && !readFailed && reviewedOperation()) {
                if (returnToInstall) {
                    confirming = false;
                    select.value = "";
                    await update({ action: "refresh" });
                }
                else
                    dialog.close();
            }
            return;
        }
        if (disposed || !current() || !dialog.open || readFailed)
            return;
        try {
            remember(undefined);
        }
        catch {
            pending = undefined;
        }
        confirming = false;
        select.value = "";
        await update({ action: "refresh" });
    });
    copy.addEventListener("click", async () => {
        if (disposed || !current() || !dialog.open || copy.hidden)
            return;
        const revision = ++handoffRevision;
        const report = diagnosticText.textContent ?? "";
        let copied = false;
        try {
            await navigator.clipboard.writeText(report);
            copied = true;
        }
        catch { /* Keep the same safe report selectable below. */ }
        if (disposed || !current() || !dialog.open || revision !== handoffRevision || report !== diagnosticText.textContent)
            return;
        if (copied)
            handoff.textContent = "Error copied.";
        else {
            diagnosticText.hidden = false;
            handoff.textContent = "Could not copy. Select and copy the error below.";
        }
        handoff.hidden = false;
    });
    select.addEventListener("change", () => { manualDevice = select.value; confirming = false; controls(); });
    close.addEventListener("click", () => dialog.close());
    dialog.addEventListener("close", () => {
        handoffRevision++;
        refreshOnOpen = false;
        handoff.hidden = true;
        diagnosticText.hidden = true;
        if (snapshot?.operation?.command === "flash" && snapshot.operation.state === "succeeded"
            && snapshot.operation.cartridgeWrite === "vendor-reported-success")
            dismissedSuccess = snapshot.operation.operationId;
        confirming = false;
        select.value = "";
        manualDevice = "";
        if (timer)
            clearTimeout(timer);
        if (!disposed && button.isConnected && !button.hidden)
            button.focus();
        scheduleConnection(0);
    });
    controls();
    if (recoveryUnavailable)
        void update();
    scheduleConnection(0);
    return {
        button,
        setPlayerUnavailable(value) { playerUnavailable = value; controls(); },
        setCaptureBusy(value) {
            if (captureBusy === value)
                return;
            captureBusy = value;
            controls();
            if (!value)
                scheduleConnection(0);
        },
        open() {
            if (disposed || !current() || dialog.open)
                return;
            if (connectionTimer)
                clearTimeout(connectionTimer);
            dialog.showModal();
            heading.focus({ preventScroll: true });
            refreshOnOpen = true;
            void update(undefined, true);
        },
        dispose() {
            disposed = true;
            if (timer)
                clearTimeout(timer);
            if (connectionTimer)
                clearTimeout(connectionTimer);
            doc.removeEventListener("visibilitychange", visibilityChanged);
            doc.defaultView?.removeEventListener("focus", visibilityChanged);
            dialog.close();
            dialog.remove();
            button.remove();
            permissionNote.remove();
            style.remove();
        },
    };
}
//# sourceMappingURL=flash.js.map