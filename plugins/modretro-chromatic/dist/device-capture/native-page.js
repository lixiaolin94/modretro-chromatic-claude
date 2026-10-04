import { DEVICE_CAPTURE_PAGE } from "./page.js";
/** Reuse the handheld UI; physical media is provided only by the native helper. */
export const NATIVE_CAPTURE_PAGE = DEVICE_CAPTURE_PAGE
    .replace('<h2 id="settings-title">', '<h2 id="settings-title" tabindex="-1">')
    .replace('<video id="video" autoplay muted playsinline aria-label="Selected Chromatic live feed"></video>', '<img id="video" alt="Live feed from the selected Chromatic" style="display:block;width:100%;height:100%;object-fit:contain;image-rendering:pixelated" hidden><div id="device-empty" style="position:absolute;inset:0;display:grid;align-content:center;gap:8px;padding:14px;text-align:center;background:#f4f4f6;color:#36363c;line-height:1.4;font-size:12px"><span id="device-empty-message">Device capture is off.</span><button id="empty-settings" type="button" style="font:inherit;border:0;border-radius:7px;padding:7px;background:#fff;color:#36363c">Enable capture…</button></div>')
    .replace('<div id="capture-consent-help"></div>', '<div id="capture-consent-help"><p id="capture-permission-help" class="limits">Allow camera and microphone access to use live capture.</p><p id="permission-status" role="status" class="limits"></p></div>')
    .replace('<div class="cgv-dialog-actions settings-actions">', '<div class="cgv-dialog-actions settings-actions"><button id="capture-enable" data-primary="true" type="button">Enable capture</button>')
    .replace('Keep this page visible while recording.', 'Recording continues when this view is hidden.')
    .replace('<p class="live-note">Live feed from your Chromatic — use the device controls.</p>', '');
/** Trusted packaged markup, isolated in a shadow root when hosted by the emulator. */
export const NATIVE_CAPTURE_VIEW = NATIVE_CAPTURE_PAGE.slice(NATIVE_CAPTURE_PAGE.indexOf("<style>"), NATIVE_CAPTURE_PAGE.indexOf("</style>") + 8)
    + NATIVE_CAPTURE_PAGE.slice(NATIVE_CAPTURE_PAGE.indexOf("<main "), NATIVE_CAPTURE_PAGE.indexOf("</main>") + 7)
    + `<style>
:host{display:block;color:var(--cgv-ink,#27272b);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{display:block;min-height:0;width:100%;padding:var(--cgv-device-top,0px) 0 0}.feed-title{display:none}
.capture-layout{display:block;container-type:normal;width:100%;max-width:none;margin:0}.capture-layout::before{display:none}
.preview{position:relative;width:100%;max-width:none;margin:0}
.toolbar{position:absolute;bottom:100%;width:100%;height:44px;margin:0 0 8px}.toolbar .icon-button{width:44px}
@media(max-width:360px){.toolbar .icon-button{width:36px}}
.capture-notices{display:grid;gap:6px;text-align:center;overflow-wrap:anywhere}
.capture-notices #state,.capture-notices .view-feedback,.capture-notices #recovery,.capture-notices #screenshot-recovery{position:static;min-height:0;margin:0;padding:8px 10px;border-radius:8px;background:var(--cgv-ink,#27272b);color:var(--cgv-background,#fff);box-shadow:0 4px 16px #0002;font-size:11px;line-height:1.4;font-weight:400;cursor:pointer}
.capture-notices #state:empty,.capture-notices .view-feedback:empty{display:none}
.capture-notices #saved{position:static;transform:none;box-sizing:border-box;width:100%;text-align:left}
</style>`;
//# sourceMappingURL=native-page.js.map