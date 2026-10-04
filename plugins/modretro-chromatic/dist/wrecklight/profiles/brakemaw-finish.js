// Brakemaw camera03: the same encounter bounds, with a banked camera helper.
// Warning pixels remain editable art; the sample manifest authenticates them.
// These native pins preserve every earlier source tuple and event operation.
export const WRECKLIGHT_BRAKEMAW_FINISH_SOURCE_REVIEW = {
    bindings: [
        {
            path: "plugins/wrecklight-controller/engine/include/wrecklight_brakemaw_frame.h",
            bytes: 1073,
            sha256: "1be504412abdae39c02f10e270e11cfdf724bf624584755fc09622da75285c37",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_brakemaw_camera.c",
            bytes: 5205,
            sha256: "3bbef2a3fb7e0e7f61795c61889a9fba1cd34dbd27390a65df37d8d824890217",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_brakemaw_guards.c",
            bytes: 20973,
            sha256: "88297792ab5ba660cc91b93baca16b57f73bc72544860f32374d7e7df8b1f755",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_presentation.c",
            bytes: 69039,
            sha256: "5af8587f845ed42bd1d3c8c72b9d392043a86165779df5a2025521a02cfa284e",
        },
    ],
    // ServiceHeld, Health, TurbinePatrolDead, CutterOwned, TurbinePatrolHealth.
    // The helper writes native camera offsets, not script-memory variables.
    engineRenderReads: ["92", "8", "137", "81", "136"],
};
//# sourceMappingURL=brakemaw-finish.js.map