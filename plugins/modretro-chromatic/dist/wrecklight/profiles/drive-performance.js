// Drive sampling preserves eight separate VM commands beneath the original
// dead guard. The actor resource is newly bound so that schedule is part of
// this successor's source closure, alongside its C and handler replacements.
export const WRECKLIGHT_DRIVE_PERFORMANCE_SOURCE_REVIEW = {
    replacements: [
        {
            path: "plugins/wrecklight-controller/engine/include/wrecklight_door_maps.h",
            bytes: 2819,
            sha256: "0aa305ed342f2f57f24af0598fc9810261c33d553d319403da1318bcd6f6c243",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/scroll.c.patch",
            bytes: 5445,
            sha256: "400b432f4b24b8d606e019c8c1c561ef269107029df88d05f6b13270df200915",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_chambers.c",
            bytes: 17299,
            sha256: "69dd8b555d750a8535242fbf3df0d55b144669ae94fac68c04c3759062ed9c81",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_door_maps.c",
            bytes: 15527,
            sha256: "bf231edb2c0549b1b193eb3b293961afffddb0bd54ec317e41f5ad40c18de2f4",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_enemy_ticks.c",
            bytes: 12587,
            sha256: "f541634adeb22d0d8237c8965f96aba5c0d37c7ee705218827e7316841b8787f",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_projectiles.c",
            bytes: 6294,
            sha256: "8b38952f9cc75f5a58217039666bb9fb293361a6d9b1ca84d938f995f9282f06",
        },
        {
            path: "plugins/wrecklight-controller/events/eventWrecklightEnemyTick.js",
            bytes: 6091,
            sha256: "c918870c7949b7fde6ef112fdc0d09dc13c82ab177942c386a1c9a0ad0d077ae",
        },
        {
            path: "project/scenes/drive_hall/actors/drive_charging_skimmer.gbsres",
            bytes: 32756,
            sha256: "3024f34f2c792a9c8f312f1b16bac94de45b42ee1da4a5bb6909bfd96b2d452b",
        },
    ],
    fixedDescriptor: {
        _resourceType: "project",
        notes: "Native save compatibility revision: wrecklight-sep18-drive-performance-engine-1",
        _version: "4.2.0",
        _release: "10",
    },
    // Previously sampled by stock authored events; the new native position
    // callback now also requires this symbol at compile/link time.
    additionalVariables: [{ id: "55", symbol: "VAR_DRIVESKIMMERY" }],
    captureBindings: {
        sceneId: "868a3167-80f5-542b-8352-084c0c4808da",
        sceneIndex: 2,
        actorId: "drive_skimmer",
        actorPath: "project/scenes/drive_hall/actors/drive_charging_skimmer.gbsres",
        entityIndex: 4,
        actorSlot: 5,
        enabledSceneTypes: ["TOPDOWN", "PLATFORM", "ADVENTURE", "SHMUP", "POINTNCLICK", "LOGO"],
        guardId: "ecc0b002-7490-4ab8-9126-000000002906",
        guardExpression: "$53$ == 0",
        order: ["sample_player", "sample_skimmer", "sample_scroll_x", "sample_scroll_y",
            "sample_grounded", "sample_hud", "sample_death", "tick_packed"],
        globalAliases: [
            { id: "0", alias: "VAR_PLAYERX" }, { id: "1", alias: "VAR_PLAYERY" },
            { id: "54", alias: "VAR_DRIVESKIMMERX" }, { id: "55", alias: "VAR_DRIVESKIMMERY" },
        ],
        fields: {
            sample_scroll_x: { engineField: "draw_scroll_x", cType: "WORD", conversion: "word-bits",
                local: "L0", localName: "Local 0", alias: "VAR_S2A4_LOCAL_0" },
            sample_scroll_y: { engineField: "draw_scroll_y", cType: "WORD", conversion: "word-bits",
                local: "L1", localName: "Local 1", alias: "VAR_S2A4_LOCAL_1" },
            sample_grounded: { engineField: "plat_grounded", cType: "UBYTE", conversion: "signed-byte-to-word",
                local: "L2", localName: "Local 2", alias: "VAR_S2A4_LOCAL_2" },
            sample_hud: { engineField: "wl_hud_owner", cType: "UBYTE", conversion: "signed-byte-to-word",
                local: "L3", localName: "Local 3", alias: "VAR_S2A4_LOCAL_3" },
            sample_death: { engineField: "wl_death_active", cType: "UBYTE", conversion: "signed-byte-to-word",
                local: "L4", localName: "Local 4", alias: "VAR_S2A4_LOCAL_4" },
        },
    },
};
//# sourceMappingURL=drive-performance.js.map