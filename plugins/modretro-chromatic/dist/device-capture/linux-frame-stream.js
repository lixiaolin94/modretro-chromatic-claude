import { createHash } from "node:crypto";
import { NATIVE_LIMITS } from "./native-protocol.js";
import { validateNativeJpeg } from "./native-jpeg.js";
/** Joins the two tee outputs from the SAME encoded MJPEG packet stream. */
export class LinuxFrameStream {
    receive;
    bytes = Buffer.alloc(0);
    metadata = "";
    packets = [];
    timeBase;
    dimensions;
    hashDeclared = false;
    versionDeclared = false;
    codecDeclared = false;
    previousPTS = -1;
    count = 0;
    ended = false;
    static maxUnmatchedBytes = 4 * NATIVE_LIMITS.maxPreviewBytes;
    static maxUnmatchedPackets = 64;
    constructor(receive) {
        this.receive = receive;
    }
    pushBytes(chunk) {
        if (this.ended || this.bytes.length + chunk.length > LinuxFrameStream.maxUnmatchedBytes)
            throw new Error("Linux preview bytes exceeded their unmatched-stream bound.");
        this.bytes = Buffer.concat([this.bytes, chunk]);
        this.drain();
    }
    pushMetadata(chunk) {
        if (this.ended || chunk.some(byte => byte > 127) || this.metadata.length + chunk.length > 64 * 1024)
            throw new Error("Linux preview frame metadata exceeded its bound or encoding.");
        this.metadata += chunk.toString("ascii");
        let end;
        while ((end = this.metadata.indexOf("\n")) !== -1) {
            const line = this.metadata.slice(0, end);
            this.metadata = this.metadata.slice(end + 1);
            if (line.length > 2048)
                throw new Error("Linux preview frame metadata line is too long.");
            this.line(line);
            this.drain();
        }
        if (this.metadata.length > 2048)
            throw new Error("Linux preview frame metadata line is incomplete or too long.");
    }
    line(line) {
        if (!line)
            return;
        if (line.startsWith("#")) {
            if (this.count || this.packets.length)
                throw new Error("Linux preview format changed after packets arrived.");
            if (line === "#version: 1")
                this.versionDeclared = true;
            else if (line === "#hash: SHA256")
                this.hashDeclared = true;
            else if (line === "#codec_id 0: mjpeg")
                this.codecDeclared = true;
            else if (line.startsWith("#tb ")) {
                const match = /^#tb 0: (\d+)\/(\d+)$/.exec(line);
                if (!match || this.timeBase)
                    throw new Error("Linux preview time base is invalid or duplicated.");
                const numerator = Number(match[1]), denominator = Number(match[2]);
                if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator < 1 || denominator < 1)
                    throw new Error("Linux preview time base is invalid.");
                this.timeBase = [numerator, denominator];
            }
            else if (line.startsWith("#dimensions ")) {
                const match = /^#dimensions 0: (\d+)x(\d+)$/.exec(line);
                if (!match || this.dimensions)
                    throw new Error("Linux preview dimensions are invalid or duplicated.");
                const width = Number(match[1]), height = Number(match[2]);
                if (width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 4_194_304)
                    throw new Error("Linux preview dimensions exceed their bound.");
                this.dimensions = { width, height };
            }
            else if (!/^#(?:format: frame checksums|software: [ -~]+|media_type 0: video|sar 0: \d+\/\d+|stream#, dts, +pts, duration, +size, hash)$/.test(line)) {
                throw new Error("Linux preview returned an unexpected framehash header.");
            }
            return;
        }
        if (!this.versionDeclared || !this.hashDeclared || !this.codecDeclared || !this.timeBase || !this.dimensions)
            throw new Error("Linux preview packet arrived before its format was authenticated.");
        const match = /^0,\s*(-?\d+),\s*(-?\d+),\s*(\d+),\s*(\d+),\s*([a-f0-9]{64})$/.exec(line);
        if (!match)
            throw new Error("Linux preview framehash packet is malformed.");
        const [dts, pts, duration, size] = match.slice(1, 5).map(Number);
        if (![dts, pts, duration, size].every(Number.isSafeInteger) || pts < 0 || dts !== pts || size < 1 || size > NATIVE_LIMITS.maxPreviewBytes)
            throw new Error("Linux preview packet timing or size is invalid.");
        if (this.packets.length >= LinuxFrameStream.maxUnmatchedPackets)
            throw new Error("Linux preview metadata exceeded its unmatched-packet bound.");
        this.packets.push({ pts: pts, size: size, sha256: match[5] });
    }
    drain() {
        while (this.packets.length && this.bytes.length >= this.packets[0].size) {
            const packet = this.packets.shift();
            const bytes = Buffer.from(this.bytes.subarray(0, packet.size));
            this.bytes = this.bytes.subarray(packet.size);
            const sha256 = createHash("sha256").update(bytes).digest("hex");
            if (sha256 !== packet.sha256 || packet.pts <= this.previousPTS)
                throw new Error("Linux preview packet hash or timestamp did not match.");
            validateNativeJpeg(bytes, this.dimensions);
            const sourcePTS = packet.pts * this.timeBase[0] / this.timeBase[1];
            if (!Number.isFinite(sourcePTS))
                throw new Error("Linux preview source timestamp is invalid.");
            this.previousPTS = packet.pts;
            this.count++;
            this.receive({ bytes, sha256, ...this.dimensions, pts: packet.pts, timeBase: this.timeBase, sourcePTS });
        }
    }
    finish() {
        this.ended = true;
        if (this.metadata || this.packets.length || this.bytes.length || !this.count)
            throw new Error("Linux preview ended with missing or unmatched packet evidence.");
    }
}
//# sourceMappingURL=linux-frame-stream.js.map