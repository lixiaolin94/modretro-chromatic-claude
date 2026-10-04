/** Counts the VP8 encoder's own tee packets, not the separately encoded preview. */
export class LinuxPacketStats {
    pending = "";
    codec = false;
    version = false;
    hash = false;
    timeBase;
    count = 0;
    firstPTS;
    lastPTS;
    lastDuration = 0;
    push(chunk) {
        if (chunk.length > 64 * 1024 || chunk.some(byte => byte > 127))
            throw new Error("Linux encoded-packet metadata exceeded its bound.");
        this.pending += chunk.toString("ascii");
        let end;
        while ((end = this.pending.indexOf("\n")) >= 0) {
            const line = this.pending.slice(0, end);
            this.pending = this.pending.slice(end + 1);
            if (line.length > 2048)
                throw new Error("Linux encoded-packet metadata line exceeded its bound.");
            if (line.startsWith("#")) {
                if (this.count)
                    throw new Error("Linux encoded-packet format changed.");
                if (line === "#version: 1")
                    this.version = true;
                else if (line === "#hash: SHA256")
                    this.hash = true;
                else if (line === "#codec_id 0: vp8")
                    this.codec = true;
                else if (line.startsWith("#tb ")) {
                    const match = /^#tb 0: (\d+)\/(\d+)$/.exec(line);
                    if (!match || this.timeBase)
                        throw new Error("Linux encoded time base is invalid.");
                    const n = Number(match[1]), d = Number(match[2]);
                    if (!Number.isSafeInteger(n) || !Number.isSafeInteger(d) || n < 1 || d < 1)
                        throw new Error("Linux encoded time base is invalid.");
                    this.timeBase = [n, d];
                }
                else if (!/^#(?:format: frame checksums|software: [ -~]+|media_type 0: video|dimensions 0: \d+x\d+|sar 0: \d+\/\d+|stream#, dts, +pts, duration, +size, hash)$/.test(line))
                    throw new Error("Unexpected Linux encoded-packet header.");
            }
            else if (line) {
                const m = /^0,\s*(-?\d+),\s*(-?\d+),\s*(\d+),\s*(\d+),\s*([a-f0-9]{64})$/.exec(line);
                if (!m || !this.codec || !this.version || !this.hash || !this.timeBase)
                    throw new Error("Linux encoded-packet evidence is incomplete.");
                const [dts, pts, duration, size] = m.slice(1, 5).map(Number);
                if (![dts, pts, duration, size].every(Number.isSafeInteger) || dts !== pts || pts < 0 || size < 1 || size > 16 * 1024 * 1024)
                    throw new Error("Linux encoded-packet timing is invalid.");
                const seconds = pts * this.timeBase[0] / this.timeBase[1];
                if (!Number.isFinite(seconds) || this.lastPTS !== undefined && seconds <= this.lastPTS)
                    throw new Error("Linux encoded-packet time regressed.");
                this.firstPTS ??= seconds;
                this.lastPTS = seconds;
                this.lastDuration = duration * this.timeBase[0] / this.timeBase[1];
                this.count++;
            }
        }
        if (this.pending.length > 2048)
            throw new Error("Linux encoded-packet metadata is incomplete.");
    }
    finish() { if (this.pending || !this.count)
        throw new Error("Linux recording ended without complete encoded-packet evidence."); }
}
//# sourceMappingURL=linux-packet-stats.js.map