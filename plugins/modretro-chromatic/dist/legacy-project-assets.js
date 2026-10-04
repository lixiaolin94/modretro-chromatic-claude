function isObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isAssetFolder(folder) {
    return folder === "backgrounds" || folder === "sprites";
}
function safeSegment(value) {
    return value.length > 0 && !value.startsWith(".")
        && !/[\u0000-\u001f\u007f/\\<>:"|?*]/u.test(value)
        && !/[. ]$/u.test(value)
        && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(value);
}
function normalizedPngFilename(value) {
    if (typeof value !== "string")
        return undefined;
    const normalized = value.replace(/\\/gu, "/");
    if (!normalized.toLowerCase().endsWith(".png") || !normalized.split("/").every(safeSegment))
        return undefined;
    return normalized;
}
function collection(discovery, folder) {
    if (discovery.format !== "legacy")
        return [];
    const items = folder === "sprites" ? discovery.descriptor.spriteSheets : discovery.descriptor.backgrounds;
    return Array.isArray(items) ? items : [];
}
function namedAsset(value) {
    return isObject(value) && typeof value.id === "string" && value.id.length > 0 && typeof value.filename === "string";
}
/** Descriptor metadata only establishes identity; the caller must confirm the physical PNG. */
export function legacyPhysicalAssetMetadata(discovery, folder, filename, plugin) {
    return legacyPhysicalAssetMetadataLookup(discovery, folder, plugin)(filename);
}
/** Precompute per-folder lookups; existing exact native filenames outrank compatibility prefixes. */
export function legacyPhysicalAssetMetadataLookup(discovery, folder, plugin, physicalFilenames) {
    if (!isAssetFolder(folder) || (plugin !== undefined && !safeSegment(plugin)))
        return () => null;
    const byFilename = new Map();
    for (const item of collection(discovery, folder)) {
        if (!namedAsset(item))
            continue;
        if (plugin === undefined) {
            if (item.plugin !== undefined && item.plugin !== null && item.plugin !== "")
                continue;
        }
        else if (item.plugin !== plugin)
            continue;
        const storedFilename = normalizedPngFilename(item.filename);
        if (!storedFilename)
            continue;
        const keys = new Set([storedFilename]);
        if (plugin === undefined && !physicalFilenames?.has(storedFilename)) {
            for (const prefix of [`${folder}/`, `assets/${folder}/`]) {
                if (storedFilename.startsWith(prefix))
                    keys.add(storedFilename.slice(prefix.length));
            }
        }
        for (const key of keys) {
            const matches = byFilename.get(key) ?? [];
            matches.push(item);
            byFilename.set(key, matches);
        }
    }
    return (filename) => {
        const physicalFilename = normalizedPngFilename(filename);
        const matches = physicalFilename ? byFilename.get(physicalFilename) : undefined;
        return matches?.length === 1 ? matches[0] : null;
    };
}
/** Upstream stores plugin PNGs at plugins/<plugin>/<kind>/<relative filename>. */
export function legacyPluginAssetCandidates(discovery) {
    const paths = new Map();
    for (const folder of ["backgrounds", "sprites"]) {
        for (const item of collection(discovery, folder)) {
            if (!namedAsset(item) || typeof item.plugin !== "string" || !safeSegment(item.plugin))
                continue;
            const filename = normalizedPngFilename(item.filename);
            if (!filename)
                continue;
            const relativePath = `plugins/${item.plugin}/${folder}/${filename}`;
            const candidates = paths.get(relativePath) ?? [];
            candidates.push({ relativePath, folder, metadata: item });
            paths.set(relativePath, candidates);
        }
    }
    return [...paths.values()].flatMap((candidates) => candidates.length === 1 ? candidates : []);
}
//# sourceMappingURL=legacy-project-assets.js.map