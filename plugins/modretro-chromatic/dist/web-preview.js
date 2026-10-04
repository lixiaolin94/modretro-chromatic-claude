import { PreviewRecordingBroker } from "./web-preview-recording.js";
import { parseRecordingSaved } from "./web-annotations/recording-protocol.js";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { CHROMATIC_PACKED_V2, readPackedDeviceArtwork } from "../scripts/chromatic-runtime.mjs";
import { pipeline } from "node:stream/promises";
import { assertSafePlatformPath, isPathWithinRoot } from "./platform.js";
import { PreviewStateStore } from "./web-preview-states.js";
import { PreviewCaptureStore } from "./web-preview-captures.js";
import { PreviewPlayerControl, PreviewPlayerControlError } from "./web-preview-player.js";
import { PreviewFlashControl, PreviewFlashError } from "./web-preview-flash.js";
import { ChromaticDeviceError } from "./chromatic.js";
import { MAX_SAVE_STATE_FILE_BYTES } from "./web-annotations/save-state.js";
import { Readable } from "node:stream";
import { listenLoopback } from "./loopback-listener.js";
const LOOPBACK_ADDRESS = "127.0.0.1";
const CAPABILITY_BYTES = 32;
const MAX_REQUEST_TARGET_LENGTH = 8192;
const MAX_PATH_SEGMENTS = 64;
const MAX_STATIC_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ANNOTATION_FILE_BYTES = 1024 * 1024;
const ANNOTATION_MOUNT = "codex-annotations";
const PLAYER_MOUNT = "codex-player-control";
const STATE_MOUNT = "codex-states";
const DEVICE_MOUNT = "codex-device";
const DEVICE_VIEW_MOUNT = "codex-device-view";
const ACTIVATION_MOUNT = "codex-activation";
const CAPTURE_MOUNT = "codex-captures";
const MAX_CAPTURE_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_CAPTURE_UPLOAD_BYTES = 128 * 1024 * 1024 + MAX_CAPTURE_METADATA_BYTES + 16 * 1024;
const ANNOTATION_FILES = ["bridge.js", "native.js", "targets.js", "player.js", "view.js", "save-state.js", "input.js", "remote.js", "audio.js", "flash.js", "flash-diagnostics.js", "recording.js", "recording-protocol.js", "recording-controller.js", "error-dialog.js", "input-protocol.js", "input-owner.js"];
const DEVICE_IMAGES = ["codex", "cloud", "midnight", "wave", "leaf", "inferno", "volt", "bubblegum"].map(color => `chromatic-${color}.webp`);
const MAX_DEVICE_IMAGE_BYTES = 3 * 1024 * 1024;
const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".gb": "application/octet-stream",
    ".gbc": "application/octet-stream",
    ".gif": "image/gif",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".mp3": "audio/mpeg",
    ".ogg": "audio/ogg",
    ".otf": "font/otf",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".ttf": "font/ttf",
    ".wasm": "application/wasm",
    ".wav": "audio/wav",
    ".webmanifest": "application/manifest+json; charset=utf-8",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
};
function recordingResult(value, active) {
    if (!value || typeof value !== "object")
        return value;
    const result = structuredClone(value);
    if (!result.saved || typeof result.saved !== "object")
        return result;
    const binding = result.binding, identity = active?.annotations?.players?.identityForInput();
    const live = !!binding && !!active?.server.listening && !!active.annotations?.captures && binding.listenerId === active.status.listenerId &&
        binding.romSha256 === identity?.romSha256 && binding.runtimeSha256 === identity?.runtimeSha256 && binding.sourceRevision === identity?.sourceRevision;
    if (!live) {
        const saved = result.saved;
        delete saved.url;
        delete saved.metadataUrl;
        result.linksAvailable = false;
    }
    else
        result.linksAvailable = true;
    return result;
}
function pathsMatch(left, right, platform) {
    if (platform !== "win32")
        return left === right;
    return path.win32.normalize(left).toLowerCase() === path.win32.normalize(right).toLowerCase();
}
function secureHeaders(response) {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    response.setHeader("Referrer-Policy", "no-referrer");
}
function reject(response, status, message, allow = "GET, HEAD") {
    if (response.headersSent) {
        response.destroy();
        return;
    }
    secureHeaders(response);
    response.setHeader("Content-Type", "text/plain; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    if (status === 405)
        response.setHeader("Allow", allow);
    response.statusCode = status;
    response.end(response.req.method === "HEAD" ? undefined : message);
}
function hasSingleHeader(request, name) {
    let count = 0;
    for (let index = 0; index < request.rawHeaders.length; index += 2) {
        if (request.rawHeaders[index]?.toLowerCase() === name)
            count += 1;
    }
    return count === 1;
}
function isAuthorizedRequest(request, port) {
    const authority = `${LOOPBACK_ADDRESS}:${port}`;
    if (!hasSingleHeader(request, "host") || request.headers.host !== authority)
        return false;
    if (request.headers.origin !== undefined) {
        if (!hasSingleHeader(request, "origin") || request.headers.origin !== `http://${authority}`) {
            return false;
        }
    }
    return true;
}
function matchesCapability(received, expected) {
    if (!/^[a-f0-9]{64}$/.test(received))
        return false;
    return timingSafeEqual(Buffer.from(received, "ascii"), Buffer.from(expected, "ascii"));
}
function relativeAssetPath(target, capability, platform) {
    if (!target.startsWith("/") || target.startsWith("//") || target.includes("#"))
        return null;
    const pathname = target.split("?", 1)[0];
    if (pathname === undefined)
        return null;
    const segments = pathname.slice(1).split("/");
    if (segments.length > MAX_PATH_SEGMENTS)
        return null;
    const token = segments.shift();
    if (token === undefined || !matchesCapability(token, capability))
        return null;
    if (segments.length === 0)
        return null;
    if (segments.length === 1 && segments[0] === "")
        return "index.html";
    const decoded = [];
    for (const segment of segments) {
        let value;
        try {
            value = decodeURIComponent(segment);
        }
        catch {
            return null;
        }
        if (value.length === 0 ||
            value.length > 255 ||
            value.startsWith(".") ||
            value.includes("/") ||
            value.includes("\\") ||
            value.includes("\0")) {
            return null;
        }
        if (platform === "win32") {
            try {
                assertSafePlatformPath(value, platform);
            }
            catch {
                return null;
            }
        }
        decoded.push(value);
    }
    return decoded.join(path.sep);
}
function assetContentType(relative) {
    const extension = path.extname(relative).toLowerCase();
    if (extension === ".html" && relative !== "index.html")
        return undefined;
    // Native project descriptors, lockfiles, and source maps never belong in the browser export.
    if (extension === ".json") {
        const basename = path.basename(relative).toLowerCase();
        if (basename !== "gbstudio.json" && basename !== "manifest.json")
            return undefined;
    }
    return MIME_TYPES[extension];
}
async function verifyAssetPath(root, relative, platform) {
    try {
        if (platform === "win32") {
            assertSafePlatformPath(root, platform);
            assertSafePlatformPath(relative, platform);
        }
        const rootMetadata = await lstat(root);
        if (!rootMetadata.isDirectory() ||
            rootMetadata.isSymbolicLink() ||
            !pathsMatch(await realpath(root), root, platform)) {
            return null;
        }
        let candidate = root;
        const components = relative.split(path.sep);
        for (let index = 0; index < components.length; index += 1) {
            candidate = path.join(candidate, components[index]);
            if (!isPathWithinRoot(root, candidate, platform))
                return null;
            const metadata = await lstat(candidate);
            if (metadata.isSymbolicLink())
                return null;
            if (index < components.length - 1 && !metadata.isDirectory())
                return null;
            if (index === components.length - 1 && !metadata.isFile())
                return null;
            // Some Windows reparse points do not report themselves as conventional symbolic links.
            // Resolve every existing component so junctions and mount points cannot redirect a path.
            if (platform === "win32" && !pathsMatch(await realpath(candidate), candidate, platform)) {
                return null;
            }
        }
        const canonical = await realpath(candidate);
        if (!pathsMatch(canonical, candidate, platform) || !isPathWithinRoot(root, canonical, platform)) {
            return null;
        }
        return canonical;
    }
    catch {
        return null;
    }
}
async function readAnnotationFile(root, relative, platform, maximum = MAX_ANNOTATION_FILE_BYTES) {
    const filename = await verifyAssetPath(root, relative, platform);
    if (filename === null)
        throw new Error(`Annotation input must be a canonical regular file: ${relative}`);
    // Nonblocking open also prevents a regular file swapped for a FIFO from
    // holding startup before the descriptor's type can be checked.
    const handle = await open(filename, constants.O_RDONLY | (platform === "win32" ? 0 : constants.O_NOFOLLOW | constants.O_NONBLOCK));
    try {
        const before = await handle.stat();
        if (!before.isFile() || !Number.isSafeInteger(before.size) || before.size < 1 || before.size > maximum) {
            throw new Error(`Annotation input must contain 1–${maximum} bytes: ${relative}`);
        }
        // The extra byte detects growth without allowing a replaced or growing file
        // to turn this bounded startup read into an unbounded allocation.
        const bytes = Buffer.alloc(before.size + 1);
        let offset = 0;
        while (offset < bytes.length) {
            const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset);
            if (bytesRead === 0)
                break;
            offset += bytesRead;
        }
        const after = await handle.stat();
        const canonical = await realpath(filename);
        const named = await lstat(filename);
        if (!pathsMatch(canonical, filename, platform) || !isPathWithinRoot(root, canonical, platform) ||
            named.isSymbolicLink() || !named.isFile() || before.dev !== named.dev || before.ino !== named.ino ||
            offset !== before.size || after.size !== before.size || named.size !== before.size ||
            after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs ||
            named.mtimeMs !== after.mtimeMs || named.ctimeMs !== after.ctimeMs) {
            throw new Error(`Annotation input changed while reading it: ${relative}`);
        }
        return bytes.subarray(0, offset);
    }
    finally {
        await handle.close();
    }
}
function annotationContext(options, platform) {
    if (typeof options !== "object" || options === null || typeof options.assetsRoot !== "string" || !options.assetsRoot.trim()) {
        throw new Error("Annotations require a trusted compiled assets directory.");
    }
    const { romPath, romSha256, sourceRevision } = options;
    if (typeof romPath !== "string" || romPath.length === 0 || romPath.length > 1024 ||
        /[\\:%?#\u0000-\u001f]/u.test(romPath) || path.posix.isAbsolute(romPath) || path.win32.isAbsolute(romPath) ||
        romPath.split("/").length > MAX_PATH_SEGMENTS ||
        romPath.split("/").some((part) => !part || part.startsWith(".") || part.length > 255) ||
        !/\.(?:gb|gbc)$/iu.test(romPath)) {
        throw new Error("Annotation ROM path must name a web-export-relative .gb or .gbc file.");
    }
    if (platform === "win32")
        assertSafePlatformPath(romPath, platform);
    if (typeof romSha256 !== "string" || !/^[a-f0-9]{64}$/iu.test(romSha256)) {
        throw new Error("Annotations require the exported ROM SHA-256.");
    }
    if (typeof sourceRevision !== "string" || sourceRevision.length === 0 || sourceRevision.length > 1024) {
        throw new Error("Annotations require a bounded source revision.");
    }
    return { romPath, romSha256: romSha256.toLowerCase(), sourceRevision };
}
async function prepareAnnotations(outputRoot, options, platform, flashEnabled, deviceViewEnabled, deviceCaptureAvailability) {
    const context = {
        ...annotationContext(options, platform), ...(options.projectRoot ? { playerPath: PLAYER_MOUNT } : {}),
    };
    const assetsRoot = path.resolve(options.assetsRoot);
    if (platform === "win32")
        assertSafePlatformPath(assetsRoot, platform);
    const directory = await lstat(assetsRoot);
    if (!directory.isDirectory() || directory.isSymbolicLink() || !pathsMatch(await realpath(assetsRoot), assetsRoot, platform)) {
        throw new Error("Annotation assets must use a canonical directory without links or reparse points.");
    }
    const assets = new Map();
    const assetHashes = [];
    for (const filename of ANNOTATION_FILES) {
        const bytes = await readAnnotationFile(assetsRoot, filename, platform);
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        assets.set(filename, { bytes, etag: `"sha256-${sha256}"`, contentType: "text/javascript; charset=utf-8" });
        assetHashes.push({ path: filename, sha256 });
    }
    if (options.deviceAssetsRoot !== undefined) {
        const deviceRoot = path.resolve(options.deviceAssetsRoot);
        const packed = options.deviceAssetsFormat === CHROMATIC_PACKED_V2.format
            ? readPackedDeviceArtwork(deviceRoot) : undefined;
        for (const filename of DEVICE_IMAGES) {
            const bytes = packed ? packed.get(filename)
                : await readAnnotationFile(deviceRoot, filename, platform, MAX_DEVICE_IMAGE_BYTES);
            if (!bytes || bytes.length > MAX_DEVICE_IMAGE_BYTES)
                throw new Error(`Missing or oversized device artwork: ${filename}`);
            if (bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") {
                throw new Error(`Device artwork must be a WebP: ${filename}`);
            }
            const sha256 = createHash("sha256").update(bytes).digest("hex");
            assets.set(filename, { bytes, etag: `"sha256-${sha256}"`, contentType: "image/webp" });
            assetHashes.push({ path: filename, sha256 });
        }
    }
    const index = await readAnnotationFile(outputRoot, "index.html", platform);
    let states;
    let captureCartridgeType = 0;
    let captures;
    let flash;
    let bootstrap = "";
    if (options.projectRoot !== undefined) {
        if (deviceViewEnabled) {
            context.deviceView = true;
            if (deviceCaptureAvailability)
                context.deviceCaptureAvailability = deviceCaptureAvailability;
        }
        const [rom, runtime] = await Promise.all([
            readAnnotationFile(outputRoot, context.romPath.split("/").join(path.sep), platform, 8 * 1024 * 1024),
            readAnnotationFile(outputRoot, path.join("js", "binjgb.wasm"), platform, 16 * 1024 * 1024),
        ]);
        if (rom.length < 0x150 || createHash("sha256").update(rom).digest("hex") !== context.romSha256) {
            throw new Error("Saved states require the verified exported cartridge.");
        }
        if (flashEnabled) {
            if (options.romSizeBytes !== rom.length)
                throw new Error("Device flashing requires the exact verified export size.");
            context.flash = { generation: randomBytes(16).toString("hex") };
            flash = { generation: context.flash.generation, projectRoot: path.resolve(options.projectRoot),
                romPath: path.join(outputRoot, ...context.romPath.split("/")), romSha256: context.romSha256, romSizeBytes: rom.length };
        }
        context.runtimeSha256 = createHash("sha256").update(runtime).digest("hex");
        const runtimeName = `binjgb-${context.runtimeSha256}.wasm`;
        assets.set(runtimeName, { bytes: runtime, etag: `"sha256-${context.runtimeSha256}"`, contentType: "application/wasm" });
        // The actual official player receives these verified bytes, so later
        // captures cannot label an old loaded core with a newly fetched hash.
        bootstrap = `<script>(function(){const expected=${JSON.stringify(context.runtimeSha256)};` +
            `const factory=Binjgb;const bytes=fetch(${JSON.stringify(`./${ANNOTATION_MOUNT}/${runtimeName}`)}).then(async response=>{` +
            `if(!response.ok)throw new Error("The game runtime is unavailable.");const bytes=new Uint8Array(await response.arrayBuffer());` +
            `const hash=Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256",bytes)),v=>v.toString(16).padStart(2,"0")).join("");` +
            `if(hash!==expected)throw new Error("The game runtime changed.");return bytes;});` +
            `Binjgb=options=>Promise.all([bytes,import(${JSON.stringify(`./${ANNOTATION_MOUNT}/input-owner.js`)})]).then(([wasmBinary,input])=>factory({...options,wasmBinary}).then(module=>{module.codexRuntimeSha256=expected;input.installInputOwner(module);return module;}));})();</script>\n`;
        states = new PreviewStateStore({
            projectRoot: options.projectRoot, platform,
            identity: { romSha256: context.romSha256, sourceRevision: context.sourceRevision,
                runtimeSha256: context.runtimeSha256, cartridgeType: rom[0x147] },
        });
        captureCartridgeType = rom[0x147];
        context.captures = { generation: randomBytes(16).toString("hex") };
        captures = { generation: context.captures.generation, store: new PreviewCaptureStore({
                projectRoot: options.projectRoot, platform,
                identity: { romSha256: context.romSha256, sourceRevision: context.sourceRevision,
                    runtimeSha256: context.runtimeSha256, cartridgeType: rom[0x147] },
            }) };
    }
    const reuseKey = createHash("sha256").update(JSON.stringify({ projectRoot: options.projectRoot,
        context: { ...context, captures: context.captures ? true : undefined, flash: context.flash ? true : undefined },
        indexSha256: createHash("sha256").update(index).digest("hex"), assets: assetHashes,
    })).digest("hex");
    const fingerprint = createHash("sha256").update(JSON.stringify({
        version: 1, context, indexSha256: createHash("sha256").update(index).digest("hex"), assets: assetHashes,
    })).digest("hex");
    // JSON in a raw-text script element must not contain an HTML closing tag.
    const serialized = JSON.stringify(context).replace(/</gu, "\\u003c").replace(/\u2028/gu, "\\u2028").replace(/\u2029/gu, "\\u2029");
    const injection = `\n<script type="application/json" id="codex-web-annotations-context">${serialized}</script>\n` +
        `<script type="module" src="./${ANNOTATION_MOUNT}/bridge.js"></script>\n`;
    let html = index.toString("utf8");
    if (bootstrap) {
        const playerScript = /<script\b[^>]*\bsrc=(["'])(?:\.\/)?js\/script\.js\1[^>]*>\s*<\/script>/iu.exec(html);
        if (!playerScript)
            throw new Error("Saved states require the official game browser player.");
        html = html.slice(0, playerScript.index) + bootstrap + html.slice(playerScript.index);
    }
    const closingBody = [...html.matchAll(/<\/body\s*>/giu)].at(-1)?.index ?? html.length;
    const bytes = Buffer.from(html.slice(0, closingBody) + injection + html.slice(closingBody));
    return {
        reuseKey,
        fingerprint,
        assets,
        ...(flash ? { flash } : {}),
        ...(captures ? { captures } : {}),
        ...(states ? { states, players: new PreviewPlayerControl({ romSha256: context.romSha256, sourceRevision: context.sourceRevision, runtimeSha256: context.runtimeSha256 }, path.resolve(options.projectRoot), captureCartridgeType), projectRoot: path.resolve(options.projectRoot) } : {}),
        index: { bytes, etag: `"annotations-${fingerprint}"`, contentType: "text/html; charset=utf-8" },
    };
}
function serveBufferedAsset(request, response, asset) {
    secureHeaders(response);
    response.setHeader("Cache-Control", "private, no-cache, must-revalidate");
    response.setHeader("ETag", asset.etag);
    if (request.headers["if-none-match"] === asset.etag) {
        response.writeHead(304);
        response.end();
        return;
    }
    response.setHeader("Content-Type", asset.contentType);
    response.setHeader("Content-Length", asset.bytes.length);
    response.writeHead(200);
    response.end(request.method === "HEAD" ? undefined : asset.bytes);
}
function copyStatus(status) {
    return { ...status, ...(status.annotations ? { annotations: { ...status.annotations } } : {}) };
}
function stateResponse(request, response, status, value) {
    secureHeaders(response);
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.statusCode = status;
    response.end(request.method === "HEAD" ? undefined : JSON.stringify(value));
}
/** Only this preview's verified ROM is eligible; the browser never supplies a path. */
async function serveDevice(request, response, active, relative) {
    const annotations = active.annotations;
    const binding = annotations?.flash;
    if (!active.flash || !binding || relative !== DEVICE_MOUNT) {
        reject(response, 404, "Not found");
        return;
    }
    const current = () => active.annotations === annotations && active.server.listening && active.acceptingStateRequests && active.isProjectSelected(binding.projectRoot);
    if (request.method !== "POST") {
        reject(response, 405, "Method not allowed", "POST");
        return;
    }
    const length = request.headers["content-length"];
    if (request.headers.origin !== `http://${LOOPBACK_ADDRESS}:${active.status.port}` ||
        !hasSingleHeader(request, "x-codex-preview-device") || request.headers["x-codex-preview-device"] !== "1" ||
        !hasSingleHeader(request, "content-type") || request.headers["content-type"] !== "application/json" ||
        request.headers["content-encoding"] !== undefined || request.headers["transfer-encoding"] !== undefined ||
        !hasSingleHeader(request, "content-length") || typeof length !== "string" || !/^[1-9][0-9]*$/.test(length)) {
        reject(response, 400, "Invalid device request");
        return;
    }
    const maximum = 4096;
    if (!Number.isSafeInteger(Number(length)) || Number(length) > maximum) {
        reject(response, 413, "Device request is too large");
        return;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > Number(length) || size > maximum) {
            reject(response, 413, "Device request is too large");
            return;
        }
        chunks.push(Buffer.from(chunk));
    }
    if (size !== Number(length)) {
        reject(response, 400, "Incomplete device request");
        return;
    }
    let body;
    try {
        body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
        if (!current()) {
            const recovered = active.flash.recover(body, binding);
            if (recovered)
                stateResponse(request, response, 200, recovered);
            else
                stateResponse(request, response, 409, { error: "The preview or selected project changed. Reload the preview.", code: "PREVIEW_CHANGED" });
            return;
        }
        const result = active.flash.execute(body, binding);
        stateResponse(request, response, 200, result);
    }
    catch (error) {
        const known = error instanceof PreviewFlashError || error instanceof ChromaticDeviceError;
        const input = body && typeof body === "object" ? body : undefined;
        const notAdmitted = (input?.action === "discover" || input?.action === "flash") && !active.flash.hasRequest(input.requestId) &&
            (error instanceof PreviewFlashError || error instanceof ChromaticDeviceError && [
                "CHROMATIC_SELECTION_EXPIRED", "CHROMATIC_INVALID_INPUT", "CHROMATIC_INVALID_ROM_BINDING",
                "CHROMATIC_CONFIRMATION_REQUIRED", "CHROMATIC_CLOSING", "CHROMATIC_BUSY", "CHROMATIC_SESSION_CHANGED",
            ].includes(error.code));
        stateResponse(request, response, known ? 409 : 400, {
            error: known ? error.message : "The device request could not be completed. Check its original status before trying anything else.",
            ...(known ? { code: error.code } : {}),
            ...(notAdmitted ? { admitted: false } : {}),
        });
    }
}
/** Secret bodies never enter the device fingerprint, raw journal or error formatter. */
/** Polling stays private to this preview; only the plugin can queue commands. */
async function servePlayer(request, response, active, relative) {
    const annotations = active.annotations;
    const players = annotations?.players;
    const states = annotations?.states;
    if (!players || relative !== PLAYER_MOUNT) {
        reject(response, 404, "Not found");
        return;
    }
    const current = () => active.annotations === annotations && active.server.listening && active.acceptingStateRequests;
    if (!current()) {
        reject(response, 409, "The player is being reopened");
        return;
    }
    if (request.method !== "POST") {
        reject(response, 405, "Method not allowed", "POST");
        return;
    }
    const length = request.headers["content-length"];
    if (request.headers.origin !== `http://${LOOPBACK_ADDRESS}:${active.status.port}` ||
        !hasSingleHeader(request, "x-codex-preview-state") || request.headers["x-codex-preview-state"] !== "1" ||
        !hasSingleHeader(request, "content-type") || request.headers["content-type"] !== "application/json" ||
        request.headers["content-encoding"] !== undefined || request.headers["transfer-encoding"] !== undefined ||
        !hasSingleHeader(request, "content-length") || typeof length !== "string" || !/^[1-9][0-9]*$/.test(length)) {
        reject(response, 400, "Invalid player-control request");
        return;
    }
    const maximum = MAX_SAVE_STATE_FILE_BYTES + 8192;
    if (Number(length) > maximum) {
        reject(response, 413, "Player-control response is too large");
        return;
    }
    const chunks = [];
    let size = 0;
    for await (const chunk of request) {
        size += chunk.length;
        if (size > Number(length) || size > maximum) {
            reject(response, 413, "Player-control response is too large");
            return;
        }
        chunks.push(Buffer.from(chunk));
    }
    if (size !== Number(length)) {
        reject(response, 400, "Incomplete player-control response");
        return;
    }
    if (!current()) {
        reject(response, 409, "The player changed");
        return;
    }
    try {
        const body = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
        const decoded = JSON.parse(body);
        if (!decoded || typeof decoded !== "object" || Array.isArray(decoded))
            throw new Error("Invalid player-control request.");
        const { initialize, freshStart, snapshot, ...poll } = decoded;
        if ((initialize !== undefined && typeof initialize !== "boolean") ||
            (freshStart !== undefined && (typeof freshStart !== "boolean" || initialize !== true)) ||
            (snapshot !== undefined && (typeof snapshot !== "string" || Buffer.byteLength(snapshot) > MAX_SAVE_STATE_FILE_BYTES || poll.result !== undefined))) {
            throw new Error("Invalid automatic-save request.");
        }
        if (Buffer.byteLength(JSON.stringify({ inputStatus: poll.inputStatus, inputActive: poll.inputActive, inputResult: poll.inputResult })) > 4096) {
            throw new Error("Browser input fields exceed their size limit.");
        }
        const retiring = !!poll.recordingStatus && typeof poll.recordingStatus === "object" && "retireId" in poll.recordingStatus;
        if ((retiring || players.recording?.isRetired(String(poll.viewId))) &&
            (initialize !== undefined || freshStart !== undefined || snapshot !== undefined || active.stateWrites.size || active.captureUpload)) {
            throw new Error("Finish current state and capture writes before retiring this view.");
        }
        const reply = players.poll(poll);
        if (initialize === true) {
            reply.initialState = freshStart === true || reply.command ? null : (await states.latest())?.text ?? null;
            if (!current()) {
                reject(response, 409, "The player changed");
                return;
            }
        }
        if (typeof snapshot === "string" && (players.input.blocking || players.recording?.active))
            reply.snapshotDeferred = true;
        else if (typeof snapshot === "string") {
            const write = states.save(snapshot);
            active.stateWrites.add(write);
            try {
                await write;
                reply.snapshotSaved = true;
            }
            catch {
                reply.snapshotError = "The automatic save could not be stored.";
            }
            finally {
                active.stateWrites.delete(write);
            }
        }
        if (!current()) {
            reject(response, 409, "The player changed");
            return;
        }
        stateResponse(request, response, 200, reply);
    }
    catch (error) {
        if (error instanceof PreviewPlayerControlError && error.code === "RESULT_MISMATCH") {
            stateResponse(request, response, 409, { error: "This command result is no longer pending.", discardResult: true });
        }
        else
            stateResponse(request, response, 400, { error: "Invalid or stale player-control response." });
    }
}
async function serveHistory(request, response, active, relative) {
    const annotations = active.annotations;
    const states = annotations?.states;
    const current = () => active.annotations === annotations && active.server.listening && active.acceptingStateRequests;
    if (!states) {
        reject(response, 404, "Not found");
        return;
    }
    if (!current()) {
        reject(response, 409, "The player is being reopened");
        return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
        reject(response, 405, "Method not allowed");
        return;
    }
    if (request.headers["transfer-encoding"] !== undefined ||
        (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")) {
        reject(response, 400, "Request body not allowed");
        return;
    }
    if (relative === STATE_MOUNT) {
        const listed = await states.list();
        if (!current()) {
            reject(response, 409, "The player changed");
            return;
        }
        stateResponse(request, response, 200, { states: listed });
        return;
    }
    const name = relative.startsWith(`${STATE_MOUNT}${path.sep}`) ? relative.slice(STATE_MOUNT.length + path.sep.length) : "";
    const match = /^([a-f0-9]{64})\.gbstate\.json$/.exec(name);
    const text = match ? await states.read(match[1]) : null;
    if (!current()) {
        reject(response, 409, "The player changed");
        return;
    }
    if (text === null) {
        reject(response, 404, "Saved moment not found");
        return;
    }
    secureHeaders(response);
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Length", Buffer.byteLength(text));
    response.end(request.method === "HEAD" ? undefined : text);
}
function captureLinks(record) {
    return { ...record, url: `./${CAPTURE_MOUNT}/${record.id}/media`, metadataUrl: `./${CAPTURE_MOUNT}/${record.id}/metadata` };
}
/** Browser media stays in the selected project; neither filenames nor paths come from the request. */
async function serveCaptures(request, response, active, relative) {
    const annotations = active.annotations;
    const captures = annotations?.captures;
    const current = () => active.annotations === annotations && active.server.listening && active.acceptingStateRequests &&
        !!annotations?.projectRoot && active.isProjectSelected(annotations.projectRoot);
    if (!captures || !relative.startsWith(CAPTURE_MOUNT)) {
        reject(response, 404, "Not found");
        return;
    }
    if (!current()) {
        reject(response, 409, "The preview or selected project changed.");
        return;
    }
    if (relative === CAPTURE_MOUNT) {
        if (request.method !== "POST") {
            reject(response, 405, "Method not allowed", "POST");
            return;
        }
        const length = request.headers["content-length"];
        const contentType = request.headers["content-type"];
        if (request.headers.origin !== `http://${LOOPBACK_ADDRESS}:${active.status.port}` ||
            !hasSingleHeader(request, "x-codex-preview-capture") || request.headers["x-codex-preview-capture"] !== captures.generation ||
            !hasSingleHeader(request, "content-type") || typeof contentType !== "string" ||
            !/^multipart\/form-data;\s*boundary=(?:[A-Za-z0-9'()+_,.\/:=?-]{1,70}|"[A-Za-z0-9'()+_,.\/:=?-]{1,70}")$/i.test(contentType) ||
            request.headers["content-encoding"] !== undefined || request.headers["transfer-encoding"] !== undefined ||
            !hasSingleHeader(request, "content-length") || typeof length !== "string" || !/^[1-9][0-9]*$/.test(length)) {
            reject(response, 400, "Invalid capture upload");
            return;
        }
        const expected = Number(length);
        if (!Number.isSafeInteger(expected) || expected > MAX_CAPTURE_UPLOAD_BYTES) {
            reject(response, 413, "Capture upload is too large");
            return;
        }
        if (active.captureUpload) {
            reject(response, 409, "Another capture is still being saved.");
            return;
        }
        let managed;
        try {
            for (const key of ["x-codex-recording-id", "x-codex-recording-view", "x-codex-recording-generation"])
                if (request.headers[key] !== undefined && !hasSingleHeader(request, key))
                    throw new Error("Duplicate recording ownership header.");
            managed = annotations?.players?.recording?.admitUpload(request.headers["x-codex-recording-id"], request.headers["x-codex-recording-view"], request.headers["x-codex-recording-generation"]);
            if (!managed && request.headers["x-codex-recording-id"] !== undefined)
                throw new Error("Unknown recording owner.");
        }
        catch (error) {
            reject(response, 409, error instanceof Error ? error.message : "Invalid recording owner.");
            return;
        }
        const save = (async () => {
            try {
                async function* boundedBody() {
                    let received = 0;
                    for await (const chunk of request) {
                        received += chunk.length;
                        if (received > expected || received > MAX_CAPTURE_UPLOAD_BYTES)
                            throw new Error("Capture upload exceeded its size limit.");
                        yield chunk;
                    }
                    if (received !== expected)
                        throw new Error("The capture upload was incomplete.");
                }
                // Native multipart parsing receives a bounded stream, without a second full Buffer copy.
                const body = Readable.toWeb(Readable.from(boundedBody()));
                const form = await new Response(body, { headers: { "content-type": contentType } }).formData();
                const keys = [];
                form.forEach((_value, key) => { keys.push(key); });
                if (keys.length !== 3 || new Set(keys).size !== 3 || !["kind", "metadata", "media"].every(key => form.has(key))) {
                    throw new Error("A capture must contain exactly kind, metadata, and media.");
                }
                const kind = form.get("kind"), metadataText = form.get("metadata"), media = form.get("media");
                if ((kind !== "screenshot" && kind !== "video") || typeof metadataText !== "string" ||
                    Buffer.byteLength(metadataText) > MAX_CAPTURE_METADATA_BYTES || !(media instanceof Blob)) {
                    throw new Error("Invalid capture media or metadata.");
                }
                const metadata = JSON.parse(metadataText);
                if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
                    throw new Error("Invalid capture metadata.");
                if (!current()) {
                    reject(response, 409, "The preview or selected project changed before saving.");
                    return;
                }
                if (managed && kind !== "video")
                    throw new Error("Managed recording must be video.");
                const record = await captures.store.save({ kind, media, mimeType: media.type, metadata: metadata });
                const linked = captureLinks(record);
                if (managed)
                    await annotations.players.recording.published(managed.id, parseRecordingSaved(linked), metadata.status === "partial" ? "partial" : "complete");
                stateResponse(request, response, 201, linked);
            }
            catch (error) {
                if (managed)
                    await annotations.players.recording.uploadFailed(managed.id, error);
                stateResponse(request, response, 400, {
                    error: error instanceof Error ? error.message : "The capture save could not be confirmed. Keep the browser download.",
                    ...(error?.partial ? { partial: error.partial } : {}),
                });
            }
        })();
        active.captureUpload = save;
        try {
            await save;
        }
        finally {
            if (active.captureUpload === save)
                delete active.captureUpload;
        }
        return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
        reject(response, 405, "Method not allowed");
        return;
    }
    if (request.headers["transfer-encoding"] !== undefined ||
        (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")) {
        reject(response, 400, "Request body not allowed");
        return;
    }
    const parts = relative.split(path.sep);
    if (parts.length !== 3 || parts[0] !== CAPTURE_MOUNT || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(parts[1]) ||
        (parts[2] !== "media" && parts[2] !== "metadata")) {
        reject(response, 404, "Not found");
        return;
    }
    const file = await captures.store.open(parts[1], parts[2]);
    if (!file) {
        reject(response, 404, "Capture not found");
        return;
    }
    try {
        if (!current()) {
            reject(response, 409, "The preview changed.");
            return;
        }
        secureHeaders(response);
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", file.mimeType);
        response.setHeader("Accept-Ranges", "bytes");
        response.setHeader("ETag", `"sha256-${file.sha256}"`);
        const filename = path.basename(parts[2] === "metadata" ? file.record.metadataPath : file.record.path);
        // Video captures stay download-only, including direct and range requests.
        const download = (parts[2] === "media" && file.record.kind === "video") ||
            new URL(request.url, active.status.url).searchParams.get("download") === "1";
        response.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`);
        let start = 0, end = file.bytes - 1;
        const range = request.headers.range;
        if (range !== undefined) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(range);
            if (!match || (!match[1] && !match[2]) || match.slice(1).some(value => value && !Number.isSafeInteger(Number(value)))) {
                response.setHeader("Content-Range", `bytes */${file.bytes}`);
                reject(response, 416, "Invalid range");
                return;
            }
            if (!match[1])
                start = Math.max(0, file.bytes - Number(match[2]));
            else {
                start = Number(match[1]);
                if (match[2])
                    end = Math.min(end, Number(match[2]));
            }
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || end >= file.bytes ||
                (!match[1] && (!Number.isSafeInteger(Number(match[2])) || Number(match[2]) < 1))) {
                response.setHeader("Content-Range", `bytes */${file.bytes}`);
                reject(response, 416, "Invalid range");
                return;
            }
            response.statusCode = 206;
            response.setHeader("Content-Range", `bytes ${start}-${end}/${file.bytes}`);
        }
        response.setHeader("Content-Length", end - start + 1);
        if (request.method === "HEAD") {
            response.end();
            return;
        }
        await pipeline(file.handle.createReadStream({ start, end, autoClose: false }), response);
    }
    finally {
        await file.handle.close();
    }
}
async function serveAsset(request, response, active) {
    if (!isAuthorizedRequest(request, active.status.port)) {
        reject(response, 403, "Forbidden");
        return;
    }
    const target = request.url;
    if (target === undefined || target.length > MAX_REQUEST_TARGET_LENGTH) {
        reject(response, 414, "Invalid request target");
        return;
    }
    const relative = relativeAssetPath(target, active.capability, active.platform);
    if (relative === null) {
        reject(response, 403, "Forbidden");
        return;
    }
    const foldedRelative = relative.toLowerCase();
    if (foldedRelative === DEVICE_VIEW_MOUNT || foldedRelative.startsWith(`${DEVICE_VIEW_MOUNT}${path.sep}`)) {
        const projectRoot = active.annotations?.projectRoot;
        if (!active.serveDeviceView || !projectRoot || !active.acceptingStateRequests || !active.isProjectSelected(projectRoot) || !relative.startsWith(`${DEVICE_VIEW_MOUNT}${path.sep}`)) {
            reject(response, 409, "The selected game preview is unavailable.");
            return;
        }
        const operation = active.serveDeviceView(request, response, projectRoot, relative.slice(DEVICE_VIEW_MOUNT.length + 1).split(path.sep).join("/"), `http://${LOOPBACK_ADDRESS}:${active.status.port}`);
        active.stateWrites.add(operation);
        try {
            await operation;
        }
        finally {
            active.stateWrites.delete(operation);
        }
        return;
    }
    if (foldedRelative === ACTIVATION_MOUNT || foldedRelative.startsWith(`${ACTIVATION_MOUNT}${path.sep}`)) {
        reject(response, 404, "Not found");
        return;
    }
    if (foldedRelative === CAPTURE_MOUNT || foldedRelative.startsWith(`${CAPTURE_MOUNT}${path.sep}`)) {
        const operation = serveCaptures(request, response, active, relative);
        active.stateWrites.add(operation);
        try {
            await operation;
        }
        finally {
            active.stateWrites.delete(operation);
        }
        return;
    }
    if (foldedRelative === DEVICE_MOUNT || foldedRelative.startsWith(`${DEVICE_MOUNT}${path.sep}`)) {
        await serveDevice(request, response, active, relative);
        return;
    }
    if (foldedRelative === STATE_MOUNT || foldedRelative.startsWith(`${STATE_MOUNT}${path.sep}`)) {
        await serveHistory(request, response, active, relative);
        return;
    }
    if (foldedRelative === PLAYER_MOUNT || foldedRelative.startsWith(`${PLAYER_MOUNT}${path.sep}`)) {
        await servePlayer(request, response, active, relative);
        return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
        reject(response, 405, "Method not allowed");
        return;
    }
    if (request.headers["transfer-encoding"] !== undefined ||
        (request.headers["content-length"] !== undefined && request.headers["content-length"] !== "0")) {
        reject(response, 400, "Request body not allowed");
        return;
    }
    if (active.annotations && (foldedRelative === ANNOTATION_MOUNT || foldedRelative.startsWith(`${ANNOTATION_MOUNT}${path.sep}`))) {
        // Reserve case aliases too: Windows must not fall through to an authored
        // export file that shadows one of the trusted, pinned module responses.
        const canonicalMount = relative.startsWith(`${ANNOTATION_MOUNT}${path.sep}`);
        const asset = canonicalMount ? active.annotations.assets.get(relative.slice(ANNOTATION_MOUNT.length + path.sep.length)) : undefined;
        if (asset)
            serveBufferedAsset(request, response, asset);
        else
            reject(response, 404, "Not found");
        return;
    }
    if (relative === "index.html" && active.annotations) {
        serveBufferedAsset(request, response, active.annotations.index);
        return;
    }
    const contentType = assetContentType(relative);
    if (contentType === undefined) {
        reject(response, 404, "Not found");
        return;
    }
    const assetPath = await verifyAssetPath(active.status.outputRoot, relative, active.platform);
    if (assetPath === null) {
        reject(response, 404, "Not found");
        return;
    }
    let handle;
    try {
        // Windows does not implement O_NOFOLLOW. Its fallback is protected by component-by-component
        // reparse checks plus canonical confinement and opened-descriptor identity verification.
        const noFollow = active.platform === "win32" ? 0 : constants.O_NOFOLLOW;
        handle = await open(assetPath, constants.O_RDONLY | noFollow);
        const metadata = await handle.stat();
        // Verify the opened descriptor against its canonical path after opening as well. A swapped
        // parent-directory symlink must not turn the earlier confinement checks into a TOCTOU escape.
        const openedPath = await realpath(assetPath);
        const pathMetadata = await lstat(openedPath);
        if (!pathsMatch(openedPath, assetPath, active.platform) ||
            !isPathWithinRoot(active.status.outputRoot, openedPath, active.platform) ||
            pathMetadata.isSymbolicLink() ||
            metadata.dev !== pathMetadata.dev ||
            metadata.ino !== pathMetadata.ino ||
            !metadata.isFile() ||
            metadata.size > MAX_STATIC_FILE_BYTES) {
            await handle.close();
            reject(response, metadata.size > MAX_STATIC_FILE_BYTES ? 413 : 404, "Unavailable");
            return;
        }
        const etag = `W/"${metadata.size.toString(36)}-${metadata.mtimeMs.toString(36)}"`;
        secureHeaders(response);
        response.setHeader("Cache-Control", "private, no-cache, must-revalidate");
        response.setHeader("ETag", etag);
        if (request.headers["if-none-match"] === etag) {
            await handle.close();
            response.writeHead(304);
            response.end();
            return;
        }
        response.setHeader("Content-Type", contentType);
        response.setHeader("Content-Length", metadata.size);
        if (request.method === "HEAD") {
            await handle.close();
            response.writeHead(200);
            response.end();
            return;
        }
        response.writeHead(200);
        await pipeline(handle.createReadStream({ autoClose: true }), response);
    }
    catch {
        if (handle !== undefined)
            await handle.close().catch(() => undefined);
        reject(response, 404, "Not found");
    }
}
/** Serves official game exports and optional annotation modules behind one capability URL. */
async function verifyRecordingCapture(projectRoot, recording) {
    if (!recording.saved)
        return;
    const b = recording.binding;
    const store = new PreviewCaptureStore({ projectRoot, identity: { romSha256: b.romSha256, runtimeSha256: b.runtimeSha256, sourceRevision: b.sourceRevision, cartridgeType: recording.cartridgeType } });
    const file = await store.open(recording.saved.id, "media");
    if (!file)
        throw new Error("The original capture file is unavailable; preserve its journal.");
    try {
        if (file.record.sha256 !== recording.saved.sha256 || file.record.bytes !== recording.saved.bytes || file.record.path !== recording.saved.path || file.record.metadataPath !== recording.saved.metadataPath)
            throw new Error("The original capture differs from its saved receipt.");
    }
    finally {
        await file.handle.close();
    }
}
export class WebPreviewService {
    #active = null;
    #closedPort;
    #disposed = false;
    #disposal;
    #operation = Promise.resolve();
    #platform;
    #flash;
    #isProjectSelected;
    #serveDeviceView;
    #deviceCaptureAvailability;
    constructor(options = {}) {
        this.#platform = options.platform ?? process.platform;
        this.#flash = options.chromatic ? new PreviewFlashControl(options.chromatic) : undefined;
        this.#isProjectSelected = options.isProjectSelected ?? (() => true);
        this.#serveDeviceView = options.serveDeviceView;
        this.#deviceCaptureAvailability = options.deviceCaptureAvailability;
    }
    status() {
        if (this.#active === null)
            return null;
        return { ...copyStatus(this.#active.status), listening: this.#active.server.listening };
    }
    async control(input) {
        const active = this.#active;
        const annotations = active?.annotations;
        if ((!active || annotations?.projectRoot !== path.resolve(input.projectRoot)) && ["recording_status", "read_capture"].includes(input.action)) {
            const recording = await new PreviewRecordingBroker(input.projectRoot).read(input.recordingId);
            if (input.action === "read_capture")
                await verifyRecordingCapture(input.projectRoot, recording);
            return { success: true, action: input.action, recording: recordingResult(recording) };
        }
        if (!active || !annotations?.states || !annotations.players ||
            !pathsMatch(path.resolve(input.projectRoot), annotations.projectRoot, this.#platform)) {
            throw new Error("Open a browser preview for the selected project first.");
        }
        const { states, players } = annotations;
        const result = { success: true, action: input.action, preview: { ...copyStatus(active.status), listening: active.server.listening } };
        const unchanged = () => {
            if (this.#active !== active || active.annotations !== annotations || !active.acceptingStateRequests || !active.server.listening) {
                throw new Error("The browser preview changed while the state command was running.");
            }
        };
        if (input.action === "install_status" || input.action === "dismiss_install_failure") {
            unchanged();
            if (!active.flash || !annotations.flash || !this.#isProjectSelected(input.projectRoot))
                throw new Error("Installation control requires the current selected preview.");
            const installation = active.flash.execute(input.action === "install_status"
                ? { action: "status", generation: annotations.flash.generation, ...(input.installationRequestId ? { requestId: input.installationRequestId } : {}) }
                : { action: "dismiss_failure", ...input.installationBinding, acknowledgePreviousOutcome: true }, annotations.flash);
            const previous = installation.operation;
            return { ...result, installation,
                ...(typeof previous?.requestId === "string" && typeof previous.operationId === "string" ? { installationBinding: {
                        generation: annotations.flash.generation, requestId: previous.requestId, operationId: previous.operationId,
                    } } : {}),
                note: "Dismissal preserves the original result and does not write a cartridge. A new install requires fresh discovery, device selection and erasure confirmation." };
        }
        if (input.action === "status")
            return { ...result, players: players.status(), identity: players.identityForInput(), input: players.input.status(), recording: recordingResult(await players.recording?.unresolved(), active) };
        if (["recording_status", "read_capture"].includes(input.action)) {
            const recording = await (input.action === "recording_status" ? players.recording.status(input.recordingId) : players.recording.read(input.recordingId));
            if (input.action === "read_capture")
                await verifyRecordingCapture(input.projectRoot, recording);
            return { ...result, recording: recordingResult(recording, active) };
        }
        if (input.action === "stop_recording")
            return { ...result, recording: players.recording.stop(input.recordingId) };
        if (!active.server.listening || !active.acceptingStateRequests || active.status.closureState !== "open")
            throw new Error("The original browser owner is closing or unresolved. Inspect status.");
        if (input.action === "start_recording") {
            const binding = input.recordingBinding, identity = players.identityForInput();
            if (!binding || binding.listenerId !== active.status.listenerId || binding.romSha256 !== identity.romSha256 || binding.runtimeSha256 !== identity.runtimeSha256 || binding.sourceRevision !== identity.sourceRevision || !this.#isProjectSelected(input.projectRoot))
                throw new Error("Recording requires the exact current project, listener, view and build binding from status.");
            if (players.status().find(v => v.id === binding.viewId)?.paused !== false)
                throw new Error("Resume the visible player before starting a recording.");
            return { ...result, recording: await players.recording.start(binding, input.recordingDurationMs) };
        }
        if (input.action === "input") {
            const binding = input.binding;
            const identity = players.identityForInput();
            if (!binding || binding.listenerId !== active.status.listenerId || binding.romSha256 !== identity.romSha256 ||
                binding.runtimeSha256 !== identity.runtimeSha256 || binding.sourceRevision !== identity.sourceRevision ||
                !this.#isProjectSelected(input.projectRoot))
                throw new Error("Browser input requires the exact current listener, project and build binding from status.");
            const receipt = await players.requestInput(binding.viewId, binding.inputGeneration, input.buttons, input.durationMs ?? 250, input.signal);
            unchanged();
            return { ...result, binding, receipt };
        }
        if (input.action === "list_states") {
            const listed = await states.list();
            unchanged();
            return { ...result, states: listed };
        }
        if (input.action === "capture_state") {
            const captured = await players.request("capture", { viewId: input.viewId });
            unchanged();
            if (!captured.state)
                throw new Error("The browser did not return a captured state.");
            const write = states.save(captured.state);
            active.stateWrites.add(write);
            let state;
            try {
                state = await write;
            }
            finally {
                active.stateWrites.delete(write);
            }
            unchanged();
            return { ...result, state, paused: true };
        }
        if (!input.stateId)
            throw new Error("Choose a saved state ID from list_states.");
        const state = await states.read(input.stateId);
        unchanged();
        if (!state)
            throw new Error("This saved state is unavailable for the current game build.");
        const restored = await players.request("restore", { viewId: input.viewId, state });
        unchanged();
        return { ...result, stateId: input.stateId, frame: restored.frame, paused: true };
    }
    async start(outputRoot, annotations) {
        return this.#serialize(async () => {
            this.#assertOpen();
            if (typeof outputRoot !== "string" || outputRoot.trim().length === 0) {
                throw new Error("A game web-export directory is required.");
            }
            if (this.#platform === "win32")
                assertSafePlatformPath(outputRoot, this.#platform);
            const candidate = path.resolve(outputRoot);
            if (this.#platform === "win32")
                assertSafePlatformPath(candidate, this.#platform);
            const requested = await lstat(candidate);
            if (requested.isSymbolicLink() || !requested.isDirectory()) {
                throw new Error("The game web-export directory must be a real directory.");
            }
            const root = await realpath(candidate);
            if (this.#platform === "win32" &&
                !pathsMatch(root, candidate, this.#platform)) {
                throw new Error("The game web-export directory must not contain a reparse point.");
            }
            if ((await verifyAssetPath(root, "index.html", this.#platform)) === null) {
                throw new Error("The game web export must contain a real index.html file.");
            }
            this.#assertClosureResolved();
            // Finish all reads before replacing the live listener. Missing or changed
            // trusted assets must not close an otherwise usable official preview.
            const prepared = annotations === undefined ? undefined : await prepareAnnotations(root, annotations, this.#platform, !!this.#flash, !!this.#serveDeviceView, this.#deviceCaptureAvailability?.());
            this.#assertOpen();
            this.#assertClosureResolved();
            const activePreview = this.#active;
            if (activePreview !== null && activePreview.server.listening && activePreview.status.closureState === "open" && activePreview.status.outputRoot === root) {
                if (prepared && prepared.reuseKey === activePreview.annotations?.reuseKey) {
                    activePreview.status.reused = true;
                    return copyStatus(activePreview.status);
                }
                // Keep the existing preview URL across rebuilds. All preparation above
                // finishes before this synchronous swap, so requests see one complete
                // context/module set. Already loaded pages retain their own ROM context.
                const status = { ...activePreview.status, reused: true };
                try {
                    await this.#drainActive(activePreview, false);
                }
                catch (error) {
                    activePreview.status.closureState = activePreview.annotations?.players?.recording?.closeUncertain ? "unresolved" : "open";
                    activePreview.status.closeError = error instanceof Error ? error.message : String(error);
                    throw error;
                }
                activePreview.acceptingStateRequests = false;
                this.#assertOpen();
                if (this.#active !== activePreview || !activePreview.server.listening || activePreview.status.closureState !== "open") {
                    throw new Error("The browser preview closed while it was being reopened.");
                }
                activePreview.annotations?.players?.close();
                if (prepared) {
                    activePreview.annotations = prepared;
                    status.annotations = { injected: true, fingerprint: prepared.fingerprint };
                }
                else {
                    delete activePreview.annotations;
                    delete status.annotations;
                }
                delete activePreview.drainDeadline;
                activePreview.status = status;
                activePreview.acceptingStateRequests = true;
                return copyStatus(activePreview.status);
            }
            await this.#stopActive();
            this.#assertOpen();
            const capability = randomBytes(CAPABILITY_BYTES).toString("hex");
            let active;
            const server = createServer((request, response) => {
                void serveAsset(request, response, active).catch(() => reject(response, 500, "Internal server error"));
            });
            server.requestTimeout = 10_000;
            server.headersTimeout = 10_000;
            server.keepAliveTimeout = 5_000;
            server.maxHeadersCount = 32;
            await listenLoopback(server, this.#closedPort);
            const address = server.address();
            if (address === null || typeof address === "string" || address.address !== LOOPBACK_ADDRESS) {
                await new Promise((resolve) => server.close(() => resolve()));
                throw new Error("The game web preview could not bind its loopback listener.");
            }
            const status = {
                url: `http://${LOOPBACK_ADDRESS}:${address.port}/${capability}/`,
                port: address.port,
                outputRoot: root,
                reused: false,
                listenerId: randomBytes(16).toString("hex"),
                startedAt: new Date().toISOString(),
                kind: "in-process-http",
                listening: true,
                closureState: "open",
                ...(prepared ? { annotations: { injected: true, fingerprint: prepared.fingerprint } } : {}),
            };
            active = { server, capability, status, platform: this.#platform, stateWrites: new Set(), acceptingStateRequests: true,
                flash: this.#flash, isProjectSelected: this.#isProjectSelected, serveDeviceView: this.#serveDeviceView, ...(prepared ? { annotations: prepared } : {}) };
            this.#active = active;
            server.on("close", () => {
                if (active.annotations?.players?.recording?.busy) {
                    active.annotations.players.recording.markUnknown("The listener closed before capture finalization was confirmed.");
                    active.status.closureState = "unresolved";
                }
                if (active.annotations?.players?.input.blocking) {
                    active.annotations.players.input.connectionLost();
                    active.status.closureState = "unresolved";
                    active.status.closeError = "The listener closed before browser input release was confirmed.";
                    return;
                }
                try {
                    active.annotations?.players?.close();
                }
                catch (error) {
                    active.status.closureState = "unresolved";
                    active.status.closeError = error instanceof Error ? error.message : String(error);
                }
                // TCP closure alone does not settle pending state/capture writes.
                if (this.#active?.server === server && active.status.closureState === "open")
                    this.#active = null;
            });
            if (this.#disposed) {
                await this.#stopActive();
                this.#assertOpen();
            }
            return copyStatus(status);
        });
    }
    #assertClosureResolved() {
        if (this.#active?.status.closureState === "unresolved") {
            throw new Error("The previous web-preview listener has unresolved closure; close it before starting another preview.");
        }
    }
    #assertOpen() {
        if (this.#disposed)
            throw new Error("The web-preview service is closed.");
    }
    /** Terminal plugin teardown; ordinary stop() remains reusable. */
    dispose() {
        this.#disposed = true;
        return this.#disposal ??= this.stop();
    }
    async stop() {
        // A reopening operation can itself be waiting on a state write. Stop
        // listener admission now, not only once that serialized operation drains.
        const pending = this.#active ? this.#stopActive() : undefined;
        void pending?.catch(() => undefined);
        return this.#serialize(async () => {
            const previous = await pending;
            return this.#active ? this.#stopActive() : previous ?? this.#stopActive();
        });
    }
    async #serialize(operation) {
        const previous = this.#operation;
        let release;
        this.#operation = new Promise((resolve) => {
            release = resolve;
        });
        await previous;
        try {
            return await operation();
        }
        finally {
            release();
        }
    }
    #stopActive() {
        const active = this.#active;
        if (active === null)
            return Promise.resolve({ closed: true, hadActiveListener: false, closeObserved: false, exportRetained: true });
        if (active.closing)
            return active.closing;
        const closing = this.#closeActive(active);
        active.closing = closing;
        // A confirmed failure remains visible and can be explicitly retried.
        void closing.catch(() => { if (active.closing === closing)
            delete active.closing; });
        return closing;
    }
    async #drainActive(active, terminal) {
        const recording = active.annotations?.players?.recording;
        active.drainDeadline ??= performance.now() + 30_000;
        let expired = false, timer;
        const current = () => { if (expired || performance.now() >= active.drainDeadline)
            throw new Error("Preview finalization deadline is UNKNOWN."); };
        const work = async () => {
            await recording?.drain(terminal);
            current();
            await active.annotations?.players?.input.drain();
            current();
            active.acceptingStateRequests = false;
            await Promise.all([...active.stateWrites, ...(active.captureUpload ? [active.captureUpload] : [])]);
            current();
        };
        try {
            await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => { expired = true; recording?.markUnknown("Preview finalization deadline is UNKNOWN. Preserve the original capture."); reject(new Error("Preview finalization deadline is UNKNOWN.")); }, Math.max(0, active.drainDeadline - performance.now())); })]);
        }
        catch (error) {
            expired = true;
            // An ordinary human refusal cancels its close attempt, not its capture.
            if (!recording?.closeUncertain && !terminal)
                delete active.drainDeadline;
            throw error;
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
    async #closeActive(active) {
        let terminalError;
        active.status.closureState = "closing";
        try {
            await this.#drainActive(active, this.#disposed);
        }
        catch (error) {
            active.status.closureState = active.annotations?.players?.recording?.closeUncertain ? "unresolved" : "open";
            active.status.closeError = error instanceof Error ? error.message : String(error);
            if (!this.#disposed)
                throw error;
            terminalError = error;
        }
        active.acceptingStateRequests = false;
        try {
            active.annotations?.players?.close();
        }
        catch (error) {
            active.status.closureState = "unresolved";
            active.status.closeError = String(error);
            if (!this.#disposed)
                throw error;
            terminalError ??= error;
        }
        finally {
            if (this.#disposed)
                active.annotations?.players?.recording?.dispose();
        }
        // Stop accepting connections before waiting for writes. TCP closure may
        // finish first, but the active record keeps ownership until both settle.
        const listener = new Promise((resolve, rejectStop) => {
            active.server.close((error) => { error ? rejectStop(error) : resolve(); });
            active.server.closeAllConnections();
        });
        const [closed] = await Promise.allSettled([listener]);
        if (closed.status === "rejected") {
            const error = closed.reason;
            active.status.closureState = "unresolved";
            active.status.closeError = error instanceof Error ? error.message : String(error);
            throw error;
        }
        this.#closedPort = active.status.port;
        if (this.#active === active)
            this.#active = null;
        if (terminalError)
            throw terminalError;
        return {
            closed: true, hadActiveListener: true, listenerId: active.status.listenerId,
            closedAt: new Date().toISOString(), closeObserved: true, exportRetained: true,
        };
    }
}
//# sourceMappingURL=web-preview.js.map