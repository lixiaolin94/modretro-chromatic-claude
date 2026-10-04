/// <reference lib="dom" />
export const DEVICE_COLOR_KEY = "codex-gb-studio:device-color:v1";
export const SOURCE_MODE_STYLES = `
.cgv-source-modes{display:flex;flex:none;justify-content:center;gap:3px;width:max-content;max-width:100%;height:36px;margin:0 auto 16px;padding:3px;border-radius:10px;background:#f1f1f3}
.cgv-source-modes button{appearance:none;border:0;border-radius:7px;background:transparent;color:#69696e;padding:4px 16px;font:12px/24px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;cursor:pointer}
.cgv-source-modes button[aria-pressed=true]{background:#fff;color:#27272b;box-shadow:0 1px 3px #0001}
.cgv-source-modes button:disabled{opacity:.5;cursor:default}
.cgv-source-modes .cgv-device-choice{display:inline-flex;border-radius:7px}
.cgv-source-modes .cgv-device-choice[data-unavailable] button{pointer-events:none}
`;
export const DEVICE_COLORS = [
    { id: "codex", name: "Codex edition", background: "#ffffff", ink: "#27272b" },
    { id: "cloud", name: "Cloud", background: "#e5e6e3", ink: "#27272b" },
    { id: "midnight", name: "Midnight", background: "#4e4f55", ink: "#f5f5f3" },
    { id: "wave", name: "Wave", background: "#6dd6de", ink: "#27272b" },
    { id: "leaf", name: "Leaf", background: "#61c55a", ink: "#27272b" },
    { id: "inferno", name: "Inferno", background: "#ff6d1f", ink: "#27272b" },
    { id: "volt", name: "Volt", background: "#efbf22", ink: "#27272b" },
    { id: "bubblegum", name: "Bubblegum", background: "#ecafc6", ink: "#27272b" },
];
/** Neutral overlay styling shared with the compact capture settings. */
export const DIALOG_STYLES = `
.cgv-dialog { box-sizing: border-box; position: fixed; inset: 0; margin: auto; width: min(420px, calc(100vw - 32px)); height: fit-content; max-height: calc(100svh - 32px); overflow: auto; overscroll-behavior: contain; padding: 20px; border: 0; border-radius: 16px; background: #fff; color: #27272b; box-shadow: 0 18px 60px #0003; font: 14px/21px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; text-align: left; }
.cgv-dialog[open] { display: flex; flex-direction: column; gap: 16px; }
.cgv-dialog:not([open]), .cgv-dialog [hidden] { display: none !important; }
.cgv-dialog::backdrop { background: #17171a55; }
.cgv-dialog h2 { margin: 0; font-size: 18px; line-height: 24px; font-weight: 600; letter-spacing: -.02em; }
.cgv-dialog p { margin: 0; overflow-wrap: anywhere; }
.cgv-dialog h2:focus { outline: none; }
.cgv-dialog :is(button, input, select, summary):focus-visible { outline: 2px solid #27272b; outline-offset: 3px; }
.cgv-dialog button { appearance: none; min-height: 44px; padding: 10px 12px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: #626268; font: inherit; font-size: 13px; line-height: 20px; font-weight: 550; cursor: pointer; }
.cgv-dialog button:hover:not(:disabled) { background: #f1f1f3; color: #27272b; }
.cgv-dialog button[data-primary="true"] { background: #27272b; border-color: #27272b; color: #fff; }
.cgv-dialog button[data-primary="true"]:hover:not(:disabled) { background: #3e3e43; color: #fff; }
.cgv-dialog button:disabled { opacity: .4; cursor: default; }
.cgv-dialog select, .cgv-dialog input[type="number"], .cgv-dialog input[type="password"] { box-sizing: border-box; min-width: 0; height: 40px; padding: 8px 12px; border: 1px solid #dedee1; border-radius: 8px; background-color: #fff; color: #27272b; font: inherit; font-size: 13px; }
.cgv-dialog select { appearance: none; padding-right: 36px; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23626668' stroke-width='1.7' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m7 10 5 5 5-5'/%3E%3C/svg%3E"); background-position: right 12px center; background-size: 16px; background-repeat: no-repeat; }
.cgv-dialog-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 6px; padding-top: 12px; border-top: 1px solid #e5e5e7; }
.cgv-dialog-support { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.cgv-dialog-support button { padding: 8px 10px; background: #f1f1f3; color: #626268; font-size: 12px; }
.cgv-dialog .cgv-dialog-note { color: #75757b; font-size: 12px; line-height: 18px; }
.cgv-dialog details { margin: 0; color: #626268; font-size: 12px; line-height: 18px; }
.cgv-dialog summary { width: fit-content; max-width: 100%; cursor: pointer; font-weight: 550; }
.cgv-dialog details p { margin-top: 8px; }
.cgv-dialog pre { max-height: 180px; overflow: auto; margin: 8px 0 0; padding: 10px 12px; border: 1px solid #e5e5e7; border-radius: 8px; background: #f7f7f8; color: #626268; font: 11px/17px ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; user-select: text; -webkit-user-select: text; }
.cgv-dialog-status { padding: 12px; border: 1px solid #e5e5e7; border-radius: 10px; background: #f7f7f8; }
.cgv-dialog-status .cgv-dialog-status-title { margin-bottom: 4px; color: #27272b; font-size: 13px; line-height: 20px; font-weight: 600; }
.cgv-dialog-status p { font-size: 14px; line-height: 21px; color: #626268; }
.cgv-dialog progress { display: block; width: 100%; height: 4px; margin: 10px 0 0; border: 0; border-radius: 4px; overflow: hidden; accent-color: #27272b; }
@media(max-width: 360px) { .cgv-dialog { padding: 16px; } }
`;
const BODY_CLASS = "codex-game-view-mounted";
const SVG_NS = "http://www.w3.org/2000/svg";
export const ICONS = {
    codex: "M335.138 180.542C360.055 180.543 382.615 190.639 398.949 206.963C406.406 204.969 414.243 203.906 422.329 203.906C472.182 203.906 512.596 244.32 512.596 294.172C512.596 302.258 511.531 310.096 509.537 317.553C525.862 333.887 535.959 356.446 535.959 381.364C535.959 423.131 507.591 458.272 469.072 468.573C458.771 507.091 423.631 535.458 381.864 535.458C356.947 535.458 334.386 525.362 318.052 509.038C310.596 511.032 302.758 512.097 294.673 512.097C244.82 512.097 204.406 471.682 204.406 421.829C204.406 413.743 205.469 405.905 207.464 398.448C191.139 382.114 181.043 359.555 181.043 334.638C181.043 292.871 209.41 257.73 247.929 247.429C258.23 208.91 293.371 180.543 335.138 180.542ZM289.683 302.379C285.942 295.618 277.426 293.17 270.665 296.911C263.903 300.652 261.455 309.167 265.196 315.928L289.852 360.486L265.33 402.843C261.458 409.531 263.741 418.091 270.428 421.963C277.116 425.835 285.678 423.553 289.55 416.865L316.43 370.433L316.745 369.869C319.79 364.186 319.857 357.367 316.922 351.626L316.618 351.056L289.683 302.379ZM370.927 394.745C363.2 394.745 356.935 401.01 356.935 408.738C356.935 416.466 363.2 422.731 370.927 422.731H437.612C445.34 422.731 451.605 416.465 451.605 408.738C451.605 401.01 445.34 394.745 437.612 394.745H370.927Z",
    play: "m8 5 11 7-11 7Z",
    pause: "M9 5v14M15 5v14",
    record: "M5 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Zm10 4 6-3v10l-6-3Z",
    sound: "M10 5 5 9H2v6h3l5 4ZM14 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14",
    muted: "M10 5 5 9H2v6h3l5 4ZM15 9l6 6m0-6-6 6",
    restart: "M4 10a8 8 0 1 1 1 7M4 4v6h6",
    history: "M3 12a9 9 0 1 0 2.6-6.4M3 3v5h5M12 7v5l3 2",
    annotate: "M8 3H4a1 1 0 0 0-1 1v4m13-5h4a1 1 0 0 1 1 1v4M3 16v4a1 1 0 0 0 1 1h4m8 0h4a1 1 0 0 0 1-1v-4M12 8v8m-4-4h8",
    device: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm1 3h8v6H8Zm.5 10h3m-1.5-1.5v3M15 16h.01M17 17.5h.01",
};
let tooltipSequence = 0;
/** One transient tooltip follows the existing controls; it never handles their actions. */
export function mountControlTooltips(root) {
    const doc = root.ownerDocument;
    const win = doc.defaultView;
    if (!win)
        return () => { };
    const tooltip = doc.createElement("div");
    tooltip.className = "cgv-tooltip";
    tooltip.id = `cgv-tooltip-${++tooltipSequence}`;
    tooltip.setAttribute("role", "tooltip");
    tooltip.hidden = true;
    root.append(tooltip);
    let hovered;
    let focused;
    let active;
    let dismissed;
    let timer;
    const cleanups = [];
    const listen = (target, name, handler, capture = false) => {
        target.addEventListener(name, handler, capture);
        cleanups.push(() => target.removeEventListener(name, handler, capture));
    };
    const clearTimer = () => { if (timer !== undefined)
        clearTimeout(timer); timer = undefined; };
    const hide = () => {
        clearTimer();
        if (active) {
            const ids = (active.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter(id => id && id !== tooltip.id);
            if (ids.length)
                active.setAttribute("aria-describedby", ids.join(" "));
            else
                active.removeAttribute("aria-describedby");
        }
        active = undefined;
        tooltip.hidden = true;
    };
    const targetOf = (target) => {
        const element = target;
        const control = typeof element?.closest === "function" ? element.closest("[data-tooltip]") : null;
        return control && root.contains(control) ? control : undefined;
    };
    const show = (control) => {
        clearTimer();
        if (!control || control === dismissed || !root.contains(control) || control.matches(":disabled") ||
            control.closest("[hidden]") || control.getClientRects().length === 0 || !control.dataset.tooltip) {
            hide();
            return;
        }
        if (active !== control)
            hide();
        active = control;
        const host = control.closest("dialog[open]") ?? root;
        if (tooltip.parentNode !== host)
            host.append(tooltip);
        if (tooltip.textContent !== control.dataset.tooltip)
            tooltip.textContent = control.dataset.tooltip;
        const ids = (control.getAttribute("aria-describedby") ?? "").split(/\s+/u).filter(id => id && id !== tooltip.id);
        // aria-describedby overrides aria-description; do not hide the recording's elapsed time.
        if (!control.hasAttribute("aria-description"))
            ids.push(tooltip.id);
        if (ids.length)
            control.setAttribute("aria-describedby", ids.join(" "));
        else
            control.removeAttribute("aria-describedby");
        tooltip.hidden = false;
        const bounds = control.getBoundingClientRect();
        const width = tooltip.offsetWidth;
        const height = tooltip.offsetHeight;
        const viewportWidth = doc.documentElement.clientWidth;
        const viewportHeight = win.innerHeight;
        const left = Math.max(8, Math.min(bounds.left + (bounds.width - width) / 2, viewportWidth - width - 8));
        const preferredTop = bounds.top - height - 8;
        const top = Math.max(8, Math.min(preferredTop >= 8 ? preferredTop : bounds.bottom + 8, viewportHeight - height - 8));
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    };
    const schedule = (control, delay) => {
        clearTimer();
        timer = setTimeout(() => { timer = undefined; show(control); }, delay);
    };
    listen(root, "pointerover", raw => {
        if (raw.pointerType === "touch")
            return;
        if (tooltip.contains(raw.target)) {
            clearTimer();
            return;
        }
        const control = targetOf(raw.target);
        if (control === hovered)
            return;
        hovered = control;
        dismissed = undefined;
        schedule(hovered ?? focused, 250);
    });
    listen(root, "pointerout", raw => {
        const next = raw.relatedTarget;
        if (next && (tooltip.contains(next) || hovered?.contains(next)))
            return;
        hovered = undefined;
        schedule(focused, 120);
    });
    listen(root, "focusin", raw => {
        const control = targetOf(raw.target);
        focused = control?.matches(":focus-visible") ? control : undefined;
        if (focused) {
            dismissed = undefined;
            show(focused);
        }
    });
    listen(root, "focusout", raw => {
        const control = targetOf(raw.relatedTarget);
        focused = control?.matches(":focus-visible") ? control : undefined;
        show(focused ?? hovered);
    });
    const dismiss = () => { dismissed = active ?? focused ?? hovered; hide(); };
    listen(root, "pointerdown", dismiss);
    listen(doc, "keydown", raw => { if (raw.key === "Escape")
        dismiss(); }, true);
    listen(doc, "scroll", dismiss, true);
    listen(win, "resize", dismiss);
    listen(win, "blur", dismiss);
    const observer = new MutationObserver(records => {
        if (active && (!root.contains(active) || records.some(record => record.target === active || record.target.contains(active))))
            show(active);
    });
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-tooltip", "aria-description", "disabled", "hidden", "open"] });
    return () => { observer.disconnect(); hide(); for (const cleanup of cleanups)
        cleanup(); tooltip.remove(); };
}
const STYLES = `
body.codex-game-view-mounted {
  margin: 0;
  padding: 0;
  overflow: auto !important;
  background: var(--cgv-background, #ffffff);
  color: var(--cgv-ink, #27272b);
  touch-action: pan-y pinch-zoom;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-weight: 400;
}
body.codex-game-view-mounted #controller { display: none !important; }
.codex-game-view, .codex-game-view * { box-sizing: border-box; }
.codex-game-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: safe center;
  min-height: 100svh;
  padding: 12px 14px;
  background: var(--cgv-background, #ffffff);
  color: var(--cgv-ink, #27272b);
  touch-action: pan-y pinch-zoom;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  font-synthesis: none;
}
.codex-game-view:fullscreen {
  width: 100%;
  height: 100%;
  overflow: auto;
  align-items: safe center;
}
.codex-game-view .cgv-player {
  width: min(420px, max(280px, calc((100svh - 250px) * 850 / 1440)));
  max-width: 100%;
  flex: none;
}
.codex-game-view .cgv-mode-views{position:relative;display:grid;grid-template-columns:minmax(0,1fr);width:min(420px,max(0px,calc((100svh - 195px)*850/1440)));max-width:calc(100vw - 80px)}
.codex-game-view .cgv-header {
  position: sticky;
  top: 0;
  z-index: 20;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 4px 8px;
  flex: none;
  width: min(420px, 100%);
  max-width: calc(100vw - 28px);
  padding: 4px 0 8px;
  margin-bottom: 8px;
  background: transparent;
}
.codex-game-view .cgv-mode-views .cgv-source-modes { position: absolute; z-index: 3; left: calc(100% + 4px); top: calc(38% - 44px); width: 36px; height: 40px; margin: 0; padding: 0; background: transparent; }
.codex-game-view .cgv-mode-views .cgv-source-modes button { display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 40px; padding: 0; border: 0; border-radius: 8px; color: var(--cgv-ink); }
.codex-game-view .cgv-mode-views .cgv-source-modes button[aria-pressed="true"] { background: var(--cgv-ink); color: var(--cgv-background); box-shadow: none; }
.codex-game-view .cgv-header-actions { display: grid; flex: none; justify-items: center; }
.codex-game-view .cgv-header-actions > * { grid-area: 1 / 1; }
.codex-game-view .cgv-device-actions { visibility: hidden; pointer-events: none; }
.codex-game-view[data-source=device] .cgv-device-actions { visibility: visible; pointer-events: auto; }
.codex-game-view[data-source=device] .cgv-toolbar { visibility: hidden; pointer-events: none; }
.codex-game-view .cgv-views-stage{position:relative;display:grid;grid-area:1/1;min-width:0}
.codex-game-view .cgv-views-stage>.cgv-player{width:100%;grid-area:1/1}
.codex-game-view .cgv-shared-footer{grid-area:2/1;position:relative;justify-self:center;width:min(340px,calc(100vw - 28px));min-width:0;margin-top:10px}
.codex-game-view .cgv-hint-area{display:grid}
.codex-game-view .cgv-hint-area>*{grid-area:1/1}
.codex-game-view[data-source=device] .cgv-keyboard-hints{visibility:hidden}
.codex-game-view[data-source=device] .cgv-views-stage>.cgv-player{visibility:hidden;pointer-events:none}
.codex-game-view .cgv-device-view{grid-area:1/1;min-height:0;min-width:0;visibility:hidden;pointer-events:none}
.codex-game-view[data-source=device] .cgv-device-view{visibility:visible;pointer-events:auto}
.codex-game-view button {
  appearance: none;
  font: inherit;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.codex-game-view button:disabled { opacity: .38; cursor: default; }
.codex-game-view .cgv-tooltip {
  position: fixed;
  z-index: 100;
  width: max-content;
  max-width: min(240px, calc(100vw - 16px));
  padding: 6px 9px;
  border-radius: 6px;
  background: #292a2d;
  color: #fff;
  box-shadow: 0 2px 8px #0002;
  font: 12px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  text-align: center;
  overflow-wrap: anywhere;
}
.codex-game-view .cgv-tooltip[hidden] { display: none; }
.codex-game-view button:focus-visible,
.codex-game-view .cgv-install-slot:focus-visible,
.codex-game-view summary:focus-visible {
  outline: 2px solid var(--cgv-ink);
  outline-offset: 4px;
}
.codex-game-view svg {
  display: block;
  width: 18px;
  height: 18px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.65;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.codex-game-view .cgv-toolbar {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0;
  justify-content: center;
  min-height: 44px;
  margin: 0;
}
.codex-game-view .cgv-title {
  position: absolute;
  z-index: 1;
  top: 45.9%;
  left: 13%;
  width: 74%;
  min-width: 0;
  margin: 0;
  text-align: center;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #fff;
  font-size: clamp(6px, min(2.6vw, calc((100svh - 195px) * .023)), 12px);
  font-weight: 600;
  line-height: 1.4;
  letter-spacing: -.01em;
  pointer-events: none;
}
.codex-game-view .cgv-icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: color-mix(in srgb, var(--cgv-ink) 72%, transparent);
}
.codex-game-view .cgv-icon-button:hover:not(:disabled),
.codex-game-view .cgv-action:hover:not(:disabled) {
  background: color-mix(in srgb, var(--cgv-ink) 6%, transparent);
  color: var(--cgv-ink);
}
.codex-game-view .cgv-icon-button[aria-expanded="true"],
.codex-game-view .cgv-icon-button[aria-pressed="true"],
.codex-game-view .cgv-action[aria-pressed="true"] {
  background: color-mix(in srgb, var(--cgv-ink) 10%, transparent);
  color: var(--cgv-ink);
}
.codex-game-view .cgv-more { flex: none; }
.codex-game-view .cgv-more-toggle {
  list-style: none;
  cursor: pointer;
  font: inherit;
  font-size: 24px;
  line-height: 1;
  -webkit-tap-highlight-color: transparent;
}
.codex-game-view .cgv-more-panel {
  position: absolute;
  z-index: 9;
  top: calc(100% + 8px);
  right: 0;
  width: min(200px, calc(100vw - 28px));
  padding: 6px;
  border: 1px solid color-mix(in srgb, var(--cgv-ink) 18%, transparent);
  border-radius: 12px;
  background: var(--cgv-background);
  box-shadow: 0 12px 32px #0002, 0 2px 5px #0001;
}
.codex-game-view .cgv-more-panel .cgv-action {
  justify-content: flex-start;
  width: 100%;
  gap: 10px;
  font-size: 12px;
  text-align: left;
}
.codex-game-view .cgv-history {
  position: absolute;
  z-index: 10;
  top: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  width: min(280px, calc(100vw - 28px));
  max-height: min(400px, 60svh);
  overflow: auto;
  overscroll-behavior: contain;
  padding: 6px;
  border: 1px solid #c7cebe;
  border-radius: 12px;
  background: #f5f5ef;
  color: #353d30;
  box-shadow: 0 12px 32px #28332126, 0 2px 5px #2833210d;
}
.codex-game-view .cgv-history-heading {
  margin: 0;
  padding: 9px 10px 8px;
  color: #66705e;
  font-size: 11px;
  font-weight: 600;
}
.codex-game-view .cgv-history-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 3px;
  width: 100%;
  min-height: 48px;
  padding: 9px 10px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: #3a4832;
  text-align: left;
}
.codex-game-view .cgv-history-item:hover,
.codex-game-view .cgv-history-item:focus { background: #e3e8d9; }
.codex-game-view .cgv-history-item:focus-visible { outline-offset: -2px; }
.codex-game-view .cgv-history-item time { font-size: 12px; font-weight: 550; line-height: 1.5; }
.codex-game-view .cgv-history-empty {
  margin: 0;
  padding: 12px 10px 15px;
  color: #66705e;
  font-size: 12px;
  line-height: 1.5;
}
.codex-game-view .cgv-device-stage { position: relative; }
.codex-game-view .cgv-handheld {
  position: relative;
  width: 100%;
  aspect-ratio: 850 / 1440;
  overflow: clip;
  overflow-clip-margin: 12px;
  filter: drop-shadow(0 10px 16px #0005);
  user-select: none;
}
.codex-game-view .cgv-shell {
  position: absolute;
  top: -5.20833%;
  left: -44.7059%;
  width: 188.235%;
  max-width: none;
  height: 111.111%;
  pointer-events: none;
}
.codex-game-view .cgv-screen {
  position: absolute;
  top: 11.5278%;
  left: 18.3529%;
  width: 62.1177%;
  aspect-ratio: 10 / 9;
  overflow: hidden;
  background: #101922;
  line-height: 0;
}
body.codex-game-view-mounted .codex-game-view #game {
  position: absolute !important;
  inset: 0 !important;
  display: block !important;
  width: 100% !important;
  height: 100% !important;
  margin: 0 !important;
  padding: 0 !important;
}
body.codex-game-view-mounted .codex-game-view #game canvas {
  display: block !important;
  width: 100% !important;
  height: 100% !important;
  max-width: none !important;
  max-height: none !important;
  margin: 0 !important;
  padding: 0 !important;
  border: 0 !important;
  border-radius: 0 !important;
  object-fit: contain;
  image-rendering: pixelated;
}
.codex-game-view .cgv-device-controls { position: absolute; inset: 0; pointer-events: none; }
.codex-game-view .cgv-game-button {
  position: absolute;
  padding: 0;
  border: 0;
  background: transparent;
  pointer-events: auto;
  touch-action: none;
  -webkit-touch-callout: none;
}
.codex-game-view .cgv-game-button:focus-visible {
  outline: 3px solid #e7d6ff;
  outline-offset: 3px;
  box-shadow: 0 0 0 5px #2d203e;
}
.codex-game-view .cgv-game-button:active,
.codex-game-view .cgv-game-button.pressed {
  background: #17102165;
  box-shadow: inset 1px 3px 5px #100b1680;
}
.codex-game-view [data-game-button="a"] { left: 76.24%; top: 61.39%; width: 13.29%; height: 7.85%; border-radius: 50%; }
.codex-game-view [data-game-button="b"] { left: 59.06%; top: 66.04%; width: 13.29%; height: 7.85%; border-radius: 50%; }
.codex-game-view [data-game-button="up"] { left: 19.29%; top: 59.31%; width: 9.88%; height: 6.18%; border-radius: 18% 18% 0 0; }
.codex-game-view [data-game-button="down"] { left: 19.29%; top: 69.31%; width: 9.88%; height: 6.18%; border-radius: 0 0 18% 18%; }
.codex-game-view [data-game-button="left"] { left: 10%; top: 65%; width: 10.47%; height: 5.97%; border-radius: 18% 0 0 18%; }
.codex-game-view [data-game-button="right"] { left: 29.18%; top: 65%; width: 10.47%; height: 5.97%; border-radius: 0 18% 18% 0; }
.codex-game-view [data-game-button="select"],
.codex-game-view [data-game-button="start"] { top: 82.04%; width: 14.94%; height: 2.71%; border-radius: 999px; transform: rotate(-26deg); }
.codex-game-view [data-game-button="select"] { left: 32.29%; }
.codex-game-view [data-game-button="start"] { left: 51.18%; }
.codex-game-view [data-game-button="select"]::before,
.codex-game-view [data-game-button="start"]::before { content: ""; position: absolute; inset: -14px -2px; }
.codex-game-view .cgv-colors {
  position: absolute;
  right: calc(100% + 4px);
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  flex-direction: column;
  width: 36px;
}
.codex-game-view .cgv-color {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: clamp(20px, calc((100svh - 275px) / 8), 40px);
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
}
.codex-game-view .cgv-color-chip {
  width: 20px;
  height: 20px;
  border: 1px solid color-mix(in srgb, var(--cgv-ink) 28%, transparent);
  border-radius: 50%;
}
.codex-game-view .cgv-color[aria-pressed="true"] .cgv-color-chip {
  outline: 2px solid var(--cgv-ink);
  outline-offset: 3px;
}
.codex-game-view .cgv-codex-chip { border: 0; }
.codex-game-view .cgv-codex-chip svg {
  width: 20px;
  height: 20px;
  fill: currentColor;
  stroke: none;
}
@media (max-height: 355px) {
  .codex-game-view .cgv-colors { display: grid; grid-template-columns: repeat(2, 28px); width: 56px; }
  .codex-game-view .cgv-color { width: 28px; height: clamp(24px, calc((100svh - 195px) / 4), 28px); }
}
@media (max-width: 360px) {
  .codex-game-view .cgv-toolbar .cgv-icon-button { width: 36px; }
}
@media (hover: hover) {
  .codex-game-view .cgv-color:hover { background: color-mix(in srgb, var(--cgv-ink) 6%, transparent); }
  .codex-game-view .cgv-game-button:hover:not(.pressed):not(:disabled) { background: #e1c8ff16; }
}
.codex-game-view .cgv-keyboard-hints {
  container: keyboard-hints / inline-size;
  display: grid;
  justify-items: center;
  gap: 5px;
  width: 100%;
  margin: 0;
  color: color-mix(in srgb, var(--cgv-ink) 68%, transparent);
  font-size: 10px;
  font-weight: 500;
  line-height: 1.4;
}
.codex-game-view .cgv-keyboard-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.codex-game-view .cgv-keyboard-hint {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.codex-game-view .cgv-keycaps { display: inline-flex; align-items: center; gap: 3px; }
.codex-game-view .cgv-keycaps kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 19px;
  height: 19px;
  padding: 2px 5px;
  border: 1px solid color-mix(in srgb, var(--cgv-ink) 10%, transparent);
  border-radius: 5px;
  background: color-mix(in srgb, var(--cgv-ink) 4%, transparent);
  color: var(--cgv-ink);
  font: 10px/1 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.codex-game-view .cgv-keyboard-movement .cgv-keycaps {
  gap: 0;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--cgv-ink) 10%, transparent);
  border-radius: 5px;
  background: color-mix(in srgb, var(--cgv-ink) 4%, transparent);
}
.codex-game-view .cgv-keyboard-movement kbd { min-width: 16px; padding-inline: 2px; border: 0; border-radius: 0; background: transparent; }
.codex-game-view .cgv-keyboard-movement kbd + kbd { border-left: 1px solid color-mix(in srgb, var(--cgv-ink) 10%, transparent); }
@container keyboard-hints (max-width: 310px) {
  .codex-game-view .cgv-keyboard-row { gap: 4px; font-size: 9px; }
  .codex-game-view .cgv-keycaps kbd { min-width: 18px; padding-inline: 3px; font-size: 9px; }
  .codex-game-view .cgv-keyboard-movement kbd { min-width: 15px; padding-inline: 2px; }
}
.codex-game-view .cgv-actions {
  display: flex;
  justify-content: center;
  margin-top: 8px;
}
.codex-game-view .cgv-keyboard-hints[hidden] + .cgv-actions { margin-top: 16px; }
.codex-game-view .cgv-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  min-width: 0;
  min-height: 44px;
  padding: 8px 12px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: color-mix(in srgb, var(--cgv-ink) 72%, transparent);
  font-size: 11.5px;
  line-height: 1.25;
  white-space: nowrap;
}
.codex-game-view .cgv-action svg { width: 16px; height: 16px; }
.codex-game-view .cgv-recording {
  position: absolute;
  left: calc(100% + 4px);
  top: 38%;
  width: 36px;
}
.codex-game-view .cgv-capture-actions { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.codex-game-view .cgv-recording .cgv-capture-button {
  width: 36px;
  height: 40px;
  min-height: 40px;
  flex: none;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  color: color-mix(in srgb, var(--cgv-ink) 70%, transparent);
}
.codex-game-view .cgv-recording .cgv-capture-button svg { width: 15px; height: 15px; }
.codex-game-view .cgv-recording .cgv-capture-button:hover:not(:disabled),
.codex-game-view .cgv-recording .cgv-record-button[data-recording="true"] {
  background: color-mix(in srgb, var(--cgv-ink) 6%, transparent);
  color: var(--cgv-ink);
}
.codex-game-view .cgv-record-indicator {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  max-width: 100%;
}
.codex-game-view .cgv-record-stop { color: #b72434; }
.codex-game-view .cgv-recording .cgv-record-stop svg { width: 12px; height: 12px; }
.codex-game-view .cgv-record-time {
  width: 6ch;
  max-width: 100%;
  overflow: hidden;
  font: 10px/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
  font-variant-numeric: tabular-nums;
  text-align: center;
  text-overflow: ellipsis;
}
.codex-game-view .cgv-capture-toast {
  position: fixed;
  z-index: 30;
  bottom: max(14px, env(safe-area-inset-bottom));
  left: 50%;
  transform: translateX(-50%);
  width: min(360px, calc(100vw - 28px));
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--cgv-ink) 18%, transparent);
  border-radius: 11px;
  background: var(--cgv-background);
  color: var(--cgv-ink);
  box-shadow: 0 5px 24px #0002;
  overflow-wrap: anywhere;
}
.codex-game-view .cgv-toast-heading { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.codex-game-view .cgv-capture-status { font-size: 12px; font-weight: 600; line-height: 1.4; }
.codex-game-view .cgv-recording .cgv-toast-dismiss {
  flex: none;
  width: 28px;
  min-height: 28px;
  padding: 0;
  margin: -4px -5px -4px 0;
}
.codex-game-view .cgv-toast-dismiss svg { width: 13px; height: 13px; }
.codex-game-view .cgv-toast-detail { margin: 3px 0 0; font-size: 10.5px; line-height: 1.45; opacity: .76; }
.codex-game-view .cgv-toast-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 5px 13px; margin-top: 6px; }
.codex-game-view .cgv-capture-link { color: var(--cgv-ink); font-size: 11px; line-height: 1.5; text-underline-offset: 3px; }
.codex-game-view .cgv-capture-link:focus-visible { outline: 2px solid var(--cgv-ink); outline-offset: 3px; }
.codex-game-view .cgv-recording .cgv-toast-action { min-height: 26px; padding: 3px 0; font-size: 11px; }
.codex-game-view .cgv-copy-path {
  display: block;
  width: 100%;
  min-width: 0;
  margin-top: 7px;
  padding: 5px;
  border: 1px solid color-mix(in srgb, var(--cgv-ink) 25%, transparent);
  border-radius: 4px;
  background: transparent;
  color: var(--cgv-ink);
  font: 10px/1.4 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.codex-game-view .cgv-install-slot { display: flex; justify-content: center; width: min(280px, 100%); min-width: 0; margin: 10px auto 0; }
.codex-game-view .cgv-install-slot:empty { display: none; }
.codex-game-view .cgv-notice-stack { position: absolute; z-index: 12; bottom: 50px; left: 50%; transform: translateX(-50%); display: grid; gap: 6px; width: min(280px, 100%); }
.codex-game-view[data-source=device] .cgv-notice-stack > :is(.cgv-capture-toast,.cgv-color-feedback,.cgv-status) { display: none; }
.codex-game-view .cgv-notice-stack .cgv-capture-toast { position: static; transform: none; width: 100%; box-sizing: border-box; }
.codex-game-view .cgv-notice-stack .cgv-toast-dismiss { flex: none; width: 28px; min-height: 28px; padding: 0; margin: -4px -5px -4px 0; }
.codex-game-view .cgv-notice-stack .cgv-toast-action { min-height: 26px; padding: 3px 0; font-size: 11px; }
.codex-game-view .cgv-color-feedback,
.codex-game-view .cgv-status { margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--cgv-ink); color: var(--cgv-background); box-shadow: 0 4px 16px #0002; font-size: 11px; line-height: 1.4; text-align: center; overflow-wrap: anywhere; cursor: pointer; }
.codex-game-view .cgv-color-feedback:empty,
.codex-game-view .cgv-status:empty { display: none; }
.codex-game-view [hidden] { display: none !important; }
@media (prefers-reduced-motion: no-preference) {
  .codex-game-view .cgv-icon-button, .codex-game-view .cgv-action {
    transition: background .15s ease, color .15s ease;
  }
}
`;
export function createPlayerView(canvas, title) {
    const doc = canvas.ownerDocument;
    const game = canvas.closest("#game");
    const originalParent = game?.parentNode;
    if (!game || !originalParent || !doc.body)
        throw new Error("The official game canvas must be mounted before creating the player view.");
    const originalNext = game.nextSibling;
    const marker = doc.createComment("Official browser player location");
    const hadBodyClass = doc.body.classList.contains(BODY_CLASS);
    const element = (tag, className) => {
        const node = doc.createElement(tag);
        node.className = className;
        return node;
    };
    const icon = (name) => {
        const svg = doc.createElementNS(SVG_NS, "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        const path = doc.createElementNS(SVG_NS, "path");
        path.setAttribute("d", ICONS[name]);
        svg.append(path);
        return svg;
    };
    const button = (action, label, className) => {
        const node = element("button", className);
        node.type = "button";
        node.dataset.action = action;
        node.setAttribute("aria-label", label);
        node.dataset.tooltip = label;
        return node;
    };
    const iconButton = (action, label, name) => {
        const node = button(action, label, "cgv-icon-button");
        node.append(icon(name));
        return node;
    };
    const root = element("section", "codex-game-view");
    root.id = "codex-player";
    root.dataset.source = "emulator";
    root.setAttribute("aria-label", "Game player");
    const header = element("header", "cgv-header");
    const modes = element("nav", "cgv-source-modes");
    modes.setAttribute("aria-label", "Preview source");
    const emulationMode = iconButton("source-emulator", "Live view", "device");
    emulationMode.dataset.tooltip = "Return to emulation";
    emulationMode.setAttribute("aria-pressed", "true");
    emulationMode.hidden = true;
    const deviceMode = iconButton("source-device", "Live view", "device");
    deviceMode.dataset.tooltip = "Switch to live view";
    deviceMode.setAttribute("aria-pressed", "false");
    const deviceChoice = element("span", "cgv-device-choice");
    deviceChoice.append(deviceMode);
    modes.append(emulationMode, deviceChoice);
    const modeViews = element("div", "cgv-mode-views");
    const viewsStage = element("div", "cgv-views-stage");
    const deviceView = element("div", "cgv-device-view");
    deviceView.inert = true;
    deviceView.setAttribute("aria-hidden", "true");
    const player = element("div", "cgv-player");
    const toolbar = element("div", "cgv-toolbar");
    const headerActions = element("div", "cgv-header-actions");
    const deviceActions = element("div", "cgv-device-actions");
    deviceActions.inert = true;
    deviceActions.setAttribute("aria-hidden", "true");
    const heading = element("h1", "cgv-title");
    heading.textContent = title;
    heading.title = title;
    const sound = iconButton("sound", "Mute sound", "sound");
    const play = iconButton("play", "Pause game", "pause");
    const restart = iconButton("restart", "Restart game", "restart");
    const history = iconButton("history", "Saved states", "history");
    history.setAttribute("aria-haspopup", "menu");
    history.setAttribute("aria-expanded", "false");
    history.setAttribute("aria-controls", "codex-history-menu");
    const lastCapture = button("last-capture", "Last capture", "cgv-action");
    lastCapture.textContent = "Last capture";
    lastCapture.disabled = true;
    const more = element("div", "cgv-more");
    const moreToggle = button("more", "More actions", "cgv-icon-button cgv-more-toggle");
    moreToggle.setAttribute("aria-expanded", "false");
    moreToggle.setAttribute("aria-controls", "codex-more-panel");
    const moreIcon = element("span", "");
    moreIcon.setAttribute("aria-hidden", "true");
    moreIcon.textContent = "⋯";
    moreToggle.append(moreIcon);
    const morePanel = element("div", "cgv-more-panel");
    morePanel.id = "codex-more-panel";
    morePanel.hidden = true;
    morePanel.setAttribute("role", "group");
    morePanel.setAttribute("aria-label", "More actions");
    for (const [control, label] of [[restart, "Restart game"], [history, "Saved states"]]) {
        control.className = "cgv-action";
        const text = element("span", "");
        text.textContent = label;
        control.append(text);
        morePanel.append(control);
    }
    morePanel.append(lastCapture);
    more.append(moreToggle, morePanel);
    const historyMenu = element("div", "cgv-history");
    historyMenu.id = "codex-history-menu";
    historyMenu.hidden = true;
    historyMenu.tabIndex = -1;
    historyMenu.setAttribute("role", "menu");
    historyMenu.setAttribute("aria-label", "Saved states");
    const historyHeading = element("p", "cgv-history-heading");
    historyHeading.textContent = "Saved states";
    historyHeading.setAttribute("aria-hidden", "true");
    const annotate = iconButton("annotate", "Annotate", "annotate");
    annotate.disabled = true;
    toolbar.append(sound, play, annotate, more, historyMenu);
    const deviceStage = element("div", "cgv-device-stage");
    const handheld = element("div", "cgv-handheld");
    const screen = element("div", "cgv-screen");
    const colors = element("div", "cgv-colors");
    colors.setAttribute("role", "group");
    colors.setAttribute("aria-label", "Device color");
    colors.setAttribute("aria-busy", "false");
    const colorFeedback = element("p", "cgv-color-feedback");
    colorFeedback.setAttribute("role", "button");
    colorFeedback.setAttribute("aria-live", "polite");
    colorFeedback.tabIndex = 0;
    const dismissNotice = (notice, dismiss) => {
        notice.title = "Dismiss message";
        notice.addEventListener("click", dismiss);
        notice.addEventListener("keydown", event => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                dismiss();
            }
        });
    };
    dismissNotice(colorFeedback, () => { colorFeedback.textContent = ""; });
    let selectedColor = DEVICE_COLORS[0];
    try {
        const stored = doc.defaultView?.localStorage.getItem(DEVICE_COLOR_KEY);
        selectedColor = DEVICE_COLORS.find(color => color.id === stored) ?? selectedColor;
    }
    catch { /* The color picker also works when browser storage is unavailable. */ }
    const previousBodyColors = ["--cgv-background", "--cgv-ink"].map(name => ({
        name, value: doc.body.style.getPropertyValue(name), priority: doc.body.style.getPropertyPriority(name),
    }));
    for (const color of DEVICE_COLORS) {
        const swatch = button("device-color", color.id === "codex" ? color.name : `${color.name} device`, "cgv-color");
        swatch.dataset.deviceColor = color.id;
        swatch.dataset.tooltip = color.name;
        const chip = element("span", "cgv-color-chip");
        chip.style.backgroundColor = color.id === "codex" ? "transparent" : color.background;
        chip.setAttribute("aria-hidden", "true");
        if (color.id === "codex") {
            chip.classList.add("cgv-codex-chip");
            chip.style.color = "var(--cgv-ink)";
            const logo = icon("codex");
            logo.setAttribute("viewBox", "180 180 356 356");
            logo.setAttribute("fill-rule", "evenodd");
            chip.append(logo);
        }
        swatch.append(chip);
        colors.append(swatch);
    }
    const paintColor = () => {
        root.dataset.deviceColor = selectedColor.id;
        for (const [name, value] of [["--cgv-background", selectedColor.background], ["--cgv-ink", selectedColor.ink]]) {
            doc.body.style.setProperty(name, value);
        }
        for (const swatch of Array.from(colors.children)) {
            swatch.setAttribute("aria-pressed", String(swatch.getAttribute("data-device-color") === selectedColor.id));
        }
    };
    const deviceImage = (color) => {
        const image = element("img", "cgv-shell");
        image.alt = "";
        image.setAttribute("aria-hidden", "true");
        image.draggable = false;
        image.decoding = "async";
        image.src = new URL(`./chromatic-${color.id}.webp`, import.meta.url).href;
        return image;
    };
    let shell = deviceImage(selectedColor);
    paintColor();
    let colorGeneration = 0;
    const selectColor = async (color) => {
        const generation = ++colorGeneration;
        colorFeedback.textContent = "";
        if (color.id === selectedColor.id) {
            colors.setAttribute("aria-busy", "false");
            return;
        }
        colors.setAttribute("aria-busy", "true");
        const next = deviceImage(color);
        try {
            await next.decode();
            if (destroyed || generation !== colorGeneration)
                return;
            shell.replaceWith(next);
            shell = next;
            selectedColor = color;
            paintColor();
            try {
                doc.defaultView?.localStorage.setItem(DEVICE_COLOR_KEY, color.id);
            }
            catch { /* Keep the current selection usable. */ }
        }
        catch {
            if (!destroyed && generation === colorGeneration)
                colorFeedback.textContent = "That color could not load. Try again.";
        }
        finally {
            if (!destroyed && generation === colorGeneration)
                colors.setAttribute("aria-busy", "false");
        }
    };
    const colorClick = (event) => {
        const id = event.target?.closest("button[data-device-color]")?.dataset.deviceColor;
        const color = DEVICE_COLORS.find(candidate => candidate.id === id);
        if (color)
            void selectColor(color);
    };
    colors.addEventListener("click", colorClick);
    const gameButtons = new Map();
    const controls = element("div", "cgv-device-controls");
    controls.setAttribute("role", "group");
    controls.setAttribute("aria-label", "Game controls");
    for (const [name, label] of [
        ["up", "D-pad up"], ["down", "D-pad down"], ["left", "D-pad left"], ["right", "D-pad right"],
        ["b", "B button"], ["a", "A button"], ["select", "Select"], ["start", "Start"],
    ]) {
        const key = button(name, label, "cgv-game-button");
        key.dataset.gameButton = name;
        controls.append(key);
        gameButtons.set(name, key);
    }
    handheld.append(shell, screen, heading, controls);
    deviceStage.append(handheld, colors);
    const keyboardHints = element("div", "cgv-keyboard-hints");
    keyboardHints.setAttribute("role", "group");
    keyboardHints.setAttribute("aria-label", "Keyboard controls");
    const actionHints = element("ul", "cgv-keyboard-row cgv-keyboard-actions");
    actionHints.setAttribute("aria-label", "Keyboard shortcuts");
    const keyboardRows = [actionHints];
    keyboardHints.append(...keyboardRows);
    const hintGroups = [];
    for (const hint of [
        { row: actionHints, keys: ["arrowleft", "arrowup", "arrowdown", "arrowright"], labels: ["←", "↑", "↓", "→"], action: "Move" },
        { row: actionHints, keys: ["z"], labels: ["Z"], action: "A" },
        { row: actionHints, keys: ["x"], labels: ["X"], action: "B" },
        { row: actionHints, keys: ["enter"], labels: ["Enter"], action: "Start" },
        { row: actionHints, keys: ["p"], labels: ["P"], action: "Select" },
    ]) {
        const group = element("li", `cgv-keyboard-hint${hint.action === "Move" ? " cgv-keyboard-movement" : ""}`);
        const keycaps = element("span", "cgv-keycaps");
        for (const label of hint.labels) {
            const keycap = element("kbd", "");
            keycap.textContent = label;
            keycaps.append(keycap);
        }
        const action = element("span", "");
        action.textContent = hint.action;
        group.append(keycaps, action);
        hint.row.append(group);
        hintGroups.push({ node: group, keys: hint.keys, row: hint.row });
    }
    const installSlot = element("div", "cgv-install-slot");
    const sharedFooter = element("div", "cgv-shared-footer");
    const hintArea = element("div", "cgv-hint-area");
    const deviceFooter = element("div", "cgv-device-footer");
    deviceFooter.hidden = true;
    const status = element("p", "cgv-status");
    status.setAttribute("role", "button");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");
    status.tabIndex = 0;
    let dismissedStatus = "";
    dismissNotice(status, () => { dismissedStatus = status.textContent ?? ""; status.textContent = ""; });
    const noticeStack = element("div", "cgv-notice-stack");
    noticeStack.append(deviceFooter, colorFeedback, status);
    const recording = element("div", "cgv-recording");
    deviceStage.append(recording);
    headerActions.append(toolbar, deviceActions);
    header.append(headerActions);
    player.append(deviceStage);
    hintArea.append(keyboardHints);
    sharedFooter.append(hintArea, installSlot, noticeStack);
    viewsStage.append(player, deviceView, modes);
    modeViews.append(viewsStage, sharedFooter);
    root.append(header, modeViews);
    let historyItems = [];
    let historyGeneration = 0;
    let pendingSourceFocus;
    let sourceHadFocus = false;
    const historyWindow = doc.defaultView;
    const historyDate = new Intl.DateTimeFormat(undefined, {
        year: "numeric", month: "short", day: "numeric",
        hour: "numeric", minute: "2-digit", second: "2-digit",
    });
    const closeHistory = (restoreFocus) => {
        const wasOpen = !historyMenu.hidden;
        historyMenu.hidden = true;
        history.setAttribute("aria-expanded", "false");
        historyGeneration++;
        doc.removeEventListener("pointerdown", outsideHistory, true);
        doc.removeEventListener("focusin", outsideHistory, true);
        historyWindow?.removeEventListener("blur", blurHistory);
        if (wasOpen && restoreFocus && !destroyed && !history.disabled && history.isConnected)
            history.focus({ preventScroll: true });
    };
    const outsideHistory = (event) => {
        const path = event.composedPath();
        if (!path.includes(historyMenu) && !path.includes(history))
            closeHistory(false);
    };
    const blurHistory = () => closeHistory(false);
    const focusHistory = (index) => {
        if (historyItems.length === 0) {
            historyMenu.focus({ preventScroll: true });
            return;
        }
        const selected = ((index % historyItems.length) + historyItems.length) % historyItems.length;
        historyItems.forEach((item, at) => { item.tabIndex = at === selected ? 0 : -1; });
        historyItems[selected]?.focus({ preventScroll: true });
        historyItems[selected]?.scrollIntoView({ block: "nearest" });
    };
    const historyKeyDown = (event) => {
        if (historyMenu.hidden)
            return;
        event.stopPropagation();
        const selected = historyItems.indexOf(doc.activeElement);
        switch (event.key) {
            case "ArrowDown":
                event.preventDefault();
                focusHistory(selected + 1);
                break;
            case "ArrowUp":
                event.preventDefault();
                focusHistory(selected < 0 ? -1 : selected - 1);
                break;
            case "Home":
                event.preventDefault();
                focusHistory(0);
                break;
            case "End":
                event.preventDefault();
                focusHistory(historyItems.length - 1);
                break;
            case "Escape":
                event.preventDefault();
                closeHistory(true);
                break;
            case "Tab":
                closeHistory(true);
                break;
        }
    };
    const historyKeyUp = (event) => event.stopPropagation();
    historyMenu.addEventListener("keydown", historyKeyDown);
    historyMenu.addEventListener("keyup", historyKeyUp);
    const closeMore = (restoreFocus) => {
        if (morePanel.hidden)
            return;
        closeHistory(false);
        morePanel.hidden = true;
        moreToggle.setAttribute("aria-expanded", "false");
        moreToggle.setAttribute("aria-label", "More actions");
        moreToggle.dataset.tooltip = "More actions";
        doc.removeEventListener("pointerdown", outsideMore, true);
        doc.removeEventListener("focusin", outsideMore, true);
        historyWindow?.removeEventListener("blur", blurMore);
        if (restoreFocus && !destroyed)
            moreToggle.focus({ preventScroll: true });
    };
    const outsideMore = (event) => {
        const path = event.composedPath();
        if (!path.includes(more) && !path.includes(historyMenu))
            closeMore(false);
    };
    const blurMore = () => closeMore(false);
    const toggleMore = () => {
        if (!morePanel.hidden) {
            closeMore(false);
            return;
        }
        morePanel.hidden = false;
        moreToggle.setAttribute("aria-expanded", "true");
        moreToggle.setAttribute("aria-label", "Close more actions");
        moreToggle.dataset.tooltip = "Close more actions (Esc)";
        doc.addEventListener("pointerdown", outsideMore, true);
        doc.addEventListener("focusin", outsideMore, true);
        historyWindow?.addEventListener("blur", blurMore);
    };
    const moreKeyDown = (event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !morePanel.hidden) {
            event.preventDefault();
            closeMore(true);
        }
    };
    const moreKeyUp = (event) => event.stopPropagation();
    const moreClick = (event) => {
        const path = event.composedPath();
        if (path.includes(lastCapture))
            closeMore(false);
        else if (path.includes(restart))
            closeMore(true);
    };
    more.addEventListener("keydown", moreKeyDown);
    more.addEventListener("keyup", moreKeyUp);
    morePanel.addEventListener("click", moreClick);
    const style = doc.createElement("style");
    style.dataset.codexGameView = "";
    style.textContent = STYLES + SOURCE_MODE_STYLES;
    doc.head.append(style);
    doc.body.classList.add(BODY_CLASS);
    originalParent.insertBefore(marker, game);
    originalParent.insertBefore(root, game);
    screen.append(game);
    const destroyTooltips = mountControlTooltips(root);
    let destroyed = false;
    // The still-mounted emulator is the geometry anchor, including after resize.
    const alignDevice = () => {
        const top = deviceStage.getBoundingClientRect().top - modeViews.getBoundingClientRect().top;
        deviceView.style.setProperty("--cgv-device-top", `${top}px`);
    };
    const deviceGeometry = new ResizeObserver(alignDevice);
    deviceGeometry.observe(player);
    alignDevice();
    const view = {
        root, emulationMode, deviceMode, deviceView, deviceActions, deviceFooter, notices: noticeStack, play, sound, restart, history, annotate, moreToggle, toggleMore, recording, lastCapture, gameButtons,
        setDeviceUnavailable(reason) {
            if (reason) {
                deviceChoice.tabIndex = 0;
                deviceChoice.dataset.unavailable = "true";
                deviceChoice.dataset.tooltip = reason;
                deviceChoice.setAttribute("role", "group");
                deviceChoice.setAttribute("aria-label", `Device unavailable. ${reason}`);
            }
            else {
                deviceChoice.removeAttribute("tabindex");
                deviceChoice.removeAttribute("role");
                deviceChoice.removeAttribute("aria-label");
                delete deviceChoice.dataset.unavailable;
                delete deviceChoice.dataset.tooltip;
            }
        },
        rememberSourceFocus() { sourceHadFocus = doc.activeElement === emulationMode || doc.activeElement === deviceMode; },
        setSourceMode(mode) {
            const focusedMode = doc.activeElement === emulationMode || doc.activeElement === deviceMode;
            if (mode === "device")
                closeMore(false);
            alignDevice();
            root.dataset.source = mode;
            player.inert = mode === "device";
            toolbar.inert = mode === "device";
            toolbar.setAttribute("aria-hidden", String(mode === "device"));
            deviceView.inert = mode !== "device";
            deviceActions.inert = mode !== "device";
            deviceActions.setAttribute("aria-hidden", String(mode !== "device"));
            keyboardHints.setAttribute("aria-hidden", String(mode === "device"));
            recording.hidden = mode === "device";
            deviceFooter.hidden = mode !== "device";
            colorFeedback.hidden = mode === "device";
            deviceView.setAttribute("aria-hidden", String(mode !== "device"));
            emulationMode.hidden = mode !== "device";
            deviceChoice.hidden = mode === "device";
            emulationMode.setAttribute("aria-pressed", String(mode === "device"));
            deviceMode.setAttribute("aria-pressed", String(mode === "device"));
            if (focusedMode || sourceHadFocus)
                pendingSourceFocus = mode === "device" ? emulationMode : deviceMode;
            if (mode === "emulator") {
                paintColor();
                try {
                    const color = DEVICE_COLORS.find(c => c.id === doc.defaultView?.localStorage.getItem(DEVICE_COLOR_KEY));
                    if (color)
                        void selectColor(color);
                }
                catch { /* Optional preference only. */ }
            }
        },
        restoreSourceFocus() {
            const target = pendingSourceFocus;
            pendingSourceFocus = undefined;
            sourceHadFocus = false;
            if (target && !target.disabled && !destroyed && (doc.activeElement === doc.body || doc.activeElement === target))
                target.focus({ preventScroll: true });
        },
        setPaused(paused) {
            root.dataset.paused = String(paused);
            const label = paused ? "Resume game" : "Pause game";
            play.setAttribute("aria-label", label);
            play.dataset.tooltip = label;
            play.replaceChildren(icon(paused ? "play" : "pause"));
        },
        setMuted(muted) {
            root.dataset.muted = String(muted);
            const label = muted ? "Enable sound" : "Mute sound";
            sound.setAttribute("aria-label", label);
            sound.dataset.tooltip = label;
            sound.replaceChildren(icon(muted ? "muted" : "sound"));
        },
        setAnnotating(active) {
            root.dataset.annotating = String(active);
            annotate.setAttribute("aria-pressed", String(active));
            const label = active ? "Exit annotation mode" : "Annotate game";
            annotate.setAttribute("aria-label", label);
            annotate.dataset.tooltip = label;
        },
        setKeyboardHints(keys) {
            const available = new Set(keys.map(key => key.toLowerCase()));
            for (const group of hintGroups)
                group.node.hidden = !group.keys.every(key => available.has(key));
            for (const row of keyboardRows)
                row.hidden = hintGroups.filter(group => group.row === row).every(group => group.node.hidden);
            keyboardHints.hidden = hintGroups.every(group => group.node.hidden);
            for (const [button, key, label] of [
                ["up", "arrowup", "↑"], ["down", "arrowdown", "↓"], ["left", "arrowleft", "←"], ["right", "arrowright", "→"],
                ["a", "z", "Z"], ["b", "x", "X"], ["start", "enter", "Enter"], ["select", "p", "P"],
            ]) {
                const control = gameButtons.get(button);
                const name = control.getAttribute("aria-label");
                control.dataset.tooltip = available.has(key) ? `${name} (${label})` : name;
            }
        },
        beginHistoryRequest() {
            const generation = ++historyGeneration;
            return () => !destroyed && root.isConnected && !morePanel.hidden && generation === historyGeneration;
        },
        showHistory(states, choose) {
            if (destroyed || !root.isConnected || morePanel.hidden)
                return;
            const focusedId = historyItems.find(item => item === doc.activeElement)?.dataset.stateId;
            const generation = ++historyGeneration;
            historyItems = [];
            const entries = states.map(state => ({ state, timestamp: Date.parse(state.createdAt) }))
                .sort((left, right) => (Number.isFinite(right.timestamp) ? right.timestamp : -Infinity) -
                (Number.isFinite(left.timestamp) ? left.timestamp : -Infinity));
            const rows = doc.createDocumentFragment();
            rows.append(historyHeading);
            for (const { state, timestamp } of entries) {
                const item = button("open-history-state", "", "cgv-history-item");
                item.removeAttribute("aria-label");
                item.removeAttribute("title");
                delete item.dataset.tooltip;
                item.setAttribute("role", "menuitem");
                item.dataset.stateId = state.id;
                item.tabIndex = -1;
                const date = element("time", "");
                date.textContent = Number.isFinite(timestamp) ? historyDate.format(timestamp) : "Time unavailable";
                if (Number.isFinite(timestamp))
                    date.dateTime = new Date(timestamp).toISOString();
                item.append(date);
                item.addEventListener("click", () => {
                    if (destroyed || historyMenu.hidden || generation !== historyGeneration)
                        return;
                    closeHistory(true);
                    choose(state.id);
                });
                historyItems.push(item);
                rows.append(item);
            }
            if (historyItems.length === 0) {
                const empty = element("p", "cgv-history-empty");
                empty.id = "codex-history-empty";
                empty.textContent = "No saved moments yet.";
                rows.append(empty);
                historyMenu.setAttribute("aria-describedby", empty.id);
            }
            else
                historyMenu.removeAttribute("aria-describedby");
            historyMenu.replaceChildren(rows);
            historyMenu.hidden = false;
            history.setAttribute("aria-expanded", "true");
            doc.addEventListener("pointerdown", outsideHistory, true);
            doc.addEventListener("focusin", outsideHistory, true);
            historyWindow?.addEventListener("blur", blurHistory);
            const previous = historyItems.findIndex(item => item.dataset.stateId === focusedId);
            focusHistory(previous < 0 ? 0 : previous);
        },
        hideHistory() { closeHistory(true); },
        show(message) {
            if (!message)
                dismissedStatus = "";
            status.textContent = message === dismissedStatus ? "" : message;
        },
        destroy() {
            if (destroyed)
                return;
            destroyed = true;
            destroyTooltips();
            deviceGeometry.disconnect();
            closeMore(false);
            closeHistory(false);
            historyMenu.removeEventListener("keydown", historyKeyDown);
            historyMenu.removeEventListener("keyup", historyKeyUp);
            more.removeEventListener("keydown", moreKeyDown);
            more.removeEventListener("keyup", moreKeyUp);
            morePanel.removeEventListener("click", moreClick);
            doc.removeEventListener("pointerdown", outsideMore, true);
            doc.removeEventListener("focusin", outsideMore, true);
            historyWindow?.removeEventListener("blur", blurMore);
            historyItems = [];
            historyMenu.replaceChildren();
            colors.removeEventListener("click", colorClick);
            for (const { name, value, priority } of previousBodyColors) {
                if (value)
                    doc.body.style.setProperty(name, value, priority);
                else
                    doc.body.style.removeProperty(name);
            }
            if (marker.parentNode)
                marker.parentNode.replaceChild(game, marker);
            else
                originalParent.insertBefore(game, originalNext?.parentNode === originalParent ? originalNext : null);
            root.remove();
            style.remove();
            if (!hadBodyClass)
                doc.body.classList.remove(BODY_CLASS);
        },
    };
    view.setPaused(false);
    view.setMuted(false);
    view.setAnnotating(false);
    return view;
}
//# sourceMappingURL=view.js.map