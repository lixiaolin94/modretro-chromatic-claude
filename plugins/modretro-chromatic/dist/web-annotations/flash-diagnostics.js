/** Fixed diagnostic vocabulary only. Never return arbitrary vendor text. */
const PHASES = ["detect", "read_header", "probe_flash", "identify", "write"];
const TOKENS = ["LIBUSB_ERROR_ACCESS", "IOKit 0xe00002be"];
const RECOVERY = [
    ["CHROMATIC_DEVELOPER_MODE_REQUIRED", "use_modretro_updater"],
    ["CHROMATIC_DEVICE_ACCESS_REQUIRED", "check_device_access"],
    ["CHROMATIC_DEVICE_ACCESS_REQUIRED", "install_drivers"],
    ["CHROMATIC_PLAYER_AMBIGUOUS", "change_player_numbers"],
    ["CHROMATIC_CARTRIDGE_NOT_DETECTED", "clean_and_reseat_cartridge"],
];
const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
/** Reapply the allowlist at the copy boundary, including to server responses. */
export function copyFlashFailureDetails(value) {
    if (!record(value) || value.source !== "validated-vendor-error")
        return undefined;
    const phase = PHASES.find(item => item === value.phase);
    const observed = Array.isArray(value.observedTokens) ? value.observedTokens.slice(0, 8) : [];
    const observedTokens = TOKENS.filter(item => observed.includes(item));
    const recovery = record(value.recovery) ? value.recovery : undefined;
    const pair = RECOVERY.find(([code, action]) => code === recovery?.code && action === recovery?.action);
    if (!phase && !observedTokens.length && !pair)
        return undefined;
    return {
        source: "validated-vendor-error",
        ...(phase ? { phase } : {}),
        ...(observedTokens.length ? { observedTokens } : {}),
        ...(pair ? { recovery: { code: pair[0], action: pair[1] } } : {}),
    };
}
//# sourceMappingURL=flash-diagnostics.js.map