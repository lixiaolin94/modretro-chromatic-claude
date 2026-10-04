// Exact source-contract successor of Keep View Map with the candidate12 amendments.
// Earlier profiles remain intact; the maintained sample uses the curated shape.
// Candidate12 manifest: 1a32349916e630f8fc071300b84ea69d4cb03e8f7c14d27d4acfc34ea1fec673.
// Selected recipe: ef9d440c329ec9836a815a37b0edc44f0a75e77d1474f2043705ab4b12b431af.
// This source contract does not establish whole-game or performance acceptance.
export const WRECKLIGHT_GAMEPLAY_POLISH_SOURCE_REVIEW = {
    // The full authored project retains this already-reviewed Chambers backup.
    // The compact remix omits it; keep those two closed input sets distinct.
    sourceAdditions: [
        {
            path: "plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_pause.c.orig",
            bytes: 41461,
            sha256: "4ec2e483f14d3a68fb352fc26adb142a76aa687296f9bb270431da1f96ffc55c",
        },
    ],
    replacements: [
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_enemy_ticks.c",
            bytes: 13746,
            sha256: "7e2d49bb9c9c1eca8f4b9aa5948371a51598212b867d43ae73c62a61a32443ad",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_presentation.c",
            bytes: 58648,
            sha256: "6f9d8bfdf82b935bebdb3bc2926fffacae83794467ad52bdfca9c84a0a02a034",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_projectiles.c",
            bytes: 6800,
            sha256: "778cfcd20cd8081f32568d6dea68859b70a79270534e4b75de64fbfad604c2b4",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_airworks_skimmer_tick.c",
            bytes: 4120,
            sha256: "72d765df2067affe167aef49f5cccc451abdc977b4e34a7db5b9563dda13f2d7",
        },
        {
            path: "plugins/wrecklight-controller/engine/include/wrecklight_combat.h",
            bytes: 1766,
            sha256: "5bcb9824d5cd830863ba929c38cbb70436c52de623b9e3ab8ec9e4aff67fbb1e",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/scroll.c.patch",
            bytes: 5617,
            sha256: "498b8408a33e75f1893d641317746afd605983397908239afb545d303a6ba2d8",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_rewards.c",
            bytes: 18432,
            sha256: "0cefd6f35fb8b368493358f66e2938499d804e3c12dca7c15d0c0ed368019db1",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_chambers.c",
            bytes: 17627,
            sha256: "b6b8254f0518a58b6fc61fc9e530296be51cffc6174ce118f8aedb69acbcf47b",
        },
    ],
};
//# sourceMappingURL=gameplay-polish.js.map