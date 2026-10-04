// Exact source successor for Warden recovery, CGB row offsets, scene notices and Keel paint reuse.
// The independent source reviews and host-model checks do not establish target or gameplay acceptance.
// Warden overlay: 200afa1ddcdba47be8528f51963db93772f83cbc765bd7c9bf5804621e918619.
// Row-fit correction: a9e6c6a65ac54bf27cdacd4951396c6fd6bc438be570725d5bb3e0e7ffe294a1.
// Keep the native changes separate for review; only their complete combined tuple is registered.
// The same unreleased pair also covers the Crown, Induction and Coil presentation composition.
// Those stock events and editable art use ordinary semantic/tilemap guards; exact shipped bytes
// are authenticated by the sample manifest, not additional native project hash locks.
export const WARDEN_PRESENTATION_REPLACEMENTS = [
    {
        path: "assets/sprites/wrecklight_dynamo_colossus_v01.png.gbsres",
        bytes: 98869,
        sha256: "536c49473924c477fbd3e894a3fb99c81e2f71f33276ff35ef6ba3e1d3f3c923",
    },
    {
        path: "plugins/wrecklight-controller/engine/src/core/wrecklight_warden.c",
        bytes: 31417,
        sha256: "be751f47a0f72ddd2cf725a52d6c0000d30d17987ee82455871180a5820259ee",
    },
];
export const CGB_ROW_COPY_REPLACEMENTS = [
    {
        path: "plugins/wrecklight-controller/engine/src/core/scroll.c.patch",
        bytes: 6651,
        sha256: "8b738cf1b53c9ae9df83ef8a1083191e8e30bd8805407c04afb4d99f997340de",
    },
    {
        path: "plugins/wrecklight-controller/engine/src/core/gb/set_tile_submap.s.patch",
        bytes: 4014,
        sha256: "30bc1c34099915997b6a92732c266007fcc38b6171d6962b9e841c44fdae98ee",
    },
];
// The room-specific Wall lesson expires at scene initialization, not HUD restoration.
export const SCENE_NOTICE_REPLACEMENTS = [
    {
        path: "plugins/wrecklight-controller/engine/src/core/wrecklight_presentation.c",
        bytes: 58708,
        sha256: "0e789b8193bb32c21c2ac67cdde1cb8153871ffd7386f68ccf6ee9125664f196",
    },
];
// The closed Keel door may reuse only a fully painted, unchanged context.
export const KEEL_CLOSED_PAINT_REPLACEMENTS = [
    {
        path: "plugins/wrecklight-controller/engine/src/core/wrecklight_chambers.c",
        bytes: 19396,
        sha256: "8ebe4224096e15d0495e156f597c6d87bdd109303e5236723938a18b09ca1f49",
    },
];
export const WRECKLIGHT_WARDEN_ROW_SOURCE_REVIEW = {
    replacements: [...WARDEN_PRESENTATION_REPLACEMENTS, ...CGB_ROW_COPY_REPLACEMENTS, ...SCENE_NOTICE_REPLACEMENTS, ...KEEL_CLOSED_PAINT_REPLACEMENTS],
};
//# sourceMappingURL=warden-row.js.map