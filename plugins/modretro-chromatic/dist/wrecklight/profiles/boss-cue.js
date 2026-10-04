// Additive cue successor: the three source bindings preserve the six accepted
// call sites and their first-reference order. Earlier boss reviews stay exact.
const cueAliases = [
    { id: "137", alias: "VAR_TURBINEPATROLDEAD" }, { id: "81", alias: "VAR_CUTTEROWNED" },
    { id: "136", alias: "VAR_TURBINEPATROLHEALTH" }, { id: "8", alias: "VAR_HEALTH" },
    { id: "L4", alias: "VAR_S9A4_LOCAL_4" }, { id: "L5", alias: "VAR_S9A4_LOCAL_5" },
    { id: "92", alias: "VAR_SERVICEHELD" }, { id: "L0", alias: "VAR_S9A4_LOCAL_0" },
    { id: "L1", alias: "VAR_S9A4_LOCAL_1" }, { id: "0", alias: "VAR_PLAYERX" },
    { id: "1", alias: "VAR_PLAYERY" }, { id: "138", alias: "VAR_TURBINEPATROLX" },
    { id: "139", alias: "VAR_TURBINEPATROLY" },
];
const epochAliases = [...cueAliases,
    { id: "L2", alias: "VAR_S9A4_LOCAL_2" }, { id: "150", alias: "VAR_ENCOUNTEREPOCH" },
];
export const WRECKLIGHT_BOSS_CUE_SOURCE_REVIEW = {
    replacements: [
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_brakemaw_guards.c",
            bytes: 5320,
            sha256: "7751dc32335717b0b4c6a7f25864db522d8abfcb127fb4abfb39fbadc2108b11",
        },
        {
            path: "plugins/wrecklight-controller/events/eventWrecklightEnemyCondition.js",
            bytes: 12220,
            sha256: "f7d87592a85467aa9b9cc3b7484171197f681a15acec9e969bd82b7de3004e91",
        },
        {
            path: "project/scenes/turbine_vault/actors/plated_turbine_patrol.gbsres",
            bytes: 622658,
            sha256: "bd44ed75eb295d198f80f78ae456a759604d5e73b62a7dc5c52a96290c0c7051",
        },
    ],
    fixedDescriptor: {
        _resourceType: "project",
        notes: "Native save compatibility revision: wrecklight-sep18-boss-cue-engine-1",
        _version: "4.2.0",
        _release: "10",
    },
    kinds: {
        brakemawCueUpper: { nativeFunction: "wl_brakemaw_cue_upper", aliases: cueAliases },
        brakemawCueUpperEpoch: { nativeFunction: "wl_brakemaw_cue_upper_epoch", aliases: epochAliases },
        brakemawCueFloor: { nativeFunction: "wl_brakemaw_cue_floor", aliases: cueAliases },
        brakemawCueFloorEpoch: { nativeFunction: "wl_brakemaw_cue_floor_epoch", aliases: epochAliases },
    },
    // VM_GLOBAL stores full UWORDs. Range/positive comparisons cast to signed
    // WORD; zero flags, endpoints and epoch equality never narrow to a byte.
    wordSemantics: {
        storageType: "UWORD", orderedType: "WORD", resultType: "UWORD",
        fullWordZeroReads: ["137", "81", "L4", "L5", "92"],
        signedPositiveReads: ["136", "8"],
        signedRanges: [
            { id: "L0", minimum: 16, maximum: 104 }, { id: "L1", minimum: 152, maximum: 192 },
            { id: "0", minimum: 32, maximum: 168 }, { id: "1", minimum: 176, maximum: 264 },
            { id: "138", minimum: 112, maximum: 152 }, { id: "139", minimum: 216, maximum: 264 },
        ],
        endpointValues: [112, 152], upperY: 216, floorY: 264,
        epochReads: ["L2", "150"],
    },
    // These are temporary VM workspace writes, not persistent variable edges.
    // The following VM_IF_CONST consumes the single live full-word result.
    stack: {
        workspaceWords: 4, liveResultWords: 1, branchPoppedWords: 1,
        resultValues: [0, 1],
        ordinaryResidue: ["endpoint", "rightEndpoint", 152],
        epochResidue: ["epochEqual", "encounterEpoch", 152],
    },
    sites: [
        { id: "809442f9-4e59-57f0-932d-45c003ceaa86", kind: "brakemawCueUpper" },
        { id: "e8f69261-d7b9-58d5-89f6-1c1d2cade36b", kind: "brakemawCueUpperEpoch" },
        { id: "6e38474d-e230-5ac8-9327-c574918b4303", kind: "brakemawCueUpper" },
        { id: "c10f54b2-920d-51b1-80d9-621714969433", kind: "brakemawCueUpperEpoch" },
        { id: "220396cb-33c3-586c-aa81-1b85a5b1a0b4", kind: "brakemawCueFloor" },
        { id: "4eca4a5a-5019-5342-b486-788cb5823078", kind: "brakemawCueFloorEpoch" },
    ],
};
//# sourceMappingURL=boss-cue.js.map