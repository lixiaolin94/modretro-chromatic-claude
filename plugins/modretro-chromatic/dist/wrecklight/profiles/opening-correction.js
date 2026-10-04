// Exact pre-step correction snapshot:
// a231515060ac46874b29736ca23a8e64eec44b3bf2691e9ae70d7b31be38ef0c.
// The native change removes the stair instruction while preserving notice IDs.
// The remaining sprite, script and tilemap resources keep their ordinary guards.
export const WRECKLIGHT_OPENING_CORRECTION_SOURCE_REVIEW = {
    replacements: [{
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_presentation.c",
            bytes: 58226,
            sha256: "7d127ca824d477901387d2ed3fa7276aa3be1c587b268489e3599fa6646afaf4",
        }],
    fixedDescriptor: {
        _resourceType: "project",
        notes: "Native save compatibility revision: wrecklight-opening-direction-2",
        _version: "4.2.0",
        _release: "10",
    },
    backgrounds: [{
            sceneId: "7f23a478-4d91-55d1-9c4e-6d2bba24caba",
            id: "de8d5eca-396f-5e5f-a26a-c0ce22fc2a25",
            metadataPath: "assets/backgrounds/airworks-recovery-v01.png.gbsres",
        }],
};
//# sourceMappingURL=opening-correction.js.map