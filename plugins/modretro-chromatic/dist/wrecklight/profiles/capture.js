// Exact combined capture, argument-pack, cell and coupler source. Alias facts are compiler-bound;
// engine field reads do not masquerade as authored VM variable dependencies.
export const WRECKLIGHT_CAPTURE_SOURCE_REVIEW = {
    replacements: [
        {
            path: "plugins/wrecklight-controller/engine/include/wrecklight_warden.h",
            bytes: 1093,
            sha256: "7763eb767aa6557428030b04836fdd80cd9e1258cfc8c19171d95965cf51ef42",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_warden.c",
            bytes: 22187,
            sha256: "3bd3b9010c595fec7322692f85edb9d08713d870219d871eba2d1f715a84442a",
        },
        {
            path: "plugins/wrecklight-controller/events/eventWrecklightWarden.js",
            bytes: 5915,
            sha256: "10f093c7233db6af613e7ca70b71b8ef6ffe568fd6bd72c39a98166ba70aaca0",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_world.c",
            bytes: 45784,
            sha256: "1f30c4fe1c1c686a06856f9ce3eb21f73e83598bf7bb730a88cb9eba453905a1",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_chambers.c",
            bytes: 14353,
            sha256: "86f7f407637bd119e254950908fe55fe1dab1718f7c49b73ea88e147a8b1c632",
        },
    ],
    curatedOmittedBindings: ["plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_pause.c.orig"],
    fixedDescriptor: {
        _resourceType: "project",
        notes: "Native save compatibility revision: wrecklight-sep18-typed-captures-engine-1",
        _version: "4.2.0",
        _release: "10",
    },
    captureBindings: {
        sceneIndex: 17,
        enabledSceneTypes: ["TOPDOWN", "PLATFORM", "ADVENTURE", "SHMUP", "POINTNCLICK", "LOGO"],
        packTickArguments: true,
        operations: {
            sample_scroll_x: { engineField: "draw_scroll_x", cType: "WORD", conversion: "word-bits",
                local: "L0", localName: "Local 0", alias: "VAR_S17A4_LOCAL_0" },
            sample_scroll_y: { engineField: "draw_scroll_y", cType: "WORD", conversion: "word-bits",
                local: "L1", localName: "Local 1", alias: "VAR_S17A4_LOCAL_1" },
            sample_grounded: { engineField: "plat_grounded", cType: "UBYTE", conversion: "signed-byte-to-word",
                local: "L2", localName: "Local 2", alias: "VAR_S17A4_LOCAL_2" },
            sample_hud: { engineField: "wl_hud_owner", cType: "UBYTE", conversion: "signed-byte-to-word",
                local: "L3", localName: "Local 3", alias: "VAR_S17A4_LOCAL_3" },
            sample_death: { engineField: "wl_death_active", cType: "UBYTE", conversion: "signed-byte-to-word",
                local: "L4", localName: "Local 4", alias: "VAR_S17A4_LOCAL_4" },
        },
    },
};
//# sourceMappingURL=capture.js.map