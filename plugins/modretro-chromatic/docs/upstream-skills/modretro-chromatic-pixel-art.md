---
name: modretro-chromatic-pixel-art
description: Create, edit, or check native game sprites, backgrounds, tiles, and palettes. Use for Image Generation or native pixel work, tile budgets, and in-game readability.
---

# ModRetro Chromatic pixel art

Choose the workflow from the request and the existing artwork. Read the matching
reference; load other details when the task needs them.

If the plugin tools are unavailable, follow the [setup skill](../modretro-chromatic-setup/SKILL.md).
Native asset work needs the runtime; a compiler or emulator is needed only for
requested build or gameplay checks.

## Browser previews

Open every `web_preview` or `device_capture` URL, including screenshot Open links, only in **Codex's built-in browser**. If it is unavailable or blocked, retain the URL and report the concrete limitation. Never launch or fall back to an external browser.

## Choose a workflow

| Need | Route |
| --- | --- |
| **A new static sprite** | Start with the [two-step Image Generation workflow](references/prompting-recoverable-grids.md): generate a deliberately coarse design, then reconstruct it as whole filled grid cells. Use the requested or existing project size; otherwise start at 32 × 32. |
| **A background, tileset, or reusable room** | Use [native artwork and tile tools](references/native-pixel-tools.md#new-native-artwork), with [hardware and import guidance](references/hardware-and-imports.md) for palette and tile budgets. Use [native tilemaps](../../docs/tilemaps.md) for rooms built from authored tiles. |
| **Exact pixel edits, manual art, palettes, or tile composition** | Use [native pixel authoring and plugin tools](references/native-pixel-tools.md). Author PNG/cel pixels directly; use the plugin for supported palette, tilemap, and sprite-metadata edits. Prefer this route when existing pixels must stay exact. |
| **Animation from an approved still** | Use [native animation guidance](references/prompting-grid-animation.md): optional generated motion reference, deliberately authored native frames, then timed review. Preserve the approved still and working motions. |
| **Editor files, existing raster art, or import/conversion** | Use [authoring and interchange](references/authoring-and-interchange.md). Preserve editable sources and check the available conversion/import tools. |

Honor a requested method. When the user is choosing, explain the relevant
tradeoff: Image Generation explores designs; native authoring provides exact
pixel control. A generated grid still requires cell and visual review.

## Work in the right context

Source-art exploration can stay in the workspace. Before changing a game,
select the intended `.gbsproj` and inspect the actual asset, style, and
compatibility mode. Follow the [project operating guide](../../docs/agent-guide.md#start-and-select-the-intended-project)
for selection and revision safeguards; keep original and editable artwork.

- For source colors, dimensions, import profiles, and budgets, read
  [hardware and imports](references/hardware-and-imports.md).
- For silhouette, genre, and scene readability, read
  [art direction](references/genre-art-direction.md).
- For recipe-backed rooms, protected cells, and exact collision edits, read
  [native tilemaps](../../docs/tilemaps.md).

Inspect the result at native size. Review animation in motion and keep user
feedback authoritative; passing pixel checks does not establish visual quality.
When integrating into a game, use [stepped playtesting](../../docs/stepped-playtesting.md)
for actual scene behavior. Distinguish source previews from verified gameplay.
