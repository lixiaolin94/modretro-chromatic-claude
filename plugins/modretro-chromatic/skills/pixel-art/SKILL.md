---
name: pixel-art
description: Create, edit, or check Game Boy / Game Boy Color sprites, backgrounds, tiles and palettes for a ModRetro Chromatic game - exact pixel authoring as text grids, palette and tile budgets, native import, and in-game readability.
---

# ModRetro Chromatic pixel art

Choose the workflow from the request and the existing artwork. Read the matching
reference; load other details only when the task needs them. If the plugin tools
are unavailable, follow the [setup skill](../setup/SKILL.md). Native asset work
needs only the MCP server; a compiler or emulator is needed only for requested
build or gameplay checks.

## Author pixels as text grids (default in Claude Code)

Claude has no built-in image generator, so new or edited pixels are authored
deliberately as a **`.pxg` text grid**: one character per native pixel plus an
explicit palette. Every pixel is intentional, reviewable and editable with
ordinary text edits. The bundled helper converts in both directions and checks
Game Boy constraints:

```sh
PXG="${CLAUDE_PLUGIN_ROOT}/scripts/claude/pixel-grid.mjs"
node "$PXG" template sprite > hero.pxg                     # 16x16 sprite skeleton
node "$PXG" render  hero.pxg --out hero.png                 # 1x PNG + hero@8x.png preview + JSON checks
node "$PXG" extract existing.png --profile sprite --frame-width 16   # PNG -> .pxg for exact edits
node "$PXG" check   some.png --profile background
```

Format:

```text
profile: sprite            # sprite | background | color | free
palette:
  . #65ff00                # sprite transparency marker
  K #071821                # darkest
  M #86c06c                # middle
  W #e0f8cf                # lightest
---
@frame down                # optional; frames are laid out left to right
......KKKK......
....KKMMMMKK....
...
```

Workflow:

1. Fix the target first: asset type, exact size and layout (16 × 16 static,
   48 × 16 directional, 96 × 16 animated, or the project's existing template),
   the project's colour mode and source-colour convention. See
   [hardware and imports](references/hardware-and-imports.md).
2. Plan the silhouette and a few identity cues at native scale before drawing;
   budget features in whole pixels (a 16 × 16 head is often 6–8 px). Read
   [art direction](references/genre-art-direction.md) for readability.
3. Write the `.pxg` in the workspace (not yet in the project). Draw the outline,
   then fills, then single-pixel accents. Keep rows exactly the declared width.
4. `render` it. Fix every reported issue (`SOURCE_COLOUR`, `TILE_COLOURS`,
   dimensions). Then **look at the `@8x` preview with the Read tool**: check
   silhouette, contrast against the intended background, and the magenta 8 × 8
   tile grid. Iterate by editing the text. Show the preview to the user for
   approval when appearance matters; their feedback is authoritative.
5. For animation, author each frame as an `@frame` block derived from the
   approved still, change only what moves, and review frames side by side; see
   [native animation](references/prompting-grid-animation.md) for timing and
   review guidance.
6. Integrate: copy the 1× PNG into the selected project's `assets/` folder as a
   new versioned file, run `graphics_analyze` on it, then `asset_import` with an
   explicit profile. Inspect the returned asset and deliberately update only the
   intended scene/actor references.
7. For in-game appearance claims, build and inspect genuine `emulator_observe` /
   `emulator_step` frames; `sprite_preview`, `sprite_contact_sheet` and
   `graphics_preview_scene` are static authored-source projections.

For existing art, `extract` to `.pxg`, make the minimal text edit, `render`,
and compare before/after previews. Preserve the original PNG, alpha/chroma-key
convention, frame bounds and palette.

## Other routes

| Need | Route |
| --- | --- |
| A background, tileset or reusable room | Author tiles as `.pxg` (`profile: background`, multiples of 8), then use [native artwork and tile tools](references/native-pixel-tools.md#new-native-artwork) and [native tilemaps](../../docs/tilemaps.md): `tilemap_atlas_create`, `tilemap_create`, `tilemap_edit`. |
| Palette changes, palette slots or tile colour attributes | `palette_create`, `palette_update`, `palette_assign`, `palette_paint`; see [native pixel tools](references/native-pixel-tools.md). |
| Editor files (Aseprite etc.), existing raster art, conversion | [Authoring and interchange](references/authoring-and-interchange.md). |
| An image-generation tool is available in this session (for example an image MCP server) and the user wants generated exploration | Follow the two-step [recoverable-grid workflow](references/prompting-recoverable-grids.md) and its `evaluate-grid.mjs` diagnostic, then extract the result to `.pxg` for exact cleanup. Without such a tool, do not pretend to generate images. |

Honour a requested method. When the user is choosing, explain the trade-off:
generated images explore loose designs; text-grid authoring gives exact native
pixel control and clean diffs.

## Work in the right context

Source-art exploration can stay in the workspace. Before changing a game,
select the intended `.gbsproj` and inspect the actual asset, style and
compatibility mode. Follow the
[project operating guide](../../docs/agent-guide.md#start-and-select-the-intended-project)
for selection and revision safeguards; keep original and editable artwork.

## Browser previews

Open every `web_preview` or `device_capture` URL in **the host's built-in
browser** (the Browser pane in the Claude Code desktop app). In a terminal
session give the user the exact URL instead; never post it elsewhere or launch a
browser from the shell unless asked. If blocked, retain the URL and report it.

Inspect results at native size and in motion; passing pixel checks does not
establish visual quality. Distinguish source previews from verified gameplay.
