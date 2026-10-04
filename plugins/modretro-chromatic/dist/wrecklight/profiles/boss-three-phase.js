// Three-phase boss successor. Keep earlier source families and their semantics
// unchanged; native contact admission and authored hit consumption are distinct.
const brakemawFloorAliases = [
    { id: "137", alias: "VAR_TURBINEPATROLDEAD" }, { id: "81", alias: "VAR_CUTTEROWNED" },
    { id: "136", alias: "VAR_TURBINEPATROLHEALTH" }, { id: "8", alias: "VAR_HEALTH" },
    { id: "L4", alias: "VAR_S9A4_LOCAL_4" }, { id: "L5", alias: "VAR_S9A4_LOCAL_5" },
    { id: "92", alias: "VAR_SERVICEHELD" }, { id: "138", alias: "VAR_TURBINEPATROLX" },
    { id: "139", alias: "VAR_TURBINEPATROLY" }, { id: "L2", alias: "VAR_S9A4_LOCAL_2" },
    { id: "150", alias: "VAR_ENCOUNTEREPOCH" },
];
export const WRECKLIGHT_BOSS_THREE_PHASE_SOURCE_REVIEW = {
    replacements: [
        {
            path: "plugins/wrecklight-acquisition/engine/src/core/wrecklight_acquisition.c",
            bytes: 12713,
            sha256: "71ac9c4b3a2b68f2ff7d81d4d94e9c46a3ca9ded8b798b8c86927a70b218e529",
        },
        {
            path: "plugins/wrecklight-controller/engine/include/wrecklight_warden.h",
            bytes: 1469,
            sha256: "e69b3d90a04d875cd32f686528f27e90fda711954edd6841572c5c732763a883",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_warden.c",
            bytes: 30773,
            sha256: "cc77ad632877307bc01c9f9aa7d72551847d665d336b48432ecb49ffdb25b47f",
        },
        {
            path: "plugins/wrecklight-controller/events/eventWrecklightWarden.js",
            bytes: 8919,
            sha256: "de9bc958ead661bf1b19fd80e684527d436335d956308a9c06a5c9148c317bf0",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_combat.c",
            bytes: 16854,
            sha256: "cc70016083c766875c7ba25a92eea2d651fc01ca456ec730cb455f722edec778",
        },
        {
            path: "plugins/wrecklight-controller/events/eventWrecklightCombat.js",
            bytes: 4965,
            sha256: "07ad9bf421ca940140857e82fab8e19e8c59d0f92b70320e43f50e1bd3d8b7db",
        },
        {
            path: "plugins/wrecklight-controller/events/eventWrecklightEnemyCondition.js",
            bytes: 8604,
            sha256: "4e0365c765162a666a868fee9ec46383ffb70b0427f6f8151f7c9dc84a56417c",
        },
        {
            path: "plugins/wrecklight-controller/events/combat-variable-ids.json",
            bytes: 469,
            sha256: "456b82e0be900073d0aa256748ea2949ea169211e7ff4558550fae43a0e8cc50",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_presentation.c",
            bytes: 58250,
            sha256: "d6490ed4d0d0abf61a9dad6140f034f973c444408b29df234e43ce81cfdd501e",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/projectiles.c.patch",
            bytes: 27839,
            sha256: "cd7832ec649c58f2c8ebe64317705dcf1466c75e219d42bc24361e75adb2c1a3",
        },
        {
            path: "project/variables.gbsres",
            bytes: 69339,
            sha256: "d4ad7743a8c63d46e15e1482c72cdf181ed23dc1605e91229b0ac6ba2f81dba4",
        },
        {
            path: "plugins/wrecklight-map-pause/engine/engine.json",
            bytes: 460,
            sha256: "928f06e1f9b8725a9f9799186b7742177ecfe8e8460181757c81ffe6aef02c3f",
        },
    ],
    additions: [
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_brakemaw_guards.c",
            bytes: 2586,
            sha256: "7e4ad0a14eb478ec8e139cc0b74152ca8267c214cf1605c01c942e9c030dbed2",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_crown_wait.c",
            bytes: 2447,
            sha256: "5a02dda3708ac10f35fbe10a0695189055c83d0cef2ef63c0966f161cb2dd489",
        },
        {
            path: "assets/sprites/wrecklight_dynamo_colossus_v01.png.gbsres",
            bytes: 98869,
            sha256: "74d500e922805d33b85b924d8c5cee78cac2411560c5f1e965fc4a609a25c980",
        },
    ],
    fixedDescriptor: {
        _resourceType: "project",
        notes: "Native save compatibility revision: wrecklight-sep18-three-phase-bosses-engine-1",
        _version: "4.2.0",
        _release: "10",
    },
    additionalVariables: [
        { id: "96", symbol: "VAR_GUARDIANACTIVE" },
        { id: "97", symbol: "VAR_GUARDIANCOREHEALTH" },
        // Existing authored globals now read directly by the native predicates.
        { id: "138", symbol: "VAR_TURBINEPATROLX" },
        { id: "139", symbol: "VAR_TURBINEPATROLY" },
    ],
    // wl_combat_contact -> damage_allowed and wl_warden_cap_damage/alive.
    // This excludes the later authored hit script and does not imply VM writes.
    combatContactReads: [
        "8", "15", "21", "27", "47", "53", "58", "59", "63", "65", "81", "92",
        "93", "94", "95", "96", "97", "98", "101", "105", "107", "111", "113",
        "119", "125", "137", "140", "141", "160", "166", "167", "172", "593", "701",
    ],
    crownCountdown: {
        sceneId: "ea5c2e78-3b17-5d25-8b34-db5e57b7b405",
        sceneIndex: 11,
        actorId: "d13e3229-95dc-54a4-8377-0b670863def4",
        actorPath: "project/scenes/relay_crown/actors/relay_machine_sequence.gbsres",
        entityIndex: 8,
        enabledSceneTypes: ["TOPDOWN", "PLATFORM", "ADVENTURE", "SHMUP", "POINTNCLICK", "LOGO"],
        pairs: [
            { phase: 1, maxFrames: 32 }, { phase: 3, maxFrames: 40 }, { phase: 2, maxFrames: 80 },
            { phase: 4, maxFrames: 28 }, { phase: 6, maxFrames: 12 }, { phase: 6, maxFrames: 40 },
            { phase: 5, maxFrames: 72 }, { phase: 7, maxFrames: 24 }, { phase: 9, maxFrames: 16 },
            { phase: 9, maxFrames: 40 }, { phase: 8, maxFrames: 80 },
        ],
        globalAliases: [
            { id: "8", alias: "VAR_HEALTH" }, { id: "92", alias: "VAR_SERVICEHELD" },
            { id: "93", alias: "VAR_GUARDIANPHASE" }, { id: "94", alias: "VAR_GUARDIANTARGETLEFT" },
            { id: "95", alias: "VAR_GUARDIANTARGETRIGHT" }, { id: "96", alias: "VAR_GUARDIANACTIVE" },
            { id: "97", alias: "VAR_GUARDIANCOREHEALTH" }, { id: "98", alias: "VAR_GUARDIANCLEARED" },
            { id: "150", alias: "VAR_ENCOUNTEREPOCH" },
        ],
        locals: [
            { local: "L0", localName: "LOCAL_0", alias: "VAR_S11A8_LOCAL_0" },
            { local: "L1", localName: "LOCAL_1", alias: "VAR_S11A8_LOCAL_1" },
            { local: "L2", localName: "LOCAL_2", alias: "VAR_S11A8_LOCAL_2" },
            { local: "L3", localName: "LOCAL_3", alias: "VAR_S11A8_LOCAL_3" },
            { local: "L4", localName: "LOCAL_4", alias: "VAR_S11A8_LOCAL_4" },
            { local: "L5", localName: "LOCAL_5", alias: "VAR_S11A8_LOCAL_5" },
        ],
        reads: ["8", "92", "93", "94", "95", "96", "98", "150"],
    },
    brakemawGuards: {
        sceneId: "87eb4a35-9aab-5d69-8952-e990ae3d1991",
        sceneIndex: 9,
        actorId: "59b6dd9c-0b0d-5a50-adcb-31f3cb7a43db",
        actorPath: "project/scenes/turbine_vault/actors/plated_turbine_patrol.gbsres",
        entityIndex: 4,
        actorSlot: 5,
        enabledSceneTypes: ["TOPDOWN", "PLATFORM", "ADVENTURE", "SHMUP", "POINTNCLICK", "LOGO"],
        kinds: {
            brakemawSoft: {
                nativeFunction: "wl_brakemaw_soft",
                aliases: [
                    { id: "L0", alias: "VAR_S9A4_LOCAL_0" }, { id: "L1", alias: "VAR_S9A4_LOCAL_1" },
                    { id: "0", alias: "VAR_PLAYERX" }, { id: "1", alias: "VAR_PLAYERY" },
                ],
            },
            brakemawHardFloor: { nativeFunction: "wl_brakemaw_hard_floor", aliases: brakemawFloorAliases },
            brakemawHardEndpoint: {
                nativeFunction: "wl_brakemaw_hard_endpoint",
                aliases: [...brakemawFloorAliases, { id: "140", alias: "VAR_TURBINEPATROLFACING" }],
            },
            brakemawHardPending: {
                nativeFunction: "wl_brakemaw_hard_pending",
                aliases: [...brakemawFloorAliases, { id: "140", alias: "VAR_TURBINEPATROLFACING" },
                    { id: "L3", alias: "VAR_S9A4_LOCAL_3" }],
            },
            brakemawHardEitherEnd: { nativeFunction: "wl_brakemaw_hard_either_end", aliases: brakemawFloorAliases },
        },
    },
    warden: {
        sprite: {
            id: "4bde5638-4a3c-5c6d-a8bc-a8621fe7da60",
            symbol: "sprite_wrecklight_dynamo_colossus_v01",
            filename: "wrecklight_dynamo_colossus_v01.png",
            metadataPath: "assets/sprites/wrecklight_dynamo_colossus_v01.png.gbsres",
        },
        stateId: "9cb99888-c046-54ea-b647-60d81a4784a9",
        // Native frame offsets refer to the first fixed animation, not all eight.
        frameCount: 18,
        requiredChildren: ["shot", "move", "lowShot", "highShot"],
    },
};
//# sourceMappingURL=boss-three-phase.js.map