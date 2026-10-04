export class ResourceCodecError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "ResourceCodecError";
    }
}
function hexadecimalDigit(character) {
    const code = character.charCodeAt(0);
    if (code >= 48 && code <= 57)
        return code - 48;
    if (code >= 65 && code <= 70)
        return code - 55;
    if (code >= 97 && code <= 102)
        return code - 87;
    return -1;
}
function invalidEncoding(position, reason) {
    throw new ResourceCodecError("INVALID_RESOURCE_ENCODING", `Invalid native resource byte-run encoding at character ${position}: ${reason}`);
}
/** Decode the hexadecimal byte-run format used by collision and tile-color resources. */
export function decodeResourceBytes(encoded, options) {
    if (!Number.isSafeInteger(options.maximumValues) || options.maximumValues < 0) {
        throw new ResourceCodecError("RESOURCE_VALUE_LIMIT", "The maximum number of decoded native project resource bytes must be a nonnegative safe integer");
    }
    if (encoded.length === 0) {
        if (options.allowImplicitZeroGrid)
            return new Uint8Array();
        invalidEncoding(0, "an implicit zero grid is not allowed");
    }
    const runs = [];
    let position = 0;
    let totalValues = 0;
    while (position < encoded.length) {
        const valuePosition = position;
        if (position + 1 >= encoded.length) {
            invalidEncoding(valuePosition, "each byte requires exactly two hexadecimal digits");
        }
        const highDigit = hexadecimalDigit(encoded[position] ?? "");
        const lowDigit = hexadecimalDigit(encoded[position + 1] ?? "");
        if (highDigit < 0 || lowDigit < 0) {
            invalidEncoding(valuePosition, "each byte requires exactly two hexadecimal digits");
        }
        const value = highDigit * 16 + lowDigit;
        position += 2;
        if (position >= encoded.length) {
            invalidEncoding(position, "a byte must end with ! or a hexadecimal run length followed by +");
        }
        let count = 0;
        if (encoded[position] === "!") {
            count = 1;
            position += 1;
        }
        else {
            const runPosition = position;
            let digits = 0;
            while (position < encoded.length && encoded[position] !== "+") {
                const digit = hexadecimalDigit(encoded[position] ?? "");
                if (digit < 0) {
                    invalidEncoding(position, "a run length must contain only hexadecimal digits");
                }
                if (count > Math.floor((Number.MAX_SAFE_INTEGER - digit) / 16)) {
                    throw new ResourceCodecError("RESOURCE_VALUE_LIMIT", "A native resource byte run exceeds the maximum safe integer");
                }
                count = count * 16 + digit;
                digits += 1;
                if (count > options.maximumValues - totalValues) {
                    throw new ResourceCodecError("RESOURCE_VALUE_LIMIT", `Decoded native project resource exceeds its ${options.maximumValues}-byte limit`);
                }
                position += 1;
            }
            if (digits === 0 || encoded[position] !== "+") {
                invalidEncoding(runPosition, "a run requires a hexadecimal length followed by +");
            }
            if (count === 0) {
                invalidEncoding(runPosition, "a byte run must have a positive length");
            }
            position += 1;
        }
        if (count > options.maximumValues - totalValues) {
            throw new ResourceCodecError("RESOURCE_VALUE_LIMIT", `Decoded native project resource exceeds its ${options.maximumValues}-byte limit`);
        }
        totalValues += count;
        runs.push({ value, count });
    }
    const values = new Uint8Array(totalValues);
    let offset = 0;
    for (const { value, count } of runs) {
        values.fill(value, offset, offset + count);
        offset += count;
    }
    return values;
}
/** Encode bytes without changing any opaque collision bits or palette-slot values. */
export function encodeResourceBytes(values) {
    if (values.length === 0)
        return "";
    let encoded = "";
    let previous = values[0] ?? 0;
    let count = 1;
    for (let index = 1; index <= values.length; index += 1) {
        const value = values[index];
        if (index < values.length && value === previous) {
            count += 1;
            continue;
        }
        encoded += previous.toString(16).padStart(2, "0");
        encoded += count === 1 ? "!" : `${count.toString(16)}+`;
        previous = value ?? 0;
        count = 1;
    }
    return encoded;
}
//# sourceMappingURL=resource-codec.js.map