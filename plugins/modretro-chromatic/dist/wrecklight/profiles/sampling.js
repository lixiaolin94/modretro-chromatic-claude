// Exact Source01 candidate for budgeted Warden sampling. The original sample
// operations remain available; only this coherent source set enables the batch.
export const WRECKLIGHT_SAMPLING_SOURCE_REVIEW = {
    replacements: [
        {
            path: "plugins/wrecklight-controller/engine/include/wrecklight_warden.h",
            bytes: 1136,
            sha256: "d3bb3e54753d577f30802dc17b0c9513aa96623de03de461bfd64f490b683158",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/vm.c.patch",
            bytes: 13770,
            sha256: "b01cd96b41f1f3bdc5cfe8f707241d4acac7f60a69f0b4c91e734c20a62d75c3",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_warden.c",
            bytes: 26577,
            sha256: "2d1a03795875ae4495424a94006a1937617353e44c7749ff34047d3df5539f74",
        },
        {
            path: "plugins/wrecklight-controller/events/eventWrecklightWarden.js",
            bytes: 8157,
            sha256: "576eac83e7c476552d22aaaf5e427078b139c51fdfc59e31ff785b4a083c3bd5",
        },
    ],
    curatedOmittedBindings: ["plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_pause.c.orig"],
    fixedDescriptor: {
        _resourceType: "project",
        notes: "Native save compatibility revision: wrecklight-sep18-sampling-budget-engine-1",
        _version: "4.2.0",
        _release: "10",
    },
};
//# sourceMappingURL=sampling.js.map