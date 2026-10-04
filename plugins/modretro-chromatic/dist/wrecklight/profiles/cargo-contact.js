// Cargo contact damage and recovery extend the portable Brakemaw source tuple.
// The actor's editable event tree is checked by owner, script and sprite identity.
export const WRECKLIGHT_CARGO_CONTACT_SOURCE_REVIEW = {
    replacements: [
        {
            path: "plugins/wrecklight-controller/engine/include/wrecklight_traversal.h",
            bytes: 2212,
            sha256: "236f0d3507b6edf932dc47b557a4c5546f95c9e464063ae07fdfba13f81f8318",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/core/wrecklight_cargo_crawler.c",
            bytes: 4806,
            sha256: "a2ed458369271beec881436266d805712d48b25ec4afb3303f2e99911089df9e",
        },
        {
            path: "plugins/wrecklight-controller/engine/src/states/platform.c.patch",
            bytes: 59379,
            sha256: "6bfcfe6d60ae31f34d6a1e31fe00b4038caab6227291a857e5684bc4cde35a95",
        },
        {
            path: "plugins/wrecklight-controller/events/eventWrecklightCargoCrawler.js",
            bytes: 3843,
            sha256: "ffcdfada1532e86d58d3a3dfca6f302e620eabe5bdfc9da82b4bfe28db611e64",
        },
        {
            path: "project/engine_field_values.gbsres",
            bytes: 2819,
            sha256: "6a5e39860137e5cb26d118e713de409f9d96b7401ab4a65afc5badb1800d6ed8",
        },
    ],
    additionalGlobalAliases: [
        { id: "8", alias: "VAR_HEALTH" },
        { id: "9", alias: "VAR_GRACE" },
    ],
    contact: {
        reads: ["64", "65", "68", "69", "189", "190", "212", "8", "9", "92"],
        writes: [],
        children: ["lunge"],
    },
};
//# sourceMappingURL=cargo-contact.js.map