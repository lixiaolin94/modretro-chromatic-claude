// Two-cell chamber source cache. Sampling and capture semantics retain the
// complete sampling profile and its existing ownership guards.
export const WRECKLIGHT_CHAMBER_CACHE_SOURCE_REVIEW = {
    replacements: [
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_chambers.c",
            bytes: 15352,
            sha256: "26bf3265ef473772766ad310c4cc3686209184d3cd2276e9c5990f16b4668ad5",
        },
    ],
    curatedOmittedBindings: ["plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_pause.c.orig"],
    fixedDescriptor: {
        _resourceType: "project",
        notes: "Native save compatibility revision: wrecklight-sep18-chamber-cache-engine-1",
        _version: "4.2.0",
        _release: "10",
    },
};
//# sourceMappingURL=chamber-cache.js.map