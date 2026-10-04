// Exact Warden sampling and overlay-repair composition. Earlier profiles remain separate.
export const WRECKLIGHT_OVERLAY_SOURCE_REVIEW = {
    "compilerAdditions": [
        {
            "path": "appData/engine/gbvm/src/core/vm_actor.c",
            "bytes": 29501,
            "sha256": "db962731ab1dd73b43ead972d5583c9c96d7c526655c8b40b8756bd9887f61de"
        }
    ],
    "replacements": [
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_door_maps.h",
            "bytes": 2278,
            "sha256": "dd8adf9a6c3a30128bea451464cbf33db97f3bfd97c41996e1a48f392e92f200"
        },
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_warden.h",
            "bytes": 832,
            "sha256": "715635ce947252739df5e92dd84bce122b8723ffee6a01ae356db95e71e3e09d"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/scroll.c.patch",
            "bytes": 3602,
            "sha256": "8e56aa9945312548c606c35a39caa6535c011688ac1d0360d2385c4be0539598"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_chambers.c",
            "bytes": 14307,
            "sha256": "09e61db8871d7097676b7ae10909a2a17de75328b295bb2bdca870a2b12d9b0e"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_warden.c",
            "bytes": 18702,
            "sha256": "f066c8317d7ec26fc6b1f2f028ab77a7a662a14b06980092b9455d18b1a32272"
        },
        {
            "path": "plugins/wrecklight-controller/events/eventWrecklightWarden.js",
            "bytes": 3807,
            "sha256": "b851fd4cdda618942083e11fbaba9dcbe9ae292cc5bdf67525d7a2f4ef64f9fc"
        }
    ],
    "curatedOmittedBindings": [
        "plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_pause.c.orig"
    ],
    "fixedDescriptor": {
        "_resourceType": "project",
        "notes": "Native save compatibility revision: wrecklight-sep18-overlay-invalidation-engine-2",
        "_version": "4.2.0",
        "_release": "10"
    }
};
//# sourceMappingURL=overlay.js.map