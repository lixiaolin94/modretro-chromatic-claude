/// <reference lib="dom" />
/**
 * Annotations for the existing GB Studio Binjgb player.
 * Isolated state inspection is adapted from Dominik Kundel's PR #5.
 * The official player continues to own emulation, input, audio and saves.
 */
import { connectAnnotations } from "./native.js";
import { mountPlayerControls } from "./player.js";
import { connectPlayerControl } from "./remote.js";
import { annotationTargets, targetAt, viewportRect } from "./targets.js";
const OAM_RUNTIME = "69aa17be45fec5fde585af4f39ed850b5d64107ec094a6482f316fef2fe7c945";
const OAM_STATE_BYTES = 199_608;
function stateWindow(module, file) {
    const size = module._get_file_data_size(file);
    const pointer = module._get_file_data_ptr(file);
    if (!Number.isSafeInteger(size) || size < 1 || !Number.isSafeInteger(pointer)
        || pointer < 1 || pointer > module.HEAPU8.length - size) {
        throw new Error("The emulator returned an invalid annotation state buffer.");
    }
    return { pointer, size };
}
/** Only the SHA-256-verified runtime above has this serialized sprite layout. */
function stateOam(bytes) {
    if (bytes.length !== OAM_STATE_BYTES || new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true) !== 0x6b57a7e2) {
        throw new Error("The annotation state format differs from the verified runtime.");
    }
    // This core preserves a transient PPU OAM-read lock through restore and LCD
    // disable. Its public reader derives these same four bytes from each 20-byte
    // record (WASM function 21); the saved records themselves remain readable.
    const oam = new Uint8Array(160);
    for (let index = 0; index < 40; index++) {
        const offset = 180_352 + index * 20;
        oam.set([(bytes[offset] + 16) & 255, (bytes[offset + 1] + 8) & 255, bytes[offset + 2], bytes[offset + 3]], index * 4);
    }
    return oam;
}
/** Never changes a register, input callback or checkpoint in the live core. */
export class SnapshotReader {
    module;
    emulator;
    context;
    color;
    epoch = 0;
    session = crypto.randomUUID();
    closed = false;
    constructor(module, emulator, context, color) {
        this.module = module;
        this.emulator = emulator;
        this.context = context;
        this.color = color;
    }
    static async create(factory, rom, context) {
        const module = await factory();
        const pointer = module._malloc(rom.length);
        if (!pointer)
            throw new Error("Could not allocate annotation inspection memory.");
        let emulator = 0;
        let passedToCore = false;
        try {
            module.HEAPU8.set(rom, pointer);
            passedToCore = true;
            emulator = module._emulator_new_simple(pointer, rom.length, 48_000, 4_096, 0);
            if (!emulator)
                throw new Error("Could not create the annotation inspection core.");
            return new SnapshotReader(module, emulator, context, (rom[0x143] & 0x80) !== 0);
        }
        catch (error) {
            // Successful construction transfers ROM ownership to the core. On a
            // rejected construction, discard this dedicated module without assuming
            // whether the vendor already released its input buffer.
            if (emulator)
                module._emulator_delete(emulator);
            else if (!passedToCore)
                module._free(pointer);
            throw error;
        }
    }
    capture(player) {
        if (this.closed)
            throw new Error("Annotation inspection is closed.");
        const live = player.module;
        const inspector = this.module;
        const source = live._state_file_data_new(player.e);
        if (!source)
            throw new Error("Could not capture the game state.");
        let copy = 0;
        try {
            copy = inspector._state_file_data_new(this.emulator);
            if (!copy)
                throw new Error("Could not copy the game state.");
            let sourceWindow = stateWindow(live, source);
            const copyWindow = stateWindow(inspector, copy);
            // The preview bootstrap marks each module only after hashing the actual
            // WASM supplied to its factory. Context metadata alone is insufficient.
            const verifiedOam = this.context.runtimeSha256 === OAM_RUNTIME
                && live.codexRuntimeSha256 === OAM_RUNTIME && inspector.codexRuntimeSha256 === OAM_RUNTIME;
            if (sourceWindow.size !== copyWindow.size || (verifiedOam && sourceWindow.size !== OAM_STATE_BYTES)) {
                throw new Error("The annotation state format differs from the player.");
            }
            if (live._emulator_write_state(player.e, source) !== 0)
                throw new Error("Could not copy the game state.");
            // Other runtime versions may replace the file buffer while serializing.
            sourceWindow = stateWindow(live, source);
            if (sourceWindow.size !== copyWindow.size)
                throw new Error("The annotation state format differs from the player.");
            const bytes = live.HEAPU8.slice(sourceWindow.pointer, sourceWindow.pointer + sourceWindow.size);
            const savedOam = verifiedOam ? stateOam(bytes) : undefined;
            const framePointer = live._get_frame_buffer_ptr(player.e);
            const rgba = new Uint8ClampedArray(live.HEAPU8.slice(framePointer, framePointer + 160 * 144 * 4));
            inspector.HEAPU8.set(bytes, copyWindow.pointer);
            if (inspector._emulator_read_state(this.emulator, copy) !== 0)
                throw new Error("Could not inspect the captured game state.");
            const read = (address) => inspector._emulator_read_mem(this.emulator, address);
            const registers = { lcdc: read(0xff40), scx: read(0xff43), scy: read(0xff42), wx: read(0xff4b), wy: read(0xff4a) };
            // Debug reads obey PPU restrictions. Disable the LCD only in the copy.
            inspector._emulator_write_mem(this.emulator, 0xff40, registers.lcdc & ~0x80);
            const vram = [new Uint8Array(8192), new Uint8Array(8192)];
            for (let bank = 0; bank < (this.color ? 2 : 1); bank++) {
                if (this.color)
                    inspector._emulator_write_mem(this.emulator, 0xff4f, bank);
                for (let offset = 0; offset < 8192; offset++)
                    vram[bank][offset] = read(0x8000 + offset);
            }
            const oam = savedOam ?? Uint8Array.from({ length: 160 }, (_, offset) => read(0xfe00 + offset));
            return {
                ...registers, vram, oam, rgba,
                id: `${this.context.romSha256.slice(0, 12)}:${this.session}:${++this.epoch}`,
                rom: this.context.romPath.split("/").at(-1) ?? "Game",
                sha256: this.context.romSha256,
                sourceRevision: this.context.sourceRevision,
                frame: Math.floor(player.ticks / 70_224),
                cgb: this.color,
            };
        }
        finally {
            live._file_data_delete(source);
            live._free(source);
            if (copy) {
                inspector._file_data_delete(copy);
                inspector._free(copy);
            }
        }
    }
    dispose() {
        if (this.closed)
            return;
        this.closed = true;
        this.module._emulator_delete(this.emulator);
    }
}
/** Account for the official player's optional Super Game Boy border. */
export function gameViewport(canvas) {
    const outer = canvas.getBoundingClientRect();
    if (!((canvas.width === 160 && canvas.height === 144) || (canvas.width === 256 && canvas.height === 224)))
        return null;
    // The official template uses object-fit:contain in a full-window canvas box.
    const scale = Math.min(outer.width / canvas.width, outer.height / canvas.height);
    const bitmap = { x: outer.x + (outer.width - canvas.width * scale) / 2, y: outer.y + (outer.height - canvas.height * scale) / 2, width: canvas.width * scale, height: canvas.height * scale };
    if (canvas.width === 160)
        return bitmap;
    return { x: bitmap.x + 48 * scale, y: bitmap.y + 40 * scale, width: 160 * scale, height: 144 * scale };
}
/** Keep game hotkeys out of a frozen capture while preserving browser/button defaults. */
export function captureGameKey(event, keys, frozen) {
    if (!frozen || event.key === "Escape" || event.key === " " || !Object.hasOwn(keys, event.key.toLowerCase()))
        return;
    event.stopImmediatePropagation();
    const target = event.target;
    const interactive = typeof target?.closest === "function" && target.closest("button,summary,input,select,textarea,[contenteditable]") !== null;
    if (!interactive && !event.metaKey && !event.ctrlKey && !event.altKey)
        event.preventDefault();
}
/** Compose from original captured pixels, with no changes to live WASM memory. */
export function palettePreview(snapshot, targets, palettes, compareTarget) {
    const result = new Uint8ClampedArray(snapshot.rgba);
    for (const target of targets) {
        const colors = palettes.get(target.id);
        if (!colors || target.id === compareTarget)
            continue;
        const replacements = new Map(target.colors.map((original, index) => [original.toLowerCase(), colors[index] ?? original]));
        for (const pixel of target.pixels) {
            const offset = pixel * 4;
            const original = `#${Array.from(snapshot.rgba.subarray(offset, offset + 3), value => value.toString(16).padStart(2, "0")).join("")}`;
            const replacement = replacements.get(original);
            if (!replacement || !/^#[0-9a-f]{6}$/i.test(replacement))
                continue;
            for (let channel = 0; channel < 3; channel++)
                result[offset + channel] = Number.parseInt(replacement.slice(1 + channel * 2, 3 + channel * 2), 16);
        }
    }
    return result;
}
/** Entry failure does not reveal which host policy rejected a request. */
export function createAnnotationEntryFeedback(controls) {
    let entryMessage;
    return {
        result(result) {
            if (result.accepted)
                return;
            entryMessage = {
                unsupported: "This preview cannot start annotations. Use the browser's annotation button.",
                declined: "The browser did not accept the annotation request. Try its annotation button or click Annotate again.",
                exception: "The annotation request failed. Reload the preview and try again.",
            }[result.reason];
            controls.show(entryMessage);
        },
        modeChanged(active) {
            if (!active || entryMessage === undefined)
                return;
            controls.clearMessage(entryMessage);
            entryMessage = undefined;
        },
    };
}
function currentPlayer() {
    return typeof emulator === "undefined" ? null : emulator;
}
function mount(canvas, api, player, reader, controls) {
    let snapshot = null;
    let capturedTicks = 0;
    let targets = [];
    let border;
    const palettes = new Map();
    let compareTarget;
    let disposed = false;
    let ownsPause = false;
    const outline = document.createElement("div");
    outline.setAttribute("aria-hidden", "true");
    outline.style.cssText = "position:fixed;pointer-events:none;z-index:999;outline:2px solid #f2a44a";
    outline.hidden = true;
    document.body.append(outline);
    canvas.setAttribute("oai-annotatable", "Game screen");
    const show = controls.show;
    const entryFeedback = createAnnotationEntryFeedback(controls);
    const current = () => snapshot && currentPlayer() === player && player.isPaused && !player.isRewinding && player.ticks === capturedTicks ? snapshot : null;
    const render = () => {
        const capture = current();
        if (!capture)
            return;
        const pixels = palettePreview(capture, targets, palettes, compareTarget);
        player.video.renderer.uploadTextures(new Uint8Array(pixels.buffer), border);
        player.video.renderTexture();
    };
    const clear = () => {
        if (snapshot && currentPlayer() === player) {
            player.video.uploadTexture();
            player.video.renderTexture();
        }
        snapshot = null;
        targets = [];
        palettes.clear();
        compareTarget = undefined;
        ownsPause = false;
        outline.hidden = true;
        annotations.clear();
        controls.refresh();
    };
    const freeze = () => {
        if (current())
            return;
        if (currentPlayer() !== player || player.isRewinding) {
            show("Finish rewinding before annotating the game.");
            return;
        }
        const running = !player.isPaused;
        try {
            // pause() enters rewind in GB Studio. Cancel the existing loop directly so
            // opening the native editor cannot resume it through the blur handler.
            player.windowBlur();
            player.cancelAnimationFrame();
            player.audio.pause();
            snapshot = reader.capture(player);
            ownsPause = running;
            capturedTicks = player.ticks;
            border = player.video.sgbBuffer ? new Uint8Array(player.video.sgbBuffer) : undefined;
            targets = annotationTargets(snapshot);
            palettes.clear();
            compareTarget = undefined;
            controls.refresh();
            show("");
        }
        catch (error) {
            snapshot = null;
            ownsPause = false;
            if (running && currentPlayer() === player)
                player.resume();
            show("Object annotations are unavailable for this frame.");
            console.warn("Game annotation capture failed", error);
        }
    };
    const colorControls = (id) => {
        const target = current() ? targets.find(target => target.id === id) : undefined;
        if (!target)
            return [];
        return target.colors.map((color, index) => ({ type: "color", label: `Color ${index + 1}`, callback: `palette-${index}`, reference: `game-object-color/${index + 1}`, currentValue: palettes.get(id)?.[index] ?? color }));
    };
    const control = (event) => {
        const capture = current();
        const id = event.virtualTarget?.targetId;
        const target = id ? targets.find(target => target.id === id) : undefined;
        const match = /^palette-([0-3])$/.exec(event.callback);
        if (!capture || !target || !match)
            return;
        const index = Number(match[1]);
        if (!target.colors[index])
            return;
        if (event.action === "preview-original")
            compareTarget = target.id;
        else {
            const colors = [...(palettes.get(target.id) ?? target.colors)];
            if (event.action === "reset")
                colors[index] = target.colors[index];
            else if (typeof event.value === "string" && /^#[0-9a-f]{6}$/i.test(event.value))
                colors[index] = event.value.toLowerCase();
            else
                return;
            palettes.set(target.id, colors);
            compareTarget = undefined;
            annotations.refreshControls();
        }
        render();
    };
    const annotations = connectAnnotations(canvas, api, {
        freeze, snapshot: current, targetAt: (x, y) => targetAt(targets, x, y),
        target: id => current() ? targets.find(target => target.id === id) : undefined,
        viewport: () => gameViewport(canvas), controls: colorControls, control,
        modeChanged(active) {
            entryFeedback.modeChanged(active);
            if (!active && snapshot) {
                const resume = ownsPause && current() !== null;
                clear();
                if (resume) {
                    player.windowBlur();
                    player.resume();
                }
            }
            controls.refresh();
        },
        select(id, hover) {
            const target = current() ? targets.find(target => target.id === (hover ?? id)) : undefined;
            const viewport = gameViewport(canvas);
            outline.hidden = !target || !viewport;
            if (target && viewport) {
                const rect = viewportRect(target.rect, viewport);
                Object.assign(outline.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
            }
        },
    });
    if (!annotations.available) {
        annotations.dispose();
        reader.dispose();
        outline.remove();
        return () => { };
    }
    canvas.dataset.codexAnnotations = "ready";
    controls.setAnnotations({
        active: () => annotations.hasPendingEntry() || annotations.isActive() === true || current() !== null,
        clear,
        exit: () => annotations.exitSelection(),
        start() {
            const result = annotations.startSelection();
            entryFeedback.result(result);
            if (result.accepted && annotations.isActive() === true)
                entryFeedback.modeChanged(true);
        },
    });
    const blockGameInput = (event) => captureGameKey(event, player.keyFuncs, current() !== null);
    window.addEventListener("keydown", blockGameInput, true);
    window.addEventListener("keyup", blockGameInput, true);
    const reposition = () => { outline.hidden = true; annotations.invalidate(); };
    const resize = new ResizeObserver(reposition);
    resize.observe(canvas);
    window.addEventListener("scroll", reposition, { passive: true });
    const interval = window.setInterval(() => { if (snapshot && !current())
        clear(); }, 100);
    return () => {
        if (disposed)
            return;
        disposed = true;
        const restorePlayback = ownsPause && current() !== null;
        clear();
        annotations.dispose();
        reader.dispose();
        resize.disconnect();
        window.clearInterval(interval);
        window.removeEventListener("keydown", blockGameInput, true);
        window.removeEventListener("keyup", blockGameInput, true);
        window.removeEventListener("scroll", reposition);
        controls.setAnnotations(null);
        outline.remove();
        delete canvas.dataset.codexAnnotations;
        if (restorePlayback && currentPlayer() === player)
            player.resume();
    };
}
async function attach(controls) {
    const canvas = document.querySelector("#mainCanvas");
    const api = document.oai?.annotation;
    const player = currentPlayer();
    const raw = document.getElementById("codex-web-annotations-context")?.textContent;
    if (!canvas || !api?.registerSurface || !player?.e || !raw || typeof Binjgb !== "function" || !gameViewport(canvas))
        return null;
    const context = JSON.parse(raw);
    if (!/^[a-f0-9]{64}$/.test(context.romSha256) || typeof context.romPath !== "string" || typeof context.sourceRevision !== "string")
        throw new Error("Invalid game annotation context.");
    const url = new URL(context.romPath, location.href);
    const base = new URL(".", location.href);
    if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname))
        throw new Error("Annotation cartridge is outside this preview.");
    const response = await fetch(url);
    if (!response.ok)
        throw new Error("Annotation cartridge is unavailable.");
    const rom = new Uint8Array(await response.arrayBuffer());
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", rom)), value => value.toString(16).padStart(2, "0")).join("");
    if (digest !== context.romSha256)
        throw new Error("The game build changed. Reopen its preview before annotating.");
    const loaded = player.module.HEAPU8.subarray(player.romDataPtr, player.romDataPtr + rom.length);
    if (loaded.length !== rom.length || !loaded.every((value, index) => value === rom[index]))
        throw new Error("The player cartridge differs from the annotation build.");
    const reader = await SnapshotReader.create(() => Binjgb({ locateFile: name => new URL(`js/${name}`, base).href }), rom, context);
    if (currentPlayer() !== player) {
        reader.dispose();
        return null;
    }
    try {
        return mount(canvas, api, player, reader, controls);
    }
    catch (error) {
        reader.dispose();
        throw error;
    }
}
if (typeof document !== "undefined" && typeof window !== "undefined") {
    let dispose = null;
    let preparing = false;
    let active = true;
    let boundPlayer = null;
    let controls = null;
    let disconnectPlayer = null;
    let controlsPlayer = null;
    let failedPlayer = null;
    const tryAttach = async () => {
        if (!active || preparing)
            return;
        const player = currentPlayer();
        if (controls && player !== controlsPlayer) {
            dispose?.();
            dispose = null;
            disconnectPlayer?.();
            disconnectPlayer = null;
            controls.dispose();
            controls = null;
        }
        if (!controls && player?.e) {
            const canvas = document.querySelector("#mainCanvas");
            const raw = document.getElementById("codex-web-annotations-context")?.textContent;
            if (canvas && raw && gameViewport(canvas)) {
                try {
                    const context = JSON.parse(raw);
                    if (!/^[a-f0-9]{64}$/.test(context.romSha256) || typeof context.romPath !== "string" || typeof context.sourceRevision !== "string")
                        throw new Error("Invalid game preview context.");
                    controls = mountPlayerControls(canvas, player, context, () => currentPlayer() === player);
                    controlsPlayer = player;
                    const mountedControls = controls;
                    disconnectPlayer = connectPlayerControl({ context, player, controls: mountedControls, current: () => active && controls === mountedControls && currentPlayer() === player });
                }
                catch (error) {
                    console.warn("Game preview controls unavailable", error);
                }
            }
        }
        if (dispose && player === boundPlayer)
            return;
        if (dispose) {
            dispose();
            dispose = null;
        }
        if (!player || !controls || player === failedPlayer)
            return;
        preparing = true;
        try {
            const mounted = await attach(controls);
            if (!active)
                mounted?.();
            else {
                dispose = mounted;
                boundPlayer = mounted ? player : null;
            }
        }
        catch (error) {
            failedPlayer = player;
            console.warn("Game annotations unavailable", error);
        }
        finally {
            preparing = false;
        }
    };
    // The official player and the host API may initialize after this module.
    window.setInterval(() => { void tryAttach(); }, 500);
    window.addEventListener("pagehide", () => { active = false; disconnectPlayer?.(); disconnectPlayer = null; dispose?.(); dispose = null; controls?.dispose(); controls = null; controlsPlayer = null; });
    window.addEventListener("pageshow", () => { active = true; failedPlayer = null; void tryAttach(); });
    void tryAttach();
}
//# sourceMappingURL=bridge.js.map