/**
 * Native ScriptValue forms accepted by GB Studio 4.3.x.
 *
 * This module deliberately has no runtime dependency on project authoring or
 * upstream source: every mutation boundary must be able to share it without
 * creating an import cycle or requiring an optional vendor checkout.
 */
const SCRIPT_KEYS = /^(?:script|[A-Za-z][A-Za-z0-9]*Script)$/;
const ACTOR_PROPERTIES = new Set([
    "xpos", "ypos", "pxpos", "pypos", "direction", "frame",
    "xdeadzone", "ydeadzone", "xoffset", "yoffset", "xscroll", "yscroll",
]);
const BINARY_OPERATORS = new Set([
    "add", "sub", "mul", "div", "mod", "min", "max",
    "eq", "ne", "gt", "gte", "lt", "lte", "and", "or", "atan2",
    "shl", "shr", "bAND", "bOR", "bXOR",
]);
const UNARY_OPERATORS = new Set(["rnd", "not", "isqrt", "abs", "neg", "bNOT"]);
const MAXIMUM_SCRIPT_VALUE_DEPTH = 64;
const MAXIMUM_EVENT_DEPTH = 64;
const MAXIMUM_EVENT_COUNT = 10_000;
function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
/** Match upstream's deliberately permissive `isScriptValue` contract. */
export function isNativeScriptValue(value, depth = 0) {
    if (depth > MAXIMUM_SCRIPT_VALUE_DEPTH || !isObject(value))
        return false;
    const type = value.type;
    if (typeof type !== "string")
        return false;
    switch (type) {
        case "number":
            return typeof value.value === "number";
        case "numberSymbol":
        case "direction":
        case "variable":
        case "constant":
        case "expression":
        case "engineField":
            return typeof value.value === "string";
        case "property":
            return typeof value.target === "string"
                && typeof value.property === "string"
                && ACTOR_PROPERTIES.has(value.property);
        case "true":
        case "false":
        case "indirect":
            return true;
        default:
            if (BINARY_OPERATORS.has(type)) {
                return (!value.valueA || isNativeScriptValue(value.valueA, depth + 1))
                    && (!value.valueB || isNativeScriptValue(value.valueB, depth + 1));
            }
            if (UNARY_OPERATORS.has(type)) {
                return !value.value || isNativeScriptValue(value.value, depth + 1);
            }
            return false;
    }
}
function indexScriptEvents(resource, strict = false) {
    const indexed = new Map();
    const orderedEvents = [];
    if (!resource)
        return { events: indexed, orderedEvents };
    let count = 0;
    let error;
    function visit(events, depth) {
        if (error)
            return;
        if (depth > MAXIMUM_EVENT_DEPTH) {
            if (strict) {
                error = { eventId: "unknown", message: "Script event tree exceeds the maximum nesting depth" };
            }
            return;
        }
        for (const event of events) {
            if (error)
                return;
            if (++count > MAXIMUM_EVENT_COUNT) {
                if (strict) {
                    error = { eventId: "unknown", message: "Script event tree exceeds the maximum event count" };
                }
                return;
            }
            if (!isObject(event))
                continue;
            orderedEvents.push(event);
            if (typeof event.id === "string" && !indexed.has(event.id))
                indexed.set(event.id, event);
            if (!isObject(event.children))
                continue;
            for (const branch of Object.values(event.children)) {
                if (Array.isArray(branch))
                    visit(branch, depth + 1);
            }
        }
    }
    for (const [key, events] of Object.entries(resource)) {
        if (SCRIPT_KEYS.test(key) && Array.isArray(events))
            visit(events, 0);
    }
    return { events: indexed, orderedEvents, ...(error ? { error } : {}) };
}
/** Coordinates present in complete script arrays explicitly supplied by a patch. */
export function explicitlyPatchedNativeScriptCoordinates(patch) {
    const patched = new Map();
    for (const event of indexScriptEvents(patch).orderedEvents) {
        if (event.command !== "EVENT_SWITCH_SCENE" || !isObject(event.args))
            continue;
        const eventId = typeof event.id === "string" && event.id ? event.id : "unknown";
        const coordinates = patched.get(eventId) ?? new Set();
        for (const coordinate of ["x", "y"]) {
            if (Object.prototype.hasOwnProperty.call(event.args, coordinate))
                coordinates.add(coordinate);
        }
        if (coordinates.size > 0)
            patched.set(eventId, coordinates);
    }
    return patched;
}
function equivalentJson(left, right) {
    if (Object.is(left, right))
        return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return Array.isArray(left) && Array.isArray(right)
            && left.length === right.length
            && left.every((value, index) => equivalentJson(value, right[index]));
    }
    if (!isObject(left) || !isObject(right))
        return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return leftKeys.length === rightKeys.length
        && leftKeys.every((key, index) => key === rightKeys[index]
            && equivalentJson(left[key], right[key]));
}
/**
 * Find newly introduced invalid native transitions without making an unrelated
 * edit responsible for malformed events that were already present historically.
 * Prefab argument overrides are intentionally excluded: their referenced event
 * commands live in separately resolved prefab resources, so treating every
 * override named x/y as a scene transition would reject valid native commands.
 */
export function findInvalidNativeScriptEvent(proposed, previous, options = {}) {
    const previousIndex = indexScriptEvents(previous);
    const existingEvents = previousIndex.events;
    const historicalWithoutId = previousIndex.orderedEvents.filter((event) => typeof event.id !== "string" || !event.id);
    const proposedEvents = indexScriptEvents(proposed, true);
    if (proposedEvents.error)
        return proposedEvents.error;
    for (const event of proposedEvents.orderedEvents) {
        if (event.command !== "EVENT_SWITCH_SCENE" || !isObject(event.args))
            continue;
        const eventId = typeof event.id === "string" && event.id ? event.id : "unknown";
        const prior = eventId === "unknown"
            ? historicalWithoutId.find((historical) => equivalentJson(historical, event))
            : existingEvents.get(eventId);
        const priorArguments = isObject(prior?.args) ? prior.args : undefined;
        const changedCommand = prior?.command !== "EVENT_SWITCH_SCENE";
        for (const coordinate of ["x", "y"]) {
            if (!Object.prototype.hasOwnProperty.call(event.args, coordinate))
                continue;
            const explicitlyPatched = options.explicitlyPatchedCoordinates?.get(eventId)?.has(coordinate) === true;
            const newlyIntroduced = !priorArguments
                || !Object.prototype.hasOwnProperty.call(priorArguments, coordinate);
            const changed = priorArguments !== undefined
                && !equivalentJson(priorArguments[coordinate], event.args[coordinate]);
            if (!(changedCommand || newlyIntroduced || changed || explicitlyPatched))
                continue;
            if (isNativeScriptValue(event.args[coordinate]))
                continue;
            return {
                eventId,
                coordinate,
                message: `Event ${eventId} transition coordinate ${coordinate} must be an official typed ScriptValue; use script_transition to create a valid scene transition`,
            };
        }
    }
    return undefined;
}
//# sourceMappingURL=native-script-events.js.map