/// <reference lib="dom" />
import { parseRecordingDiagnostics } from "./recording-protocol.js";
import { DIALOG_STYLES } from "./view.js";
const problems = {
    "device-capture": ["Device capture needs attention", "The capture action could not finish. Copy the error for help."],
    screenshot: ["Screenshot unavailable", "The game screenshot could not be captured. Try again."],
    recording: ["Recording interrupted", "The browser could not complete the recording. Any captured video remains available below."],
    "recording-empty": ["Recording failed", "No video file was saved. Try again or copy the error for help."],
    "capture-save": ["Capture save not confirmed", "Your capture is still available in this preview. Download the copy before leaving."],
    "player-action": ["Preview action unavailable", "The preview could not complete that action. Try again or ask Claude for help."],
    "player-restart": ["Restart the game to continue", "The saved state could not be prepared safely for playback. Restart the game before continuing."],
    annotations: ["Annotations unavailable", "The preview could not open annotations for this frame. Try the browser’s annotation button."],
    "automatic-save": ["Progress save not confirmed", "The preview could not confirm that your latest progress was saved. Keep this preview open and ask Claude for help."],
    "saved-progress": ["Saved progress unavailable", "Saved progress could not be reopened. Automatic saving is paused to preserve your history."],
};
let nextDialogId = 0;
// Exact known messages select fixed guidance. Arbitrary native diagnostics never
// become annotation or copied error content.
const nativeCaptureGuidance = new Map([
    ["The device action is unconfirmed because its reply was lost. Check the original status; do not retry the action.",
        ["Capture didn’t respond", "Keep the live view open while the app checks its status."]],
    ["The previous device action is unconfirmed. Check its status before another action.",
        ["Capture didn’t respond", "Keep the live view open while the app checks its status."]],
    ["Enable device capture in Settings → Connection first. Claude can open that settings tab for you.",
        ["Enable device capture", "Open Settings → Connection, then select Enable capture."]],
    ["Camera access is not enabled for the native capture helper. Allow it in macOS Privacy & Security, then try Enable device capture again.",
        ["Camera access unavailable", "Allow camera access in macOS Settings → Privacy & Security → Camera. If it is already allowed, ask Claude to check the capture setup."]],
    ["USB audio needs microphone access for the native capture helper. Allow it in macOS Privacy & Security, or use video only.",
        ["USB audio access unavailable", "Microphone access is unavailable. Check macOS Privacy & Security → Microphone, then enable capture again."]],
    ["Connect your Chromatic before recording.",
        ["Connect your Chromatic", "Choose your Chromatic in the device list and select Connect before starting a recording."]],
    ["Refresh devices and use the exact selection from the current list.",
        ["Refresh the device list", "Refresh devices, choose your Chromatic from the updated list, then select Connect."]],
    ["Select a Chromatic from the current device list.",
        ["Choose your Chromatic", "Refresh devices and choose the Chromatic you want to view before connecting."]],
    ["Matching USB audio could not be resolved. Check the connection and refresh devices.",
        ["USB audio unavailable", "Check your Chromatic’s USB connection, then refresh the device list."]],
    ["A capture operation is still finishing. Check status.",
        ["Capture is still finishing", "Keep the live view open while the app checks its status."]],
    ["A capture operation is still finishing.",
        ["Capture is still finishing", "Keep the live view open while the app checks its status."]],
    ["The device video could not be verified. Reconnect your Chromatic.",
        ["Live video unavailable", "The device video could not be verified. Reconnect your Chromatic."]],
]);
/** A transient error window. Copying includes fixed text and allowlisted build IDs. */
export function mountPreviewErrorDialog(root, identity = {}, onOpen) {
    const doc = root.ownerDocument;
    const node = (tag, text) => {
        const element = doc.createElement(tag);
        if (text)
            element.textContent = text;
        return element;
    };
    const id = `cgv-preview-error-${++nextDialogId}`;
    const dialog = node("dialog");
    dialog.className = "cgv-dialog cgv-error";
    dialog.dataset.previewError = "true";
    dialog.setAttribute("role", "alertdialog");
    dialog.setAttribute("aria-labelledby", `${id}-heading`);
    dialog.setAttribute("aria-describedby", `${id}-summary`);
    const heading = node("h2");
    heading.id = `${id}-heading`;
    heading.tabIndex = -1;
    const summary = node("p");
    summary.id = `${id}-summary`;
    summary.className = "cgv-error-summary";
    const handoff = node("p");
    handoff.className = "cgv-error-handoff";
    handoff.setAttribute("role", "status");
    handoff.setAttribute("aria-live", "polite");
    handoff.hidden = true;
    const shareText = node("pre");
    shareText.dataset.diagnosticContext = "true";
    shareText.hidden = true;
    const actions = node("div");
    actions.className = "cgv-dialog-actions cgv-error-actions";
    const closeButton = node("button", "Close");
    closeButton.type = "button";
    closeButton.dataset.action = "close-preview-error";
    closeButton.dataset.primary = "true";
    const copy = node("button", "Copy error");
    copy.type = "button";
    copy.dataset.action = "copy-preview-error";
    actions.append(copy, closeButton);
    const content = node("div");
    content.className = "cgv-error-content";
    content.append(summary, handoff, shareText);
    dialog.append(heading, content, actions);
    const style = node("style");
    style.textContent = DIALOG_STYLES + `
.cgv-error-summary { color: #626268; }
.cgv-dialog.cgv-error { height: min(290px, calc(100svh - 32px)); overflow: hidden; }
.cgv-dialog.cgv-error[open] { display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 14px; }
.cgv-error-content { min-height: 0; overflow: auto; overscroll-behavior: contain; display: flex; flex-direction: column; gap: 12px; padding: 6px; margin: -6px; }
.cgv-error .cgv-error-handoff { color: #75757b; font-size: 12px; line-height: 18px; }
`;
    root.append(style, dialog);
    let disposed = false;
    let kind;
    let problemDescription = "";
    let recorderDiagnostics;
    let lastDetail = "";
    let revision = 0;
    let previousFocus = null;
    const restoreFocus = () => {
        revision++;
        if (!disposed && previousFocus?.isConnected && !previousFocus.disabled)
            previousFocus.focus({ preventScroll: true });
        previousFocus = null;
    };
    const close = () => { revision++; if (dialog.open)
        dialog.close(); };
    const metadata = () => {
        if (!kind)
            throw new Error("No preview error is selected.");
        const value = {
            Problem: problemDescription, Source: kind === "device-capture" ? "Physical Chromatic capture" : "Game preview", Error: kind,
            Request: "Help diagnose this preview error.",
        };
        for (const [key, label] of [["romSha256", "ROM SHA-256"], ["runtimeSha256", "Runtime SHA-256"], ["sourceRevision", "Preview revision"]]) {
            const entry = identity[key];
            if (typeof entry === "string" && (key === "sourceRevision" ? /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u : /^[a-f0-9]{64}$/u).test(entry))
                value[label] = entry;
        }
        if (recorderDiagnostics)
            value["Recorder diagnostics"] = JSON.stringify(recorderDiagnostics);
        return value;
    };
    const copyDetails = async () => {
        if (disposed || !dialog.open || copy.hidden || copy.disabled)
            return;
        const version = revision;
        copy.disabled = true;
        let message;
        let copyFailed = false;
        try {
            await navigator.clipboard.writeText(shareText.textContent ?? "");
            message = "Error copied.";
        }
        catch {
            copyFailed = true;
            message = "Could not copy. Select and copy the error below.";
        }
        if (!disposed && dialog.open && version === revision) {
            copy.disabled = false;
            handoff.hidden = false;
            handoff.textContent = message;
            if (copyFailed)
                shareText.hidden = false;
        }
    };
    closeButton.addEventListener("click", close);
    dialog.addEventListener("close", restoreFocus);
    copy.addEventListener("click", copyDetails);
    return {
        show(next, detail, diagnostics) {
            if (disposed || !root.isConnected)
                return;
            const detailText = detail?.slice(0, 2000) ?? "";
            if (dialog.open && kind === next && lastDetail === detailText)
                return;
            revision++;
            kind = next;
            lastDetail = detailText;
            recorderDiagnostics = undefined;
            if (diagnostics !== undefined && (next === "recording" || next === "recording-empty")) {
                try {
                    const parsed = parseRecordingDiagnostics(diagnostics);
                    const container = parsed.mimeType.split(";")[0];
                    // Keep arbitrary browser strings local; only the known container
                    // class and validated scalar observations can be shared.
                    recorderDiagnostics = { ...parsed, mimeType: container === "video/webm" || container === "video/mp4" ? container : "unknown" };
                }
                catch { /* Invalid diagnostics remain in the local technical detail only. */ }
            }
            const problem = next === "device-capture" ? nativeCaptureGuidance.get(detailText) ?? problems[next] : problems[next];
            heading.textContent = problem[0];
            problemDescription = problem[1];
            summary.textContent = problemDescription;
            handoff.hidden = true;
            handoff.textContent = "";
            shareText.hidden = true;
            shareText.textContent = JSON.stringify(metadata(), null, 2);
            copy.disabled = false;
            if (!dialog.open) {
                previousFocus = doc.activeElement;
                onOpen?.();
                dialog.showModal();
            }
            heading.focus({ preventScroll: true });
        },
        close,
        dispose() {
            if (disposed)
                return;
            disposed = true;
            close();
            closeButton.removeEventListener("click", close);
            dialog.removeEventListener("close", restoreFocus);
            copy.removeEventListener("click", copyDetails);
            dialog.remove();
            style.remove();
            previousFocus = null;
        },
    };
}
//# sourceMappingURL=error-dialog.js.map