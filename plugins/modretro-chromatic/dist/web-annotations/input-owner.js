import { INPUT_BUTTONS, INPUT_LEASE_MS, parseInputCommand } from "./input-protocol.js";
const systemClock = { now: () => performance.now(), wall: () => Date.now(), set: (cb, ms) => setTimeout(cb, ms), clear: timer => clearTimeout(timer) };
const SETTERS = { up: "_set_joyp_up", down: "_set_joyp_down", left: "_set_joyp_left", right: "_set_joyp_right", a: "_set_joyp_A", b: "_set_joyp_B", start: "_set_joyp_start", select: "_set_joyp_select" };
const owners = new WeakMap();
/** Installed before player construction, including before Gamepad captures bound setters. */
export function installInputOwner(module) {
    if (owners.has(module))
        return true;
    try {
        owners.set(module, new InputOwner(module));
        return true;
    }
    catch {
        return false;
    } // Ordinary preview remains available; input readiness stays false.
}
export function connectInputOwner(module, handle, hooks) {
    return owners.get(module)?.connect(handle, hooks);
}
/** Ordinary joypad writes only. No frame stepping, state restore, or gameplay-memory access. */
export class InputOwner {
    module;
    clock;
    handles = new Map();
    original = new Map();
    constructor(module, clock = systemClock) {
        this.module = module;
        this.clock = clock;
        const names = ["_emulator_new_simple", "_emulator_delete", "_emulator_run_until_f64", ...Object.values(SETTERS)];
        for (const name of names) {
            const descriptor = Object.getOwnPropertyDescriptor(module, name);
            if (typeof module[name] !== "function" || !descriptor || !("value" in descriptor) || !descriptor.writable)
                throw new Error("Unsupported input runtime.");
            this.original.set(name, module[name]);
        }
        const changed = [];
        const wrap = (name, value) => { module[name] = value; changed.push(name); };
        try {
            wrap("_emulator_new_simple", (...args) => {
                const e = this.call("_emulator_new_simple", args);
                if (e)
                    this.handles.set(e, { human: new Set(), unknown: new Set(), generation: 0, uncertain: false, clockFailed: false });
                return e;
            });
            wrap("_emulator_delete", (e) => {
                const h = this.handles.get(e);
                if (h) {
                    this.invalidate(e, h, "closed");
                    h.hooks = undefined;
                }
                this.handles.delete(e);
                return this.call("_emulator_delete", [e]);
            });
            wrap("_emulator_run_until_f64", (e, target) => {
                const h = this.handles.get(e);
                if (h) {
                    this.check(e, h);
                    if (h.uncertain)
                        throw new Error("Browser input release is unconfirmed. Reopen the preview before continuing.");
                    if (h.clockFailed)
                        throw new Error("Browser input timing is unavailable. Reopen the preview before continuing.");
                }
                return this.call("_emulator_run_until_f64", [e, target]);
            });
            for (const key of INPUT_BUTTONS)
                wrap(SETTERS[key], (e, down) => {
                    const h = this.handles.get(e);
                    if (!h)
                        return this.call(SETTERS[key], [e, down]);
                    if (down) {
                        h.human.add(key);
                        this.invalidate(e, h, "human_input");
                    }
                    else {
                        h.human.delete(key);
                        h.unknown.delete(key);
                    }
                    return this.call(SETTERS[key], [e, Number(h.human.has(key) || h.hold?.command.buttons.includes(key))]);
                });
        }
        catch (error) {
            for (const name of changed)
                module[name] = this.original.get(name);
            throw error;
        }
    }
    call(name, args) { return this.original.get(name).apply(this.module, args); }
    frame(h) {
        try {
            const n = h.hooks?.frame();
            return Number.isSafeInteger(n) && n >= 0 ? n : 0;
        }
        catch {
            return 0;
        }
    }
    available(h) { try {
        return h.hooks?.available() === true;
    }
    catch {
        return false;
    } }
    readiness(h) {
        const reason = h.uncertain ? "release_unknown" : h.clockFailed ? "timing_unavailable" : !this.available(h) ? "unavailable" : h.unknown.size ? "human_state_unknown" : h.human.size ? "human_input" : h.hold ? "busy" : "";
        return { generation: h.generation, ready: !reason, reason };
    }
    now(hold) {
        const now = this.clock.now();
        if (!Number.isFinite(now) || now < (hold?.observed ?? 0))
            throw new Error("Invalid input clock.");
        if (hold)
            hold.observed = now;
        return now;
    }
    clearTimer(h, hold) {
        const timer = hold.timer;
        hold.timer = undefined;
        if (timer !== undefined) {
            try {
                this.clock.clear(timer);
            }
            catch {
                h.clockFailed = true;
            }
        }
    }
    finish(e, h, reason) {
        const hold = h.hold;
        if (!hold || hold.finishing)
            return;
        // Keep ownership through every release attempt. Timer/clock failures must
        // neither skip key-up nor expose a ready handle while release is pending.
        hold.finishing = true;
        this.clearTimer(h, hold);
        let released = true;
        for (const key of hold.command.buttons) {
            try {
                this.call(SETTERS[key], [e, Number(h.human.has(key))]);
            }
            catch {
                released = false;
            }
        }
        if (!released)
            h.uncertain = true;
        try {
            this.now(hold);
        }
        catch {
            h.clockFailed = true;
        }
        const receipt = { id: hold.command.id, generation: hold.command.generation,
            outcome: reason === "duration" && released && !h.clockFailed ? "completed" : "interrupted",
            reason: !released ? "release_failed" : h.clockFailed ? "unavailable" : reason,
            applied: true, requestedDurationMs: hold.command.durationMs,
            // If the clock failed, retain only the last valid elapsed observation.
            observedHoldMs: Math.max(0, hold.observed - hold.started), startFrame: hold.startFrame, endFrame: this.frame(h), mcpButtonsReleased: released };
        h.hold = undefined;
        hold.resolve(receipt);
    }
    invalidate(e, h, reason) { h.generation++; this.finish(e, h, reason); }
    check(e, h) {
        if (!h.hold || h.hold.finishing)
            return;
        if (!this.available(h)) {
            this.invalidate(e, h, "unavailable");
            return;
        }
        let now;
        try {
            now = this.now(h.hold);
        }
        catch {
            h.clockFailed = true;
            this.invalidate(e, h, "unavailable");
            return;
        }
        if (h.hold.lease < h.hold.deadline && now >= h.hold.lease)
            this.invalidate(e, h, "connection_lost");
        else if (now >= h.hold.deadline)
            this.finish(e, h, "duration");
    }
    schedule(e, h) {
        const hold = h.hold;
        if (!hold || hold.finishing)
            return;
        this.clearTimer(h, hold);
        if (h.clockFailed) {
            this.invalidate(e, h, "unavailable");
            return;
        }
        try {
            hold.timer = this.clock.set(() => {
                if (h.hold !== hold || hold.finishing)
                    return;
                hold.timer = undefined;
                this.check(e, h);
                if (h.hold === hold)
                    this.schedule(e, h);
            }, Math.max(1, Math.min(hold.deadline, hold.lease) - this.now(hold)));
        }
        catch {
            h.clockFailed = true;
            this.invalidate(e, h, "unavailable");
        }
    }
    connect(e, hooks) {
        const h = this.handles.get(e);
        if (!h || h.hooks)
            return undefined;
        h.hooks = hooks;
        const attached = () => this.handles.get(e) === h && h.hooks === hooks;
        return {
            readiness: () => attached() ? this.readiness(h) : { generation: h.generation, ready: false, reason: "closed" },
            active: () => attached() && !!h.hold,
            hold: async (raw) => {
                const command = parseInputCommand(raw);
                const rejected = (reason) => ({ id: command.id, generation: command.generation, outcome: "rejected", reason, applied: false,
                    requestedDurationMs: command.durationMs, observedHoldMs: 0, startFrame: this.frame(h), endFrame: this.frame(h), mcpButtonsReleased: !h.uncertain });
                if (!attached())
                    return rejected("closed");
                if (command.generation !== h.generation)
                    return rejected("changed");
                if (!this.readiness(h).ready)
                    return rejected("busy");
                let started, wall;
                try {
                    started = this.now();
                    wall = this.clock.wall();
                    if (!Number.isFinite(wall))
                        throw new Error("Invalid input clock.");
                }
                catch {
                    h.clockFailed = true;
                    return rejected("unavailable");
                }
                if (wall >= command.deliverBy || wall >= command.leaseUntil)
                    return rejected("expired");
                return new Promise(resolve => {
                    h.hold = { command, started, observed: started, deadline: started + command.durationMs,
                        lease: started + Math.min(INPUT_LEASE_MS, command.leaseUntil - wall), startFrame: this.frame(h), resolve };
                    try {
                        for (const key of command.buttons)
                            this.call(SETTERS[key], [e, 1]);
                    }
                    catch {
                        this.invalidate(e, h, "release_failed");
                        return;
                    }
                    this.schedule(e, h);
                });
            },
            renew: (id, until) => {
                if (!attached())
                    return;
                this.check(e, h);
                if (!h.hold || h.hold.command.id !== id)
                    return;
                let remaining;
                try {
                    remaining = Math.min(INPUT_LEASE_MS, until - this.clock.wall());
                    if (!Number.isFinite(remaining))
                        throw new Error("Invalid input clock.");
                    h.hold.lease = this.now(h.hold) + remaining;
                }
                catch {
                    h.clockFailed = true;
                    this.invalidate(e, h, "unavailable");
                    return;
                }
                if (remaining <= 0) {
                    this.invalidate(e, h, "connection_lost");
                    return;
                }
                this.schedule(e, h);
            },
            cancel: reason => { if (attached())
                this.invalidate(e, h, reason); },
            unknownHuman: () => { if (attached()) {
                h.unknown = new Set(INPUT_BUTTONS);
                this.invalidate(e, h, "human_input");
            } },
            dispose: () => { if (attached()) {
                this.invalidate(e, h, "closed");
                h.hooks = undefined;
            } },
        };
    }
}
//# sourceMappingURL=input-owner.js.map