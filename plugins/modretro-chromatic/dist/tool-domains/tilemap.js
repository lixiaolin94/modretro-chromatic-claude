import { compileTilemap, createTilemap, createTilemapAtlas, editTilemap, inspectTilemap } from "../tilemaps.js";
import { tilemapSchemas } from "../tilemap-schema.js";
/** Fixed native authoring operations; no arbitrary file, script or raster-evaluation surface. */
export function registerTilemapTools(server, context) {
    const mutation = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
    server.registerTool("tilemap_atlas_create", {
        title: "Register a reusable tile atlas",
        description: "Register project-owned opaque indexed 8x8 source tiles and sparse named motifs. Source PNG and atlas paths stay under project/tilemaps; no native room is changed.",
        inputSchema: tilemapSchemas.atlasCreate,
        annotations: { ...mutation, destructiveHint: false },
    }, (input) => context.safely(() => context.runTransaction((project, access) => createTilemapAtlas(project.projectPath, input, access))));
    server.registerTool("tilemap_create", {
        title: "Create an additive native room recipe",
        description: "Explicitly capture an existing room's exact named atlas patterns or fill a new fixed-size background, retain the predecessor, and rebind only the selected scene. No automatic resize or approximated capture.",
        inputSchema: tilemapSchemas.create,
        annotations: mutation,
    }, (input) => context.safely(() => context.runTransaction((project, access) => createTilemap(project.projectPath, input, access))));
    server.registerTool("tilemap_inspect", {
        title: "Inspect tilemap source and native binding",
        description: "Strongly verify a room recipe or atlas and return bounded tile identities, exact 8x8 row-major RGBA pixelsSha256 hashes, native hashes and current project revision. Supply both recipePath and atlasPath to inspect that verified room's bound atlas, including an explicitly adopted legacy atlas. Atlas-only inspection retains path-derived identity checks. This is authored-source evidence.",
        inputSchema: tilemapSchemas.inspect,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, (input) => context.safely(() => context.runRead((project, access) => inspectTilemap(project.projectPath, input, access))));
    server.registerTool("tilemap_edit", {
        title: "Apply bounded native room edits",
        description: "Edit a revision-bound recipe. Place/fill/stamp operates outside protected cells. Exclusive replace_cells changes selected pixels/palettes and preserves collisions; exclusive set_collision_cells changes only selected collision bytes and synchronizes the scene. Both require exact pixel/palette/collision preimages and preserve protection lists and unselected cells, including when selecting protected cells. Replacement atlases must preserve existing meanings. Exclusive adopt_binding validates six file preimages and registers retained identities without changing native files or cells. Dependency guards and best-effort rollback apply; no generic override.",
        inputSchema: tilemapSchemas.edit,
        annotations: mutation,
    }, (input) => context.safely(() => context.runTransaction((project, access) => editTilemap(project.projectPath, input, access))));
    server.registerTool("tilemap_compile", {
        title: "Verify deterministic native room regeneration",
        description: "Recompile an unchanged room recipe, retaining native IDs and identical bytes. Refuse drifted atlas/native outputs or shared background users; never overwrite a newer external edit.",
        inputSchema: tilemapSchemas.compile,
        annotations: mutation,
    }, (input) => context.safely(() => context.runTransaction((project, access) => compileTilemap(project.projectPath, input, access))));
}
//# sourceMappingURL=tilemap.js.map