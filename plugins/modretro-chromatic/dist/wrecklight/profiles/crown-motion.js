// Source-reviewed early Crown motion. Target fit and native play remain separate.
// The sequence, Drive scene initializer and background remain editable data.
// The existing Drive actor pin changes with its reviewed introduction.
// Passive boss captions are removed; earned feedback and notice IDs stay intact.
const reads = ["8", "92", "93", "94", "95", "96", "98", "150",
    "L0", "L1", "L2", "L3", "L4", "L5"];
export const WRECKLIGHT_CROWN_MOTION_SOURCE_REVIEW = {
    bindings: [
        {
            path: "plugins/wrecklight-controller/engine/include/wrecklight_crown_motion.h",
            bytes: 448,
            sha256: "48685af3d3a21d7b5df715de796cc5840e1c33eafaa1a58c0310c0a74f8fb393",
        },
        {
            path: "plugins/wrecklight-controller/engine/include/wrecklight_crown_motion_logic.h",
            bytes: 7772,
            sha256: "9c2a19ed33b078fe9ae3f05beeea2d356b2f183f1f3ed318f9ac51a5790aa8b6",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/actor.c.patch",
            bytes: 4591,
            sha256: "df075610f4511d0d23f221086e93898b7b481c440d2e3168e3b3a989309640ba",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_crown_motion.c",
            bytes: 5922,
            sha256: "368bb19b89086215d253c433b7ba17d19c7fab2af2a271c11f004a20d3dacff5",
        },
        {
            path: "plugins/wrecklight-controller/events/eventWrecklightCrownMotion.js",
            bytes: 2272,
            sha256: "05a1f0b83590fda520da2b3ff6ed4c60831ee1e40b0ec12e2e0e2d1fd40ffd81",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_presentation.c",
            bytes: 67649,
            sha256: "6836e2e73cf68366bf5840dcdc4060c699ea5ba0b67096cf081b0834de9a3b21",
        },
        {
            path: "project/scenes/drive_hall/actors/drive_charging_skimmer.gbsres",
            bytes: 32757,
            sha256: "c94637e682beec7ba8b5b2714cfce9037d80aa452e58c674d8dba2e40ea7841b",
        },
    ],
    relays: [
        { id: "acde66b2-7942-5be0-ae4d-f2cbe6ef3e9f", slot: 7 },
        { id: "4d5586ff-4539-5dfb-8873-a6696736641e", slot: 8 },
    ],
    // Includes reads after writes inside begin; this is an access set, not a
    // claim that the previous epoch/timer values determine a newly armed tell.
    operations: {
        beginLeft: { reads, writes: ["93", "L4", "L5"], children: [], movingSlots: [7] },
        beginRight: { reads, writes: ["93", "L4", "L5"], children: [], movingSlots: [8] },
        tick: { reads, writes: ["93", "L5"], children: [], movingSlots: [7, 8] },
    },
};
//# sourceMappingURL=crown-motion.js.map