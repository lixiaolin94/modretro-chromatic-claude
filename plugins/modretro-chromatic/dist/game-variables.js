import path from "node:path";
import { GameStudioProjectError, inventoryProject, } from "./project.js";
import { readProjectJson, resourceRevision, resourceSlug, writeProjectJsonAtomic, } from "./project-files.js";
// Match the stock editor's default choices without treating them as a metadata limit.
const MAXIMUM_AUTOMATIC_VARIABLE_ID = 511;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function assertVariableId(value) {
    const numericId = Number(value);
    // The official compiler normalizes global IDs with String(parseInt(id)).
    // Require an exact, lossless decimal identity; IDs are not VM memory offsets.
    if (!/^(?:0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(numericId) || String(numericId) !== value) {
        throw new GameStudioProjectError("INVALID_INPUT", "Variable ID must be a canonical nonnegative decimal string representable as a safe integer");
    }
}
function assertSymbol(value) {
    if (!/^var_[A-Za-z][A-Za-z0-9_]*$/.test(value) || FORBIDDEN_KEYS.has(value)) {
        throw new GameStudioProjectError("INVALID_INPUT", "Variable symbols must have the form var_<identifier>");
    }
}
function variableList(resource) {
    if (!Array.isArray(resource.variables) || !resource.variables.every(isObject)) {
        throw new GameStudioProjectError("INVALID_RESOURCE", "Project variable metadata must contain a variables array");
    }
    return resource.variables;
}
function validateVariableList(variables) {
    const ids = new Set();
    const symbols = new Set();
    for (const variable of variables) {
        if (typeof variable.id !== "string")
            throw new GameStudioProjectError("INVALID_RESOURCE", "Every project variable requires a string ID");
        assertVariableId(variable.id);
        if (ids.has(variable.id))
            throw new GameStudioProjectError("DUPLICATE_VARIABLE_ID", `Variable ID ${variable.id} already exists`);
        ids.add(variable.id);
        if (typeof variable.symbol === "string") {
            assertSymbol(variable.symbol);
            if (symbols.has(variable.symbol))
                throw new GameStudioProjectError("DUPLICATE_VARIABLE_SYMBOL", `Variable symbol ${variable.symbol} already exists`);
            symbols.add(variable.symbol);
        }
    }
}
function nextVariableId(variables) {
    const existing = new Set(variables.map((variable) => String(variable.id)));
    for (let candidate = 0; candidate <= MAXIMUM_AUTOMATIC_VARIABLE_ID; candidate++) {
        const id = String(candidate);
        if (!existing.has(id))
            return id;
    }
    throw new GameStudioProjectError("VARIABLE_LIMIT_EXCEEDED", "No free IDs remain in the editor's default 0–511 range; supply an explicit variableId");
}
function generatedSymbol(name, variables, exceptId) {
    const base = `var_${resourceSlug(name, "variable")}`;
    const occupied = new Set(variables.filter((variable) => variable.id !== exceptId).map((variable) => variable.symbol));
    if (!occupied.has(base))
        return base;
    for (let suffix = 2; suffix <= occupied.size + 1; suffix++) {
        const candidate = `${base}_${suffix}`;
        if (!occupied.has(candidate))
            return candidate;
    }
    throw new GameStudioProjectError("DUPLICATE_VARIABLE_SYMBOL", `Could not choose a unique symbol for ${name}`);
}
export function applyVariableUpdate(resource, input, options = {}) {
    if (!["upsert", "delete"].includes(input.action)) {
        throw new GameStudioProjectError("INVALID_INPUT", "Variable updates must use upsert or delete");
    }
    const cloned = structuredClone(resource);
    const variables = variableList(cloned);
    validateVariableList(variables);
    if (input.variableId !== undefined)
        assertVariableId(input.variableId);
    if (input.action === "delete") {
        if (input.variableId === undefined)
            throw new GameStudioProjectError("INVALID_INPUT", "Deleting a variable requires a variableId");
        const index = variables.findIndex((variable) => variable.id === input.variableId);
        const variable = variables[index];
        if (index < 0 || !variable)
            throw new GameStudioProjectError("VARIABLE_NOT_FOUND", `No variable with id ${input.variableId} exists`);
        if (options.referencedVariableIds?.has(input.variableId)) {
            throw new GameStudioProjectError("VARIABLE_IN_USE", `Variable ${input.variableId} is still referenced by a project script`);
        }
        variables.splice(index, 1);
        return { resource: cloned, variable, action: input.action, created: false };
    }
    const id = input.variableId ?? nextVariableId(variables);
    const index = variables.findIndex((variable) => variable.id === id);
    const existing = variables[index];
    const name = input.name === undefined ? typeof existing?.name === "string" ? existing.name : undefined : input.name.trim();
    if (!name)
        throw new GameStudioProjectError("INVALID_INPUT", "Creating or updating a variable requires a nonempty name");
    const symbol = input.symbol ?? (typeof existing?.symbol === "string" ? existing.symbol : generatedSymbol(name, variables, id));
    assertSymbol(symbol);
    if (variables.some((variable) => variable.id !== id && variable.symbol === symbol)) {
        throw new GameStudioProjectError("DUPLICATE_VARIABLE_SYMBOL", `Variable symbol ${symbol} already exists`);
    }
    const variable = { ...(existing ?? {}), id, name, symbol };
    if (existing)
        variables[index] = variable;
    else
        variables.push(variable);
    validateVariableList(variables);
    return { resource: cloned, variable, action: input.action, created: !existing };
}
async function selectVariables(projectPath, access) {
    if (access)
        await access.ensureFresh();
    const inventory = access ? undefined : await inventoryProject(projectPath);
    const projectRoot = access?.projectRoot ?? inventory.projectRoot;
    const selectedProjectPath = access?.projectPath ?? inventory.projectPath;
    const format = access ? access.projectInspection().format : inventory.format;
    const context = { projectPath: selectedProjectPath, projectRoot, ...(inventory ? { inventory } : {}) };
    if (format === "legacy") {
        const resource = await readProjectJson(projectRoot, selectedProjectPath);
        if (resource.variables === undefined)
            resource.variables = [];
        return { ...context, filename: selectedProjectPath, resourcePath: path.basename(selectedProjectPath), resource };
    }
    const resourcePath = "project/variables.gbsres";
    const filename = path.join(projectRoot, resourcePath);
    const resource = await readProjectJson(projectRoot, filename);
    if (resource._resourceType !== "variables") {
        throw new GameStudioProjectError("INVALID_RESOURCE", "Distributed variable metadata must use the variables resource type", filename);
    }
    return { ...context, filename, resourcePath, resource };
}
function collectReferences(value, references, parentKey) {
    if (Array.isArray(value)) {
        for (const child of value)
            collectReferences(child, references);
        return;
    }
    if (!isObject(value)) {
        if (typeof value === "string" && parentKey && /^(?:variable|variableId|vectorX|vectorY)$/.test(parentKey))
            references.add(value);
        return;
    }
    if (value.type === "variable" && typeof value.value === "string")
        references.add(value.value);
    for (const [key, child] of Object.entries(value))
        collectReferences(child, references, key);
}
function referencedVariableIds(inventory) {
    const references = new Set();
    for (const scene of inventory.scenes) {
        for (const resource of [scene, ...scene.actors, ...scene.triggers]) {
            for (const [key, value] of Object.entries(resource)) {
                if (/^(?:script|[A-Za-z][A-Za-z0-9]*Script)$/.test(key) && Array.isArray(value))
                    collectReferences(value, references);
            }
        }
    }
    return references;
}
export async function inspectVariables(projectPath, input = {}, access) {
    const selected = await selectVariables(projectPath, access);
    let variables = structuredClone(variableList(selected.resource));
    validateVariableList(variables);
    if (input.variableId !== undefined) {
        assertVariableId(input.variableId);
        if (access && !access.variable(input.variableId)) {
            throw new GameStudioProjectError("VARIABLE_NOT_FOUND", `No variable with id ${input.variableId} exists`);
        }
        const variable = variables.find((candidate) => candidate.id === input.variableId);
        if (!variable)
            throw new GameStudioProjectError("VARIABLE_NOT_FOUND", `No variable with id ${input.variableId} exists`);
        variables = [variable];
    }
    return {
        projectPath: selected.projectPath,
        projectRoot: selected.projectRoot,
        resourcePath: selected.resourcePath,
        variables,
        count: variables.length,
        revision: await resourceRevision(selected.projectRoot, selected.filename),
    };
}
export async function updateVariable(projectPath, input, access) {
    if (access && input.action === "delete")
        await access.strongRefresh();
    const selected = await selectVariables(projectPath, access);
    if (input.expectedRevision !== undefined && await resourceRevision(selected.projectRoot, selected.filename) !== input.expectedRevision) {
        throw new GameStudioProjectError("STALE_RESOURCE", "Project variables changed before the requested edit", selected.filename);
    }
    if (access &&
        input.action === "delete" &&
        !access.coverage.complete &&
        variableList(selected.resource).some((variable) => variable.id === input.variableId)) {
        throw new GameStudioProjectError("VARIABLE_IN_USE", `Cannot delete variable ${input.variableId}: complete reference coverage could not be verified`, selected.resourcePath);
    }
    let references;
    if (input.action === "delete") {
        if (access && input.variableId !== undefined) {
            const target = { type: "variable", id: input.variableId };
            references = access.effectiveReferences(target).length > 0 || access.structuralReferences(target).length > 0
                ? new Set([input.variableId])
                : new Set();
        }
        else if (!access) {
            references = referencedVariableIds(selected.inventory);
        }
    }
    const applied = applyVariableUpdate(selected.resource, input, {
        referencedVariableIds: references,
    });
    await writeProjectJsonAtomic(selected.projectRoot, selected.filename, applied.resource);
    if (access)
        await access.noteCommittedPaths([selected.resourcePath]);
    return {
        projectPath: selected.projectPath,
        projectRoot: selected.projectRoot,
        resourcePath: selected.resourcePath,
        variable: applied.variable,
        action: applied.action,
        created: applied.created,
        revision: await resourceRevision(selected.projectRoot, selected.filename),
    };
}
//# sourceMappingURL=game-variables.js.map