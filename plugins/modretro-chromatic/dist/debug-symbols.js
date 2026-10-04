import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
const WRAM_START = 0xc000;
const WRAM_END = 0xdfff;
const SCENE_POINTER_BYTES = 3;
const GLOBAL_VARIABLE_BYTES = 2;
const MAXIMUM_ROM_BANK = 0xff;
const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SHA256 = /^[a-f0-9]{64}$/;
export class DebugSymbolsError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "DebugSymbolsError";
        this.code = code;
    }
}
function invalid(message) {
    throw new DebugSymbolsError("INVALID_DEBUG_MANIFEST", message);
}
function parseUnsignedInteger(value, description) {
    if (!/^(?:0[xX][0-9a-fA-F]+|[0-9]+)$/.test(value)) {
        throw new DebugSymbolsError("MALFORMED_DEBUG_SYMBOLS", `${description} has an invalid unsigned integer: ${value}`);
    }
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
        throw new DebugSymbolsError("MALFORMED_DEBUG_SYMBOLS", `${description} exceeds the safe integer range`);
    }
    return parsed;
}
function addDefinition(definitions, name, value, source) {
    if (definitions.has(name)) {
        throw new DebugSymbolsError("AMBIGUOUS_DEBUG_SYMBOL", `${source} defines ${name} more than once`);
    }
    definitions.set(name, value);
}
/** Parse the full linker .noi file; truncated .sym/.map labels are never consulted. */
export function parseNoiDefinitions(source) {
    if (typeof source !== "string") {
        throw new DebugSymbolsError("MALFORMED_DEBUG_SYMBOLS", "Linker .noi contents must be a string");
    }
    const definitions = new Map();
    let loadRecords = 0;
    for (const [index, raw] of source.split(/\r?\n/).entries()) {
        const line = raw.trim();
        if (!line || line.startsWith(";") || line.startsWith("#"))
            continue;
        const match = /^DEF\s+([A-Za-z_.$][A-Za-z0-9_.$]*)\s+(0[xX][0-9a-fA-F]+|[0-9]+)$/.exec(line);
        if (match) {
            addDefinition(definitions, match[1], parseUnsignedInteger(match[2], `.noi line ${index + 1}`), "Linker .noi");
            continue;
        }
        if (/^LOAD\s+\S+$/.test(line)) {
            if (++loadRecords > 1) {
                throw new DebugSymbolsError("MALFORMED_DEBUG_SYMBOLS", "Linker .noi contains multiple LOAD records");
            }
            continue;
        }
        throw new DebugSymbolsError("MALFORMED_DEBUG_SYMBOLS", `Malformed linker .noi record at line ${index + 1}`);
    }
    if (definitions.size === 0) {
        throw new DebugSymbolsError("DEBUG_SYMBOLS_UNAVAILABLE", "Linker .noi contains no symbol definitions");
    }
    return definitions;
}
/** Parse compiler-generated globals.i assignments without case folding or prefix matching. */
export function parseGlobalsDefinitions(source) {
    if (typeof source !== "string") {
        throw new DebugSymbolsError("MALFORMED_DEBUG_SYMBOLS", "Compiler globals.i contents must be a string");
    }
    const definitions = new Map();
    for (const [index, raw] of source.split(/\r?\n/).entries()) {
        const line = raw.trim();
        if (!line || line.startsWith(";") || line.startsWith("#"))
            continue;
        const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(0[xX][0-9a-fA-F]+|[0-9]+)$/.exec(line);
        if (!match) {
            throw new DebugSymbolsError("MALFORMED_DEBUG_SYMBOLS", `Malformed globals.i assignment at line ${index + 1}`);
        }
        addDefinition(definitions, match[1], parseUnsignedInteger(match[2], `globals.i line ${index + 1}`), "Compiler globals.i");
    }
    if (definitions.size === 0) {
        throw new DebugSymbolsError("DEBUG_SYMBOLS_UNAVAILABLE", "Compiler globals.i contains no assignments");
    }
    return definitions;
}
function requireDefinition(definitions, name) {
    const value = definitions.get(name);
    if (value === undefined) {
        throw new DebugSymbolsError("DEBUG_SYMBOLS_UNAVAILABLE", `Exact debug symbol ${name} is unavailable`);
    }
    return value;
}
function assertWramSpan(address, bytes, description) {
    if (!Number.isSafeInteger(address) || address < WRAM_START || address + bytes - 1 > WRAM_END) {
        throw new DebugSymbolsError("INVALID_DEBUG_ADDRESS", `${description} must fit completely inside WRAM 0xC000–0xDFFF`);
    }
}
function validateBankAndAddress(bank, address, description) {
    if (!Number.isInteger(bank) || bank < 0 || bank > MAXIMUM_ROM_BANK) {
        throw new DebugSymbolsError("INVALID_DEBUG_ADDRESS", `${description} has an invalid one-byte ROM bank`);
    }
    if (!Number.isInteger(address) || address < 0 || address > 0x7fff) {
        throw new DebugSymbolsError("INVALID_DEBUG_ADDRESS", `${description} is outside cartridge ROM address space`);
    }
    if ((bank === 0 && address >= 0x4000) || (bank !== 0 && address < 0x4000)) {
        throw new DebugSymbolsError("INVALID_DEBUG_ADDRESS", `${description} is inconsistent with its ROM bank`);
    }
}
function requireIdentifier(value, prefix, description) {
    if (typeof value !== "string" || !value.startsWith(prefix) || !IDENTIFIER.test(value) || value.length === prefix.length) {
        invalid(`${description} must be a complete ${prefix}<identifier> symbol`);
    }
}
function requireNonemptyString(value, description) {
    if (typeof value !== "string" || value.trim().length === 0)
        invalid(`${description} must be a nonempty string`);
}
export function hashDebugRom(rom) {
    if (!(rom instanceof Uint8Array) || rom.byteLength === 0) {
        invalid("A nonempty ROM byte array is required to bind debug symbols");
    }
    return createHash("sha256").update(rom).digest("hex");
}
function mapScene(definitions, scene) {
    requireNonemptyString(scene.id, "Authored scene ID");
    requireIdentifier(scene.symbol, "scene_", "Authored scene");
    const bank = requireDefinition(definitions, `___bank_${scene.symbol}`);
    const encoded = requireDefinition(definitions, `_${scene.symbol}`);
    const encodedBank = Math.floor(encoded / 0x10000);
    const address = encoded % 0x10000;
    validateBankAndAddress(bank, address, `Scene ${scene.symbol}`);
    if (encodedBank !== bank) {
        throw new DebugSymbolsError("INVALID_DEBUG_ADDRESS", `Scene ${scene.symbol} linker address encodes a different ROM bank`);
    }
    return { sceneId: scene.id, sceneSymbol: scene.symbol, bank, address };
}
function mapVariables(definitions, globalsSource, variables, globalHeapWords) {
    const globals = parseGlobalsDefinitions(globalsSource);
    const maxGlobalVars = requireDefinition(globals, "MAX_GLOBAL_VARS");
    if (!Number.isSafeInteger(globalHeapWords) || globalHeapWords < 1 || globalHeapWords > (WRAM_END - WRAM_START + 1) / GLOBAL_VARIABLE_BYTES
        || !Number.isSafeInteger(maxGlobalVars) || maxGlobalVars < 1 || maxGlobalVars > globalHeapWords) {
        throw new DebugSymbolsError("INVALID_DEBUG_ADDRESS", "MAX_GLOBAL_VARS must fit the authenticated same-build global heap");
    }
    const scriptMemoryAddress = requireDefinition(definitions, "_script_memory");
    assertWramSpan(scriptMemoryAddress, GLOBAL_VARIABLE_BYTES * maxGlobalVars, "Complete global allocation");
    const mapped = [];
    const ids = new Set();
    const symbols = new Set();
    const slots = new Set();
    for (const variable of variables) {
        requireNonemptyString(variable.id, "Authored variable ID");
        requireIdentifier(variable.symbol, "var_", "Authored variable");
        if (ids.has(variable.id) || symbols.has(variable.symbol)) {
            throw new DebugSymbolsError("AMBIGUOUS_DEBUG_SYMBOL", `Authored variable ${variable.symbol} is duplicated`);
        }
        const index = requireDefinition(globals, variable.symbol.toUpperCase());
        if (index >= maxGlobalVars) {
            throw new DebugSymbolsError("INVALID_DEBUG_ADDRESS", `Variable ${variable.symbol} index exceeds MAX_GLOBAL_VARS`);
        }
        if (slots.has(index)) {
            throw new DebugSymbolsError("AMBIGUOUS_DEBUG_SYMBOL", `Multiple authored variables occupy global slot ${index}`);
        }
        const address = scriptMemoryAddress + GLOBAL_VARIABLE_BYTES * index;
        assertWramSpan(address, GLOBAL_VARIABLE_BYTES, `Variable ${variable.symbol}`);
        ids.add(variable.id);
        symbols.add(variable.symbol);
        slots.add(index);
        mapped.push({ variableId: variable.id, variableSymbol: variable.symbol, index, address });
    }
    return { scriptMemoryAddress, maxGlobalVars, variables: mapped };
}
/** Build authenticated exact scene mappings from the ROM and artifacts of a single build. */
export function createDebugManifest(input) {
    requireNonemptyString(input.projectRevision, "Project revision");
    requireNonemptyString(input.engineAbiVersion, "Engine ABI version");
    if (!Array.isArray(input.scenes) || input.scenes.length === 0) {
        invalid("At least one exact authored scene mapping is required");
    }
    if (input.variables !== undefined && !Array.isArray(input.variables)) {
        invalid("Authored variable mappings must be an array");
    }
    if (input.variables?.length && input.globals === undefined) {
        throw new DebugSymbolsError("DEBUG_SYMBOLS_UNAVAILABLE", "Mapping authored variables requires same-build globals.i");
    }
    const definitions = parseNoiDefinitions(input.noi);
    const currentSceneAddress = requireDefinition(definitions, "_current_scene");
    assertWramSpan(currentSceneAddress, SCENE_POINTER_BYTES, "Current scene pointer");
    const scenes = [];
    const ids = new Set();
    const symbols = new Set();
    const locations = new Set();
    for (const authoredScene of input.scenes) {
        const scene = mapScene(definitions, authoredScene);
        const location = `${scene.bank}:${scene.address}`;
        if (ids.has(scene.sceneId) || symbols.has(scene.sceneSymbol) || locations.has(location)) {
            throw new DebugSymbolsError("AMBIGUOUS_DEBUG_SYMBOL", `Scene ${scene.sceneSymbol} has a duplicated ID, symbol, or ROM address`);
        }
        ids.add(scene.sceneId);
        symbols.add(scene.sceneSymbol);
        locations.add(location);
        scenes.push(scene);
    }
    return {
        formatVersion: 1,
        romSha256: hashDebugRom(input.rom),
        projectRevision: input.projectRevision,
        engineAbiVersion: input.engineAbiVersion,
        currentSceneAddress,
        scenes,
        ...(input.variables?.length ? mapVariables(definitions, input.globals, input.variables, input.globalHeapWords) : {}),
    };
}
/** Read captured artifacts directly; the caller must have established same-build provenance. */
export async function createDebugManifestFromFiles(input) {
    const [rom, noi, globals] = await Promise.all([
        readFile(input.romPath),
        readFile(input.noiPath, "utf8"),
        input.globalsPath ? readFile(input.globalsPath, "utf8") : Promise.resolve(undefined),
    ]);
    return createDebugManifest({
        rom,
        noi,
        scenes: input.scenes,
        projectRevision: input.projectRevision,
        engineAbiVersion: input.engineAbiVersion,
        globalHeapWords: input.globalHeapWords,
        ...(globals === undefined ? {} : { globals }),
        ...(input.variables === undefined ? {} : { variables: input.variables }),
    });
}
function object(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Reject stale, malformed, ambiguous, or different-cartridge manifests before any memory read. */
export function validateDebugManifest(manifest, rom, expected = {}) {
    if (!object(manifest) || manifest.formatVersion !== 1)
        invalid("Debug manifest formatVersion must equal 1");
    if (typeof manifest.romSha256 !== "string" || !SHA256.test(manifest.romSha256)) {
        invalid("Debug manifest requires a lowercase SHA-256 ROM digest");
    }
    const actualDigest = hashDebugRom(rom);
    if (!timingSafeEqual(Buffer.from(manifest.romSha256, "hex"), Buffer.from(actualDigest, "hex"))) {
        throw new DebugSymbolsError("DEBUG_ROM_MISMATCH", "Debug manifest does not belong to the active ROM");
    }
    requireNonemptyString(manifest.projectRevision, "Debug manifest project revision");
    requireNonemptyString(manifest.engineAbiVersion, "Debug manifest engine ABI version");
    if (expected.projectRevision !== undefined && manifest.projectRevision !== expected.projectRevision) {
        invalid("Debug manifest project revision is stale");
    }
    if (expected.engineAbiVersion !== undefined && manifest.engineAbiVersion !== expected.engineAbiVersion) {
        invalid("Debug manifest engine ABI version is incompatible");
    }
    if (typeof manifest.currentSceneAddress !== "number")
        invalid("Debug manifest requires a current-scene WRAM address");
    assertWramSpan(manifest.currentSceneAddress, SCENE_POINTER_BYTES, "Current scene pointer");
    if (!Array.isArray(manifest.scenes) || manifest.scenes.length === 0)
        invalid("Debug manifest requires authored scenes");
    const ids = new Set();
    const symbols = new Set();
    const locations = new Set();
    for (const scene of manifest.scenes) {
        if (!object(scene))
            invalid("Debug manifest scene mappings must be objects");
        requireNonemptyString(scene.sceneId, "Debug manifest scene ID");
        requireIdentifier(scene.sceneSymbol, "scene_", "Debug manifest scene");
        if (typeof scene.bank !== "number" || typeof scene.address !== "number")
            invalid("Debug manifest scene requires a bank and address");
        validateBankAndAddress(scene.bank, scene.address, `Scene ${scene.sceneSymbol}`);
        const location = `${scene.bank}:${scene.address}`;
        if (ids.has(scene.sceneId) || symbols.has(scene.sceneSymbol) || locations.has(location)) {
            throw new DebugSymbolsError("AMBIGUOUS_DEBUG_SYMBOL", "Debug manifest contains ambiguous scene mappings");
        }
        ids.add(scene.sceneId);
        symbols.add(scene.sceneSymbol);
        locations.add(location);
    }
    if (manifest.variables !== undefined || manifest.scriptMemoryAddress !== undefined || manifest.maxGlobalVars !== undefined) {
        if (!Array.isArray(manifest.variables) || manifest.variables.length === 0)
            invalid("Debug manifest variables must be a nonempty array");
        if (typeof manifest.scriptMemoryAddress !== "number")
            invalid("Debug manifest variables require a script-memory WRAM base");
        if (typeof manifest.maxGlobalVars !== "number" || !Number.isInteger(manifest.maxGlobalVars) ||
            !Number.isSafeInteger(expected.globalHeapWords) || expected.globalHeapWords < 1
            || expected.globalHeapWords > (WRAM_END - WRAM_START + 1) / GLOBAL_VARIABLE_BYTES
            || manifest.maxGlobalVars < 1 || manifest.maxGlobalVars > expected.globalHeapWords) {
            invalid("Debug manifest MAX_GLOBAL_VARS must fit the authenticated same-build global heap");
        }
        assertWramSpan(manifest.scriptMemoryAddress, GLOBAL_VARIABLE_BYTES * manifest.maxGlobalVars, "Complete global allocation");
        const variableIds = new Set();
        const variableSymbols = new Set();
        const indexes = new Set();
        for (const variable of manifest.variables) {
            if (!object(variable))
                invalid("Debug manifest variable mappings must be objects");
            requireNonemptyString(variable.variableId, "Debug manifest variable ID");
            requireIdentifier(variable.variableSymbol, "var_", "Debug manifest variable");
            if (typeof variable.index !== "number" || !Number.isInteger(variable.index) ||
                variable.index < 0 || variable.index >= manifest.maxGlobalVars) {
                invalid(`Debug manifest variable ${variable.variableSymbol} has an invalid global index`);
            }
            const expectedAddress = manifest.scriptMemoryAddress + GLOBAL_VARIABLE_BYTES * variable.index;
            if (variable.address !== expectedAddress)
                invalid(`Debug manifest variable ${variable.variableSymbol} has an inconsistent address`);
            assertWramSpan(expectedAddress, GLOBAL_VARIABLE_BYTES, `Variable ${variable.variableSymbol}`);
            if (variableIds.has(variable.variableId) || variableSymbols.has(variable.variableSymbol) || indexes.has(variable.index)) {
                throw new DebugSymbolsError("AMBIGUOUS_DEBUG_SYMBOL", "Debug manifest contains ambiguous variable mappings");
            }
            variableIds.add(variable.variableId);
            variableSymbols.add(variable.variableSymbol);
            indexes.add(variable.index);
        }
    }
    return manifest;
}
/** Decode the engine's exact three-byte bank + little-endian scene pointer. */
export function decodeCurrentScene(manifest, bytes) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength !== SCENE_POINTER_BYTES) {
        throw new DebugSymbolsError("INVALID_DEBUG_ADDRESS", "Current scene observation must contain exactly three WRAM bytes");
    }
    assertWramSpan(manifest.currentSceneAddress, SCENE_POINTER_BYTES, "Current scene pointer");
    const bank = bytes[0];
    const address = bytes[1] | (bytes[2] << 8);
    validateBankAndAddress(bank, address, "Current scene pointer");
    const matches = manifest.scenes.filter((scene) => scene.bank === bank && scene.address === address);
    if (matches.length === 0) {
        throw new DebugSymbolsError("UNKNOWN_CURRENT_SCENE", `No authenticated scene matches ROM bank ${bank} address 0x${address.toString(16)}`);
    }
    if (matches.length !== 1) {
        throw new DebugSymbolsError("AMBIGUOUS_DEBUG_SYMBOL", "Current scene pointer matches multiple authored scenes");
    }
    return matches[0];
}
//# sourceMappingURL=debug-symbols.js.map