# Authoring, Import, and Image Reconstruction

Read this reference when source artwork comes from Aseprite, Pixelorama, Tiled,
another editor, or image generation. Preserve editable sources and validate the
actual flattened PNG that the game editor consumes.

## Aseprite

Keep `.aseprite` files as editable source documents; export project-ready PNGs
instead of expecting the game editor to consume layered Aseprite documents.

For standard horizontal actor animation, an available local Aseprite CLI can
export an aligned sheet and metadata:

```bash
aseprite -b hero.aseprite \
  --sheet-type horizontal \
  --sheet assets/sprites/hero.png \
  --data hero.frames.json
```

Match the existing native source palette. Confirm 16 × 16 frame boundaries,
transparent/chroma-key treatment, frame order, direction conventions, and anchors.
Avoid packed irregular atlases for the simple native game sprite import path.

After export into the explicitly selected project, register the actual PNG and
native animation metadata rather than leaving an unreferenced image:

```text
asset_import {"assetPath":"assets/sprites/hero.png","kind":"sprite","sprite":{"profile":"directional_animated"}}
sprite_inspect {"assetId":"<returned-asset-id>"}
```

Supported standard profiles match 16 × 16 static, 48 × 16 directional, or
96 × 16 directional-animated artwork; a template profile must match an
existing registered compatible sprite. Preserve actual states, animation slots,
metasprite IDs, checksum, and native `numTiles`. Source and destination paths
must both remain within the same selected distributed project.

When converting RGB work to indexed colors, use an explicit palette and inspect
the result; generic quantization may add invalid anti-aliased colors or destroy
silhouettes. Disable dithering unless a deliberate repeating dither tile remains
within per-tile color and unique-tile budgets.

Source: [Aseprite command-line documentation](https://www.aseprite.org/docs/cli/).

## Pixelorama

Pixelorama is MIT-licensed and supports pixel grids, palette management, indexed
artwork, animation, tilemap layers, spritesheet/PNG export, and editable `.pxo`
projects. Keep the `.pxo` as the working source and export a flattened aligned PNG
into the appropriate native game asset directory.

- Set the intended canvas/frame size and enable an 8 × 8 grid.
- Import a project palette using `.json`, `.gpl`, `.pal`, or a palette PNG.
- Keep sprite sheets horizontal for the simple importer unless the project's
  Sprite Editor explicitly expects another layout.
- Preserve exact source swatches and the established transparency convention.
- Verify the installed version's indexed-mode and CLI behavior; do not assume a
  release supports every feature mentioned on the upstream development branch.

Sources: [Pixelorama upstream repository](https://github.com/Orama-Interactive/Pixelorama)
and [Pixelorama palette documentation](https://www.oramainteractive.com/Pixelorama-Docs/user_manual/palettes/).

## Tiled

Use an orthogonal map with 8 × 8 source tiles, or a 16 × 16 gameplay grid backed
by 8 × 8 compatible artwork when the project uses larger movement cells. Maintain
the editable `.tmx`/`.tmj` map and its referenced tilesets.

Export the visible rasterized map into `assets/backgrounds/<scene>.png`. Tiled
ships `tmxrasterizer` for repeatable map-to-image conversion:

```bash
tmxrasterizer maps/forest.tmx assets/backgrounds/forest.png
```

Check that the resulting PNG has 8-pixel-aligned dimensions, no forbidden alpha,
the correct source palette, valid per-tile palette families, and enough repeated
tiles. Tiled JSON can preserve useful authoring metadata, but the game editor consumes
the flattened background PNG rather than automatically importing arbitrary Tiled
collision objects or gameplay scripts.

For a scene without a bound native tilemap recipe, register the actual
background sidecar, inspect its real scene colors, and edit collisions separately:

```text
asset_import {"assetPath":"assets/backgrounds/forest.png","kind":"background","background":{"autoColor":false}}
palette_paint {"backgroundId":"<background-id>","sceneId":"<scene-id>","edits":[{"x":2,"y":3,"slot":1}]}
collision_edit {"sceneId":"<scene-id>","edits":[{"shape":"rectangle","x":2,"y":3,"width":4,"height":1,"value":15}]}
graphics_analyze_scene {"sceneId":"<scene-id>"}
```

Background `tileColors` and scene collisions are native hexadecimal byte-run
encodings. Do not substitute arbitrary Tiled object JSON or guessed base64.

For a scene with a [bound native tilemap recipe](../../../docs/tilemaps.md),
ordinary `palette_paint` and `collision_edit` change the native output without
updating the recipe. Use `tilemap_inspect`, then `tilemap_edit` with the current
revision and complete pixel/palette/collision preimages. Use `replace_cells` for
palette edits; when only the palette changes, retain the inspected pixel hash.
Use `set_collision_cells` for collisions. To change both, submit `replace_cells`
first, inspect the changed cells again, then submit `set_collision_cells` as a
separate transaction.

Sources: [Tiled image export](https://doc.mapeditor.org/en/stable/manual/export-image/)
and [Tiled JSON map format](https://doc.mapeditor.org/en/stable/reference/json-map-format/).

## Generated images to native assets

For a new static sprite, start with the [two-step image generation workflow](prompting-recoverable-grids.md):
generate a deliberately coarse design, then reconstruct it as whole grid cells.
For exact edits or authored animation frames, use [native pixel tools](native-pixel-tools.md)
or the [animation guide](prompting-grid-animation.md). These routes share the
existing palette, tile, and import constraints below.

Generated images are useful for composition, character direction, scenery motifs,
and palette concepts. Their apparent retro aesthetic does not establish that pixels
lie on a consistent grid, colors are legal, tiles repeat, or animation frames align.

Rebuild rather than merely shrink:

1. Decide the exact target asset and final dimensions before generating or editing.
2. Extract a clean silhouette, terrain motifs, landmarks, and intentional values.
3. Reconstruct on the real 8 × 8 tile grid or the requested native sprite frame
   grid. A 32 × 32 design requires a compatible existing import template; the
   simple static profile is 16 × 16. Preserve the requested design size and
   report an unsupported import layout rather than silently shrinking it.
4. Redraw clean pixel clusters, repeat reusable tiles, align seams, and stabilize
   every animation frame's anchor and silhouette.
5. Apply the actual native source palette or construct legal per-tile automatic
   palettes; quantize colors to RGB555 and resolve palette-family conflicts.
6. Rebuild transparent pixels using the project's real sprite convention.
7. Export a lossless PNG. Never leave JPEG artifacts, resampling blur, fractional
   pixels, unsupported antialiasing, accidental alpha, or invented colors.
8. Run `graphics_analyze` on the actual exported asset. Fix coordinate-specific
   violations and budget pressure; do not mistake a visually plausible preview for
   successful reconstruction.
9. Register the PNG with `asset_import`, inspect native sprite/background
   metadata, resolve scene palette assignments, and run `graphics_analyze_scene`.
10. Build the genuine cartridge, navigate to the asset, capture emulator frames,
   and inspect the result in motion where the project supports that workflow.

Nearest-neighbor resizing preserves existing hard edges but does not itself enforce
tile reuse, RGB555 color, four colors per tile, legal source palettes, frame
alignment, or correct object count.

## Handoff checklist

- Editable source remains in the user's chosen source-art location.
- Runtime PNG lands in the actual native game project's appropriate `assets/` path.
- Its genuine native sidecar and, for sprites, animation/metasprite metadata are
  registered without overwriting existing authored files.
- Exported frame order, dimensions, palette, transparency, and tile grid are exact.
- `graphics_analyze` and relevant `graphics_analyze_scene` succeed for the real
  compatibility mode, asset type, displayed scene palette, and aggregate budget.
- A real emulator capture demonstrates the asset in its actual scene when runnable.
- `sprite_preview`, `sprite_contact_sheet`, and `graphics_preview_scene` remain
  explicitly static authored-art projections, never running-game evidence.
- Any unverified editor integration, installed application, ROM build, or gameplay
  appearance is labeled as unverified instead of assumed.
