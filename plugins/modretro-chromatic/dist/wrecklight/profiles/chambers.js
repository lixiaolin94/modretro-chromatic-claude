// Coherent cinematic/chambers source review. No gameplay or installation evidence.
// Parent art stays mutable under the ordinary per-call tilemap preimage guards.
import { WRECKLIGHT_WARDEN_DYNAMO_BEAM_REVIEW } from "./warden.js";
const project = [
    {
        "path": "assets/ui/frame.png",
        "bytes": 159,
        "sha256": "c1c75221b6df9e3d8962adb487a74b599f1727854d74e459411b6745f30c065b"
    },
    {
        "path": "assets/ui/cursor.png",
        "bytes": 130,
        "sha256": "0a969345b25b35379ca47d8a5aff11a2a1c5c5e6e1cb6bf0db35ff5a2b70ee1d"
    },
    {
        "path": "assets/sounds/wrecklight-air-lift.wav.gbsres",
        "bytes": 203,
        "sha256": "9e4af702705a5961838793edffc756b177ded5ef61bf1ad1f4db1e4cca6ea283"
    },
    {
        "path": "assets/sounds/wrecklight-beacon-extract.wav.gbsres",
        "bytes": 221,
        "sha256": "4f1038eb76dacb5e7e243881116a8d20a6f9f7c76cfd8ec3aaf560b942d2b374"
    },
    {
        "path": "assets/sounds/wrecklight-core-install.wav.gbsres",
        "bytes": 215,
        "sha256": "3083c303aac82f7f9fec8bcecfe94d9d14b2aec49aeb76e521f3ba4bbaffbe2d"
    },
    {
        "path": "assets/sounds/wrecklight-dynamo-online.wav.gbsres",
        "bytes": 218,
        "sha256": "22ea3e76e85a35584448ef2bae6c4dae4b842f3a9f77ee65ff611e50bef460cc"
    },
    {
        "path": "assets/sounds/wrecklight-ui-tick.wav.gbsres",
        "bytes": 200,
        "sha256": "b1961ec9e51edbf5d13a595f43acd43cef61608b041bd3a2736863ab13d4b7fa"
    },
    {
        "path": "assets/sprites/wrecklight_hero_eyehead_v01.png.gbsres",
        "bytes": 531198,
        "sha256": "bd764a18cf9196c3b577fd8b15024c1ad0971531d9598241b3fadd6ada5c6a34"
    },
    {
        "path": "assets/sprites/wrecklight_hero_salvager_v02.png.gbsres",
        "bytes": 531269,
        "sha256": "2f487381865b5c270fc1e12b818c2986bab7dd38587040571c5f44c823f3622a"
    },
    {
        "path": "plugins/README.md",
        "bytes": 140,
        "sha256": "6fcd1de584237e28305f21cce86a0999db68de05ca18b87ffa798677e7ef547d"
    },
    {
        "path": "plugins/wrecklight-acquisition/engine/engine.json",
        "bytes": 35,
        "sha256": "b4b188af94d3cd49676d47b6e3a7a28598b3274e4a04302910fde5a69c83a406"
    },
    {
        "path": "plugins/wrecklight-acquisition/engine/include/wrecklight_acquisition_tiles.h",
        "bytes": 1102,
        "sha256": "b0b4d7e97a4da4f09946575980e336b6129c2dd9e2937134fb97d7f5487b8edf"
    },
    {
        "path": "plugins/wrecklight-acquisition/engine/include/wrecklight_acquisition.h",
        "bytes": 396,
        "sha256": "7f4b450683744a468eda281571729fab1aa8902f10f21ce818146f40aedb22d0"
    },
    {
        "path": "plugins/wrecklight-acquisition/engine/src/core/wrecklight_acquisition.c",
        "bytes": 9087,
        "sha256": "b83d11e542097f0c345d2ec2563a554ca72741a99c4ff1550ecc9655bbdd2f57"
    },
    {
        "path": "plugins/wrecklight-acquisition/events/eventWrecklightAcquisition.js",
        "bytes": 1866,
        "sha256": "06f92060f7e163bf4a061d2a1bb7dc3ff9758df1f70b1af25faeb6fc2bdfd463"
    },
    {
        "path": "plugins/wrecklight-acquisition/events/eventWrecklightChamberPoll.js",
        "bytes": 930,
        "sha256": "f81fbffd6ef700e763971a5b7f51d9e4006d1f90a76d157300aeb61ed26a805f"
    },
    {
        "path": "plugins/wrecklight-acquisition/events/eventWrecklightChamberVariables.js",
        "bytes": 314,
        "sha256": "26623e4753fc0522c72faddfa566319fca3df040e835dc33ae7530ae44d3f63d"
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
        "path": "plugins/wrecklight-controller/engine/include/wrecklight_chamber_bindings.h",
        "bytes": 627,
        "sha256": "1060e547932afd92a74e3d04a2ce2c52b1b5030a82515775e0b37804c3c9afcc"
    },
    {
        "path": "plugins/wrecklight-controller/engine/include/wrecklight_chambers.h",
        "bytes": 919,
        "sha256": "b3e6c0955de11038a5bf241a888232b7588e29c7ecdcd0b8a703a9e45a76f7c6"
    },
    {
        "path": "plugins/wrecklight-controller/engine/include/wrecklight_combat.h",
        "bytes": 1409,
        "sha256": "9421502fae187f96be19b3d47d6d9521f19eca39eb09fdadebde5643f4d774bc"
    },
    {
        "path": "plugins/wrecklight-controller/engine/include/wrecklight_coupler_patterns.h",
        "bytes": 500,
        "sha256": "274b59f20dffd735d62e6256a7cbd6476c329e276a94bb07633fade75cb06e13"
    },
    {
        "path": "plugins/wrecklight-controller/engine/include/wrecklight_door_map_data.h",
        "bytes": 14542,
        "sha256": "3b4b42600cf79afa52aeeb7a2b59dffb3e551db2bcf8b9f70f6f2d79218f02ba"
    },
    {
        "path": "plugins/wrecklight-controller/engine/include/wrecklight_door_maps.h",
        "bytes": 1422,
        "sha256": "041c749de0c976651ebb845bfd30f76c65dc379ded8166fbdaf840f164cb5978"
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
        "path": "plugins/wrecklight-controller/engine/include/wrecklight_leaf_renderer.h",
        "bytes": 314,
        "sha256": "ea6b9f7d1459d79d2d270ffb552f01fee1d68ce129732eb24b3a20fb07031fc9"
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
        "bytes": 2035,
        "sha256": "647b002868612c30fa76d42283cf276cc8ec9d01fb1bfb56e808f4d700244dee"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/actor.c.patch",
        "bytes": 2322,
        "sha256": "cc6f0136fff0df6f79a9076ae92413842de7f3f611003567bc84321405330cf5"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/core.c.patch",
        "bytes": 5461,
        "sha256": "3a3d2e01acb23f45fe70bc5ecfc74944033767f4d060324b291f63d2d994bf7b"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/data_manager.c.patch",
        "bytes": 560,
        "sha256": "9c2dad89cd531c7f7fc9db329b66536f19e23b35c49e940cc3cea98755e11348"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/projectiles.c.patch",
        "bytes": 21857,
        "sha256": "8446e040de4d0fa6b30a8e849d3bfaab90a758de18b6486af873e876d546d483"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/scroll.c.patch",
        "bytes": 864,
        "sha256": "715f1af0fe2713652a06ebca32f7da3b4f593879bead4973622c9cf48ed889b7"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/vm_actor.c.patch",
        "bytes": 1032,
        "sha256": "7e8eee1fb7f0c55505e8683f65c74067bdc69e306136155b103d7530f88f187c"
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
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_cargo_idle.c",
        "bytes": 2166,
        "sha256": "86f21f208d43aca039c3027c412c734be2e82ded513a8f61a8345fb8bca39c80"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_chambers.c",
        "bytes": 12120,
        "sha256": "1a0c44e4520853524f11ea535135db887e2bd8e46af4f4b620e8132021a1ad8f"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_combat.c",
        "bytes": 13145,
        "sha256": "26acc97f3d7b89b3a4fbca5fc7abbc983c549451c561a7b15042c46d3392895e"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_controls.c",
        "bytes": 1696,
        "sha256": "0f141b090685d0bf7fac4671495ed04b07574e73d524504bfda103e739700ee9"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_door_maps.c",
        "bytes": 14990,
        "sha256": "352a7fc8e89e583887ae028caa65b3ff242ce1ca7cf0f3717cb6164746ef859b"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_enemy_conditions.c",
        "bytes": 4226,
        "sha256": "486b19d22d393a57839831fae4a2a0d412bdaecdfaa250e42ce76669ef2ca16f"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_enemy_ticks.c",
        "bytes": 9512,
        "sha256": "8d56c43cceca8d982a56b9f1e00b7ed79be0204197d2d3bd0f8f9d306926bde6"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_leaf_renderer.c",
        "bytes": 1576,
        "sha256": "ce691d90d49068b531860c58fa516d2c80a7e67f97af00fb30d8988db5ecc12b"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_presentation.c",
        "bytes": 57573,
        "sha256": "af077ac5f816537306e00697a746a61f0668001ed1ab8893e3cdd773fe44b885"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_projectiles.c",
        "bytes": 5335,
        "sha256": "bd98875eda3e15e1eeae0505318b94a380c2b865b13d3e16282c598d2dd9d444"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_reactor_idle.c",
        "bytes": 3369,
        "sha256": "8c8e7c3a14c8c78f14ea9a4651f466a555cb72d2cc555ad6e9c25135036d12f6"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_render.c",
        "bytes": 1832,
        "sha256": "817feca4e65540bd5d7cb626afe86260bc956458dff3ced4ee6a72744bf1b11c"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_rewards.c",
        "bytes": 10610,
        "sha256": "6c3c7d8513f1aaa145b00091952b8ee19ddb2bb4e3e8976fc87a1834c4a2e900"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_world.c",
        "bytes": 40054,
        "sha256": "97eea0538d1e7969ebe962766c3992ae8a42a541179ac92ba016dc6a9d155e5f"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/states/platform.c.patch",
        "bytes": 57267,
        "sha256": "d247d0a9774d3bb2faa39e42ab13c8faeafe10404a326c3de3c8af5698a403ba"
    },
    {
        "path": "plugins/wrecklight-controller/events/combat-variable-ids.json",
        "bytes": 445,
        "sha256": "5fe6702de24c8b8a8e6c2bb3c5542528c2b6948cf5febe1f49697b4dfaab75a8"
    },
    {
        "path": "plugins/wrecklight-controller/events/eventWrecklightCargoIdle.js",
        "bytes": 1751,
        "sha256": "c912f196c9627e4a09632dcd6e65907fb0a7b2235153d7f77bb4f3f0ceacacd3"
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
        "path": "plugins/wrecklight-controller/events/eventWrecklightReactorIdle.js",
        "bytes": 1830,
        "sha256": "0f5c808bd35467bf8cdd8896208dc6d09f993d4d40faeb1a9e5778e2485cea4f"
    },
    {
        "path": "plugins/wrecklight-controller/plugin.json",
        "bytes": 168,
        "sha256": "6a40cdc199f398ad7f223f04aa4272c86b19d78b9b441912442e8a37eb8e32ef"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/engine.json",
        "bytes": 476,
        "sha256": "991c106b6d70587a8c44dd641ff4103fa33d4ef87d067daf1c4e93bdbfbe9d21"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/include/wrecklight_map_bindings.h",
        "bytes": 1307,
        "sha256": "48de41ea07ce929b9e1ac791dca5487029f2425940e64f60da0d9bb502f29878"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/include/wrecklight_map_data.h",
        "bytes": 14520,
        "sha256": "060794b348b14d1bd7dab9ab450e5c2ef153e650f9f7ed7180bb54884169b24a"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/include/wrecklight_map_pause.h",
        "bytes": 1470,
        "sha256": "a659c326617fd0dc02f8e58fa6979d07242f3923ba4afbe32e9bc5e73ab0bacf"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/include/wrecklight_map_tiles.h",
        "bytes": 251,
        "sha256": "28502a360e2129e5c684c5963b6759680b4aeb37a49198befaf7d13c0cded9a9"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/include/wrecklight_map_ui_routes.h",
        "bytes": 2688,
        "sha256": "0870d184029d4fa37dee8986e03bd8c67a87c30664f851306fcadc905b47fb38"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/include/wrecklight_map_ui.h",
        "bytes": 775,
        "sha256": "74065edeef90a1920baa38bd1af5f72c830472131dd9db1d92c7fbfbe38e33a2"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/include/wrecklight_map_variables.h",
        "bytes": 7851,
        "sha256": "903c710112d8384ea2a4c7e912b2d27de210e7edd0c982f15cf4cd11a88a4a81"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_panels.c",
        "bytes": 5527,
        "sha256": "2c0316a99d65e31aec844f36192b09f48f94928c0ed3f3f2e26d79154cec2a2e"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_pause.c",
        "bytes": 36220,
        "sha256": "60259b1d927494af71099363874ca2a15927c27d83448162fe043889178556d9"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_pause.c.orig",
        "bytes": 41461,
        "sha256": "4ec2e483f14d3a68fb352fc26adb142a76aa687296f9bb270431da1f96ffc55c"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_rooms.c",
        "bytes": 2839,
        "sha256": "f2e5b84743d5b9b9f2d32dd1d686ffa633d57092d0ba30a30ff87eacea6e178f"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_tiles.c",
        "bytes": 5036,
        "sha256": "e9cff556c63c4dfff4b4e691339cc56316203d57ad7fa9f18915cb8f33c2cb59"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/src/core/wrecklight_service_ui.c",
        "bytes": 4862,
        "sha256": "a366a3f0b090965776bde330a48cbb53320e40e3605f7d1326116c97bcc4bdd3"
    },
    {
        "path": "plugins/wrecklight-map-pause/events/eventWrecklightMap.js",
        "bytes": 7662,
        "sha256": "791d3b2c798d0e3e49b1cea4c347abf4f2ba50fe21a0243108556159871027ed"
    },
    {
        "path": "plugins/wrecklight-map-pause/events/eventWrecklightService.js",
        "bytes": 917,
        "sha256": "18a98b9ede61d457e8609a33ed1fcf848790d3990be98467418797d9c44d4dad"
    },
    {
        "path": "plugins/wrecklight-map-pause/events/map-variable-ids.json",
        "bytes": 3882,
        "sha256": "d7979ca6a01f8fb6410dec70644edc86f43e1ff5b501daadb52f4dd8d7806aec"
    },
    {
        "path": "plugins/wrecklight-map-pause/plugin.json",
        "bytes": 197,
        "sha256": "88f23761f61d605a99e52f764bc6e9490468c5d7852ab56cff41de2a911b13ba"
    },
    {
        "path": "plugins/wrecklight-title/engine/engine.json",
        "bytes": 35,
        "sha256": "b4b188af94d3cd49676d47b6e3a7a28598b3274e4a04302910fde5a69c83a406"
    },
    {
        "path": "plugins/wrecklight-title/engine/include/wrecklight_title_data.h",
        "bytes": 30846,
        "sha256": "a152068b568d287411de94cf7a7d34ee11ae4d7c5fc582cd9755487f4ef9ceee"
    },
    {
        "path": "plugins/wrecklight-title/engine/include/wrecklight_title_state.h",
        "bytes": 2270,
        "sha256": "f7df67c6b25794388a452d0b90d77e401a7aa5c50e1aebadbff875e54b29fe0b"
    },
    {
        "path": "plugins/wrecklight-title/engine/include/wrecklight_title.h",
        "bytes": 270,
        "sha256": "fa4d6ecde954556c2e0e756bb521fcb112adcab807409e8a2d730f8196e50e78"
    },
    {
        "path": "plugins/wrecklight-title/engine/src/core/wrecklight_title.c",
        "bytes": 13147,
        "sha256": "7097f669c3b3bd5167730eb59445ceaabfb9b726cab858939cdf75d6785d80ab"
    },
    {
        "path": "plugins/wrecklight-title/events/eventWrecklightTitle.js",
        "bytes": 1057,
        "sha256": "3e71e7d9aa3fa970f9f5f18fc15e172aef31ff8e82f33281d12b0721b31542ce"
    },
    {
        "path": "plugins/wrecklight-title/plugin.json",
        "bytes": 202,
        "sha256": "b4bc761160222d32aeb029f84931a1f41c6adcb8ab83d558b0c37ef9ddfcbf70"
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
        "bytes": 2611,
        "sha256": "8b8c79918d131b85e87d543ade81c66c81bae40380951af016a0f96855804af6"
    },
    {
        "path": "project/variables.gbsres",
        "bytes": 69333,
        "sha256": "dd6555dde73d5f2608af6019186dae2e3e5d17d72c42248f6f0d2070ffb562f2"
    }
];
const rooms = [
    {
        "room": 18,
        "id": "2c461c15-eb6e-5dcf-ae9c-46b9e06eb7ed",
        "symbol": "scene_wl_dynamo_chamber_v01",
        "resourcePath": "project/scenes/wl_dynamo_chamber_v01/scene.gbsres",
        "actors": [
            {
                "slot": 1,
                "index": 0,
                "id": "dee1de55-0969-54a3-862e-ad59203723bc",
                "filename": "reward.gbsres"
            },
            {
                "slot": 2,
                "index": 1,
                "id": "dccdbb19-3056-5114-a6d9-95ccc6094831",
                "filename": "manager.gbsres"
            }
        ]
    },
    {
        "room": 19,
        "id": "85704b28-d9df-562f-83a3-8d26e04908b1",
        "symbol": "scene_wl_wall_chamber_v01",
        "resourcePath": "project/scenes/wl_wall_chamber_v01/scene.gbsres",
        "actors": [
            {
                "slot": 1,
                "index": 0,
                "id": "c6794371-982d-53b4-96f7-5ca7ea99a251",
                "filename": "reward.gbsres"
            },
            {
                "slot": 2,
                "index": 1,
                "id": "1198b190-d718-5f4a-b3ad-119624084237",
                "filename": "manager.gbsres"
            }
        ]
    },
    {
        "room": 20,
        "id": "e5dd0d34-c991-5fe2-9fd4-a9a9442ab803",
        "symbol": "scene_wl_core_chamber_v01",
        "resourcePath": "project/scenes/wl_core_chamber_v01/scene.gbsres",
        "actors": [
            {
                "slot": 1,
                "index": 0,
                "id": "39f816bd-2d9c-50f2-bb53-b3bac4ae4c44",
                "filename": "reward.gbsres"
            },
            {
                "slot": 2,
                "index": 1,
                "id": "d68409ae-69c7-54e5-a9fb-18dacdd917e7",
                "filename": "manager.gbsres"
            }
        ]
    },
    {
        "room": 21,
        "id": "8ff7a319-d658-5f38-9623-e359829f6aa4",
        "symbol": "scene_wl_cutter_chamber_v01",
        "resourcePath": "project/scenes/wl_cutter_chamber_v01/scene.gbsres",
        "actors": [
            {
                "slot": 1,
                "index": 0,
                "id": "e60e9f97-9f66-593b-8d60-254d350eb681",
                "filename": "reward.gbsres"
            },
            {
                "slot": 2,
                "index": 1,
                "id": "fcf8588c-0b9d-5833-a7df-11c4738e4d9f",
                "filename": "manager.gbsres"
            }
        ]
    },
    {
        "room": 22,
        "id": "93b2e633-c584-5010-a904-9a6ce924b662",
        "symbol": "scene_wl_missile_chamber_v01",
        "resourcePath": "project/scenes/wl_missile_chamber_v01/scene.gbsres",
        "actors": [
            {
                "slot": 1,
                "index": 0,
                "id": "905586df-a1d7-5ea0-9e21-828361a83065",
                "filename": "practice.gbsres"
            },
            {
                "slot": 2,
                "index": 1,
                "id": "f81bf3b8-65f6-5e73-9145-1ec5e1bc865d",
                "filename": "manager.gbsres"
            }
        ]
    },
    {
        "room": 23,
        "id": "d064b816-09b5-508b-bdab-1b81b9dc2315",
        "symbol": "scene_wl_pogo_chamber_v01",
        "resourcePath": "project/scenes/wl_pogo_chamber_v01/scene.gbsres",
        "actors": [
            {
                "slot": 1,
                "index": 0,
                "id": "76fd05dd-477d-570a-b3f1-0a1f4e983d66",
                "filename": "practice.gbsres"
            },
            {
                "slot": 2,
                "index": 1,
                "id": "846cf5e7-8d8a-5b89-ae71-ec47cd88fe7a",
                "filename": "manager.gbsres"
            }
        ]
    }
];
const backgrounds = [
    {
        "sceneId": "2c461c15-eb6e-5dcf-ae9c-46b9e06eb7ed",
        "id": "e2fe324b-d7ab-54ff-a45f-13f1b3a37a2a",
        "metadataPath": "assets/backgrounds/wl_dynamo_chamber_v03.png.gbsres",
        "width": 256,
        "height": 144
    },
    {
        "sceneId": "85704b28-d9df-562f-83a3-8d26e04908b1",
        "id": "713b9663-9280-5f4b-9f8d-59143607c2e8",
        "metadataPath": "assets/backgrounds/wl_wall_chamber_v03.png.gbsres",
        "width": 256,
        "height": 144
    },
    {
        "sceneId": "e5dd0d34-c991-5fe2-9fd4-a9a9442ab803",
        "id": "4651a023-b6de-5294-81b9-0c6af4fda9ef",
        "metadataPath": "assets/backgrounds/wl_core_chamber_v03.png.gbsres",
        "width": 256,
        "height": 144
    },
    {
        "sceneId": "8ff7a319-d658-5f38-9623-e359829f6aa4",
        "id": "3afa6d3d-799b-533e-9885-a322c1cc1b2e",
        "metadataPath": "assets/backgrounds/wl_cutter_chamber_v03.png.gbsres",
        "width": 256,
        "height": 144
    },
    {
        "sceneId": "93b2e633-c584-5010-a904-9a6ce924b662",
        "id": "fdee4e78-8610-577a-8461-f5f12437fcfc",
        "metadataPath": "assets/backgrounds/wl_missile_chamber_v03.png.gbsres",
        "width": 256,
        "height": 144
    },
    {
        "sceneId": "d064b816-09b5-508b-bdab-1b81b9dc2315",
        "id": "a4fb92e4-36fc-5957-ae65-d6334d17955b",
        "metadataPath": "assets/backgrounds/wl_pogo_chamber_v03.png.gbsres",
        "width": 256,
        "height": 144
    }
];
const variables = [
    {
        "id": "700",
        "symbol": "VAR_CHAMBERPRACTICEHP"
    },
    {
        "id": "701",
        "symbol": "VAR_CHAMBERPRACTICEDEAD"
    },
    {
        "id": "702",
        "symbol": "VAR_WLMAP372"
    },
    {
        "id": "703",
        "symbol": "VAR_WLMAP373"
    },
    {
        "id": "704",
        "symbol": "VAR_WLMAP374"
    },
    {
        "id": "705",
        "symbol": "VAR_WLMAP375"
    },
    {
        "id": "706",
        "symbol": "VAR_WLMAP376"
    },
    {
        "id": "707",
        "symbol": "VAR_WLMAP377"
    },
    {
        "id": "708",
        "symbol": "VAR_WLMAP378"
    },
    {
        "id": "709",
        "symbol": "VAR_WLMAP379"
    },
    {
        "id": "710",
        "symbol": "VAR_WLMAP380"
    },
    {
        "id": "711",
        "symbol": "VAR_WLMAP381"
    },
    {
        "id": "712",
        "symbol": "VAR_WLMAP382"
    },
    {
        "id": "713",
        "symbol": "VAR_WLMAP383"
    },
    {
        "id": "714",
        "symbol": "VAR_WLMAP396"
    },
    {
        "id": "715",
        "symbol": "VAR_WLMAP397"
    },
    {
        "id": "716",
        "symbol": "VAR_WLMAP398"
    },
    {
        "id": "717",
        "symbol": "VAR_WLMAP399"
    },
    {
        "id": "718",
        "symbol": "VAR_WLMAP400"
    },
    {
        "id": "719",
        "symbol": "VAR_WLMAP401"
    },
    {
        "id": "720",
        "symbol": "VAR_WLMAP402"
    },
    {
        "id": "721",
        "symbol": "VAR_WLMAP403"
    },
    {
        "id": "722",
        "symbol": "VAR_WLMAP404"
    },
    {
        "id": "723",
        "symbol": "VAR_WLMAP405"
    },
    {
        "id": "724",
        "symbol": "VAR_WLMAP406"
    },
    {
        "id": "725",
        "symbol": "VAR_WLMAP407"
    },
    {
        "id": "726",
        "symbol": "VAR_WLMAP409"
    },
    {
        "id": "727",
        "symbol": "VAR_WLMAP410"
    },
    {
        "id": "728",
        "symbol": "VAR_WLMAP411"
    },
    {
        "id": "729",
        "symbol": "VAR_WLMAP412"
    },
    {
        "id": "730",
        "symbol": "VAR_WLMAP413"
    },
    {
        "id": "731",
        "symbol": "VAR_WLMAP414"
    },
    {
        "id": "732",
        "symbol": "VAR_WLMAP415"
    },
    {
        "id": "733",
        "symbol": "VAR_WLMAP416"
    },
    {
        "id": "734",
        "symbol": "VAR_WLMAP417"
    },
    {
        "id": "735",
        "symbol": "VAR_WLMAP418"
    },
    {
        "id": "736",
        "symbol": "VAR_WLMAP419"
    },
    {
        "id": "737",
        "symbol": "VAR_WLMAP420"
    }
];
const range = (first, last) => Array.from({ length: last - first + 1 }, (_, i) => String(first + i));
// Persistent order is defined by wl_map_word_indices, not numeric-ID arithmetic.
const seen = [...range(223, 398), ...range(597, 608), ...range(702, 719)];
const visited = [...range(399, 574), ...range(621, 632), ...range(720, 737)];
const mapWords = [...seen, ...visited, "575", "576", "577", "578", "579", "645", "580", "581", "582"];
export const WRECKLIGHT_CHAMBERS_REVIEW = {
    ...WRECKLIGHT_WARDEN_DYNAMO_BEAM_REVIEW,
    project,
    compilerDependencies: [
        {
            "path": "appData/engine/gbvm/src/core/ui.c",
            "bytes": 21113,
            "sha256": "2bdb8547aaea5c43b48d90c84a0a06c62a84cdfcd77f58780aa4245c255b9c55"
        },
        {
            "path": "appData/engine/gbvm/src/core/music_manager.c",
            "bytes": 3852,
            "sha256": "7faed812fdef886fcb84705db9cea43f1a04ff5c0de6b7772187d0cef3cd0320"
        },
        {
            "path": "appData/engine/gbvm/src/core/input.c",
            "bytes": 690,
            "sha256": "7b4db1936abb55f826abfa0cfc1c3cc2b5379b24c6476bf9750fbce370331210"
        },
        {
            "path": "appData/engine/gbvm/src/core/camera.c",
            "bytes": 2561,
            "sha256": "a765d9b12b0cb47ce725a1c0d025aaaacc22d3beebd391b5b0b47b8eb974d882"
        },
        {
            "path": "appData/engine/gbvm/src/core/scroll.c",
            "bytes": 9430,
            "sha256": "5207e3e1c34371ae3e94f0ca1c32a9d25bc261cbf3cd8261cc0040f3800451e8"
        },
        {
            "path": "appData/engine/gbvm/src/core/interrupts.c",
            "bytes": 2078,
            "sha256": "fc7c2ccf07625992a5487a83ab1a62f0eacbb960562b71087b01a228bd38049f"
        }
    ],
    variables: [...WRECKLIGHT_WARDEN_DYNAMO_BEAM_REVIEW.variables, ...variables],
    rooms: [...WRECKLIGHT_WARDEN_DYNAMO_BEAM_REVIEW.rooms, ...rooms],
    targets: [...WRECKLIGHT_WARDEN_DYNAMO_BEAM_REVIEW.targets,
        { room: 22, slot: 1, hp: "700", dead: "701", phase: null, armor: 0 },
        { room: 23, slot: 1, hp: "700", dead: "701", phase: null, armor: 0 }],
    backgrounds: [...WRECKLIGHT_WARDEN_DYNAMO_BEAM_REVIEW.backgrounds.map((background) => ({
            ...background,
            alternatives: background.sceneId === "0f7c0021-3a3e-59a0-8630-7952e81a5708"
                ? [{ id: "92cc9c1b-635a-53c1-8a48-14eb2f297ecc", metadataPath: "assets/backgrounds/acquisition_fuse_locker_r02.png.gbsres" }]
                : background.sceneId === "2e7609cd-b739-58b1-8a97-83ff74334c80"
                    ? [{ id: "ee559f3b-a65f-5935-8080-781214ba114f", metadataPath: "assets/backgrounds/acquisition_sump_cabinet_r02.png.gbsres" }] : [],
        })), ...backgrounds],
    runtime: {
        mapWords, seen, visited, roomWords: ["579", "645"],
        newGameWrites: [...mapWords, "589", "583", "584"],
        verifyReads: ["589"],
        hudReads: ["58", "59", "78", "92", "136", "137", "141", "220", "646"],
        modalReads: ["82", "83", "84", "85", "589"],
        entryReads: ["59", "137"],
        collectReads: ["76", "8", "21", "36", "58", "59", "77", "78", "80", "81", "86", "92", "94", "95", "98", "136", "137", "141", "220", "221", "585", "586", "587", "646"],
    },
    extendedEvents: {
        title: {
            "id": "52444fb8-03be-59e7-8df6-0fc63046eba8",
            "symbol": "scene_wrecklight_title",
            "resourcePath": "project/scenes/wrecklight_title/scene.gbsres",
            "background": {
                "id": "d587f814-2e80-5ef2-b4b2-5ace726af0ed",
                "metadataPath": "assets/backgrounds/wrecklight_title_v01.png.gbsres",
                "width": 160,
                "height": 144
            },
            "paletteIds": [
                "0272afe0-6397-5a04-ac58-258c7a3f8eb8",
                "183e78db-5f79-526c-b370-6f63e779ac94",
                "3741d82f-fe06-5099-8edb-5d49ed997452",
                "b3c07dac-a9e5-5fd4-8b86-63b1c1a244d6",
                "default-bg-5",
                "default-bg-6",
                "dmg",
                "default-ui"
            ]
        },
        sounds: [
            {
                "id": "26d9f455-453d-578e-a061-e27c47bc3043",
                "symbol": "sound_wl_air_lift",
                "filename": "wrecklight-air-lift.wav",
                "metadataPath": "assets/sounds/wrecklight-air-lift.wav.gbsres"
            },
            {
                "id": "89477864-9124-57d3-95de-ed31d2b49d90",
                "symbol": "sound_wl_beacon_extract",
                "filename": "wrecklight-beacon-extract.wav",
                "metadataPath": "assets/sounds/wrecklight-beacon-extract.wav.gbsres"
            },
            {
                "id": "59de33fb-cd4c-58a4-abda-8eda7b0e1427",
                "symbol": "sound_wl_core_install",
                "filename": "wrecklight-core-install.wav",
                "metadataPath": "assets/sounds/wrecklight-core-install.wav.gbsres"
            },
            {
                "id": "485c555a-6ecd-5b52-9245-961350ae1501",
                "symbol": "sound_wl_dynamo_online",
                "filename": "wrecklight-dynamo-online.wav",
                "metadataPath": "assets/sounds/wrecklight-dynamo-online.wav.gbsres"
            },
            {
                "id": "94c9c153-dfcb-5cf4-b65e-a86624c111bf",
                "symbol": "sound_wl_ui_tick",
                "filename": "wrecklight-ui-tick.wav",
                "metadataPath": "assets/sounds/wrecklight-ui-tick.wav.gbsres"
            }
        ],
    },
};
//# sourceMappingURL=chambers.js.map