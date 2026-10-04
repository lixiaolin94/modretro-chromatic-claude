// Exact September owner + released V6 composition. Keep every older profile intact.
// The world binding includes the three owner Warden hooks; owner UI/art remain inherited.
// Warden private RAM packing retains the same public effects and interfaces.
// Source pins describe one complete candidate; build/play acceptance is separate.
export const WRECKLIGHT_COMBINED_SOURCE_REVIEW = {
    "removedProjectBindings": [
        "project.gbsproj"
    ],
    "replacements": [
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_combat.h",
            "bytes": 1449,
            "sha256": "fa3364e95403880b940089a0dbf2fb7aa659194bb591594eba95dd0d80f4ccb5"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/actor.c.patch",
            "bytes": 3873,
            "sha256": "7dbc24596cfbc9e574cda0277a5a0a9d91409646a825bb6887ca6239c57e3098"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/core.c.patch",
            "bytes": 7570,
            "sha256": "ab69335e73f5b8c08462d056f0babfbada946da09688aba18fe7e0be7802b252"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/projectiles.c.patch",
            "bytes": 27111,
            "sha256": "8651816d0bb5f665b4df61a2ff9b56405be5be325a09f814d3d9a7ed3928cc1f"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/vm.c.patch",
            "bytes": 11883,
            "sha256": "b7863a977c9a057f73312d7379063e539e7859fdd061e71a73aaca541b648165"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_cargo_idle.c",
            "bytes": 2729,
            "sha256": "6f48f7c51f873de38e35aa8300d7b5171640965261d7497ae60d046b7e60c04a"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_combat.c",
            "bytes": 13485,
            "sha256": "203890baaf13868021c65a800cd9745f9bc901835b438928b490c3615346a0b6"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_presentation.c",
            "bytes": 57862,
            "sha256": "679b8ce68bcdb0b83f522df2c29f41f8924105e639060e503e6808b14e3f1aaa"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_projectiles.c",
            "bytes": 6234,
            "sha256": "e12402a73253686b214ee152a663adc828371f89b32426f7ba6c8b84fe28aae0"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_reactor_idle.c",
            "bytes": 3932,
            "sha256": "77cac8bc8d274dda0021c1ed2c9ae2c7be77cf9584b80f4f369511f5b701212b"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_render.c",
            "bytes": 3617,
            "sha256": "31e6a5bc4bba6fbeb847f1911b4f4eb51a26beeeb0aecc53f804a527f88d926b"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_rewards.c",
            "bytes": 12541,
            "sha256": "e18aa73724cbe4ddb6c2587f8a51b48811b1fdd1cb87d5fed63ad955c9532f43"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_warden.c",
            "bytes": 16210,
            "sha256": "710824720e41493eb57a84cf47b141c2b6a99fa8286f7a8c54bb8165255558c6"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_world.c",
            "bytes": 43920,
            "sha256": "4b9fd8f5a4319772825d4662fc9040d80fb05a5a14a9012ec44881e37183670a"
        },
        {
            "path": "plugins/wrecklight-controller/events/eventWrecklightCombat.js",
            "bytes": 2862,
            "sha256": "3d70dcbec2c5f344164a489109ea5f4b1d6188f4171a4dea54abb73c92620e89"
        },
        {
            "path": "plugins/wrecklight-title/engine/src/core/wrecklight_title.c",
            "bytes": 11623,
            "sha256": "78e5c564ea2ee47ce689f7691564d2a5a1b0e5343820f79550d89897c360950b"
        },
        {
            "path": "project/settings.gbsres",
            "bytes": 2612,
            "sha256": "e6530228c844ad93a4d8dceb4259b10e7910cb6bf61f426ba31a46a9913a1f0b"
        }
    ],
    "additions": [
        {
            "path": "plugins/wrecklight-controller/engine/include/shadow.h.patch",
            "bytes": 936,
            "sha256": "5ab8cd19f7e3e022649f7c19c249b8acb4101e708ed7dbf5815dade7d6bd1131"
        },
        {
            "path": "plugins/wrecklight-controller/engine/include/wrecklight_airworks_tick.h",
            "bytes": 3273,
            "sha256": "6dde671732a1ab2a8fdfc7edcfd4f10d75f98d15d044dfd377d808b911296c82"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/gb/set_tile_submap.s.patch",
            "bytes": 1488,
            "sha256": "1d5087a1a8320dea6f34a1c7c4774928de6cc9cafa8a8250e4ae50e967beedc9"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/interrupts.c.patch",
            "bytes": 2084,
            "sha256": "11f8d0fde61a5928fe4d787aed6a65ef3db12f989338c19aed549f5b9f566e60"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_airworks_bellows_tick.c",
            "bytes": 4352,
            "sha256": "75d747e0c8c4e9c0e51e014c6e41dfae68c406c67ee4c8f812a5f6ae29174c7b"
        },
        {
            "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_airworks_skimmer_tick.c",
            "bytes": 4006,
            "sha256": "05cb043397d057d03bc9ad4c80fea1790efdfc375a34a9b18350fb9bbeec0c3b"
        },
        {
            "path": "plugins/wrecklight-controller/events/eventWrecklightAirworksTick.js",
            "bytes": 4122,
            "sha256": "4408c660c4e471e74a7d03cf9f1352f8257ae0387d3d159755a327a222b514d0"
        },
        {
            "path": "plugins/wrecklight-title/engine/include/wrecklight_title_score.h",
            "bytes": 13055,
            "sha256": "d51a8d564bef8b9e1be0c12fa1f866e12b0150185549fa5f25aa77642c7726ff"
        }
    ],
    "fixedDescriptor": {
        "_resourceType": "project",
        "notes": "Native save compatibility revision: wrecklight-sep17-v6-engine-2",
        "_version": "4.2.0",
        "_release": "10"
    }
};
//# sourceMappingURL=combined.js.map