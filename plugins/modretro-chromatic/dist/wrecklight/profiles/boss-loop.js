// Additive source contract for the prospective combined Brakemaw loop.
// Native acceptance is separate; the released cue contract stays unchanged.
const phaseAliases = [{ id: "141", alias: "VAR_TURBINEPATROLPHASE" }];
const timerAliases = [{ id: "L3", alias: "VAR_S9A4_LOCAL_3" }];
const rearmSites = ["3192329d-811e-54e8-992a-5f909955b0ea", "b5d33e22-237e-5094-83db-4f717e6a023e", "4497fe08-e4bc-503b-b454-f8a076e6be8a"];
const continueSites = ["4e03eb3e-786a-5678-84ae-b7d1889caf8c", "f8c5a976-f734-5ccb-8fa6-9124b63d12c8", "11760618-b0df-5d03-bf7c-3b114c15ae38"];
const decrementSites = ["0db3dbc2-e5ac-5b72-9618-c5a5b03c9028", "7dd38d76-c443-59fb-8290-3f3fc04cc4b9", "9123a3c0-865a-5c34-928e-994fb82b5832"];
const flashSites = ["773e29e5-7af3-50eb-ba57-2a31629e7bb6", "56e2eec6-dfeb-583c-a75c-684769d4e6c1", "2da8c6e0-e1f2-57c8-996b-02f83f67a1bd"];
const poseSites = ["6c1251e6-7bb1-54df-99b0-cfe9ea0e852d", "caec7a0a-edde-5570-acde-8168d0785112", "8ed4e225-28d6-5aa1-a29e-08a093b0fcee"];
export const WRECKLIGHT_BOSS_LOOP_SOURCE_REVIEW = {
    replacements: [
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_brakemaw_guards.c",
            bytes: 10925,
            sha256: "0b366d7f1960bd44996a4872090cd284218798b6e289a2eb128729e38a8fb2d4",
        },
        {
            path: "plugins/wrecklight-controller/events/eventWrecklightEnemyCondition.js",
            bytes: 16281,
            sha256: "8038324199d1df2c74e8e20284530535eea88fab9ae542585a546653b38f4465",
        },
        {
            path: "plugins/wrecklight-controller/events/eventWrecklightCombat.js",
            bytes: 8483,
            sha256: "1f5d770d5e669f98358c2618751f5328f876f39b2cb88f5312243ecde536f10c",
        },
        {
            path: "project/scenes/turbine_vault/actors/plated_turbine_patrol.gbsres",
            bytes: 622799,
            sha256: "5a14a7de444bf8413aaad0206966a041d371bdd9c2563f915a3834f1c68251b0",
        },
    ],
    additions: [
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_brakemaw_position.c",
            bytes: 2102,
            sha256: "28101c54545673bb65a8f3cc9d34dce675b92f2d5e1f31bc10df736819c6b662",
        },
    ],
    fixedDescriptor: {
        _resourceType: "project",
        notes: "Native save compatibility revision: wrecklight-sep18-boss-loop-engine-1",
        _version: "4.2.0",
        _release: "10",
    },
    kinds: {
        // Life and phase handlers constrain the owner and aliases, not event IDs.
        brakemawLife: { nativeFunction: "wl_brakemaw_life", aliases: [
                { id: "137", alias: "VAR_TURBINEPATROLDEAD" }, { id: "81", alias: "VAR_CUTTEROWNED" },
                { id: "136", alias: "VAR_TURBINEPATROLHEALTH" }, { id: "8", alias: "VAR_HEALTH" },
            ] },
        brakemawPhaseLt10: { nativeFunction: "wl_brakemaw_phase_lt_10", aliases: phaseAliases },
        brakemawPhaseLt20: { nativeFunction: "wl_brakemaw_phase_lt_20", aliases: phaseAliases },
        brakemawPhaseEq10: { nativeFunction: "wl_brakemaw_phase_eq_10", aliases: phaseAliases },
        brakemawPhaseEq11: { nativeFunction: "wl_brakemaw_phase_eq_11", aliases: phaseAliases },
        brakemawPhaseEq12: { nativeFunction: "wl_brakemaw_phase_eq_12", aliases: phaseAliases },
        brakemawPhaseEq13: { nativeFunction: "wl_brakemaw_phase_eq_13", aliases: phaseAliases },
        brakemawPhaseEq14: { nativeFunction: "wl_brakemaw_phase_eq_14", aliases: phaseAliases },
        brakemawPhaseEq16: { nativeFunction: "wl_brakemaw_phase_eq_16", aliases: phaseAliases },
        brakemawPhaseEq18: { nativeFunction: "wl_brakemaw_phase_eq_18", aliases: phaseAliases },
        brakemawPhaseEq20: { nativeFunction: "wl_brakemaw_phase_eq_20", aliases: phaseAliases },
        brakemawPhaseEq21: { nativeFunction: "wl_brakemaw_phase_eq_21", aliases: phaseAliases },
        brakemawPhaseEq22: { nativeFunction: "wl_brakemaw_phase_eq_22", aliases: phaseAliases },
        brakemawPhaseEq23: { nativeFunction: "wl_brakemaw_phase_eq_23", aliases: phaseAliases },
        brakemawPhaseEq24: { nativeFunction: "wl_brakemaw_phase_eq_24", aliases: phaseAliases },
        brakemawPhaseEq26: { nativeFunction: "wl_brakemaw_phase_eq_26", aliases: phaseAliases },
        brakemawCueRearm: { nativeFunction: "wl_brakemaw_cue_rearm", aliases: [
                ...timerAliases, { id: "L2", alias: "VAR_S9A4_LOCAL_2" }, { id: "150", alias: "VAR_ENCOUNTEREPOCH" },
            ], sites: rearmSites },
        brakemawCueContinue: { nativeFunction: "wl_brakemaw_cue_continue", aliases: timerAliases, sites: continueSites },
        brakemawCueFlash: { nativeFunction: "wl_brakemaw_cue_flash", aliases: timerAliases, sites: flashSites },
        brakemawCuePose: { nativeFunction: "wl_brakemaw_cue_pose", aliases: timerAliases, sites: poseSites },
    },
    operations: {
        brakemawCapturePlayer: {
            nativeFunction: "wl_brakemaw_capture_player",
            aliases: [{ id: "0", alias: "VAR_PLAYERX" }, { id: "1", alias: "VAR_PLAYERY" }],
            sites: ["1645ae2c-9a0d-52fc-98fa-31d3d593fd16"],
            reads: [], writes: ["0", "1"], actor: "player",
        },
        brakemawCaptureBoss: {
            nativeFunction: "wl_brakemaw_capture_boss",
            aliases: [{ id: "138", alias: "VAR_TURBINEPATROLX" }, { id: "139", alias: "VAR_TURBINEPATROLY" }],
            sites: ["21824af1-0632-5c91-ae33-0c1d10776a95"],
            reads: [], writes: ["138", "139"], actor: "owner",
        },
        brakemawCueDecrement: {
            nativeFunction: "wl_brakemaw_cue_decrement", aliases: timerAliases, sites: decrementSites,
            reads: ["L3"], writes: ["L3"],
        },
    },
    wordSemantics: {
        storageType: "UWORD", orderedType: "WORD", resultType: "UWORD",
        life: { fullWordZeroReads: ["137", "81"], signedPositiveReads: ["136", "8"] },
        phase: { reads: ["141"], signedLessThan: [10, 20], signedEquals: [10, 11, 12, 13, 14, 16, 18, 20, 21, 22, 23, 24, 26] },
        countdown: { signedRearmMaximum: 0, signedContinueMinimumExclusive: 1, signedPoseEquals: 12,
            fullWordFlashEquals: [18, 6], fullWordEpochReads: ["L2", "150"], decrement: "unsigned-16-bit-wrap" },
        position: { inputType: "UWORD", shift: "logical-right", shiftBits: 5, savedCaptureOffsets: [-3, -2] },
    },
    // These are temporary VM workspaces, not persistent variable effects. Keep
    // the distinct footprints and residue instead of reusing the old cue's four.
    stack: {
        life: { workspaceWords: 3, liveResultWords: 1, branchPoppedWords: 1, residue: ["playerAlive", 0] },
        phase: { workspaceWords: 2, liveResultWords: 1, branchPoppedWords: 1, residue: ["comparisonLiteral"] },
        rearm: { workspaceWords: 3, liveResultWords: 1, branchPoppedWords: 1,
            residue: ["epochDifferent", "encounterEpoch"], orderedWordStores: 7, orderedStackPointerStores: 7 },
        continue: { workspaceWords: 2, liveResultWords: 1, branchPoppedWords: 1,
            residue: [1], orderedWordStores: 3, orderedStackPointerStores: 3 },
        pose: { workspaceWords: 2, liveResultWords: 1, branchPoppedWords: 1,
            residue: [12], orderedWordStores: 3, orderedStackPointerStores: 3 },
        flash: { workspaceWords: 3, liveResultWords: 1, branchPoppedWords: 1,
            residue: ["timerEquals6", 6], orderedWordStores: 7, orderedStackPointerStores: 7 },
        decrement: { workspaceWords: 2, liveResultWords: 0, branchPoppedWords: 0,
            residue: ["timerMinus1", 1], orderedWordStores: 4, orderedStackPointerStores: 4 },
        position: { captureWorkspaceWords: 4, workspaceWords: 2, liveResultWords: 0, branchPoppedWords: 0,
            residue: ["convertedY", 5], orderedWordStores: 8, orderedStackPointerStores: 8 },
    },
    // Authored traversal order is significant for the compiler's first-reference
    // allocation. The exact actor binding protects these 33 substitutions.
    sites: [
        { id: "92537dde-1a4b-59ea-9158-72b5dfc30c8c", kind: "brakemawLife" },
        { id: "1645ae2c-9a0d-52fc-98fa-31d3d593fd16", operation: "brakemawCapturePlayer" },
        { id: "21824af1-0632-5c91-ae33-0c1d10776a95", operation: "brakemawCaptureBoss" },
        { id: "710100ff-85ec-51d2-abb6-924721a34d43", kind: "brakemawPhaseLt10" },
        { id: "aa4511f0-e9cf-50b4-81d5-c40ee97493c0", kind: "brakemawPhaseLt20" },
        { id: "ad52da27-1ee7-59c3-878b-e691406482b0", kind: "brakemawPhaseEq10" },
        { id: "fc301ee5-6696-53c5-afca-b78ea4714c36", kind: "brakemawPhaseEq11" },
        { id: "30222d77-db2b-56c3-8923-f2a4f6051bda", kind: "brakemawPhaseEq12" },
        { id: "d9e3bce4-b488-57fb-92bf-04eedee920cd", kind: "brakemawPhaseEq13" },
        { id: "416b9013-f04e-5f9f-8f8b-6193e86e5d9a", kind: "brakemawPhaseEq14" },
        { id: "98b0824f-07c9-590f-9e9c-c64cc780b432", kind: "brakemawPhaseEq16" },
        { id: rearmSites[0], kind: "brakemawCueRearm" },
        { id: continueSites[0], kind: "brakemawCueContinue" },
        { id: decrementSites[0], operation: "brakemawCueDecrement" },
        { id: flashSites[0], kind: "brakemawCueFlash" },
        { id: poseSites[0], kind: "brakemawCuePose" },
        { id: "9cc37d5f-ef90-56bd-b156-e5e8a5a9720a", kind: "brakemawPhaseEq18" },
        { id: rearmSites[1], kind: "brakemawCueRearm" },
        { id: continueSites[1], kind: "brakemawCueContinue" },
        { id: decrementSites[1], operation: "brakemawCueDecrement" },
        { id: flashSites[1], kind: "brakemawCueFlash" },
        { id: poseSites[1], kind: "brakemawCuePose" },
        { id: "016bbc78-e75d-5432-83ad-cb29fbf8d06f", kind: "brakemawPhaseEq20" },
        { id: "3a52a2a6-d69d-5f71-811e-a5a27d85e743", kind: "brakemawPhaseEq21" },
        { id: "35bbf2e7-1128-5636-9d35-af9757975722", kind: "brakemawPhaseEq22" },
        { id: "04430c49-6380-5c04-9a6b-96c1d0b61d67", kind: "brakemawPhaseEq23" },
        { id: "2956aced-e5f8-5c74-aa39-d44b31e290ed", kind: "brakemawPhaseEq24" },
        { id: "4cf5d306-aa5b-559a-90f8-ab89993bbb88", kind: "brakemawPhaseEq26" },
        { id: rearmSites[2], kind: "brakemawCueRearm" },
        { id: continueSites[2], kind: "brakemawCueContinue" },
        { id: decrementSites[2], operation: "brakemawCueDecrement" },
        { id: flashSites[2], kind: "brakemawCueFlash" },
        { id: poseSites[2], kind: "brakemawCuePose" },
    ],
};
//# sourceMappingURL=boss-loop.js.map