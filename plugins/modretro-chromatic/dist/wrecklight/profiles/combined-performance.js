// Exact nine-file successor of the accepted opening correction. The complete
// source manifest is 717d396bf89dd46f42f1e1dbe952c5db75d4a0a24d9a2eb53a2a53972c9170c2.
// These pins describe source dependencies, not a runtime performance verdict.
export const WRECKLIGHT_COMBINED_PERFORMANCE_SOURCE_REVIEW = {
    replacements: [
        {
            path: "plugins/wrecklight-controller/engine/include/wrecklight_combat.h",
            bytes: 1602,
            sha256: "15b2b891203c37df9cdb7361444b0ddc0391e421847476125ca8649e34c4b3de",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/core.c.patch",
            bytes: 7726,
            sha256: "4a1b06b8fca97ae339981cdb0dbbf4b19a8142894f8116a9d2419817b849f59e",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/scroll.c.patch",
            bytes: 5588,
            sha256: "90524b3c375ca3ba83166fb2eb4e55608b9da19411d3c39ddc91081eaf5e5a15",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_chambers.c",
            bytes: 17381,
            sha256: "36d7654cb9ad01fc25653c3038f9435c0e235805ee0a8652e26ac27703f838ed",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_door_maps.c",
            bytes: 17217,
            sha256: "806ac5c51a7f5dec5c29f9594a608d0a358e3a943e49992534293637e5223ea4",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_presentation.c",
            bytes: 58281,
            sha256: "2d1d6936ddd4ffd9fe81248bc08c83a5a05e452d019bdf9b64f0ed44eee8e512",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_rewards.c",
            bytes: 16244,
            sha256: "6b7fe55b858f07d2cf6b8b334078dbe86b13b2b3c6231a750bd61e7fb2dcfdda",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_world.c",
            bytes: 45928,
            sha256: "8f9f711b51046690a17adaff89c12cf9a3e5c0833bed0b345a3fb3c0f928f659",
        },
        {
            path: "plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_pause.c",
            bytes: 37107,
            sha256: "e15d5026185a392e6b0a2e81375a537e8cf1754606a427c76ad58d3eaa8340cf",
        },
    ],
    // Lens retention checks these globals from the native frame-render path.
    // They do not add direct reads or writes to the invoking event's VM effects.
    engineRenderReads: ["8", "585"], // Health, CombatOwnedBits
};
//# sourceMappingURL=combined-performance.js.map