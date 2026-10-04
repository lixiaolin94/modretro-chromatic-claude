import { createHash } from "node:crypto";
import { lstat, readFile, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { publishNativeImportFile, readNativeImportSnapshot, rollbackNativeImportFile, replaceNativeImportFile, rollbackNativeReplacement, finalizeNativeReplacement, NativeRecoveryConflict, NativeImportFileError } from "./native-import-files.js";
import { createActorResource, mergeActorChanges, validateActorResource, } from "./actors.js";
import { applyCollisionEdits } from "./collisions.js";
import { applyScriptEdit, buildSceneTransitionEvent, } from "./game-scripts.js";
import { applyVariableUpdate } from "./game-variables.js";
import { nextResourceIndex, projectPathExists, projectRelativePath, readProjectJson, readProjectJsonWithRevision, resolveProjectPath, resourceSlug, stableResourceId, withProjectResourceWriteLock, withProjectWriteLock, writeProjectBytesAtomic, } from "./project-files.js";
import { PROJECT_REVISION_ALGORITHM, } from "./project-access.js";
import { loadProjectSnapshot, projectRevision, projectRevisionBeforeAdditions, } from "./project-snapshot.js";
import { GameStudioProjectError, discoverProject, resolveNativeAssetIdentity, validateNativeSceneUpdate, } from "./project.js";
import { createTriggerResource, mergeTriggerChanges, validateTriggerResource, } from "./triggers.js";
import { explicitlyPatchedNativeScriptCoordinates, findInvalidNativeScriptEvent, } from "./native-script-events.js";
const MAX_BATCH_OPERATIONS = 100;
const MAX_INSPECTION_RESOURCES = 100;
const MAX_INSPECTION_EVENTS = 250;
const MAX_REFERENCE_SAMPLES = 10;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const IMMUTABLE_KEYS = new Set(["id", "_resourceType", "_index", "symbol"]);
const TRIGGER_REFERENCE_KEYS = new Set(["triggerId", "trigger", "triggerIds", "targetTriggerId"]);
const projectMutationQueues = new Map();
export class ProjectTransactionError extends GameStudioProjectError {
    recovery;
    constructor(code, cause, recovery) {
        super(code, `Native import failed: ${recovery.originalCause.message}. ${recovery.conflictedPaths.length ? "Recovery conflicts require inspection; preserved files were not overwritten." : "Published outputs were rolled back."}`);
        this.recovery = recovery;
        Object.defineProperty(this, "cause", { value: cause });
    }
}
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function digest(value) {
    return createHash("sha256").update(value).digest("hex");
}
function stagedBytes(value) {
    return Buffer.isBuffer(value)
        ? Buffer.from(value)
        : Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}
function projectError(code, message) {
    throw new GameStudioProjectError(code, message);
}
function assertIndexedProjectAccess(projectPath, indexedAccess) {
    if (!indexedAccess)
        return;
    const requestedPath = path.resolve(projectPath);
    if (requestedPath !== indexedAccess.projectPath && requestedPath !== indexedAccess.projectRoot) {
        projectError("STALE_PROJECT", "Indexed project access does not belong to the requested native game project");
    }
    if (indexedAccess.revisionAlgorithm !== PROJECT_REVISION_ALGORITHM) {
        projectError("STALE_PROJECT", "Indexed project access uses an obsolete project revision algorithm");
    }
}
function requiredString(value, label) {
    if (typeof value !== "string" || value.trim().length === 0) {
        projectError("INVALID_INPUT", `${label} must be a non-empty string`);
    }
    return value.trim();
}
function boundedLimit(value, fallback, maximum, label) {
    if (value === undefined)
        return fallback;
    if (!Number.isInteger(value) || typeof value !== "number" || value < 0 || value > maximum) {
        projectError("INVALID_INPUT", `${label} must be an integer between 0 and ${maximum}`);
    }
    return value;
}
function assertSafeValue(value, label, forbidImmutable = false) {
    if (Array.isArray(value)) {
        for (const child of value)
            assertSafeValue(child, label);
        return;
    }
    if (!isObject(value))
        return;
    for (const [key, child] of Object.entries(value)) {
        if (FORBIDDEN_KEYS.has(key) || (forbidImmutable && IMMUTABLE_KEYS.has(key))) {
            projectError("INVALID_PROPERTY", `${label} cannot modify reserved property ${key}`);
        }
        assertSafeValue(child, label);
    }
}
function strippedResource(resource) {
    const cloned = structuredClone(resource);
    delete cloned.resourcePath;
    if ("actors" in resource && "triggers" in resource) {
        delete cloned.actors;
        delete cloned.triggers;
    }
    return cloned;
}
function sceneResource(overlay) {
    return {
        ...overlay.scene.value,
        id: overlay.scene.id,
        name: typeof overlay.scene.value.name === "string" ? overlay.scene.value.name : "",
        resourcePath: overlay.scene.relativePath,
        actors: [...overlay.actors.values()].map(toProjectResource),
        triggers: [...overlay.triggers.values()].map(toProjectResource),
    };
}
function toProjectResource(resource) {
    return {
        ...resource.value,
        id: resource.id,
        name: typeof resource.value.name === "string" ? resource.value.name : "",
        resourcePath: resource.relativePath,
    };
}
/** Keep local project operations ordered; authored writes also exclude other plugin processes. */
export async function withProjectMutation(projectRoot, action, options = {}) {
    const previous = projectMutationQueues.get(projectRoot) ?? Promise.resolve();
    let release;
    const pending = new Promise((resolve) => { release = resolve; });
    const tail = previous.catch(() => undefined).then(() => pending);
    projectMutationQueues.set(projectRoot, tail);
    await previous.catch(() => undefined);
    try {
        // The authored project gate must be outside per-resource gates (and uses a distinct lock namespace).
        // Artifact compilation and browser state retain local ordering without blocking other authoring processes.
        return options.authoredWrite === false ? await action() : await withProjectWriteLock(projectRoot, action);
    }
    finally {
        release();
        if (projectMutationQueues.get(projectRoot) === tail)
            projectMutationQueues.delete(projectRoot);
    }
}
function assertExpectedRevision(snapshot, expectedRevision) {
    if (expectedRevision !== undefined && expectedRevision !== snapshot.revision) {
        projectError("STALE_PROJECT_REVISION", `Expected project revision ${expectedRevision}, but the current revision is ${snapshot.revision}`);
    }
}
function findScene(snapshot, sceneId) {
    const scene = snapshot.scenesById.get(sceneId);
    if (!scene)
        projectError("SCENE_NOT_FOUND", `No scene with id ${sceneId} exists in this project`);
    return scene;
}
function collectScriptEvents(value, visit) {
    if (Array.isArray(value)) {
        for (const child of value)
            collectScriptEvents(child, visit);
        return;
    }
    if (!isObject(value))
        return;
    if (typeof value.command === "string")
        visit(value);
    for (const [key, child] of Object.entries(value)) {
        if (key === "args")
            continue;
        if (Array.isArray(child) || isObject(child))
            collectScriptEvents(child, visit);
    }
}
function collectEventReferences(value) {
    const references = { scenes: new Set(), actors: new Set(), variables: new Set() };
    collectScriptEvents(value, (event) => {
        if (!isObject(event.args))
            return;
        const args = event.args;
        if (event.command === "EVENT_SWITCH_SCENE" && typeof args.sceneId === "string")
            references.scenes.add(args.sceneId);
        if (typeof args.actorId === "string" && args.actorId !== "$self$" && args.actorId !== "player") {
            references.actors.add(args.actorId);
        }
        if (typeof args.variable === "string")
            references.variables.add(args.variable);
        collectVariableValues(args, references.variables);
    });
    return references;
}
function collectVariableValues(value, output) {
    if (Array.isArray(value)) {
        for (const child of value)
            collectVariableValues(child, output);
        return;
    }
    if (!isObject(value))
        return;
    if (value.type === "variable" && typeof value.value === "string")
        output.add(value.value);
    for (const child of Object.values(value))
        collectVariableValues(child, output);
}
function containsStructuralTriggerReference(value, triggerId) {
    if (Array.isArray(value)) {
        return value.some((child) => containsStructuralTriggerReference(child, triggerId));
    }
    if (!isObject(value))
        return false;
    for (const [key, child] of Object.entries(value)) {
        if (TRIGGER_REFERENCE_KEYS.has(key)) {
            if (child === triggerId)
                return true;
            if (Array.isArray(child) && child.includes(triggerId))
                return true;
            if (isObject(child) && (child.id === triggerId || child.value === triggerId))
                return true;
        }
        if (containsStructuralTriggerReference(child, triggerId))
            return true;
    }
    return false;
}
function assertCompleteDestructiveCoverage(indexedAccess) {
    if (indexedAccess && !indexedAccess.coverage.complete) {
        projectError("RESOURCE_IN_USE", "Cannot verify complete semantic reference coverage for a destructive scene transaction");
    }
}
function allAuthoredOwners(snapshot) {
    const owners = [];
    for (const scene of snapshot.scenesById.values()) {
        owners.push({ sceneId: scene.id, resource: strippedResource(scene), path: scene.resourcePath });
        for (const resource of [...scene.actors, ...scene.triggers]) {
            owners.push({ sceneId: scene.id, resource: strippedResource(resource), path: resource.resourcePath });
        }
    }
    return owners;
}
function compactResource(resource, includeScripts, remaining) {
    const result = structuredClone(resource);
    for (const [key, value] of Object.entries(result)) {
        if (!(key === "script" || /^[A-Za-z][A-Za-z0-9]*Script$/.test(key)) || !Array.isArray(value))
            continue;
        if (!includeScripts) {
            delete result[key];
            continue;
        }
        let events = 0;
        collectScriptEvents(value, () => { events++; });
        if (events > remaining.value) {
            result[key] = [];
            remaining.truncated = true;
        }
        else {
            remaining.value -= events;
        }
    }
    return result;
}
export async function inspectScene(projectPath, input, indexedAccess) {
    assertIndexedProjectAccess(projectPath, indexedAccess);
    const sceneId = requiredString(input.sceneId, "Scene id");
    const maxActors = boundedLimit(input.maxActors, 25, MAX_INSPECTION_RESOURCES, "maxActors");
    const maxTriggers = boundedLimit(input.maxTriggers, 25, MAX_INSPECTION_RESOURCES, "maxTriggers");
    const maxEvents = boundedLimit(input.maxEvents, 50, MAX_INSPECTION_EVENTS, "maxEvents");
    let projectRoot;
    let selectedProjectPath;
    let revision;
    let selected;
    if (indexedAccess) {
        await indexedAccess.ensureFresh();
        const indexedScene = indexedAccess.scene(sceneId);
        if (!indexedScene)
            projectError("SCENE_NOT_FOUND", `No scene with id ${sceneId} exists in this project`);
        projectRoot = indexedAccess.projectRoot;
        selectedProjectPath = indexedAccess.projectPath;
        revision = indexedAccess.revision;
        selected = indexedScene;
    }
    else {
        const snapshot = await loadProjectSnapshot(projectPath);
        projectRoot = snapshot.projectRoot;
        selectedProjectPath = snapshot.projectPath;
        revision = snapshot.revision;
        selected = findScene(snapshot, sceneId);
    }
    const format = path.resolve(projectRoot, selected.resourcePath) === path.resolve(selectedProjectPath) ? "legacy" : "distributed";
    const loaded = await readProjectJsonWithRevision(projectRoot, selected.resourcePath);
    const nativeScene = format === "legacy"
        ? (Array.isArray(loaded.json.scenes) ? loaded.json.scenes.find((value) => isObject(value) && value.id === sceneId) : undefined)
        : loaded.json;
    if (!isObject(nativeScene) || nativeScene.id !== sceneId) {
        projectError("SCENE_NOT_FOUND", `Scene ${sceneId} changed or disappeared from its native resource`);
    }
    const normalizeNative = (resource) => {
        const { resourcePath: _resourcePath, ...value } = resource;
        return { ...value, id: typeof resource.id === "string" ? resource.id : "", name: typeof resource.name === "string" ? resource.name : "" };
    };
    const { actors: _sceneActors, triggers: _sceneTriggers, ...sceneData } = normalizeNative(nativeScene);
    const actors = format === "legacy"
        ? (Array.isArray(nativeScene.actors) ? nativeScene.actors.filter(isObject).map(normalizeNative) : [])
        : selected.actors.map(strippedResource);
    const triggers = format === "legacy"
        ? (Array.isArray(nativeScene.triggers) ? nativeScene.triggers.filter(isObject).map(normalizeNative) : [])
        : selected.triggers.map(strippedResource);
    let eventCount = 0;
    for (const resource of [sceneData, ...actors, ...triggers]) {
        collectScriptEvents(resource, () => { eventCount++; });
    }
    const remaining = { value: maxEvents, truncated: false };
    return {
        projectPath: selectedProjectPath,
        projectRoot,
        revision,
        revisionAlgorithm: PROJECT_REVISION_ALGORITHM,
        sceneRevision: loaded.revision,
        scene: compactResource(sceneData, input.includeScripts ?? false, remaining),
        actors: actors.slice(0, maxActors).map((actor) => compactResource(actor, input.includeScripts ?? false, remaining)),
        triggers: triggers.slice(0, maxTriggers).map((trigger) => compactResource(trigger, input.includeScripts ?? false, remaining)),
        counts: { actors: actors.length, triggers: triggers.length, events: eventCount },
        truncated: {
            actors: actors.length > maxActors,
            triggers: triggers.length > maxTriggers,
            events: remaining.truncated,
        },
    };
}
async function stageFile(overlay, relativePath, after) {
    const existing = overlay.staged.get(relativePath);
    if (existing) {
        existing.after = after;
        return;
    }
    const absolutePath = path.join(overlay.snapshot.projectRoot, relativePath);
    await resolveProjectPath(overlay.snapshot.projectRoot, absolutePath, { mustExist: false });
    let before = null;
    if (await projectPathExists(overlay.snapshot.projectRoot, absolutePath)) {
        await resolveProjectPath(overlay.snapshot.projectRoot, absolutePath, { mustExist: true });
        before = await readFile(absolutePath);
    }
    overlay.staged.set(relativePath, { relativePath, absolutePath, before, after });
}
async function markResource(overlay, resource, deleted = false) {
    if (overlay.format === "legacy") {
        if (!overlay.descriptor)
            projectError("INVALID_RESOURCE", "Legacy transaction is missing its descriptor");
        await stageFile(overlay, projectRelativePath(overlay.snapshot.projectRoot, overlay.snapshot.projectPath), overlay.descriptor);
    }
    else {
        await stageFile(overlay, resource.relativePath, deleted ? null : resource.value);
    }
}
async function createOverlay(snapshot, sceneId) {
    const selected = findScene(snapshot, sceneId);
    const inventory = snapshot.inventory;
    const distributed = inventory.format === "distributed";
    let descriptor;
    let sceneValue = strippedResource(selected);
    const actors = new Map();
    const triggers = new Map();
    if (!distributed) {
        descriptor = structuredClone(snapshot.descriptor);
        const scenes = Array.isArray(descriptor.scenes) ? descriptor.scenes : [];
        const original = scenes.find((candidate) => isObject(candidate) && candidate.id === sceneId);
        if (!isObject(original))
            projectError("SCENE_NOT_FOUND", `Scene ${sceneId} disappeared from the legacy descriptor`);
        sceneValue = original;
    }
    for (const [resources, destination, collectionKey] of [
        [selected.actors, actors, "actors"],
        [selected.triggers, triggers, "triggers"],
    ]) {
        for (const resource of resources) {
            let value = strippedResource(resource);
            if (!distributed) {
                const collection = sceneValue[collectionKey];
                const original = (Array.isArray(collection) ? collection : []).find((candidate) => isObject(candidate) && candidate.id === resource.id);
                if (!isObject(original))
                    projectError("RESOURCE_NOT_FOUND", `Resource ${resource.id} disappeared from the legacy descriptor`);
                value = original;
            }
            destination.set(resource.id, { id: resource.id, relativePath: resource.resourcePath, value });
        }
    }
    return {
        snapshot,
        inventory,
        format: inventory.format,
        scene: { id: selected.id, relativePath: selected.resourcePath, value: sceneValue },
        actors,
        triggers,
        ...(descriptor ? { descriptor } : {}),
        deletedActorIds: new Set(),
        deletedTriggerIds: new Set(),
        deletedVariableIds: new Set(),
        staged: new Map(),
    };
}
function operationFields(operation) {
    if (operation.input !== undefined && !isObject(operation.input)) {
        projectError("INVALID_INPUT", "Operation input must be a JSON object");
    }
    const { type: _type, clientId: _clientId, input, ...rest } = operation;
    return { ...rest, ...(isObject(input) ? input : {}) };
}
function normalizeOperationType(type) {
    const raw = requiredString(type, "Operation type");
    const aliases = {
        actor_create: "actor.create",
        actor_update: "actor.update",
        actor_delete: "actor.delete",
        trigger_create: "trigger.create",
        trigger_update: "trigger.update",
        trigger_delete: "trigger.delete",
        script_edit: "event.edit",
        "script.edit": "event.edit",
        event_edit: "event.edit",
        collision_edit: "collision.edit",
        variable_update: "variable.update",
        scene_transition: "scene.transition",
        scene_update: "scene.update",
    };
    return aliases[raw] ?? raw;
}
function nextOverlayIndex(resources) {
    return nextResourceIndex([...resources.values()].map(toProjectResource));
}
async function chooseResourcePath(overlay, kind, name) {
    const base = resourceSlug(name, kind === "actors" ? "actor" : "trigger");
    const folder = path.join(path.dirname(overlay.scene.relativePath), kind);
    for (let index = 1; index <= 10_000; index++) {
        const slug = index === 1 ? base : `${base}_${index}`;
        const relativePath = path.join(folder, `${slug}.gbsres`).split(path.sep).join("/");
        const staged = overlay.staged.get(relativePath);
        if (staged?.after === null)
            continue;
        if (staged || await projectPathExists(overlay.snapshot.projectRoot, path.join(overlay.snapshot.projectRoot, relativePath)))
            continue;
        return { relativePath, slug };
    }
    projectError("RESOURCE_NAME_EXHAUSTED", `Could not choose a unique ${kind} resource path for ${base}`);
}
function assertKnownScene(input, sceneId) {
    if (input.sceneId !== undefined && input.sceneId !== sceneId) {
        projectError("INVALID_INPUT", `Operation scene ${String(input.sceneId)} does not match batch scene ${sceneId}`);
    }
}
function pushLegacyResource(overlay, kind, value) {
    if (overlay.format !== "legacy")
        return;
    const collection = overlay.scene.value[kind];
    if (!Array.isArray(collection)) {
        overlay.scene.value[kind] = [value];
    }
    else {
        collection.push(value);
    }
}
function replaceLegacyResource(overlay, kind, resourceId, replacement) {
    if (overlay.format !== "legacy")
        return;
    const collection = overlay.scene.value[kind];
    if (!Array.isArray(collection))
        projectError("INVALID_RESOURCE", `Legacy scene has an invalid ${kind} collection`);
    const index = collection.findIndex((candidate) => isObject(candidate) && candidate.id === resourceId);
    if (index < 0)
        projectError("RESOURCE_NOT_FOUND", `Legacy ${kind} resource ${resourceId} disappeared`);
    if (replacement)
        collection[index] = replacement;
    else
        collection.splice(index, 1);
}
function assertUniqueResourceId(overlay, id) {
    if (overlay.snapshot.actorsById.has(id) || overlay.snapshot.triggersById.has(id) || overlay.snapshot.scenesById.has(id)
        || overlay.actors.has(id) || overlay.triggers.has(id)) {
        projectError("DUPLICATE_RESOURCE_ID", `A resource with id ${id} already exists`);
    }
}
async function applyActorOperation(overlay, type, fields) {
    assertKnownScene(fields, overlay.scene.id);
    if (type === "actor.create") {
        const name = requiredString(fields.name, "Actor name");
        const chosen = overlay.format === "distributed"
            ? await chooseResourcePath(overlay, "actors", name)
            : { relativePath: overlay.scene.relativePath, slug: resourceSlug(name, "actor") };
        const id = fields.id === undefined ? stableResourceId(overlay.scene.id, "actor", chosen.slug) : requiredString(fields.id, "Actor id");
        assertUniqueResourceId(overlay, id);
        const input = { ...fields, sceneId: overlay.scene.id, name };
        const created = createActorResource(input, id, nextOverlayIndex(overlay.actors), chosen.slug);
        const value = fields.properties === undefined
            ? created
            : mergeActorChanges(created, { sceneId: overlay.scene.id, actorId: id, properties: fields.properties });
        validateActorResource(overlay.inventory, sceneResource(overlay), value);
        const resource = { id, relativePath: chosen.relativePath, value };
        overlay.actors.set(id, resource);
        pushLegacyResource(overlay, "actors", value);
        await markResource(overlay, resource);
        return { resourceId: id, resourcePath: chosen.relativePath };
    }
    const actorId = requiredString(fields.actorId ?? fields.id, "Actor id");
    const resource = overlay.actors.get(actorId);
    if (!resource)
        projectError("ACTOR_NOT_FOUND", `No actor with id ${actorId} exists in scene ${overlay.scene.id}`);
    if (type === "actor.delete") {
        overlay.actors.delete(actorId);
        overlay.deletedActorIds.add(actorId);
        replaceLegacyResource(overlay, "actors", actorId);
        await markResource(overlay, resource, true);
        return { resourceId: actorId, resourcePath: resource.relativePath };
    }
    const merged = mergeActorChanges(resource.value, { ...fields, sceneId: overlay.scene.id, actorId });
    validateActorResource(overlay.inventory, sceneResource(overlay), merged, resource.value, {
        explicitlyPatchedCoordinates: explicitlyPatchedNativeScriptCoordinates(isObject(fields.properties) ? fields.properties : undefined),
    });
    resource.value = merged;
    replaceLegacyResource(overlay, "actors", actorId, merged);
    await markResource(overlay, resource);
    return { resourceId: actorId, resourcePath: resource.relativePath };
}
async function applyTriggerOperation(overlay, type, fields) {
    assertKnownScene(fields, overlay.scene.id);
    if (type === "trigger.create") {
        const name = requiredString(fields.name, "Trigger name");
        const chosen = overlay.format === "distributed"
            ? await chooseResourcePath(overlay, "triggers", name)
            : { relativePath: overlay.scene.relativePath, slug: resourceSlug(name, "trigger") };
        const id = fields.id === undefined ? stableResourceId(overlay.scene.id, "trigger", chosen.slug) : requiredString(fields.id, "Trigger id");
        assertUniqueResourceId(overlay, id);
        const input = { ...fields, sceneId: overlay.scene.id, name };
        const created = createTriggerResource(input, id, nextOverlayIndex(overlay.triggers), chosen.slug);
        const value = fields.properties === undefined
            ? created
            : mergeTriggerChanges(created, { sceneId: overlay.scene.id, triggerId: id, properties: fields.properties });
        validateTriggerResource(sceneResource(overlay), value);
        const resource = { id, relativePath: chosen.relativePath, value };
        overlay.triggers.set(id, resource);
        pushLegacyResource(overlay, "triggers", value);
        await markResource(overlay, resource);
        return { resourceId: id, resourcePath: chosen.relativePath };
    }
    const triggerId = requiredString(fields.triggerId ?? fields.id, "Trigger id");
    const resource = overlay.triggers.get(triggerId);
    if (!resource)
        projectError("TRIGGER_NOT_FOUND", `No trigger with id ${triggerId} exists in scene ${overlay.scene.id}`);
    if (type === "trigger.delete") {
        overlay.triggers.delete(triggerId);
        overlay.deletedTriggerIds.add(triggerId);
        replaceLegacyResource(overlay, "triggers", triggerId);
        await markResource(overlay, resource, true);
        return { resourceId: triggerId, resourcePath: resource.relativePath };
    }
    const merged = mergeTriggerChanges(resource.value, { ...fields, sceneId: overlay.scene.id, triggerId });
    validateTriggerResource(sceneResource(overlay), merged, resource.value, {
        explicitlyPatchedCoordinates: explicitlyPatchedNativeScriptCoordinates(isObject(fields.properties) ? fields.properties : undefined),
    });
    resource.value = merged;
    replaceLegacyResource(overlay, "triggers", triggerId, merged);
    await markResource(overlay, resource);
    return { resourceId: triggerId, resourcePath: resource.relativePath };
}
function resolveScriptOwner(overlay, fields) {
    const target = isObject(fields.target) ? fields.target : fields;
    assertKnownScene(target, overlay.scene.id);
    if (target.actorId && target.triggerId)
        projectError("INVALID_INPUT", "Specify either actorId or triggerId, not both");
    if (target.actorId !== undefined) {
        const actorId = requiredString(target.actorId, "Actor id");
        const actor = overlay.actors.get(actorId);
        if (!actor)
            projectError("ACTOR_NOT_FOUND", `No actor with id ${actorId} exists in scene ${overlay.scene.id}`);
        return { owner: actor, target };
    }
    if (target.triggerId !== undefined) {
        const triggerId = requiredString(target.triggerId, "Trigger id");
        const trigger = overlay.triggers.get(triggerId);
        if (!trigger)
            projectError("TRIGGER_NOT_FOUND", `No trigger with id ${triggerId} exists in scene ${overlay.scene.id}`);
        return { owner: trigger, target };
    }
    return { owner: overlay.scene, target };
}
async function applyEventOperation(overlay, fields) {
    const { owner, target } = resolveScriptOwner(overlay, fields);
    const input = { ...fields, ...target, target: { ...target, sceneId: overlay.scene.id } };
    const edited = applyScriptEdit(owner.value, input);
    owner.value = edited.resource;
    if (owner.id === overlay.scene.id) {
        if (overlay.format === "legacy" && overlay.descriptor) {
            const scenes = Array.isArray(overlay.descriptor.scenes) ? overlay.descriptor.scenes : [];
            const index = scenes.findIndex((scene) => isObject(scene) && scene.id === overlay.scene.id);
            if (index < 0)
                projectError("SCENE_NOT_FOUND", `Legacy scene ${overlay.scene.id} disappeared`);
            scenes[index] = edited.resource;
            overlay.scene.value = edited.resource;
        }
    }
    else {
        replaceLegacyResource(overlay, overlay.actors.has(owner.id) ? "actors" : "triggers", owner.id, edited.resource);
    }
    await markResource(overlay, owner);
    return {
        resourceId: owner.id,
        resourcePath: owner.relativePath,
        ...(typeof edited.event.id === "string" ? { eventId: edited.event.id } : {}),
    };
}
async function applyTransitionOperation(overlay, fields) {
    const destinationId = requiredString(fields.destinationSceneId, "Destination scene id");
    const destination = overlay.snapshot.scenesById.get(destinationId);
    if (!destination)
        projectError("SCENE_NOT_FOUND", `No destination scene with id ${destinationId} exists`);
    const event = buildSceneTransitionEvent(fields, destination);
    return applyEventOperation(overlay, { ...fields, action: "insert", event });
}
async function loadVariablesResource(overlay) {
    if (overlay.variables)
        return overlay.variables;
    if (overlay.format === "legacy") {
        if (!overlay.descriptor || !Array.isArray(overlay.descriptor.variables)) {
            projectError("UNSUPPORTED_PROJECT_FORMAT", "This legacy project does not contain a verified native variables collection");
        }
        overlay.variables = {
            id: "variables",
            relativePath: overlay.scene.relativePath,
            value: { variables: overlay.descriptor.variables, constants: Array.isArray(overlay.descriptor.constants) ? overlay.descriptor.constants : [] },
        };
        return overlay.variables;
    }
    const relativePath = "project/variables.gbsres";
    const absolutePath = path.join(overlay.snapshot.projectRoot, relativePath);
    const value = await projectPathExists(overlay.snapshot.projectRoot, absolutePath)
        ? await readProjectJson(overlay.snapshot.projectRoot, absolutePath)
        : { _resourceType: "variables", variables: [], constants: [] };
    overlay.variables = { id: "variables", relativePath, value };
    return overlay.variables;
}
async function applyVariableOperation(overlay, type, fields) {
    const resource = await loadVariablesResource(overlay);
    const action = type === "variable.delete" ? "delete" : type === "variable.upsert" ? "upsert" : fields.action;
    if (action !== "delete" && action !== "upsert")
        projectError("INVALID_INPUT", "Variable action must be upsert or delete");
    const input = { ...fields, action };
    const edited = applyVariableUpdate(resource.value, input);
    resource.value = edited.resource;
    if (overlay.format === "legacy" && overlay.descriptor) {
        overlay.descriptor.variables = edited.resource.variables;
        if (Array.isArray(overlay.descriptor.constants))
            overlay.descriptor.constants = edited.resource.constants;
    }
    if (action === "delete" && typeof edited.variable.id === "string")
        overlay.deletedVariableIds.add(edited.variable.id);
    await markResource(overlay, resource);
    return { resourceId: typeof edited.variable.id === "string" ? edited.variable.id : undefined, resourcePath: resource.relativePath };
}
async function applyCollisionOperation(overlay, fields) {
    assertKnownScene(fields, overlay.scene.id);
    const edited = applyCollisionEdits(overlay.scene.value, { ...fields, sceneId: overlay.scene.id });
    if (overlay.format === "legacy" && overlay.descriptor) {
        const scenes = Array.isArray(overlay.descriptor.scenes) ? overlay.descriptor.scenes : [];
        const index = scenes.findIndex((scene) => isObject(scene) && scene.id === overlay.scene.id);
        if (index < 0)
            projectError("SCENE_NOT_FOUND", `Legacy scene ${overlay.scene.id} disappeared`);
        scenes[index] = edited.scene;
    }
    overlay.scene.value = edited.scene;
    await markResource(overlay, overlay.scene);
    return { resourceId: overlay.scene.id, resourcePath: overlay.scene.relativePath, changed: edited.changed };
}
async function applySceneUpdateOperation(overlay, fields) {
    assertKnownScene(fields, overlay.scene.id);
    const { sceneId: _sceneId, properties, ...typed } = fields;
    if (properties !== undefined && !isObject(properties))
        projectError("INVALID_INPUT", "Scene properties must be a JSON object");
    assertSafeValue(properties, "Scene properties", true);
    assertSafeValue(typed, "Scene updates", true);
    const updates = { ...(isObject(properties) ? properties : {}), ...typed };
    const updated = { ...overlay.scene.value, ...updates };
    validateNativeSceneUpdate(overlay.scene.value, updated, updates, (id) => resolveNativeAssetIdentity(overlay.inventory, id)?.type === "background");
    if (overlay.format === "legacy" && overlay.descriptor) {
        const scenes = Array.isArray(overlay.descriptor.scenes) ? overlay.descriptor.scenes : [];
        const index = scenes.findIndex((scene) => isObject(scene) && scene.id === overlay.scene.id);
        if (index < 0)
            projectError("SCENE_NOT_FOUND", `Legacy scene ${overlay.scene.id} disappeared`);
        scenes[index] = updated;
    }
    overlay.scene.value = updated;
    await markResource(overlay, overlay.scene);
    return { resourceId: overlay.scene.id, resourcePath: overlay.scene.relativePath };
}
async function applyOperation(overlay, operation, index) {
    if (!isObject(operation))
        projectError("INVALID_INPUT", `Operation ${index} must be an object`);
    const type = normalizeOperationType(operation.type);
    const fields = operationFields(operation);
    assertSafeValue(fields, `Operation ${index}`);
    let result;
    switch (type) {
        case "actor.create":
        case "actor.update":
        case "actor.delete":
            result = await applyActorOperation(overlay, type, fields);
            break;
        case "trigger.create":
        case "trigger.update":
        case "trigger.delete":
            result = await applyTriggerOperation(overlay, type, fields);
            break;
        case "event.edit":
            result = await applyEventOperation(overlay, fields);
            break;
        case "scene.transition":
            result = await applyTransitionOperation(overlay, fields);
            break;
        case "collision.edit":
            result = await applyCollisionOperation(overlay, fields);
            break;
        case "variable.upsert":
        case "variable.delete":
        case "variable.update":
            result = await applyVariableOperation(overlay, type, fields);
            break;
        case "scene.update":
            result = await applySceneUpdateOperation(overlay, fields);
            break;
        default:
            projectError("INVALID_BATCH_OPERATION", `Unsupported scene batch operation ${type}`);
    }
    return { index, type, ...(operation.clientId !== undefined ? { clientId: requiredString(operation.clientId, "Client id") } : {}), ...result };
}
function validateFinalGraph(overlay, indexedAccess) {
    const selected = sceneResource(overlay);
    const originalScene = overlay.snapshot.scenesById.get(overlay.scene.id);
    const invalidScene = findInvalidNativeScriptEvent(overlay.scene.value, originalScene);
    if (invalidScene)
        projectError("INVALID_EVENT", invalidScene.message);
    for (const actor of overlay.actors.values()) {
        const original = originalScene?.actors.find((candidate) => candidate.id === actor.id);
        validateActorResource(overlay.inventory, selected, actor.value, original);
    }
    for (const trigger of overlay.triggers.values()) {
        const original = originalScene?.triggers.find((candidate) => candidate.id === trigger.id);
        validateTriggerResource(selected, trigger.value, original);
    }
    const deletedResources = overlay.deletedActorIds.size > 0
        || overlay.deletedTriggerIds.size > 0
        || overlay.deletedVariableIds.size > 0;
    if (deletedResources)
        assertCompleteDestructiveCoverage(indexedAccess);
    const owners = deletedResources && !indexedAccess
        ? allAuthoredOwners(overlay.snapshot).filter((owner) => owner.sceneId !== overlay.scene.id)
        : [];
    if (deletedResources && indexedAccess) {
        // The index proves the on-disk owners, not this proposed overlay. A new or
        // changed surviving owner can introduce helper-hidden dependencies even
        // when none existed before. Without overlay extraction, refuse that mixed
        // transaction. Pure owner removal still removes its hidden references.
        const unchangedOwner = (next, previous) => previous !== undefined
            && JSON.stringify(strippedResource(next)) === JSON.stringify(strippedResource(previous));
        const originalActors = new Map(originalScene?.actors.map((owner) => [owner.id, owner]));
        const originalTriggers = new Map(originalScene?.triggers.map((owner) => [owner.id, owner]));
        if (!unchangedOwner(selected, originalScene)
            || [...overlay.actors.values()].some((owner) => !unchangedOwner(toProjectResource(owner), originalActors.get(owner.id)))
            || [...overlay.triggers.values()].some((owner) => !unchangedOwner(toProjectResource(owner), originalTriggers.get(owner.id)))) {
            projectError("RESOURCE_IN_USE", "Cannot verify new dependencies when a destructive scene transaction also creates or changes a surviving owner");
        }
        const retainedReference = (reference) => {
            if (reference.owner.sceneId !== overlay.scene.id)
                return true;
            if (!reference.reviewedContract)
                return false;
            // The final authored-argument scan cannot recover a hidden helper effect.
            // Retain it conservatively while its owner survives this transaction.
            if (reference.owner.resourceType === "actor")
                return overlay.actors.has(reference.owner.resourceId);
            if (reference.owner.resourceType === "trigger")
                return overlay.triggers.has(reference.owner.resourceId);
            return true;
        };
        for (const actorId of overlay.deletedActorIds) {
            const reference = indexedAccess.structuralReferences({ type: "actor", id: actorId })
                .find(retainedReference);
            if (reference) {
                projectError("RESOURCE_IN_USE", `Actor ${actorId} is still referenced by ${reference.resourcePath}`);
            }
        }
        for (const triggerId of overlay.deletedTriggerIds) {
            const reference = indexedAccess.structuralReferences({
                type: "trigger",
                id: triggerId,
                sceneId: overlay.scene.id,
            }).find(retainedReference);
            if (reference) {
                projectError("RESOURCE_IN_USE", `Trigger ${triggerId} is still referenced by ${reference.resourcePath}`);
            }
        }
        for (const variableId of overlay.deletedVariableIds) {
            const reference = indexedAccess.structuralReferences({ type: "variable", id: variableId })
                .find(retainedReference);
            if (reference) {
                projectError("RESOURCE_IN_USE", `Variable ${variableId} is still referenced by ${reference.resourcePath}`);
            }
        }
    }
    for (const resource of [overlay.scene, ...overlay.actors.values(), ...overlay.triggers.values()]) {
        owners.push({ sceneId: overlay.scene.id, resource: resource.value, path: resource.relativePath });
    }
    for (const owner of owners) {
        const references = collectEventReferences(owner.resource);
        for (const actorId of overlay.deletedActorIds) {
            if (references.actors.has(actorId))
                projectError("RESOURCE_IN_USE", `Actor ${actorId} is still referenced by ${owner.path}`);
        }
        for (const triggerId of overlay.deletedTriggerIds) {
            if (containsStructuralTriggerReference(owner.resource, triggerId)) {
                projectError("RESOURCE_IN_USE", `Trigger ${triggerId} is still referenced by ${owner.path}`);
            }
        }
        for (const variableId of overlay.deletedVariableIds) {
            if (references.variables.has(variableId))
                projectError("RESOURCE_IN_USE", `Variable ${variableId} is still referenced by ${owner.path}`);
        }
        if (owner.sceneId === overlay.scene.id) {
            for (const sceneId of references.scenes) {
                if (!overlay.snapshot.scenesById.has(sceneId))
                    projectError("SCENE_NOT_FOUND", `Script ${owner.path} references missing scene ${sceneId}`);
            }
        }
    }
}
async function restoreOriginalFile(projectRoot, staged) {
    if (staged.replacement) {
        await rollbackNativeReplacement(projectRoot, staged.relativePath, staged.replacement);
        return;
    }
    if (staged.createOnly && staged.createdIdentity) {
        await rollbackNativeImportFile(projectRoot, staged.relativePath, staged.createdIdentity);
        return;
    }
    if (staged.strictPath)
        await preparedPath(projectRoot, staged.relativePath);
    const currentlyExists = await projectPathExists(projectRoot, staged.absolutePath);
    if (staged.appliedDigest === null) {
        if (currentlyExists)
            projectError("TRANSACTION_RECOVERY_CONFLICT", `An external editor recreated ${staged.relativePath} during transaction rollback`);
    }
    else {
        if (!currentlyExists)
            projectError("TRANSACTION_RECOVERY_CONFLICT", `An external editor removed ${staged.relativePath} during transaction rollback`);
        const current = await readFile(staged.absolutePath);
        if (digest(current) !== staged.appliedDigest) {
            projectError("TRANSACTION_RECOVERY_CONFLICT", `An external editor changed ${staged.relativePath} during transaction rollback`);
        }
    }
    if (staged.before === null) {
        if (currentlyExists)
            await unlink(staged.absolutePath);
        return;
    }
    await writeProjectBytesAtomic(projectRoot, staged.absolutePath, staged.before);
}
async function verifyStagedBeforeImage(projectRoot, staged) {
    if (staged.beforeIdentity && staged.before) {
        const current = await readNativeImportSnapshot(projectRoot, staged.relativePath, staged.before.length);
        if (current.identity.dev !== staged.beforeIdentity.dev || current.identity.ino !== staged.beforeIdentity.ino
            || current.identity.sha256 !== staged.beforeIdentity.sha256 || current.identity.mode !== staged.beforeIdentity.mode || !current.bytes.equals(staged.before)) {
            projectError("STALE_PROJECT_REVISION", `Native import source changed: ${staged.relativePath}`);
        }
        return;
    }
    if (staged.strictPath)
        await preparedPath(projectRoot, staged.relativePath);
    const currentlyExists = await projectPathExists(projectRoot, staged.absolutePath);
    if (staged.before === null) {
        if (currentlyExists) {
            projectError("STALE_PROJECT_REVISION", `An external editor created ${staged.relativePath} during this scene transaction`);
        }
        return;
    }
    if (!currentlyExists) {
        projectError("STALE_PROJECT_REVISION", `An external editor removed ${staged.relativePath} during this scene transaction`);
    }
    await resolveProjectPath(projectRoot, staged.absolutePath, { mustExist: true });
    const current = await readFile(staged.absolutePath);
    if (!current.equals(staged.before)) {
        projectError("STALE_PROJECT_REVISION", `An external editor changed ${staged.relativePath} during this scene transaction`);
    }
}
async function withStagedResourceWriteLocks(projectRoot, staged, action) {
    const candidates = new Set();
    for (const entry of staged) {
        if (entry.before !== null) {
            await verifyStagedBeforeImage(projectRoot, entry);
            candidates.add(entry.absolutePath);
        }
        else if (/^project\/scenes\/[^/]+\/(?:actors|triggers)\//u.test(entry.relativePath)) {
            // New child files do not exist to lock; their existing scene owner coordinates direct creators.
            const sceneOwner = path.join(path.dirname(path.dirname(entry.absolutePath)), "scene.gbsres");
            if (await projectPathExists(projectRoot, sceneOwner))
                candidates.add(sceneOwner);
        }
    }
    const canonical = new Map();
    for (const candidate of candidates) {
        const identity = await resolveProjectPath(projectRoot, candidate, { mustExist: true });
        canonical.set(identity, candidate);
    }
    const owners = [...canonical.keys()].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    const acquire = (index) => index === owners.length
        ? action()
        : withProjectResourceWriteLock(projectRoot, canonical.get(owners[index]), () => acquire(index + 1));
    return acquire(0);
}
async function commitStagedFiles(snapshot, staged, indexedAccess, verifySemanticFreshness = false, dryRun = false, expectedSemanticGeneration) {
    const ordered = [...staged.values()].sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    return withStagedResourceWriteLocks(snapshot.projectRoot, ordered, () => commitLockedStagedFiles(snapshot, ordered, indexedAccess, verifySemanticFreshness, dryRun, expectedSemanticGeneration));
}
async function commitLockedStagedFiles(snapshot, ordered, indexedAccess, verifySemanticFreshness, dryRun, expectedSemanticGeneration) {
    const semanticGeneration = expectedSemanticGeneration ?? indexedAccess?.semanticGeneration;
    if (indexedAccess)
        await indexedAccess.strongRefresh();
    const verifiedRevision = indexedAccess?.revision ?? await projectRevision(snapshot.projectPath);
    if (verifiedRevision !== snapshot.revision) {
        projectError("STALE_PROJECT_REVISION", "The project changed while this scene transaction was being prepared");
    }
    if ((verifySemanticFreshness || expectedSemanticGeneration !== undefined) && indexedAccess && indexedAccess.semanticGeneration !== semanticGeneration) {
        projectError("STALE_PROJECT_REVISION", "Project event semantics changed while this native transaction was being prepared");
    }
    if (verifySemanticFreshness)
        assertCompleteDestructiveCoverage(indexedAccess);
    const applied = [];
    try {
        for (const entry of ordered) {
            await verifyStagedBeforeImage(snapshot.projectRoot, entry);
            if (dryRun)
                continue;
            if (entry.after === null) {
                if (entry.before === null)
                    continue;
                await resolveProjectPath(snapshot.projectRoot, entry.absolutePath, { mustExist: true });
                const status = await lstat(entry.absolutePath);
                if (status.isSymbolicLink())
                    projectError("UNSAFE_SYMLINK", `Refusing to remove symbolic link ${entry.relativePath}`);
                await unlink(entry.absolutePath);
                entry.appliedDigest = null;
            }
            else {
                const bytes = stagedBytes(entry.after);
                if (entry.before?.equals(bytes))
                    continue;
                if (entry.createOnly) {
                    await publishNativeImportFile(snapshot.projectRoot, entry.relativePath, bytes, identity => {
                        entry.createdIdentity = identity;
                        entry.appliedDigest = identity.sha256;
                        applied.push(entry);
                    });
                }
                else if (entry.preserveMode) {
                    await replaceNativeImportFile(snapshot.projectRoot, entry.relativePath, entry.before, entry.beforeIdentity, bytes, receipt => {
                        entry.replacement = receipt;
                        entry.appliedDigest = receipt.published.sha256;
                        applied.push(entry);
                    });
                }
                else {
                    await writeProjectBytesAtomic(snapshot.projectRoot, entry.absolutePath, bytes);
                    entry.appliedDigest = digest(bytes);
                }
            }
            if (!entry.createOnly && !entry.preserveMode)
                applied.push(entry);
        }
        if (!dryRun && indexedAccess && ordered.some(entry => entry.createOnly || entry.preserveMode)) {
            await indexedAccess.noteCommittedPaths(applied.map(entry => entry.absolutePath));
        }
        if (ordered.some(entry => entry.createOnly)) {
            const additions = applied.filter(entry => entry.createOnly).map(entry => entry.relativePath);
            const additiveOnly = ordered.every(entry => entry.createOnly || (entry.before !== null && entry.after !== null && entry.before.equals(stagedBytes(entry.after))));
            if (additiveOnly && await projectRevisionBeforeAdditions(snapshot.projectPath, additions) !== snapshot.revision) {
                projectError("STALE_PROJECT_REVISION", "The authored project changed during native import publication");
            }
            for (const entry of applied)
                if (entry.createdIdentity) {
                    const current = await readNativeImportSnapshot(snapshot.projectRoot, entry.relativePath, entry.createdIdentity.size);
                    if (current.identity.dev !== entry.createdIdentity.dev || current.identity.ino !== entry.createdIdentity.ino
                        || current.identity.sha256 !== entry.createdIdentity.sha256) {
                        projectError("STALE_PROJECT_REVISION", `A published native import output changed: ${entry.relativePath}`);
                    }
                }
        }
        // Paired source files may live outside the normal authored revision tree.
        for (const entry of ordered)
            if (entry.beforeIdentity && entry.before !== null && entry.after !== null
                && entry.before.equals(stagedBytes(entry.after)))
                await verifyStagedBeforeImage(snapshot.projectRoot, entry);
        for (const entry of applied)
            if (entry.preserveMode && entry.after !== null) {
                const bytes = stagedBytes(entry.after);
                const current = await readNativeImportSnapshot(snapshot.projectRoot, entry.relativePath, bytes.length);
                if (!entry.replacement || !current.bytes.equals(bytes) || current.identity.mode !== entry.replacement.published.mode
                    || current.identity.dev !== entry.replacement.published.dev || current.identity.ino !== entry.replacement.published.ino) {
                    projectError("STALE_PROJECT_REVISION", `A native update changed during publication: ${entry.relativePath}`);
                }
            }
        for (const entry of applied)
            if (entry.replacement)
                await finalizeNativeReplacement(snapshot.projectRoot, entry.replacement);
    }
    catch (error) {
        const publishedPaths = applied.map(entry => entry.relativePath);
        const rolledBackPaths = [], conflictedPaths = [], retainedPaths = [];
        const recoveryFailures = [];
        for (const entry of applied.reverse()) {
            try {
                await restoreOriginalFile(snapshot.projectRoot, entry);
                rolledBackPaths.push(entry.relativePath);
            }
            catch (recoveryError) {
                conflictedPaths.push(entry.relativePath);
                if (recoveryError instanceof NativeRecoveryConflict)
                    retainedPaths.push(...recoveryError.retainedPaths);
                recoveryFailures.push(`${entry.relativePath}: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`);
            }
        }
        if (ordered.some(entry => entry.createOnly || entry.preserveMode)) {
            if (recoveryFailures.length || error instanceof NativeRecoveryConflict)
                indexedAccess?.invalidate("Native import rollback conflicted with external changes");
            else if (indexedAccess && applied.length) {
                try {
                    await indexedAccess.noteCommittedPaths(applied.map(entry => entry.absolutePath));
                }
                catch {
                    indexedAccess.invalidate("Native import rollback could not refresh the index");
                }
            }
            const original = error instanceof NativeImportFileError ? error.originalCause : error;
            if (error instanceof NativeImportFileError)
                retainedPaths.push(...error.retainedPaths);
            if (error instanceof NativeRecoveryConflict) {
                retainedPaths.push(...error.retainedPaths);
                for (const entry of ordered)
                    if (entry.preserveMode && !conflictedPaths.includes(entry.relativePath))
                        conflictedPaths.push(entry.relativePath);
            }
            for (const entry of applied)
                if (entry.createdIdentity?.temporaryDirectory)
                    retainedPaths.push(path.relative(snapshot.projectRoot, entry.createdIdentity.temporaryDirectory).split(path.sep).join("/"));
            throw new ProjectTransactionError(recoveryFailures.length || error instanceof NativeRecoveryConflict ? "TRANSACTION_RECOVERY_CONFLICT" : original instanceof GameStudioProjectError ? original.code : "TRANSACTION_COMMIT_FAILED", original, {
                originalCause: { message: original instanceof Error ? original.message : String(original), ...(original instanceof GameStudioProjectError ? { code: original.code } : {}) },
                publishedPaths, rolledBackPaths, conflictedPaths, retainedPaths: [...new Set(retainedPaths)],
                ...(error instanceof NativeImportFileError ? { cleanupFailures: error.cleanupFailures } : {}),
            });
        }
        if (recoveryFailures.length > 0) {
            indexedAccess?.invalidate("Scene transaction rollback conflicted with external authored changes");
            projectError("TRANSACTION_RECOVERY_CONFLICT", `Scene transaction could not be safely rolled back: ${recoveryFailures.join("; ")}`);
        }
        if (indexedAccess && applied.length > 0) {
            try {
                await indexedAccess.noteCommittedPaths(applied.map((entry) => entry.absolutePath));
            }
            catch {
                indexedAccess.invalidate("Scene transaction rollback could not refresh touched authored resources");
            }
        }
        if (error instanceof GameStudioProjectError)
            throw error;
        projectError("TRANSACTION_COMMIT_FAILED", `Scene transaction was rolled back after a write failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
function normalizedPreparedPath(relativePath) {
    if (typeof relativePath !== "string" || relativePath.length === 0 || relativePath.includes("\u0000")
        || relativePath.includes("\\") || path.posix.isAbsolute(relativePath)
        || path.posix.normalize(relativePath) !== relativePath || relativePath === "."
        || relativePath === ".." || relativePath.startsWith("../")) {
        projectError("INVALID_RESOURCE_PATH", "Prepared file paths must be normalized, project-relative POSIX paths");
    }
    return relativePath;
}
/** A prepared output names one real path, never an alias through a project symlink. */
async function preparedPath(projectRoot, relativePath) {
    const normalized = normalizedPreparedPath(relativePath);
    const absolutePath = path.join(projectRoot, normalized);
    const resolved = await resolveProjectPath(projectRoot, absolutePath, { allowRoot: false });
    if (resolved !== absolutePath) {
        projectError("UNSAFE_SYMLINK", `Prepared resource ${relativePath} resolves through an aliased project path`);
    }
    let ancestor = projectRoot;
    const components = normalized.split("/");
    for (let index = 0; index < components.length; index++) {
        ancestor = path.join(ancestor, components[index]);
        let entry;
        try {
            entry = await lstat(ancestor);
        }
        catch (error) {
            if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
                break;
            throw error;
        }
        if (entry.isSymbolicLink())
            projectError("UNSAFE_SYMLINK", `Prepared resource ${relativePath} uses a symbolic link`);
        const final = index === components.length - 1;
        if (final ? !entry.isFile() : !entry.isDirectory()) {
            projectError("INVALID_RESOURCE_PATH", `Prepared resource ${relativePath} does not name a regular file or a new descendant`);
        }
        if (final)
            return { absolutePath, identity: `${entry.dev}:${entry.ino}` };
    }
    return { absolutePath };
}
async function addPreparedFile(snapshot, staged, identities, file) {
    if (!isObject(file) || (file.before !== null && !Buffer.isBuffer(file.before))
        || (file.after !== null && !Buffer.isBuffer(file.after) && !isObject(file.after))) {
        projectError("INVALID_INPUT", "Prepared files require exact before bytes and JSON, byte, or deleted after images");
    }
    if (file.createOnly !== undefined && (file.createOnly !== true || file.before !== null || file.after === null)) {
        projectError("INVALID_INPUT", "createOnly requires a new nonempty after image and no before image");
    }
    if (file.beforeIdentity && (file.before === null || !Buffer.isBuffer(file.after) || (!file.before.equals(file.after) && !file.preserveMode)
        || file.beforeIdentity.size !== file.before.length || file.beforeIdentity.sha256 !== digest(file.before))) {
        projectError("INVALID_INPUT", "A guarded native source must match its snapshot identity");
    }
    if (file.preserveMode && (!file.beforeIdentity || ![0o600, 0o644].includes(file.beforeIdentity.mode ?? -1)
        || file.before === null || !Buffer.isBuffer(file.after))) {
        projectError("INVALID_INPUT", "A mode-preserving native update requires a bound 0600 or 0644 regular file");
    }
    const relativePath = normalizedPreparedPath(file.relativePath);
    // Conservative case/Unicode alias rejection also keeps prepared output portable.
    const key = relativePath.normalize("NFC").toLowerCase();
    for (const existing of staged.keys()) {
        const other = existing.normalize("NFC").toLowerCase();
        if (key === other || key.startsWith(`${other}/`) || other.startsWith(`${key}/`)) {
            projectError("DUPLICATE_TRANSACTION_PATH", `Prepared resource ${relativePath} overlaps ${existing}`);
        }
    }
    const { absolutePath, identity } = await preparedPath(snapshot.projectRoot, relativePath);
    if (identity !== undefined) {
        if (identities.has(identity))
            projectError("DUPLICATE_TRANSACTION_PATH", `Prepared resource ${relativePath} aliases another output file`);
        identities.add(identity);
    }
    staged.set(relativePath, {
        relativePath,
        absolutePath,
        before: file.before === null ? null : Buffer.from(file.before),
        after: file.after === null ? null : stagedBytes(file.after),
        strictPath: true,
        ...(file.createOnly ? { createOnly: true } : {}),
        ...(file.beforeIdentity ? { beforeIdentity: { ...file.beforeIdentity } } : {}),
        ...(file.preserveMode ? { preserveMode: true } : {}),
    });
}
function withPreparedAssets(snapshot, newAssets, staged) {
    if (newAssets.length === 0)
        return snapshot;
    const assets = [...snapshot.inventory.assets];
    const assetsById = new Map(snapshot.assetsById);
    for (const asset of newAssets) {
        const id = requiredString(asset.id, "Prepared asset id");
        const resourcePath = normalizedPreparedPath(asset.resourcePath);
        const metadataPath = asset.metadataPath === null ? "" : normalizedPreparedPath(asset.metadataPath);
        if (assetsById.has(id) || assets.some((existing) => existing.resourcePath === resourcePath || existing.metadataPath === metadataPath)) {
            projectError("DUPLICATE_RESOURCE_ID", `Prepared asset ${id} must be a new additive native asset`);
        }
        const image = staged.get(resourcePath);
        const sidecar = staged.get(metadataPath);
        if (!image || !sidecar || image.before !== null || sidecar.before !== null
            || !Buffer.isBuffer(image.after) || !Buffer.isBuffer(sidecar.after)
            || metadataPath !== `${resourcePath}.gbsres` || !asset.hasMetadata) {
            projectError("INVALID_RESOURCE", `Prepared asset ${id} requires a new image and its native sidecar in this transaction`);
        }
        let metadata;
        try {
            metadata = JSON.parse(sidecar.after.toString("utf8"));
        }
        catch {
            projectError("INVALID_RESOURCE", `Prepared asset ${id} has invalid native sidecar JSON`);
        }
        if (!isObject(metadata) || metadata.id !== id || metadata._resourceType !== asset.type || metadata.filename !== asset.filename) {
            projectError("INVALID_RESOURCE", `Prepared asset ${id} does not match its native sidecar identity`);
        }
        const copied = structuredClone(asset);
        assets.push(copied);
        assetsById.set(id, copied);
    }
    return {
        ...snapshot,
        assetsById,
        counts: { ...snapshot.counts, assets: assets.length },
        inventory: { ...snapshot.inventory, assets, counts: { ...snapshot.inventory.counts, assets: assets.length } },
    };
}
/** Internal native-authoring adapter; callers own format-specific validation, not a public file-write API. */
export async function applyPreparedProjectTransaction(projectPath, input, prepare, indexedAccess) {
    assertIndexedProjectAccess(projectPath, indexedAccess);
    const expectedRevision = requiredString(input.expectedRevision, "Expected project revision");
    const initial = indexedAccess ? undefined : await discoverProject(projectPath);
    return withProjectMutation(indexedAccess?.projectRoot ?? initial.projectRoot, async () => {
        if (indexedAccess)
            await indexedAccess.strongRefresh();
        const snapshot = indexedAccess
            ? await indexedAccess.snapshot()
            : await loadProjectSnapshot(initial.projectPath);
        if (snapshot.inventory.format !== "distributed") {
            projectError("UNSUPPORTED_PROJECT_FORMAT", "Prepared native authoring transactions require a distributed native game project");
        }
        assertExpectedRevision(snapshot, expectedRevision);
        const preparedSemanticGeneration = indexedAccess?.semanticGeneration;
        const prepared = await prepare(snapshot);
        if (!Array.isArray(prepared.files))
            projectError("INVALID_INPUT", "A prepared transaction requires a file array");
        const staged = new Map();
        const identities = new Set();
        for (const file of prepared.files)
            await addPreparedFile(snapshot, staged, identities, file);
        let operationResults;
        let verifySemanticFreshness = false;
        if (prepared.sceneBatch !== undefined) {
            const { sceneId, operations, newAssets = [] } = prepared.sceneBatch;
            if (!Array.isArray(operations) || operations.length > MAX_BATCH_OPERATIONS || !Array.isArray(newAssets)) {
                projectError("INVALID_INPUT", `Prepared scene operations must contain at most ${MAX_BATCH_OPERATIONS} entries`);
            }
            const augmented = withPreparedAssets(snapshot, newAssets, staged);
            const overlay = await createOverlay(augmented, requiredString(sceneId, "Scene id"));
            operationResults = [];
            for (let index = 0; index < operations.length; index++) {
                operationResults.push(await applyOperation(overlay, operations[index], index));
            }
            validateFinalGraph(overlay, indexedAccess);
            verifySemanticFreshness = overlay.deletedActorIds.size > 0 || overlay.deletedTriggerIds.size > 0 || overlay.deletedVariableIds.size > 0;
            for (const file of overlay.staged.values())
                await addPreparedFile(snapshot, staged, identities, file);
        }
        const changed = [...staged.values()].filter((file) => file.after === null
            ? file.before !== null
            : !file.before?.equals(stagedBytes(file.after)));
        // Even an empty/no-op plan and a dry run must finish against current before images.
        await commitStagedFiles(snapshot, staged, indexedAccess, verifySemanticFreshness, input.dryRun === true, preparedSemanticGeneration);
        if (input.dryRun !== true && indexedAccess && changed.length > 0 && !changed.some(file => file.createOnly || file.preserveMode)) {
            await indexedAccess.noteCommittedPaths(changed.map((file) => file.absolutePath));
        }
        const revision = indexedAccess?.revision ?? await projectRevision(snapshot.projectPath);
        return {
            projectPath: snapshot.projectPath,
            projectRoot: snapshot.projectRoot,
            previousRevision: snapshot.revision,
            revision,
            revisionAlgorithm: PROJECT_REVISION_ALGORITHM,
            dryRun: input.dryRun === true,
            changedPaths: changed.map((file) => file.relativePath).sort((left, right) => left.localeCompare(right)),
            transactionGuarantee: "distributed-best-effort-rollback",
            ...(operationResults === undefined ? {} : { operationResults }),
            value: prepared.value,
        };
    });
}
function transactionResult(snapshot, sceneId, staged, operationResults, dryRun, revision) {
    return {
        projectPath: snapshot.projectPath,
        projectRoot: snapshot.projectRoot,
        sceneId,
        revision,
        revisionAlgorithm: PROJECT_REVISION_ALGORITHM,
        previousRevision: snapshot.revision,
        dryRun,
        changedPaths: [...staged.keys()].sort((left, right) => left.localeCompare(right)),
        operationResults,
        transactionGuarantee: snapshot.inventory.format === "legacy" ? "legacy-single-file-atomic" : "distributed-best-effort-rollback",
    };
}
export async function applySceneBatch(projectPath, input, indexedAccess) {
    assertIndexedProjectAccess(projectPath, indexedAccess);
    const sceneId = requiredString(input.sceneId, "Scene id");
    if (!Array.isArray(input.operations) || input.operations.length === 0 || input.operations.length > MAX_BATCH_OPERATIONS) {
        projectError("INVALID_INPUT", `Scene batch operations must contain between 1 and ${MAX_BATCH_OPERATIONS} entries`);
    }
    const initial = indexedAccess ? undefined : await loadProjectSnapshot(projectPath);
    return withProjectMutation(indexedAccess?.projectRoot ?? initial.projectRoot, async () => {
        if (indexedAccess)
            await indexedAccess.ensureFresh();
        const snapshot = indexedAccess
            ? await indexedAccess.snapshot()
            : await loadProjectSnapshot(initial.projectPath);
        assertExpectedRevision(snapshot, input.expectedRevision);
        const overlay = await createOverlay(snapshot, sceneId);
        const results = [];
        for (let index = 0; index < input.operations.length; index++) {
            const operation = input.operations[index];
            if (!operation)
                projectError("INVALID_BATCH_OPERATION", `Operation ${index} is missing`);
            try {
                results.push(await applyOperation(overlay, operation, index));
            }
            catch (error) {
                if (error instanceof GameStudioProjectError) {
                    throw new GameStudioProjectError(error.code, `Operation ${index} (${String(operation.type)}) failed: ${error.message}`, error.resourcePath);
                }
                throw error;
            }
        }
        validateFinalGraph(overlay, indexedAccess);
        if (input.dryRun)
            return transactionResult(snapshot, sceneId, overlay.staged, results, true, snapshot.revision);
        await commitStagedFiles(snapshot, overlay.staged, indexedAccess, overlay.deletedActorIds.size > 0 || overlay.deletedTriggerIds.size > 0 || overlay.deletedVariableIds.size > 0);
        if (indexedAccess)
            await indexedAccess.noteCommittedPaths([...overlay.staged.values()].map((entry) => entry.absolutePath));
        const revision = indexedAccess?.revision ?? await projectRevision(snapshot.projectPath);
        return transactionResult(snapshot, sceneId, overlay.staged, results, false, revision);
    });
}
async function pruneEmptySceneDirectories(projectRoot, relativePaths) {
    const candidates = new Set();
    for (const relativePath of relativePaths) {
        let current = path.dirname(path.join(projectRoot, relativePath));
        const scenesRoot = path.join(projectRoot, "project", "scenes");
        while (current !== scenesRoot && current.startsWith(`${scenesRoot}${path.sep}`)) {
            candidates.add(current);
            current = path.dirname(current);
        }
    }
    for (const candidate of [...candidates].sort((left, right) => right.length - left.length)) {
        try {
            await rmdir(candidate);
        }
        catch (error) {
            if (!isObject(error) || !["ENOENT", "ENOTEMPTY"].includes(String(error.code)))
                throw error;
        }
    }
}
export async function deleteScene(projectPath, input, indexedAccess) {
    assertIndexedProjectAccess(projectPath, indexedAccess);
    const sceneId = requiredString(input.sceneId, "Scene id");
    const initial = indexedAccess ? undefined : await loadProjectSnapshot(projectPath);
    return withProjectMutation(indexedAccess?.projectRoot ?? initial.projectRoot, async () => {
        if (indexedAccess)
            await indexedAccess.ensureFresh();
        const snapshot = indexedAccess
            ? await indexedAccess.snapshot()
            : await loadProjectSnapshot(initial.projectPath);
        assertExpectedRevision(snapshot, input.expectedRevision);
        const selected = findScene(snapshot, sceneId);
        if (snapshot.settings.startSceneId === sceneId) {
            projectError("RESOURCE_IN_USE", `Scene ${sceneId} is selected as the project start scene`);
        }
        assertCompleteDestructiveCoverage(indexedAccess);
        const references = indexedAccess
            ? indexedAccess.structuralReferences({ type: "scene", id: sceneId })
                .filter((reference) => reference.owner.sceneId !== sceneId)
                .map((reference) => reference.resourcePath)
            : allAuthoredOwners(snapshot)
                .filter((owner) => owner.sceneId !== sceneId && collectEventReferences(owner.resource).scenes.has(sceneId))
                .map((owner) => owner.path);
        if (references.length > 0) {
            const sample = references.slice(0, MAX_REFERENCE_SAMPLES).join(", ");
            projectError("RESOURCE_IN_USE", `Scene ${sceneId} is still referenced by ${sample}${references.length > MAX_REFERENCE_SAMPLES ? ", ..." : ""}`);
        }
        const overlay = await createOverlay(snapshot, sceneId);
        if (overlay.format === "legacy") {
            if (!overlay.descriptor)
                projectError("INVALID_RESOURCE", "Legacy scene deletion is missing its descriptor");
            overlay.descriptor.scenes = (Array.isArray(overlay.descriptor.scenes) ? overlay.descriptor.scenes : [])
                .filter((scene) => !isObject(scene) || scene.id !== sceneId);
            await markResource(overlay, overlay.scene, true);
        }
        else {
            for (const resource of [...overlay.actors.values(), ...overlay.triggers.values(), overlay.scene]) {
                await markResource(overlay, resource, true);
            }
        }
        const results = [{ index: 0, type: "scene.delete", resourceId: sceneId, resourcePath: selected.resourcePath }];
        if (input.dryRun)
            return transactionResult(snapshot, sceneId, overlay.staged, results, true, snapshot.revision);
        await commitStagedFiles(snapshot, overlay.staged, indexedAccess, true);
        if (overlay.format === "distributed")
            await pruneEmptySceneDirectories(snapshot.projectRoot, [...overlay.staged.keys()]);
        if (indexedAccess)
            await indexedAccess.noteCommittedPaths([...overlay.staged.values()].map((entry) => entry.absolutePath));
        const revision = indexedAccess?.revision ?? await projectRevision(snapshot.projectPath);
        return transactionResult(snapshot, sceneId, overlay.staged, results, false, revision);
    });
}
export const sceneInspect = inspectScene;
export const sceneDelete = deleteScene;
export const sceneApply = applySceneBatch;
//# sourceMappingURL=scene-batch.js.map