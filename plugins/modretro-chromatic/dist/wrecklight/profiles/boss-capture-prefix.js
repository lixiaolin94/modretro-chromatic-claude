// Isolated capture/prefix source profile. Source identity and dependency
// semantics do not establish native performance or release acceptance.
export const WRECKLIGHT_BOSS_CAPTURE_PREFIX_SOURCE_REVIEW = {
    replacements: [
        {
            path: "plugins/wrecklight-controller/engine/src/core/vm.c.patch",
            bytes: 14595,
            sha256: "409a6f532b1ce91130408b8268be5e716c61b0484300de25e85789cf688a1fee",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_brakemaw_position.c",
            bytes: 5755,
            sha256: "6ebd35c8687d68799fe0ae8807ef993e975cefc222b963b34d42d72779b8abfa",
        },
        {
            path: "plugins/wrecklight-controller/events/eventWrecklightCombat.js",
            bytes: 13202,
            sha256: "30b361e340920373e41fa060e753d92a7b89c46bac909c48db94830b4b619f5e",
        },
        {
            path: "project/scenes/turbine_vault/actors/plated_turbine_patrol.gbsres",
            bytes: 623427,
            sha256: "e28686dac99b8d1b5524d7cbc6a93e9ab313f21311733e4a0e8c35c7e595a7e9",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_brakemaw_guards.c",
            bytes: 12808,
            sha256: "6dbaeccb6fe49114a2ff7c5a1f90d84bc81c7fcb1da6076474e8d19dd515deb1",
        },
        {
            path: "plugins/wrecklight-controller/events/eventWrecklightEnemyCondition.js",
            bytes: 21771,
            sha256: "b93109ca2cfba84653904c4916219dbe7be361378c195ddc7cdc5d0192db00e0",
        },
    ],
    fixedDescriptor: {
        _resourceType: "project",
        notes: "Native save compatibility revision: wrecklight-sep19-boss-capture-prefix-engine-1",
        _version: "4.2.0",
        _release: "10",
    },
    // This existing global is now also named directly by the native header.
    additionalVariables: [{ id: "2", symbol: "VAR_GROUNDED" }],
    captureHeader: {
        nativeFunction: "wl_brakemaw_capture_header",
        operation: "brakemawCaptureHeader",
        eventId: "d7e59fda-9e1f-55e3-a1c5-149c75e18d6d",
        lifeEventId: "92537dde-1a4b-59ea-9158-72b5dfc30c8c",
        aliases: [
            { id: "0", alias: "VAR_PLAYERX" }, { id: "1", alias: "VAR_PLAYERY" },
            { id: "138", alias: "VAR_TURBINEPATROLX" }, { id: "139", alias: "VAR_TURBINEPATROLY" },
            { id: "L0", alias: "VAR_S9A4_LOCAL_0" }, { id: "L1", alias: "VAR_S9A4_LOCAL_1" },
            { id: "L4", alias: "VAR_S9A4_LOCAL_4" }, { id: "L5", alias: "VAR_S9A4_LOCAL_5" },
            { id: "2", alias: "VAR_GROUNDED" },
        ],
        writes: ["0", "1", "138", "139", "L0", "L1", "L4", "L5", "2"],
        fallback: [
            { id: "1645ae2c-9a0d-52fc-98fa-31d3d593fd16", command: "EVENT_WRECKLIGHT_COMBAT", args: { operation: "brakemawCapturePlayer" } },
            { id: "21824af1-0632-5c91-ae33-0c1d10776a95", command: "EVENT_WRECKLIGHT_COMBAT", args: { operation: "brakemawCaptureBoss" } },
            { id: "64f3480f-aade-5a90-b0b7-b779adc804f3", command: "EVENT_ENGINE_FIELD_STORE", args: { engineFieldKey: "draw_scroll_x", value: "L0" } },
            { id: "3d936b2d-c453-5138-99f2-fd28779090ba", command: "EVENT_ENGINE_FIELD_STORE", args: { engineFieldKey: "draw_scroll_y", value: "L1" } },
            { id: "4248ed7f-c5f4-5939-8e80-84972f85a5d2", command: "EVENT_ENGINE_FIELD_STORE", args: { engineFieldKey: "wl_hud_owner", value: "L4" } },
            { id: "9032c419-685c-554e-b4a2-6ae5343aff8b", command: "EVENT_ENGINE_FIELD_STORE", args: { engineFieldKey: "wl_death_active", value: "L5" } },
            { id: "8e9a884a-44fd-59c7-9182-8e9190a37aa2", command: "EVENT_ENGINE_FIELD_STORE", args: { engineFieldKey: "plat_grounded", value: "2" } },
        ],
        // The closed engine/variable source bindings establish these types and
        // aliases. Engine reads and temporary VM words are not variable reads.
        fields: [
            { key: "draw_scroll_x", cType: "WORD", conversion: "word-bits", destination: "L0" },
            { key: "draw_scroll_y", cType: "WORD", conversion: "word-bits", destination: "L1" },
            { key: "wl_hud_owner", cType: "UBYTE", conversion: "signed-byte-to-word", destination: "L4" },
            { key: "wl_death_active", cType: "UBYTE", conversion: "signed-byte-to-word", destination: "L5" },
            { key: "plat_grounded", cType: "UBYTE", conversion: "signed-byte-to-word", destination: "2" },
        ],
        logicalCommands: 11,
        extraCommandCharges: 10,
        fallbackBytes: 64,
        wrapperBytes: 68,
        captureWorkspaceWords: 4,
    },
    phasePrefixes: {
        lifeEventId: "92537dde-1a4b-59ea-9158-72b5dfc30c8c",
        lessThan10EventId: "710100ff-85ec-51d2-abb6-924721a34d43",
        lessThan20EventId: "aa4511f0-e9cf-50b4-81d5-c40ee97493c0",
        entries: {
            brakemawPhaseEq10: {
                nativeFunction: "wl_brakemaw_phase_prefix_10", branch: "true",
                phases: [10, 11, 12, 13, 14, 16, 18],
                sites: [
                    "ad52da27-1ee7-59c3-878b-e691406482b0", "fc301ee5-6696-53c5-afca-b78ea4714c36",
                    "30222d77-db2b-56c3-8923-f2a4f6051bda", "d9e3bce4-b488-57fb-92bf-04eedee920cd",
                    "416b9013-f04e-5f9f-8f8b-6193e86e5d9a", "98b0824f-07c9-590f-9e9c-c64cc780b432",
                    "9cc37d5f-ef90-56bd-b156-e5e8a5a9720a",
                ],
                skips: [{ phase: 16, bytes: 65, extraCommands: 10 }, { phase: 18, bytes: 78, extraCommands: 12 }],
            },
            brakemawPhaseEq20: {
                nativeFunction: "wl_brakemaw_phase_prefix_20", branch: "false",
                phases: [20, 21, 22, 23, 24, 26],
                sites: [
                    "016bbc78-e75d-5432-83ad-cb29fbf8d06f", "3a52a2a6-d69d-5f71-811e-a5a27d85e743",
                    "35bbf2e7-1128-5636-9d35-af9757975722", "04430c49-6380-5c04-9a6b-96c1d0b61d67",
                    "2956aced-e5f8-5c74-aa39-d44b31e290ed", "4cf5d306-aa5b-559a-90f8-ab89993bbb88",
                ],
                skips: [{ phase: 26, bytes: 65, extraCommands: 10 }],
            },
        },
    },
};
//# sourceMappingURL=boss-capture-prefix.js.map