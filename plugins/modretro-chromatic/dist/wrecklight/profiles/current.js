// Maintained current native profile. No game scripts, media, private paths or run receipts.
// Exact native source/metadata closure and structural associations; not gameplay acceptance.
import { WRECKLIGHT_REVIEW } from "./base.js";
export const WRECKLIGHT_CURRENT_REVIEW = {
    compiler: WRECKLIGHT_REVIEW.compiler,
    sound: WRECKLIGHT_REVIEW.sound,
    variables: [...WRECKLIGHT_REVIEW.variables, ...[
            {
                "id": "589",
                "symbol": "VAR_SERVICELIFTRELEASED"
            },
            {
                "id": "590",
                "symbol": "VAR_LOCKERGUARDHEALTH"
            },
            {
                "id": "591",
                "symbol": "VAR_LOCKERGUARDX"
            },
            {
                "id": "592",
                "symbol": "VAR_LOCKERGUARDY"
            },
            {
                "id": "593",
                "symbol": "VAR_LOCKERGUARDDEAD"
            },
            {
                "id": "594",
                "symbol": "VAR_LOCKERGUARDWINDUP"
            },
            {
                "id": "595",
                "symbol": "VAR_LOCKERGUARDFACING"
            },
            {
                "id": "596",
                "symbol": "VAR_LOCKERGUARDSHOTS"
            },
            {
                "id": "597",
                "symbol": "VAR_WLMAP360"
            },
            {
                "id": "598",
                "symbol": "VAR_WLMAP361"
            },
            {
                "id": "599",
                "symbol": "VAR_WLMAP362"
            },
            {
                "id": "600",
                "symbol": "VAR_WLMAP363"
            },
            {
                "id": "601",
                "symbol": "VAR_WLMAP364"
            },
            {
                "id": "602",
                "symbol": "VAR_WLMAP365"
            },
            {
                "id": "603",
                "symbol": "VAR_WLMAP366"
            },
            {
                "id": "604",
                "symbol": "VAR_WLMAP367"
            },
            {
                "id": "621",
                "symbol": "VAR_WLMAP384"
            },
            {
                "id": "622",
                "symbol": "VAR_WLMAP385"
            },
            {
                "id": "623",
                "symbol": "VAR_WLMAP386"
            },
            {
                "id": "624",
                "symbol": "VAR_WLMAP387"
            },
            {
                "id": "625",
                "symbol": "VAR_WLMAP388"
            },
            {
                "id": "626",
                "symbol": "VAR_WLMAP389"
            },
            {
                "id": "627",
                "symbol": "VAR_WLMAP390"
            },
            {
                "id": "628",
                "symbol": "VAR_WLMAP391"
            },
            {
                "id": "645",
                "symbol": "VAR_WLMAP408"
            }
        ]],
    targets: [...WRECKLIGHT_REVIEW.targets, { "room": 14, "slot": 6, "hp": "590", "dead": "593", "phase": null, "armor": 0 }],
    project: [
        {
            "path": "assets/sounds/wrecklight-ui-tick.wav.gbsres",
            "bytes": 200,
            "sha256": "b1961ec9e51edbf5d13a595f43acd43cef61608b041bd3a2736863ab13d4b7fa"
        },
        {
            "path": "plugins/README.md",
            "bytes": 140,
            "sha256": "6fcd1de584237e28305f21cce86a0999db68de05ca18b87ffa798677e7ef547d"
        },
        {
            "path": "plugins/wrecklight-controller/engine/engine.json",
            "bytes": 7412,
            "sha256": "dcd653b2adf969f94c997485921982885e390a56f368f2f6a5fefb705b814a53"
        },
        {
            "path": "plugins/wrecklight-controller/engine/include/projectiles.h.patch",
            "bytes": 489,
            "sha256": "8305c923b34570ad2ad2ab488479c0c9ca13623c4fd07df4865ae75e8b154cdb"
        },
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_audio.h",
            "bytes": 354,
            "sha256": "0329cc1696dcb80fd240fac5bc9616516fea88b2f64edbdb650705838f76c8dc"
        },
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_combat.h",
            "bytes": 1409,
            "sha256": "9421502fae187f96be19b3d47d6d9521f19eca39eb09fdadebde5643f4d774bc"
        },
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_door_materials.h",
            "bytes": 418,
            "sha256": "8152418e6866bead8e77731b24505fb6caf8d15f210fd397cd021d83b224bfe7"
        },
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_door_patterns.h",
            "bytes": 14382,
            "sha256": "98d6248ad718777b350fa33f2208c062d5a0d9f2129984a7b30c8c3454f81b0a"
        },
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_presentation.h",
            "bytes": 935,
            "sha256": "d90de4d50c305d75d536007c7e7f493421e6d53f227c3104943d4543b7294890"
        },
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_projectiles.h",
            "bytes": 491,
            "sha256": "2cea926c907648aab91c0760c8ec254955e6fa09c5119862e10d7d213b177293"
        },
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_render.h",
            "bytes": 607,
            "sha256": "32c85a4ca80fe6ae8de070a17d1299d949ae306469cc19d0d43cd8a02272751b"
        },
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_traversal.h",
            "bytes": 1844,
            "sha256": "c68a38ddd980c7737104b6e087103dbda67b29ef219effc70786103cfea6df06"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/actor.c.patch",
            "bytes": 2322,
            "sha256": "cc6f0136fff0df6f79a9076ae92413842de7f3f611003567bc84321405330cf5"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/core.c.patch",
            "bytes": 5342,
            "sha256": "41ee547c99981d0fa44011e10a5bd1c2c61db6d982e67cd9c8c15e7259f04725"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/data_manager.c.patch",
            "bytes": 520,
            "sha256": "bf6e8f9b7b6fec2a7bccf83733cccd1eef4e9f306f33ff2f9590eeada1106273"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/projectiles.c.patch",
            "bytes": 20914,
            "sha256": "d9f1e86b4d0c40d8ef5e50e99c73977626a21249852b86ac5d3029470842beb8"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/vm.c.patch",
            "bytes": 2080,
            "sha256": "0f93f01b79952bb152c73a69d854a97cef81fabb07b2d188e85f745304903f8c"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_audio.c",
            "bytes": 1673,
            "sha256": "bf1ac672778628114a1a584622ff4b3100240ca39fdc5579501b95e40dcf076e"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_combat.c",
            "bytes": 12150,
            "sha256": "1150fc6e9578d2a44042e624c5958890306ed32ad178572c95c71376d4347d11"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_controls.c",
            "bytes": 1696,
            "sha256": "0f141b090685d0bf7fac4671495ed04b07574e73d524504bfda103e739700ee9"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_enemy_conditions.c",
            "bytes": 4226,
            "sha256": "486b19d22d393a57839831fae4a2a0d412bdaecdfaa250e42ce76669ef2ca16f"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_enemy_ticks.c",
            "bytes": 8515,
            "sha256": "755843127cebb061e26333e45674c686551c0b53bbe050fdf2d12bf1363c6d9c"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_presentation.c",
            "bytes": 48400,
            "sha256": "13f02123514d477a43e574939e45ab059206cf83b1f745a1a60a3e5b950e563a"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_projectiles.c",
            "bytes": 5335,
            "sha256": "bd98875eda3e15e1eeae0505318b94a380c2b865b13d3e16282c598d2dd9d444"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_render.c",
            "bytes": 1647,
            "sha256": "ab96fbcade540f01a59bb6ac6cd043f5c90b19e072d7ed5fa12a10132bd8b0a0"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_rewards.c",
            "bytes": 10476,
            "sha256": "a90c5b99cc85f95dc3613052a7fcfe14b9335295c092737e6dc392a84bf19b91"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_world.c",
            "bytes": 29799,
            "sha256": "8443ed32275868fdd3f3191164df648daa65307738e4271e3d8f1b3d84105967"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/states/platform.c.patch",
            "bytes": 55659,
            "sha256": "aff7b9e6923d5dfd2d0f14837673674936e277c239a62578c34ecc952e7e4b15"
        },
        {
            "path": "plugins/wrecklight-controller/events/combat-variable-ids.json",
            "bytes": 445,
            "sha256": "5fe6702de24c8b8a8e6c2bb3c5542528c2b6948cf5febe1f49697b4dfaab75a8"
        },
        {
            "path": "plugins/wrecklight-controller/events/eventWrecklightCombat.js",
            "bytes": 2688,
            "sha256": "7b2499474d520ea38bea0b63093082cc384a4ac956a23ec4b766b20e8bdcbd7b"
        },
        {
            "path": "plugins/wrecklight-controller/events/eventWrecklightEnemyCondition.js",
            "bytes": 3005,
            "sha256": "2dea2a8fd71cd4b6a94c0d0795102936bb2417c921de82731c5f733367ed6f9f"
        },
        {
            "path": "plugins/wrecklight-controller/events/eventWrecklightEnemyTick.js",
            "bytes": 1886,
            "sha256": "5ab42cafdf4b417d9b30550b81399ec136aa03c00e877054d5aadf947bd18e4e"
        },
        {
            "path": "plugins/wrecklight-controller/plugin.json",
            "bytes": 168,
            "sha256": "6a40cdc199f398ad7f223f04aa4272c86b19d78b9b441912442e8a37eb8e32ef"
        },
        {
            "path": "plugins/wrecklight-map-pause/engine/engine.json",
            "bytes": 44,
            "sha256": "24c32e91ea90ff008e3014b7f0f219cf4c400544cccc274ff0917071c9239119"
        },
        {
            "path": "plugins/wrecklight-map-pause/engine/include/wrecklight_map_bindings.h",
            "bytes": 1253,
            "sha256": "e48e6e2837628bce2b74f7988434003ad2a481fde11c4a368275a4a1ac1fa3cf"
        },
        {
            "path": "plugins/wrecklight-map-pause/engine/include/wrecklight_map_data.h",
            "bytes": 12084,
            "sha256": "5e69272b80822ea1972c08fa80d7cf93a18bd9956b1532a8b6cd644dc812c1ba"
        },
        {
            "path": "plugins/wrecklight-map-pause/engine/include/wrecklight_map_pause.h",
            "bytes": 1470,
            "sha256": "a659c326617fd0dc02f8e58fa6979d07242f3923ba4afbe32e9bc5e73ab0bacf"
        },
        {
            "path": "plugins/wrecklight-map-pause/engine/include/wrecklight_map_tiles.h",
            "bytes": 4523,
            "sha256": "28d9d8795b8835b7a11a1af6ad93db7d6f8ee0701f91a3f8f28a79e69f881753"
        },
        {
            "path": "plugins/wrecklight-map-pause/engine/include/wrecklight_map_variables.h",
            "bytes": 7065,
            "sha256": "e861b75be3caee2ce7e51aafcc1f23cd2ea09c1e82009d4301e9ca027db86cbb"
        },
        {
            "path": "plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_pause.c",
            "bytes": 33979,
            "sha256": "f7100cd86bb0a4e97cec764a442bde0707d514770d900686e230874ac6007f3b"
        },
        {
            "path": "plugins/wrecklight-map-pause/events/eventWrecklightMap.js",
            "bytes": 7266,
            "sha256": "0098d580f0bd184893345bb262a3771bc20b96b0589643bdc3b75fb69857c5c1"
        },
        {
            "path": "plugins/wrecklight-map-pause/events/map-variable-ids.json",
            "bytes": 3486,
            "sha256": "88d0aa42da9fc6bd056af2df8e5da0a86d5ed28c0124e502f761982d51423846"
        },
        {
            "path": "plugins/wrecklight-map-pause/plugin.json",
            "bytes": 197,
            "sha256": "88f23761f61d605a99e52f764bc6e9490468c5d7852ab56cff41de2a911b13ba"
        },
        {
            "path": "project.gbsproj",
            "bytes": 168,
            "sha256": "c24e0d25113058ecfe3128f63e5a25b4f4bdb83522919f2ce5a7a8e4c37c8764"
        },
        {
            "path": "project/engine_field_values.gbsres",
            "bytes": 2684,
            "sha256": "9901d50cbb5dbe2f69b0fce115906d5bc3ea5a8639645cff64a50c12343a9abb"
        },
        {
            "path": "project/settings.gbsres",
            "bytes": 2612,
            "sha256": "00d9fdf34fbf483aaaeb6f8c5de56228b65a8fb2e1975623c9982fc2986d6ab5"
        },
        {
            "path": "project/variables.gbsres",
            "bytes": 64426,
            "sha256": "f8c3b2fb04e3545eaa1e1aa0e35be65429470e34546432c6a08b7e1381795366"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_door_maps.c",
            "bytes": 10326,
            "sha256": "dd1ac1229b8edb1d376cbf3f798b1a27f9241b60800bc6f39664256599ea7175"
        },
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_door_map_data.h",
            "bytes": 14223,
            "sha256": "e7f52096bf2c3996d574be02a375ba8979593d61ff6b2cdbb8e90363200cfaa3"
        },
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_door_maps.h",
            "bytes": 813,
            "sha256": "2b63060e424a084c04e7ed0536716d261034ea06d48a6e5652507fa90b8961d8"
        },
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_leaf_renderer.h",
            "bytes": 314,
            "sha256": "ea6b9f7d1459d79d2d270ffb552f01fee1d68ce129732eb24b3a20fb07031fc9"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_leaf_renderer.c",
            "bytes": 1576,
            "sha256": "ce691d90d49068b531860c58fa516d2c80a7e67f97af00fb30d8988db5ecc12b"
        },
        {
            "path": "assets/sprites/wrecklight_hero_salvager_v02.png.gbsres",
            "bytes": 531269,
            "sha256": "2f487381865b5c270fc1e12b818c2986bab7dd38587040571c5f44c823f3622a"
        }
    ],
    rooms: [
        {
            "room": 0,
            "id": "12f07015-0a42-504a-8d39-3f689e13ad3a",
            "symbol": "scene_start",
            "resourcePath": "project/scenes/start/scene.gbsres",
            "actorCount": 11,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "hud",
                    "filename": "health.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "manager",
                    "filename": "rivet_and_grace.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "telemetry",
                    "filename": "source_telemetry.gbsres"
                },
                {
                    "slot": 4,
                    "index": 3,
                    "id": "guard",
                    "filename": "salvage_guard.gbsres"
                },
                {
                    "slot": 5,
                    "index": 9,
                    "id": "systems",
                    "filename": "installed_systems_and_core.gbsres"
                },
                {
                    "slot": 6,
                    "index": 12,
                    "id": "core_socket",
                    "filename": "extraction_core_socket.gbsres"
                },
                {
                    "slot": 7,
                    "index": 13,
                    "id": "a385b3f9-1f01-59bc-aaa9-1c9bcf1bdf7d",
                    "filename": "solid_cover_projectile_face.gbsres"
                },
                {
                    "slot": 8,
                    "index": 14,
                    "id": "7e90f3da-7672-504c-b4ca-d7542f07a2b4",
                    "filename": "solid_cover_projectile_face_2.gbsres"
                },
                {
                    "slot": 9,
                    "index": 15,
                    "id": "bbd61bfb-e3e2-5e0f-b4ba-cb0ecc538e4d",
                    "filename": "power_shutter_e11.gbsres"
                },
                {
                    "slot": 10,
                    "index": 16,
                    "id": "d03c2195-a938-588e-8785-037ff85a8e72",
                    "filename": "power_shutter_e19.gbsres"
                },
                {
                    "slot": 11,
                    "index": 17,
                    "id": "d400af8c-8497-551b-95bd-1dbaa7d45748",
                    "filename": "safe_service_station.gbsres"
                }
            ]
        },
        {
            "room": 1,
            "id": "7f23a478-4d91-55d1-9c4e-6d2bba24caba",
            "symbol": "scene_airworks",
            "resourcePath": "project/scenes/airworks/scene.gbsres",
            "actorCount": 12,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "works_hud",
                    "filename": "airworks_health.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "works_manager",
                    "filename": "airworks_rivet_and_grace.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "works_telemetry",
                    "filename": "airworks_source_telemetry.gbsres"
                },
                {
                    "slot": 4,
                    "index": 4,
                    "id": "works_guard",
                    "filename": "airworks_guard.gbsres"
                },
                {
                    "slot": 5,
                    "index": 5,
                    "id": "dc2eb41e-4439-5f9c-9f18-34ac4cf31149",
                    "filename": "drive_cadence_trim.gbsres"
                },
                {
                    "slot": 6,
                    "index": 6,
                    "id": "works_first_left",
                    "filename": "works_first_left.gbsres"
                },
                {
                    "slot": 7,
                    "index": 7,
                    "id": "works_first_right",
                    "filename": "works_first_right.gbsres"
                },
                {
                    "slot": 8,
                    "index": 8,
                    "id": "works_guard_left",
                    "filename": "works_guard_left.gbsres"
                },
                {
                    "slot": 9,
                    "index": 9,
                    "id": "works_guard_right",
                    "filename": "works_guard_right.gbsres"
                },
                {
                    "slot": 10,
                    "index": 10,
                    "id": "works_reward_wall",
                    "filename": "works_reward_wall.gbsres"
                },
                {
                    "slot": 11,
                    "index": 11,
                    "id": "works_systems",
                    "filename": "installed_systems_and_core.gbsres"
                },
                {
                    "slot": 12,
                    "index": 12,
                    "id": "works_skimmer",
                    "filename": "airworks_charging_skimmer.gbsres"
                }
            ]
        },
        {
            "room": 2,
            "id": "fd880ba8-f473-53eb-9363-b07097aac89c",
            "symbol": "scene_condenser_junction",
            "resourcePath": "project/scenes/condenser_junction/scene.gbsres",
            "actorCount": 6,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "v14_c_hud",
                    "filename": "health_and_capacity.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "v14_c_systems",
                    "filename": "installed_tools_and_carried_core.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "v14_c_manager",
                    "filename": "independent_rivet_and_damage_grace.gbsres"
                },
                {
                    "slot": 4,
                    "index": 3,
                    "id": "v14_c_telemetry",
                    "filename": "source_telemetry.gbsres"
                },
                {
                    "slot": 5,
                    "index": 4,
                    "id": "342954c6-c5ff-5dc7-91ad-b6308833c9c2",
                    "filename": "capacity_cache.gbsres"
                },
                {
                    "slot": 6,
                    "index": 5,
                    "id": "77d302ed-37bb-5a18-887b-68632da7054b",
                    "filename": "cutter_weld_e12.gbsres"
                }
            ]
        },
        {
            "room": 3,
            "id": "868a3167-80f5-542b-8352-084c0c4808da",
            "symbol": "scene_drive_hall",
            "resourcePath": "project/scenes/drive_hall/scene.gbsres",
            "actorCount": 14,
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
                    "index": 6,
                    "id": "drive_guard",
                    "filename": "drive_sentry.gbsres"
                },
                {
                    "slot": 7,
                    "index": 7,
                    "id": "drive_cover",
                    "filename": "drive_cover.gbsres"
                },
                {
                    "slot": 8,
                    "index": 8,
                    "id": "drive_guard_left",
                    "filename": "drive_guard_left.gbsres"
                },
                {
                    "slot": 9,
                    "index": 9,
                    "id": "drive_guard_right",
                    "filename": "drive_guard_right.gbsres"
                },
                {
                    "slot": 10,
                    "index": 10,
                    "id": "drive_reward_top",
                    "filename": "drive_reward_top.gbsres"
                },
                {
                    "slot": 11,
                    "index": 11,
                    "id": "drive_reward_mid",
                    "filename": "drive_reward_mid.gbsres"
                },
                {
                    "slot": 12,
                    "index": 12,
                    "id": "drive_reward_bottom",
                    "filename": "drive_reward_bottom.gbsres"
                },
                {
                    "slot": 13,
                    "index": 13,
                    "id": "dynamo_cache",
                    "filename": "ram_dynamo.gbsres"
                },
                {
                    "slot": 14,
                    "index": 14,
                    "id": "45ff9e95-1260-52cb-92dc-1fa20adae95d",
                    "filename": "cutter_weld_e16.gbsres"
                }
            ]
        },
        {
            "room": 4,
            "id": "3738d8e9-495f-5d2e-a083-18dd78632415",
            "symbol": "scene_coil_loft",
            "resourcePath": "project/scenes/coil_loft/scene.gbsres",
            "actorCount": 7,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "v14_l_hud",
                    "filename": "health_and_capacity.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "v14_l_systems",
                    "filename": "installed_tools_and_carried_core.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "v14_l_manager",
                    "filename": "independent_rivet_and_damage_grace.gbsres"
                },
                {
                    "slot": 4,
                    "index": 3,
                    "id": "v14_l_telemetry",
                    "filename": "source_telemetry.gbsres"
                },
                {
                    "slot": 5,
                    "index": 4,
                    "id": "05b50631-b45d-5e72-bd9c-97888435c947",
                    "filename": "loft_skimmer.gbsres"
                },
                {
                    "slot": 6,
                    "index": 5,
                    "id": "695cb1d6-0e14-5496-9eaf-503bc5cac104",
                    "filename": "rivet_coil.gbsres"
                },
                {
                    "slot": 7,
                    "index": 30,
                    "id": "e5ea59bd-20c6-5f74-b3ce-0f3d2713cf28",
                    "filename": "wl_wall_jump_module.gbsres"
                }
            ]
        },
        {
            "room": 5,
            "id": "96367a24-9989-5971-bc5a-d26e30b28397",
            "symbol": "scene_cargo_span",
            "resourcePath": "project/scenes/cargo_span/scene.gbsres",
            "actorCount": 7,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "cargo_hud",
                    "filename": "cargo_health.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "cargo_manager",
                    "filename": "cargo_rivet_and_grace.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "cargo_telemetry",
                    "filename": "cargo_source_telemetry.gbsres"
                },
                {
                    "slot": 4,
                    "index": 4,
                    "id": "cargo_systems",
                    "filename": "installed_systems_and_core.gbsres"
                },
                {
                    "slot": 5,
                    "index": 5,
                    "id": "cargo_guard",
                    "filename": "cargo_sentry.gbsres"
                },
                {
                    "slot": 6,
                    "index": 6,
                    "id": "cargo_farwall_top",
                    "filename": "cargo_farwall_top.gbsres"
                },
                {
                    "slot": 7,
                    "index": 7,
                    "id": "cargo_farwall_bottom",
                    "filename": "cargo_farwall_bottom.gbsres"
                }
            ]
        },
        {
            "room": 6,
            "id": "f521db84-f386-57db-accf-37aae4c38b3a",
            "symbol": "scene_reactor_well",
            "resourcePath": "project/scenes/reactor_well/scene.gbsres",
            "actorCount": 10,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "v14_r_hud",
                    "filename": "health_and_capacity.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "v14_r_systems",
                    "filename": "installed_tools_and_carried_core.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "v14_r_manager",
                    "filename": "independent_rivet_and_damage_grace.gbsres"
                },
                {
                    "slot": 4,
                    "index": 3,
                    "id": "v14_r_telemetry",
                    "filename": "source_telemetry.gbsres"
                },
                {
                    "slot": 5,
                    "index": 4,
                    "id": "3fd19a9d-aa24-58ff-87b3-aa44b7f6960d",
                    "filename": "reactor_sentry.gbsres"
                },
                {
                    "slot": 6,
                    "index": 5,
                    "id": "be82ae00-8c09-53b3-bae0-887a6b3fc6d8",
                    "filename": "reactor_skimmer.gbsres"
                },
                {
                    "slot": 7,
                    "index": 6,
                    "id": "36d3662a-efbd-537a-89b2-791f20d49542",
                    "filename": "solid_cover_projectile_face.gbsres"
                },
                {
                    "slot": 8,
                    "index": 7,
                    "id": "12ca0347-a08e-565e-b4a9-517b0e217456",
                    "filename": "ship_power_core.gbsres"
                },
                {
                    "slot": 9,
                    "index": 8,
                    "id": "c04eb2f0-82e6-557a-9c76-7acc079a2645",
                    "filename": "service_shutter_e14.gbsres"
                },
                {
                    "slot": 10,
                    "index": 20,
                    "id": "62cc5954-087c-57db-b5b7-054b83dd1660",
                    "filename": "lower_induction_sentinel.gbsres"
                }
            ]
        },
        {
            "room": 7,
            "id": "52cc2a78-76eb-5d64-bc75-5d898191de83",
            "symbol": "scene_pump_gallery",
            "resourcePath": "project/scenes/pump_gallery/scene.gbsres",
            "actorCount": 9,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "v14_p_hud",
                    "filename": "health_and_capacity.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "v14_p_systems",
                    "filename": "installed_tools_and_carried_core.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "v14_p_manager",
                    "filename": "independent_rivet_and_damage_grace.gbsres"
                },
                {
                    "slot": 4,
                    "index": 3,
                    "id": "v14_p_telemetry",
                    "filename": "source_telemetry.gbsres"
                },
                {
                    "slot": 5,
                    "index": 4,
                    "id": "034c572e-f383-57f2-87fd-c3d176bc1970",
                    "filename": "pump_sentry.gbsres"
                },
                {
                    "slot": 6,
                    "index": 5,
                    "id": "46ecac09-7fee-5db2-9688-71248fb49d81",
                    "filename": "capacity_cache.gbsres"
                },
                {
                    "slot": 7,
                    "index": 6,
                    "id": "12bb8019-89d2-53fb-acf5-ba42a167e6a6",
                    "filename": "cutter_weld_e12.gbsres"
                },
                {
                    "slot": 8,
                    "index": 7,
                    "id": "3ab52f1c-afd1-514b-942d-3f0f76676331",
                    "filename": "safe_service_station.gbsres"
                },
                {
                    "slot": 9,
                    "index": 20,
                    "id": "f2b45a68-5da3-5bf7-a52a-593c7a091602",
                    "filename": "pump_east_bellows.gbsres"
                }
            ]
        },
        {
            "room": 8,
            "id": "b6ccbe6c-64d5-51cd-bb2f-e2f1edfe9a30",
            "symbol": "scene_keel_spine",
            "resourcePath": "project/scenes/keel_spine/scene.gbsres",
            "actorCount": 8,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "v14_k_hud",
                    "filename": "health_and_capacity.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "v14_k_systems",
                    "filename": "installed_tools_and_carried_core.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "v14_k_manager",
                    "filename": "independent_rivet_and_damage_grace.gbsres"
                },
                {
                    "slot": 4,
                    "index": 3,
                    "id": "v14_k_telemetry",
                    "filename": "source_telemetry.gbsres"
                },
                {
                    "slot": 5,
                    "index": 4,
                    "id": "90c6494c-616e-50b4-a601-97a85f229098",
                    "filename": "plated_keel_patrol.gbsres"
                },
                {
                    "slot": 6,
                    "index": 5,
                    "id": "83634add-30b9-513a-96ea-cf454bb7ee89",
                    "filename": "cutter_weld_e17.gbsres"
                },
                {
                    "slot": 7,
                    "index": 6,
                    "id": "62d0682e-164a-57dc-9de2-e818ca4dec6c",
                    "filename": "reactor_service_release.gbsres"
                },
                {
                    "slot": 8,
                    "index": 20,
                    "id": "9a3c20a2-6fc5-56f5-8a22-cdb6bff11720",
                    "filename": "keel_east_rib_climber.gbsres"
                }
            ]
        },
        {
            "room": 9,
            "id": "87eb4a35-9aab-5d69-8952-e990ae3d1991",
            "symbol": "scene_turbine_vault",
            "resourcePath": "project/scenes/turbine_vault/scene.gbsres",
            "actorCount": 7,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "v14_t_hud",
                    "filename": "health_and_capacity.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "v14_t_systems",
                    "filename": "installed_tools_and_carried_core.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "v14_t_manager",
                    "filename": "independent_rivet_and_damage_grace.gbsres"
                },
                {
                    "slot": 4,
                    "index": 3,
                    "id": "v14_t_telemetry",
                    "filename": "source_telemetry.gbsres"
                },
                {
                    "slot": 5,
                    "index": 4,
                    "id": "59b6dd9c-0b0d-5a50-adcb-31f3cb7a43db",
                    "filename": "plated_turbine_patrol.gbsres"
                },
                {
                    "slot": 6,
                    "index": 5,
                    "id": "6f86bdf5-a122-512c-9828-a4729dae6a19",
                    "filename": "cutter.gbsres"
                },
                {
                    "slot": 7,
                    "index": 6,
                    "id": "cefed88c-8f2e-56e8-85f3-c63dbf097902",
                    "filename": "cutter_weld_e16.gbsres"
                }
            ]
        },
        {
            "room": 10,
            "id": "803353c8-2162-575a-af58-5ac48b6f8725",
            "symbol": "scene_beacon_mast",
            "resourcePath": "project/scenes/beacon_mast/scene.gbsres",
            "actorCount": 6,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "v14_m_hud",
                    "filename": "health_and_capacity.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "v14_m_systems",
                    "filename": "installed_tools_and_carried_core.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "v14_m_manager",
                    "filename": "independent_rivet_and_damage_grace.gbsres"
                },
                {
                    "slot": 4,
                    "index": 3,
                    "id": "v14_m_telemetry",
                    "filename": "source_telemetry.gbsres"
                },
                {
                    "slot": 5,
                    "index": 4,
                    "id": "0b0f6a36-7500-59b4-b932-d520cdb0d969",
                    "filename": "cutter_weld_e17.gbsres"
                },
                {
                    "slot": 6,
                    "index": 5,
                    "id": "9689eb49-eee2-57aa-8deb-6b8b739ff9ec",
                    "filename": "safe_service_station.gbsres"
                }
            ]
        },
        {
            "room": 11,
            "id": "ea5c2e78-3b17-5d25-8b34-db5e57b7b405",
            "symbol": "scene_relay_crown",
            "resourcePath": "project/scenes/relay_crown/scene.gbsres",
            "actorCount": 10,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "v14_x_hud",
                    "filename": "health_and_capacity.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "v14_x_systems",
                    "filename": "installed_tools_and_carried_core.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "v14_x_manager",
                    "filename": "independent_rivet_and_damage_grace.gbsres"
                },
                {
                    "slot": 4,
                    "index": 3,
                    "id": "v14_x_telemetry",
                    "filename": "source_telemetry.gbsres"
                },
                {
                    "slot": 5,
                    "index": 4,
                    "id": "43a51e76-e2f2-508e-98cd-220a73f8fcd5",
                    "filename": "solid_cover_projectile_face.gbsres"
                },
                {
                    "slot": 6,
                    "index": 5,
                    "id": "7136741e-6a56-5ab1-a44d-bce98ade0f19",
                    "filename": "solid_cover_projectile_face_2.gbsres"
                },
                {
                    "slot": 7,
                    "index": 6,
                    "id": "acde66b2-7942-5be0-ae4d-f2cbe6ef3e9f",
                    "filename": "relay_machine_weld.gbsres"
                },
                {
                    "slot": 8,
                    "index": 7,
                    "id": "4d5586ff-4539-5dfb-8873-a6696736641e",
                    "filename": "relay_machine_weld_2.gbsres"
                },
                {
                    "slot": 9,
                    "index": 8,
                    "id": "d13e3229-95dc-54a4-8377-0b670863def4",
                    "filename": "relay_machine_sequence.gbsres"
                },
                {
                    "slot": 10,
                    "index": 9,
                    "id": "a14de858-f03a-52a6-b429-9fa94193e896",
                    "filename": "beacon_activation_console.gbsres"
                }
            ]
        },
        {
            "room": 12,
            "id": "873627f3-9fc8-5a39-9929-d86991808ee6",
            "symbol": "scene_rivet_walk",
            "resourcePath": "project/scenes/rivet_walk/scene.gbsres",
            "actorCount": 4,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "c6a67156-5886-51f8-8767-b554a1066316",
                    "filename": "health_and_capacity.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "1f782dc1-97f2-5c8d-8082-5b75af49a0f2",
                    "filename": "installed_tools_and_carried_core.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "d3a5f600-c23f-5246-a5b1-fb4be6d142a0",
                    "filename": "damage_grace_native_weapon_owner.gbsres"
                },
                {
                    "slot": 4,
                    "index": 3,
                    "id": "0f41b7ff-0e31-5940-a77b-773fd131075d",
                    "filename": "source_telemetry.gbsres"
                }
            ]
        },
        {
            "room": 13,
            "id": "dd16a0a2-78ff-51d8-8b85-41f62a21d21d",
            "symbol": "scene_bleed_duct",
            "resourcePath": "project/scenes/bleed_duct/scene.gbsres",
            "actorCount": 4,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "26676c19-c560-5c31-ba55-43e617667cd2",
                    "filename": "health_and_capacity.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "ad05d4d3-04ec-5881-ba93-f79096b6b2cc",
                    "filename": "installed_tools_and_carried_core.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "209b88ca-4d67-5f90-8268-449dd2d89717",
                    "filename": "damage_grace_native_weapon_owner.gbsres"
                },
                {
                    "slot": 4,
                    "index": 3,
                    "id": "4e5e9861-4a91-571d-abd2-e10c7d7017dc",
                    "filename": "source_telemetry.gbsres"
                }
            ]
        },
        {
            "room": 14,
            "id": "0f7c0021-3a3e-59a0-8630-7952e81a5708",
            "symbol": "scene_fuse_locker",
            "resourcePath": "project/scenes/fuse_locker/scene.gbsres",
            "actorCount": 6,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "28992170-bd92-5385-b440-c96d97c5db19",
                    "filename": "health_and_capacity.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "c3621459-4e54-5286-aef3-892dd0882970",
                    "filename": "installed_tools_and_carried_core.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "f1db71a1-9295-5997-833c-8bfb803485b2",
                    "filename": "damage_grace_native_weapon_owner.gbsres"
                },
                {
                    "slot": 4,
                    "index": 3,
                    "id": "b9c67fe1-b56b-5407-947d-302e26da00dd",
                    "filename": "source_telemetry.gbsres"
                },
                {
                    "slot": 5,
                    "index": 4,
                    "id": "b41b167f-319b-512d-8e55-bcca758c4dab",
                    "filename": "trim.gbsres"
                },
                {
                    "slot": 6,
                    "index": 5,
                    "id": "e76f1710-0303-548e-928f-832e91bff636",
                    "filename": "locker_return_sentry.gbsres"
                }
            ]
        },
        {
            "room": 15,
            "id": "2e7609cd-b739-58b1-8a97-83ff74334c80",
            "symbol": "scene_sump_cabinet",
            "resourcePath": "project/scenes/sump_cabinet/scene.gbsres",
            "actorCount": 5,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "efe1e454-1617-58ff-9498-15f2cbf38690",
                    "filename": "health_and_capacity.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "ecfd3da6-f86f-5df4-8fce-2f3a1a084917",
                    "filename": "installed_tools_and_carried_core.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "70d5ce63-00e4-5525-8757-ef9b55c76a8f",
                    "filename": "damage_grace_native_weapon_owner.gbsres"
                },
                {
                    "slot": 4,
                    "index": 3,
                    "id": "367f538a-3256-5faf-9e3f-e9cb3b74d916",
                    "filename": "source_telemetry.gbsres"
                },
                {
                    "slot": 5,
                    "index": 4,
                    "id": "79506a1e-ff45-5708-8bd1-2c13f7ef9722",
                    "filename": "hp_reserve.gbsres"
                }
            ]
        },
        {
            "room": 16,
            "id": "92cb7ed4-0d6b-5b69-97bf-13495451b613",
            "symbol": "scene_service_lift",
            "resourcePath": "project/scenes/service_lift/scene.gbsres",
            "actorCount": 4,
            "actors": [
                {
                    "slot": 1,
                    "index": 0,
                    "id": "7c5f891c-5993-5f1f-82d1-d0137287e9f6",
                    "filename": "health_and_capacity.gbsres"
                },
                {
                    "slot": 2,
                    "index": 1,
                    "id": "3b37699d-42f6-5434-9b85-b017b024f166",
                    "filename": "installed_tools_and_carried_core.gbsres"
                },
                {
                    "slot": 3,
                    "index": 2,
                    "id": "8a688b33-a19d-58e0-913e-919c948b69ca",
                    "filename": "damage_grace_native_weapon_owner.gbsres"
                },
                {
                    "slot": 4,
                    "index": 3,
                    "id": "e9d218e1-8c11-576e-a5bc-be53e25c437d",
                    "filename": "source_telemetry.gbsres"
                }
            ]
        }
    ],
    nativeSprites: [
        {
            "id": "6eb8726e-3a57-5392-969c-85debc72d369",
            "symbol": "sprite_r07_aligned_rivet",
            "filename": "r07_rivet_aligned.png",
            "metadataPath": "assets/sprites/r07_rivet_aligned.png.gbsres"
        },
        {
            "id": "14becff3-95b9-577e-83d2-f7e4d1bfc58e",
            "symbol": "sprite_wl_missile_v01",
            "filename": "wl_missile_v01.png",
            "metadataPath": "assets/sprites/wl_missile_v01.png.gbsres"
        },
        {
            "id": "9b9864ff-42b3-58bb-89c3-84610bf2430d",
            "symbol": "sprite_wl_bay_power_shutter_v01",
            "filename": "wl_bay_power_shutter_v01.png",
            "metadataPath": "assets/sprites/wl_bay_power_shutter_v01.png.gbsres"
        },
        {
            "id": "9c306123-a88d-584d-8375-3aa401e98b54",
            "symbol": "sprite_chapter_v14_power_shutter",
            "filename": "chapter_power_shutter_v14.png",
            "metadataPath": "assets/sprites/chapter_power_shutter_v14.png.gbsres"
        }
    ],
    player: {
        "id": "17bca96b-c199-536d-a172-45e01065b8c1",
        "symbol": "sprite_wrecklight_salvager_hero_v02_aligned_nozzle",
        "filename": "wrecklight_hero_salvager_v02.png",
        "metadataPath": "assets/sprites/wrecklight_hero_salvager_v02.png.gbsres",
        "states": [
            {
                "id": "aeefd637-d494-5729-a988-adbc51031c65",
                "name": ""
            },
            {
                "id": "efa380bf-7e12-5646-84c4-2416fdce0b9d",
                "name": "Dynamo"
            },
            {
                "id": "4c68be58-c462-5806-9ba8-fe12ce734159",
                "name": "WL_Fall"
            },
            {
                "id": "aebae14a-b2f6-5426-872d-f944d657b30c",
                "name": "WL_AirImpulse"
            },
            {
                "id": "3e99b159-35f0-59b3-9c77-6e28d00ee421",
                "name": "WL_Fire"
            },
            {
                "id": "d33de640-ac82-571e-bea5-8b42726ae505",
                "name": "WL_FallFire"
            },
            {
                "id": "fca1fdf9-96bd-501c-b4ec-a33184a3a973",
                "name": "WL_DynamoFire"
            },
            {
                "id": "2dac1877-f686-50bb-b72d-9f045da4ce6b",
                "name": "WL_Hurt"
            },
            {
                "id": "58a56bdf-0ea5-583d-aa2b-c8fe09fa2e5e",
                "name": "WL_Land"
            },
            {
                "id": "4e4ee852-e95c-5a5b-8e4f-4023b68a56a5",
                "name": "WL_Turn"
            },
            {
                "id": "ed2e22b5-2e72-52e9-997f-58715b753c7a",
                "name": "WL_Death"
            },
            {
                "id": "b7df537a-e6d4-5923-92e9-135c3f7c6489",
                "name": "DASH_LAUNCH"
            },
            {
                "id": "2877d57a-9339-52e6-aa9f-97a4b6ef3287",
                "name": "DASH_TRAVEL"
            },
            {
                "id": "52460bb9-3e36-5928-85e3-49de6b29be40",
                "name": "DASH_RECOVER"
            },
            {
                "id": "0b657c52-4d92-51e0-9e3e-0654dfab2004",
                "name": "WALL_BRACE"
            },
            {
                "id": "b8facce0-45a8-508c-946a-f6a7515582b5",
                "name": "WALL_KICK"
            },
            {
                "id": "c16eb599-f0fe-5733-82a1-9b65b1e7e470",
                "name": "GRAPPLE_ATTACH"
            },
            {
                "id": "6e54536f-9219-5243-8610-cba19894dbe3",
                "name": "GRAPPLE_TENSION"
            },
            {
                "id": "9a8ce523-f4d5-5435-b412-b3ed57603157",
                "name": "GRAPPLE_RELEASE"
            },
            {
                "id": "cf31be12-d862-53b5-bf77-968889170471",
                "name": "WL_PogoStrike"
            },
            {
                "id": "44a5c43e-e2c4-506d-9cb9-4649932179ee",
                "name": "WL_PogoBounce"
            },
            {
                "id": "d7268614-2246-5d8a-917b-22a561ec9330",
                "name": "WL_Crouch"
            },
            {
                "id": "2edda713-5817-505e-88d9-b07aebd7f1cb",
                "name": "WL_Brake"
            }
        ]
    },
    backgrounds: [
        {
            "sceneId": "12f07015-0a42-504a-8d39-3f689e13ad3a",
            "id": "4b653331-1638-54e3-bd2c-4c80970efc58",
            "metadataPath": "assets/backgrounds/opening-v04-bay-step14.png.gbsres",
            "width": 512,
            "height": 448
        },
        {
            "sceneId": "7f23a478-4d91-55d1-9c4e-6d2bba24caba",
            "id": "f337b261-e1b4-558d-a0a6-ed87a3283228",
            "metadataPath": "assets/backgrounds/airworks_doors_v07_convex.png.gbsres",
            "width": 512,
            "height": 384
        },
        {
            "sceneId": "fd880ba8-f473-53eb-9363-b07097aac89c",
            "id": "e585a7bd-6ea6-5731-9805-d96acb8e8c5c",
            "metadataPath": "assets/backgrounds/kit_c_v01.png.gbsres",
            "width": 320,
            "height": 512
        },
        {
            "sceneId": "868a3167-80f5-542b-8352-084c0c4808da",
            "id": "60c54c5e-155b-5a65-bef0-ea94bc3d9e6d",
            "metadataPath": "assets/backgrounds/kit_d_v01.png.gbsres",
            "width": 576,
            "height": 384
        },
        {
            "sceneId": "3738d8e9-495f-5d2e-a083-18dd78632415",
            "id": "e2471ce1-2aad-5412-af36-ec1da9ce4f25",
            "metadataPath": "assets/backgrounds/kit_l_v01.png.gbsres",
            "width": 320,
            "height": 288
        },
        {
            "sceneId": "96367a24-9989-5971-bc5a-d26e30b28397",
            "id": "5a4fa777-155a-57eb-8cea-e12f322795b5",
            "metadataPath": "assets/backgrounds/kit_g_v01.png.gbsres",
            "width": 768,
            "height": 384
        },
        {
            "sceneId": "f521db84-f386-57db-accf-37aae4c38b3a",
            "id": "9d98af1f-0856-5382-9d04-7812ffba790a",
            "metadataPath": "assets/backgrounds/deep_r_r06.png.gbsres",
            "width": 384,
            "height": 384
        },
        {
            "sceneId": "52cc2a78-76eb-5d64-bc75-5d898191de83",
            "id": "1b7475d4-312b-506a-832e-4db283f701d3",
            "metadataPath": "assets/backgrounds/kit_p_v01.png.gbsres",
            "width": 512,
            "height": 384
        },
        {
            "sceneId": "b6ccbe6c-64d5-51cd-bb2f-e2f1edfe9a30",
            "id": "c844b964-ee01-5679-9c94-d597430921e8",
            "metadataPath": "assets/backgrounds/kit_k_v01.png.gbsres",
            "width": 896,
            "height": 384
        },
        {
            "sceneId": "87eb4a35-9aab-5d69-8952-e990ae3d1991",
            "id": "ca7d55ce-ad33-5150-a99b-3f2a505a1235",
            "metadataPath": "assets/backgrounds/deep_t_r06.png.gbsres",
            "width": 384,
            "height": 320
        },
        {
            "sceneId": "803353c8-2162-575a-af58-5ac48b6f8725",
            "id": "4e0b89a0-52b2-5410-bbe3-9d10828057b1",
            "metadataPath": "assets/backgrounds/kit_m_v01.png.gbsres",
            "width": 448,
            "height": 576
        },
        {
            "sceneId": "ea5c2e78-3b17-5d25-8b34-db5e57b7b405",
            "id": "bd7957a3-b4ec-58a5-8592-e4d915332187",
            "metadataPath": "assets/backgrounds/deep_mx_x_r01.png.gbsres",
            "width": 512,
            "height": 384
        },
        {
            "sceneId": "873627f3-9fc8-5a39-9929-d86991808ee6",
            "id": "1cd1fd4d-a6b4-5fc1-afa0-9ee1134f818b",
            "metadataPath": "assets/backgrounds/wl_connector_rivet_walk_v01.png.gbsres",
            "width": 384,
            "height": 192
        },
        {
            "sceneId": "dd16a0a2-78ff-51d8-8b85-41f62a21d21d",
            "id": "881b1516-1cfe-5739-8b2d-7a4c4d760fb1",
            "metadataPath": "assets/backgrounds/wl_connector_bleed_duct_v01.png.gbsres",
            "width": 320,
            "height": 224
        },
        {
            "sceneId": "0f7c0021-3a3e-59a0-8630-7952e81a5708",
            "id": "0e4b3fee-888f-56a5-a507-901eabc064b4",
            "metadataPath": "assets/backgrounds/wl_connector_fuse_locker_v01.png.gbsres",
            "width": 256,
            "height": 192
        },
        {
            "sceneId": "2e7609cd-b739-58b1-8a97-83ff74334c80",
            "id": "45398a2a-0de8-5ed5-902a-60e0483d1ce6",
            "metadataPath": "assets/backgrounds/wl_connector_sump_cabinet_v01.png.gbsres",
            "width": 192,
            "height": 192
        },
        {
            "sceneId": "92cb7ed4-0d6b-5b69-97bf-13495451b613",
            "id": "71217e01-a383-5256-833e-e29b6c62c450",
            "metadataPath": "assets/backgrounds/wl_connector_service_lift_v01.png.gbsres",
            "width": 192,
            "height": 256
        }
    ],
    runtime: {
        "mapWords": [
            "223",
            "224",
            "225",
            "226",
            "227",
            "228",
            "229",
            "230",
            "231",
            "232",
            "233",
            "234",
            "235",
            "236",
            "237",
            "238",
            "239",
            "240",
            "241",
            "242",
            "243",
            "244",
            "245",
            "246",
            "247",
            "248",
            "249",
            "250",
            "251",
            "252",
            "253",
            "254",
            "255",
            "256",
            "257",
            "258",
            "259",
            "260",
            "261",
            "262",
            "263",
            "264",
            "265",
            "266",
            "267",
            "268",
            "269",
            "270",
            "271",
            "272",
            "273",
            "274",
            "275",
            "276",
            "277",
            "278",
            "279",
            "280",
            "281",
            "282",
            "283",
            "284",
            "285",
            "286",
            "287",
            "288",
            "289",
            "290",
            "291",
            "292",
            "293",
            "294",
            "295",
            "296",
            "297",
            "298",
            "299",
            "300",
            "301",
            "302",
            "303",
            "304",
            "305",
            "306",
            "307",
            "308",
            "309",
            "310",
            "311",
            "312",
            "313",
            "314",
            "315",
            "316",
            "317",
            "318",
            "319",
            "320",
            "321",
            "322",
            "323",
            "324",
            "325",
            "326",
            "327",
            "328",
            "329",
            "330",
            "331",
            "332",
            "333",
            "334",
            "335",
            "336",
            "337",
            "338",
            "339",
            "340",
            "341",
            "342",
            "343",
            "344",
            "345",
            "346",
            "347",
            "348",
            "349",
            "350",
            "351",
            "352",
            "353",
            "354",
            "355",
            "356",
            "357",
            "358",
            "359",
            "360",
            "361",
            "362",
            "363",
            "364",
            "365",
            "366",
            "367",
            "368",
            "369",
            "370",
            "371",
            "372",
            "373",
            "374",
            "375",
            "376",
            "377",
            "378",
            "379",
            "380",
            "381",
            "382",
            "383",
            "384",
            "385",
            "386",
            "387",
            "388",
            "389",
            "390",
            "391",
            "392",
            "393",
            "394",
            "395",
            "396",
            "397",
            "398",
            "597",
            "598",
            "599",
            "600",
            "601",
            "602",
            "603",
            "604",
            "399",
            "400",
            "401",
            "402",
            "403",
            "404",
            "405",
            "406",
            "407",
            "408",
            "409",
            "410",
            "411",
            "412",
            "413",
            "414",
            "415",
            "416",
            "417",
            "418",
            "419",
            "420",
            "421",
            "422",
            "423",
            "424",
            "425",
            "426",
            "427",
            "428",
            "429",
            "430",
            "431",
            "432",
            "433",
            "434",
            "435",
            "436",
            "437",
            "438",
            "439",
            "440",
            "441",
            "442",
            "443",
            "444",
            "445",
            "446",
            "447",
            "448",
            "449",
            "450",
            "451",
            "452",
            "453",
            "454",
            "455",
            "456",
            "457",
            "458",
            "459",
            "460",
            "461",
            "462",
            "463",
            "464",
            "465",
            "466",
            "467",
            "468",
            "469",
            "470",
            "471",
            "472",
            "473",
            "474",
            "475",
            "476",
            "477",
            "478",
            "479",
            "480",
            "481",
            "482",
            "483",
            "484",
            "485",
            "486",
            "487",
            "488",
            "489",
            "490",
            "491",
            "492",
            "493",
            "494",
            "495",
            "496",
            "497",
            "498",
            "499",
            "500",
            "501",
            "502",
            "503",
            "504",
            "505",
            "506",
            "507",
            "508",
            "509",
            "510",
            "511",
            "512",
            "513",
            "514",
            "515",
            "516",
            "517",
            "518",
            "519",
            "520",
            "521",
            "522",
            "523",
            "524",
            "525",
            "526",
            "527",
            "528",
            "529",
            "530",
            "531",
            "532",
            "533",
            "534",
            "535",
            "536",
            "537",
            "538",
            "539",
            "540",
            "541",
            "542",
            "543",
            "544",
            "545",
            "546",
            "547",
            "548",
            "549",
            "550",
            "551",
            "552",
            "553",
            "554",
            "555",
            "556",
            "557",
            "558",
            "559",
            "560",
            "561",
            "562",
            "563",
            "564",
            "565",
            "566",
            "567",
            "568",
            "569",
            "570",
            "571",
            "572",
            "573",
            "574",
            "621",
            "622",
            "623",
            "624",
            "625",
            "626",
            "627",
            "628",
            "575",
            "576",
            "577",
            "578",
            "579",
            "645",
            "580",
            "581",
            "582"
        ],
        "seen": [
            "223",
            "224",
            "225",
            "226",
            "227",
            "228",
            "229",
            "230",
            "231",
            "232",
            "233",
            "234",
            "235",
            "236",
            "237",
            "238",
            "239",
            "240",
            "241",
            "242",
            "243",
            "244",
            "245",
            "246",
            "247",
            "248",
            "249",
            "250",
            "251",
            "252",
            "253",
            "254",
            "255",
            "256",
            "257",
            "258",
            "259",
            "260",
            "261",
            "262",
            "263",
            "264",
            "265",
            "266",
            "267",
            "268",
            "269",
            "270",
            "271",
            "272",
            "273",
            "274",
            "275",
            "276",
            "277",
            "278",
            "279",
            "280",
            "281",
            "282",
            "283",
            "284",
            "285",
            "286",
            "287",
            "288",
            "289",
            "290",
            "291",
            "292",
            "293",
            "294",
            "295",
            "296",
            "297",
            "298",
            "299",
            "300",
            "301",
            "302",
            "303",
            "304",
            "305",
            "306",
            "307",
            "308",
            "309",
            "310",
            "311",
            "312",
            "313",
            "314",
            "315",
            "316",
            "317",
            "318",
            "319",
            "320",
            "321",
            "322",
            "323",
            "324",
            "325",
            "326",
            "327",
            "328",
            "329",
            "330",
            "331",
            "332",
            "333",
            "334",
            "335",
            "336",
            "337",
            "338",
            "339",
            "340",
            "341",
            "342",
            "343",
            "344",
            "345",
            "346",
            "347",
            "348",
            "349",
            "350",
            "351",
            "352",
            "353",
            "354",
            "355",
            "356",
            "357",
            "358",
            "359",
            "360",
            "361",
            "362",
            "363",
            "364",
            "365",
            "366",
            "367",
            "368",
            "369",
            "370",
            "371",
            "372",
            "373",
            "374",
            "375",
            "376",
            "377",
            "378",
            "379",
            "380",
            "381",
            "382",
            "383",
            "384",
            "385",
            "386",
            "387",
            "388",
            "389",
            "390",
            "391",
            "392",
            "393",
            "394",
            "395",
            "396",
            "397",
            "398",
            "597",
            "598",
            "599",
            "600",
            "601",
            "602",
            "603",
            "604"
        ],
        "visited": [
            "399",
            "400",
            "401",
            "402",
            "403",
            "404",
            "405",
            "406",
            "407",
            "408",
            "409",
            "410",
            "411",
            "412",
            "413",
            "414",
            "415",
            "416",
            "417",
            "418",
            "419",
            "420",
            "421",
            "422",
            "423",
            "424",
            "425",
            "426",
            "427",
            "428",
            "429",
            "430",
            "431",
            "432",
            "433",
            "434",
            "435",
            "436",
            "437",
            "438",
            "439",
            "440",
            "441",
            "442",
            "443",
            "444",
            "445",
            "446",
            "447",
            "448",
            "449",
            "450",
            "451",
            "452",
            "453",
            "454",
            "455",
            "456",
            "457",
            "458",
            "459",
            "460",
            "461",
            "462",
            "463",
            "464",
            "465",
            "466",
            "467",
            "468",
            "469",
            "470",
            "471",
            "472",
            "473",
            "474",
            "475",
            "476",
            "477",
            "478",
            "479",
            "480",
            "481",
            "482",
            "483",
            "484",
            "485",
            "486",
            "487",
            "488",
            "489",
            "490",
            "491",
            "492",
            "493",
            "494",
            "495",
            "496",
            "497",
            "498",
            "499",
            "500",
            "501",
            "502",
            "503",
            "504",
            "505",
            "506",
            "507",
            "508",
            "509",
            "510",
            "511",
            "512",
            "513",
            "514",
            "515",
            "516",
            "517",
            "518",
            "519",
            "520",
            "521",
            "522",
            "523",
            "524",
            "525",
            "526",
            "527",
            "528",
            "529",
            "530",
            "531",
            "532",
            "533",
            "534",
            "535",
            "536",
            "537",
            "538",
            "539",
            "540",
            "541",
            "542",
            "543",
            "544",
            "545",
            "546",
            "547",
            "548",
            "549",
            "550",
            "551",
            "552",
            "553",
            "554",
            "555",
            "556",
            "557",
            "558",
            "559",
            "560",
            "561",
            "562",
            "563",
            "564",
            "565",
            "566",
            "567",
            "568",
            "569",
            "570",
            "571",
            "572",
            "573",
            "574",
            "621",
            "622",
            "623",
            "624",
            "625",
            "626",
            "627",
            "628"
        ],
        "roomWords": [
            "579",
            "645"
        ],
        "newGameWrites": [
            "223",
            "224",
            "225",
            "226",
            "227",
            "228",
            "229",
            "230",
            "231",
            "232",
            "233",
            "234",
            "235",
            "236",
            "237",
            "238",
            "239",
            "240",
            "241",
            "242",
            "243",
            "244",
            "245",
            "246",
            "247",
            "248",
            "249",
            "250",
            "251",
            "252",
            "253",
            "254",
            "255",
            "256",
            "257",
            "258",
            "259",
            "260",
            "261",
            "262",
            "263",
            "264",
            "265",
            "266",
            "267",
            "268",
            "269",
            "270",
            "271",
            "272",
            "273",
            "274",
            "275",
            "276",
            "277",
            "278",
            "279",
            "280",
            "281",
            "282",
            "283",
            "284",
            "285",
            "286",
            "287",
            "288",
            "289",
            "290",
            "291",
            "292",
            "293",
            "294",
            "295",
            "296",
            "297",
            "298",
            "299",
            "300",
            "301",
            "302",
            "303",
            "304",
            "305",
            "306",
            "307",
            "308",
            "309",
            "310",
            "311",
            "312",
            "313",
            "314",
            "315",
            "316",
            "317",
            "318",
            "319",
            "320",
            "321",
            "322",
            "323",
            "324",
            "325",
            "326",
            "327",
            "328",
            "329",
            "330",
            "331",
            "332",
            "333",
            "334",
            "335",
            "336",
            "337",
            "338",
            "339",
            "340",
            "341",
            "342",
            "343",
            "344",
            "345",
            "346",
            "347",
            "348",
            "349",
            "350",
            "351",
            "352",
            "353",
            "354",
            "355",
            "356",
            "357",
            "358",
            "359",
            "360",
            "361",
            "362",
            "363",
            "364",
            "365",
            "366",
            "367",
            "368",
            "369",
            "370",
            "371",
            "372",
            "373",
            "374",
            "375",
            "376",
            "377",
            "378",
            "379",
            "380",
            "381",
            "382",
            "383",
            "384",
            "385",
            "386",
            "387",
            "388",
            "389",
            "390",
            "391",
            "392",
            "393",
            "394",
            "395",
            "396",
            "397",
            "398",
            "597",
            "598",
            "599",
            "600",
            "601",
            "602",
            "603",
            "604",
            "399",
            "400",
            "401",
            "402",
            "403",
            "404",
            "405",
            "406",
            "407",
            "408",
            "409",
            "410",
            "411",
            "412",
            "413",
            "414",
            "415",
            "416",
            "417",
            "418",
            "419",
            "420",
            "421",
            "422",
            "423",
            "424",
            "425",
            "426",
            "427",
            "428",
            "429",
            "430",
            "431",
            "432",
            "433",
            "434",
            "435",
            "436",
            "437",
            "438",
            "439",
            "440",
            "441",
            "442",
            "443",
            "444",
            "445",
            "446",
            "447",
            "448",
            "449",
            "450",
            "451",
            "452",
            "453",
            "454",
            "455",
            "456",
            "457",
            "458",
            "459",
            "460",
            "461",
            "462",
            "463",
            "464",
            "465",
            "466",
            "467",
            "468",
            "469",
            "470",
            "471",
            "472",
            "473",
            "474",
            "475",
            "476",
            "477",
            "478",
            "479",
            "480",
            "481",
            "482",
            "483",
            "484",
            "485",
            "486",
            "487",
            "488",
            "489",
            "490",
            "491",
            "492",
            "493",
            "494",
            "495",
            "496",
            "497",
            "498",
            "499",
            "500",
            "501",
            "502",
            "503",
            "504",
            "505",
            "506",
            "507",
            "508",
            "509",
            "510",
            "511",
            "512",
            "513",
            "514",
            "515",
            "516",
            "517",
            "518",
            "519",
            "520",
            "521",
            "522",
            "523",
            "524",
            "525",
            "526",
            "527",
            "528",
            "529",
            "530",
            "531",
            "532",
            "533",
            "534",
            "535",
            "536",
            "537",
            "538",
            "539",
            "540",
            "541",
            "542",
            "543",
            "544",
            "545",
            "546",
            "547",
            "548",
            "549",
            "550",
            "551",
            "552",
            "553",
            "554",
            "555",
            "556",
            "557",
            "558",
            "559",
            "560",
            "561",
            "562",
            "563",
            "564",
            "565",
            "566",
            "567",
            "568",
            "569",
            "570",
            "571",
            "572",
            "573",
            "574",
            "621",
            "622",
            "623",
            "624",
            "625",
            "626",
            "627",
            "628",
            "575",
            "576",
            "577",
            "578",
            "579",
            "645",
            "580",
            "581",
            "582",
            "589",
            "583",
            "584"
        ],
        "verifyReads": [
            "589"
        ],
        "hudReads": [
            "58",
            "59",
            "92"
        ]
    }
};
//# sourceMappingURL=current.js.map