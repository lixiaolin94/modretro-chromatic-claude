import { createHash } from "node:crypto";
import { WRECKLIGHT_CONTRACTS } from "./wrecklight-dependencies.js";
import { compilerDependenciesValid, compilerProfileValid } from "./reviewed-compiler.js";
/** The reviewed loader reads core handlers first, then this project glob, keyed
 * by the exported ID. We refuse duplicates instead of guessing glob order.
 * Inspection never evaluates project JavaScript or calls the compiler. */
export const CUSTOM_EVENT_RESOLUTION_PROFILE = "gb-studio-4.3.2/project-event-exports/v1";
const EVENT_FILE = /^plugins\/[^/]+\/(?:[^/]+\/)*events\/event[^/]*\.js$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_CONTRACTS = 714;
const MAX_BINDINGS = 256;
const MAX_EFFECTS = 4096;
const compilerResourcePath = (name) => /^(?:project|assets|plugins)\/.+\.gbsres$/.test(name);
function digest(value) {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function freeze(value) {
    if (typeof value !== "object" || value === null || Object.isFrozen(value))
        return value;
    for (const child of Object.values(value))
        freeze(child);
    return Object.freeze(value);
}
function bindingValid(binding) {
    return (/^(?:plugins|project|assets)\//.test(binding.path) || /^[^/]+\.gbsproj$/.test(binding.path))
        && binding.path.split("/").every((part) => part !== "" && part !== "." && part !== "..")
        && !/[\\\0]/.test(binding.path)
        && Number.isSafeInteger(binding.bytes) && binding.bytes >= 0 && SHA256.test(binding.sha256);
}
function matches(binding, file) {
    return file?.sha256 === binding.sha256 && file.identity?.size === BigInt(binding.bytes);
}
/** Instances are immutable trusted source configuration. Creating a new one
 * changes the graph fingerprint, including its reviewed extractor code. */
export class ReviewedEventRegistry {
    contracts;
    fingerprint;
    constructor(contracts) {
        if (contracts.length > MAX_CONTRACTS)
            throw new Error("Too many reviewed event contracts");
        this.contracts = Object.freeze(contracts.map((contract) => {
            if (!contract.id || !Number.isSafeInteger(contract.version) || contract.version < 1
                || contract.resolutionProfile !== CUSTOM_EVENT_RESOLUTION_PROFILE || !contract.command
                || !bindingValid(contract.handler) || !EVENT_FILE.test(contract.handler.path)
                || contract.dependencies.length > MAX_BINDINGS || !contract.dependencies.every(bindingValid)
                || new Set(contract.dependencies.map((binding) => binding.path)).size !== contract.dependencies.length
                || (contract.compilerProfile !== undefined && !compilerProfileValid(contract.compilerProfile))
                || (contract.compilerDependencies !== undefined && (!contract.compilerProfile || !compilerDependenciesValid(contract.compilerDependencies)))
                || (contract.closedDependencyPrefixes !== undefined && (contract.closedDependencyPrefixes.length > MAX_BINDINGS
                    || contract.closedDependencyPrefixes.some((prefix) => !/^(?:plugins|project|assets)\//.test(prefix)
                        || !prefix.endsWith("/") || prefix.slice(0, -1).split("/").some((part) => !part || part === "." || part === "..")
                        || /[\\\0]/.test(prefix))))
                || (contract.closedResourceTypes !== undefined && (contract.closedResourceTypes.length > MAX_BINDINGS
                    || contract.closedResourceTypes.some((type) => !/^[a-zA-Z][a-zA-Z0-9]*$/.test(type))))
                || contract.fields.length > MAX_BINDINGS
                || contract.fields.some((field) => !field.key || !field.type)
                || new Set(contract.fields.map((field) => field.key)).size !== contract.fields.length
                || typeof contract.extract !== "function")
                throw new Error("Invalid reviewed event contract");
            const { extract, ...metadata } = contract;
            return freeze({ ...structuredClone(metadata), extract });
        }));
        this.fingerprint = digest(this.contracts.map(({ extract, ...metadata }) => ({
            ...metadata, extractorSource: Function.prototype.toString.call(extract),
        })));
        Object.freeze(this);
    }
    activeCompilerProfiles(files) {
        const profiles = this.contracts.filter((contract) => files.has(contract.handler.path) && contract.compilerProfile)
            .map((contract) => contract.compilerProfile);
        return profiles.filter((profile, index) => profiles.findIndex((other) => JSON.stringify(other) === JSON.stringify(profile)) === index);
    }
    activeCompilerDependencies(files) {
        const rows = this.contracts.filter((contract) => matches(contract.handler, files.get(contract.handler.path))
            && contract.dependencies.every((binding) => matches(binding, files.get(binding.path)))
            && this.projectClosureReason(contract, files) === undefined).flatMap((contract) => contract.compilerDependencies ?? []);
        return rows.filter((row, index) => rows.findIndex((other) => other.path === row.path
            && other.bytes === row.bytes && other.sha256 === row.sha256) === index);
    }
    projectClosureReason(candidate, files) {
        const bound = new Set([candidate.handler.path, ...candidate.dependencies.map((binding) => binding.path)]);
        if ([...files.keys()].some((name) => candidate.closedDependencyPrefixes?.some((prefix) => name.startsWith(prefix)) && !bound.has(name))) {
            return "An extra input changes the reviewed engine or helper selection";
        }
        if ([...files].some(([name, file]) => compilerResourcePath(name)
            && candidate.closedResourceTypes?.includes(String(file.json?._resourceType)) && !bound.has(name))) {
            return "An extra resource changes the reviewed settings or engine definitions";
        }
        return undefined;
    }
    hasProjectHandlers(files) {
        return [...files.keys()].some((name) => EVENT_FILE.test(name));
    }
    needsDependencyRefresh(files, changed) {
        // An unrelated unreviewed export is already incomplete; opaque resources
        // cannot make it reviewed. Present maintained handlers do require fresh
        // dependency/layout checks, even when the changed file is opaque.
        return this.contracts.some((contract) => files.has(contract.handler.path))
            || changed.some((name) => EVENT_FILE.test(name));
    }
    resolve(files, compiler) {
        const candidates = [...files ?? []].filter(([name]) => EVENT_FILE.test(name)).sort(([a], [b]) => a.localeCompare(b));
        if (candidates.length === 0) {
            return { fingerprint: this.fingerprint, byCommand: new Map(this.contracts.map((contract) => [contract.command, { reason: files ? "The reviewed handler is missing" : "A complete indexed plugin source snapshot is required" }])), unreviewedExports: [] };
        }
        const paths = new Set(candidates.map(([name]) => name));
        for (const contract of this.contracts) {
            paths.add(contract.handler.path);
            for (const binding of contract.dependencies)
                paths.add(binding.path);
            for (const name of files?.keys() ?? []) {
                if (contract.closedDependencyPrefixes?.some((prefix) => name.startsWith(prefix))
                    || (compilerResourcePath(name) && contract.closedResourceTypes?.includes(String(files?.get(name)?.json?._resourceType))))
                    paths.add(name);
            }
        }
        const fingerprint = digest([this.fingerprint, compiler, files === undefined ? "unobserved" : "snapshot",
            [...paths].sort().map((name) => [name, files?.get(name)?.sha256, files?.get(name)?.identity?.size.toString()])]);
        const byCommand = new Map();
        // An unreviewed export can shadow ANY other command. Do not infer its ID
        // with a regex or execute it to make a reviewed binding appear unique.
        const unknownExports = candidates.filter(([name, file]) => !this.contracts.some((contract) => contract.handler.path === name && matches(contract.handler, file)
            && contract.dependencies.every((binding) => matches(binding, files?.get(binding.path)))));
        const candidateReason = (candidate) => {
            if (candidate.dependencies.some((binding) => !matches(binding, files?.get(binding.path)))) {
                return "A required reviewed helper or definition is missing or changed";
            }
            // Closure controls which supplemental compiler inputs are observed.
            // Report its failure first instead of blaming intentionally omitted pins.
            const closureReason = this.projectClosureReason(candidate, files);
            if (closureReason)
                return closureReason;
            if (candidate.compilerProfile && compiler?.profileId !== candidate.compilerProfile.id) {
                return compiler?.reason ?? "The ordinary compiler inputs have not matched the reviewed profile";
            }
            if (candidate.compilerDependencies?.some((binding) => !compiler?.dependencies?.some((observed) => observed.path === binding.path && observed.bytes === binding.bytes && observed.sha256 === binding.sha256))) {
                return "A supplemental reviewed compiler implementation is missing or changed";
            }
            return undefined;
        };
        for (const command of new Set(this.contracts.map((contract) => contract.command))) {
            const present = this.contracts.filter((candidate) => candidate.command === command
                && matches(candidate.handler, files?.get(candidate.handler.path)));
            let reason;
            if (!files)
                reason = "A complete indexed plugin source snapshot is required";
            else if (unknownExports.length)
                reason = "An unreviewed or changed plugin export makes handler resolution uncertain";
            else if (!present.length)
                reason = "The reviewed handler is missing or changed";
            // Alternative reviews may share ONE exact physical handler. A second
            // actual export or conflicting command claim remains ambiguous, even if
            // its helper/compiler requirements would subsequently fail.
            else if (new Set(present.map((candidate) => candidate.handler.path)).size !== 1) {
                reason = "Multiple reviewed files export this command";
            }
            else if (this.contracts.some((candidate) => candidate.command !== command
                && candidate.handler.path === present[0].handler.path && matches(candidate.handler, files.get(candidate.handler.path)))) {
                reason = "Multiple contracts claim the selected handler";
            }
            const evaluated = reason !== undefined ? [] : present.map((contract) => ({ contract, reason: candidateReason(contract) }));
            const complete = evaluated.filter((candidate) => candidate.reason === undefined);
            if (reason === undefined && complete.length !== 1) {
                reason = complete.length ? "Multiple complete reviews match the selected handler"
                    : [...new Set(evaluated.map((candidate) => candidate.reason))].join("; ");
            }
            byCommand.set(command, reason !== undefined ? { reason } : { contract: complete[0].contract });
        }
        return { fingerprint, byCommand, unreviewedExports: unknownExports.map(([name]) => name) };
    }
}
export function extractReviewedEvent(contract, args, children, context) {
    const incomplete = (reason) => ({ status: "incomplete", reason });
    if (children !== undefined && (typeof children !== "object" || children === null || Array.isArray(children))) {
        return incomplete("Malformed child branches");
    }
    const fields = new Map(contract.fields.map((field) => [field.key, field]));
    const input = { ...args, ...children };
    if (Object.keys(input).some((key) => key !== "__comment" && !fields.has(key))) {
        return incomplete("An input field is outside the reviewed handler contract");
    }
    try {
        // Do not apply editor defaults, execute project functions, or hand mutable
        // indexed resources to a reviewed extractor.
        const result = contract.extract(freeze(structuredClone(input)), freeze(structuredClone(context)));
        if (result?.status !== "complete")
            return incomplete(result?.status === "incomplete" ? result.reason : "No complete effect result was returned");
        if (!Array.isArray(result.effects) || result.effects.length > MAX_EFFECTS
            || !Array.isArray(result.childBranches) || result.childBranches.length > MAX_BINDINGS
            || new Set(result.childBranches).size !== result.childBranches.length)
            return incomplete("Malformed or unbounded effect result");
        for (const branch of result.childBranches) {
            if (fields.get(branch)?.type !== "events" || (input[branch] !== undefined && !Array.isArray(input[branch]))) {
                return incomplete("An executed branch is not a reviewed events field");
            }
        }
        for (const effect of result.effects) {
            if (!effect || typeof effect.id !== "string" || !effect.id || effect.id.length > 256)
                return incomplete("An effect has no bounded resolved target");
            if (effect.kind === "variable") {
                if (!["read", "write", "read-write"].includes(effect.access))
                    return incomplete("A variable effect is incomplete");
            }
            else if (effect.kind === "resource") {
                if (!["variable", "scene", "actor", "trigger", "asset", "palette", "script", "actorPrefab", "triggerPrefab", "settings"].includes(effect.type)
                    || typeof effect.relation !== "string" || !effect.relation || effect.relation.length > 128
                    || (effect.sceneId !== undefined && (typeof effect.sceneId !== "string" || effect.sceneId.length > 256)))
                    return incomplete("A resource effect is incomplete");
                if (effect.ownerId !== undefined && (effect.type !== "variable" || !/^L[0-5]$/.test(effect.id)
                    || typeof effect.ownerId !== "string" || !effect.ownerId || effect.ownerId.length > 256
                    || typeof effect.sceneId !== "string" || !effect.sceneId))
                    return incomplete("A structural local needs its explicit actor and scene");
            }
            else
                return incomplete("An effect kind is unsupported");
        }
        return result;
    }
    catch {
        return incomplete("The reviewed extractor could not establish the event's effects");
    }
}
// Only reviewed maintained-source entries belong here. Project names, manifests
// and `complete` flags cannot create authority or replace a current byte match.
export const REVIEWED_CUSTOM_EVENTS = new ReviewedEventRegistry(WRECKLIGHT_CONTRACTS);
//# sourceMappingURL=custom-event-dependencies.js.map