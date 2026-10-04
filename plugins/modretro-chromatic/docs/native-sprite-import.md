# Import a native sprite PNG and metadata pair

`asset_import` supports `sprite.profile: "native_metadata"` for complete, original
native sprite artwork. Stage the PNG and its JSON metadata inside the selected
distributed project, refresh the project, and use that whole-project revision.
The source pair is read-only. Both destination files must be new.

```json
{
  "kind": "sprite",
  "sourcePath": "artwork/imports/guardian.png",
  "assetPath": "assets/sprites/guardian.png",
  "name": "Guardian",
  "id": "53112b41-e098-501d-a219-6fa0d188eb72",
  "sprite": {
    "profile": "native_metadata",
    "metadataPath": "artwork/imports/guardian.json",
    "sourceSha256": "<SHA-256 of the exact PNG bytes>",
    "metadataSha256": "<SHA-256 of the exact metadata bytes>"
  },
  "expectedRevision": "<fresh whole-project revision>",
  "dryRun": true
}
```

Inspect the dry-run receipt, then repeat with `dryRun: false` and the same revision
if the project is unchanged. An omitted asset ID is derived deterministically
from the destination path. The explicit or derived destination ID must be fresh.
`background`, `templateAssetId`, unsupported metadata fields, and native-only
options supplied to older profiles are rejected before publication.

## Metadata and validation

The supported shape contains the native sprite root fields: `_resourceType`,
`id`, `name`, `symbol`, `filename`, `width`, `height`, `checksum`, `numTiles`,
`canvasOriginX`, `canvasOriginY`, `canvasWidth`, `canvasHeight`, `boundsX`,
`boundsY`, `boundsWidth`, `boundsHeight`, `animSpeed`, and `states`.
States contain `id`, `name`, `animationType`, `flipLeft`, and eight `animations`.
Animations contain `id` and `frames`; frames contain `id` and `tiles`.
Every tile contains `id`, `x`, `y`, `sliceX`, `sliceY`, `flipX`, `flipY`, `palette`,
`paletteIndex`, `objPalette`, and `priority`. All listed fields are required.

Accepted animation types are `fixed`, `fixed_movement`, `multi`, `multi_movement`,
`horizontal`, `horizontal_movement`, `platform_player`, and `cursor`. Object
palettes are `OBP0` or `OBP1`; palette numbers and indices are integers from 0 to 7.
Coordinates and canvas origins are signed bytes. Canvas dimensions are 1–256,
collision dimensions are 1–255, and animation speed is 0–255. Every 8×16 source
rectangle must fit entirely in the decoded atlas.

PNG validation uses the existing bounded decoder, including CRC, inflation,
dimensions, sprite colors, and alpha validation. Metadata dimensions and native
SHA-1 checksum must match that same PNG snapshot. Both supplied SHA-256 hashes
are checked against the bytes actually validated, not a later reread.

Resource caps are 16 MiB of PNG, 2 MiB of UTF-8 JSON, depth 12, 32 states, eight
animations per state, 32 frames per animation, 1,024 frames total, 40 objects per
frame, and 8,192 objects total. Atlas dimensions are at most 2,040 pixels per axis.
These are importer resource bounds, not runtime hardware guarantees. JSON with
duplicate keys or prototype keys is rejected. Names are at most 200 characters;
metadata cannot provide arbitrary output paths or executable fields.

`numTiles` is preserved as a nonnegative safe integer. It does not control memory
allocation and need not equal the measured deduplicated pattern count. The
receipt separately reports `declaredNumTiles`, exact referenced
`sourcePatterns8x16`, and `flipCanonicalPatterns8x16`. Transparent and native
chroma-key pixels are normalized for those measurements. A differing declaration
produces `NATIVE_TILE_DECLARATION_DIFFERS`, a warning that does not block import.
These measurements do not establish compiled tile allocation or scanline use.

## Identity and receipt

Every root, state, animation, frame, and object ID must be a unique UUID. The
importer assigns fresh deterministic IDs in the destination asset's namespace,
checks project collisions, and returns every mapping in `idMap` with `kind`,
`sourceId`, `destinationId`, and an exact `sourcePointer` to the original ID.
Array order and all other authored nested fields are preserved. Root name,
symbol, filename, checksum, and ID are derived from the requested output.
Identical dry-run and commit inputs produce identical mappings and output hashes.

The collision census reads all `.gbsres` sidecars under `project/` and `assets/`,
including an asset sidecar whose image is temporarily absent. Root and nested
IDs remain reserved in that case. The scan is bounded to 16,384 directory entries
and 32 MiB of metadata in total, with 2 MiB per sidecar. Invalid UTF-8, invalid or
non-object JSON, unsafe paths, and unreadable sidecars fail the import explicitly.

The receipt includes source and output hashes, full counts, changed paths,
previous/current whole-project revisions, and the transaction guarantee. The
source metadata's filename is validated only as a basename, never used as a
destination instruction. Paths must be normalized project-relative paths;
symlink ancestors, hard-linked sources, case/Unicode aliases, and source/output
overlap are rejected.

## Publication and recovery

The transaction owns the project mutation queue and locks both source resources.
It verifies source identities and bytes, the project revision, and output
absence, publishes the completed PNG before its metadata using atomic no-replace
links, then updates the selected project's index. It checks the original project,
source pair, and published output identities again before reporting success.
It never binds an actor as part of import.

This is best-effort rollback across two files, not crash-atomic publication.
On failure, `recovery` retains the original cause, published paths, rolled-back
paths, conflicting paths, retained recovery paths, and temporary cleanup errors
when present. Recovery removes an output only after matching its filesystem
identity and digest. External replacements are preserved; recovery collisions
may leave a named quarantine file for inspection. A lost response should be
resolved by inspecting the intended destination and comparing receipt hashes,
not by deleting files or blindly replaying the import.

After success, inspect the new sprite and its frame mapping. Actor rebinding is
a separate `actor_update` containing only `spriteSheetId` and the fresh resource
revision from `actor_inspect`. Authored readback does not prove ROM compilation,
runtime rendering, or hardware behavior.
