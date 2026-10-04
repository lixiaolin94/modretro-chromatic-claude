import path from "node:path";
import { assertDistributedOwnerIdentity, assertExpectedResourceRevision, assertLoadedResourceRevision, assertResourceNotReferenced, assertSafeResourceProperties, findLegacyProjectScene, findLegacySceneCollectionResource, findProjectScene, isJsonObject, legacyDescriptorScenes, mergeResourceObjects, removeProjectResource, rewriteLegacySceneCollection, validateResourceName, } from "./actors.js";
import { nextResourceIndex, projectPathExists, projectRelativePath, readProjectJsonWithRevision, resourceRevision, resourceSlug, stableResourceId, withProjectResourceWriteLock, writeProjectJsonAtomic, } from "./project-files.js";
import { GameStudioProjectError, inventoryProject, } from "./project.js";
import { explicitlyPatchedNativeScriptCoordinates, findInvalidNativeScriptEvent, } from "./native-script-events.js";
export function findSceneTrigger(scene, triggerId, access) {
    const trigger = access
        ? access.trigger(scene.id, triggerId)
        : scene.triggers.find((candidate) => candidate.id === triggerId);
    if (!trigger) {
        throw new GameStudioProjectError("TRIGGER_NOT_FOUND", `No trigger with id ${triggerId} exists in scene ${scene.id}`);
    }
    return trigger;
}
/** Shape verified against actual upstream distributed GB Studio trigger resources. */
export function createTriggerResource(input, id, index, slug) {
    return {
        _resourceType: "trigger",
        id,
        _index: index,
        symbol: `trigger_${slug}`,
        prefabId: "",
        name: validateResourceName(input.name, "Trigger name"),
        x: input.x,
        y: input.y,
        width: input.width ?? 1,
        height: input.height ?? 1,
        prefabScriptOverrides: {},
        script: [],
        leaveScript: [],
    };
}
export function mergeTriggerChanges(existing, input) {
    if (input.properties !== undefined) {
        if (!isJsonObject(input.properties)) {
            throw new GameStudioProjectError("INVALID_INPUT", "Trigger properties must be a JSON object");
        }
        assertSafeResourceProperties(input.properties, "Trigger properties");
    }
    const updates = { ...(input.properties ?? {}) };
    for (const field of ["name", "x", "y", "width", "height"]) {
        const value = input[field];
        if (value !== undefined)
            updates[field] = field === "name"
                ? validateResourceName(value, "Trigger name")
                : value;
    }
    return mergeResourceObjects(existing, updates);
}
export function validateTriggerResource(scene, trigger, previous, options = {}) {
    validateResourceName(trigger.name, "Trigger name");
    for (const key of ["x", "y", "width", "height"]) {
        const value = trigger[key];
        if (!Number.isSafeInteger(value)) {
            throw new GameStudioProjectError("INVALID_INPUT", `Trigger ${key} must be an integer`);
        }
        if ((key === "width" || key === "height") && (typeof value !== "number" || value < 1 || value > 255)) {
            throw new GameStudioProjectError("INVALID_INPUT", `Trigger ${key} must be an integer between 1 and 255`);
        }
    }
    const { x, y, width, height } = trigger;
    const sceneWidth = scene.width;
    const sceneHeight = scene.height;
    if (typeof sceneWidth !== "number" || !Number.isSafeInteger(sceneWidth) || sceneWidth < 1
        || typeof sceneHeight !== "number" || !Number.isSafeInteger(sceneHeight) || sceneHeight < 1) {
        throw new GameStudioProjectError("INVALID_RESOURCE", `Scene ${scene.id} has invalid dimensions`);
    }
    if (typeof x !== "number" || typeof y !== "number"
        || typeof width !== "number" || typeof height !== "number"
        || x < 0 || y < 0
        || x + width > sceneWidth || y + height > sceneHeight) {
        throw new GameStudioProjectError("TRIGGER_OUT_OF_BOUNDS", `Trigger ${String(trigger.id ?? trigger.name)} extends outside the ${sceneWidth} by ${sceneHeight} scene`);
    }
    for (const key of ["script", "leaveScript"]) {
        if (trigger[key] !== undefined && !Array.isArray(trigger[key])) {
            throw new GameStudioProjectError("INVALID_INPUT", `Trigger ${key} must be an event array`);
        }
    }
    const invalid = findInvalidNativeScriptEvent(trigger, previous, options);
    if (invalid)
        throw new GameStudioProjectError("INVALID_EVENT", invalid.message);
}
async function availableTriggerPath(root, parent, base) {
    for (let index = 1; index < 10_000; index++) {
        const slug = index === 1 ? base : `${base}_${index}`;
        const candidate = path.join(parent, `${slug}.gbsres`);
        if (!(await projectPathExists(root, candidate)))
            return { absolute: candidate, slug };
    }
    throw new GameStudioProjectError("RESOURCE_NAME_EXHAUSTED", `Could not choose a unique trigger resource path for ${base}`);
}
export async function inspectTrigger(projectPath, input, access) {
    if (access)
        await access.ensureFresh();
    const inventory = access ? undefined : await inventoryProject(projectPath);
    const context = access ?? inventory;
    const scene = findProjectScene(context, input.sceneId);
    const selected = findSceneTrigger(scene, input.triggerId, access);
    const target = path.resolve(context.projectRoot, selected.resourcePath);
    const format = inventory?.format ?? access.projectInspection().format;
    const loaded = await readProjectJsonWithRevision(context.projectRoot, target);
    if (format === "distributed")
        assertDistributedOwnerIdentity(loaded.json, "trigger", input.triggerId, scene.id);
    const trigger = format === "distributed"
        ? loaded.json
        : (() => {
            const currentScene = findLegacyProjectScene(loaded.json, selected.resourcePath, scene.id);
            const { resourcePath: _resourcePath, ...resource } = findSceneTrigger(currentScene, input.triggerId);
            return resource;
        })();
    return {
        projectPath: context.projectPath,
        projectRoot: context.projectRoot,
        sceneId: scene.id,
        resourcePath: selected.resourcePath,
        trigger,
        revision: loaded.revision,
    };
}
export async function createTrigger(projectPath, input, access) {
    validateResourceName(input.name, "Trigger name");
    if (input.properties !== undefined) {
        if (!isJsonObject(input.properties)) {
            throw new GameStudioProjectError("INVALID_INPUT", "Trigger properties must be a JSON object");
        }
        assertSafeResourceProperties(input.properties, "Trigger properties");
    }
    if (access)
        await access.ensureFresh();
    const inventory = access ? undefined : await inventoryProject(projectPath);
    const context = access ?? inventory;
    const scene = findProjectScene(context, input.sceneId);
    const sceneTarget = path.resolve(context.projectRoot, scene.resourcePath);
    const base = resourceSlug(input.name, "trigger");
    const format = inventory?.format ?? access.projectInspection().format;
    return withProjectResourceWriteLock(context.projectRoot, sceneTarget, async () => {
        const loaded = await readProjectJsonWithRevision(context.projectRoot, sceneTarget);
        assertLoadedResourceRevision(context.projectRoot, sceneTarget, loaded.revision, input.expectedRevision);
        if (format === "distributed" && loaded.json.id !== input.sceneId) {
            throw new GameStudioProjectError("SCENE_NOT_FOUND", `Scene ${input.sceneId} disappeared during update`);
        }
        if (format === "distributed" && access && typeof access.strongRefresh === "function")
            await access.strongRefresh();
        const distributedContext = format === "distributed" ? access ?? await inventoryProject(projectPath) : undefined;
        const ownerScene = distributedContext
            ? findProjectScene(distributedContext, input.sceneId)
            : findLegacyProjectScene(loaded.json, scene.resourcePath, input.sceneId);
        let slug = base;
        let target;
        if (format === "distributed") {
            const chosen = await availableTriggerPath(context.projectRoot, path.join(path.dirname(sceneTarget), "triggers"), base);
            slug = chosen.slug;
            target = chosen.absolute;
        }
        else {
            target = sceneTarget;
            let suffix = 1;
            while (ownerScene.triggers.some((trigger) => resourceSlug(trigger.name, "trigger") === slug)) {
                suffix += 1;
                slug = `${base}_${suffix}`;
            }
        }
        const id = input.id ?? stableResourceId(ownerScene.id, "trigger", slug);
        if (typeof id !== "string" || id.trim().length === 0) {
            throw new GameStudioProjectError("INVALID_INPUT", "Trigger id must be a non-empty string");
        }
        const duplicate = distributedContext
            ? ("resource" in distributedContext
                ? distributedContext.resource({ type: "trigger", id }) !== undefined
                : distributedContext.triggers.some((trigger) => trigger.id === id))
            : legacyDescriptorScenes(loaded.json, scene.resourcePath)
                .some((candidate) => candidate.triggers.some((trigger) => trigger.id === id));
        if (duplicate) {
            throw new GameStudioProjectError("DUPLICATE_RESOURCE_ID", `A trigger with id ${id} already exists`);
        }
        const trigger = mergeResourceObjects(createTriggerResource(input, id, nextResourceIndex(ownerScene.triggers), slug), input.properties ?? {});
        validateTriggerResource(ownerScene, trigger);
        const updated = format === "distributed" ? trigger : rewriteLegacySceneCollection({ descriptor: loaded.json }, ownerScene.id, "triggers", (resources) => [...resources, trigger]);
        await assertExpectedResourceRevision(context.projectRoot, sceneTarget, loaded.revision);
        await writeProjectJsonAtomic(context.projectRoot, target, updated);
        const revision = await resourceRevision(context.projectRoot, target);
        if (access)
            await access.noteCommittedPaths([target]);
        return {
            projectPath: context.projectPath,
            projectRoot: context.projectRoot,
            sceneId: ownerScene.id,
            resourcePath: projectRelativePath(context.projectRoot, target),
            trigger,
            revision,
        };
    });
}
export async function updateTrigger(projectPath, input, access) {
    if (access)
        await access.ensureFresh();
    const inventory = access ? undefined : await inventoryProject(projectPath);
    const context = access ?? inventory;
    const scene = findProjectScene(context, input.sceneId);
    const selected = findSceneTrigger(scene, input.triggerId, access);
    const target = path.resolve(context.projectRoot, selected.resourcePath);
    const format = inventory?.format ?? access.projectInspection().format;
    return withProjectResourceWriteLock(context.projectRoot, target, async () => {
        const loaded = await readProjectJsonWithRevision(context.projectRoot, target);
        assertLoadedResourceRevision(context.projectRoot, target, loaded.revision, input.expectedRevision);
        if (format === "distributed")
            assertDistributedOwnerIdentity(loaded.json, "trigger", input.triggerId, scene.id);
        const ownerScene = format === "distributed"
            ? scene
            : findLegacyProjectScene(loaded.json, selected.resourcePath, scene.id);
        const original = format === "distributed"
            ? loaded.json
            : findLegacySceneCollectionResource(loaded.json, scene.id, "triggers", input.triggerId);
        const trigger = mergeTriggerChanges(original, input);
        validateTriggerResource(ownerScene, trigger, original, {
            explicitlyPatchedCoordinates: explicitlyPatchedNativeScriptCoordinates(input.properties),
        });
        const updated = format === "distributed" ? trigger : rewriteLegacySceneCollection({ descriptor: loaded.json }, scene.id, "triggers", (resources) => resources.map((resource) => resource.id === input.triggerId ? trigger : resource));
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
            trigger,
            revision,
        };
    });
}
export async function deleteTrigger(projectPath, input, access) {
    if (access && typeof access.ensureFresh === "function")
        await access.ensureFresh();
    const inventory = access ? undefined : await inventoryProject(projectPath);
    const context = access ?? inventory;
    const scene = findProjectScene(context, input.sceneId);
    const trigger = findSceneTrigger(scene, input.triggerId, access);
    const target = path.resolve(context.projectRoot, trigger.resourcePath);
    return withProjectResourceWriteLock(context.projectRoot, target, async () => {
        const loaded = await readProjectJsonWithRevision(context.projectRoot, target);
        assertLoadedResourceRevision(context.projectRoot, target, loaded.revision, input.expectedRevision);
        if (access)
            await access.strongRefresh();
        if (access && !access.coverage.complete) {
            throw new GameStudioProjectError("RESOURCE_REFERENCED", `Cannot delete trigger ${trigger.id}: complete reference coverage could not be verified`, trigger.resourcePath);
        }
        const format = inventory?.format ?? access.projectInspection().format;
        if (format === "legacy")
            findLegacySceneCollectionResource(loaded.json, scene.id, "triggers", input.triggerId);
        else
            assertDistributedOwnerIdentity(loaded.json, "trigger", input.triggerId, scene.id);
        const references = format === "legacy"
            ? { scenes: legacyDescriptorScenes(loaded.json, trigger.resourcePath) }
            : access ?? await inventoryProject(projectPath);
        assertResourceNotReferenced(references, "trigger", trigger.id, scene.id);
        if (format === "distributed") {
            await assertExpectedResourceRevision(context.projectRoot, target, loaded.revision);
            await removeProjectResource(context.projectRoot, target);
        }
        else {
            const descriptor = rewriteLegacySceneCollection({ descriptor: loaded.json }, scene.id, "triggers", (resources) => resources.filter((resource) => resource.id !== trigger.id));
            await assertExpectedResourceRevision(context.projectRoot, target, loaded.revision);
            await writeProjectJsonAtomic(context.projectRoot, target, descriptor);
        }
        if (access)
            await access.noteCommittedPaths([target]);
        return {
            projectPath: context.projectPath,
            projectRoot: context.projectRoot,
            sceneId: scene.id,
            triggerId: trigger.id,
            resourcePath: trigger.resourcePath,
            deleted: true,
        };
    });
}
//# sourceMappingURL=triggers.js.map