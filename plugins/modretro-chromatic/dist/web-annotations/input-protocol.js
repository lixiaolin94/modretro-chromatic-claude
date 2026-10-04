/** Shared, data-only protocol for the existing browser player's ordinary inputs. */
export const INPUT_BUTTONS = ["up", "down", "left", "right", "a", "b", "start", "select"];
export const INPUT_LEASE_MS = 400;
export const INPUT_MAX_MS = 2_000;
export const INPUT_REASONS = ["duration", "human_input", "lifecycle", "paused", "hidden", "connection_lost", "cancelled", "closed", "changed", "expired", "busy", "unavailable", "release_failed"];
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
function fields(value, names) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== names.length ||
        names.some(key => !Object.hasOwn(value, key)))
        throw new Error("Invalid browser input fields.");
    return value;
}
export function inputButtons(value) {
    if (!Array.isArray(value) || value.length > 8 || new Set(value).size !== value.length ||
        value.some(item => !INPUT_BUTTONS.includes(item)) || value.includes("up") && value.includes("down") ||
        value.includes("left") && value.includes("right"))
        throw new Error("Choose unique game buttons without opposing directions.");
    return [...value];
}
export function inputDuration(value) {
    if (!Number.isSafeInteger(value) || value < 50 || value > INPUT_MAX_MS)
        throw new Error("Input duration must be 50–2000 milliseconds.");
    return value;
}
export function inputGeneration(value) {
    if (!Number.isSafeInteger(value) || value < 0)
        throw new Error("Invalid input generation.");
    return value;
}
export function parseInputReadiness(value) {
    const v = fields(value, ["generation", "ready", "reason"]);
    if (typeof v.ready !== "boolean" || typeof v.reason !== "string" || v.reason.length > 128)
        throw new Error("Invalid input readiness.");
    return { generation: inputGeneration(v.generation), ready: v.ready, reason: v.reason };
}
export function parseInputCommand(value) {
    const v = fields(value, ["id", "generation", "buttons", "durationMs", "deliverBy", "leaseUntil"]);
    if (typeof v.id !== "string" || !UUID.test(v.id) || !Number.isSafeInteger(v.deliverBy) || !Number.isSafeInteger(v.leaseUntil))
        throw new Error("Invalid input command identity or deadline.");
    return { id: v.id, generation: inputGeneration(v.generation), buttons: inputButtons(v.buttons), durationMs: inputDuration(v.durationMs), deliverBy: v.deliverBy, leaseUntil: v.leaseUntil };
}
export function parseInputReceipt(value) {
    const v = fields(value, ["id", "generation", "outcome", "reason", "applied", "requestedDurationMs", "observedHoldMs", "startFrame", "endFrame", "mcpButtonsReleased"]);
    if (typeof v.id !== "string" || !UUID.test(v.id) || !["completed", "interrupted", "rejected"].includes(v.outcome) ||
        !INPUT_REASONS.includes(v.reason) || typeof v.applied !== "boolean" || typeof v.mcpButtonsReleased !== "boolean" ||
        typeof v.observedHoldMs !== "number" || !Number.isFinite(v.observedHoldMs) || v.observedHoldMs < 0 ||
        !Number.isSafeInteger(v.startFrame) || v.startFrame < 0 || !Number.isSafeInteger(v.endFrame) || v.endFrame < 0)
        throw new Error("Invalid browser input receipt.");
    if ((v.outcome === "rejected") !== !v.applied || !v.applied && v.observedHoldMs !== 0 ||
        v.outcome === "completed" && (v.reason !== "duration" || !v.mcpButtonsReleased))
        throw new Error("Inconsistent browser input outcome.");
    return { ...v, generation: inputGeneration(v.generation), requestedDurationMs: inputDuration(v.requestedDurationMs) };
}
//# sourceMappingURL=input-protocol.js.map