import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { authenticatedSourceBuild, captureBuildSourceProvenance, sameBuildSourceProvenance, } from "./build-provenance.js";
import { createDebugManifest, decodeCurrentScene, hashDebugRom, parseGlobalsDefinitions, parseNoiDefinitions, validateDebugManifest, } from "./debug-symbols.js";
import { isPathWithinRoot } from "./platform.js";
import { PROJECT_RESPONSE_LIMITS } from "./project-access.js";
import { loadProjectSnapshot } from "./project-snapshot.js";
import { decodeResourceBytes } from "./resource-codec.js";
import { worldDependencies } from "./world-queries.js";
export const MAX_SOURCE_DEBUG_VARIABLES = 32;
export const MAX_SOURCE_DEBUG_COLLISION_CELLS = 256;
export const MAX_SOURCE_DEBUG_REFERENCES = 64;
const WRAM_BASE = 0xc000;
const SHA256 = /^[a-f0-9]{64}$/;
const SCENE_SYMBOL = /^scene_[A-Za-z0-9_]+$/;
const VARIABLE_SYMBOL = /^var_[A-Za-z0-9_]+$/;
export class SourceDebugError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "SourceDebugError";
    }
}
function fail(code, message) {
    throw new SourceDebugError(code, message);
}
function samePath(left, right) {
    return isPathWithinRoot(left, right) && isPathWithinRoot(right, left);
}
function validSelector(value) {
    return typeof value === "string" && value.length > 0 && value.length <= 256 && !value.includes("\0");
}
function variableSummary(variable, reason) {
    return { id: variable.id, variableId: variable.id, name: variable.name,
        ...(typeof variable.symbol === "string" ? { symbol: variable.symbol } : {}), reason };
}
async function authenticatedFile(root, filename, expectedHash) {
    if (!SHA256.test(expectedHash) || !isPathWithinRoot(root, filename)) {
        fail("SOURCE_DEBUG_ARTIFACT_MISMATCH", "The captured debug artifact is outside its selected project or has an invalid digest.");
    }
    let handle;
    try {
        const metadata = await lstat(filename, { bigint: true });
        if (!metadata.isFile() || metadata.isSymbolicLink() || !samePath(await realpath(filename), filename)) {
            fail("SOURCE_DEBUG_ARTIFACT_MISMATCH", "A captured debug artifact was replaced by a symbolic link or non-file.");
        }
        handle = await open(filename, constants.O_RDONLY | (process.platform === "win32" ? 0 : (constants.O_NOFOLLOW ?? 0)));
        const opened = await handle.stat({ bigint: true });
        if (opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size
            || opened.mtimeNs !== metadata.mtimeNs || opened.ctimeNs !== metadata.ctimeNs) {
            fail("SOURCE_DEBUG_ARTIFACT_MISMATCH", "A captured debug artifact changed while it was opened.");
        }
        const bytes = await handle.readFile();
        const after = await handle.stat({ bigint: true });
        if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size
            || after.mtimeNs !== opened.mtimeNs || after.ctimeNs !== opened.ctimeNs) {
            fail("SOURCE_DEBUG_ARTIFACT_MISMATCH", "A captured debug artifact changed while it was read.");
        }
        if (hashDebugRom(bytes) !== expectedHash) {
            fail("SOURCE_DEBUG_ARTIFACT_MISMATCH", "Captured ROM or debug sidecar bytes no longer match this successful build. Rebuild with captureDebugArtifacts:true.");
        }
        return bytes;
    }
    catch (error) {
        if (error instanceof SourceDebugError)
            throw error;
        throw new SourceDebugError("SOURCE_DEBUG_ARTIFACT_MISMATCH", "A captured ROM or debug sidecar is no longer readable. Rebuild with captureDebugArtifacts:true.");
    }
    finally {
        await handle?.close();
    }
}
function sourceScene(scene, symbol) {
    return { id: scene.id, sceneId: scene.id, name: scene.name, symbol, resourcePath: scene.resourcePath,
        type: typeof scene.type === "string" ? scene.type : null,
        width: typeof scene.width === "number" ? scene.width : null,
        height: typeof scene.height === "number" ? scene.height : null };
}
function collisionRegion(scene, region) {
    const width = scene.width;
    const height = scene.height;
    if (typeof width !== "number" || typeof height !== "number" || !Number.isInteger(width) || !Number.isInteger(height)
        || width < 1 || height < 1 || width > 255 || height > 255 || typeof scene.collisions !== "string") {
        fail("SOURCE_DEBUG_COLLISIONS_UNAVAILABLE", "This scene does not have a supported authored collision grid.");
    }
    if (!region || typeof region !== "object" || ![region.x, region.y, region.width, region.height].every(Number.isInteger)
        || region.x < 0 || region.y < 0 || region.width < 1 || region.height < 1
        || region.x + region.width > width || region.y + region.height > height
        || region.width * region.height > MAX_SOURCE_DEBUG_COLLISION_CELLS) {
        fail("SOURCE_DEBUG_INVALID_QUERY", `Collision rectangles must fit inside the current scene and contain at most ${MAX_SOURCE_DEBUG_COLLISION_CELLS} tiles.`);
    }
    const decoded = decodeResourceBytes(scene.collisions, { maximumValues: width * height, allowImplicitZeroGrid: true });
    const cells = [];
    for (let y = region.y; y < region.y + region.height; y++) {
        for (let x = region.x; x < region.x + region.width; x++)
            cells.push(decoded[y * width + x] ?? 0);
    }
    return { source: "authored", sceneId: scene.id, resourcePath: scene.resourcePath, ...region, cells };
}
export class SourceDebugContext {
    identity;
    projectPath;
    #receipt;
    #snapshot;
    #manifest;
    #variables;
    #unavailable;
    #limitations;
    #access;
    constructor(receipt, snapshot, manifest, unavailable, limitations, access) {
        this.#receipt = receipt;
        this.#snapshot = snapshot;
        this.#manifest = manifest;
        this.#variables = new Map((manifest.variables ?? []).map((variable) => [variable.variableId, variable]));
        this.#unavailable = unavailable;
        this.#limitations = limitations;
        this.#access = access;
        this.projectPath = receipt.source.projectPath;
        this.identity = Object.freeze({ romSha256: manifest.romSha256, projectRevision: manifest.projectRevision,
            sourceFingerprint: receipt.source.sourceFingerprint, compilerSha256: receipt.source.compilerSha256,
            engineAbiVersion: manifest.engineAbiVersion });
    }
    static async create(options) {
        const receipt = authenticatedSourceBuild(options.build);
        if (!receipt)
            fail("SOURCE_DEBUG_UNAVAILABLE", "Source debugging requires a successful official captureDebugArtifacts build retained by this MCP session. A supplied ROM or copied manifest is ROM-only.");
        if (!receipt.abi)
            fail("SOURCE_DEBUG_ABI_UNSUPPORTED", receipt.artifacts.sourceDebugUnavailableReason ?? "The same-build engine layout is unsupported for source debugging.");
        if (options.projectPath && !samePath(await realpath(path.resolve(path.dirname(receipt.source.projectPath), options.projectPath)), receipt.source.projectPath)) {
            fail("SOURCE_DEBUG_PROJECT_MISMATCH", "The captured build belongs to a different selected project.");
        }
        if (options.access) {
            if (!samePath(options.access.projectPath, receipt.source.projectPath))
                fail("SOURCE_DEBUG_PROJECT_MISMATCH", "The selected world index belongs to a different project.");
            await options.access.strongRefresh();
        }
        const snapshot = await loadProjectSnapshot(receipt.source.projectPath, {}, options.access);
        if (snapshot.inventory.scenes.length !== snapshot.scenesById.size || snapshot.counts.variables !== snapshot.variablesById.size) {
            fail("SOURCE_DEBUG_SYMBOLS_UNAVAILABLE", "Authored scenes or global variables have missing or duplicate IDs; source-debug mappings would be ambiguous.");
        }
        const current = await captureBuildSourceProvenance(receipt.source.projectPath, receipt.compilerPath);
        if (snapshot.revision !== receipt.source.projectRevision || !sameBuildSourceProvenance(receipt.source, current)) {
            fail("SOURCE_DEBUG_STALE_SOURCE", "Authored sources or project plugins changed after this build. Rebuild before enabling source-aware debugging.");
        }
        const root = path.dirname(receipt.source.projectPath);
        const [rom, noi, globals] = await Promise.all([
            authenticatedFile(root, receipt.outputPath, receipt.artifacts.romSha256),
            authenticatedFile(root, receipt.artifacts.noiPath, receipt.artifacts.noiSha256),
            authenticatedFile(root, receipt.artifacts.globalsPath, receipt.artifacts.globalsSha256),
        ]);
        const definitions = parseNoiDefinitions(noi.toString("utf8"));
        const globalDefinitions = parseGlobalsDefinitions(globals.toString("utf8"));
        const scenes = [];
        let unavailableScenes = 0;
        for (const scene of snapshot.scenesById.values()) {
            if (typeof scene.symbol !== "string" || !SCENE_SYMBOL.test(scene.symbol)
                || !definitions.has(`_${scene.symbol}`) || !definitions.has(`___bank_${scene.symbol}`)) {
                unavailableScenes++;
                continue;
            }
            scenes.push({ id: scene.id, symbol: scene.symbol });
        }
        if (scenes.length === 0)
            fail("SOURCE_DEBUG_SYMBOLS_UNAVAILABLE", "No exact authored scene symbols occur in this build's linker sidecar.");
        const variables = [];
        const unavailable = [];
        for (const variable of snapshot.variablesById.values()) {
            if (typeof variable.symbol !== "string" || !VARIABLE_SYMBOL.test(variable.symbol)) {
                unavailable.push(variableSummary(variable, "No supported exact authored variable symbol."));
            }
            else if (!globalDefinitions.has(variable.symbol.toUpperCase())) {
                unavailable.push(variableSummary(variable, "Not allocated in this build's globals.i; it may be unused or optimized out."));
            }
            else
                variables.push({ id: variable.id, symbol: variable.symbol });
        }
        const engineAbiVersion = `${receipt.abi.layout}:${receipt.abi.sha256}`;
        const manifest = createDebugManifest({ rom, noi: noi.toString("utf8"), globals: globals.toString("utf8"),
            scenes, variables, projectRevision: receipt.source.projectRevision, engineAbiVersion, globalHeapWords: receipt.globalHeapWords });
        validateDebugManifest(manifest, rom, { projectRevision: receipt.source.projectRevision, engineAbiVersion, globalHeapWords: receipt.globalHeapWords });
        const limitations = ["Authored collision grids and event references describe source, not the currently executing VM instruction or dynamically modified collision state."];
        if (unavailableScenes)
            limitations.push(`${unavailableScenes} authored scene(s) have no exact compiled mapping in this build.`);
        if (!options.access)
            limitations.push("Authored event links require the selected project's existing world index.");
        return new SourceDebugContext(receipt, snapshot, manifest, unavailable, limitations, options.access);
    }
    async #validateSource() {
        let current;
        try {
            current = await captureBuildSourceProvenance(this.projectPath, this.#receipt.compilerPath);
        }
        catch {
            fail("SOURCE_DEBUG_STALE_SOURCE", "The source or compiler identity is no longer readable. Rebuild before using source-aware debugging.");
        }
        if (!sameBuildSourceProvenance(this.#receipt.source, current)) {
            fail("SOURCE_DEBUG_STALE_SOURCE", "Authored sources, project plugins, or the compiler changed after this build. Rebuild before using source-aware debugging.");
        }
    }
    /** Called when source mode is explicitly enabled for a worker-authenticated ROM. */
    async assertCompatibleRom(romSha256) {
        if (typeof romSha256 !== "string" || romSha256 !== this.identity.romSha256) {
            fail("SOURCE_DEBUG_ROM_MISMATCH", "The running emulator does not contain the exact ROM bytes from this source-debug build.");
        }
        await this.#validateSource();
        const root = path.dirname(this.projectPath);
        await Promise.all([
            authenticatedFile(root, this.#receipt.outputPath, this.#receipt.artifacts.romSha256),
            authenticatedFile(root, this.#receipt.artifacts.noiPath, this.#receipt.artifacts.noiSha256),
            authenticatedFile(root, this.#receipt.artifacts.globalsPath, this.#receipt.artifacts.globalsSha256),
        ]);
    }
    #selectedVariables(query) {
        const ids = query.variableIds ?? [];
        const names = query.variableNames ?? [];
        if (!Array.isArray(ids) || !Array.isArray(names) || ids.length + names.length > MAX_SOURCE_DEBUG_VARIABLES
            || [...ids, ...names].some((value) => !validSelector(value))) {
            fail("SOURCE_DEBUG_INVALID_QUERY", `Select at most ${MAX_SOURCE_DEBUG_VARIABLES} variables by bounded ID or exact name.`);
        }
        if (query.variableIds === undefined && query.variableNames === undefined) {
            const available = [...this.#variables.keys()];
            return { ids: available.slice(0, MAX_SOURCE_DEBUG_VARIABLES), truncated: available.length > MAX_SOURCE_DEBUG_VARIABLES };
        }
        const selected = new Set(ids);
        for (const name of names) {
            const matches = [...this.#snapshot.variablesById.values()].filter((variable) => variable.name === name);
            if (matches.length !== 1)
                fail("SOURCE_DEBUG_VARIABLE_UNAVAILABLE", `Variable name ${JSON.stringify(name)} is ${matches.length ? "ambiguous; select its authored ID" : "not present in the captured source"}.`);
            selected.add(matches[0].id);
        }
        for (const id of selected) {
            if (!this.#variables.has(id)) {
                const unavailable = this.#unavailable.find((variable) => variable.id === id);
                fail("SOURCE_DEBUG_VARIABLE_UNAVAILABLE", unavailable ? `${unavailable.name || id}: ${unavailable.reason}` : `No authored global variable with ID ${JSON.stringify(id)} exists in this build.`);
            }
        }
        return { ids: [...selected], truncated: false };
    }
    async inspect(emulator, query = {}) {
        if (!query || typeof query !== "object" || (query.includeScene !== undefined && typeof query.includeScene !== "boolean")) {
            fail("SOURCE_DEBUG_INVALID_QUERY", "Source debugging requires a bounded query.");
        }
        const referenceLimit = query.referenceLimit ?? 16;
        if (!Number.isInteger(referenceLimit) || referenceLimit < 0 || referenceLimit > MAX_SOURCE_DEBUG_REFERENCES) {
            fail("SOURCE_DEBUG_INVALID_QUERY", `referenceLimit must be between 0 and ${MAX_SOURCE_DEBUG_REFERENCES}.`);
        }
        const selected = this.#selectedVariables(query);
        const initial = await emulator.status();
        await this.assertCompatibleRom(initial.romSha256 ?? "");
        if (initial.paused !== true)
            fail("SOURCE_DEBUG_REQUIRES_PAUSE", "Pause the emulator before reading a coherent source-debug snapshot.");
        const readWram = async (address, length) => {
            const result = await emulator.inspect({ view: "memory", region: "wram", offset: address - WRAM_BASE, length });
            if (result.frame !== initial.frame)
                fail("SOURCE_DEBUG_FRAME_CHANGED", "The emulator advanced during source inspection; pause and retry.");
            if (result.view !== "memory" || result.region !== "wram" || result.offset !== address - WRAM_BASE
                || result.length !== length || !new RegExp(`^[a-fA-F0-9]{${length * 2}}$`).test(result.hex)) {
                fail("SOURCE_DEBUG_INVALID_MEMORY", "The emulator did not return the exact bounded WRAM bytes requested by authenticated symbols.");
            }
            return Buffer.from(result.hex, "hex");
        };
        let scene;
        let authoredScene;
        if (query.includeScene !== false || query.collisions) {
            const mapping = decodeCurrentScene(this.#manifest, await readWram(this.#manifest.currentSceneAddress, 3));
            authoredScene = this.#snapshot.scenesById.get(mapping.sceneId);
            scene = sourceScene(authoredScene, mapping.sceneSymbol);
        }
        const mappings = selected.ids.map((id) => this.#variables.get(id)).sort((a, b) => a.address - b.address);
        const spans = [];
        for (const mapping of mappings) {
            let span = spans.at(-1);
            if (!span || mapping.address + 2 - span.start > 256) {
                span = { start: mapping.address, end: mapping.address + 2, variables: [] };
                spans.push(span);
            }
            span.end = mapping.address + 2;
            span.variables.push(mapping);
        }
        const values = new Map();
        for (const span of spans) {
            const bytes = await readWram(span.start, span.end - span.start);
            for (const mapping of span.variables) {
                const resource = this.#snapshot.variablesById.get(mapping.variableId);
                const offset = mapping.address - span.start;
                values.set(resource.id, { id: resource.id, variableId: resource.id, name: resource.name,
                    symbol: mapping.variableSymbol, value: bytes.readInt16LE(offset), unsignedValue: bytes.readUInt16LE(offset),
                    resourcePath: resource.resourcePath });
            }
        }
        const references = [];
        let referencesTruncated = false;
        if (this.#access && referenceLimit > 0) {
            await this.#access.strongRefresh();
            if (this.#access.revision !== this.identity.projectRevision)
                fail("SOURCE_DEBUG_STALE_SOURCE", "The selected project changed during source inspection.");
            const seen = new Set();
            const nodes = [...selected.ids.map((id) => ({ type: "variable", id })), ...(scene ? [{ type: "scene", id: scene.id }] : [])];
            for (const node of nodes) {
                if (references.length >= referenceLimit) {
                    referencesTruncated = true;
                    break;
                }
                const related = await worldDependencies(this.#access, { node, direction: "both", depth: 1, limit: referenceLimit });
                for (const reference of related.references) {
                    const key = JSON.stringify(reference);
                    if (seen.has(key))
                        continue;
                    seen.add(key);
                    if (references.length >= referenceLimit) {
                        referencesTruncated = true;
                        break;
                    }
                    references.push(reference);
                }
                if (related.nextCursor)
                    referencesTruncated = true;
            }
        }
        const collisions = query.collisions && authoredScene ? collisionRegion(authoredScene, query.collisions) : undefined;
        await this.#validateSource();
        const final = await emulator.status();
        if (final.romSha256 !== this.identity.romSha256)
            fail("SOURCE_DEBUG_ROM_MISMATCH", "The emulator ROM changed during source inspection.");
        if (final.paused !== true || final.frame !== initial.frame)
            fail("SOURCE_DEBUG_FRAME_CHANGED", "The emulator advanced during source inspection; pause and retry.");
        const result = { mode: "source", identity: this.identity, frame: initial.frame,
            ...(scene && query.includeScene !== false ? { scene } : {}), variables: selected.ids.map((id) => values.get(id)),
            variablesTruncated: selected.truncated, unavailableVariables: this.#unavailable.slice(0, MAX_SOURCE_DEBUG_VARIABLES),
            unavailableVariableCount: this.#unavailable.length, ...(collisions ? { collisions } : {}), references, referencesTruncated,
            limitations: [...this.#limitations] };
        while (Buffer.byteLength(JSON.stringify(result)) > PROJECT_RESPONSE_LIMITS.semanticQueryBytes && result.references.length > 0) {
            result.references.pop();
            result.referencesTruncated = true;
        }
        while (Buffer.byteLength(JSON.stringify(result)) > PROJECT_RESPONSE_LIMITS.semanticQueryBytes && result.unavailableVariables.length > 0) {
            result.unavailableVariables.pop();
        }
        if (Buffer.byteLength(JSON.stringify(result)) > PROJECT_RESPONSE_LIMITS.semanticQueryBytes) {
            fail("SOURCE_DEBUG_RESPONSE_TOO_LARGE", "Source diagnostics exceed the bounded response size; request fewer variables or a smaller collision window.");
        }
        return result;
    }
}
export async function createSourceDebugContext(options) {
    return SourceDebugContext.create(options);
}
//# sourceMappingURL=source-debug.js.map