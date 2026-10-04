import path from "node:path";
import { GameStudioProjectError, inventoryProject, } from "./project.js";
import { readProjectJsonWithRevision, resourceRevision, stableResourceId, withProjectResourceWriteLock, writeProjectJsonAtomic, } from "./project-files.js";
import { findInvalidNativeScriptEvent } from "./native-script-events.js";
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const VALID_DIRECTIONS = new Set(["up", "down", "left", "right"]);
const MAXIMUM_EVENT_DEPTH = 64;
const MAXIMUM_EVENT_COUNT = 10_000;
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertSafeJson(value, label, depth = 0) {
    if (depth > MAXIMUM_EVENT_DEPTH) {
        throw new GameStudioProjectError("INVALID_INPUT", `${label} exceeds the maximum nesting depth`);
    }
    if (Array.isArray(value)) {
        for (const child of value)
            assertSafeJson(child, label, depth + 1);
        return;
    }
    if (!isObject(value))
        return;
    for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key)) {
            throw new GameStudioProjectError("INVALID_PROPERTY", `${label} cannot contain reserved property ${key}`);
        }
        assertSafeJson(child, label, depth + 1);
    }
}
function mergeJson(existing, updates) {
    const result = { ...existing };
    for (const [key, value] of Object.entries(updates)) {
        const original = result[key];
        result[key] = isObject(original) && isObject(value) ? mergeJson(original, value) : structuredClone(value);
    }
    return result;
}
function resolveScriptKey(target) {
    const key = target.scriptKey ?? "script";
    if (!/^(?:script|[A-Za-z][A-Za-z0-9]*Script)$/.test(key) || FORBIDDEN_KEYS.has(key)) {
        throw new GameStudioProjectError("INVALID_INPUT", `Unsupported script property ${key}`);
    }
    return key;
}
function scriptEvents(resource, target) {
    const scriptKey = resolveScriptKey(target);
    const root = resource[scriptKey];
    if (!Array.isArray(root)) {
        throw new GameStudioProjectError("SCRIPT_NOT_FOUND", `Resource ${String(resource.id ?? "unknown")} has no ${scriptKey} script`);
    }
    let current = root;
    for (const segment of target.branchPath ?? []) {
        if (!isObject(segment) || typeof segment.eventId !== "string" || typeof segment.branch !== "string" || !segment.branch) {
            throw new GameStudioProjectError("INVALID_INPUT", "Every script branch requires a nonempty eventId and branch");
        }
        if (FORBIDDEN_KEYS.has(segment.branch)) {
            throw new GameStudioProjectError("INVALID_PROPERTY", `Script branch ${segment.branch} is reserved`);
        }
        const parent = current.find((event) => isObject(event) && event.id === segment.eventId);
        if (!isObject(parent)) {
            throw new GameStudioProjectError("EVENT_NOT_FOUND", `No parent event with id ${segment.eventId} exists in the selected branch`);
        }
        const branch = isObject(parent.children) ? parent.children[segment.branch] : undefined;
        if (!Array.isArray(branch)) {
            throw new GameStudioProjectError("SCRIPT_BRANCH_NOT_FOUND", `Event ${segment.eventId} has no ${segment.branch} branch`);
        }
        current = branch;
    }
    if (!current.every(isObject)) {
        throw new GameStudioProjectError("INVALID_RESOURCE", `Resource ${String(resource.id ?? "unknown")} contains a malformed script event`);
    }
    return current;
}
function validateEventTree(resource, options) {
    const eventIds = new Set();
    let count = 0;
    function inspect(events, depth) {
        if (depth > MAXIMUM_EVENT_DEPTH) {
            throw new GameStudioProjectError("INVALID_EVENT", "Event tree exceeds the maximum nesting depth");
        }
        for (const candidate of events) {
            if (++count > MAXIMUM_EVENT_COUNT) {
                throw new GameStudioProjectError("INVALID_EVENT", "Event tree exceeds the maximum event count");
            }
            if (!isObject(candidate) || typeof candidate.id !== "string" || !candidate.id || typeof candidate.command !== "string" || !candidate.command) {
                throw new GameStudioProjectError("INVALID_EVENT", "Every script event requires a nonempty id and command");
            }
            if (eventIds.has(candidate.id)) {
                throw new GameStudioProjectError("DUPLICATE_EVENT_ID", `Script already contains event ${candidate.id}`);
            }
            eventIds.add(candidate.id);
            if (candidate.args !== undefined && !isObject(candidate.args)) {
                throw new GameStudioProjectError("INVALID_EVENT", `Event ${candidate.id} must contain an arguments object`);
            }
            if (candidate.command === "EVENT_SWITCH_SCENE") {
                const destination = isObject(candidate.args) ? candidate.args.sceneId : undefined;
                if (typeof destination !== "string" ||
                    !destination ||
                    (options.knownSceneIds && !options.knownSceneIds.has(destination)) ||
                    (options.sceneExists && !options.sceneExists(destination))) {
                    throw new GameStudioProjectError("SCENE_NOT_FOUND", `Event ${candidate.id} references an unknown destination scene`);
                }
            }
            if (candidate.children !== undefined && !isObject(candidate.children)) {
                throw new GameStudioProjectError("INVALID_EVENT", `Event ${candidate.id} must contain a named-branch object`);
            }
            if (isObject(candidate.children)) {
                for (const [branch, children] of Object.entries(candidate.children)) {
                    if (FORBIDDEN_KEYS.has(branch) || !Array.isArray(children)) {
                        throw new GameStudioProjectError("INVALID_EVENT", `Event ${candidate.id} has an invalid ${branch} branch`);
                    }
                    inspect(children, depth + 1);
                }
            }
        }
    }
    for (const [key, value] of Object.entries(resource)) {
        if (/^(?:script|[A-Za-z][A-Za-z0-9]*Script)$/.test(key) && Array.isArray(value))
            inspect(value, 0);
    }
}
function insertionIndex(events, input) {
    const placements = Number(input.index !== undefined) + Number(input.beforeEventId !== undefined) + Number(input.afterEventId !== undefined);
    if (placements > 1) {
        throw new GameStudioProjectError("INVALID_INPUT", "Specify at most one of index, beforeEventId, or afterEventId");
    }
    if (input.index !== undefined) {
        if (!Number.isInteger(input.index) || input.index < 0 || input.index > events.length) {
            throw new GameStudioProjectError("INVALID_INPUT", `Event index must be between 0 and ${events.length}`);
        }
        return input.index;
    }
    const reference = input.beforeEventId ?? input.afterEventId;
    if (reference !== undefined) {
        const index = events.findIndex((event) => event.id === reference);
        if (index < 0)
            throw new GameStudioProjectError("EVENT_NOT_FOUND", `No placement event with id ${reference} exists`);
        return index + Number(input.afterEventId !== undefined);
    }
    return events.length;
}
export function applyScriptEdit(resource, input, options = {}) {
    if (!input.target || !["insert", "update", "delete", "move"].includes(input.action)) {
        throw new GameStudioProjectError("INVALID_INPUT", "Script edits require a target and a supported action");
    }
    if (input.event)
        assertSafeJson(input.event, "Script event");
    if (input.patch)
        assertSafeJson(input.patch, "Script event patch");
    const cloned = structuredClone(resource);
    const events = scriptEvents(cloned, input.target);
    const scriptKey = resolveScriptKey(input.target);
    let event;
    let index;
    if (input.action === "insert") {
        if (!input.event || !isObject(input.event)) {
            throw new GameStudioProjectError("INVALID_INPUT", "Inserting a script event requires an event object");
        }
        index = insertionIndex(events, input);
        const supplied = structuredClone(input.event);
        event = {
            ...supplied,
            id: supplied.id ?? stableResourceId(String(resource.id ?? "resource"), scriptKey, JSON.stringify(input.target.branchPath ?? []), String(index), String(supplied.command ?? "event")),
        };
        events.splice(index, 0, event);
    }
    else {
        if (!input.eventId)
            throw new GameStudioProjectError("INVALID_INPUT", `${input.action} requires an eventId`);
        index = events.findIndex((candidate) => candidate.id === input.eventId);
        const selected = events[index];
        if (index < 0 || !selected) {
            throw new GameStudioProjectError("EVENT_NOT_FOUND", `No event with id ${input.eventId} exists in the selected branch`);
        }
        if (input.action === "update") {
            if (!input.patch || !isObject(input.patch)) {
                throw new GameStudioProjectError("INVALID_INPUT", "Updating a script event requires a patch object");
            }
            if (input.patch.id !== undefined && input.patch.id !== input.eventId) {
                throw new GameStudioProjectError("INVALID_PROPERTY", "Script event IDs cannot be changed");
            }
            event = mergeJson(selected, input.patch);
            events[index] = event;
        }
        else if (input.action === "delete") {
            event = selected;
            events.splice(index, 1);
        }
        else {
            event = selected;
            events.splice(index, 1);
            index = insertionIndex(events, input);
            events.splice(index, 0, event);
        }
    }
    validateEventTree(cloned, options);
    const explicitlyPatchedCoordinates = new Map();
    if (input.action === "update" && input.eventId && isObject(input.patch?.args)) {
        const coordinates = new Set();
        for (const coordinate of ["x", "y"]) {
            if (Object.prototype.hasOwnProperty.call(input.patch.args, coordinate))
                coordinates.add(coordinate);
        }
        if (coordinates.size > 0)
            explicitlyPatchedCoordinates.set(input.eventId, coordinates);
    }
    const invalid = findInvalidNativeScriptEvent(cloned, resource, { explicitlyPatchedCoordinates });
    if (invalid)
        throw new GameStudioProjectError("INVALID_EVENT", invalid.message);
    return { resource: cloned, event, action: input.action, index, scriptKey };
}
async function locateResource(projectPath, target, access, existingInventory) {
    if (!target || typeof target.sceneId !== "string" || !target.sceneId) {
        throw new GameStudioProjectError("INVALID_INPUT", "Script targets require a sceneId");
    }
    if (target.actorId && target.triggerId) {
        throw new GameStudioProjectError("INVALID_INPUT", "Specify either actorId or triggerId, not both");
    }
    if (access)
        await access.ensureFresh();
    const inventory = access ? undefined : existingInventory ?? await inventoryProject(projectPath);
    const projectRoot = access?.projectRoot ?? inventory.projectRoot;
    const selectedProjectPath = access?.projectPath ?? inventory.projectPath;
    const format = access ? access.projectInspection().format : inventory.format;
    const scene = access ? access.scene(target.sceneId) : inventory.scenes.find((candidate) => candidate.id === target.sceneId);
    if (!scene)
        throw new GameStudioProjectError("SCENE_NOT_FOUND", `No scene with id ${target.sceneId} exists`);
    let selected = scene;
    if (target.actorId) {
        const actor = access ? access.actor(scene.id, target.actorId) : scene.actors.find((candidate) => candidate.id === target.actorId);
        if (!actor)
            throw new GameStudioProjectError("ACTOR_NOT_FOUND", `No actor with id ${target.actorId} exists in scene ${scene.id}`);
        selected = actor;
    }
    if (target.triggerId) {
        const trigger = access ? access.trigger(scene.id, target.triggerId) : scene.triggers.find((candidate) => candidate.id === target.triggerId);
        if (!trigger)
            throw new GameStudioProjectError("TRIGGER_NOT_FOUND", `No trigger with id ${target.triggerId} exists in scene ${scene.id}`);
        selected = trigger;
    }
    const filename = path.join(projectRoot, selected.resourcePath);
    return {
        projectPath: selectedProjectPath,
        projectRoot,
        format,
        ...(inventory ? { inventory } : {}),
        scene,
        selected,
        filename,
    };
}
async function readSelectedResource(context, target, owner) {
    const { format, scene, selected } = context;
    if (format === "distributed") {
        return { ...context, resource: owner };
    }
    const descriptor = owner;
    const existingScene = (Array.isArray(descriptor.scenes) ? descriptor.scenes : []).find((candidate) => isObject(candidate) && candidate.id === scene.id);
    if (!isObject(existingScene))
        throw new GameStudioProjectError("SCENE_NOT_FOUND", `Scene ${scene.id} disappeared during script selection`);
    let resource = existingScene;
    if (target.actorId || target.triggerId) {
        const collection = existingScene[target.actorId ? "actors" : "triggers"];
        const matching = (Array.isArray(collection) ? collection : []).find((candidate) => isObject(candidate) && candidate.id === selected.id);
        if (!isObject(matching))
            throw new GameStudioProjectError("RESOURCE_NOT_FOUND", `Script owner ${selected.id} disappeared during selection`);
        resource = matching;
    }
    return { ...context, resource, descriptor };
}
async function selectResource(projectPath, target, access, existingInventory) {
    const location = await locateResource(projectPath, target, access, existingInventory);
    const loaded = await readProjectJsonWithRevision(location.projectRoot, location.filename);
    return { ...await readSelectedResource(location, target, loaded.json), revision: loaded.revision };
}
async function assertRevision(root, filename, expected, actual) {
    if (expected !== undefined && (actual ?? await resourceRevision(root, filename)) !== expected) {
        throw new GameStudioProjectError("STALE_RESOURCE", "The target resource changed before the requested script edit", filename);
    }
}
export async function inspectScript(projectPath, input, access) {
    const selection = await selectResource(projectPath, input.target, access);
    let events = structuredClone(scriptEvents(selection.resource, input.target));
    if (input.eventId !== undefined) {
        const event = events.find((candidate) => candidate.id === input.eventId);
        if (!event)
            throw new GameStudioProjectError("EVENT_NOT_FOUND", `No event with id ${input.eventId} exists in the selected branch`);
        events = [event];
    }
    return {
        projectPath: selection.projectPath,
        projectRoot: selection.projectRoot,
        resourcePath: selection.selected.resourcePath,
        sceneId: selection.scene.id,
        ...(input.target.actorId ? { actorId: input.target.actorId } : {}),
        ...(input.target.triggerId ? { triggerId: input.target.triggerId } : {}),
        scriptKey: resolveScriptKey(input.target),
        branchPath: structuredClone(input.target.branchPath ?? []),
        events,
        eventCount: events.length,
        revision: selection.revision,
    };
}
async function editSelectedScript(projectPath, input, access, inventory) {
    const location = await locateResource(projectPath, input.target, access, inventory);
    return withProjectResourceWriteLock(location.projectRoot, location.filename, async () => {
        const loaded = await readProjectJsonWithRevision(location.projectRoot, location.filename);
        const beforeRevision = loaded.revision;
        await assertRevision(location.projectRoot, location.filename, input.expectedRevision, beforeRevision);
        const selection = await readSelectedResource(location, input.target, loaded.json);
        const applied = applyScriptEdit(selection.resource, input, {
            ...(access
                ? { sceneExists: (sceneId) => access.scene(sceneId) !== undefined }
                : { knownSceneIds: new Set(selection.inventory.scenes.map((scene) => scene.id)) }),
        });
        let updated = applied.resource;
        if (selection.format === "legacy") {
            const descriptor = selection.descriptor;
            if (!descriptor)
                throw new GameStudioProjectError("INVALID_RESOURCE", "Legacy project descriptor is unavailable");
            const scenes = Array.isArray(descriptor.scenes) ? descriptor.scenes : [];
            const replaced = scenes.map((candidate) => {
                if (!isObject(candidate) || candidate.id !== selection.scene.id)
                    return candidate;
                if (!input.target.actorId && !input.target.triggerId)
                    return applied.resource;
                const key = input.target.actorId ? "actors" : "triggers";
                const collection = Array.isArray(candidate[key]) ? candidate[key] : [];
                return { ...candidate, [key]: collection.map((owner) => isObject(owner) && owner.id === selection.selected.id ? applied.resource : owner) };
            });
            updated = { ...descriptor, scenes: replaced };
        }
        await assertRevision(selection.projectRoot, selection.filename, beforeRevision);
        await writeProjectJsonAtomic(selection.projectRoot, selection.filename, updated);
        if (access)
            await access.noteCommittedPaths([selection.selected.resourcePath]);
        return {
            projectPath: selection.projectPath,
            projectRoot: selection.projectRoot,
            resourcePath: selection.selected.resourcePath,
            sceneId: selection.scene.id,
            ...(input.target.actorId ? { actorId: input.target.actorId } : {}),
            ...(input.target.triggerId ? { triggerId: input.target.triggerId } : {}),
            event: applied.event,
            action: applied.action,
            index: applied.index,
            scriptKey: applied.scriptKey,
            revision: await resourceRevision(selection.projectRoot, selection.filename),
        };
    });
}
export async function editScript(projectPath, input, access) {
    return editSelectedScript(projectPath, input, access);
}
export function buildSceneTransitionEvent(input, destination) {
    if (destination.id !== input.destinationSceneId) {
        throw new GameStudioProjectError("SCENE_NOT_FOUND", `No destination scene with id ${input.destinationSceneId} exists`);
    }
    for (const key of ["x", "y"]) {
        const value = input[key];
        const boundary = destination[key === "x" ? "width" : "height"];
        if (!Number.isInteger(value) || value < 0 || typeof boundary !== "number" || value >= boundary) {
            throw new GameStudioProjectError("INVALID_INPUT", `Transition ${key} must fit within the destination scene`);
        }
    }
    const direction = input.direction ?? "down";
    if (!VALID_DIRECTIONS.has(direction)) {
        throw new GameStudioProjectError("INVALID_INPUT", "Transition direction must be up, down, left, or right");
    }
    const fadeSpeed = input.fadeSpeed === undefined ? "2" : String(input.fadeSpeed);
    if (!/^\d+$/.test(fadeSpeed)) {
        throw new GameStudioProjectError("INVALID_INPUT", "Transition fadeSpeed must be a nonnegative integer");
    }
    return {
        command: "EVENT_SWITCH_SCENE",
        args: {
            sceneId: input.destinationSceneId,
            x: { type: "number", value: input.x },
            y: { type: "number", value: input.y },
            direction,
            fadeSpeed,
        },
    };
}
export async function createSceneTransition(projectPath, input, access) {
    if (access)
        await access.ensureFresh();
    const inventory = access ? undefined : await inventoryProject(projectPath);
    const destination = access
        ? access.scene(input.destinationSceneId)
        : inventory.scenes.find((scene) => scene.id === input.destinationSceneId);
    if (!destination)
        throw new GameStudioProjectError("SCENE_NOT_FOUND", `No destination scene with id ${input.destinationSceneId} exists`);
    return editSelectedScript(projectPath, {
        action: "insert",
        target: input.target,
        event: buildSceneTransitionEvent(input, destination),
        ...(input.index === undefined ? {} : { index: input.index }),
        ...(input.expectedRevision === undefined ? {} : { expectedRevision: input.expectedRevision }),
    }, access, inventory);
}
//# sourceMappingURL=game-scripts.js.map