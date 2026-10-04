// Accepted player shots also test contact at their admitted spawn position.
// Source-contract review only; target bank, ABI, stack and native checks are separate.
export const WRECKLIGHT_PROJECTILE_SPAWN_CONTACT_SOURCE_REVIEW = {
    replacements: [
        {
            path: "plugins/wrecklight-controller/engine/src/core/projectiles.c.patch",
            bytes: 28771,
            sha256: "c9a2cf2569a95f851ca4bc0f7c3b50f4d162930cf4db15884d2b21858133fb69",
        },
    ],
};
//# sourceMappingURL=projectile-spawn-contact.js.map