import path from "node:path";
import { GameStudioProjectError, inventoryProject, } from "./project.js";
import { readProjectJsonWithRevision, resourceRevision, withProjectResourceWriteLock, writeProjectJsonAtomic, } from "./project-files.js";
import { decodeResourceBytes, encodeResourceBytes, ResourceCodecError, } from "./resource-codec.js";
const MAXIMUM_SCENE_DIMENSION = 255;
const MAXIMUM_EDITS = 1_024;
const MAXIMUM_SAMPLES = 32;
const MAXIMUM_INSPECTION_CELLS = 4_096;
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function dimensions(scene) {
    const { width, height } = scene;
    if (typeof width !== "number" || typeof height !== "number" || !Number.isInteger(width) || !Number.isInteger(height)
        || width < 1 || height < 1 || width > MAXIMUM_SCENE_DIMENSION || height > MAXIMUM_SCENE_DIMENSION) {
        throw new GameStudioProjectError("INVALID_RESOURCE", "Scene collision dimensions must be integers between 1 and 255");
    }
    return { width, height, count: width * height };
}
function decodeCollisions(scene, resetInvalid = false) {
    const { count } = dimensions(scene);
    if (typeof scene.collisions !== "string") {
        if (resetInvalid)
            return new Uint8Array(count);
        throw new GameStudioProjectError("INVALID_COLLISIONS", "Scene collisions must use a native hexadecimal run-length string");
    }
    let decoded;
    try {
        decoded = decodeResourceBytes(scene.collisions, { maximumValues: count, allowImplicitZeroGrid: true });
    }
    catch (error) {
        if (resetInvalid && error instanceof ResourceCodecError)
            return new Uint8Array(count);
        if (error instanceof ResourceCodecError) {
            throw new GameStudioProjectError("INVALID_COLLISIONS", `Scene collisions could not be decoded: ${error.message}`);
        }
        throw error;
    }
    if (decoded.length === 0 && scene.collisions === "")
        return new Uint8Array(count);
    if (decoded.length > count) {
        if (resetInvalid)
            return new Uint8Array(count);
        throw new GameStudioProjectError("INVALID_COLLISIONS", "Scene collisions exceed the scene dimensions");
    }
    // Existing versions can legitimately omit a zero-filled trailing region.
    const cells = new Uint8Array(count);
    cells.set(decoded);
    return cells;
}
function validateBounds(x, y, width, height, sceneWidth, sceneHeight) {
    if (![x, y, width, height].every(Number.isInteger) || x < 0 || y < 0 || width < 1 || height < 1
        || x + width > sceneWidth || y + height > sceneHeight) {
        throw new GameStudioProjectError("COLLISION_OUT_OF_BOUNDS", "Collision coordinates and rectangle dimensions must fit within the scene");
    }
}
function validateEdit(edit, sceneWidth, sceneHeight) {
    if (!isObject(edit) || !["tile", "rectangle"].includes(edit.shape)) {
        throw new GameStudioProjectError("INVALID_INPUT", "Every collision edit must use tile or rectangle shape");
    }
    if (!Number.isInteger(edit.value) || edit.value < 0 || edit.value > 255) {
        throw new GameStudioProjectError("INVALID_INPUT", "Collision values must be integers between 0 and 255");
    }
    if (edit.operation !== undefined && !["replace", "or", "andNot"].includes(edit.operation)) {
        throw new GameStudioProjectError("INVALID_INPUT", "Collision operations must use replace, or, or andNot");
    }
    const width = edit.shape === "tile" ? 1 : edit.width ?? 1;
    const height = edit.shape === "tile" ? 1 : edit.height ?? 1;
    if (edit.shape === "tile" && ((edit.width !== undefined && edit.width !== 1) || (edit.height !== undefined && edit.height !== 1))) {
        throw new GameStudioProjectError("INVALID_INPUT", "A tile collision edit cannot specify dimensions larger than one");
    }
    validateBounds(edit.x, edit.y, width, height, sceneWidth, sceneHeight);
    return { width, height };
}
export function applyCollisionEdits(scene, input) {
    if (scene.id !== input.sceneId)
        throw new GameStudioProjectError("SCENE_NOT_FOUND", `No scene with id ${input.sceneId} exists`);
    if (!Array.isArray(input.edits) || input.edits.length < 1 || input.edits.length > MAXIMUM_EDITS) {
        throw new GameStudioProjectError("INVALID_INPUT", `Collision editing requires between 1 and ${MAXIMUM_EDITS} edits`);
    }
    const { width, height } = dimensions(scene);
    const cells = decodeCollisions(scene, input.resetInvalid);
    const original = Uint8Array.from(cells);
    for (const edit of input.edits) {
        const region = validateEdit(edit, width, height);
        for (let row = edit.y; row < edit.y + region.height; row++) {
            for (let column = edit.x; column < edit.x + region.width; column++) {
                const index = row * width + column;
                const previous = cells[index] ?? 0;
                cells[index] = edit.operation === "or"
                    ? previous | edit.value
                    : edit.operation === "andNot"
                        ? previous & (~edit.value & 0xff)
                        : edit.value;
            }
        }
    }
    let changed = 0;
    const samples = [];
    for (let index = 0; index < cells.length; index++) {
        const before = original[index] ?? 0;
        const after = cells[index] ?? 0;
        if (before === after)
            continue;
        changed++;
        if (samples.length < MAXIMUM_SAMPLES) {
            samples.push({ x: index % width, y: Math.floor(index / width), before, after });
        }
    }
    return {
        scene: { ...structuredClone(scene), collisions: encodeResourceBytes(cells) },
        changed,
        samples,
        width,
        height,
    };
}
async function locateScene(projectPath, sceneId, access) {
    if (typeof sceneId !== "string" || !sceneId)
        throw new GameStudioProjectError("INVALID_INPUT", "Collision operations require a sceneId");
    if (access)
        await access.ensureFresh();
    const completeInventory = access ? undefined : await inventoryProject(projectPath);
    const inventory = completeInventory ?? {
        projectPath: access.projectPath,
        projectRoot: access.projectRoot,
        format: access.projectInspection().format,
    };
    const selected = access
        ? access.scene(sceneId)
        : completeInventory.scenes.find((scene) => scene.id === sceneId);
    if (!selected)
        throw new GameStudioProjectError("SCENE_NOT_FOUND", `No scene with id ${sceneId} exists`);
    const filename = path.join(inventory.projectRoot, selected.resourcePath);
    return { inventory, selected, filename };
}
async function loadSelectedScene(location) {
    const { inventory, selected, filename } = location;
    const indexedLoad = await readProjectJsonWithRevision(inventory.projectRoot, filename);
    const loaded = indexedLoad.json;
    if (inventory.format === "distributed") {
        return { inventory, selected, filename, scene: loaded, revision: indexedLoad?.revision };
    }
    const scene = (Array.isArray(loaded.scenes) ? loaded.scenes : []).find((candidate) => isObject(candidate) && candidate.id === selected.id);
    if (!isObject(scene))
        throw new GameStudioProjectError("SCENE_NOT_FOUND", `Scene ${selected.id} disappeared during collision selection`);
    return { inventory, selected, filename, scene, descriptor: loaded, revision: indexedLoad?.revision };
}
async function selectScene(projectPath, sceneId, access) {
    return loadSelectedScene(await locateScene(projectPath, sceneId, access));
}
export async function inspectCollisions(projectPath, input, access) {
    const selected = await selectScene(projectPath, input.sceneId, access);
    const { width, height } = dimensions(selected.scene);
    const cells = decodeCollisions(selected.scene);
    const x = input.x ?? 0;
    const y = input.y ?? 0;
    const regionWidth = input.width ?? width - x;
    const regionHeight = input.height ?? height - y;
    validateBounds(x, y, regionWidth, regionHeight, width, height);
    const maximum = input.maxCells ?? MAXIMUM_INSPECTION_CELLS;
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > MAXIMUM_INSPECTION_CELLS || regionWidth * regionHeight > maximum) {
        throw new GameStudioProjectError("COLLISION_REGION_TOO_LARGE", `Collision inspection is limited to ${maximum} cells; request a smaller region`);
    }
    const region = [];
    let solidCount = 0;
    for (let row = y; row < y + regionHeight; row++) {
        for (let column = x; column < x + regionWidth; column++) {
            const value = cells[row * width + column] ?? 0;
            region.push(value);
            if (value !== 0)
                solidCount++;
        }
    }
    return {
        projectPath: selected.inventory.projectPath,
        projectRoot: selected.inventory.projectRoot,
        resourcePath: selected.selected.resourcePath,
        sceneId: selected.selected.id,
        width,
        height,
        x,
        y,
        regionWidth,
        regionHeight,
        cells: region,
        solidCount,
        implicitZeroGrid: selected.scene.collisions === "",
        revision: selected.revision ?? await resourceRevision(selected.inventory.projectRoot, selected.filename),
    };
}
export async function editCollisions(projectPath, input, access) {
    const located = await locateScene(projectPath, input.sceneId, access);
    return withProjectResourceWriteLock(located.inventory.projectRoot, located.filename, async () => {
        const selected = await loadSelectedScene(located);
        if (input.expectedRevision !== undefined && selected.revision !== input.expectedRevision) {
            throw new GameStudioProjectError("STALE_RESOURCE", "The scene changed before the requested collision edit", selected.filename);
        }
        const applied = applyCollisionEdits(selected.scene, input);
        let owner = applied.scene;
        if (selected.inventory.format === "legacy") {
            const descriptor = selected.descriptor;
            if (!descriptor)
                throw new GameStudioProjectError("INVALID_RESOURCE", "Legacy project descriptor is unavailable");
            const scenes = Array.isArray(descriptor.scenes) ? descriptor.scenes : [];
            owner = { ...descriptor, scenes: scenes.map((scene) => isObject(scene) && scene.id === input.sceneId ? applied.scene : scene) };
        }
        if (await resourceRevision(selected.inventory.projectRoot, selected.filename) !== selected.revision) {
            throw new GameStudioProjectError("STALE_RESOURCE", "The scene changed before the requested collision edit", selected.filename);
        }
        await writeProjectJsonAtomic(selected.inventory.projectRoot, selected.filename, owner);
        if (access)
            await access.noteCommittedPaths([selected.filename]);
        return {
            projectPath: selected.inventory.projectPath,
            projectRoot: selected.inventory.projectRoot,
            resourcePath: selected.selected.resourcePath,
            sceneId: selected.selected.id,
            changed: applied.changed,
            samples: applied.samples,
            width: applied.width,
            height: applied.height,
            revision: await resourceRevision(selected.inventory.projectRoot, selected.filename),
        };
    });
}
//# sourceMappingURL=collisions.js.map