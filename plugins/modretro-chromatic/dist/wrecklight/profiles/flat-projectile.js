// Combined slope-off and projectile-rendering source. All chamber-cache
// sampling semantics and ownership guards remain unchanged.
export const WRECKLIGHT_FLAT_PROJECTILE_SOURCE_REVIEW = {
    replacements: [
        {
            path: "plugins/wrecklight-controller/engine/src/core/projectiles.c.patch",
            bytes: 27375,
            sha256: "a06cc01ea8b8980776e5b259cd22bc966d5089da5960219d99eaba7f6a94b41e",
        },
        {
            path: "project/engine_field_values.gbsres",
            bytes: 2750,
            sha256: "f471d733e521f7f76406dc8584cdf2b1ce30fadda73e6718e24942531973643f",
        },
    ],
    fixedDescriptor: {
        _resourceType: "project",
        notes: "Native save compatibility revision: wrecklight-sep18-flat-projectile-engine-1",
        _version: "4.2.0",
        _release: "10",
    },
};
//# sourceMappingURL=flat-projectile.js.map