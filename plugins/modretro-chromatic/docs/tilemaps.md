# Reusable native tilemaps

The [ModRetro Chromatic plugin](../README.md) tilemap tools compose
ordinary native game background PNGs and native `.gbsres` resources.
GB Studio remains the editor and compiler. This is a
fixed-size, manual-color authoring slice, not a new game engine or a Tiled
project importer.

## Data and ownership

| Data | Location | Meaning |
| --- | --- | --- |
| Atlas source PNG | `project/tilemaps/**/*.png` | Opaque 8 × 8 source patterns in the four exact native game background shades |
| Atlas manifest | `project/tilemaps/**/*.atlas.json` | Stable named source tiles and named larger primitives |
| Room recipe | `project/tilemaps/**/*.room.json` | Complete row-major tile references, palette/collision bytes, protections, native identities and hashes |
| Native background | `assets/backgrounds/**/*.png` and `.png.gbsres` | The real image and native palette grid that GB Studio consumes |
| Scene | Existing native scene resource | Only its explicitly requested background binding or collision grid changes |

Manifests and source PNGs are ordinary authoring files under the existing
project revision domain. They do not invent native `.gbsres` resource types,
index databases or compiler extensions. The selected project must use GB
Studio's distributed format.

Every coordinate and dimension in these APIs is an integer count of **8-pixel
tiles**. A rectangle covers `[x, x + width) × [y, y + height)`. A motif's
`anchor` is a tile offset inside the motif; a stamp's `x, y` positions that
anchor. No crop, rotation, reflection, flip deduplication, partial-pixel mask
or resize is performed. A larger articulated form can contain any authored
tile arrangement, including sparse holes.

The source shades are `071821`, `306850`, `86C06C` and `E0F8CF`. Source index
zero/dark pixels remain opaque. Only a **null motif cell** means “leave this
room cell untouched.” Source-color indices and native palette slots are
different data.

## Five operations

| Tool | Effect |
| --- | --- |
| `tilemap_atlas_create` | Register an existing project-owned PNG and new strict atlas manifest; never overwrite an atlas |
| `tilemap_create` | Create a new room recipe/background and explicitly bind that additive background to one scene; retain its predecessor |
| `tilemap_inspect` | Strongly verify an atlas (optionally in its room context) or a bounded room region; return current project revision and native hashes |
| `tilemap_edit` | Apply primitive edits, exact selected pixel/palette replacement, or exact selected collision assignments; alternatively adopt one fully preimage-bound existing recipe without changing native output |
| `tilemap_compile` | Verify deterministic regeneration of the unchanged recipe and native identities; identical outputs are not rewritten |

Every mutation requires `expectedRevision`, the current project revision from
`project_inspect`, `project_refresh` or a successful tilemap operation. All
mutations accept `dryRun: true`. A dry run validates the actual proposed
outputs and returns their hashes and changed paths without writing anything.
It does not reserve a revision; apply with the same expected revision and
handle a stale response by reinspecting.

### Atlas definition

Create the source PNG first. An atlas distinguishes small physical patterns
from compositional primitives. For example, the following definition names
two 8 × 8 patterns, a decorative fill, an explicitly solid cap, and a sparse
2 × 2 casing motif:

```json
{
  "atlasPath": "project/tilemaps/materials-v1.atlas.json",
  "sourcePath": "project/tilemaps/materials-v1.png",
  "name": "Casing materials v1",
  "tiles": [
    { "id": "casting-fill", "x": 0, "y": 0 },
    { "id": "casting-cap", "x": 1, "y": 0 }
  ],
  "primitives": [
    {
      "id": "recessed-panel", "role": "decoration",
      "width": 1, "height": 1, "anchor": { "x": 0, "y": 0 },
      "cells": [{ "tileId": "casting-fill" }]
    },
    {
      "id": "solid-cap", "role": "surface",
      "width": 1, "height": 1, "anchor": { "x": 0, "y": 0 },
      "cells": [{ "tileId": "casting-cap", "collision": { "mask": 15, "value": 15 } }]
    },
    {
      "id": "casing-return", "role": "decoration",
      "width": 2, "height": 2, "anchor": { "x": 0, "y": 1 },
      "cells": [
        { "tileId": "casting-cap", "paletteSlot": 1 }, null,
        { "tileId": "casting-fill" }, { "tileId": "casting-cap" }
      ]
    }
  ],
  "expectedRevision": "<current 64-character project revision>"
}
```

Call `tilemap_atlas_create` with that shape and a real revision. The PNG and
manifest receive separate SHA-256 identities. Source tiles must exist inside
the atlas. Names must be unique in their respective tile/primitive collections.
The atlas may contain more reusable patterns than one room can consume; the
room's exact pattern budget is checked when compiling.

Decoration primitives cannot declare collision changes. A surface primitive
must explicitly declare at least one collision mask. The update is:

```text
newByte = (oldByte & ~mask) | value
```

`value` may contain only bits in `mask`. No solid/platform meaning is inferred
from hue, opaque pixels, a material name or a label. A surface with
`mask: 15, value: 0` explicitly clears only those four bits. Replacing a
surface with decoration preserves its previous collision byte; it does not
silently erase gameplay geometry.

### Create or capture a room

Use a real scene ID, atlas path and unused background/recipe paths:

```json
{
  "recipePath": "project/tilemaps/room-v1.room.json",
  "atlasPath": "project/tilemaps/materials-v1.atlas.json",
  "sceneId": "<existing scene ID>",
  "backgroundPath": "assets/backgrounds/room-v1.png",
  "name": "Room v1",
  "base": { "type": "existing" },
  "protectedRegions": [{ "x": 0, "y": 6, "width": 2, "height": 4 }],
  "reservedPaletteSlots": [6],
  "maxUniqueTiles": 128,
  "expectedRevision": "<current 64-character project revision>"
}
```

`base: {"type":"existing"}` requires **every existing 8 × 8 pattern to
match a named atlas tile exactly**. If a tile is missing, capture fails
before any writes with `TILEMAP_CAPTURE_TILE_MISSING` and its coordinates.
It neither approximates the pattern nor adds unnamed source tiles. Add an
explicit source tile to a newly registered atlas version, then retry. When
duplicate named source tiles have identical pixels, capture selects the first
matching tile in manifest order. Pixel identity is unchanged.

Successful capture copies the predecessor's exact PNG bytes and native
`tileColors` encoding, including opaque attributes. Collision data is left
unchanged. The new background gets its own deterministic ID and globally
distinct symbol; only the chosen scene is rebound. All old backgrounds,
other scene consumers, palettes, actors, triggers, events, native symbols and
custom fields remain intact.

For an intentional full initial fill, instead pass:

```json
{ "type": "fill", "tileId": "casting-fill", "paletteSlot": 0 }
```

This explicitly replaces the new background's entire pixel/palette grid,
but still preserves the selected scene's collision grid and retains the old
background. It cannot be combined with protected source regions. Fixed
dimensions must already agree across scene, PNG and metadata. Scenes with a
nonempty native `tilesetId` are rejected in v1 rather than silently changing
that binding.

Separate same-name `.mono.png` companions are also rejected in v1. The tool
will not silently drop a predecessor's monochrome artwork or overwrite an
existing companion at the new destination. Capture retains unknown native
background fields, including an explicit native flip setting, while giving
the additive background its new identity and filename.

### Explicitly adopt an existing binding

An existing recipe can use IDs assigned by another authoring tool. Ordinary
inspection, edits and compilation still reject unregistered path/ID mismatches.
Do not recapture merely to change IDs: capture reconstructs cells and cannot
preserve duplicate-pattern tile choices or primitive annotations.

Use one exclusive `tilemap_edit` operation with the current project revision and
SHA-256 of each **complete, unmodified file**:

```json
{
  "recipePath": "project/tilemaps/legacy.room.json",
  "expectedRevision": "<current 64-character project revision>",
  "dryRun": true,
  "operations": [{
    "type": "adopt_binding",
    "identity": {
      "roomId": "<existing recipe ID>",
      "backgroundId": "<existing native background ID>",
      "atlasId": "<existing atlas ID>",
      "sceneId": "<existing scene ID>"
    },
    "before": {
      "recipeSha256": "<complete recipe>",
      "atlasSha256": "<complete referenced atlas manifest>",
      "sourceSha256": "<atlas source PNG>",
      "pngSha256": "<native background PNG>",
      "metadataSha256": "<native background sidecar>",
      "sceneSha256": "<complete selected scene resource>"
    }
  }]
}
```

Adoption validates all native bindings, dimensions, rendered cells, palette and
collision bytes, exclusive background ownership and complete dependency coverage
inside the existing queued transaction. It adds only `adoptedBinding` to the
recipe. Existing IDs, names, full cell records, tile/primitive definitions,
ordered protections/reservations and limits remain unchanged. The atlas, source
PNG, native PNG, sidecar, native symbol, scene and collision encoding are
input-only and are rechecked at commit. No native resource is created or rebound.
Names retain their authored whitespace; whitespace-only names remain invalid.

The persisted binding records the selected paths and identities plus immutable
origin preimages. Current output hashes still follow ordinary successful edits;
origin evidence is not an instruction to restore old bytes. A normally registered
extension atlas can subsequently be selected by `replace_cells` if every old
tile and primitive meaning is preserved. No historical creator formula, automatic
legacy exception or separate registry is used.

For a legacy atlas, `tilemap_inspect` accepts both `recipePath` and `atlasPath`
only when the latter is that fully verified recipe's current bound atlas. Existing
pagination applies. Atlas-only inspection keeps its path-derived ID requirement.
Dry runs write nothing; failed preimages, stale revisions/semantics, shared native
owners and mismatched current outputs do not authorize a repaint or fallback.

### Edit by primitive ID

```json
{
  "recipePath": "project/tilemaps/room-v1.room.json",
  "operations": [
    { "type": "fill", "primitiveId": "recessed-panel", "x": 4, "y": 4, "width": 5, "height": 3 },
    { "type": "stamp", "primitiveId": "casing-return", "x": 9, "y": 9 },
    { "type": "place", "primitiveId": "solid-cap", "x": 12, "y": 15 }
  ],
  "dryRun": true,
  "expectedRevision": "<current 64-character project revision>"
}
```

`place` and `fill` require a 1 × 1 primitive. `stamp` accepts larger motifs.
Operations run in order; later explicit cells replace earlier cells. Sparse
holes preserve pixels, palette and collision data. Protected regions reject
any nonempty placement, including a placement that happens to look identical.
The complete anchored rectangle must fit; no implicit clipping occurs.

Omitted palette assignments preserve the original byte. Explicit assignments
use existing scene palette slots and protect the dynamically resolved UI slot
plus caller reservations. A palette edit on a cell with opaque attribute bits
fails closed; omit its palette action to retain those bytes. Pixel-only edits
may preserve such a cell's opaque metadata. This v1 does not interpret or
rewrite unknown priority/flip attributes. Global BG/OBJ palette resources,
scene slot assignments and UI/font resources are never changed.

Receipts include actual changed tile and primitive IDs, pixel/palette/collision
cell counts, bounded before/after samples, and exact added/retired/net unique
8 × 8 pattern counts. The caller's optional receiving cap is separate from
the native mode limit. Counts never assume flip deduplication and do not
claim sprite-pair, OAM or runtime acceptance.

### Replace explicitly selected pixels and palette bytes

`replace_cells` is an exclusive operation: it cannot share a batch with another
operation. It can replace selected protected cells, but **cannot change any
collision byte, protection list, or unselected cell**. Ordinary place/fill/stamp
still reject protected cells. There is no override or temporary unprotection.

Read the current region and target atlas with `tilemap_inspect`. Both return
`pixelsSha256`: SHA256 of the exact 256 row-major RGBA bytes of each 8 × 8 tile.
Supply every selected cell's actual pixel hash, full palette byte and full
collision byte, plus its intended atlas tile/hash and palette byte:

```json
{
  "recipePath": "project/tilemaps/room-v1.room.json",
  "expectedRevision": "<current 64-character project revision>",
  "dryRun": true,
  "operations": [{
    "type": "replace_cells",
    "atlasPath": "project/tilemaps/materials-v1.atlas.json",
    "atlasSha256": "<inspected atlas manifest hash>",
    "cells": [{
      "x": 10, "y": 8,
      "before": {
        "pixelsSha256": "<inspected current tile hash>",
        "paletteByte": 130, "collisionByte": 240
      },
      "after": {
        "tileId": "recessed-panel",
        "pixelsSha256": "<inspected target atlas tile hash>",
        "paletteByte": 130
      }
    }]
  }]
}
```

The example preserves the opaque palette byte `0x82` and collision byte `0xf0`.
Changing palettes is allowed only between ordinary assigned slots, preserving
dynamic UI and recipe reservations. Opaque palette bytes may only be retained
unchanged. All preimages are checked before publication; duplicate cells,
missing fields and mismatches reject the complete batch without writes.

A separately registered atlas may add tiles, but must retain the exact pixels
of **every existing tile ID** and the complete definitions of every existing
primitive. Existing aliases cannot silently acquire new meanings. Register
missing patterns explicitly; this operation never edits the atlas itself.
Changing atlas bindings changes the recipe even if native pixels are identical.
With the same atlas, a true no-op preserves exact files and primitive identity;
a changed selected cell becomes a direct tile and drops its former primitive ID.
All existing native/source/dependency/transaction checks still apply. This is
authored-source editing, not evidence of gameplay or runtime rendering.

### Set explicitly selected collision bytes

`set_collision_cells` assigns exact collision bytes to individually selected
cells, including protected cells. It is the only tilemap operation that can
change collisions inside a protected region. The protection list stays intact;
later place/fill/stamp operations still reject those cells. This operation
cannot change pixels, palettes, tile IDs, primitive annotations, atlas bindings
or any unselected cell.

Inspect the current cells with `tilemap_inspect`, then supply each cell's full
pixel/palette/collision preimage and intended collision byte. Values are whole
bytes from 0 to 255; no mask, rectangle expansion or inferred bit clearing is
applied. The room's current verified atlas supplies the pixel identities.

```json
{
  "recipePath": "project/tilemaps/room-v1.room.json",
  "expectedRevision": "<current 64-character project revision>",
  "dryRun": true,
  "operations": [{
    "type": "set_collision_cells",
    "cells": [{
      "x": 10, "y": 8,
      "before": {
        "pixelsSha256": "<inspected current tile hash>",
        "paletteByte": 130, "collisionByte": 15
      },
      "after": { "collisionByte": 0 }
    }]
  }]
}
```

Every preimage and coordinate is checked before preparing changes. Duplicate
coordinates, missing preimages, invalid bytes, stale native output and genuine
shared background users reject the request. The existing dependency and
revision checks still apply. The recipe's cell values and `native.collisions`
are updated together with the native scene through the existing transaction.
Native PNG, palette sidecar and atlas files remain byte-identical. Unselected
decoded collision bytes, cell annotations, scene fields and ordered protection
and reservation lists retain their values. A real collision change may
re-encode the collision run string and JSON formatting; a complete no-op keeps
every original file byte. Transactions retain the best-effort rollback
guarantee described below.

This operation must be the sole operation in its batch. To change art and
collisions, first apply `replace_cells`, then inspect the affected cells again
and submit `set_collision_cells` with the current revision and new preimages.
These are separate transactions. `replace_cells` remains collision-preserving
and does not accept `after.collisionByte`. Ordinary `collision_edit` writes
only the scene and does not synchronize a bound tilemap recipe; use this
tilemap operation when the room has a recipe.

## Safety, limits and recovery

Atlas/recipe/output paths are confined to the selected canonical project and
reject traversal, symbolic-link aliases and unsupported extensions. Inputs
are strict and bounded: 4,096 named atlas tiles, 256 primitives, 32 × 32 cells
per primitive, 32,768 total motif cells, 100 operations, and 4,096 nonempty cell
visits per primitive edit, including repeated visits, or 4,096 distinct selected
pixel/palette replacements or collision assignments. Native room dimension and area
limits still apply. Room inspection returns at most 1,024 cells.

Transactions reuse the project index, canonical mutation queue, native scene
operation validation, PNG import preparation, palette/collision helpers and
graphics analysis. They strongly verify the whole project revision before
preparation and again before publication, then compare exact touched-file
before images. Plugin-owned semantic dependencies are fenced separately from
the public revision. Direct library callers without a session reuse a temporary
instance of the same index, disposed at completion; dependency checks are not
skipped outside MCP. Atlas PNG/manifest changes, newer native PNG/sidecar/collision
edits, changed scene binding/dimensions, shared background consumers, or a
recipe grid that diverged from its native outputs are rejected. A newer
unrelated actor/script edit is preserved; a stale project revision is still
rejected. Use the native APIs to edit recipes. External changes are not
automatically adopted, migrated or overwritten.

Binary and JSON outputs commit in deterministic order with **best-effort
rollback**. Successful no-ops preserve exact bytes without rewriting files.
On a recoverable failure, already-applied files are restored only if they
still match this transaction's intended bytes. A concurrent edit is preserved
and reported as `TRANSACTION_RECOVERY_CONFLICT`. This is not cross-file
atomicity, a filesystem lock against external editors, a durable journal, or
crash recovery. Empty directories can remain after failure. Preserve the
failure receipt and inspect changed paths before deciding how to recover.

Run `graphics_analyze_scene` on the resulting native scene, then an official
GB Studio build when compiler compatibility matters. Source/API tests,
authored PNGs, official builds and actual emulator observations are distinct
evidence. These tools do not install or activate a plugin, restart a runtime,
open a preview, migrate a game or select a player.
