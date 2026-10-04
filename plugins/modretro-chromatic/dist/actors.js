import { lstat, unlink } from "node:fs/promises";
import path from "node:path";
import { projectRelativePath, readProjectJsonWithRevision, resolveProjectPath, resourceRevision, stableResourceId, withProjectResourceWriteLock, writeProjectJsonAtomic, } from "./project-files.js";
import { GameStudioProjectError, inventoryProject, resolveNativeAssetIdentity, } from "./project.js";
import { explicitlyPatchedNativeScriptCoordinates, findInvalidNativeScriptEvent, } from "./native-script-events.js";
const UNSAFE_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const IMMUTABLE_KEYS = new Set(["id", "_resourceType", "_index", "symbol", "resourcePath"]);
const DIRECTIONS = new Set(["up", "down", "left", "right"]);
export function isJsonObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function validateResourceName(value, label) {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new GameStudioProjectError("INVALID_INPUT", `${label} must be a non-empty string`);
    }
    return value.trim();
}
/** Validate arrays too: a forbidden key must never be hidden inside an event. */
export function assertSafeResourceProperties(value, label, root = true) {
    if (Array.isArray(value)) {
        for (const child of value)
            assertSafeResourceProperties(child, label, false);
        return;
    }
    if (!isJsonObject(value))
        return;
    for (const [key, child] of Object.entries(value)) {
        if (UNSAFE_KEYS.has(key) || (root && IMMUTABLE_KEYS.has(key))) {
            throw new GameStudioProjectError("INVALID_PROPERTY", `${label} cannot modify reserved property ${key}`);
        }
        assertSafeResourceProperties(child, label, false);
    }
}
export function mergeResourceObjects(existing, changes) {
    const merged = { ...existing };
    for (const [key, value] of Object.entries(changes)) {
        const previous = merged[key];
        merged[key] = isJsonObject(previous) && isJsonObject(value)
            ? mergeResourceObjects(previous, value)
            : value;
    }
    return merged;
}
export function findProjectScene(inventory, sceneId) {
    const scene = "scene" in inventory
        ? inventory.scene(sceneId)
        : inventory.scenes.find((candidate) => candidate.id === sceneId);
    if (!scene) {
        throw new GameStudioProjectError("SCENE_NOT_FOUND", `No scene with id ${sceneId} exists in this project`);
    }
    return scene;
}
export function findSceneActor(scene, actorId, access) {
    const actor = access
        ? access.actor(scene.id, actorId)
        : scene.actors.find((candidate) => candidate.id === actorId);
    if (!actor) {
        throw new GameStudioProjectError("ACTOR_NOT_FOUND", `No actor with id ${actorId} exists in scene ${scene.id}`);
    }
    return actor;
}
/** Match the actual distributed actor shape and existing deterministic dialogue IDs. */
export function createActorResource(input, id, index, slug) {
    const script = [];
    if (input.dialogue !== undefined) {
        script.push({
            id: stableResourceId(id, "script", "0", "EVENT_TEXT"),
            command: "EVENT_TEXT",
            args: { text: input.dialogue, avatarId: "" },
            __type: "event",
        });
    }
    return {
        _resourceType: "actor",
        id,
        _index: index,
        symbol: `actor_${slug}`,
        prefabId: "",
        name: validateResourceName(input.name, "Actor name"),
        coordinateType: "tiles",
        x: input.x ?? 0,
        y: input.y ?? 0,
        frame: 0,
        animate: false,
        spriteSheetId: input.spriteSheetId ?? "",
        paletteId: "",
        direction: input.direction ?? "down",
        moveSpeed: 1,
        animSpeed: 15,
        isPinned: false,
        persistent: false,
        collisionGroup: "",
        collisionExtraFlags: [],
        prefabScriptOverrides: {},
        script,
        startScript: [],
        updateScript: [],
        hit1Script: [],
        hit2Script: [],
        hit3Script: [],
    };
}
export function mergeActorChanges(existing, input) {
    if (input.properties !== undefined) {
        if (!isJsonObject(input.properties)) {
            throw new GameStudioProjectError("INVALID_INPUT", "Actor properties must be a JSON object");
        }
        assertSafeResourceProperties(input.properties, "Actor properties");
    }
    const updates = { ...(input.properties ?? {}) };
    for (const field of ["name", "x", "y", "direction", "spriteSheetId"]) {
        const value = input[field];
        if (value !== undefined)
            updates[field] = field === "name"
                ? validateResourceName(value, "Actor name")
                : value;
    }
    return mergeResourceObjects(existing, updates);
}
/** Check the merged resource so `properties` cannot bypass coordinate/reference validation. */
export function validateActorResource(inventory, scene, actor, previous, options = {}) {
    validateResourceName(actor.name, "Actor name");
    const direction = actor.direction;
    if (direction !== undefined && (typeof direction !== "string" || !DIRECTIONS.has(direction))) {
        throw new GameStudioProjectError("INVALID_INPUT", "Actor direction must be up, down, left, or right");
    }
    const coordinateType = actor.coordinateType ?? "tiles";
    if (coordinateType !== "tiles" && coordinateType !== "pixels") {
        throw new GameStudioProjectError("INVALID_INPUT", "Actor coordinateType must be tiles or pixels");
    }
    const sceneWidth = scene.width;
    const sceneHeight = scene.height;
    const x = actor.x ?? 0;
    const y = actor.y ?? 0;
    if (!Number.isSafeInteger(x) || !Number.isSafeInteger(y)) {
        throw new GameStudioProjectError("INVALID_INPUT", "Actor x and y must be integer coordinates");
    }
    if (typeof sceneWidth !== "number" || !Number.isSafeInteger(sceneWidth) || sceneWidth < 1
        || typeof sceneHeight !== "number" || !Number.isSafeInteger(sceneHeight) || sceneHeight < 1) {
        throw new GameStudioProjectError("INVALID_RESOURCE", `Scene ${scene.id} has invalid dimensions`);
    }
    const spriteSheetId = actor.spriteSheetId ?? "";
    if (typeof spriteSheetId !== "string") {
        throw new GameStudioProjectError("INVALID_INPUT", "Actor spriteSheetId must be a string");
    }
    const candidate = spriteSheetId === "" ? undefined : resolveNativeAssetIdentity(inventory, spriteSheetId);
    const sprite = candidate?.type === "sprite" ? candidate : undefined;
    if (spriteSheetId !== "" && !sprite) {
        throw new GameStudioProjectError("SPRITE_NOT_FOUND", `Actor ${String(actor.id ?? actor.name)} references missing sprite ${spriteSheetId}`);
    }
    const unit = coordinateType === "pixels" ? 8 : 1;
    const boundsWidth = typeof sprite?.boundsWidth === "number" && sprite.boundsWidth > 0
        ? Math.ceil(sprite.boundsWidth / 8) * unit
        : unit;
    if (typeof x !== "number" || typeof y !== "number"
        || x < 0 || y < 0
        || x + boundsWidth > sceneWidth * unit
        || y >= sceneHeight * unit) {
        throw new GameStudioProjectError("ACTOR_OUT_OF_BOUNDS", `Actor ${String(actor.id ?? actor.name)} lies outside the ${sceneWidth} by ${sceneHeight} scene`);
    }
    for (const key of ["script", "startScript", "updateScript", "hit1Script", "hit2Script", "hit3Script"]) {
        if (actor[key] !== undefined && !Array.isArray(actor[key])) {
            throw new GameStudioProjectError("INVALID_INPUT", `Actor ${key} must be an event array`);
        }
    }
    const invalid = findInvalidNativeScriptEvent(actor, previous, options);
    if (invalid)
        throw new GameStudioProjectError("INVALID_EVENT", invalid.message);
}
export async function assertExpectedResourceRevision(root, target, expectedRevision) {
    const actualRevision = await resourceRevision(root, target);
    assertLoadedResourceRevision(root, target, actualRevision, expectedRevision);
    return actualRevision;
}
export function assertLoadedResourceRevision(root, target, actualRevision, expectedRevision) {
    if (expectedRevision !== undefined && actualRevision !== expectedRevision) {
        throw new GameStudioProjectError("REVISION_MISMATCH", `Resource changed since the expected revision: ${projectRelativePath(root, target)}`, target);
    }
}
export function legacyDescriptorScenes(descriptor, resourcePath) {
    const materialize = (resource) => ({
        ...resource,
        id: typeof resource.id === "string" ? resource.id : "",
        name: typeof resource.name === "string" ? resource.name : "",
        resourcePath,
    });
    return (Array.isArray(descriptor.scenes) ? descriptor.scenes : [])
        .filter(isJsonObject)
        .map((scene) => ({
        ...materialize(scene),
        actors: (Array.isArray(scene.actors) ? scene.actors : []).filter(isJsonObject).map(materialize),
        triggers: (Array.isArray(scene.triggers) ? scene.triggers : []).filter(isJsonObject).map(materialize),
    }));
}
export function findLegacyProjectScene(descriptor, resourcePath, sceneId) {
    const scene = legacyDescriptorScenes(descriptor, resourcePath).find((candidate) => candidate.id === sceneId);
    if (!scene)
        throw new GameStudioProjectError("SCENE_NOT_FOUND", `Scene ${sceneId} disappeared during update`);
    return scene;
}
export function findLegacySceneCollectionResource(descriptor, sceneId, kind, resourceId) {
    const scene = (Array.isArray(descriptor.scenes) ? descriptor.scenes : [])
        .find((candidate) => isJsonObject(candidate) && candidate.id === sceneId);
    if (!isJsonObject(scene))
        throw new GameStudioProjectError("SCENE_NOT_FOUND", `Scene ${sceneId} disappeared during update`);
    const resource = (Array.isArray(scene[kind]) ? scene[kind] : [])
        .find((candidate) => isJsonObject(candidate) && candidate.id === resourceId);
    if (!isJsonObject(resource)) {
        const name = kind === "actors" ? "actor" : "trigger";
        throw new GameStudioProjectError(kind === "actors" ? "ACTOR_NOT_FOUND" : "TRIGGER_NOT_FOUND", `No ${name} with id ${resourceId} exists in scene ${sceneId}`);
    }
    return resource;
}
export function assertDistributedOwnerIdentity(resource, kind, resourceId, sceneId) {
    if (resource.id !== resourceId) {
        throw new GameStudioProjectError(kind === "actor" ? "ACTOR_NOT_FOUND" : "TRIGGER_NOT_FOUND", `No ${kind} with id ${resourceId} exists in scene ${sceneId}`);
    }
}
export function rewriteLegacySceneCollection(inventory, sceneId, kind, transform) {
    const scenes = Array.isArray(inventory.descriptor.scenes)
        ? inventory.descriptor.scenes
        : [];
    let found = false;
    const rewritten = scenes.map((entry) => {
        if (!isJsonObject(entry) || entry.id !== sceneId)
            return entry;
        found = true;
        const resources = Array.isArray(entry[kind])
            ? entry[kind].filter(isJsonObject)
            : [];
        return { ...entry, [kind]: transform(resources) };
    });
    if (!found) {
        throw new GameStudioProjectError("SCENE_NOT_FOUND", `Scene ${sceneId} disappeared during update`);
    }
    return { ...inventory.descriptor, scenes: rewritten };
}
function containsReference(value, targetId, keys) {
    if (Array.isArray(value))
        return value.some((child) => containsReference(child, targetId, keys));
    if (!isJsonObject(value))
        return false;
    for (const [key, child] of Object.entries(value)) {
        if (keys.has(key)) {
            if (child === targetId)
                return true;
            if (Array.isArray(child) && child.includes(targetId))
                return true;
            if (isJsonObject(child) && (child.id === targetId || child.value === targetId))
                return true;
        }
        if (containsReference(child, targetId, keys))
            return true;
    }
    return false;
}
/** Never rewrite a different authored script just to make deleting a resource succeed. */
export function assertResourceNotReferenced(inventory, kind, targetId, sceneId) {
    if ("structuralReferences" in inventory) {
        const reference = inventory.structuralReferences({ type: kind, id: targetId, sceneId })
            .find((candidate) => candidate.owner.resourceId !== targetId);
        if (reference) {
            throw new GameStudioProjectError("RESOURCE_REFERENCED", `Cannot delete ${kind} ${targetId}: resource ${reference.owner.resourceId} still references it`, reference.owner.resourcePath);
        }
        return;
    }
    const keys = kind === "actor"
        ? new Set(["actorId", "actor", "actorIds", "targetActorId"])
        : new Set(["triggerId", "trigger", "triggerIds", "targetTriggerId"]);
    for (const scene of inventory.scenes) {
        const { actors: _actors, triggers: _triggers, ...sceneFields } = scene;
        const resources = [sceneFields, ...scene.actors, ...scene.triggers];
        for (const resource of resources) {
            if (resource.id === targetId)
                continue;
            if (containsReference(resource, targetId, keys)) {
                throw new GameStudioProjectError("RESOURCE_REFERENCED", `Cannot delete ${kind} ${targetId}: resource ${String(resource.id ?? scene.id)} still references it`, typeof resource.resourcePath === "string" ? resource.resourcePath : undefined);
            }
        }
    }
}
export async function removeProjectResource(root, candidate) {
    const absolute = path.isAbsolute(candidate) ? candidate : path.resolve(root, candidate);
    const initial = await lstat(absolute);
    if (initial.isSymbolicLink() || !initial.isFile()) {
        throw new GameStudioProjectError("UNSAFE_SYMLINK", `Refusing to delete a symbolic link or non-file native project resource: ${absolute}`, absolute);
    }
    const safePath = await resolveProjectPath(root, absolute, { mustExist: true, allowRoot: false });
    const confirmed = await lstat(absolute);
    if (confirmed.isSymbolicLink() || !confirmed.isFile() || safePath !== absolute) {
        throw new GameStudioProjectError("UNSAFE_SYMLINK", `Native project resource changed while preparing deletion: ${absolute}`, absolute);
    }
    await unlink(safePath);
}
export async function inspectActor(projectPath, input, access) {
    if (access)
        await access.ensureFresh();
    const inventory = access ? undefined : await inventoryProject(projectPath);
    const context = access ?? inventory;
    const scene = findProjectScene(context, input.sceneId);
    const selected = findSceneActor(scene, input.actorId, access);
    const target = path.resolve(context.projectRoot, selected.resourcePath);
    const format = inventory?.format ?? access.projectInspection().format;
    const loaded = await readProjectJsonWithRevision(context.projectRoot, target);
    if (format === "distributed")
        assertDistributedOwnerIdentity(loaded.json, "actor", input.actorId, scene.id);
    const actor = format === "distributed"
        ? loaded.json
        : (() => {
            const currentScene = findLegacyProjectScene(loaded.json, selected.resourcePath, scene.id);
            const { resourcePath: _resourcePath, ...resource } = findSceneActor(currentScene, input.actorId);
            return resource;
        })();
    return {
        projectPath: context.projectPath,
        projectRoot: context.projectRoot,
        sceneId: scene.id,
        resourcePath: selected.resourcePath,
        actor,
        revision: loaded.revision,
    };
}
export async function updateActor(projectPath, input, access) {
    if (access)
        await access.ensureFresh();
    const inventory = access ? undefined : await inventoryProject(projectPath);
    const context = access ?? inventory;
    const scene = findProjectScene(context, input.sceneId);
    const selected = findSceneActor(scene, input.actorId, access);
    const target = path.resolve(context.projectRoot, selected.resourcePath);
    const format = inventory?.format ?? access.projectInspection().format;
    return withProjectResourceWriteLock(context.projectRoot, target, async () => {
        const loaded = await readProjectJsonWithRevision(context.projectRoot, target);
        assertLoadedResourceRevision(context.projectRoot, target, loaded.revision, input.expectedRevision);
        if (format === "distributed")
            assertDistributedOwnerIdentity(loaded.json, "actor", input.actorId, scene.id);
        if (format === "legacy" && access && typeof access.strongRefresh === "function")
            await access.strongRefresh();
        const ownerScene = format === "distributed"
            ? scene
            : findLegacyProjectScene(loaded.json, selected.resourcePath, scene.id);
        const original = format === "distributed"
            ? loaded.json
            : findLegacySceneCollectionResource(loaded.json, scene.id, "actors", input.actorId);
        const actor = mergeActorChanges(original, input);
        const validationContext = format === "legacy" ? access ?? await inventoryProject(projectPath) : context;
        validateActorResource(validationContext, ownerScene, actor, original, {
            explicitlyPatchedCoordinates: explicitlyPatchedNativeScriptCoordinates(input.properties),
        });
        const updated = format === "distributed" ? actor : rewriteLegacySceneCollection({ descriptor: loaded.json }, scene.id, "actors", (resources) => resources.map((resource) => resource.id === input.actorId ? actor : resource));
        await assertExpectedResourceRevision(context.projectRoot, target, loaded.revision);
        await writeProjectJsonAtomic(context.projectRoot, target, updated);
        const revision = await resourceRevision(context.projectRoot, target);
        if (access)
            await access.noteCommittedPaths([target]);
        return {
            projectPath: context.projectPath,
            projectRoot: context.projectRoot,
            sceneId: scene.id,
            resourcePath: selected.resourcePath,
            actor,
            revision,
        };
    });
}
export async function deleteActor(projectPath, input, access) {
    if (access && typeof access.ensureFresh === "function")
        await access.ensureFresh();
    const inventory = access ? undefined : await inventoryProject(projectPath);
    const context = access ?? inventory;
    const scene = findProjectScene(context, input.sceneId);
    const actor = findSceneActor(scene, input.actorId, access);
    const target = path.resolve(context.projectRoot, actor.resourcePath);
    return withProjectResourceWriteLock(context.projectRoot, target, async () => {
        const loaded = await readProjectJsonWithRevision(context.projectRoot, target);
        assertLoadedResourceRevision(context.projectRoot, target, loaded.revision, input.expectedRevision);
        if (access)
            await access.strongRefresh();
        if (access && !access.coverage.complete) {
            throw new GameStudioProjectError("RESOURCE_REFERENCED", `Cannot delete actor ${actor.id}: complete reference coverage could not be verified`, actor.resourcePath);
        }
        const format = inventory?.format ?? access.projectInspection().format;
        if (format === "legacy")
            findLegacySceneCollectionResource(loaded.json, scene.id, "actors", input.actorId);
        else
            assertDistributedOwnerIdentity(loaded.json, "actor", input.actorId, scene.id);
        const references = format === "legacy"
            ? { scenes: legacyDescriptorScenes(loaded.json, actor.resourcePath) }
            : access ?? await inventoryProject(projectPath);
        assertResourceNotReferenced(references, "actor", actor.id, scene.id);
        if (format === "distributed") {
            await assertExpectedResourceRevision(context.projectRoot, target, loaded.revision);
            await removeProjectResource(context.projectRoot, target);
        }
        else {
            const descriptor = rewriteLegacySceneCollection({ descriptor: loaded.json }, scene.id, "actors", (resources) => resources.filter((resource) => resource.id !== actor.id));
            await assertExpectedResourceRevision(context.projectRoot, target, loaded.revision);
            await writeProjectJsonAtomic(context.projectRoot, target, descriptor);
        }
        if (access)
            await access.noteCommittedPaths([target]);
        return {
            projectPath: context.projectPath,
            projectRoot: context.projectRoot,
            sceneId: scene.id,
            actorId: actor.id,
            resourcePath: actor.resourcePath,
            deleted: true,
        };
    });
}
//# sourceMappingURL=actors.js.map