// Frozen source05: regular enemies, Warden lift/slam, Crown press, cameras and HUD data.
// These exact native bindings and effect tables extend only this curated sample;
// earlier source families keep their own semantics. Native qualification is separate.
export const WRECKLIGHT_COMPOSED_GAMEPLAY_SOURCE_REVIEW = {
    "replacements": [
        { "path": "assets/sprites/wrecklight_dynamo_colossus_v01.png.gbsres", "bytes": 98869, "sha256": "4722f2cda120252331f05c9c912c7e3c68d7c47ee47941d34d339465b09945ec" },
        { "path": "plugins/wrecklight-controller/engine/include/wrecklight_warden.h", "bytes": 1549, "sha256": "85afbac691e1ca97b27a8c4c6fdb7754987b68add8ff4169bb6b59cd09bc4949" },
        { "path": "plugins/wrecklight-controller/engine/src/core/actor.c.patch", "bytes": 4658, "sha256": "29bdfbe076defd7b85fc733a91f8920be4ce5c898f9933876e026c6e56ea994d" },
        { "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_crown_wait.c", "bytes": 2552, "sha256": "91b6011ea9391db1e49ded711ce53e5441f2b7369fabe7c2c852330bd2e51d11" },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_enemy_ticks.c",
            "bytes": 16832,
            "sha256": "79fe8cdfa73baf576b9a1f9eb6b6eed228c1ab66adcbfde0adcb1824d1210367"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_presentation.c",
            "bytes": 68584,
            "sha256": "2bedb752d888b1b473ac189142366dc6b7ca17263d1233cdf898b5fc308012ee"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_reactor_idle.c",
            "bytes": 4338,
            "sha256": "4f9d1b22821e222dfbd88ba4504543514944e54acbf6d0335670d9ad3549888d"
        },
        { "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_warden.c", "bytes": 35151, "sha256": "441669399b6be1fe20f242c33ac9f6a8be75306dbc82bafc92cda558c2c46c3a" },
        { "path": "plugins/wrecklight-controller/events/eventWrecklightWarden.js", "bytes": 9479, "sha256": "fea29219c52d0488d747630ecd3a7b909fbfa49fa64ec99cbda07f049f896a34" }
    ],
    "additions": [
        { "path": "assets/sprites/wrecklight_crown_sovereign_v01.png.gbsres", "bytes": 31358, "sha256": "de3482df5c740f1c9cb41155e9eebcdd16d80beb74ebcbc74e1b908b39ee3ba0" },
        { "path": "assets/sprites/wrecklight_keelhook_v02.png.gbsres", "bytes": 18149, "sha256": "431279469aa2e45bca01a52ef26911b80e1bee8436025bb1743c49d1a14dbdfa" },
        { "path": "assets/sprites/wrecklight_wake_vulture_budget_v02.png.gbsres", "bytes": 18023, "sha256": "e0bb3822db2c5bbcfdc78a70a816e856e7627f7dfcf314df4a7a85da0842b38e" },
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_cargo_crawler_frames.h",
            "bytes": 1626,
            "sha256": "f76e5ef761837970f072b035268a0495abdea0c921f4566de3c5c292e85c444e"
        },
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_cargo_crawler_logic.h",
            "bytes": 7356,
            "sha256": "019abc4289ed8b7d4d2f9703b4e4faffe2846fdb68dfc26db8b0974ba9a034ac"
        },
        { "path": "plugins/wrecklight-controller/engine/include/wrecklight_crown_poses.h", "bytes": 358, "sha256": "0cefa6482d645adf30cc3db62109c593580869c7cb930cb0f2e48872359535e2" },
        { "path": "plugins/wrecklight-controller/engine/include/wrecklight_crown_press.h", "bytes": 1962, "sha256": "f40b5d5ae1b003c49d64c786b67112bdb4830486dc8902fbc123a8955bb32a07" },
        { "path": "plugins/wrecklight-controller/engine/include/wrecklight_hud_tiles.h", "bytes": 163, "sha256": "b3d88f5da75cc3864ae2ce38232c70a3eaf14cf0b11edcb9fb05693aeecfac8b" },
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_reactor_hunter_policy.h",
            "bytes": 3396,
            "sha256": "843c4991375106b67b0b1ba81a3d7fc7a7471592082e01d3c971e97d118c205a"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_cargo_crawler.c",
            "bytes": 3293,
            "sha256": "bde143d619548013f4dfc7c922307ab3ff82735438508179030949f02ef5c5aa"
        },
        { "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_crown_press.c", "bytes": 8840, "sha256": "0f2c9eec2db43a35ea5aea083266fc8a76d4d621a25132a23d16231d378e97d7" },
        { "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_hud_tiles.c", "bytes": 4677, "sha256": "f86475736019ece8b37655aec68a439672cd707b75bbd0e11031f2d8a7e3bbe0" },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_reactor_hunter.c",
            "bytes": 9148,
            "sha256": "875d303f489fc52279ba4df60ca1f624be8c89eae3a774ea65923392c414f2a5"
        },
        { "path": "plugins/wrecklight-controller/events/eventWrecklightCargoCrawler.js", "bytes": 3505, "sha256": "81d90d154b1e709331b4400bdac9debc408e4a70b47d461ddfe04bb9e3fd4f1c" },
        { "path": "plugins/wrecklight-controller/events/eventWrecklightCrownPress.js", "bytes": 3352, "sha256": "2e891b33deb440f67a3e852e571b6358141401bbe39aefdda480bfb0ad1d462f" },
        { "path": "plugins/wrecklight-controller/events/eventWrecklightReactorHunter.js", "bytes": 7248, "sha256": "93aab2e0a12b5e7d5e63820e495a4c2243c2ec251a8723b6b17c469aa4a8af0e" }
    ],
    "additionalVariables": [
        { "id": "0", "symbol": "VAR_PLAYERX" },
        { "id": "1", "symbol": "VAR_PLAYERY" },
        { "id": "64", "symbol": "VAR_CARGOGUARDHEALTH" },
        { "id": "65", "symbol": "VAR_CARGOGUARDDEAD" },
        { "id": "66", "symbol": "VAR_CARGOGUARDX" },
        { "id": "67", "symbol": "VAR_CARGOGUARDY" },
        { "id": "68", "symbol": "VAR_CARGOGUARDFACING" },
        { "id": "69", "symbol": "VAR_CARGOGUARDWINDUP" },
        { "id": "92", "symbol": "VAR_SERVICEHELD" },
        { "id": "150", "symbol": "VAR_ENCOUNTEREPOCH" },
        { "id": "189", "symbol": "VAR_CARGORIBCLIMBERARMED" },
        { "id": "190", "symbol": "VAR_CARGORIBCLIMBEREPOCH" },
        { "id": "212", "symbol": "VAR_CARGORIBCLIMBERTIMER" },
        { "id": "107", "symbol": "VAR_REACTORGUARDDEAD" },
        { "id": "110", "symbol": "VAR_REACTORGUARDFACING" },
        { "id": "111", "symbol": "VAR_REACTORGUARDPHASE" },
        { "id": "113", "symbol": "VAR_REACTORSKIMMERDEAD" },
        { "id": "114", "symbol": "VAR_REACTORSKIMMERX" },
        { "id": "115", "symbol": "VAR_REACTORSKIMMERY" },
        { "id": "116", "symbol": "VAR_REACTORSKIMMERFACING" },
        { "id": "117", "symbol": "VAR_REACTORSKIMMERPHASE" },
        { "id": "155", "symbol": "VAR_REACTORACTIVEZONE" },
        { "id": "195", "symbol": "VAR_REACTORMAININDUCTIONSENTINELARMED" },
        { "id": "196", "symbol": "VAR_REACTORMAININDUCTIONSENTINELEPOCH" },
        { "id": "197", "symbol": "VAR_REACTORMAININDUCTIONSENTINELPRIME" },
        { "id": "198", "symbol": "VAR_REACTORMAINSKIMMERARMED" },
        { "id": "199", "symbol": "VAR_REACTORMAINSKIMMEREPOCH" },
        { "id": "216", "symbol": "VAR_REACTORMAINSKIMMERTIMER" },
        { "id": "8", "symbol": "VAR_HEALTH" },
        { "id": "93", "symbol": "VAR_GUARDIANPHASE" },
        { "id": "94", "symbol": "VAR_GUARDIANTARGETLEFT" },
        { "id": "95", "symbol": "VAR_GUARDIANTARGETRIGHT" },
        { "id": "96", "symbol": "VAR_GUARDIANACTIVE" },
        { "id": "97", "symbol": "VAR_GUARDIANCOREHEALTH" },
        { "id": "98", "symbol": "VAR_GUARDIANCLEARED" }
    ],
    "cargoCrawler": {
        "sceneId": "96367a24-9989-5971-bc5a-d26e30b28397",
        "sceneIndex": 3,
        "actorId": "cargo_guard",
        "actorPath": "project/scenes/cargo_span/actors/cargo_sentry.gbsres",
        "entityIndex": 4,
        "enabledSceneTypes": ["TOPDOWN", "PLATFORM", "ADVENTURE", "SHMUP", "POINTNCLICK", "LOGO"],
        "globalAliases": [
            { "id": "0", "alias": "VAR_PLAYERX" },
            { "id": "1", "alias": "VAR_PLAYERY" },
            { "id": "64", "alias": "VAR_CARGOGUARDHEALTH" },
            { "id": "65", "alias": "VAR_CARGOGUARDDEAD" },
            { "id": "66", "alias": "VAR_CARGOGUARDX" },
            { "id": "67", "alias": "VAR_CARGOGUARDY" },
            { "id": "68", "alias": "VAR_CARGOGUARDFACING" },
            { "id": "69", "alias": "VAR_CARGOGUARDWINDUP" },
            { "id": "92", "alias": "VAR_SERVICEHELD" },
            { "id": "150", "alias": "VAR_ENCOUNTEREPOCH" },
            { "id": "189", "alias": "VAR_CARGORIBCLIMBERARMED" },
            { "id": "190", "alias": "VAR_CARGORIBCLIMBEREPOCH" },
            { "id": "212", "alias": "VAR_CARGORIBCLIMBERTIMER" }
        ],
        "locals": [
            { "local": "L0", "alias": "VAR_S3A4_LOCAL_0" },
            { "local": "L1", "alias": "VAR_S3A4_LOCAL_1" },
            { "local": "L2", "alias": "VAR_S3A4_LOCAL_2" },
            { "local": "L3", "alias": "VAR_S3A4_LOCAL_3" },
            { "local": "L4", "alias": "VAR_S3A4_LOCAL_4" }
        ],
        "palette": { "id": "cc28770e-3c80-5822-a088-24c1781ce0b1", "scenePath": "project/scenes/cargo_span/scene.gbsres" },
        "spriteId": "b2e97c83-080a-5fa8-bc04-bd9bbf217c42",
        "operations": {
            "tick": { "reads": ["64", "65", "68", "69", "189", "190", "212", "0", "1", "92", "150", "L0", "L1", "L2", "L3", "L4"], "writes": ["68", "69", "189", "190", "212"], "children": ["lunge"] },
            "land": { "reads": ["64", "65", "68", "69", "189", "190", "212"], "writes": ["69", "189", "212"], "children": ["lunge"] },
            "pose": { "reads": ["64", "65", "68", "69", "189", "190", "212"], "writes": [], "children": ["lunge"] },
            "hit": { "reads": ["64", "65", "68", "69", "189", "190", "212"], "writes": [], "children": ["lunge"] }
        }
    },
    "reactorHunter": {
        "hunter": {
            "sceneId": "f521db84-f386-57db-accf-37aae4c38b3a",
            "sceneIndex": 6,
            "actorId": "be82ae00-8c09-53b3-bae0-887a6b3fc6d8",
            "actorPath": "project/scenes/reactor_well/actors/reactor_skimmer.gbsres",
            "entityIndex": 5,
            "enabledSceneTypes": ["TOPDOWN", "PLATFORM", "ADVENTURE", "SHMUP", "POINTNCLICK", "LOGO"],
            "globalAliases": [
                { "id": "0", "alias": "VAR_PLAYERX" },
                { "id": "1", "alias": "VAR_PLAYERY" },
                { "id": "92", "alias": "VAR_SERVICEHELD" },
                { "id": "107", "alias": "VAR_REACTORGUARDDEAD" },
                { "id": "110", "alias": "VAR_REACTORGUARDFACING" },
                { "id": "111", "alias": "VAR_REACTORGUARDPHASE" },
                { "id": "113", "alias": "VAR_REACTORSKIMMERDEAD" },
                { "id": "114", "alias": "VAR_REACTORSKIMMERX" },
                { "id": "115", "alias": "VAR_REACTORSKIMMERY" },
                { "id": "116", "alias": "VAR_REACTORSKIMMERFACING" },
                { "id": "117", "alias": "VAR_REACTORSKIMMERPHASE" },
                { "id": "150", "alias": "VAR_ENCOUNTEREPOCH" },
                { "id": "155", "alias": "VAR_REACTORACTIVEZONE" },
                { "id": "195", "alias": "VAR_REACTORMAININDUCTIONSENTINELARMED" },
                { "id": "196", "alias": "VAR_REACTORMAININDUCTIONSENTINELEPOCH" },
                { "id": "197", "alias": "VAR_REACTORMAININDUCTIONSENTINELPRIME" },
                { "id": "198", "alias": "VAR_REACTORMAINSKIMMERARMED" },
                { "id": "199", "alias": "VAR_REACTORMAINSKIMMEREPOCH" },
                { "id": "216", "alias": "VAR_REACTORMAINSKIMMERTIMER" }
            ],
            "locals": [
                { "local": "L0", "alias": "VAR_S6A5_LOCAL_0" },
                { "local": "L1", "alias": "VAR_S6A5_LOCAL_1" },
                { "local": "L2", "alias": "VAR_S6A5_LOCAL_2" },
                { "local": "L3", "alias": "VAR_S6A5_LOCAL_3" },
                { "local": "L4", "alias": "VAR_S6A5_LOCAL_4" }
            ]
        },
        "sentinel": {
            "sceneId": "f521db84-f386-57db-accf-37aae4c38b3a",
            "sceneIndex": 6,
            "actorId": "3fd19a9d-aa24-58ff-87b3-aa44b7f6960d",
            "actorPath": "project/scenes/reactor_well/actors/reactor_sentry.gbsres",
            "entityIndex": 4,
            "enabledSceneTypes": ["TOPDOWN", "PLATFORM", "ADVENTURE", "SHMUP", "POINTNCLICK", "LOGO"],
            "globalAliases": [
                { "id": "0", "alias": "VAR_PLAYERX" },
                { "id": "1", "alias": "VAR_PLAYERY" },
                { "id": "92", "alias": "VAR_SERVICEHELD" },
                { "id": "107", "alias": "VAR_REACTORGUARDDEAD" },
                { "id": "110", "alias": "VAR_REACTORGUARDFACING" },
                { "id": "111", "alias": "VAR_REACTORGUARDPHASE" },
                { "id": "113", "alias": "VAR_REACTORSKIMMERDEAD" },
                { "id": "114", "alias": "VAR_REACTORSKIMMERX" },
                { "id": "115", "alias": "VAR_REACTORSKIMMERY" },
                { "id": "116", "alias": "VAR_REACTORSKIMMERFACING" },
                { "id": "117", "alias": "VAR_REACTORSKIMMERPHASE" },
                { "id": "150", "alias": "VAR_ENCOUNTEREPOCH" },
                { "id": "155", "alias": "VAR_REACTORACTIVEZONE" },
                { "id": "195", "alias": "VAR_REACTORMAININDUCTIONSENTINELARMED" },
                { "id": "196", "alias": "VAR_REACTORMAININDUCTIONSENTINELEPOCH" },
                { "id": "197", "alias": "VAR_REACTORMAININDUCTIONSENTINELPRIME" },
                { "id": "198", "alias": "VAR_REACTORMAINSKIMMERARMED" },
                { "id": "199", "alias": "VAR_REACTORMAINSKIMMEREPOCH" },
                { "id": "216", "alias": "VAR_REACTORMAINSKIMMERTIMER" }
            ],
            "locals": [
                { "local": "L0", "alias": "VAR_S6A4_LOCAL_0" },
                { "local": "L1", "alias": "VAR_S6A4_LOCAL_1" },
                { "local": "L2", "alias": "VAR_S6A4_LOCAL_2" },
                { "local": "L3", "alias": "VAR_S6A4_LOCAL_3" },
                { "local": "L4", "alias": "VAR_S6A4_LOCAL_4" }
            ]
        },
        "palette": { "id": "63c13863-3c15-5909-9d79-04f35fa104fe", "scenePath": "project/scenes/reactor_well/scene.gbsres" },
        "spriteId": "2a523678-530a-537f-a722-7169c32c2a8e",
        "operations": {
            "tick": {
                "reads": ["0", "1", "92", "107", "111", "113", "116", "117", "150", "155", "195", "196", "197", "198", "199", "216", "L0", "L1", "L2", "L3", "L4"],
                "writes": ["114", "116", "117", "198", "199", "216"],
                "children": ["tellLeft", "tellRight", "diveLeft", "diveRight", "returnFromWest", "returnFromEast", "hoverLeft", "hoverRight"]
            },
            "sentinel_claim": { "reads": ["0", "1", "92", "107", "111", "113", "117", "150", "155", "195", "196", "197", "L0", "L1", "L2", "L3", "L4"], "writes": ["111"], "children": [] },
            "present": { "reads": ["113", "116", "117", "216"], "writes": [], "children": [] },
            "hit_restore": { "reads": ["113", "116", "117", "216"], "writes": [], "children": [] }
        }
    },
    "crownPress": {
        "sceneId": "ea5c2e78-3b17-5d25-8b34-db5e57b7b405",
        "sceneIndex": 11,
        "actorId": "d13e3229-95dc-54a4-8377-0b670863def4",
        "actorPath": "project/scenes/relay_crown/actors/relay_machine_sequence.gbsres",
        "entityIndex": 8,
        "enabledSceneTypes": ["TOPDOWN", "PLATFORM", "ADVENTURE", "SHMUP", "POINTNCLICK", "LOGO"],
        "globalAliases": [
            { "id": "8", "alias": "VAR_HEALTH" },
            { "id": "92", "alias": "VAR_SERVICEHELD" },
            { "id": "93", "alias": "VAR_GUARDIANPHASE" },
            { "id": "94", "alias": "VAR_GUARDIANTARGETLEFT" },
            { "id": "95", "alias": "VAR_GUARDIANTARGETRIGHT" },
            { "id": "96", "alias": "VAR_GUARDIANACTIVE" },
            { "id": "97", "alias": "VAR_GUARDIANCOREHEALTH" },
            { "id": "98", "alias": "VAR_GUARDIANCLEARED" },
            { "id": "150", "alias": "VAR_ENCOUNTEREPOCH" }
        ],
        "locals": [
            { "local": "L0", "alias": "VAR_S11A8_LOCAL_0" },
            { "local": "L1", "alias": "VAR_S11A8_LOCAL_1" },
            { "local": "L2", "alias": "VAR_S11A8_LOCAL_2" },
            { "local": "L3", "alias": "VAR_S11A8_LOCAL_3" },
            { "local": "L4", "alias": "VAR_S11A8_LOCAL_4" },
            { "local": "L5", "alias": "VAR_S11A8_LOCAL_5" }
        ],
        "coreId": "acde66b2-7942-5be0-ae4d-f2cbe6ef3e9f",
        "coreSlot": 7,
        "operations": {
            "begin": { "reads": ["8", "92", "93", "94", "95", "96", "97", "98", "150"], "writes": ["93", "L4", "L5"], "children": [] },
            "tick": { "reads": ["8", "92", "93", "94", "95", "96", "97", "98", "150", "L4", "L5"], "writes": ["93", "L4", "L5"], "children": [] },
            "guard": { "reads": ["8", "92", "93", "94", "95", "96", "97", "98", "150", "L4", "L5"], "writes": [], "children": ["false", "true"] }
        },
        "spriteId": "199ec23d-6d3e-56ad-a859-f9362cec3c10",
        "stateId": "72351847-de0f-5d63-ae57-5ffcde209a31"
    },
    "engineLocalReads": {
        "sceneId": "ea5c2e78-3b17-5d25-8b34-db5e57b7b405",
        "sceneIndex": 11,
        "actorId": "d13e3229-95dc-54a4-8377-0b670863def4",
        "actorPath": "project/scenes/relay_crown/actors/relay_machine_sequence.gbsres",
        "entityIndex": 8,
        "enabledSceneTypes": ["TOPDOWN", "PLATFORM", "ADVENTURE", "SHMUP", "POINTNCLICK", "LOGO"],
        "globalAliases": [
            { "id": "8", "alias": "VAR_HEALTH" },
            { "id": "92", "alias": "VAR_SERVICEHELD" },
            { "id": "93", "alias": "VAR_GUARDIANPHASE" },
            { "id": "94", "alias": "VAR_GUARDIANTARGETLEFT" },
            { "id": "95", "alias": "VAR_GUARDIANTARGETRIGHT" },
            { "id": "96", "alias": "VAR_GUARDIANACTIVE" },
            { "id": "97", "alias": "VAR_GUARDIANCOREHEALTH" },
            { "id": "98", "alias": "VAR_GUARDIANCLEARED" },
            { "id": "150", "alias": "VAR_ENCOUNTEREPOCH" }
        ],
        "locals": [
            { "local": "L0", "alias": "VAR_S11A8_LOCAL_0" },
            { "local": "L1", "alias": "VAR_S11A8_LOCAL_1" },
            { "local": "L2", "alias": "VAR_S11A8_LOCAL_2" },
            { "local": "L3", "alias": "VAR_S11A8_LOCAL_3" },
            { "local": "L4", "alias": "VAR_S11A8_LOCAL_4" },
            { "local": "L5", "alias": "VAR_S11A8_LOCAL_5" }
        ],
        "render": ["L4"],
        "contact": ["L4", "L5"]
    },
    "engineRenderReads": ["8", "21", "58", "59", "64", "65", "92", "93", "94", "95", "96", "97", "98", "150"],
    "combatContactReads": ["8", "92", "93", "94", "95", "96", "97", "98", "150"],
    "wardenBranches": ["shot", "move", "lowShot", "highShot", "lift", "drop"],
    "wardenOperations": {
        "after_lift": { "reads": ["8", "21", "58", "59", "62", "63", "150"], "writes": ["63", "181", "182", "183", "209"], "locals": [], "children": [] },
        "after_drop": { "reads": ["8", "21", "58", "59", "62", "63"], "writes": ["63", "209"], "locals": [], "children": [] }
    },
    "nativeSprites": [
        {
            "id": "b2e97c83-080a-5fa8-bc04-bd9bbf217c42",
            "symbol": "sprite_wrecklight_keelhook_v01",
            "filename": "wrecklight_keelhook_v02.png",
            "metadataPath": "assets/sprites/wrecklight_keelhook_v02.png.gbsres"
        },
        {
            "id": "2a523678-530a-537f-a722-7169c32c2a8e",
            "symbol": "sprite_wrecklight_wake_vulture_v01",
            "filename": "wrecklight_wake_vulture_budget_v02.png",
            "metadataPath": "assets/sprites/wrecklight_wake_vulture_budget_v02.png.gbsres"
        },
        {
            "id": "199ec23d-6d3e-56ad-a859-f9362cec3c10",
            "symbol": "sprite_wrecklight_crown_sovereign_v01",
            "filename": "wrecklight_crown_sovereign_v01.png",
            "metadataPath": "assets/sprites/wrecklight_crown_sovereign_v01.png.gbsres"
        }
    ]
};
//# sourceMappingURL=composed-gameplay.js.map