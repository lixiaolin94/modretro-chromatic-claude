import { randomUUID } from "node:crypto";
import { INPUT_LEASE_MS, inputButtons, inputDuration, inputGeneration, parseInputReceipt } from "./web-annotations/input-protocol.js";
export class PreviewInputError extends Error {
    code;
    commandId;
    constructor(code, message, commandId) {
        super(message);
        this.code = code;
        this.commandId = commandId;
        this.name = "PreviewInputError";
    }
}
/** A single non-replayable input operation for one live preview, across all its views. */
export class PreviewInputBroker {
    operation;
    accepting = true;
    last;
    get blocking() { return !!this.operation; }
    status() {
        const op = this.operation;
        return { accepting: this.accepting, ...(op ? { active: { commandId: op.command.id, viewId: op.viewId, generation: op.command.generation,
                    status: op.uncertain ? "release_unknown" : op.cancelled ? "cancelling" : op.delivered ? "delivered" : "pending" } } : {}), ...(this.last ? { last: structuredClone(this.last) } : {}) };
    }
    request(viewId, readiness, generation, buttons, duration, signal) {
        if (!this.accepting || this.operation)
            throw new PreviewInputError("INPUT_BUSY", "The browser has an input command or unresolved release. Inspect its status first.");
        inputGeneration(generation);
        if (!readiness?.ready || readiness.generation !== generation)
            throw new PreviewInputError("INPUT_NOT_READY", "The selected browser input state changed or is not ready. Read status again.");
        if (signal?.aborted)
            throw new PreviewInputError("INPUT_CANCELLED", "Input was cancelled before admission.");
        const command = { id: randomUUID(), generation, buttons: inputButtons(buttons), durationMs: inputDuration(duration), deliverBy: Date.now() + 2_000, leaseUntil: 0 };
        return new Promise((resolve, reject) => {
            const abort = () => this.cancel("The caller cancelled the browser input command.");
            const op = { viewId, command, delivered: false, cancelled: false, uncertain: false, resolve, reject,
                detach: () => signal?.removeEventListener("abort", abort), drains: [] };
            this.operation = op;
            signal?.addEventListener("abort", abort, { once: true });
            op.timer = setTimeout(() => this.expire(op), 2_000);
        });
    }
    poll(viewId, readiness, activeId, rawReceipt) {
        if (activeId !== undefined && (typeof activeId !== "string" || !/^[a-f0-9-]{36}$/i.test(activeId)))
            throw new PreviewInputError("INPUT_INVALID", "Invalid active input ID.");
        if (rawReceipt !== undefined) {
            const receipt = parseInputReceipt(rawReceipt);
            const op = this.operation;
            if (this.last?.commandId === receipt.id && this.last.viewId === viewId && this.last.receipt && JSON.stringify(this.last.receipt) === JSON.stringify(receipt)) {
                return {}; // Identical receipt retry never replays the command.
            }
            if (!op || !op.delivered || op.viewId !== viewId || op.command.id !== receipt.id || op.command.generation !== receipt.generation || op.command.durationMs !== receipt.requestedDurationMs) {
                throw new PreviewInputError("INPUT_RESULT_MISMATCH", "The input result does not match a delivered command.");
            }
            this.last = { commandId: receipt.id, viewId, status: receipt.mcpButtonsReleased ? "complete" : "release_unknown", receipt };
            if (op.timer)
                clearTimeout(op.timer);
            op.detach();
            if (!receipt.mcpButtonsReleased) {
                op.uncertain = op.cancelled = true;
                const error = new PreviewInputError("INPUT_RELEASE_UNKNOWN", "The browser could not confirm input release. No command will be replayed.", receipt.id);
                op.reject(error);
                op.drains.splice(0).forEach(wait => wait.reject(error));
                return { cancelInput: receipt.id };
            }
            this.operation = undefined;
            op.resolve(receipt);
            op.drains.splice(0).forEach(wait => wait.resolve());
            return {};
        }
        const op = this.operation;
        if (!op || op.viewId !== viewId) {
            return activeId ? { cancelInput: activeId } : {};
        }
        if (op.cancelled || readiness && readiness.generation !== op.command.generation) {
            if (!op.cancelled)
                this.cancel("The browser lifecycle changed before input completed.");
            return { cancelInput: op.command.id };
        }
        if (!op.delivered) {
            if (Date.now() >= op.command.deliverBy || !readiness?.ready) {
                this.expire(op);
                return {};
            }
            op.delivered = true;
            if (op.timer)
                clearTimeout(op.timer);
            op.timer = setTimeout(() => this.expire(op), op.command.durationMs + 1_000);
            op.command.leaseUntil = Date.now() + INPUT_LEASE_MS;
            return { inputCommand: structuredClone(op.command) };
        }
        if (activeId === op.command.id)
            return { inputLease: { id: op.command.id, leaseUntil: Date.now() + INPUT_LEASE_MS } };
        return {}; // A delivered command is never sent twice.
    }
    cancel(message) {
        const op = this.operation;
        if (!op)
            return;
        op.cancelled = true;
        if (!op.delivered) {
            this.last = { commandId: op.command.id, viewId: op.viewId, status: "not_delivered" };
            this.operation = undefined;
            if (op.timer)
                clearTimeout(op.timer);
            op.detach();
            op.reject(new PreviewInputError("INPUT_NOT_DELIVERED", message, op.command.id));
            op.drains.splice(0).forEach(wait => wait.resolve());
        }
    }
    expire(op) {
        if (this.operation !== op)
            return;
        if (op.timer)
            clearTimeout(op.timer);
        op.timer = undefined;
        if (!op.delivered) {
            this.cancel("The browser did not pick up input before its deadline. Nothing was delivered.");
            return;
        }
        op.cancelled = op.uncertain = true;
        this.last = { commandId: op.command.id, viewId: op.viewId, status: "release_unknown" };
        op.detach();
        const error = new PreviewInputError("INPUT_RELEASE_UNKNOWN", "Input was delivered but its release was not confirmed. Inspect status; do not replay it.", op.command.id);
        op.reject(error);
        op.drains.splice(0).forEach(wait => wait.reject(error));
    }
    connectionLost() {
        this.accepting = false;
        const op = this.operation;
        if (op)
            this.expire(op);
    }
    async drain() {
        this.accepting = false;
        this.cancel("The browser preview is closing or changing.");
        const op = this.operation;
        if (!op)
            return;
        if (op.uncertain)
            throw new PreviewInputError("INPUT_RELEASE_UNKNOWN", "The original browser has unresolved input release; its owner is retained.", op.command.id);
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => this.expire(op), 1_500);
            op.drains.push({ resolve: () => { clearTimeout(timer); resolve(); }, reject: error => { clearTimeout(timer); reject(error); } });
        });
    }
}
//# sourceMappingURL=web-preview-input.js.map