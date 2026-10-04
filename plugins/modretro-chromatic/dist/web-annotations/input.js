/** Change only keyboard Select; the official touch/gamepad bindings stay intact. */
export function remapSelectKey(keys, select) {
    const shift = Object.getOwnPropertyDescriptor(keys, "shift");
    const previousP = Object.getOwnPropertyDescriptor(keys, "p");
    delete keys.shift;
    keys.p = select;
    return () => {
        if (keys.p !== select)
            return;
        if (previousP)
            Object.defineProperty(keys, "p", previousP);
        else
            delete keys.p;
        if (shift && !Object.hasOwn(keys, "shift"))
            Object.defineProperty(keys, "shift", shift);
    };
}
const MIN_PRESS_TICKS = 2 * 70_224;
const RELEASE_POLL_MS = 16;
/**
 * Keep a quick tap visible to the official emulator for two emulated frames.
 * Only pending releases are polled; this helper never advances the emulator.
 * Call clear on blur, visibility loss, pause, or a change of emulator state.
 */
export function createInputLatch(options) {
    const held = new Map();
    let timer;
    let disposed = false;
    function cancelTimer() {
        if (timer !== undefined)
            clearTimeout(timer);
        timer = undefined;
    }
    function clear() {
        cancelTimer();
        const keys = [...held.keys()];
        held.clear();
        for (const key of keys)
            options.set(key, false);
    }
    function pending() {
        for (const sources of held.values()) {
            for (const press of sources.values())
                if (press.releasing)
                    return true;
        }
        return false;
    }
    function updateTimer() {
        if (disposed || !pending())
            cancelTimer();
        else if (timer === undefined)
            timer = setTimeout(poll, RELEASE_POLL_MS);
    }
    function needsMoreFrames(press, ticks) {
        // A restored or invalid clock must not strand an input from the old state.
        return Number.isFinite(ticks) && Number.isFinite(press.ticks) &&
            ticks >= press.ticks && ticks - press.ticks < MIN_PRESS_TICKS;
    }
    function remove(key, source) {
        const sources = held.get(key);
        if (!sources?.delete(source))
            return;
        if (sources.size === 0) {
            held.delete(key);
            options.set(key, false);
        }
    }
    function poll() {
        timer = undefined;
        if (disposed)
            return;
        if (!options.enabled()) {
            clear();
            return;
        }
        const ticks = options.ticks();
        for (const [key, sources] of held) {
            for (const [source, press] of sources) {
                if (press.releasing && !needsMoreFrames(press, ticks))
                    remove(key, source);
            }
        }
        updateTimer();
    }
    return {
        press(key, source) {
            if (disposed)
                return;
            if (!options.enabled()) {
                clear();
                return;
            }
            let sources = held.get(key);
            const existing = sources?.get(source);
            // Key-repeat keeps the original age. A fresh press after a quick release
            // cancels that release and gets its own minimum duration.
            if (existing && !existing.releasing)
                return;
            const first = !sources;
            if (!sources) {
                sources = new Map();
                held.set(key, sources);
            }
            sources.set(source, { ticks: options.ticks(), releasing: false });
            if (first)
                options.set(key, true);
            updateTimer();
        },
        release(key, source, releaseOptions) {
            if (disposed)
                return;
            if (!options.enabled()) {
                clear();
                return;
            }
            const press = held.get(key)?.get(source);
            if (!press)
                return;
            if (releaseOptions?.immediate || !needsMoreFrames(press, options.ticks()))
                remove(key, source);
            else
                press.releasing = true;
            updateTimer();
        },
        clear,
        dispose() {
            if (disposed)
                return;
            disposed = true;
            clear();
        },
    };
}
//# sourceMappingURL=input.js.map