import { createHash } from "node:crypto";
import { readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { PROJECT_RESPONSE_LIMITS, } from "./project-access.js";
import { resolveProjectPath } from "./project-files.js";
import { inventoryProject } from "./project.js";
import { extractReviewedEvent, REVIEWED_CUSTOM_EVENTS, } from "./custom-event-dependencies.js";
const SCRIPT_KEY = /^(?:script|[A-Za-z][A-Za-z0-9]*Script)$/;
const FORMAL_VARIABLE = /^V\d+$/;
const LOCAL_VARIABLE = /^L\d+$/;
// Official native handler IDs from GB Studio 4.3.2 src/lib/events, captured
// statically so graph inspection never depends on or executes installed code.
const NATIVE_EVENT_COMMANDS = new Set(`
  EVENT_ACTOR_ACTIVATE EVENT_ACTOR_COLLISIONS_DISABLE EVENT_ACTOR_COLLISIONS_ENABLE
  EVENT_ACTOR_DEACTIVATE EVENT_ACTOR_EFFECTS EVENT_ACTOR_EMOTE
  EVENT_ACTOR_GET_DIRECTION EVENT_ACTOR_GET_POSITION EVENT_ACTOR_HIDE
  EVENT_ACTOR_INVOKE EVENT_ACTOR_MOVE_CANCEL EVENT_ACTOR_MOVE_RELATIVE
  EVENT_ACTOR_MOVE_TO EVENT_ACTOR_MOVE_TO_VALUE EVENT_ACTOR_PUSH
  EVENT_ACTOR_SET_ANIMATE EVENT_ACTOR_SET_ANIMATION_SPEED EVENT_ACTOR_SET_COLLISION_BOX
  EVENT_ACTOR_SET_DIRECTION EVENT_ACTOR_SET_FRAME EVENT_ACTOR_SET_FRAME_TO_VALUE
  EVENT_ACTOR_SET_MOVEMENT_SPEED EVENT_ACTOR_SET_POSITION EVENT_ACTOR_SET_POSITION_RELATIVE
  EVENT_ACTOR_SET_POSITION_TO_VALUE EVENT_ACTOR_SET_SPRITE EVENT_ACTOR_SET_STATE
  EVENT_ACTOR_SHOW EVENT_ACTOR_START_UPDATE EVENT_ACTOR_STOP_UPDATE
  EVENT_ADD_FLAGS EVENT_ADVENTURE_STATE_SET EVENT_AWAIT_INPUT
  EVENT_CALL_CUSTOM_EVENT EVENT_CAMERA_LOCK EVENT_CAMERA_MOVE_TO
  EVENT_CAMERA_PROPERTY_SET EVENT_CAMERA_SET_BOUNDS EVENT_CAMERA_SET_LOCK
  EVENT_CAMERA_SET_POSITION EVENT_CAMERA_SHAKE EVENT_CHOICE
  EVENT_CLEAR_DATA EVENT_CLEAR_FLAGS EVENT_COMMENT
  EVENT_DATA_TABLE EVENT_DEC_VALUE EVENT_DEFINE_LABEL
  EVENT_DIALOGUE_CLOSE_NONMODAL EVENT_ENGINE_FIELD_SET EVENT_ENGINE_FIELD_STORE
  EVENT_FADE_IN EVENT_FADE_OUT EVENT_GBVM_SCRIPT
  EVENT_GOTO_LABEL EVENT_GROUP EVENT_HIDE_SPRITES
  EVENT_IDLE EVENT_IF EVENT_IF_ACTOR_AT_POSITION
  EVENT_IF_ACTOR_DIRECTION EVENT_IF_ACTOR_DISTANCE_FROM_ACTOR EVENT_IF_ACTOR_RELATIVE_TO_ACTOR
  EVENT_IF_COLOR_SUPPORTED EVENT_IF_CURRENT_SCENE_IS EVENT_IF_DEVICE_GBA
  EVENT_IF_DEVICE_SGB EVENT_IF_ENGINE_FIELD EVENT_IF_ENGINE_FIELD_COMPARE
  EVENT_IF_EXPRESSION EVENT_IF_FALSE EVENT_IF_FLAGS_COMPARE
  EVENT_IF_INPUT EVENT_IF_SAVED_DATA EVENT_IF_TRUE
  EVENT_IF_VALUE EVENT_IF_VALUE_COMPARE EVENT_INC_VALUE
  EVENT_LAUNCH_PROJECTILE EVENT_LAUNCH_PROJECTILE_SLOT EVENT_LINK_CLOSE
  EVENT_LINK_HOST EVENT_LINK_JOIN EVENT_LINK_TRANSFER
  EVENT_LOAD_DATA EVENT_LOAD_PROJECTILE_SLOT EVENT_LOOP
  EVENT_LOOP_FOR EVENT_LOOP_WHILE EVENT_LOOP_WHILE_EXPRESSION
  EVENT_MENU EVENT_MUSIC_PLAY EVENT_MUSIC_STOP
  EVENT_MUTE_CHANNEL EVENT_OVERLAY_HIDE EVENT_OVERLAY_MOVE_TO
  EVENT_OVERLAY_SET_SCANLINE_CUTOFF EVENT_OVERLAY_SHOW EVENT_PALETTE_SET_BACKGROUND
  EVENT_PALETTE_SET_EMOTE EVENT_PALETTE_SET_SGB EVENT_PALETTE_SET_SPRITE
  EVENT_PALETTE_SET_UI EVENT_PEEK_DATA EVENT_PLATFORMER_STATE_SET
  EVENT_PLAYER_BOUNCE EVENT_PLAYER_SET_SPRITE EVENT_PRINT
  EVENT_RATE_LIMIT EVENT_REMOVE_ADVENTURE_CALLBACK_SCRIPT EVENT_REMOVE_INPUT_SCRIPT
  EVENT_REMOVE_PLATFORMER_CALLBACK_SCRIPT EVENT_REPLACE_TILE_XY EVENT_REPLACE_TILE_XY_SEQUENCE
  EVENT_RESET_VARIABLES EVENT_RNG_SEED EVENT_SAVE_DATA
  EVENT_SCENE_POP_ALL_STATE EVENT_SCENE_POP_STATE EVENT_SCENE_PUSH_STATE
  EVENT_SCENE_RESET_STATE EVENT_SCENE_UPDATE_PAUSE EVENT_SCENE_UPDATE_RESUME
  EVENT_SCRIPT_LOCK EVENT_SCRIPT_UNLOCK EVENT_SET_ADVENTURE_CALLBACK_SCRIPT
  EVENT_SET_DIALOGUE_FRAME EVENT_SET_FALSE EVENT_SET_FLAGS
  EVENT_SET_FONT EVENT_SET_INPUT_SCRIPT EVENT_SET_MUSIC_ROUTINE
  EVENT_SET_PLATFORMER_CALLBACK_SCRIPT EVENT_SET_SGB_COLOR_AREA EVENT_SET_TIMER_SCRIPT
  EVENT_SET_TRUE EVENT_SET_VALUE EVENT_SHOW_SPRITES
  EVENT_SOUND_PLAY_EFFECT EVENT_STOP EVENT_SWITCH
  EVENT_SWITCH_SCENE EVENT_TEXT EVENT_TEXT_DRAW
  EVENT_TEXT_SET_ANIMATION_SPEED EVENT_TEXT_SET_SOUND_EFFECT EVENT_THREAD_START
  EVENT_THREAD_STOP EVENT_TIMER_DISABLE EVENT_TIMER_RESTART
  EVENT_VARIABLE_MATH EVENT_VARIABLE_MATH_EVALUATE EVENT_WAIT
  EVENT_WEAPON_ATTACK
`.trim().split(/\s+/u));
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function nonempty(value) {
    return typeof value === "string" && value.length > 0 ? value : undefined;
}
function numberValue(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (isObject(value) && value.type === "number" && typeof value.value === "number")
        return value.value;
    return undefined;
}
function owner(resource, definitionPath) {
    return {
        ...(resource.sceneId === undefined ? {} : { sceneId: resource.sceneId }),
        resourceType: resource.type,
        resourceId: resource.id,
        resourcePath: resource.resourcePath,
        ...(definitionPath === undefined ? {} : { definitionPath }),
    };
}
function identity(resource) {
    return {
        type: resource.type,
        id: resource.id,
        ...(resource.sceneId === undefined ? {} : { sceneId: resource.sceneId }),
        resourcePath: resource.resourcePath,
    };
}
async function resourceFiles(root, directory) {
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    }
    catch (error) {
        if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT")
            return [];
        throw error;
    }
    const result = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
        if (entry.isSymbolicLink()) {
            // Resolve explicitly so an escaping plugin/resource link cannot be traversed.
            await resolveProjectPath(root, path.join(directory, entry.name), { mustExist: true });
            continue;
        }
        if (entry.isDirectory())
            result.push(...await resourceFiles(root, path.join(directory, entry.name)));
        else if (entry.isFile() && entry.name.endsWith(".gbsres"))
            result.push(path.join(directory, entry.name));
    }
    return result;
}
async function supplementalResources(root, options) {
    const result = [];
    const candidates = [];
    if (options.filesByPath) {
        for (const [candidate, file] of options.filesByPath) {
            if (candidate.endsWith(".gbsres") && file.json) {
                const relative = path.isAbsolute(candidate) ? path.relative(root, candidate) : candidate;
                candidates.push([relative.split(path.sep).join("/"), file.json]);
            }
        }
    }
    else {
        for (const directory of [
            "project/scripts", "project/customEvents", "project/prefabs/actors", "project/actorPrefabs",
            "project/prefabs/triggers", "project/triggerPrefabs", "plugins",
        ]) {
            for (const filename of await resourceFiles(root, path.join(root, directory))) {
                const safe = await resolveProjectPath(root, filename, { mustExist: true, allowRoot: false });
                let parsed;
                try {
                    parsed = JSON.parse(await readFile(safe, "utf8"));
                }
                catch {
                    continue;
                }
                if (isObject(parsed))
                    candidates.push([path.relative(root, safe).split(path.sep).join("/"), parsed]);
            }
        }
    }
    for (const [resourcePath, resource] of candidates) {
        const rawKind = resource._resourceType;
        const kind = rawKind === "customEvent" ? "script" : rawKind;
        if (kind !== "script" && kind !== "actorPrefab" && kind !== "triggerPrefab")
            continue;
        const id = nonempty(resource.id);
        if (id)
            result.push({ type: kind, id, resourcePath, resource });
    }
    return result;
}
async function indexedProjectEngineFields(root, files) {
    // loadEngineSchema reads this local base and plugins/**/engine/engine.json.
    // Project definitions are appended after the stock schema, so a unique,
    // enabled project declaration proves that the compiler has this key. A
    // stock-only key remains unproved here; graph inspection never runs a loader.
    if (!files)
        return undefined;
    const schemas = [...files].map(([name, file]) => [
        (path.isAbsolute(name) ? path.relative(root, name) : name).split(path.sep).join("/"), file,
    ]).filter(([name]) => name === "assets/engine/engine.json"
        || (/^plugins\/(?:[^/]+\/)*engine\/engine\.json$/.test(name)
            && name.split("/").every((part) => part && !part.startsWith("."))));
    if (schemas.length === 0 || schemas.length > 64)
        return undefined;
    const fields = [];
    try {
        for (const [name, file] of schemas) {
            if (!file.identity || file.identity.size > 1024n * 1024n)
                return undefined;
            const safe = await resolveProjectPath(root, name, { mustExist: true, allowRoot: false });
            const bytes = await readFile(safe);
            if (BigInt(bytes.length) !== file.identity.size
                || createHash("sha256").update(bytes).digest("hex") !== file.sha256)
                return undefined;
            const schema = JSON.parse(bytes.toString("utf8"));
            if (!isObject(schema))
                return undefined;
            if (schema.fields === undefined || schema.fields === null)
                continue;
            if (!Array.isArray(schema.fields) || !schema.fields.every(isObject))
                return undefined;
            fields.push(...schema.fields);
        }
    }
    catch {
        return undefined;
    }
    return fields;
}
export async function buildWorldScriptGraph(projectRoot, options = {}) {
    const registry = options.reviewedCustomEvents ?? REVIEWED_CUSTOM_EVENTS;
    const files = options.filesByPath && new Map([...options.filesByPath].map(([name, file]) => [
        (path.isAbsolute(name) ? path.relative(projectRoot, name) : name).split(path.sep).join("/"), file,
    ]));
    const resolution = registry.resolve(files, options.reviewedCompiler);
    const previous = options.previousGraph;
    const changes = options.changedPaths;
    if (previous && options.inventory && changes && changes.length > 0
        && (!files || !registry.needsDependencyRefresh(files, changes))
        && previous.customEventFingerprint === resolution.fingerprint
        && changes.every((candidate) => /^project\/scenes\/.+\/(?:actors|triggers)\/[^/]+\.gbsres$/.test(candidate))) {
        const changed = new Set(changes);
        const changedOwners = new Set(previous.nodes.filter((node) => node.resourcePath && changed.has(node.resourcePath)).map((node) => node.resourcePath));
        const currentOwners = new Set();
        for (const scene of options.inventory.scenes) {
            for (const resource of [...scene.actors, ...scene.triggers]) {
                if (changed.has(resource.resourcePath))
                    currentOwners.add(resource.resourcePath);
            }
        }
        // Existing owners preserve stable IDs. Additions and removals can change
        // opaque references authored elsewhere, so rebuild them conservatively.
        if (changed.size === changedOwners.size && changed.size === currentOwners.size) {
            const partial = await buildWorldScriptGraphInternal(projectRoot, options, resolution, changed);
            const staleReference = (reference) => changed.has(reference.owner.resourcePath)
                || ((reference.relation === "contains-actor" || reference.relation === "contains-trigger")
                    && reference.target.resourcePath !== undefined && changed.has(reference.target.resourcePath));
            const retainedLimitations = previous.coverage.limitations.filter((limitation) => !(limitation.owner && changed.has(limitation.owner.resourcePath))
                && !(limitation.resourcePath && changed.has(limitation.resourcePath)));
            const retainedNodes = previous.nodes.filter((node) => !node.resourcePath || !changed.has(node.resourcePath));
            const addedNodes = partial.nodes.filter((node) => node.resourcePath && changed.has(node.resourcePath));
            const limitations = [...retainedLimitations, ...partial.coverage.limitations];
            return {
                references: [...previous.references.filter((reference) => !staleReference(reference)), ...partial.references],
                structuralReferences: [
                    ...previous.structuralReferences.filter((reference) => !changed.has(reference.owner.resourcePath)),
                    ...partial.structuralReferences,
                ],
                nodes: [...retainedNodes, ...addedNodes],
                coverage: { complete: limitations.length === 0, limitations },
                customEventFingerprint: resolution.fingerprint,
            };
        }
    }
    return buildWorldScriptGraphInternal(projectRoot, options, resolution);
}
async function buildWorldScriptGraphInternal(projectRoot, options, resolution, ownerPaths) {
    const inventory = options.inventory ?? await inventoryProject(projectRoot);
    const root = inventory.projectRoot ?? await realpath(projectRoot);
    const engineFields = await indexedProjectEngineFields(root, options.filesByPath);
    const compilerResources = options.filesByPath && [...options.filesByPath]
        .map(([name, file]) => ({ path: (path.isAbsolute(name) ? path.relative(root, name) : name).split(path.sep).join("/"),
        type: file.json?._resourceType, id: file.json?.id }))
        .filter((file) => /^(?:project|assets|plugins)\/.+\.gbsres$/.test(file.path));
    const authored = [];
    const nodes = [];
    const references = [];
    const structuralReferences = [];
    const limitations = [];
    const reviewedEvents = new Map();
    const limitationKeys = new Set();
    const maxDepth = options.maxEventDepth ?? PROJECT_RESPONSE_LIMITS.eventNestingDepth;
    const maxCallDepth = options.maxCustomScriptDepth ?? PROJECT_RESPONSE_LIMITS.customScriptDepth;
    const maxEvents = options.maxEventsPerOwner ?? PROJECT_RESPONSE_LIMITS.eventsPerOwner;
    const supplemental = await supplementalResources(root, options);
    const scriptResources = new Map(supplemental.filter((resource) => resource.type === "script").map((resource) => [resource.id, resource]));
    const prefabs = new Map(supplemental.filter((resource) => resource.type === "actorPrefab" || resource.type === "triggerPrefab").map((resource) => [resource.id, resource]));
    const variablesPath = inventory.format === "legacy"
        ? path.basename(inventory.projectPath)
        : "project/variables.gbsres";
    let variables = inventory.format === "legacy"
        ? inventory.descriptor.variables
        : (options.filesByPath?.get(variablesPath) ?? options.filesByPath?.get(path.join(root, variablesPath)))?.json?.variables;
    if (variables === undefined && inventory.format !== "legacy" && !options.filesByPath) {
        try {
            const safe = await resolveProjectPath(root, variablesPath, { mustExist: true, allowRoot: false });
            variables = JSON.parse(await readFile(safe, "utf8")).variables;
        }
        catch {
            variables = [];
        }
    }
    const globalVariables = new Set((Array.isArray(variables) ? variables : []).filter(isObject).map((variable) => nonempty(variable.id)).filter((id) => id !== undefined));
    function limit(code, message, affected) {
        const key = `${code}:${affected?.resourcePath ?? ""}:${message}`;
        if (limitationKeys.has(key))
            return;
        limitationKeys.add(key);
        limitations.push({ code, message, ...(affected ? { resourcePath: affected.resourcePath, owner: affected } : {}) });
    }
    function addResource(type, resource, resourcePath, sceneId) {
        const id = nonempty(resource.id);
        if (!id)
            return undefined;
        const entry = { type, id, resourcePath, resource, ...(sceneId === undefined ? {} : { sceneId }) };
        authored.push(entry);
        nodes.push(identity(entry));
        return entry;
    }
    const settings = {
        type: "settings",
        id: "settings",
        resourcePath: inventory.format === "legacy" ? path.basename(inventory.projectPath) : "project/settings.gbsres",
        resource: inventory.settings,
    };
    authored.push(settings);
    nodes.push(identity(settings));
    for (const scene of inventory.scenes) {
        addResource("scene", scene, scene.resourcePath, scene.id);
        for (const actor of scene.actors)
            addResource("actor", actor, actor.resourcePath, scene.id);
        for (const trigger of scene.triggers)
            addResource("trigger", trigger, trigger.resourcePath, scene.id);
    }
    for (const palette of inventory.palettes)
        addResource("palette", palette, palette.resourcePath);
    for (const asset of inventory.assets)
        addResource("asset", asset, asset.resourcePath);
    for (const variable of Array.isArray(variables) ? variables.filter(isObject) : [])
        addResource("variable", variable, variablesPath);
    for (const resource of supplemental) {
        authored.push(resource);
        nodes.push(identity(resource));
    }
    const byType = new Map();
    const byId = new Map();
    const childrenByScene = new Map();
    for (const resource of authored) {
        let lookup = byType.get(resource.type);
        if (!lookup)
            byType.set(resource.type, lookup = new Map());
        if (!lookup.has(resource.id))
            lookup.set(resource.id, resource);
        const identities = byId.get(resource.id);
        if (identities)
            identities.push(resource);
        else
            byId.set(resource.id, [resource]);
        if (resource.sceneId && (resource.type === "actor" || resource.type === "trigger")) {
            const children = childrenByScene.get(resource.sceneId);
            if (children)
                children.push(resource);
            else
                childrenByScene.set(resource.sceneId, [resource]);
        }
    }
    function target(type, id, sceneId) {
        const resource = byType.get(type)?.get(id);
        return resource ? identity(resource) : { type, id, ...(sceneId === undefined ? {} : { sceneId }) };
    }
    function edge(source, destination, relation, provenance = "authored", event, access, extra) {
        references.push({
            owner: source,
            target: destination,
            relation,
            provenance,
            confidence: access === "unknown" || provenance === "heuristic" ? "partial" : "verified",
            ...(event ? { event } : {}),
            ...(access ? { access } : {}),
            ...extra,
        });
    }
    function structural(resource) {
        if (resource.type === "asset" || resource.type === "palette" || resource.type === "variable")
            return;
        const source = owner(resource);
        let count = 0;
        function walk(value, propertyPath, parentKey, variableUnion = false) {
            if (++count > maxEvents * 40) {
                limit("STRUCTURAL_SCAN_LIMIT", "Authored reference scan exceeded its bounded traversal limit", source);
                return;
            }
            if (propertyPath.length > maxDepth * 2) {
                limit("STRUCTURAL_DEPTH_LIMIT", "Authored reference nesting exceeded its bounded traversal depth", source);
                return;
            }
            if (Array.isArray(value)) {
                for (let index = 0; index < value.length; index++)
                    walk(value[index], [...propertyPath, index], parentKey, variableUnion);
                return;
            }
            if (isObject(value)) {
                const union = value.type === "variable";
                for (const [key, child] of Object.entries(value)) {
                    if (propertyPath.length === 0 && (key === "id" || key === "_resourceType" || key === "resourcePath" || key === "actors" || key === "triggers"))
                        continue;
                    if ((resource.type === "script") && propertyPath.length === 0 && (key === "variables" || key === "actors"))
                        continue;
                    walk(child, [...propertyPath, key], key, union && key === "value");
                }
                return;
            }
            if (typeof value !== "string" || !value)
                return;
            if (parentKey === "id" && !variableUnion)
                return;
            const variableField = variableUnion || /^(?:variable|variableId|vectorX|vectorY)$/i.test(parentKey ?? "") || /^\$variable\[V\d+\]\$$/.test(parentKey ?? "");
            for (const candidate of byId.get(value) ?? []) {
                if (candidate.type === "settings")
                    continue;
                if (candidate.type === "variable" && (!variableField || LOCAL_VARIABLE.test(value) || FORMAL_VARIABLE.test(value)))
                    continue;
                if (candidate.type !== "variable" && /^\d+$/.test(value))
                    continue;
                if ((candidate.type === "actor" || candidate.type === "trigger") && source.sceneId && candidate.sceneId && source.sceneId !== candidate.sceneId)
                    continue;
                structuralReferences.push({
                    owner: source,
                    target: identity(candidate),
                    relation: variableField ? "variable" : "authored-reference",
                    resourcePath: resource.resourcePath,
                    propertyPath,
                    confidence: variableField || /(?:Id|Ids|Palette|Sprites)$/i.test(parentKey ?? "") ? "verified" : "conservative",
                });
            }
        }
        walk(resource.resource, []);
    }
    function resolveVariable(raw, context, access) {
        const value = typeof raw === "string" ? raw : isObject(raw) && raw.type === "variable" ? nonempty(raw.value) : undefined;
        if (!value) {
            if (raw !== undefined)
                limit("UNRESOLVED_VARIABLE", "A variable expression cannot be resolved statically", context.owner);
            return undefined;
        }
        if (FORMAL_VARIABLE.test(value)) {
            const binding = context.variableBindings.get(value);
            if (!binding?.id) {
                limit("UNRESOLVED_FORMAL_VARIABLE", `Reusable-script variable ${value} cannot be resolved statically`, context.owner);
                return undefined;
            }
            // A by-value formal reads its caller argument once; writes stay private.
            if (!binding.byReference && (access === "write" || access === "read-write"))
                return undefined;
            return { id: binding.id, access: binding.byReference ? access : "read" };
        }
        if (LOCAL_VARIABLE.test(value))
            return { id: `${context.owner.resourceId}:${value}`, access };
        return { id: value, access };
    }
    function variable(raw, access, context, event, seen) {
        const resolved = resolveVariable(raw, context, access);
        if (!resolved)
            return false;
        const key = `${resolved.id}:${resolved.access}`;
        if (seen.has(key))
            return true;
        seen.add(key);
        const variableTarget = resolved.id.includes(":L")
            ? { type: "variable", id: resolved.id, sceneId: context.owner.sceneId }
            : target("variable", resolved.id);
        edge(context.owner, variableTarget, "variable", context.provenance, event, resolved.access);
        return true;
    }
    function actorReference(raw, context, event) {
        let value = nonempty(raw);
        if (!value || value === "player")
            return;
        if (value === "$self$")
            value = context.owner.resourceId;
        else if (context.actorBindings.has(value))
            value = context.actorBindings.get(value);
        if (!value) {
            limit("UNRESOLVED_ACTOR", "A reusable-script actor argument cannot be resolved statically", context.owner);
            return;
        }
        edge(context.owner, target("actor", value, context.owner.sceneId), "actor", context.provenance, event);
    }
    function expandCall(args, context, event) {
        const scriptId = nonempty(args.customEventId);
        if (!scriptId) {
            limit("UNRESOLVED_SHARED_SCRIPT", "Reusable script call has no statically known customEventId", context.owner);
            return;
        }
        edge(context.owner, target("script", scriptId), "calls-script", context.provenance, event);
        const script = scriptResources.get(scriptId);
        if (!script) {
            limit("MISSING_SHARED_SCRIPT", `Reusable script ${scriptId} was not found`, context.owner);
            return;
        }
        if (context.callStack.includes(scriptId)) {
            limit("RECURSIVE_SHARED_SCRIPT", `Reusable script ${scriptId} recursively invokes itself`, context.owner);
            return;
        }
        if (context.callStack.length >= maxCallDepth) {
            limit("SHARED_SCRIPT_DEPTH_LIMIT", "Reusable script calls exceeded their bounded expansion depth", context.owner);
            return;
        }
        const variableBindings = new Map();
        const formals = isObject(script.resource.variables) ? script.resource.variables : {};
        for (const [key, definition] of Object.entries(formals)) {
            if (!isObject(definition))
                continue;
            const formal = nonempty(definition.id) ?? key;
            const argument = args[`$variable[${formal}]$`] ?? args.$variable;
            const resolved = resolveVariable(argument, context, "read");
            if (!resolved) {
                limit("UNRESOLVED_FORMAL_BINDING", `Reusable script ${scriptId} argument ${formal} cannot be resolved`, context.owner);
                variableBindings.set(formal, { byReference: definition.passByReference !== false });
                continue;
            }
            variableBindings.set(formal, { id: resolved.id, byReference: definition.passByReference !== false });
            if (definition.passByReference === false) {
                edge(context.owner, target("variable", resolved.id), "variable", "expanded-shared-script", event, "read");
            }
        }
        const actorBindings = new Map();
        const actors = isObject(script.resource.actors) ? script.resource.actors : {};
        for (const [key, definition] of Object.entries(actors)) {
            const formal = isObject(definition) ? nonempty(definition.id) ?? key : key;
            const argument = args[`$actor[${formal}]$`];
            const value = nonempty(argument) ?? (isObject(argument) ? nonempty(argument.value) : undefined);
            if (value)
                actorBindings.set(formal, value === "$self$" ? context.owner.resourceId : value);
            else
                limit("UNRESOLVED_FORMAL_ACTOR", `Reusable script ${scriptId} actor ${formal} cannot be resolved`, context.owner);
        }
        const events = script.resource.script;
        if (!Array.isArray(events)) {
            limit("INVALID_SHARED_SCRIPT", `Reusable script ${scriptId} has no valid script events`, context.owner);
            return;
        }
        walkEvents(events, {
            ...context,
            owner: { ...context.owner, definitionPath: script.resourcePath },
            provenance: "expanded-shared-script",
            variableBindings,
            actorBindings,
            callStack: [...context.callStack, scriptId],
            depth: 0,
            overrides: undefined,
        });
    }
    function walkEvents(events, context) {
        if (context.depth > maxDepth) {
            limit("EVENT_DEPTH_LIMIT", "Script event nesting exceeded its bounded traversal depth", context.owner);
            return;
        }
        for (let index = 0; index < events.length; index++) {
            if (++context.counter.value > maxEvents) {
                limit("EVENT_COUNT_LIMIT", "Script owner exceeded its bounded event expansion count", context.owner);
                return;
            }
            const candidate = events[index];
            if (!isObject(candidate)) {
                limit("INVALID_EVENT", "Script contains an event that is not an object", context.owner);
                continue;
            }
            const eventId = nonempty(candidate.id);
            const command = nonempty(candidate.command);
            if (!eventId || !command) {
                limit("INVALID_EVENT", "Script event has no stable id or command", context.owner);
                continue;
            }
            let args = isObject(candidate.args) ? candidate.args : {};
            const override = context.overrides?.[eventId];
            if (isObject(override) && isObject(override.args))
                args = { ...args, ...override.args };
            if (args.__comment)
                continue;
            const event = { id: eventId, command, scriptKey: context.scriptKey, branchPath: context.branchPath };
            const seen = new Set();
            const reviewed = resolution.byCommand.get(command);
            if (reviewed) {
                const contract = reviewed.contract;
                const result = contract && extractReviewedEvent(contract, args, candidate.children, { owner: context.owner, inventory,
                    resourceFiles: compilerResources, event });
                if (contract && result?.status === "complete") {
                    const previousLimitations = limitations.length;
                    let targetsResolved = true;
                    for (const effect of result.effects) {
                        if (effect.kind === "variable") {
                            const formal = FORMAL_VARIABLE.test(effect.id) ? context.variableBindings.get(effect.id) : undefined;
                            const boundId = FORMAL_VARIABLE.test(effect.id) ? formal?.id : effect.id;
                            const local = LOCAL_VARIABLE.test(effect.id) || (boundId !== undefined && /:L\d+$/.test(boundId));
                            if (boundId !== undefined && !local && (!globalVariables.has(boundId)
                                || (byId.get(boundId) ?? []).filter((resource) => resource.type === "variable").length !== 1)) {
                                targetsResolved = false;
                                limit("UNRESOLVED_REVIEWED_VARIABLE", `Reviewed variable ${effect.id} is missing or ambiguous`, context.owner);
                            }
                            else {
                                // The caller's initial by-value read is already represented;
                                // writes to its private copy are not unresolved global effects.
                                if (formal?.id && !formal.byReference && effect.access !== "read")
                                    continue;
                                const before = references.length;
                                if (!variable(effect.id, effect.access, context, event, seen))
                                    targetsResolved = false;
                                const resolved = references[before];
                                if (resolved)
                                    structuralReferences.push({ owner: resolved.owner, target: resolved.target,
                                        relation: resolved.relation, resourcePath: contract.handler.path,
                                        propertyPath: ["reviewed-contract", contract.id, contract.version, eventId], confidence: "verified",
                                        reviewedContract: { id: contract.id, version: contract.version } });
                            }
                            continue;
                        }
                        if (effect.ownerId !== undefined) {
                            const owners = (byId.get(effect.ownerId) ?? []).filter((resource) => ["scene", "actor", "trigger", "script"].includes(resource.type));
                            if (owners.length !== 1 || owners[0].type !== "actor" || owners[0].sceneId !== effect.sceneId) {
                                targetsResolved = false;
                                limit("UNRESOLVED_REVIEWED_RESOURCE", "A native structural local has no unique actor owner", context.owner);
                                continue;
                            }
                            const destination = { type: "variable",
                                id: `${effect.ownerId}:${effect.id}`, sceneId: effect.sceneId };
                            edge(context.owner, destination, effect.relation, context.provenance, event);
                            structuralReferences.push({ owner: context.owner, target: destination,
                                relation: effect.relation, resourcePath: contract.handler.path,
                                propertyPath: ["reviewed-contract", contract.id, contract.version, eventId], confidence: "verified",
                                reviewedContract: { id: contract.id, version: contract.version } });
                            continue;
                        }
                        let id = effect.id;
                        if (effect.type === "actor") {
                            if (id === "$self$")
                                id = context.owner.resourceId;
                            else
                                id = context.actorBindings.get(id) ?? id;
                        }
                        const candidates = (byId.get(id) ?? []).filter((resource) => resource.type === effect.type
                            && (effect.sceneId === undefined || resource.sceneId === effect.sceneId)
                            && (effect.type !== "actor" || effect.sceneId !== undefined || resource.sceneId === context.owner.sceneId));
                        if (candidates.length !== 1) {
                            targetsResolved = false;
                            limit("UNRESOLVED_REVIEWED_RESOURCE", `Reviewed ${effect.type} ${id} is missing or ambiguous`, context.owner);
                            continue;
                        }
                        const destination = identity(candidates[0]);
                        edge(context.owner, destination, effect.relation, context.provenance, event);
                        // Hidden native/helper references must also protect native-output
                        // ownership; complete semantic coverage is not permission to erase them.
                        structuralReferences.push({ owner: context.owner, target: destination,
                            relation: effect.relation, resourcePath: contract.handler.path,
                            propertyPath: ["reviewed-contract", contract.id, contract.version, eventId], confidence: "verified",
                            reviewedContract: { id: contract.id, version: contract.version } });
                    }
                    if (targetsResolved && limitations.length === previousLimitations)
                        reviewedEvents.set(contract.id, {
                            id: contract.id, version: contract.version, command,
                            resolutionProfile: contract.resolutionProfile, handler: contract.handler, dependencies: contract.dependencies,
                            ...(contract.compilerProfile ? { compilerProfile: contract.compilerProfile.id,
                                compilerFingerprint: options.reviewedCompiler?.fingerprint } : {}),
                            ...(contract.compilerDependencies ? { compilerDependencies: contract.compilerDependencies } : {}),
                        });
                    const input = { ...args, ...candidate.children };
                    for (const branch of result.childBranches) {
                        walkEvents((input[branch] ?? []), {
                            ...context, branchPath: [...context.branchPath, { eventId, branch, index }], depth: context.depth + 1,
                        });
                    }
                    continue;
                }
                limit("UNVERIFIED_CUSTOM_EVENT_CONTRACT", `${command}: ${reviewed.reason ?? (result?.status === "incomplete" ? result.reason : "No reviewed effects")}`, context.owner);
                // Do not reinterpret an uncertain plugin override using the native
                // command's semantics. The separate structural scan still preserves
                // every authored reference, including opaque child branches.
                continue;
            }
            if (resolution.unreviewedExports.length && NATIVE_EVENT_COMMANDS.has(command)) {
                limit("UNVERIFIED_CUSTOM_EVENT_CONTRACT", `${command}: Unreviewed project event exports may replace this handler`, context.owner);
                continue;
            }
            switch (command) {
                case "EVENT_IF":
                    variable(args.variable, "read", context, event, seen);
                    if (isObject(args.condition) && args.condition.type === "variable")
                        variable(args.condition.value, "read", context, event, seen);
                    break;
                case "EVENT_SET_VALUE":
                case "EVENT_VARIABLE_SET":
                    variable(args.variable, "write", context, event, seen);
                    if (isObject(args.value) && args.value.type === "variable")
                        variable(args.value.value, "read", context, event, seen);
                    break;
                case "EVENT_INC_VALUE":
                case "EVENT_DEC_VALUE":
                    variable(args.variable, "read-write", context, event, seen);
                    break;
                case "EVENT_ENGINE_FIELD_STORE":
                    // The stock handler calls engineFieldStoreInVariable(key, value):
                    // value is the destination variable, not a script-value expression.
                    if (!nonempty(args.engineFieldKey) || !nonempty(args.value)) {
                        limit("UNRESOLVED_ENGINE_FIELD_STORE", "Engine-field capture requires an explicit field and destination variable", context.owner);
                    }
                    else {
                        const matches = engineFields?.filter((field) => field.key === args.engineFieldKey);
                        const field = matches?.length === 1 ? matches[0] : undefined;
                        const disabled = inventory.settings.disabledSceneTypeIds ?? [];
                        // compileData retains LOGO and used scene types, then filters fields
                        // by unused/disabled types before keyBy. A used type is sufficient
                        // even without consulting the stock schema; other types stay opaque.
                        const enabled = field && Array.isArray(disabled) && disabled.every((type) => typeof type === "string")
                            && (field.sceneType === undefined || field.sceneType === null || field.sceneType === ""
                                || (typeof field.sceneType === "string" && !disabled.includes(field.sceneType)
                                    && (field.sceneType === "LOGO" || inventory.scenes.some((scene) => scene.type === field.sceneType))));
                        if (!enabled) {
                            limit("UNRESOLVED_ENGINE_FIELD_STORE", "An enabled project engine-field definition could not be established", context.owner);
                        }
                        else
                            variable(args.value, "write", context, event, seen);
                    }
                    break;
                case "EVENT_SWITCH_SCENE": {
                    const sceneId = nonempty(args.sceneId);
                    if (sceneId) {
                        const x = numberValue(args.x);
                        const y = numberValue(args.y);
                        edge(context.owner, target("scene", sceneId), "transition", context.provenance, event, undefined, {
                            ...(x === undefined ? {} : { x }),
                            ...(y === undefined ? {} : { y }),
                        });
                    }
                    else
                        limit("UNRESOLVED_SCENE_TRANSITION", "Scene transition destination cannot be resolved statically", context.owner);
                    break;
                }
                case "EVENT_ACTOR_GET_POSITION":
                    actorReference(args.actorId, context, event);
                    variable(args.vectorX ?? args.variableX, "write", context, event, seen);
                    variable(args.vectorY ?? args.variableY, "write", context, event, seen);
                    break;
                case "EVENT_RESET_VARIABLES":
                    for (const id of globalVariables)
                        variable(id, "write", context, event, seen);
                    break;
                case "EVENT_CALL_CUSTOM_EVENT":
                    expandCall(args, context, event);
                    break;
                case "EVENT_TEXT": {
                    const values = Array.isArray(args.text) ? args.text.filter((value) => typeof value === "string") : typeof args.text === "string" ? [args.text] : [];
                    if (values.length > 0)
                        edge(context.owner, target(context.owner.resourceType, context.owner.resourceId, context.owner.sceneId), "dialogue", context.provenance, event, undefined, { text: values.join("\n") });
                    break;
                }
                default:
                    if (!NATIVE_EVENT_COMMANDS.has(command)) {
                        limit("UNKNOWN_CUSTOM_COMMAND", `Custom command ${command} has unverified runtime semantics`, context.owner);
                        for (const [key, value] of Object.entries(args)) {
                            if (/^(?:variable|variableId|vectorX|vectorY)$/.test(key))
                                variable(value, "unknown", { ...context, provenance: "heuristic" }, event, seen);
                        }
                    }
                    break;
            }
            if (command !== "EVENT_ACTOR_GET_POSITION") {
                for (const key of ["actorId", "otherActorId", "targetActorId"])
                    if (key in args)
                        actorReference(args[key], context, event);
            }
            for (const key of ["spriteSheetId", "spriteId", "playerSpriteSheetId"]) {
                const sprite = nonempty(args[key]);
                if (sprite)
                    edge(context.owner, target("asset", sprite), "sprite", context.provenance, event);
            }
            // Call events can carry GB Studio's editor-only inline preview; the indexed
            // reusable script is authoritative and must not be counted a second time.
            if (command === "EVENT_CALL_CUSTOM_EVENT")
                continue;
            if (candidate.children !== undefined && !isObject(candidate.children)) {
                limit("INVALID_EVENT_CHILDREN", `Event ${eventId} has malformed child branches`, context.owner);
                continue;
            }
            if (isObject(candidate.children)) {
                for (const [branch, children] of Object.entries(candidate.children)) {
                    if (!Array.isArray(children)) {
                        limit("INVALID_EVENT_BRANCH", `Event ${eventId} has malformed ${branch} branch`, context.owner);
                        continue;
                    }
                    walkEvents(children, {
                        ...context,
                        branchPath: [...context.branchPath, { eventId, branch, index }],
                        depth: context.depth + 1,
                    });
                }
            }
        }
    }
    function scriptOwner(resource) {
        options.onOwnerWalk?.(owner(resource));
        const prefabId = nonempty(resource.resource.prefabId);
        const expectedType = resource.type === "actor" ? "actorPrefab" : resource.type === "trigger" ? "triggerPrefab" : undefined;
        const prefab = prefabId && expectedType ? prefabs.get(prefabId) : undefined;
        if (prefabId && expectedType) {
            edge(owner(resource), target(expectedType, prefabId), "prefab");
            if (!prefab || prefab.type !== expectedType)
                limit("MISSING_PREFAB", `Prefab ${prefabId} was not found for ${resource.type} ${resource.id}`, owner(resource));
        }
        const effective = prefab && prefab.type === expectedType ? prefab : resource;
        const effectiveOwner = owner(resource, effective !== resource ? effective.resourcePath : undefined);
        const provenance = effective !== resource ? "effective-prefab" : "authored";
        const counter = { value: 0 };
        if (resource.type === "actor") {
            const spriteId = nonempty(effective.resource.spriteSheetId) ?? nonempty(resource.resource.spriteSheetId);
            if (spriteId)
                edge(effectiveOwner, target("asset", spriteId), "sprite", provenance);
            const paletteId = nonempty(effective.resource.paletteId) ?? nonempty(resource.resource.paletteId);
            if (paletteId)
                edge(effectiveOwner, target("palette", paletteId), "palette", provenance);
        }
        for (const [scriptKey, events] of Object.entries(effective.resource)) {
            if (!SCRIPT_KEY.test(scriptKey) || !Array.isArray(events))
                continue;
            walkEvents(events, {
                owner: effectiveOwner,
                scriptKey,
                branchPath: [],
                provenance,
                variableBindings: new Map(),
                actorBindings: new Map(),
                callStack: [],
                depth: 0,
                counter,
                ...(effective !== resource && isObject(resource.resource.prefabScriptOverrides) ? { overrides: resource.resource.prefabScriptOverrides } : {}),
            });
        }
    }
    const players = isObject(settings.resource.defaultPlayerSprites) ? settings.resource.defaultPlayerSprites : {};
    if (!ownerPaths) {
        const settingsOwner = owner(settings);
        const startScene = nonempty(settings.resource.startSceneId);
        if (startScene)
            edge(settingsOwner, target("scene", startScene), "start-scene");
        const font = nonempty(settings.resource.defaultFontId);
        if (font)
            edge(settingsOwner, target("asset", font), "font");
        for (const sprite of new Set(Object.values(players).map(nonempty).filter((value) => value !== undefined)))
            edge(settingsOwner, target("asset", sprite), "sprite");
        for (const key of ["defaultBackgroundPaletteIds", "defaultSpritePaletteIds"]) {
            const ids = settings.resource[key];
            if (Array.isArray(ids))
                for (const palette of new Set(ids.map(nonempty).filter((value) => value !== undefined)))
                    edge(settingsOwner, target("palette", palette), "palette");
        }
        for (const key of ["defaultSpritePaletteId", "defaultUIPaletteId", "playerPaletteId"]) {
            const palette = nonempty(settings.resource[key]);
            if (palette)
                edge(settingsOwner, target("palette", palette), "palette");
        }
    }
    for (const scene of byType.get("scene")?.values() ?? []) {
        const sceneOwner = owner(scene);
        for (const child of childrenByScene.get(scene.id) ?? []) {
            if (ownerPaths && !ownerPaths.has(child.resourcePath))
                continue;
            edge(sceneOwner, identity(child), child.type === "actor" ? "contains-actor" : "contains-trigger");
        }
        if (ownerPaths)
            continue;
        const background = nonempty(scene.resource.backgroundId);
        if (background)
            edge(sceneOwner, target("asset", background), "background");
        const scenePlayer = nonempty(scene.resource.playerSpriteSheetId);
        const inheritedPlayer = nonempty(players[nonempty(scene.resource.type) ?? ""]);
        if (scenePlayer ?? inheritedPlayer)
            edge(sceneOwner, target("asset", (scenePlayer ?? inheritedPlayer)), "sprite", scenePlayer ? "authored" : "inherited-setting");
        const paletteKeys = [
            ["paletteIds", "defaultBackgroundPaletteIds"],
            ["spritePaletteIds", "defaultSpritePaletteIds"],
        ];
        for (const [actual, defaults] of paletteKeys) {
            const declared = Array.isArray(scene.resource[actual]) ? scene.resource[actual] : [];
            const fallback = Array.isArray(settings.resource[defaults]) ? settings.resource[defaults] : [];
            const seen = new Set();
            for (let index = 0; index < Math.max(declared.length, fallback.length); index++) {
                const explicit = nonempty(declared[index]);
                const inherited = nonempty(fallback[index]);
                const palette = explicit ?? inherited;
                if (!palette || seen.has(palette))
                    continue;
                seen.add(palette);
                edge(sceneOwner, target("palette", palette), "palette", explicit ? "authored" : "inherited-setting");
            }
            if (seen.size === 0 && inventory.palettes[0])
                edge(sceneOwner, target("palette", inventory.palettes[0].id), "palette", "inherited-setting");
        }
        scriptOwner(scene);
    }
    for (const resource of authored) {
        if (resource.type !== "actor" && resource.type !== "trigger")
            continue;
        if (ownerPaths && !ownerPaths.has(resource.resourcePath))
            continue;
        scriptOwner(resource);
    }
    for (const resource of authored) {
        if (ownerPaths && !ownerPaths.has(resource.resourcePath))
            continue;
        structural(resource);
    }
    return {
        references,
        structuralReferences,
        nodes,
        coverage: { complete: limitations.length === 0, limitations,
            ...(reviewedEvents.size ? { reviewedCustomEvents: [...reviewedEvents.values()] } : {}) },
        customEventFingerprint: resolution.fingerprint,
    };
}
//# sourceMappingURL=world-script-graph.js.map