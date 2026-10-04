// September 17 coherent source successor. Historical profiles remain unchanged.
// Exact Deck PNG/sidecar and sprite metadata bind resident tiles and frame layout.
// Mutable title metadata is checked by the assigned-background invariants.
import { WRECKLIGHT_CHAMBERS_REVIEW } from "./chambers.js";
const replacements = [
    {
        "path": "plugins/wrecklight-acquisition/engine/include/wrecklight_acquisition_tiles.h",
        "bytes": 2298,
        "sha256": "235e3ad772eb7ddfcfd0ebbccb2dcd34c50becde3c7c88e065a3cd44ddb19140"
    },
    {
        "path": "plugins/wrecklight-acquisition/engine/src/core/wrecklight_acquisition.c",
        "bytes": 12695,
        "sha256": "386f3bf2da76ab2b3070e0a1109a7f9758ae4a64f5c2ded0835dda0aa3a8bb12"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_chambers.c",
        "bytes": 12371,
        "sha256": "881e6b88ce5475aebb4f84ea31065f34951dd51557ccf891b0fd507b0a0f0419"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_world.c",
        "bytes": 40138,
        "sha256": "96a1f73ae22334584b27d2da285fe854e6c78c313a0e64330d12c18b0c3fd85e"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/include/wrecklight_map_ui.h",
        "bytes": 773,
        "sha256": "e5388f3250e2d9bc37db5b93e19717807f6943ad2f799b8482a4acd9d2067873"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_panels.c",
        "bytes": 5713,
        "sha256": "2706d8892d610f12031398939c04c98b7242079c00471ff4e44253727e823e0a"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_pause.c",
        "bytes": 35928,
        "sha256": "269c6ae0c62addc060a2a3dcef3fed6953c2d5e59dcc511ab294ec690ad74aa7"
    },
    {
        "path": "plugins/wrecklight-map-pause/engine/src/core/wrecklight_map_tiles.c",
        "bytes": 5078,
        "sha256": "41818930c273ffb9e46a233e3a8321b30141c3caa8c316be2b46d5304e6a4d8e"
    },
    {
        "path": "plugins/wrecklight-title/engine/include/wrecklight_title_data.h",
        "bytes": 29670,
        "sha256": "303c6fea701703ab10f87300e3560d2f830ef5c3561a87666d9dbfc10fa5d719"
    }
];
const additions = [
    {
        "path": "plugins/wrecklight-controller/events/eventWrecklightWarden.js",
        "bytes": 2973,
        "sha256": "fcea7b8ad4a792fd89b2bd05a68ed04b2ad8345bee6c3a4ff80759146efd88ca"
    },
    {
        "path": "plugins/wrecklight-controller/engine/include/wrecklight_warden.h",
        "bytes": 748,
        "sha256": "fdd905e4c7d16c8d97ed8c6bf055f4f53b483592c8a5664c5e4069c8bd683457"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/wrecklight_warden.c",
        "bytes": 14535,
        "sha256": "b09fbe688894daf47bdb8a99e0668f9f1a02abee135e0ddf75faa8534abe3668"
    },
    {
        "path": "plugins/wrecklight-controller/engine/include/collision.h.patch",
        "bytes": 597,
        "sha256": "2292d0b2c9303194f063762e21c1f602f63d8843e239a24af167af6d8d853a2a"
    },
    {
        "path": "plugins/wrecklight-controller/engine/src/core/collision.c.patch",
        "bytes": 940,
        "sha256": "20d050addb38b57af81593094a1d813eb31c1a7a064bae2b92c1aa4450dfa837"
    },
    {
        "path": "assets/backgrounds/warden_deck_v03.png",
        "bytes": 4300,
        "sha256": "95ba9bb253e8d1ecb9aaf9ae3cb0965169a67914ad7eefad38de1b2b74c89b80"
    },
    {
        "path": "assets/backgrounds/warden_deck_v03.png.gbsres",
        "bytes": 841,
        "sha256": "0acd28951036467ce0b8c809a0ccd788459caa8a6a8924815a74fe4b03103491"
    },
    {
        "path": "assets/sprites/wrecklight_warden_readability_v04.png.gbsres",
        "bytes": 16191,
        "sha256": "5142d995d23de78329f5ae3ba266a5d0bbb5b2fca9e99e9750699ed3d24f7f52"
    },
    {
        "path": "assets/sounds/wrecklight-impact-metal.wav.gbsres",
        "bytes": 215,
        "sha256": "05f59ecda8138efac840f17e0e994b2737a03e88e289fc2d6ae5da82d0c2884b"
    },
    {
        "path": "assets/sounds/wrecklight-cutter-weld.wav.gbsres",
        "bytes": 212,
        "sha256": "46de44e7939b8f9446f82faa3453a17a8e9c78de2aca1945e7ced6822118945b"
    },
    {
        "path": "assets/backgrounds/wrecklight_title_eyehead_v04.png",
        "bytes": 2138,
        "sha256": "94e0f699792779edaaa5baf5f34e5dec1aaa488ee6b1f4a35bc59202d6ecdcaf"
    }
];
const wardenAliases = [
    {
        "id": "0",
        "symbol": "VAR_PLAYERX"
    },
    {
        "id": "1",
        "symbol": "VAR_PLAYERY"
    },
    {
        "id": "8",
        "symbol": "VAR_HEALTH"
    },
    {
        "id": "21",
        "symbol": "VAR_DYNAMOOWNED"
    },
    {
        "id": "58",
        "symbol": "VAR_DRIVEGUARDHEALTH"
    },
    {
        "id": "59",
        "symbol": "VAR_DRIVEGUARDDEAD"
    },
    {
        "id": "60",
        "symbol": "VAR_DRIVEGUARDX"
    },
    {
        "id": "61",
        "symbol": "VAR_DRIVEGUARDY"
    },
    {
        "id": "62",
        "symbol": "VAR_DRIVEGUARDFACING"
    },
    {
        "id": "63",
        "symbol": "VAR_DRIVEGUARDWINDUP"
    },
    {
        "id": "92",
        "symbol": "VAR_SERVICEHELD"
    },
    {
        "id": "150",
        "symbol": "VAR_ENCOUNTEREPOCH"
    },
    {
        "id": "181",
        "symbol": "VAR_DRIVEINDUCTIONSENTINELARMED"
    },
    {
        "id": "182",
        "symbol": "VAR_DRIVEINDUCTIONSENTINELEPOCH"
    },
    {
        "id": "183",
        "symbol": "VAR_DRIVEINDUCTIONSENTINELPRIME"
    },
    {
        "id": "209",
        "symbol": "VAR_DRIVEINDUCTIONSENTINELTIMER"
    }
];
export const WRECKLIGHT_SEP17_REVIEW = {
    ...WRECKLIGHT_CHAMBERS_REVIEW,
    project: [
        ...WRECKLIGHT_CHAMBERS_REVIEW.project.map((binding) => replacements.find((next) => next.path === binding.path) ?? binding),
        ...additions,
    ],
    compilerDependencies: [
        ...WRECKLIGHT_CHAMBERS_REVIEW.compilerDependencies,
        { path: "appData/engine/gbvm/src/core/collision.c", bytes: 2207,
            sha256: "809269132ff1898a27647d323d7cb1511c038b63965b7e1ce5c1ec2239b1aa64" },
    ],
    variables: [...WRECKLIGHT_CHAMBERS_REVIEW.variables,
        ...wardenAliases.filter((alias) => !WRECKLIGHT_CHAMBERS_REVIEW.variables.some((existing) => existing.id === alias.id))],
    nativeSprites: [...WRECKLIGHT_CHAMBERS_REVIEW.nativeSprites, {
            id: "1847527a-8674-589c-8986-3a41b714c2ab", symbol: "sprite_wrecklight_warden_readability_v04",
            filename: "wrecklight_warden_readability_v04.png", metadataPath: "assets/sprites/wrecklight_warden_readability_v04.png.gbsres",
        }],
    backgrounds: WRECKLIGHT_CHAMBERS_REVIEW.backgrounds.map((background) => background.sceneId === "974907dc-dd5e-492f-827b-58ab3b78fdb4"
        ? { ...background, id: "539a9dc7-28a5-5e42-91e6-773c235ddbff", metadataPath: "assets/backgrounds/warden_deck_v03.png.gbsres", alternatives: [] } : background),
    extendedEvents: {
        ...WRECKLIGHT_CHAMBERS_REVIEW.extendedEvents,
        title: {
            ...WRECKLIGHT_CHAMBERS_REVIEW.extendedEvents.title,
            backgroundAlternatives: [{ id: "a2e10f6a-049d-5125-89fd-ed2b33c3a922",
                    metadataPath: "assets/backgrounds/wrecklight_title_eyehead_v04.png.gbsres", width: 160, height: 144,
                    // Legacy startup background uses 0; native-generated metadata used 7.
                    // The bound native header keeps the displayed menu strip at 7 in both.
                    preserveUiFromRow: 15, startupUiValues: [0, 7] }],
            paletteAlternatives: [WRECKLIGHT_CHAMBERS_REVIEW.extendedEvents.title.paletteIds.map((id, slot) => slot === 2 ? "d47d1c98-370f-573e-9842-8b8f16e36193" : id)],
        },
    },
    warden: {
        sceneId: "974907dc-dd5e-492f-827b-58ab3b78fdb4", actorId: "drive_guard",
        actorPath: "project/scenes/warden_deck/actors/drive_sentry.gbsres", actorSlot: 5, actorIndex: 4,
        spriteId: "1847527a-8674-589c-8986-3a41b714c2ab", stateId: "c25370f7-72e5-52de-8dd8-455b01d1530d", frameCount: 14,
        sounds: [
            {
                "id": "82b606a1-7c29-5714-9716-bc28b54e4cec",
                "symbol": "sound_wl_impact_metal",
                "metadataPath": "assets/sounds/wrecklight-impact-metal.wav.gbsres",
                "filename": "wrecklight-impact-metal.wav"
            },
            {
                "id": "9cab3130-e13d-551a-bc33-f121d665b369",
                "symbol": "sound_wl_cutter_weld",
                "metadataPath": "assets/sounds/wrecklight-cutter-weld.wav.gbsres",
                "filename": "wrecklight-cutter-weld.wav"
            }
        ],
        renderReads: ["8", "21", "58", "59"],
        operations: {
            "init": {
                "reads": [
                    "21",
                    "59",
                    "62",
                    "150"
                ],
                "writes": [
                    "63",
                    "181",
                    "182",
                    "183",
                    "209"
                ],
                "locals": [],
                "children": []
            },
            "tick": {
                "reads": [
                    "0",
                    "1",
                    "8",
                    "21",
                    "58",
                    "59",
                    "60",
                    "61",
                    "62",
                    "63",
                    "92",
                    "150",
                    "181",
                    "182",
                    "183",
                    "209"
                ],
                "writes": [
                    "62",
                    "63",
                    "181",
                    "182",
                    "183",
                    "209"
                ],
                "locals": [
                    "L0",
                    "L1",
                    "L2",
                    "L3",
                    "L4"
                ],
                "children": [
                    "shot",
                    "move"
                ]
            },
            "after_move": {
                "reads": [
                    "8",
                    "21",
                    "58",
                    "59",
                    "62"
                ],
                "writes": [
                    "63",
                    "209"
                ],
                "locals": [],
                "children": []
            },
            "contact": {
                "reads": [
                    "8",
                    "21",
                    "58",
                    "59"
                ],
                "writes": [],
                "locals": [],
                "children": [
                    "true"
                ]
            },
            "hit": {
                "reads": [
                    "8",
                    "21",
                    "58",
                    "59"
                ],
                "writes": [],
                "locals": [],
                "children": []
            },
            "dead": {
                "reads": [
                    "62"
                ],
                "writes": [
                    "63",
                    "181",
                    "183",
                    "209"
                ],
                "locals": [],
                "children": []
            },
            "pose": {
                "reads": [
                    "8",
                    "21",
                    "58",
                    "59",
                    "62",
                    "63",
                    "209"
                ],
                "writes": [],
                "locals": [],
                "children": []
            }
        },
    },
};
//# sourceMappingURL=sep17.js.map