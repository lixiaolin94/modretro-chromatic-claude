import { z } from "zod";
import { CHROMATIC_LIVE_DEFAULT_DURATION_SECONDS, CHROMATIC_LIVE_MIN_DURATION_SECONDS, CHROMATIC_LIVE_MAX_DURATION_SECONDS } from "../../scripts/chromatic.mjs";
const identifier = z.string().min(1).max(128);
const requestId = identifier.describe("Unique ID for the authorized attempt. If the reply is lost, retrieve this same ID through device operation_status; it never starts another attempt.");
const confirm = z.boolean().describe("Set true only when the user explicitly requests this specific setup, live-play, or write action.");
const deviceToken = identifier.describe("Select this token from the latest device discovery; an accepted detect, play, or flash consumes it.");
const admissionRefusals = new Set([
    "CHROMATIC_INVALID_INPUT", "CHROMATIC_CONFIRMATION_REQUIRED", "CHROMATIC_CLOSING", "CHROMATIC_BUSY",
    "CHROMATIC_SESSION_CHANGED", "CHROMATIC_SELECTION_EXPIRED", "CHROMATIC_INVALID_ROM_BINDING", "PROJECT_SELECTION_REQUIRED",
]);
export function registerChromaticTools(server, context) {
    async function invoke(input, signal) {
        let accepted = false;
        try {
            // Confirmation refusal must not require a selected project or workspace.
            const root = input.confirm === true && (input.command === "flash" || input.command === "play")
                ? await context.authorizedRoot() : undefined;
            const value = context.service.execute(input, root, signal);
            accepted = true;
            const result = context.toolResult(value);
            if (value.state === "running") {
                result.content = [{ type: "text", text: `${input.command === "play" ? "Host-emulation-to-Chromatic live-demo" : "Chromatic"} operation started (${value.operationId}). Read device operation_status for the original result. Do not repeat the action.` }];
            }
            else if (value.state === "unresolved") {
                result.content = [{ type: "text", text: `Chromatic operation remains unresolved (${value.operationId}). Preserve its original result and reservation; do not retry or assume the device is unchanged.` }];
                result.isError = true;
            }
            else if (value.state === "failed") {
                // Use the formatted response so its path/privacy policy applies here too.
                const error = result.structuredContent?.error;
                result.content = [{ type: "text", text: `Chromatic operation failed (${value.operationId}). ${error?.message ?? "The complete original command result is retained below."} No automatic retry ran.` }];
                result.isError = true;
            }
            if (value.state === "succeeded") {
                const report = result.structuredContent?.result;
                const notices = [...(report?.diagnostics ?? []), ...(report?.recovery ? [report.recovery] : [])];
                if (notices.length)
                    result.content.unshift({ type: "text", text: notices.map(notice => notice.message).join("\n\n") });
            }
            return result;
        }
        catch (error) {
            const result = context.errorResult(error);
            // Only definite admission refusals describe this invocation as unstarted.
            // Lookup, replay-conflict and journal failures cannot establish whether
            // the original request already started, so retain its uncertainty.
            const code = error instanceof Error && "code" in error ? String(error.code) : "";
            let refused = !accepted && input.command !== "status" && input.command !== "operation_status" && admissionRefusals.has(code);
            if (refused && input.requestId) {
                // Validation may run before request deduplication (for example when
                // confirm is missing). Never apply its refusal to a retained original.
                try {
                    context.service.execute({ command: "operation_status", requestId: input.requestId });
                    refused = false;
                }
                catch (lookupError) {
                    refused = lookupError instanceof Error && "code" in lookupError && lookupError.code === "CHROMATIC_OPERATION_UNKNOWN";
                    if (refused)
                        try {
                            const status = context.service.execute({ command: "status" });
                            refused = !status.retainedReservation && !status.activeOperation;
                        }
                        catch {
                            refused = false;
                        }
                }
            }
            if (refused) {
                result.structuredContent = { ...result.structuredContent, operationStarted: false };
            }
            return result;
        }
    }
    server.registerTool("device", {
        title: "Inspect Chromatic devices and operations",
        description: "Read platform/driver requirements without touching USB, list connected Chromatics, or retrieve an original operation. Supply a caller-chosen requestId for discovery so a lost reply can be recovered without scanning again; reusing it returns the original result, never fresh tokens. Choose the intended device; there is no default player. Report discovery diagnostics even when another device is selectable. Duplicate player numbers need distinct on-device settings followed by reconnection; unmatched USB functions need the reported access checks. For a lost or unresolved action, read its original operation_status; do not start a replacement.",
        inputSchema: z.object({
            command: z.enum(["status", "list_devices", "operation_status"]).describe("status: no other fields; list_devices: optional requestId; operation_status: exactly one of operationId or requestId."),
            operationId: identifier.describe("operation_status only: returned operation ID; omit requestId.").optional(),
            requestId: identifier.describe("list_devices: optional caller-chosen ID for one discovery. operation_status: original discovery, setup, play, or flash request ID; omit operationId.").optional(),
        }).strict(),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    }, async (input, extra) => invoke(input, extra.signal));
    server.registerTool("setup", {
        title: "Set up Chromatic device access",
        description: "Install drivers or detect a cartridge when the user requests that specific action. Driver setup changes Linux udev access or requests Windows administrator approval; macOS needs no vendor driver. Cartridge detection can reconfigure the FPGA and consumes the selected device token. Retain the requestId and poll device operation_status. Unreadable cartridges or unknown flash models return recovery guidance; do not automatically repeat detection.",
        inputSchema: z.object({
            command: z.enum(["install_drivers", "detect_cartridge"]).describe("install_drivers requires only sessionId; detect_cartridge requires only deviceToken. Both require requestId and confirm."), requestId, confirm,
            sessionId: identifier.optional().describe("Required for install_drivers; use the sessionId from current device status."),
            deviceToken: deviceToken.optional().describe("Required for detect_cartridge; choose a token from current discovery. The action consumes it."),
        }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    }, async (input, extra) => invoke(input, extra.signal));
    server.registerTool("flash", {
        title: "Write a selected ROM to Chromatic",
        description: "Flash homebrew or the user's own game; refuse third-party commercial games, including known retail rebuilds. A ROM you compiled from game source otherwise qualifies; try the local emulator for unknown supplied ROMs and do not flash while origin remains unclear. Developer Mode activation is managed outside this plugin using ModRetro Updater: https://support.modretro.com/en_us/articles/chromatic-firmware-updater-ryhoYnzCx. Never request or accept activation codes. After external activation, use fresh device selection and normal flash confirmation; do not automatically retry an uncertain write. On the first flash per device, explain that existing cartridge game data will be erased, saves may be lost, and no backup is made; get explicit consent acknowledging this. Do not repeat consent for later writes the user requests on the same device. Requires a fresh selected deviceToken and the path, sizeBytes, and SHA-256 from rom_inspect. Poll device operation_status; use operationId for a copied preview error because its requestId is preview-scoped. device.program_failed alone does not identify the cause: inspect the original public error summary and recovery. Timeout, cancellation, or process closure never authorizes another flash. Vendor success does not establish manual boot, play, or audio.",
        inputSchema: z.object({
            deviceToken,
            romPath: z.string().min(1).max(4096),
            expectedSha256: z.string().regex(/^[a-f0-9]{64}$/u),
            expectedSizeBytes: z.number().int().min(0x150).max(8 * 1024 * 1024),
            requestId, confirm: confirm.describe("Set true only for a user-requested write once the user has explicitly accepted cartridge data loss for this device."),
        }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    }, async (input, extra) => invoke({ ...input, command: "flash" }, extra.signal));
    server.registerTool("play", {
        title: "Stream host emulation to Chromatic",
        description: "Stream timed host-emulated video/audio to the selected Chromatic; this does not write or run the cartridge. Requires a user-requested live demo, a fresh selected deviceToken, and the path, sizeBytes, and SHA-256 from rom_inspect. Poll device operation_status until the original process closes; progress alone is not completion. Read returned HID diagnostics without treating them as a driver probe or retry instruction. No remote input, frame capture, stop command, or hardware performance counters are exposed.",
        inputSchema: z.object({
            deviceToken,
            romPath: z.string().min(1).max(4096),
            expectedSha256: z.string().regex(/^[a-f0-9]{64}$/u),
            expectedSizeBytes: z.number().int().min(0x150).max(8 * 1024 * 1024),
            durationSeconds: z.number().min(CHROMATIC_LIVE_MIN_DURATION_SECONDS).max(CHROMATIC_LIVE_MAX_DURATION_SECONDS).optional()
                .describe(`Requested emulation seconds; defaults to ${CHROMATIC_LIVE_DEFAULT_DURATION_SECONDS}. Completion requires observing the original process close.`),
            saveMode: z.enum(["none", "isolated"]).optional().describe("Default none disables save loading/writing. Isolated reuses battery saves only for this exact ROM SHA-256 under the authorized root."),
            requestId, confirm,
        }).strict(),
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    }, async (input, extra) => invoke({ ...input, command: "play" }, extra.signal));
}
//# sourceMappingURL=chromatic.js.map