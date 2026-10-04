// Ordinary warm-up and charge timers reuse the existing native helpers. The
// complete actor/handler tuple keeps their new sites separate from PR27.
export const WRECKLIGHT_BRAKEMAW_TIMERS_SOURCE_REVIEW = {
    replacements: [
        {
            path: "plugins/wrecklight-controller/events/eventWrecklightCombat.js",
            bytes: 13403,
            sha256: "bd150008776c88346732338dcda29f755dc5fe2f2270ad562f7e2588cd6f1313",
        },
        {
            path: "plugins/wrecklight-controller/events/eventWrecklightEnemyCondition.js",
            bytes: 51631,
            sha256: "0b66f7da192f78f2539600315cc3965b1f9b153397b0ca72dc3b6610366438f4",
        },
        {
            path: "project/scenes/turbine_vault/actors/plated_turbine_patrol.gbsres",
            bytes: 623049,
            sha256: "a0422c99eded8458b3a411fdcf226ef636a5e85eb44dc79dfe8a5a06865680a8",
        },
    ],
    // Each list is ordered by phase 11, 14, 21, 24. These remain four independent
    // commands per branch, not additional countdown-batch entries.
    ordinarySites: {
        brakemawCueContinue: [
            "ae001833-4da0-5b7c-af44-16f7b665913b",
            "c1044dd1-3119-5ccf-9cca-f05bba2b8746",
            "7b820fd1-0ee7-50c6-a31f-ee3c771e11cc",
            "71dbfbd3-0fde-5185-89c7-5b9dc92473dc",
        ],
        brakemawCueDecrement: [
            "20b15e52-7721-5ad5-9d65-085abd9daec7",
            "eb479d19-f2d1-5c16-b3ac-cb0b177245e5",
            "6fe7039c-1e94-589e-87b2-9dfa85bd3009",
            "5d726fe4-5d6e-5c97-a30b-8742b8027f79",
        ],
        brakemawCueFlash: [
            "a4e2e35b-2a30-543b-8084-022d845060c8",
            "e48901c6-5d02-50ac-85db-8fdb7befe3e5",
            "54d44eab-4ef2-5e06-a35d-c5f713391385",
            "6f8b8058-b991-555c-8af7-a7ff7f2afc6a",
        ],
        brakemawCuePose: [
            "191d9f35-3aca-5079-812d-6adfb2fcdea2",
            "efc0488e-a55c-5e09-9bb4-f5dc9721daf8",
            "030afcd7-6a98-54a1-be20-a52f3abaa071",
            "2dd1a330-fead-5f59-9aad-4f70397b7551",
        ],
    },
    warmupSites: [
        "4e40cc43-78b0-569e-996d-4db30c37d6d2",
        "dedaacff-266f-5a1d-b79f-e9d0731249f8",
    ],
};
//# sourceMappingURL=brakemaw-timers.js.map