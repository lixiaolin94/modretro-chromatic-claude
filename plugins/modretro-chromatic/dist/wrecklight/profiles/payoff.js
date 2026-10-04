// Exact payoff source composition. Preserve every historical profile.
// Ordinary ending scenes and scripts remain editable resources.
// The full owner source retains one inactive backup; the curated sample omits it.
export const WRECKLIGHT_PAYOFF_SOURCE_REVIEW = {
    replacements: [
        {
            path: "plugins/wrecklight-controller/engine/include/wrecklight_door_maps.h",
            bytes: 1945,
            sha256: "f2284f9e01a8fc9dd020ce17422cfc48d90b86e98f25fc3cb9b6ea6b3be7c342",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/scroll.c.patch",
            bytes: 3013,
            sha256: "4ba922166ccb546ed50541d2c28061167ac9e2ad7b3e2f73cf850179750c0478",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_chambers.c",
            bytes: 14332,
            sha256: "5bd70fad6d8de2bc71aec36c96e50aeffd9c0637eecf0c4aed6c4de84cb1ad48",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_combat.c",
            bytes: 14153,
            sha256: "878587321fa99e5808317f266be3329c17a73760feb7021b036851420dcd3136",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_door_maps.c",
            bytes: 15437,
            sha256: "12c3e25da1724b900d851ee5155e07453b8b94b1e8473a6b61f746d1015a0196",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_warden.c",
            bytes: 17881,
            sha256: "46fbef29c02dae8be8792a092b3d4efa0ef32f008d877608ace580d2101c9a94",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_world.c",
            bytes: 44925,
            sha256: "1ce665afcd0bed9ac80c102b8296689aa32dc101fb8ea52a6694d40270b97485",
        },
        {
            path: "plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_pause.c",
            bytes: 36045,
            sha256: "5e5676bb83e1058f95ad1c5aa99a2d0a6a1dafef6cae8d6605c79791c5193565",
        },
    ],
    curatedOmittedBindings: [
        "plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_pause.c.orig",
    ],
    fixedDescriptor: {
        _resourceType: "project",
        notes: "Native save compatibility revision: wrecklight-sep18-payoff-engine-1",
        _version: "4.2.0",
        _release: "10",
    },
};
//# sourceMappingURL=payoff.js.map