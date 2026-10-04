// Exact source bindings for the combined chamber, seal-span and scroll-damage changes.
// Capture callbacks, packed arguments and their semantic guards remain unchanged.
export const WRECKLIGHT_SCROLL_SOURCE_REVIEW = {
    replacements: [
        {
            path: "plugins/wrecklight-controller/engine/include/wrecklight_door_maps.h",
            bytes: 2614,
            sha256: "09c7e46d09b0663106e85b64ae567724cb0893367ba550b833d56044e1ebd7be",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/scroll.c.patch",
            bytes: 4676,
            sha256: "2b781d279bccbd683939d047ad71f2b6ee411aae17769b7df029834f44f1d8ff",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_chambers.c",
            bytes: 14910,
            sha256: "1607bc2823515dba830fcaaca733591a077230fb3e142d3fd2911c7fe4f4ed3a",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_rewards.c",
            bytes: 12812,
            sha256: "89435f44982c6a3bbf981b37ed63e9f3b5702ebf1ec30ffb9c5ae13034da1e75",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_warden.c",
            bytes: 23941,
            sha256: "b3da281cb8424a2002100df6b8f68e4efc312d2e63083624f13bd8fd49628749",
        },
    ],
    curatedOmittedBindings: ["plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_pause.c.orig"],
    fixedDescriptor: {
        _resourceType: "project",
        notes: "Native save compatibility revision: wrecklight-sep18-scroll-budget-engine-1",
        _version: "4.2.0",
        _release: "10",
    },
};
//# sourceMappingURL=scroll.js.map