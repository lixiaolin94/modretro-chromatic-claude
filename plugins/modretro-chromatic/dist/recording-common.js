import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, realpathSync, statSync, writeSync, } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { PNG } from "pngjs";
import { recordingArchiveOrigin } from "./recording-location.js";
export const MAX_FRAMES = 3_600;
export const MAX_TIMELINE_ACTIONS = 128;
export const MAX_TIMELINE_CHECKPOINTS = 64;
export const MAX_STEP_SAMPLES = 8;
export const MAX_INSPECTION_BYTES = 256;
export const MAX_OAM_OBJECTS = 40;
export const PROTOCOL_VERSION = 1;
export const GB_HZ = 4_194_304;
export const FRAME_DOTS = 70_224;
export const MAX_RECORDING_BYTES = 512 * 1024 * 1024;
export const MAX_RECORDING_FRAMES = 216_000;
export const MAX_RECORDING_WALL_MS = 3_600_000;
export const MAX_RECENT_FRAMES = 64;
export const MAX_CLIP_FRAMES = 600;
export const MAX_STATE_BYTES = 16 * 1024 * 1024;
export const MAX_ROM_BYTES = 32 * 1024 * 1024;
export const MAX_RECORDING_EVENTS = 250_000;
export const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
export const MAX_RECORDING_EVENT_BYTES = 32 * 1024 * 1024;
export const MAX_REVIEW_ACTIONS = 4_096;
export const MAX_REVIEW_IMAGES = 8;
export const MAX_REVIEW_METADATA_BYTES = 2 * 1024 * 1024;
export const MAX_REVIEW_FRAME_RECORDS = MAX_FRAMES + MAX_REVIEW_ACTIONS + 1;
export const RECORDING_RESERVE_BYTES = 16 * 1024;
export const MAX_SIBLING_RECORDINGS = 64;
export const MAX_SIBLING_RESERVED_BYTES = 1024 * 1024 * 1024;
export const MAX_RECORDING_BRANCHES = 64;
export const WIDTH = 160;
export const HEIGHT = 144;
export const RGBA_BYTES = WIDTH * HEIGHT * 4;
export const DEFAULT_RECORDING_LIMITS = {
    sampleEveryFrames: 4, recentFrameCount: 12, maxBytes: 64 * 1024 * 1024,
    maxFrames: 36_000, maxWallTimeMs: 900_000,
};
export const BUTTONS = new Set(["a", "b", "up", "down", "left", "right", "start", "select"]);
export const MEMORY_REGIONS = {
    vram: [0x8000, 0x2000], wram: [0xc000, 0x2000], oam: [0xfe00, 0xa0], hram: [0xff80, 0x7f],
};
export class RecordingLimitError extends Error {
}
export class SessionCancelled extends Error {
}
export class RequestValidationError extends Error {
}
export function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}
export function boundedInteger(value, name, minimum, maximum) {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
        throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
    }
    return value;
}
export function sha256String(value, name) {
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value))
        throw new Error(`${name} must be a lowercase SHA-256 digest`);
    return value;
}
export function recordingBranchId(value) {
    if (typeof value !== "string" || value.length < 11 || value.length > 100 || !/^branch-[0-9]+$/.test(value)) {
        throw new Error("An exact recording branchId is required");
    }
    return value;
}
export function recordingPrefixPin(value) {
    if (!isObject(value) || Object.keys(value).sort().join(",") !== "byteLength,eventCount,eventDigest,sha256") {
        throw new Error("A recording prefix pin requires eventCount, eventDigest, byteLength, and sha256");
    }
    return {
        eventCount: boundedInteger(value.eventCount, "prefix event count", 1, MAX_RECORDING_EVENTS),
        eventDigest: sha256String(value.eventDigest, "prefix event digest"),
        byteLength: boundedInteger(value.byteLength, "prefix byte length", 1, MAX_RECORDING_BYTES),
        sha256: sha256String(value.sha256, "prefix SHA-256"),
    };
}
export function recordedButtons(value) {
    if (!Array.isArray(value) || value.length > BUTTONS.size || value.some((item) => typeof item !== "string" || !BUTTONS.has(item)) || new Set(value).size !== value.length) {
        throw new Error("Recording contains an invalid controller button set");
    }
    return [...value];
}
export function normalizedRecordedAction(value) {
    if (!isObject(value))
        throw new Error("Recording contains an invalid normalized action");
    if (value.type === "step" && Object.keys(value).sort().join(",") === "frames,type") {
        return { type: "step", frames: boundedInteger(value.frames, "recorded step", 1, MAX_FRAMES) };
    }
    if (value.type === "set_buttons" && Object.keys(value).sort().join(",") === "buttons,type") {
        return { type: "set_buttons", buttons: recordedButtons(value.buttons) };
    }
    throw new Error("Recording contains an unsupported normalized action");
}
export function recordingLimits(value) {
    if (!isObject(value))
        throw new Error("The recording option must be an object or false");
    const unknown = Object.keys(value).filter((key) => key !== "outputPath" && !Object.hasOwn(DEFAULT_RECORDING_LIMITS, key));
    if (unknown.length)
        throw new Error(`Unknown recording options: ${unknown.sort().join(", ")}`);
    const bounds = {
        sampleEveryFrames: [1, MAX_FRAMES], recentFrameCount: [1, MAX_RECENT_FRAMES],
        maxBytes: [64 * 1024, MAX_RECORDING_BYTES], maxFrames: [1, MAX_RECORDING_FRAMES], maxWallTimeMs: [1, MAX_RECORDING_WALL_MS],
    };
    return Object.fromEntries(Object.entries(DEFAULT_RECORDING_LIMITS).map(([key, fallback]) => {
        const [minimum, maximum] = bounds[key];
        return [key, boundedInteger(Object.hasOwn(value, key) ? value[key] : fallback, key, minimum, maximum)];
    }));
}
function compareUnicode(left, right) {
    const a = Array.from(left, (value) => value.codePointAt(0));
    const b = Array.from(right, (value) => value.codePointAt(0));
    for (let index = 0; index < Math.min(a.length, b.length); index += 1) {
        if (a[index] !== b[index])
            return a[index] - b[index];
    }
    return a.length - b.length;
}
function asciiString(value) {
    return JSON.stringify(value).replace(/[\u007f-\uffff]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
}
/** Sorted ASCII JSON for new records. Python key/string ordering is retained;
 * legacy floating-point spellings are authenticated by canonicalEventPayload.
 */
export function encoded(value) {
    function encode(item) {
        if (item === null)
            return "null";
        if (typeof item === "string")
            return asciiString(item);
        if (typeof item === "boolean")
            return String(item);
        if (typeof item === "number" && Number.isFinite(item))
            return JSON.stringify(item);
        if (Array.isArray(item))
            return `[${item.map(encode).join(",")}]`;
        if (isObject(item))
            return `{${Object.keys(item).sort(compareUnicode).map((key) => `${asciiString(key)}:${encode(item[key])}`).join(",")}}`;
        throw new Error("Recording JSON must contain only finite JSON values");
    }
    return Buffer.from(encode(value), "utf8");
}
/** Preserve Python's floating-point lexemes when authenticating old journals.
 * JSON.parse alone destroys the distinction between 1.0 and 1. We canonicalize
 * strings, key order and whitespace, but retain the writer's number tokens.
 */
export function canonicalEventPayload(line) {
    const source = Buffer.from(line).toString("utf8");
    let offset = 0;
    const whitespace = () => { while (/\s/.test(source[offset] ?? "") && offset < source.length)
        offset += 1; };
    const string = () => {
        const start = offset++;
        while (offset < source.length) {
            const character = source[offset++];
            if (character === "\\")
                offset += 1;
            else if (character === '"')
                return JSON.parse(source.slice(start, offset));
        }
        throw new Error("Unterminated recording JSON string");
    };
    const parse = (depth) => {
        if (depth > 128)
            throw new Error("Recording JSON nesting exceeds its limit");
        whitespace();
        if (source[offset] === '"')
            return asciiString(string());
        if (source[offset] === "{") {
            offset += 1;
            const members = new Map();
            whitespace();
            while (source[offset] !== "}") {
                if (source[offset] !== '"')
                    throw new Error("Invalid recording JSON object");
                const key = string();
                whitespace();
                if (source[offset++] !== ":")
                    throw new Error("Invalid recording JSON member");
                const value = parse(depth + 1);
                if (members.has(key))
                    throw new Error("Duplicate recording JSON member");
                members.set(key, value);
                whitespace();
                if (source[offset] === "}")
                    break;
                if (source[offset++] !== ",")
                    throw new Error("Invalid recording JSON separator");
                whitespace();
            }
            offset += 1;
            if (depth === 0)
                members.delete("digest");
            return `{${[...members.keys()].sort(compareUnicode).map((key) => `${asciiString(key)}:${members.get(key)}`).join(",")}}`;
        }
        if (source[offset] === "[") {
            offset += 1;
            const values = [];
            whitespace();
            while (source[offset] !== "]") {
                values.push(parse(depth + 1));
                whitespace();
                if (source[offset] === "]")
                    break;
                if (source[offset++] !== ",")
                    throw new Error("Invalid recording JSON array");
            }
            offset += 1;
            return `[${values.join(",")}]`;
        }
        const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(offset));
        if (!match)
            throw new Error("Invalid recording JSON value");
        offset += match[0].length;
        return match[0];
    };
    if (source.trimStart()[0] !== "{")
        throw new Error("A recording event must be an object");
    const result = parse(0);
    whitespace();
    if (offset !== source.length)
        throw new Error("Unexpected trailing recording JSON bytes");
    return Buffer.from(result, "utf8");
}
export function digest(value) { return createHash("sha256").update(value).digest("hex"); }
export function sameJson(left, right) { return encoded(left).equals(encoded(right)); }
export function inside(root, value) {
    const path = relative(root, value);
    return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
}
/** Canonical authorization remains independent of evidence hash authentication. */
export function projectResolver(projectRoot) {
    const root = realpathSync(projectRoot);
    const identity = statSync(root);
    if (!identity.isDirectory())
        throw new Error("The emulator project root must be a directory");
    return (value, { existing }) => {
        const now = lstatSync(root);
        if (now.isSymbolicLink() || now.dev !== identity.dev || now.ino !== identity.ino || realpathSync(root) !== root)
            throw new Error("The authorized emulator project root changed");
        if (typeof value !== "string" || !value.trim() || value.includes("\0"))
            throw new Error("A non-empty project-relative or absolute path is required");
        // The server already expands user paths. Workers do not independently grant
        // access to the host home directory or Windows device/network namespaces.
        if (value.startsWith("~") || /^\\\\|^\/\//.test(value) || /^(?:\\\\[?.]\\)/.test(value))
            throw new Error("Emulator paths must use an authorized local path");
        const lexical = resolve(root, value);
        if (!inside(root, lexical))
            throw new Error("Emulator paths must remain inside the project root");
        let ancestor = lexical;
        const tail = [];
        for (;;) {
            try {
                lstatSync(ancestor);
                break;
            }
            catch (error) {
                if (error.code !== "ENOENT" || existing)
                    throw error;
                const parent = dirname(ancestor);
                if (parent === ancestor)
                    throw error;
                tail.unshift(ancestor.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
                ancestor = parent;
            }
        }
        const canonical = resolve(realpathSync(ancestor), ...tail);
        if (!inside(root, canonical))
            throw new Error("Emulator paths must remain inside the project root");
        return canonical;
    };
}
/** Bounded, no-follow, regular-file read with path/fd identity checked twice. */
export function boundedReadFile(path, maximum, label = "Recording metadata") {
    const before = lstatSync(path);
    if (!before.isFile() || before.isSymbolicLink())
        throw new Error(`${label} must be a regular file`);
    if (before.size > maximum)
        throw new Error(`${label} exceeds its byte limit`);
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino)
            throw new Error(`${label} changed before read`);
        const chunks = [];
        let size = 0;
        for (;;) {
            const buffer = Buffer.alloc(Math.min(64 * 1024, maximum + 1 - size));
            if (!buffer.length)
                throw new Error(`${label} exceeds its byte limit`);
            const count = readSync(fd, buffer, 0, buffer.length, null);
            if (count === 0)
                break;
            size += count;
            if (size > maximum)
                throw new Error(`${label} exceeds its byte limit`);
            chunks.push(buffer.subarray(0, count));
        }
        const after = fstatSync(fd);
        const pathAfter = lstatSync(path);
        if (after.size !== size || after.dev !== pathAfter.dev || after.ino !== pathAfter.ino || !pathAfter.isFile() || pathAfter.isSymbolicLink() || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs) {
            throw new Error(`${label} changed while being read`);
        }
        return Buffer.concat(chunks, size);
    }
    finally {
        closeSync(fd);
    }
}
export function writeExclusive(path, data, resolvePath, onCreated) {
    if (resolvePath(path, { existing: false }) !== path)
        throw new Error("The artifact output path changed");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    if (resolvePath(path, { existing: false }) !== path)
        throw new Error("The artifact output directory changed");
    const parent = lstatSync(dirname(path));
    if (!parent.isDirectory() || parent.isSymbolicLink())
        throw new Error("The artifact output directory is invalid");
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
    try {
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.nlink !== 1)
            throw new Error("An artifact must be a regular file with one link");
        onCreated?.(opened);
        if (resolvePath(path, { existing: true }) !== path)
            throw new Error("The artifact path changed before write");
        let written = 0;
        while (written < data.length) {
            const count = writeSync(fd, data, written, data.length - written);
            if (count <= 0)
                throw new Error("The artifact could not be written completely");
            written += count;
        }
        const after = lstatSync(path);
        const parentAfter = lstatSync(dirname(path));
        if (after.dev !== opened.dev || after.ino !== opened.ino || after.nlink !== 1 || after.isSymbolicLink() || after.size !== data.length || parentAfter.dev !== parent.dev || parentAfter.ino !== parent.ino || resolvePath(path, { existing: true }) !== path) {
            throw new Error("The artifact path changed during write");
        }
    }
    finally {
        closeSync(fd);
    }
}
export function directoryBytes(root) {
    let total = 0;
    let count = 0;
    const walk = (directory) => {
        const identity = lstatSync(directory);
        if (!identity.isDirectory() || identity.isSymbolicLink())
            throw new Error("Recording files and directories must not be symbolic links");
        for (const name of readdirSync(directory)) {
            const path = join(directory, name);
            const stat = lstatSync(path);
            count += 1;
            if (count > MAX_RECORDING_EVENTS)
                throw new RecordingLimitError("Recording storage exceeds the supported limit");
            if (stat.isSymbolicLink())
                throw new Error("Recording files and directories must not be symbolic links");
            if (stat.isDirectory())
                walk(path);
            else if (stat.isFile())
                total += stat.size;
            else
                throw new Error("Recording artifacts must be regular files");
            if (total > MAX_RECORDING_BYTES)
                throw new RecordingLimitError("Recording storage exceeds the supported limit");
        }
        const after = lstatSync(directory);
        if (after.dev !== identity.dev || after.ino !== identity.ino || after.isSymbolicLink())
            throw new Error("The recording directory changed while counting storage");
    };
    walk(root);
    return total;
}
export function artifactUsage(root, resolvePath) {
    let total = directoryBytes(root);
    const originalRoot = recordingArchiveOrigin(root, resolvePath);
    const ledger = join(root, "derived.jsonl");
    let present = true;
    try {
        lstatSync(ledger);
    }
    catch (error) {
        if (error.code === "ENOENT")
            present = false;
        else
            throw error;
    }
    if (present) {
        const bytes = boundedReadFile(ledger, 1024 * 1024, "The derived-artifact ledger");
        for (const line of bytes.toString("utf8").split(/\r?\n/).filter(Boolean)) {
            const row = JSON.parse(line);
            const path = resolvePath(row.path, { existing: false });
            const size = boundedInteger(row.bytes, "derived artifact size", 0, MAX_RECORDING_BYTES);
            if (!inside(root, path) && !(originalRoot && inside(originalRoot, path)))
                total += size;
        }
    }
    return total;
}
export function encodePng(rgba) {
    if (rgba.length !== RGBA_BYTES)
        throw new Error("The emulator framebuffer must have native 160 x 144 dimensions");
    return PNG.sync.write({ width: WIDTH, height: HEIGHT, data: Buffer.from(rgba) }, { colorType: 6 });
}
export function decodePng(data) {
    if (data.length > 1024 * 1024 || data.length < 24 || !data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || data.readUInt32BE(16) !== WIDTH || data.readUInt32BE(20) !== HEIGHT) {
        throw new Error("A retained framebuffer must be a bounded native 160 x 144 PNG");
    }
    const result = PNG.sync.read(data, { checkCRC: true });
    if (result.width !== WIDTH || result.height !== HEIGHT || result.data.length !== RGBA_BYTES)
        throw new Error("A retained framebuffer has invalid native dimensions");
    return Buffer.from(result.data);
}
//# sourceMappingURL=recording-common.js.map