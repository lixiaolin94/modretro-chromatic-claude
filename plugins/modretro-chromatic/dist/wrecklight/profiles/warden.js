// Maintained Warden Deck successor, separate from the original current profile.
// Only reviewed native source/metadata and structural identities; no gameplay receipts.
import { WRECKLIGHT_CURRENT_REVIEW } from "./current.js";
const changedSources = [
    {
        "path": "plugins/wrecklight-controller/engine/src/core/core.c.patch",
        "bytes": 5461,
        "sha256": "3a3d2e01acb23f45fe70bc5ecfc74944033767f4d060324b291f63d2d994bf7b"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_combat.c",
        "bytes": 12157,
        "sha256": "1def85cdad234023eeef2ee7444d2a92b70cd622eb7c037a1f1cd41feeeac041"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_presentation.c",
        "bytes": 49621,
        "sha256": "21d5afd6f4a46eb016a5c0f4373b8620335bdc404bf1449aed15304ad59aa1aa"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_world.c",
        "bytes": 30103,
        "sha256": "42426e0528446e180101bc3ba33bfe286db7a2e23cda07f968546d2e3eb33670"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/include/wrecklight_map_bindings.h",
        "bytes": 1292,
        "sha256": "7c822f806a30ca3b21c793facc02690d29dd8a26928e7da19fb73069c4a3a9d2"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/include/wrecklight_map_data.h",
        "bytes": 12593,
        "sha256": "1d4a1defba83056efef3923b37f2fd1daecf15aede677f20d04270070796bef9"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/include/wrecklight_map_variables.h",
        "bytes": 7209,
        "sha256": "5a85bdbd79340016b13a615275c7b8a7b4dc53ad8f648c5456690a99774f60eb"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_pause.c",
        "bytes": 34133,
        "sha256": "2d6b5063027b1125715a8ac9ba1984af73a4973ccac8e16d0cb4348f3502e3ee"
    },
    {
        "path": "plugins/wrecklight-map-pause/events/eventWrecklightMap.js",
        "bytes": 7338,
        "sha256": "9443b1353fcf891976fa43c0e7c25084465715de9aba10e5c815532257cbfd7d"
    },
    {
        "path": "plugins/wrecklight-map-pause/events/map-variable-ids.json",
        "bytes": 3558,
        "sha256": "b1b85fc3de52507e19dfd36a6eff6d3e704e81b29ace974e6c11fbd3cecf32f5"
    },
    {
        "path": "project/settings.gbsres",
        "bytes": 2612,
        "sha256": "4ba94afeae292f23fdb811fff9862188c30c989eff3ee9a1e3aa2158c3d9690f"
    },
    {
        "path": "project/variables.gbsres",
        "bytes": 65258,
        "sha256": "0c6971a398851e98cd3a8a652212548385754842b6a4412dbce4abe9e0ed44db"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_door_maps.c",
        "bytes": 10649,
        "sha256": "d45eaacf5b112ae49634eeeb05d2956279dea00f702f5dcdb9a7ad0f8f7d5bd0"
    },
    {
        "path": "plugins/wrecklight-controller/engine/include/wrecklight_door_map_data.h",
        "bytes": 14542,
        "sha256": "3b4b42600cf79afa52aeeb7a2b59dffb3e551db2bcf8b9f70f6f2d79218f02ba"
    },
    {
        "path": "plugins/wrecklight-controller/engine/include/wrecklight_door_maps.h",
        "bytes": 813,
        "sha256": "065f9485ff5b2c7d01ed9d88f33c14a5b6d831d814e65defee27219189c07c44"
    }
];
export const WRECKLIGHT_WARDEN_REVIEW = {
    ...WRECKLIGHT_CURRENT_REVIEW,
    // Keep the old sprite metadata pinned: it still contributes compiled state names.
    project: [...WRECKLIGHT_CURRENT_REVIEW.project.map((binding) => changedSources.find((changed) => changed.path === binding.path) ?? binding),
        { "path": "assets/sprites/wrecklight_hero_eyehead_v01.png.gbsres", "bytes": 531198, "sha256": "bd764a18cf9196c3b577fd8b15024c1ad0971531d9598241b3fadd6ada5c6a34" }],
    player: {
        "id": "1bd87af7-d968-5891-9d00-119d1668901d",
        "symbol": "sprite_wrecklight_optical_salvager_v01",
        "filename": "wrecklight_hero_eyehead_v01.png",
        "metadataPath": "assets/sprites/wrecklight_hero_eyehead_v01.png.gbsres",
        "states": [
            {
                "id": "95fa914b-7a8d-5353-b45e-8018d70954f8",
                "name": ""
            },
            {
                "id": "e866279b-e19e-5a2e-9620-8234df6ef844",
                "name": "Dynamo"
            },
            {
                "id": "d19b3df5-51bf-53b2-91bd-80c0685bd71d",
                "name": "WL_Fall"
            },
            {
                "id": "06e00da2-36f7-52b0-93e1-f76936c19a2d",
                "name": "WL_AirImpulse"
            },
            {
                "id": "65d147b9-5dcf-57fe-82b1-a531c51ca9f0",
                "name": "WL_Fire"
            },
            {
                "id": "efa3d36f-aa17-5a59-8aa5-eeb3793a8bb7",
                "name": "WL_FallFire"
            },
            {
                "id": "bfc90076-3edb-530c-b0c0-4ec28a656f3a",
                "name": "WL_DynamoFire"
            },
            {
                "id": "c26a492c-3a89-506f-a095-51d8d61824c2",
                "name": "WL_Hurt"
            },
            {
                "id": "1afc567d-42d5-51f1-969b-c5e677da1917",
                "name": "WL_Land"
            },
            {
                "id": "e71afd49-fce4-5686-84ed-c3a88092c23e",
                "name": "WL_Turn"
            },
            {
                "id": "182eb32b-c532-5c88-9aa9-a3f3771e7459",
                "name": "WL_Death"
            },
            {
                "id": "069fa0af-9cfa-545f-9ea2-cba1581118a1",
                "name": "DASH_LAUNCH"
            },
            {
                "id": "e7404eb5-b6cf-516f-a7c6-3fd480158b22",
                "name": "DASH_TRAVEL"
            },
            {
                "id": "e0f1f97c-4632-57aa-b053-1238fb1754c5",
                "name": "DASH_RECOVER"
            },
            {
                "id": "3b528f1f-654e-5336-ba05-83c0e69dea51",
                "name": "WALL_BRACE"
            },
            {
                "id": "c41ae025-e69d-5061-b679-2578ac23974c",
                "name": "WALL_KICK"
            },
            {
                "id": "919ef2ba-9f98-5179-9ba7-d676f36980a1",
                "name": "GRAPPLE_ATTACH"
            },
            {
                "id": "6082e7e4-5a80-5beb-b17d-af0e74f34dc8",
                "name": "GRAPPLE_TENSION"
            },
            {
                "id": "52f2ab48-c447-5a24-85eb-30b90eb9857f",
                "name": "GRAPPLE_RELEASE"
            },
            {
                "id": "63a0f9b7-9e21-5804-aea8-1e2d35c6d827",
                "name": "WL_PogoStrike"
            },
            {
                "id": "1f1a63d1-830f-52d0-88cb-e85e6f3ec3b5",
                "name": "WL_PogoBounce"
            },
            {
                "id": "ea983208-aafd-5792-9c79-ef4af274ff19",
                "name": "WL_Crouch"
            },
            {
                "id": "f7deb194-0897-53c8-8223-4855b1fa5469",
                "name": "WL_Brake"
            }
        ]
    },
    variables: [...WRECKLIGHT_CURRENT_REVIEW.variables, ...[
            {
                "id": "605",
                "symbol": "VAR_WLMAP368"
            },
            {
                "id": "606",
                "symbol": "VAR_WLMAP369"
            },
            {
                "id": "607",
                "symbol": "VAR_WLMAP370"
            },
            {
                "id": "608",
                "symbol": "VAR_WLMAP371"
            },
            {
                "id": "629",
                "symbol": "VAR_WLMAP392"
            },
            {
                "id": "630",
                "symbol": "VAR_WLMAP393"
            },
            {
                "id": "631",
                "symbol": "VAR_WLMAP394"
            },
            {
                "id": "632",
                "symbol": "VAR_WLMAP395"
            }
        ]],
    rooms: [
        ...WRECKLIGHT_CURRENT_REVIEW.rooms.map((room) => room.room === 3 ? {
            "room": 3,
            "id": "868a3167-80f5-542b-8352-084c0c4808da",
            "symbol": "scene_drive_hall",
            "resourcePath": "project/scenes/drive_hall/scene.gbsres",
            "actorCount": 12,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "drive_hud",
                    "filename": "drive_health.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "drive_manager",
                    "filename": "drive_rivet_and_grace.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "drive_telemetry",
                    "filename": "drive_source_telemetry.gbsres"
                },
                {
                    "slot": 4,
                    "index": 4,
                    "id": "drive_systems",
                    "filename": "installed_systems_and_core.gbsres"
                },
                {
                    "slot": 5,
                    "index": 5,
                    "id": "drive_skimmer",
                    "filename": "drive_charging_skimmer.gbsres"
                },
                {
                    "slot": 6,
                    "index": 7,
                    "id": "drive_cover",
                    "filename": "drive_cover.gbsres"
                },
                {
                    "slot": 7,
                    "index": 8,
                    "id": "drive_guard_left",
                    "filename": "drive_guard_left.gbsres"
                },
                {
                    "slot": 8,
                    "index": 9,
                    "id": "drive_guard_right",
                    "filename": "drive_guard_right.gbsres"
                },
                {
                    "slot": 9,
                    "index": 10,
                    "id": "drive_reward_top",
                    "filename": "drive_reward_top.gbsres"
                },
                {
                    "slot": 10,
                    "index": 11,
                    "id": "drive_reward_mid",
                    "filename": "drive_reward_mid.gbsres"
                },
                {
                    "slot": 11,
                    "index": 12,
                    "id": "drive_reward_bottom",
                    "filename": "drive_reward_bottom.gbsres"
                },
                {
                    "slot": 12,
                    "index": 14,
                    "id": "45ff9e95-1260-52cb-92dc-1fa20adae95d",
                    "filename": "cutter_weld_e16.gbsres"
                }
            ]
        } : room),
        {
            "room": 17,
            "id": "974907dc-dd5e-492f-827b-58ab3b78fdb4",
            "symbol": "scene_warden_deck",
            "resourcePath": "project/scenes/warden_deck/scene.gbsres",
            "actorCount": 6,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "deck_hud",
                    "filename": "deck_health.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "deck_manager",
                    "filename": "deck_rivet_and_grace.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "deck_telemetry",
                    "filename": "deck_source_telemetry.gbsres"
                },
                {
                    "slot": 4,
                    "index": 3,
                    "id": "deck_systems",
                    "filename": "deck_systems.gbsres"
                },
                {
                    "slot": 5,
                    "index": 4,
                    "id": "drive_guard",
                    "filename": "drive_sentry.gbsres"
                },
                {
                    "slot": 6,
                    "index": 5,
                    "id": "dynamo_cache",
                    "filename": "ram_dynamo.gbsres"
                }
            ]
        }
    ],
    enemyScenes: { drive_guard: "974907dc-dd5e-492f-827b-58ab3b78fdb4", drive_skimmer: "868a3167-80f5-542b-8352-084c0c4808da" },
    targets: WRECKLIGHT_CURRENT_REVIEW.targets.map((target) => target.room === 3 && target.slot === 6 ? { ...target, room: 17, slot: 5 } : target),
    backgrounds: [...WRECKLIGHT_CURRENT_REVIEW.backgrounds, {
            "sceneId": "974907dc-dd5e-492f-827b-58ab3b78fdb4",
            "id": "f0bc1898-b4d4-5477-baf4-f683f9faaf6f",
            "metadataPath": "assets/backgrounds/warden_deck_v02.png.gbsres",
            "width": 320,
            "height": 192
        }],
    runtime: {
        ...WRECKLIGHT_CURRENT_REVIEW.runtime,
        mapWords: [...WRECKLIGHT_CURRENT_REVIEW.runtime.mapWords, "605", "606", "607", "608", "629", "630", "631", "632"],
        seen: [...WRECKLIGHT_CURRENT_REVIEW.runtime.seen, "605", "606", "607", "608"],
        visited: [...WRECKLIGHT_CURRENT_REVIEW.runtime.visited, "629", "630", "631", "632"],
        newGameWrites: [...WRECKLIGHT_CURRENT_REVIEW.runtime.newGameWrites, "605", "606", "607", "608", "629", "630", "631", "632"],
    },
};
// ROM37 lets the existing local DOOR OPEN notice yield to two existing HUD
// cues. Only those predicates changed; the reviewed effects and resources did
// not. Keep r36 intact and require the complete successor binding set.
export const WRECKLIGHT_WARDEN_CUE_REVIEW = {
    ...WRECKLIGHT_WARDEN_REVIEW,
    project: WRECKLIGHT_WARDEN_REVIEW.project.map((binding) => binding.path === "plugins/wrecklight-controller/engine/src/core/wrecklight_presentation.c"
        ? { ...binding, bytes: 49653, sha256: "3bc4159f3485f1e4e815173ec1284a12f11d09e9015c7a52abd6b969a289ac03" }
        : binding),
};
// Coherent gameplay-feedback review: ground/coyote jump facing, shorter HUD
// acknowledgments, the existing Bay door cue, and modal entry/item labels.
// These change native behavior, not the reviewed variable/resource union.
// Require all three files together; do not accept an arbitrary gameplay edit.
const feedbackSources = [
    {
        path: "plugins/wrecklight-controller/engine/src/states/platform.c.patch",
        bytes: 55937,
        sha256: "f93189d300a873bb874a891aee5820f292a80abb00ee3aee75469ebd0565ea4d",
    },
    {
        path: "plugins/wrecklight-controller/engine/src/core/wrecklight_presentation.c",
        bytes: 51542,
        sha256: "499be106a399ddfb064d69d296c76a78296ec8653e38b83a72594e2ca1c2679d",
    },
    {
        path: "plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_pause.c",
        bytes: 35843,
        sha256: "80e4be0f5e898be0b5695020433ea52a3a95b5c63e67a5b0e38aa2aa209670d5",
    },
];
export const WRECKLIGHT_WARDEN_FEEDBACK_REVIEW = {
    ...WRECKLIGHT_WARDEN_CUE_REVIEW,
    project: WRECKLIGHT_WARDEN_CUE_REVIEW.project.map((binding) => feedbackSources.find((changed) => changed.path === binding.path) ?? binding),
};
// The Condenser cue now names the Bay exit only at the eastern doorway's
// height. The existing coordinate inputs, notices and dependency effects stay
// unchanged; retain the complete gameplay-feedback helper set around it.
export const WRECKLIGHT_WARDEN_CONDENSER_REVIEW = {
    ...WRECKLIGHT_WARDEN_FEEDBACK_REVIEW,
    project: WRECKLIGHT_WARDEN_FEEDBACK_REVIEW.project.map((binding) => binding.path === "plugins/wrecklight-controller/engine/src/core/wrecklight_presentation.c"
        ? { ...binding, bytes: 51687, sha256: "7aa3253338858f808bbe7a8f927fba166258ced186aab5c9069c7b67ff6c3b95" }
        : binding),
};
// ROM44 adds live Dash, Brakemaw recovery and Sump-return HUD guidance.
// Modal close/save redraws can read these values; prior alternatives retain
// their original effects. CapacityCondenser also needs its compiler alias.
export const WRECKLIGHT_WARDEN_ROM44_REVIEW = {
    ...WRECKLIGHT_WARDEN_CONDENSER_REVIEW,
    project: WRECKLIGHT_WARDEN_CONDENSER_REVIEW.project.map((binding) => binding.path === "plugins/wrecklight-controller/engine/src/core/wrecklight_presentation.c"
        ? { ...binding, bytes: 55779, sha256: "5211f8aba34a3cff946dc2e791eac955818ad8379e8587cd6c933a43148cb773" }
        : binding),
    variables: [...WRECKLIGHT_WARDEN_CONDENSER_REVIEW.variables,
        { id: "78", symbol: "VAR_CAPACITYCONDENSER" }],
    runtime: {
        ...WRECKLIGHT_WARDEN_CONDENSER_REVIEW.runtime,
        hudReads: [...WRECKLIGHT_WARDEN_CONDENSER_REVIEW.runtime.hudReads, "220", "136", "137", "141", "78"],
    },
};
// One coherent successor: Dynamo's floor coupler and corrected HUD strings,
// plus the ordinary point-blank door sweep. Keep ROM44 and earlier alternatives
// intact. The two authored reset/return events are indexed normally, not hidden
// effects of MAP newGame/loaded. Native frame updates are not script callbacks.
const dynamoBeamSources = [
    {
        path: "plugins/wrecklight-controller/engine/include/wrecklight_traversal.h",
        bytes: 1913,
        sha256: "1d3abfa72300c6e71e40f74b07201be155d7cc9623eb299155cb3b76f78c5a5e",
    },
    {
        path: "plugins/wrecklight-controller/engine/src/core/wrecklight_presentation.c",
        bytes: 56395,
        sha256: "4d1ecbd3b43f7bc526905ed1ecc2a038c61990c6b42fbba40d49cf65d2b9a1ae",
    },
    {
        path: "plugins/wrecklight-controller/engine/src/core/wrecklight_world.c",
        bytes: 32942,
        sha256: "67454b90d7d8d88a3e4a1fd8de32c4993b85e9094a0bc78c1604215c478f45ed",
    },
    {
        path: "plugins/wrecklight-controller/engine/src/states/platform.c.patch",
        bytes: 56077,
        sha256: "123a460cda7f8607aeddf1feecee1b07e6bd66079c4efd1c33654da3455cc1d1",
    },
    {
        path: "plugins/wrecklight-controller/engine/src/core/projectiles.c.patch",
        bytes: 21857,
        sha256: "8446e040de4d0fa6b30a8e849d3bfaab90a758de18b6486af873e876d546d483",
    },
    {
        path: "project/variables.gbsres",
        bytes: 65367,
        sha256: "81a753a4ff208e98d5dc99cbe2ca7e88f072bbbc1c47d22173999f4d7565e54b",
    },
];
export const WRECKLIGHT_WARDEN_DYNAMO_BEAM_REVIEW = {
    ...WRECKLIGHT_WARDEN_ROM44_REVIEW,
    project: [...WRECKLIGHT_WARDEN_ROM44_REVIEW.project.map((binding) => dynamoBeamSources.find((changed) => changed.path === binding.path) ?? binding), {
            path: "plugins/wrecklight-controller/engine/include/wrecklight_coupler_patterns.h",
            bytes: 500,
            sha256: "274b59f20dffd735d62e6256a7cbd6476c329e276a94bb07633fade75cb06e13",
        }],
    variables: [...WRECKLIGHT_WARDEN_ROM44_REVIEW.variables,
        { id: "646", symbol: "VAR_DYNAMOEXITRELEASED" }],
    runtime: {
        ...WRECKLIGHT_WARDEN_ROM44_REVIEW.runtime,
        hudReads: [...WRECKLIGHT_WARDEN_ROM44_REVIEW.runtime.hudReads, "646"],
    },
};
//# sourceMappingURL=warden.js.map