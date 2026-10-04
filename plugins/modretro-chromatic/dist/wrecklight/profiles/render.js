// Exact source bindings for the combined Warden visibility and chamber span trial.
// Capture callbacks, argument packing and their semantic guards remain unchanged.
export const WRECKLIGHT_RENDER_SOURCE_REVIEW = {
    replacements: [
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_warden.c",
            bytes: 22953,
            sha256: "4f90669507d89e42e49fb12355e1f6eff756b449092f33cc60b4db92260693e2",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_chambers.c",
            bytes: 14881,
            sha256: "a77f7224c39874971f87ce6568ae60bdf57e9a0efbce21301f99bfc0d3609261",
        },
    ],
    curatedOmittedBindings: ["plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_pause.c.orig"],
    fixedDescriptor: {
        _resourceType: "project",
        notes: "Native save compatibility revision: wrecklight-sep18-render-budget-engine-1",
        _version: "4.2.0",
        _release: "10",
    },
};
//# sourceMappingURL=render.js.map