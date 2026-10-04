/// <reference lib="dom" />
/** Combined decoded native state and the two framebuffer payloads. */
export const MAX_SAVE_STATE_BYTES = 1024 * 1024;
export const MAX_SAVE_STATE_FILE_BYTES = Math.ceil(MAX_SAVE_STATE_BYTES / 3) * 4 + 16 * 1024;
const FORMAT = "codex-gb-studio-save-state";
const SHA256 = /^[a-f0-9]{64}$/i;
const MBC5_RUNTIME = "69aa17be45fec5fde585af4f39ed850b5d64107ec094a6482f316fef2fe7c945";
const FRAME_BYTES = 160 * 144 * 4;
const SGB_FRAME_BYTES = 256 * 224 * 4;
export class SaveStateError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "SaveStateError";
    }
}
function invalid(message) { throw new SaveStateError("INVALID_FILE", message); }
function object(value, keys, label) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        invalid(`Invalid ${label}.`);
    const fields = Object.keys(value);
    if (fields.length !== keys.length || fields.some(key => !keys.includes(key)))
        invalid(`Invalid ${label} fields.`);
    return value;
}
function identity(value) {
    const item = object(value, ["romSha256", "runtimeSha256", "sourceRevision", "cartridgeType"], "build identity");
    if (typeof item.romSha256 !== "string" || !SHA256.test(item.romSha256)
        || typeof item.runtimeSha256 !== "string" || !SHA256.test(item.runtimeSha256)
        || typeof item.sourceRevision !== "string" || !item.sourceRevision.trim() || item.sourceRevision.length > 1024
        || !Number.isInteger(item.cartridgeType) || item.cartridgeType < 0 || item.cartridgeType > 255)
        invalid("Invalid build identity.");
    return { romSha256: item.romSha256.toLowerCase(), runtimeSha256: item.runtimeSha256.toLowerCase(), sourceRevision: item.sourceRevision, cartridgeType: item.cartridgeType };
}
function payloadShape(value, label, exactSize) {
    const state = object(value, ["encoding", "byteLength", "sha256", "data"], label);
    if (!Number.isSafeInteger(state.byteLength) || state.byteLength < 1)
        invalid(`Invalid ${label} byte length.`);
    if (state.byteLength > MAX_SAVE_STATE_BYTES)
        throw new SaveStateError("TOO_LARGE", "The saved state exceeds the supported size.");
    if (exactSize !== undefined && state.byteLength !== exactSize)
        invalid(`Invalid ${label} dimensions.`);
    if (state.encoding !== "base64" || typeof state.sha256 !== "string" || !SHA256.test(state.sha256)
        || typeof state.data !== "string" || state.data.length !== Math.ceil(state.byteLength / 3) * 4
        || !/^[A-Za-z0-9+/]*={0,2}$/.test(state.data))
        invalid(`Invalid encoded ${label}.`);
    return { encoding: "base64", byteLength: state.byteLength, sha256: state.sha256.toLowerCase(), data: state.data };
}
function fileShape(value) {
    const item = object(value, ["format", "version", "identity", "frame", "createdAt", "title", "state", "framebuffer", "sgbFramebuffer"], "save state");
    if (item.format !== FORMAT || item.version !== 1)
        invalid("Unsupported save-state format or version.");
    if (!Number.isSafeInteger(item.frame) || item.frame < 0)
        invalid("Invalid saved frame.");
    if (typeof item.createdAt !== "string" || item.createdAt.length > 32 || !Number.isFinite(Date.parse(item.createdAt))
        || new Date(item.createdAt).toISOString() !== item.createdAt)
        invalid("Invalid save-state timestamp.");
    if (typeof item.title !== "string" || !item.title.trim() || item.title.length > 160 || /[\u0000-\u001f\u007f]/.test(item.title))
        invalid("Invalid save-state title.");
    const state = payloadShape(item.state, "state payload");
    const framebuffer = payloadShape(item.framebuffer, "framebuffer", FRAME_BYTES);
    const sgbFramebuffer = payloadShape(item.sgbFramebuffer, "SGB framebuffer", SGB_FRAME_BYTES);
    if (state.byteLength + FRAME_BYTES + SGB_FRAME_BYTES > MAX_SAVE_STATE_BYTES)
        throw new SaveStateError("TOO_LARGE", "The combined save-state payload exceeds the supported size.");
    return {
        format: FORMAT, version: 1, identity: identity(item.identity), frame: item.frame,
        createdAt: item.createdAt, title: item.title,
        state, framebuffer, sgbFramebuffer,
    };
}
async function sha256(bytes) {
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
}
function base64(bytes) {
    const chunks = [];
    for (let offset = 0; offset < bytes.length; offset += 0x8000)
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
    return btoa(chunks.join(""));
}
function boundedText(text) {
    if (typeof text !== "string")
        invalid("Save state must be a JSON file.");
    if (text.length > MAX_SAVE_STATE_FILE_BYTES || new TextEncoder().encode(text).length > MAX_SAVE_STATE_FILE_BYTES) {
        throw new SaveStateError("TOO_LARGE", "The save-state file exceeds the supported size.");
    }
}
/** Safe to inspect before pausing; no native calls occur during parsing. */
export async function parseSaveState(text, expectedIdentity) {
    boundedText(text);
    const expected = identity(expectedIdentity);
    let parsed;
    try {
        parsed = JSON.parse(text);
    }
    catch {
        invalid("Save state is not valid JSON.");
    }
    const file = fileShape(parsed);
    if (file.identity.romSha256 !== expected.romSha256)
        throw new SaveStateError("WRONG_ROM", "This state belongs to a different ROM.");
    if (file.identity.cartridgeType !== expected.cartridgeType)
        throw new SaveStateError("WRONG_ROM", "This state has a different cartridge type.");
    if (file.identity.runtimeSha256 !== expected.runtimeSha256)
        throw new SaveStateError("WRONG_RUNTIME", "This state requires a different emulator runtime.");
    if (file.identity.sourceRevision !== expected.sourceRevision)
        throw new SaveStateError("WRONG_SOURCE", "This state belongs to a different source revision.");
    async function decode(payload) {
        let decoded;
        try {
            decoded = atob(payload.data);
        }
        catch {
            invalid("Invalid base64 state payload.");
        }
        const bytes = Uint8Array.from(decoded, char => char.charCodeAt(0));
        if (bytes.length !== payload.byteLength || base64(bytes) !== payload.data)
            invalid("State payload length or base64 encoding differs.");
        if (await sha256(bytes) !== payload.sha256)
            throw new SaveStateError("INTEGRITY", "The saved state failed its SHA-256 integrity check.");
        return bytes;
    }
    const [bytes, framebuffer, sgbFramebuffer] = await Promise.all([decode(file.state), decode(file.framebuffer), decode(file.sgbFramebuffer)]);
    return { file, bytes, framebuffer, sgbFramebuffer };
}
export function serializeSaveState(file) {
    const text = JSON.stringify(fileShape(file));
    boundedText(text);
    return text;
}
function nativeWindow(module, file) {
    const size = module._get_file_data_size(file);
    const pointer = module._get_file_data_ptr(file);
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_SAVE_STATE_BYTES - FRAME_BYTES - SGB_FRAME_BYTES
        || !Number.isSafeInteger(pointer) || pointer < 1 || pointer > module.HEAPU8.length - size) {
        throw new SaveStateError("NATIVE_STATE", "The emulator returned an invalid or unsupported state buffer.");
    }
    return { pointer, size };
}
function withNativeFile(player, action) {
    if (!Number.isSafeInteger(player.e) || player.e <= 0)
        throw new SaveStateError("NATIVE_STATE", "The emulator is unavailable.");
    const file = player.module._state_file_data_new(player.e);
    if (!file)
        throw new SaveStateError("NATIVE_STATE", "Could not allocate an emulator state buffer.");
    try {
        nativeWindow(player.module, file);
        return action(file);
    }
    finally {
        // The native delete releases data only; the allocated FileData wrapper is separate.
        try {
            player.module._file_data_delete(file);
        }
        finally {
            player.module._free(file);
        }
    }
}
function readState(player, file) {
    if (player.module._emulator_write_state(player.e, file) !== 0)
        throw new SaveStateError("NATIVE_STATE", "The emulator could not serialize its current state.");
    const { pointer, size } = nativeWindow(player.module, file);
    return player.module.HEAPU8.slice(pointer, pointer + size);
}
function loadState(player, file, bytes) {
    const { pointer, size } = nativeWindow(player.module, file);
    if (size !== bytes.length)
        throw new SaveStateError("NATIVE_STATE", "The native state size differs from this save file.");
    player.module.HEAPU8.set(bytes, pointer);
    if (player.module._emulator_read_state(player.e, file) !== 0)
        throw new SaveStateError("NATIVE_STATE", "The emulator rejected the saved state.");
}
function loadExactState(player, file, bytes, verifiedBuild) {
    loadState(player, file, bytes);
    const restored = readState(player, file);
    if (equal(restored, bytes))
        return;
    // This exact vendor core resets only the MBC5 low bank register while loading.
    // Its handler stores raw low/high registers at state[32]/[33] and derives ROM
    // mapping through the public 2000/3000 writes (WASM function110, file89203).
    // No other normalization is accepted, including RAM or cartridge metadata.
    if (verifiedBuild.runtimeSha256 !== MBC5_RUNTIME || verifiedBuild.cartridgeType < 0x19 || verifiedBuild.cartridgeType > 0x1e
        || bytes.length !== 199_608 || restored.length !== bytes.length || restored[32] !== 1
        || restored.some((value, offset) => offset !== 32 && value !== bytes[offset])) {
        throw new SaveStateError("NATIVE_STATE", "The emulator did not restore the complete saved state.");
    }
    player.module._emulator_write_mem(player.e, 0x2000, bytes[32]);
    player.module._emulator_write_mem(player.e, 0x3000, bytes[33]);
    if (!equal(readState(player, file), bytes))
        throw new SaveStateError("NATIVE_STATE", "The emulator did not restore the complete saved state.");
}
function mediaWindows(player) {
    const m = player.module;
    return [[m._get_frame_buffer_ptr(player.e), m._get_frame_buffer_size(player.e), FRAME_BYTES],
        [m._get_sgb_frame_buffer_ptr(player.e), m._get_sgb_frame_buffer_size(player.e), SGB_FRAME_BYTES]].map(([pointer, size, expected]) => {
        if (size !== expected || !Number.isSafeInteger(pointer) || pointer < 1 || pointer > m.HEAPU8.length - size) {
            throw new SaveStateError("NATIVE_STATE", "The emulator returned unsupported framebuffer bounds.");
        }
        return { pointer: pointer, size: size };
    });
}
function readMedia(player) {
    return mediaWindows(player).map(({ pointer, size }) => player.module.HEAPU8.slice(pointer, pointer + size));
}
function writeMedia(player, buffers) {
    const windows = mediaWindows(player);
    for (const [index, window] of windows.entries()) {
        if (buffers[index]?.length !== window.size)
            throw new SaveStateError("NATIVE_STATE", "The saved framebuffer size differs.");
    }
    for (const [index, window] of windows.entries())
        player.module.HEAPU8.set(buffers[index], window.pointer);
}
function equal(a, b) { return a.length === b.length && a.every((value, index) => value === b[index]); }
function message(error) { return error instanceof Error ? error.message.slice(0, 512) : "Native state operation failed."; }
/** The caller keeps the same player paused until this promise settles. */
export async function captureSaveState(player, expectedIdentity, title = "Game state") {
    const build = identity(expectedIdentity);
    if (typeof title !== "string" || !title.trim() || title.length > 160 || /[\u0000-\u001f\u007f]/.test(title))
        invalid("Invalid save-state title.");
    const captured = withNativeFile(player, file => ({ bytes: readState(player, file), media: readMedia(player), frame: Math.floor(player.ticks / 70_224) }));
    if (!Number.isSafeInteger(captured.frame) || captured.frame < 0)
        throw new SaveStateError("NATIVE_STATE", "The emulator returned an invalid frame.");
    if (captured.bytes.length + FRAME_BYTES + SGB_FRAME_BYTES > MAX_SAVE_STATE_BYTES)
        throw new SaveStateError("TOO_LARGE", "The combined save-state payload exceeds the supported size.");
    const createdAt = new Date().toISOString();
    async function payload(bytes) { return { encoding: "base64", byteLength: bytes.length, sha256: await sha256(bytes), data: base64(bytes) }; }
    const [state, framebuffer, sgbFramebuffer] = await Promise.all([payload(captured.bytes), payload(captured.media[0]), payload(captured.media[1])]);
    return {
        format: FORMAT, version: 1, identity: build, frame: captured.frame, createdAt, title, state, framebuffer, sgbFramebuffer,
    };
}
/** Invalid files never reach native state I/O. Failed native loads restore and verify the original state. */
export async function restoreSaveState(player, text, expectedIdentity, canRestore) {
    const verifiedBuild = identity(expectedIdentity);
    const { file: saved, bytes, framebuffer, sgbFramebuffer } = await parseSaveState(text, verifiedBuild);
    if (canRestore && !canRestore())
        throw new SaveStateError("NATIVE_STATE", "The paused player changed while validating this saved state.");
    return withNativeFile(player, file => {
        if (nativeWindow(player.module, file).size !== bytes.length)
            throw new SaveStateError("NATIVE_STATE", "The native state size differs from this save file.");
        const original = readState(player, file);
        const originalMedia = readMedia(player);
        try {
            loadExactState(player, file, bytes, verifiedBuild);
            writeMedia(player, [framebuffer, sgbFramebuffer]);
            return { status: "restored", file: saved };
        }
        catch (error) {
            // A normal rejection can leave the player intact. Do not run a state
            // loader with side effects when the original state is already present.
            let unchanged = false;
            try {
                unchanged = equal(readState(player, file), original);
            }
            catch { /* A partial failure needs a rollback attempt. */ }
            if (unchanged) {
                try {
                    writeMedia(player, originalMedia);
                    return { status: "failed", rollback: "unchanged", error: message(error) };
                }
                catch (rollbackError) {
                    return { status: "failed", rollback: "failed", error: message(error), rollbackError: message(rollbackError) };
                }
            }
            try {
                loadExactState(player, file, original, verifiedBuild);
                writeMedia(player, originalMedia);
                return { status: "failed", rollback: "restored", error: message(error) };
            }
            catch (rollbackError) {
                return { status: "failed", rollback: "failed", error: message(error), rollbackError: message(rollbackError) };
            }
        }
    });
}
//# sourceMappingURL=save-state.js.map