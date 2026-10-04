/// <reference lib="dom" />
const AUDIO_FRAMES = 4096;
const AUDIO_LATENCY_SEC = 0.1;
const METHODS = ["pushBuffer", "pause", "resume"];
/**
 * Route this player's output through one gain in its existing AudioContext.
 * Install before playback: older vendor sources have no retained handles and
 * cannot be rerouted. Pass the official volume getter to retain its PCM scaling.
 */
export function mountAudioControl(audio, context, getVolume = () => 0.5) {
    const output = context.createGain();
    const sources = new Set();
    const captures = new Set();
    const originals = { pushBuffer: audio.pushBuffer, pause: audio.pause, resume: audio.resume };
    const descriptors = METHODS.map(name => Object.getOwnPropertyDescriptor(audio, name));
    let disposed = false;
    let paused = false;
    let muted = getVolume() === 0;
    output.gain.setValueAtTime(muted ? 0 : 1, context.currentTime);
    output.connect(context.destination);
    function release(source, stop) {
        if (!sources.delete(source))
            return;
        source.onended = null;
        if (stop) {
            try {
                source.stop();
            }
            catch { /* A source that never started needs only disconnection. */ }
        }
        source.disconnect();
    }
    function resetTime() {
        if (disposed)
            return;
        for (const source of sources)
            release(source, true);
        audio.startSec = 0;
    }
    const replacements = {
        pushBuffer() {
            if (disposed || !audio.started)
                return;
            const volume = getVolume();
            if (muted || paused || volume === 0 || context.state !== "running") {
                resetTime();
                return;
            }
            const nowSec = context.currentTime;
            const nowPlusLatency = nowSec + AUDIO_LATENCY_SEC;
            audio.startSec = audio.startSec || nowPlusLatency;
            if (audio.startSec < nowSec) {
                // Match the vendor's underrun behavior: reset and wait for the next
                // complete emulated buffer instead of playing a late buffer immediately.
                audio.startSec = nowPlusLatency;
                return;
            }
            const buffer = context.createBuffer(2, AUDIO_FRAMES, audio.sampleRate);
            const left = buffer.getChannelData(0);
            const right = buffer.getChannelData(1);
            for (let index = 0; index < AUDIO_FRAMES; index++) {
                left[index] = (audio.buffer[2 * index] * volume) / 255;
                right[index] = (audio.buffer[2 * index + 1] * volume) / 255;
            }
            const source = context.createBufferSource();
            source.buffer = buffer;
            source.onended = () => release(source, false);
            sources.add(source);
            try {
                source.connect(output);
                source.start(audio.startSec);
            }
            catch (error) {
                release(source, true);
                throw error;
            }
            audio.startSec += AUDIO_FRAMES / audio.sampleRate;
        },
        pause() {
            if (disposed)
                return;
            paused = true;
            resetTime();
            originals.pause.call(audio);
        },
        resume() {
            if (disposed)
                return;
            paused = false;
            resetTime();
            originals.resume.call(audio);
        },
    };
    function dispose() {
        if (disposed)
            return;
        output.gain.setValueAtTime(0, context.currentTime);
        resetTime();
        disposed = true;
        for (const releaseCapture of captures)
            releaseCapture();
        output.disconnect();
        METHODS.forEach((name, index) => {
            if (audio[name] !== replacements[name])
                return;
            const descriptor = descriptors[index];
            if (descriptor)
                Object.defineProperty(audio, name, descriptor);
            else
                Reflect.deleteProperty(audio, name);
        });
    }
    try {
        METHODS.forEach((name, index) => Object.defineProperty(audio, name, {
            configurable: true, enumerable: descriptors[index]?.enumerable ?? false,
            writable: true, value: replacements[name],
        }));
    }
    catch (error) {
        dispose();
        throw error;
    }
    return {
        capture() {
            if (disposed || typeof context.createMediaStreamDestination !== "function") {
                throw new Error("Game audio recording is unavailable in this browser.");
            }
            if (!audio.started || context.state !== "running") {
                return { unavailableReason: !audio.started ? "not-started" : "not-running", release() { } };
            }
            const destination = context.createMediaStreamDestination();
            let released = false;
            const release = () => {
                if (released)
                    return;
                released = true;
                captures.delete(release);
                output.disconnect(destination);
                for (const track of destination.stream.getTracks())
                    track.stop();
                destination.disconnect();
            };
            try {
                output.connect(destination);
            }
            catch (error) {
                for (const track of destination.stream.getTracks())
                    track.stop();
                destination.disconnect();
                throw error;
            }
            captures.add(release);
            return { stream: destination.stream, release };
        },
        setMuted(value) {
            if (disposed || muted === value)
                return;
            muted = value;
            output.gain.setValueAtTime(muted ? 0 : 1, context.currentTime);
            resetTime();
        },
        resetTime,
        dispose,
    };
}
//# sourceMappingURL=audio.js.map