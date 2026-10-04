import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { PNG } from "pngjs";
import { GameStudioProjectError, } from "./project.js";
import { PROJECT_RESPONSE_LIMITS } from "./project-access.js";
import { loadProjectSnapshot } from "./project-snapshot.js";
const TILE_SIZE = 8;
const SCREEN_WIDTH = 160;
const SCREEN_HEIGHT = 144;
const DEFAULT_MAX_WIDTH = 128;
const DEFAULT_VISIBLE_LINES = 3;
const AVATAR_RESERVED_WIDTH = 24;
const MAX_FONT_BYTES = 4 * 1024 * 1024;
const MAX_FONT_DIMENSION = 1024;
const MAX_DIAGNOSTICS = 64;
const MAX_EVENTS = 2048;
const MAX_PAGES = 4096;
const DEFAULT_PROJECTED_EVENTS = 50;
const DEFAULT_PROJECTED_PAGES = 50;
const CONTROL_TOKEN = /\$[^$\r\n]+\$|@[^@\r\n]+@|\{\{[^{}\r\n]+\}\}|\\[A-Za-z][A-Za-z0-9]*(?:\[[^\]\r\n]*\])?/gu;
const indexedFontCache = new WeakMap();
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isInsideRoot(root, candidate) {
    const relative = path.relative(root, candidate);
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
async function readBoundedProjectFile(projectRoot, resourcePath) {
    const candidate = path.resolve(projectRoot, resourcePath);
    if (!isInsideRoot(projectRoot, candidate)) {
        throw new GameStudioProjectError("PATH_OUTSIDE_PROJECT", `Resource is outside the project: ${resourcePath}`, resourcePath);
    }
    let canonical;
    try {
        canonical = await realpath(candidate);
    }
    catch (error) {
        throw new GameStudioProjectError("RESOURCE_NOT_FOUND", `Project resource does not exist: ${resourcePath}`, resourcePath);
    }
    if (!isInsideRoot(projectRoot, canonical)) {
        throw new GameStudioProjectError("PATH_OUTSIDE_PROJECT", `Resource resolves outside the project: ${resourcePath}`, resourcePath);
    }
    const info = await stat(canonical);
    if (!info.isFile() || info.size > MAX_FONT_BYTES) {
        throw new GameStudioProjectError("INVALID_RESOURCE", `Resource is not a bounded regular file: ${resourcePath}`, resourcePath);
    }
    return readFile(canonical);
}
function decodeFontImage(bytes, resourcePath) {
    if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
        throw new GameStudioProjectError("INVALID_FONT", `Font is not a valid PNG: ${resourcePath}`, resourcePath);
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width < TILE_SIZE || height < TILE_SIZE || width > MAX_FONT_DIMENSION || height > MAX_FONT_DIMENSION || width % TILE_SIZE !== 0 || height % TILE_SIZE !== 0) {
        throw new GameStudioProjectError("INVALID_FONT", `Font atlas dimensions must be bounded multiples of eight: ${resourcePath}`, resourcePath);
    }
    try {
        return PNG.sync.read(bytes);
    }
    catch (error) {
        throw new GameStudioProjectError("INVALID_FONT", `Could not decode font atlas ${resourcePath}: ${error instanceof Error ? error.message : String(error)}`, resourcePath);
    }
}
function isMagenta(image, x, y) {
    const offset = (image.width * y + x) * 4;
    return image.data[offset] === 255 && image.data[offset + 1] === 0 && image.data[offset + 2] === 255 && (image.data[offset + 3] ?? 0) > 0;
}
function measureGlyph(image, index) {
    const columns = image.width / TILE_SIZE;
    const startX = (index % columns) * TILE_SIZE;
    const startY = Math.floor(index / columns) * TILE_SIZE;
    let width = TILE_SIZE;
    while (width > 0) {
        let padding = true;
        for (let y = 0; y < TILE_SIZE; y += 1) {
            if (!isMagenta(image, startX + width - 1, startY + y)) {
                padding = false;
                break;
            }
        }
        if (!padding)
            break;
        width -= 1;
    }
    return Math.max(width, 1);
}
function addMappings(mapping, source, glyphCount) {
    if (!isObject(source))
        return;
    for (const [key, value] of Object.entries(source)) {
        if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value < glyphCount) {
            mapping.set(key, value);
        }
        else if (typeof value === "string" && /^\d+$/u.test(key)) {
            const index = Number(key);
            if (index >= 0 && index < glyphCount)
                mapping.set(value, index);
        }
    }
}
export async function loadDialogueFont(inventory, requestedFontId, access) {
    const fontId = requestedFontId ?? (typeof inventory.settings.defaultFontId === "string" ? inventory.settings.defaultFontId : "");
    const fonts = inventory.assets.filter((asset) => asset.type === "font");
    const asset = fontId ? fonts.find((candidate) => candidate.id === fontId) : fonts.length === 1 ? fonts[0] : undefined;
    if (!asset) {
        throw new GameStudioProjectError("FONT_NOT_FOUND", fontId ? `The selected font does not exist: ${fontId}` : "The project has no unambiguous selected font");
    }
    const mappingPath = asset.resourcePath.replace(/\.png$/iu, ".json");
    const indexedAccess = access;
    const pngDigest = indexedAccess?.authoredFile?.(asset.resourcePath)?.sha256;
    const sidecarDigest = asset.metadataPath ? indexedAccess?.authoredFile?.(asset.metadataPath)?.sha256 : undefined;
    const mappingDigest = indexedAccess?.authoredFile?.(mappingPath)?.sha256;
    const cacheKey = pngDigest === undefined
        ? undefined
        : JSON.stringify([asset.id, fontId, pngDigest, sidecarDigest ?? null, mappingDigest ?? null]);
    if (access && cacheKey) {
        const cached = indexedFontCache.get(access)?.get(cacheKey);
        if (cached)
            return cached;
    }
    const image = decodeFontImage(await readBoundedProjectFile(inventory.projectRoot, asset.resourcePath), asset.resourcePath);
    const glyphCount = (image.width / TILE_SIZE) * (image.height / TILE_SIZE);
    const glyphWidths = Array.from({ length: glyphCount }, (_, index) => measureGlyph(image, index));
    const mapping = new Map();
    for (let index = 0; index < glyphCount; index += 1) {
        mapping.set(String.fromCodePoint(index + 32), index);
    }
    addMappings(mapping, asset.mapping, glyphCount);
    try {
        const parsed = JSON.parse((await readBoundedProjectFile(inventory.projectRoot, mappingPath)).toString("utf8"));
        if (isObject(parsed))
            addMappings(mapping, parsed.mapping, glyphCount);
    }
    catch (error) {
        if (!(error instanceof GameStudioProjectError) || error.code !== "RESOURCE_NOT_FOUND")
            throw error;
    }
    const font = {
        id: asset.id,
        name: asset.name,
        variableWidth: glyphWidths.some((width) => width !== TILE_SIZE),
        image,
        glyphWidths,
        mapping,
        resourcePath: asset.resourcePath,
    };
    if (access && cacheKey) {
        let fonts = indexedFontCache.get(access);
        if (!fonts) {
            fonts = new Map();
            indexedFontCache.set(access, fonts);
        }
        fonts.set(cacheKey, font);
        if (fonts.size > 32)
            fonts.delete(fonts.keys().next().value);
    }
    return font;
}
function isDialogueCommand(command) {
    return command === "EVENT_TEXT";
}
function collectResourceEvents(resource, sceneId, owner, requestedScriptKey, destination) {
    const visit = (values, scriptKey) => {
        for (const candidate of values) {
            if (!isObject(candidate))
                continue;
            const args = isObject(candidate.args) ? candidate.args : {};
            if (isDialogueCommand(candidate.command) && (typeof args.text === "string" || (Array.isArray(args.text) && args.text.every((page) => typeof page === "string")))) {
                if (destination.length >= MAX_EVENTS)
                    throw new GameStudioProjectError("DIALOGUE_LIMIT_EXCEEDED", `Dialogue analysis is limited to ${MAX_EVENTS} events`);
                destination.push({
                    id: typeof candidate.id === "string" ? candidate.id : "",
                    command: candidate.command,
                    sceneId,
                    ...owner,
                    scriptKey,
                    resourcePath: resource.resourcePath,
                    text: args.text,
                    avatarId: typeof args.avatarId === "string" ? args.avatarId : "",
                    position: args.position === "top" ? "top" : "bottom",
                });
            }
            if (isObject(candidate.children)) {
                for (const branch of Object.values(candidate.children)) {
                    if (Array.isArray(branch))
                        visit(branch, scriptKey);
                }
            }
        }
    };
    for (const [key, value] of Object.entries(resource)) {
        if (!Array.isArray(value) || (key !== "script" && !key.endsWith("Script")) || (requestedScriptKey && key !== requestedScriptKey))
            continue;
        visit(value, key);
    }
}
export function collectDialogueEvents(inventory, input = {}, access) {
    if (input.actorId && input.triggerId)
        throw new GameStudioProjectError("INVALID_DIALOGUE_TARGET", "A dialogue target cannot select both an actor and a trigger");
    let scenes = inventory.scenes;
    if (input.sceneId) {
        const indexedScene = access?.scene(input.sceneId);
        scenes = indexedScene ? [indexedScene] : scenes.filter((scene) => scene.id === input.sceneId);
        if (scenes.length === 0)
            throw new GameStudioProjectError("SCENE_NOT_FOUND", `No scene exists with id ${input.sceneId}`);
    }
    const result = [];
    let ownerFound = !input.actorId && !input.triggerId;
    for (const scene of scenes) {
        if (!input.actorId && !input.triggerId)
            collectResourceEvents(scene, scene.id, {}, input.scriptKey, result);
        for (const actor of scene.actors) {
            if (input.triggerId || (input.actorId && actor.id !== input.actorId))
                continue;
            if (input.actorId)
                ownerFound = true;
            collectResourceEvents(actor, scene.id, { actorId: actor.id }, input.scriptKey, result);
        }
        for (const trigger of scene.triggers) {
            if (input.actorId || (input.triggerId && trigger.id !== input.triggerId))
                continue;
            if (input.triggerId)
                ownerFound = true;
            collectResourceEvents(trigger, scene.id, { triggerId: trigger.id }, input.scriptKey, result);
        }
    }
    if (!ownerFound) {
        throw new GameStudioProjectError(input.actorId ? "ACTOR_NOT_FOUND" : "TRIGGER_NOT_FOUND", `The requested dialogue resource does not exist: ${input.actorId ?? input.triggerId}`);
    }
    const selected = input.eventId ? result.filter((event) => event.id === input.eventId) : result;
    if (input.eventId && selected.length === 0)
        throw new GameStudioProjectError("EVENT_NOT_FOUND", `No dialogue event exists with id ${input.eventId}`);
    return selected;
}
function boundedPositiveInteger(value, fallback, maximum, name) {
    if (value === undefined)
        return fallback;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum)
        throw new GameStudioProjectError("INVALID_DIALOGUE_LAYOUT", `${name} must be an integer between 1 and ${maximum}`);
    return value;
}
function measureLine(font, text) {
    const tokens = [];
    const visibleText = text.replace(CONTROL_TOKEN, (token) => {
        tokens.push(token);
        return "";
    });
    let width = 0;
    const missing = [];
    for (const character of visibleText) {
        const index = font.mapping.get(character);
        if (index === undefined) {
            missing.push(character);
            width += TILE_SIZE;
        }
        else {
            width += font.glyphWidths[index] ?? TILE_SIZE;
        }
    }
    return { width, tokens, missing };
}
function wrapLine(font, line, maxWidth) {
    if (measureLine(font, line).width <= maxWidth)
        return [line];
    const pieces = line.match(/[^\s]+|[\t ]+/gu) ?? [line];
    let current = "";
    let pending = "";
    const lines = [];
    for (const piece of pieces) {
        if (/^[\t ]+$/u.test(piece)) {
            pending += piece;
            continue;
        }
        if (current && measureLine(font, `${current}${pending}${piece}`).width > maxWidth) {
            lines.push(current);
            current = piece;
        }
        else {
            current += pending + piece;
        }
        pending = "";
    }
    if (pending)
        current += pending;
    if (current || lines.length === 0)
        lines.push(current);
    return lines;
}
function transformPages(font, pages, maxWidth, maxVisibleLines, wrap, paginate) {
    const result = [];
    for (const page of pages) {
        const lines = page.split("\n").flatMap((line) => wrap ? wrapLine(font, line, maxWidth) : [line]);
        if (paginate && lines.length > maxVisibleLines) {
            for (let index = 0; index < lines.length; index += maxVisibleLines)
                result.push(lines.slice(index, index + maxVisibleLines).join("\n"));
        }
        else {
            result.push(lines.join("\n"));
        }
    }
    return result;
}
function verifyAvatar(inventory, avatarId, access) {
    if (!avatarId)
        return undefined;
    const lookup = access?.asset({ assetId: avatarId });
    const avatar = lookup?.status === "unique" && lookup.asset.type === "avatar"
        ? lookup.asset
        : inventory.assets.find((asset) => asset.type === "avatar" && asset.id === avatarId);
    if (!avatar)
        throw new GameStudioProjectError("AVATAR_NOT_FOUND", `The selected avatar does not exist: ${avatarId}`);
    if (!inventory.assets.includes(avatar))
        inventory.assets.push(avatar);
    return avatar;
}
function focusedDialogueInventory(access, input) {
    const inspection = access.projectInspection();
    const indexedAccess = access;
    const authoredSettings = indexedAccess.authoredFile?.("project/settings.gbsres")?.json;
    const descriptorPath = path.relative(access.projectRoot, access.projectPath).split(path.sep).join("/");
    const descriptor = indexedAccess.authoredFile?.(descriptorPath)?.json;
    const legacySettings = isObject(descriptor?.settings) ? descriptor.settings : undefined;
    const settings = indexedAccess.settings?.() ?? authoredSettings ?? legacySettings ?? inspection.settings;
    let scenes;
    if (input.sceneId) {
        const scene = access.scene(input.sceneId);
        scenes = scene ? [scene] : [];
    }
    else if (input.actorId || input.triggerId) {
        const ownerType = input.actorId ? "actor" : "trigger";
        const ownerId = input.actorId ?? input.triggerId;
        const owner = access.resource({ type: ownerType, id: ownerId });
        if (owner) {
            const ownerDirectory = owner.resourcePath.replace(/\/(?:actors|triggers)\/[^/]+$/u, "");
            scenes = access.resourcesByKind("scene")
                .filter((scene) => scene.resourcePath.startsWith(`${ownerDirectory}/`));
        }
        else {
            scenes = [];
        }
    }
    else if (input.text !== undefined && input.eventId === undefined) {
        scenes = [];
    }
    else {
        scenes = [...access.resourcesByKind("scene")];
    }
    const assets = [];
    const selectedFontId = input.fontId ?? (typeof settings.defaultFontId === "string" ? settings.defaultFontId : "");
    if (selectedFontId) {
        const font = access.asset({ assetId: selectedFontId });
        if (font.status === "unique" && font.asset.type === "font")
            assets.push(font.asset);
    }
    else {
        for (const candidate of access.resourcesByKind("asset")) {
            const asset = candidate;
            if (asset.type === "font")
                assets.push(asset);
        }
    }
    for (const scene of scenes) {
        if (typeof scene.backgroundId !== "string" || !scene.backgroundId)
            continue;
        const background = access.asset({ assetId: scene.backgroundId });
        if (background.status === "unique" && background.asset.type === "background" && !assets.includes(background.asset)) {
            assets.push(background.asset);
        }
    }
    const uiPaletteId = settings.defaultUIPaletteId;
    const uiPalette = typeof uiPaletteId === "string" ? access.palette(uiPaletteId) : undefined;
    return {
        projectPath: inspection.projectPath,
        projectRoot: inspection.projectRoot,
        descriptor: descriptor ? { ...descriptor } : {},
        format: inspection.format,
        version: inspection.version,
        name: inspection.name,
        author: inspection.author,
        settings: { ...settings },
        scenes,
        actors: scenes.flatMap((scene) => scene.actors),
        triggers: scenes.flatMap((scene) => scene.triggers),
        palettes: uiPalette ? [uiPalette] : [],
        assets,
        diagnostics: [],
        counts: {
            scenes: inspection.counts.scenes,
            actors: inspection.counts.actors,
            triggers: inspection.counts.triggers,
            palettes: inspection.counts.palettes,
            assets: inspection.counts.assets,
        },
    };
}
export async function prepareDialogue(projectPath, input = {}, access) {
    if (access)
        await access.ensureFresh();
    const inventory = access
        ? focusedDialogueInventory(access, input)
        : (await loadProjectSnapshot(projectPath)).inventory;
    const font = await loadDialogueFont(inventory, input.fontId, access);
    const matching = input.text !== undefined && !input.eventId && !input.sceneId && !input.actorId && !input.triggerId
        ? []
        : collectDialogueEvents(inventory, input, access);
    const hasInlineText = input.text !== undefined;
    let events;
    if (hasInlineText) {
        const selected = input.eventId ? matching[0] : undefined;
        events = [{
                id: selected?.id ?? "",
                command: input.eventCommand ?? selected?.command ?? "EVENT_TEXT",
                sceneId: selected?.sceneId ?? input.sceneId ?? "",
                ...(selected?.actorId ?? input.actorId ? { actorId: selected?.actorId ?? input.actorId } : {}),
                ...(selected?.triggerId ?? input.triggerId ? { triggerId: selected?.triggerId ?? input.triggerId } : {}),
                scriptKey: selected?.scriptKey ?? input.scriptKey ?? "script",
                resourcePath: selected?.resourcePath ?? "",
                text: input.text,
                avatarId: input.avatarId ?? selected?.avatarId ?? "",
                position: selected?.position ?? "bottom",
            }];
    }
    else {
        events = matching.filter((event) => !input.eventCommand || event.command === input.eventCommand);
    }
    if (input.wrap !== undefined && input.wrap !== "none" && input.wrap !== "word") {
        throw new GameStudioProjectError("INVALID_DIALOGUE_LAYOUT", "wrap must be none or word");
    }
    if (input.profile !== undefined && !["auto", "conservative"].includes(input.profile)) {
        throw new GameStudioProjectError("INVALID_DIALOGUE_LAYOUT", "profile must be auto or conservative");
    }
    const visibleLines = boundedPositiveInteger(input.maxVisibleLines, DEFAULT_VISIBLE_LINES, 16, "maxVisibleLines");
    const baseWidth = boundedPositiveInteger(input.maxWidthPx, DEFAULT_MAX_WIDTH, SCREEN_WIDTH, "maxWidthPx");
    const anyAvatar = Boolean(input.avatarId || events.some((event) => event.avatarId));
    if (input.avatarId)
        verifyAvatar(inventory, input.avatarId, access);
    const diagnostics = [];
    const diagnosticCounts = {};
    const pageSummaries = [];
    const eventSummaries = [];
    let totalLines = 0;
    let maximumMeasuredLinePx = 0;
    let confidence = "conservative";
    let suggestion;
    const report = (diagnostic) => {
        diagnosticCounts[diagnostic.code] = (diagnosticCounts[diagnostic.code] ?? 0) + 1;
        if (diagnostics.length < MAX_DIAGNOSTICS)
            diagnostics.push(diagnostic);
    };
    for (const event of events) {
        const avatarId = input.avatarId ?? event.avatarId;
        verifyAvatar(inventory, avatarId, access);
        const maxWidthPx = Math.max(1, baseWidth - (avatarId ? AVATAR_RESERVED_WIDTH : 0));
        const originalPages = Array.isArray(event.text) ? [...event.text] : [event.text];
        if (originalPages.length + pageSummaries.length > MAX_PAGES)
            throw new GameStudioProjectError("DIALOGUE_LIMIT_EXCEEDED", `Dialogue analysis is limited to ${MAX_PAGES} pages`);
        const explicitTransformation = input.wrap === "word" || input.paginate === true;
        const analyzedPages = explicitTransformation ? transformPages(font, originalPages, maxWidthPx, visibleLines, input.wrap === "word", input.paginate === true) : originalPages;
        if ((input.includeSuggestion || explicitTransformation) && events.length === 1) {
            const suggestedPages = explicitTransformation ? analyzedPages : transformPages(font, originalPages, maxWidthPx, visibleLines, true, true);
            const changed = suggestedPages.length !== originalPages.length || suggestedPages.some((page, index) => page !== originalPages[index]);
            suggestion = {
                text: Array.isArray(event.text) || suggestedPages.length !== 1 ? suggestedPages : suggestedPages[0],
                pages: suggestedPages,
                changed,
            };
        }
        eventSummaries.push({
            id: event.id,
            command: event.command,
            sceneId: event.sceneId,
            ...(event.actorId ? { actorId: event.actorId } : {}),
            ...(event.triggerId ? { triggerId: event.triggerId } : {}),
            scriptKey: event.scriptKey,
            pageCount: analyzedPages.length,
            resourcePath: event.resourcePath,
        });
        for (let pageIndex = 0; pageIndex < analyzedPages.length; pageIndex += 1) {
            const page = analyzedPages[pageIndex];
            const lines = page.split("\n");
            let maximumPageLinePx = 0;
            if (lines.length > visibleLines) {
                report({ severity: "error", code: "PAGE_OVERFLOW", message: `Page ${pageIndex + 1} has ${lines.length} visible lines; the selected profile allows ${visibleLines}`, ...(event.id ? { eventId: event.id } : {}), pageIndex, ...(event.resourcePath ? { resourcePath: event.resourcePath } : {}) });
            }
            for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
                const measured = measureLine(font, lines[lineIndex]);
                maximumPageLinePx = Math.max(maximumPageLinePx, measured.width);
                maximumMeasuredLinePx = Math.max(maximumMeasuredLinePx, measured.width);
                totalLines += 1;
                if (measured.width > maxWidthPx) {
                    report({ severity: "error", code: "LINE_OVERFLOW", message: `Line ${lineIndex + 1} measures ${measured.width}px, exceeding the ${maxWidthPx}px dialogue box`, ...(event.id ? { eventId: event.id } : {}), pageIndex, lineIndex, measuredWidthPx: measured.width, maxWidthPx, ...(event.resourcePath ? { resourcePath: event.resourcePath } : {}) });
                }
                if (measured.tokens.length > 0) {
                    confidence = "uncertain";
                    report({ severity: "warning", code: "UNSUPPORTED_CONTROL_TOKEN", message: `Runtime interpolation or control-token width is not statically verified: ${measured.tokens.join(", ")}`, ...(event.id ? { eventId: event.id } : {}), pageIndex, lineIndex, ...(event.resourcePath ? { resourcePath: event.resourcePath } : {}) });
                }
                if (measured.missing.length > 0) {
                    confidence = "uncertain";
                    report({ severity: "warning", code: "GLYPH_NOT_FOUND", message: `The selected font does not map ${Array.from(new Set(measured.missing)).join(", ")}; an eight-pixel fallback was measured`, ...(event.id ? { eventId: event.id } : {}), pageIndex, lineIndex, ...(event.resourcePath ? { resourcePath: event.resourcePath } : {}) });
                }
            }
            pageSummaries.push({
                ...(event.id ? { eventId: event.id } : {}),
                command: event.command,
                ...(event.sceneId ? { sceneId: event.sceneId } : {}),
                ...(event.actorId ? { actorId: event.actorId } : {}),
                ...(event.triggerId ? { triggerId: event.triggerId } : {}),
                pageIndex,
                text: page,
                lineCount: lines.length,
                maximumMeasuredLinePx: maximumPageLinePx,
                avatarPresent: Boolean(avatarId),
                ...(event.resourcePath ? { resourcePath: event.resourcePath } : {}),
            });
        }
    }
    const diagnosticCount = Object.values(diagnosticCounts).reduce((sum, count) => sum + count, 0);
    const analysis = {
        valid: (diagnosticCounts.LINE_OVERFLOW ?? 0) === 0 && (diagnosticCounts.PAGE_OVERFLOW ?? 0) === 0,
        confidence,
        font: { id: font.id, name: font.name, variableWidth: font.variableWidth },
        layout: { screenWidth: SCREEN_WIDTH, screenHeight: SCREEN_HEIGHT, maxWidthPx: Math.max(1, baseWidth - (anyAvatar ? AVATAR_RESERVED_WIDTH : 0)), maxVisibleLines: visibleLines, avatarPresent: anyAvatar },
        eventCount: events.length,
        pageCount: pageSummaries.length,
        lineCount: totalLines,
        maximumMeasuredLinePx,
        events: eventSummaries,
        pages: pageSummaries,
        diagnostics,
        diagnosticCount,
        diagnosticCounts,
        ...(suggestion ? { suggestion } : {}),
    };
    return { inventory, font, events, analysis };
}
function projectDialogueAnalysis(analysis, input) {
    const requestedEventLimit = input.eventLimit;
    const requestedPageLimit = input.pageLimit;
    if (requestedEventLimit !== undefined && (!Number.isSafeInteger(requestedEventLimit) || requestedEventLimit < 1 || requestedEventLimit > MAX_EVENTS)) {
        throw new GameStudioProjectError("INVALID_DIALOGUE_LAYOUT", `eventLimit must be an integer between 1 and ${MAX_EVENTS}`);
    }
    if (requestedPageLimit !== undefined && (!Number.isSafeInteger(requestedPageLimit) || requestedPageLimit < 1 || requestedPageLimit > MAX_PAGES)) {
        throw new GameStudioProjectError("INVALID_DIALOGUE_LAYOUT", `pageLimit must be an integer between 1 and ${MAX_PAGES}`);
    }
    let eventLimit = requestedEventLimit ?? analysis.events.length;
    let pageLimit = requestedPageLimit ?? analysis.pages.length;
    let projected = {
        ...analysis,
        events: analysis.events.slice(0, eventLimit),
        pages: analysis.pages.slice(0, pageLimit),
    };
    let byteSize = Buffer.byteLength(JSON.stringify(projected));
    if (byteSize > PROJECT_RESPONSE_LIMITS.semanticQueryBytes) {
        eventLimit = Math.min(eventLimit, DEFAULT_PROJECTED_EVENTS);
        pageLimit = Math.min(pageLimit, DEFAULT_PROJECTED_PAGES);
    }
    while (true) {
        const truncated = eventLimit < analysis.eventCount || pageLimit < analysis.pageCount;
        projected = {
            ...analysis,
            events: analysis.events.slice(0, eventLimit),
            pages: analysis.pages.slice(0, pageLimit),
            ...(truncated ? {
                returnedEventCount: Math.min(eventLimit, analysis.eventCount),
                returnedPageCount: Math.min(pageLimit, analysis.pageCount),
                truncated: true,
            } : {}),
        };
        byteSize = Buffer.byteLength(JSON.stringify(projected));
        if (byteSize <= PROJECT_RESPONSE_LIMITS.semanticQueryBytes)
            return projected;
        if (pageLimit > 1)
            pageLimit = Math.max(1, Math.floor(pageLimit / 2));
        else if (eventLimit > 1)
            eventLimit = Math.max(1, Math.floor(eventLimit / 2));
        else {
            throw new GameStudioProjectError("DIALOGUE_RESPONSE_TOO_LARGE", `A requested dialogue event or page exceeds the ${PROJECT_RESPONSE_LIMITS.semanticQueryBytes}-byte response limit; select a smaller event or page`);
        }
    }
}
export async function analyzeDialogue(projectPath, input = {}, access) {
    const analysis = (await prepareDialogue(projectPath, input, access)).analysis;
    return access || input.eventLimit !== undefined || input.pageLimit !== undefined
        ? projectDialogueAnalysis(analysis, input)
        : analysis;
}
//# sourceMappingURL=dialogue.js.map