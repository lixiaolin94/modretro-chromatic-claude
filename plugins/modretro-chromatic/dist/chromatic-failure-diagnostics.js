import { copyFlashFailureDetails } from "./web-annotations/flash-diagnostics.js";
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const positiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const nonnegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;
const MAX_TEXT = 2048;
const MAX_CAUSES = 8;
// Both literals already occur in the recovery source or its test fixtures.
// Match a complete message/cause leaf, never a substring of prose, a path,
// credentials, or a raw log. Only these public constants can enter output.
const TOKENS = ["LIBUSB_ERROR_ACCESS", "IOKit 0xe00002be"];
function completeProcess(command) {
    const process = command.process;
    if (!record(process) || process.error || !positiveInteger(process.pid) || !record(process.spawn)
        || process.spawn.pid !== process.pid || !record(process.exit) || !record(process.close)
        || !Number.isInteger(process.exit.code) || process.exit.code !== process.close.code
        || process.exit.signal !== null || process.close.signal !== null
        || !Array.isArray(process.observationErrors) || process.observationErrors.length
        || !record(process.stdout) || process.stdout.truncated !== false || process.stdout.utf8Valid !== true
        || !record(command.rawOutput) || typeof command.dispatchAttemptedAt !== "string")
        return false;
    return ["stdout", "stderr"].every(name => {
        const stream = process[name], raw = command.rawOutput[name];
        return record(stream) && !stream.error && stream.endObserved === true && stream.closeObserved === true
            && nonnegativeInteger(stream.bytes) && record(raw) && raw.complete === true && raw.observedBytes === stream.bytes;
    });
}
/** Read only the exact original command accepted by the device service.
 * Raw messages stay server-side; output contains a bounded, fixed vocabulary.
 */
export function flashFailureDetails(operation, command) {
    if (!record(operation) || operation.state !== "failed" || operation.success !== false || operation.journalError
        || !Array.isArray(operation.commands) || !record(operation.error) || !record(operation.error.details)
        || (operation.error.code !== "CHROMATIC_VENDOR_FAILED" && operation.error.code !== "CHROMATIC_VENDOR_ERROR"))
        return undefined;
    const details = operation.error.details;
    if (!nonnegativeInteger(details.commandIndex) || details.commandIndex >= operation.commands.length
        || operation.commands[details.commandIndex] !== command || !record(command) || !Array.isArray(command.args)
        || (typeof command.args[0] !== "string" || !["list-devices", "detect-cart", "write-homebrew"].includes(command.args[0]))
        || !completeProcess(command))
        return undefined;
    const process = command.process;
    const exit = process.exit;
    if ((operation.error.code === "CHROMATIC_VENDOR_ERROR") !== (exit.code === 0))
        return undefined;
    const vendor = command.vendor;
    if (!record(vendor) || vendor.schema_version !== 1 || vendor.operation !== command.args[0]
        || vendor.ok !== false || vendor.result !== null || !record(vendor.error)
        || typeof details.vendorCode !== "string" || !/^[a-zA-Z0-9_.-]{1,128}$/u.test(details.vendorCode)
        || details.vendorCode !== vendor.error.code)
        return undefined;
    const error = vendor.error;
    const texts = [];
    const add = (value) => { if (typeof value === "string" && value.length <= MAX_TEXT)
        texts.push(value); };
    add(error.message);
    for (const cause of Array.isArray(error.causes) ? error.causes.slice(0, MAX_CAUSES) : []) {
        add(record(cause) ? cause.message : cause);
    }
    return copyFlashFailureDetails({
        source: "validated-vendor-error",
        phase: record(error.details) ? error.details.phase : undefined,
        observedTokens: TOKENS.filter(token => texts.some(text => text.trim() === token)),
        // Project only recovery the service already produced; never run recovery
        // classification again or infer an action from an observed token.
        recovery: details.recovery,
    });
}
//# sourceMappingURL=chromatic-failure-diagnostics.js.map