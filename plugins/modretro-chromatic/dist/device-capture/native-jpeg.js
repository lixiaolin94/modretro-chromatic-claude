const MAX_BYTES = 1024 * 1024, MAX_PIXELS = 8_388_608;
const MAX_HEADER_BYTES = 64 * 1024, MAX_MARKERS = 256, MAX_SCANS = 64;
/** Header admission, not an entropy decoder. Run before forwarding native JPEGs to any image consumer. */
export function validateNativeJpeg(bytes, expected) {
    const invalid = (reason) => { throw new Error(`Native preview has an invalid JPEG: ${reason}.`); };
    const byte = (index) => bytes[index] ?? invalid("truncated byte");
    if (bytes.length < 4 || bytes.length > MAX_BYTES || byte(0) !== 0xff || byte(1) !== 0xd8)
        invalid("envelope or byte limit");
    let offset = 2, headerBytes = 2, markers = 1, scans = 0, frame = 0, inScan = false, hasData = false;
    let restartInterval = 0, nextRestart = 0;
    const components = new Map(), quantization = new Set(), huffman = new Set(), initialDC = new Set();
    const approximation = new Map();
    while (offset < bytes.length) {
        if (inScan) {
            // Entropy bytes are opaque. Only locate escaped bytes, restart markers and the next segment.
            while (offset < bytes.length) {
                if (byte(offset) !== 0xff) {
                    hasData = true;
                    offset++;
                    continue;
                }
                const start = offset;
                while (offset < bytes.length && byte(offset) === 0xff)
                    offset++;
                if (offset === bytes.length)
                    invalid("truncated scan marker");
                const code = byte(offset);
                if (code === 0) {
                    if (offset !== start + 1)
                        invalid("invalid byte stuffing");
                    hasData = true;
                    offset++;
                    continue;
                }
                if (code >= 0xd0 && code <= 0xd7) {
                    if (!restartInterval || code !== 0xd0 + nextRestart || !hasData)
                        invalid("invalid restart marker");
                    nextRestart = (nextRestart + 1) % 8;
                    hasData = false;
                    offset++;
                    continue;
                }
                if (!hasData)
                    invalid("empty or truncated scan");
                offset = start;
                inScan = false;
                break;
            }
            if (inScan)
                invalid("missing end marker");
        }
        const markerStart = offset;
        if (byte(offset++) !== 0xff)
            invalid("expected marker");
        while (offset < bytes.length && byte(offset) === 0xff)
            offset++;
        if (offset === bytes.length || ++markers > MAX_MARKERS)
            invalid("marker limit or truncation");
        const marker = byte(offset++);
        if (marker === 0xd9) {
            if (!frame || !scans || initialDC.size !== components.size || offset !== bytes.length)
                invalid("incomplete image or trailing bytes");
            if (headerBytes + offset - markerStart > MAX_HEADER_BYTES)
                invalid("header byte limit");
            return;
        }
        if (marker === 0 || marker === 0xd8 || marker === 1 || (marker >= 0xd0 && marker <= 0xd7))
            invalid("unexpected standalone marker");
        if (offset + 2 > bytes.length)
            invalid("truncated segment length");
        const length = bytes.readUInt16BE(offset), start = offset + 2, end = offset + length;
        if (length < 2 || end > bytes.length)
            invalid("invalid segment length");
        headerBytes += end - markerStart;
        if (headerBytes > MAX_HEADER_BYTES)
            invalid("header byte limit");
        offset = end;
        if (marker === 0xc0 || marker === 0xc2) {
            // Core Image's RGB JPEG output uses the Huffman DCT family; admit baseline and progressive.
            if (frame || scans || length < 8)
                invalid("missing or conflicting frame header");
            const height = bytes.readUInt16BE(start + 1), width = bytes.readUInt16BE(start + 3), count = byte(start + 5);
            if (byte(start) !== 8 || (count !== 1 && count !== 3) || length !== 8 + 3 * count)
                invalid("unsupported frame header");
            if (!width || !height || width > 4096 || height > 4096 || width * height > MAX_PIXELS
                || width !== expected.width || height !== expected.height)
                invalid("dimensions do not match the admitted image");
            let blocks = 0;
            for (let i = 0; i < count; i++) {
                const p = start + 6 + i * 3, id = byte(p), h = byte(p + 1) >> 4, v = byte(p + 1) & 15, table = byte(p + 2);
                if (components.has(id) || !h || h > 4 || !v || v > 4 || table > 3)
                    invalid("invalid frame components");
                blocks += h * v;
                components.set(id, table);
                approximation.set(id, new Int8Array(64).fill(-1));
            }
            if (blocks > 10)
                invalid("sampling block limit");
            frame = marker;
        }
        else if (marker === 0xdb) {
            if (start === end)
                invalid("empty quantization table");
            for (let p = start; p < end;) {
                const precision = byte(p) >> 4, table = byte(p++) & 15;
                if (precision > 1 || table > 3 || p + 64 * (precision + 1) > end)
                    invalid("invalid quantization table");
                for (let i = 0; i < 64; i++, p += precision + 1)
                    if ((precision ? bytes.readUInt16BE(p) : byte(p)) === 0)
                        invalid("zero quantization value");
                quantization.add(table);
            }
        }
        else if (marker === 0xc4) {
            if (start === end)
                invalid("empty Huffman table");
            for (let p = start; p < end;) {
                if (p + 17 > end)
                    invalid("truncated Huffman table");
                const type = byte(p) >> 4, table = byte(p++) & 15;
                if (type > 1 || table > 3)
                    invalid("unsupported Huffman table");
                let count = 0, slots = 1;
                for (let i = 0; i < 16; i++) {
                    const n = byte(p++);
                    count += n;
                    slots = slots * 2 - n;
                    if (slots <= 0)
                        invalid("oversubscribed Huffman table");
                }
                if (!count || count > 256 || p + count > end)
                    invalid("invalid Huffman symbol count");
                for (let i = 0; i < count; i++) {
                    const symbol = byte(p++), size = symbol & 15;
                    // Progressive AC tables also use zero-size EOB-run symbols, not only baseline EOB/ZRL.
                    if (type === 0 ? symbol > 11 : size > 10)
                        invalid("unsupported Huffman symbol");
                }
                huffman.add(type * 4 + table);
            }
        }
        else if (marker === 0xdd) {
            if (length !== 4)
                invalid("invalid restart interval");
            restartInterval = bytes.readUInt16BE(start);
        }
        else if (marker === 0xda) {
            if (!frame || length < 6 || ++scans > MAX_SCANS)
                invalid("missing frame or scan limit");
            const count = byte(start), ss = byte(end - 3), se = byte(end - 2), ah = byte(end - 1) >> 4, al = byte(end - 1) & 15;
            if (!count || count > components.size || length !== 6 + 2 * count)
                invalid("invalid scan header");
            if (frame === 0xc0 ? ss !== 0 || se !== 63 || ah !== 0 || al !== 0
                : ss > se || se > 63 || (ss === 0 ? se !== 0 : count !== 1) || ah > 13 || al > 13 || (ah !== 0 && ah !== al + 1))
                invalid("unsupported scan header");
            const selected = new Set();
            for (let i = 0; i < count; i++) {
                const id = byte(start + 1 + i * 2), tables = byte(start + 2 + i * 2), dc = tables >> 4, ac = tables & 15;
                const q = components.get(id);
                if (q === undefined || selected.has(id) || !quantization.has(q) || dc > 3 || ac > 3)
                    invalid("invalid scan components");
                if ((frame === 0xc0 || (ss === 0 && ah === 0)) && !huffman.has(dc))
                    invalid("missing DC table");
                if ((frame === 0xc0 || ss > 0) && !huffman.has(4 + ac))
                    invalid("missing AC table");
                const previous = approximation.get(id);
                // At most three 64-byte tables: validate progressive ordering without decoding coefficients.
                for (let coefficient = ss; coefficient <= se; coefficient++) {
                    if (previous[coefficient] !== (ah === 0 ? -1 : ah))
                        invalid("invalid scan approximation order");
                    previous[coefficient] = al;
                }
                if (ss === 0 && ah === 0)
                    initialDC.add(id);
                else if (!initialDC.has(id))
                    invalid("scan precedes initial DC");
                selected.add(id);
            }
            inScan = true;
            hasData = false;
            nextRestart = 0;
        }
        else if (!((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe)) {
            // Includes alternate SOF modes, arithmetic coding, DNL and hierarchical/differential images.
            invalid("unsupported marker");
        }
    }
    invalid("missing end marker");
}
//# sourceMappingURL=native-jpeg.js.map