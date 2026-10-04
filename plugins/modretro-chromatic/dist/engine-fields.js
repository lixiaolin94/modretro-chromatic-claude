import path from "node:path";
import { PROJECT_REVISION_ALGORITHM, } from "./project-access.js";
import { readProjectJsonWithRevision, resourceRevision, writeProjectJsonAtomic, } from "./project-files.js";
import { discoverProject, GameStudioProjectError, } from "./project.js";
export const MAX_ENGINE_FIELD_INSPECTION = 250;
export const MAX_ENGINE_FIELD_UPDATES = 100;
export const MAX_ENGINE_FIELD_STRING_LENGTH = 1_024;
const ENGINE_FIELD_RESOURCE_PATH = "project/engine_field_values.gbsres";
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertFieldIdentifier(id) {
    if (typeof id !== "string" || id.trim() !== id || id.length === 0 || id.length > 256) {
        throw new GameStudioProjectError("INVALID_INPUT", "Engine field IDs must contain between 1 and 256 non-padding characters");
    }
}
function fieldEntries(resource, legacy, filename) {
    if (!legacy && resource._resourceType !== "engineFieldValues") {
        throw new GameStudioProjectError("INVALID_RESOURCE", "Distributed engine field overrides must use the engineFieldValues resource type", filename);
    }
    if (legacy && resource.engineFieldValues === undefined)
        resource.engineFieldValues = [];
    if (!Array.isArray(resource.engineFieldValues) || !resource.engineFieldValues.every(isObject)) {
        throw new GameStudioProjectError("INVALID_RESOURCE", "Engine field metadata must contain an engineFieldValues array", filename);
    }
    const ids = new Set();
    for (const field of resource.engineFieldValues) {
        if (typeof field.id !== "string" || field.id.length === 0) {
            throw new GameStudioProjectError("INVALID_RESOURCE", "Every engine field override requires a nonempty string ID", filename);
        }
        if (ids.has(field.id)) {
            throw new GameStudioProjectError("INVALID_RESOURCE", `Engine field override ${field.id} appears more than once`, filename);
        }
        ids.add(field.id);
        if (field.value !== undefined && typeof field.value !== "string" && typeof field.value !== "number") {
            throw new GameStudioProjectError("INVALID_RESOURCE", `Engine field override ${field.id} must contain a string or number`, filename);
        }
        if (typeof field.value === "number" && !Number.isFinite(field.value)) {
            throw new GameStudioProjectError("INVALID_RESOURCE", `Engine field override ${field.id} must contain a finite number`, filename);
        }
    }
    return resource.engineFieldValues;
}
function assertIndexedProject(projectPath, access) {
    const requested = path.resolve(projectPath);
    if (requested !== access.projectPath && requested !== access.projectRoot) {
        throw new GameStudioProjectError("STALE_PROJECT", "Indexed project access does not belong to the requested native game project");
    }
    if (access.revisionAlgorithm !== PROJECT_REVISION_ALGORITHM) {
        throw new GameStudioProjectError("STALE_PROJECT", "Indexed project access uses an obsolete project revision algorithm");
    }
}
async function selectEngineFields(projectPath, access, authoritative = false) {
    if (access) {
        assertIndexedProject(projectPath, access);
        await access.ensureFresh();
    }
    const discovery = access ? undefined : await discoverProject(projectPath);
    const projectRoot = access?.projectRoot ?? discovery.projectRoot;
    const selectedProjectPath = access?.projectPath ?? discovery.projectPath;
    const legacy = (access ? access.projectInspection().format : discovery.format) === "legacy";
    const resourcePath = legacy ? path.basename(selectedProjectPath) : ENGINE_FIELD_RESOURCE_PATH;
    const filename = path.join(projectRoot, resourcePath);
    const cached = !authoritative ? access?.authoredFile?.(resourcePath) : undefined;
    const loaded = cached?.json
        ? { json: structuredClone(cached.json), revision: cached.sha256 }
        : await readProjectJsonWithRevision(projectRoot, filename);
    const resource = loaded.json;
    fieldEntries(resource, legacy, filename);
    return {
        projectPath: selectedProjectPath,
        projectRoot,
        resourcePath,
        filename,
        resource,
        revision: loaded.revision,
        legacy,
    };
}
function validateFieldUpdate(update, existing) {
    assertFieldIdentifier(update.id);
    if (typeof update.value !== "string" && typeof update.value !== "number") {
        throw new GameStudioProjectError("INVALID_INPUT", `Engine field ${update.id} must use a string or numeric value; checkbox values are numeric 0 or 1`);
    }
    if (typeof update.value === "string" && update.value.length > MAX_ENGINE_FIELD_STRING_LENGTH) {
        throw new GameStudioProjectError("INVALID_INPUT", `Engine field ${update.id} exceeds the ${MAX_ENGINE_FIELD_STRING_LENGTH}-character string limit`);
    }
    if (typeof update.value === "number" && (!Number.isFinite(update.value) || !Number.isSafeInteger(update.value))) {
        throw new GameStudioProjectError("INVALID_INPUT", `Engine field ${update.id} must use a finite safe integer`);
    }
    if (existing?.value !== undefined && typeof existing.value !== typeof update.value) {
        throw new GameStudioProjectError("INVALID_INPUT", `Engine field ${update.id} currently uses a ${typeof existing.value} value and cannot be replaced with a ${typeof update.value}`);
    }
    if ((update.id.startsWith("FEAT_") || existing?.type === "checkbox")
        && (typeof update.value !== "number" || (update.value !== 0 && update.value !== 1))) {
        throw new GameStudioProjectError("INVALID_INPUT", `Checkbox engine field ${update.id} must use numeric 0 or 1`);
    }
}
export async function inspectEngineFields(projectPath, input = {}, access) {
    const limit = input.limit ?? MAX_ENGINE_FIELD_INSPECTION;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ENGINE_FIELD_INSPECTION) {
        throw new GameStudioProjectError("INVALID_INPUT", `Engine field inspection limits must be between 1 and ${MAX_ENGINE_FIELD_INSPECTION}`);
    }
    if (input.fieldIds && input.fieldIds.length > MAX_ENGINE_FIELD_INSPECTION) {
        throw new GameStudioProjectError("INVALID_INPUT", `Engine field inspection accepts at most ${MAX_ENGINE_FIELD_INSPECTION} field IDs`);
    }
    const requested = input.fieldIds ? new Set(input.fieldIds) : undefined;
    if (requested && input.fieldIds) {
        for (const id of input.fieldIds)
            assertFieldIdentifier(id);
        if (requested.size !== input.fieldIds.length) {
            throw new GameStudioProjectError("INVALID_INPUT", "Engine field inspection IDs must not contain duplicates");
        }
    }
    const selected = await selectEngineFields(projectPath, access);
    const matching = fieldEntries(selected.resource, selected.legacy, selected.filename)
        .filter((field) => !requested || requested.has(field.id));
    const fields = structuredClone(matching.slice(0, limit));
    return {
        projectPath: selected.projectPath,
        projectRoot: selected.projectRoot,
        resourcePath: selected.resourcePath,
        fields,
        count: fields.length,
        total: matching.length,
        revision: selected.revision,
    };
}
export async function updateEngineFields(projectPath, input, access) {
    if (!Array.isArray(input.updates) || input.updates.length < 1 || input.updates.length > MAX_ENGINE_FIELD_UPDATES) {
        throw new GameStudioProjectError("INVALID_INPUT", `Engine field updates require between 1 and ${MAX_ENGINE_FIELD_UPDATES} entries`);
    }
    const selected = await selectEngineFields(projectPath, access, true);
    if (input.expectedRevision !== undefined && selected.revision !== input.expectedRevision) {
        throw new GameStudioProjectError("STALE_RESOURCE", "Engine field overrides changed before the requested edit", selected.filename);
    }
    const fields = fieldEntries(selected.resource, selected.legacy, selected.filename);
    const seen = new Set();
    const applied = [];
    for (const requestedUpdate of input.updates) {
        if (!isObject(requestedUpdate))
            throw new GameStudioProjectError("INVALID_INPUT", "Every engine field update must be an object");
        const update = requestedUpdate;
        assertFieldIdentifier(update.id);
        if (seen.has(update.id)) {
            throw new GameStudioProjectError("DUPLICATE_ENGINE_FIELD_ID", `Engine field ${update.id} appears more than once in the requested updates`);
        }
        seen.add(update.id);
        const existing = fields.find((field) => field.id === update.id);
        validateFieldUpdate(update, existing);
        if (existing)
            existing.value = update.value;
        else
            fields.push({ id: update.id, value: update.value });
        applied.push({ id: update.id, value: update.value, created: !existing });
    }
    await writeProjectJsonAtomic(selected.projectRoot, selected.filename, selected.resource);
    if (access)
        await access.noteCommittedPaths([selected.resourcePath]);
    const updated = access?.authoredFile?.(selected.resourcePath);
    return {
        projectPath: selected.projectPath,
        projectRoot: selected.projectRoot,
        resourcePath: selected.resourcePath,
        updates: applied,
        count: applied.length,
        previousRevision: selected.revision,
        revision: updated?.sha256 ?? await resourceRevision(selected.projectRoot, selected.filename),
    };
}
//# sourceMappingURL=engine-fields.js.map