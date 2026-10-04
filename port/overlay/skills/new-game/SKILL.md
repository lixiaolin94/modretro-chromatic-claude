---
name: new-game
description: Start a new Game Boy Color game for ModRetro Chromatic from an idea - prepare the toolchain, create an editable GB Studio project, build it, and open a playable preview - then keep iterating. Use when the user wants to make, prototype or remix a Chromatic / Game Boy game.
argument-hint: "[game idea, or 'wrecklight' to remix the sample]"
---

# Make a Chromatic game

The user's idea: $ARGUMENTS

Goal: a real, editable GB Studio project that builds to a genuine `.gbc` ROM and
is playable in a preview within the first few steps, then improves in small,
verified iterations. Detailed rules live in the other skills of this plugin:
[authoring](../authoring/SKILL.md), [pixel art](../pixel-art/SKILL.md),
[ROM debugging](../rom-debugging/SKILL.md), [deployment](../deployment/SKILL.md),
[setup](../setup/SKILL.md).

## 1. Check readiness (once)

Call `session_status {}` and `toolchain_doctor {}`. If the `build` component is
missing, run `toolchain_prepare {"components":["build","emulator"]}` (or the
Bash fallback in the setup skill if it times out) and say in one line that the
first run downloads GB Studio, GBDK and PyBoy. Continue automatically afterwards.

## 2. Shape the idea

If the idea is empty or vague, offer two or three tiny concepts that fit the
hardware (one screen-sized room, a 16 × 16 hero, one goal) and let the user
pick. Otherwise restate it as: genre, player verb, one goal, one or two rooms.
Keep the first version deliberately small. Game Boy Color scenes are 160 × 144
px (20 × 18 tiles); sprites are 16 × 16 with three colours plus transparency.

## 3. Create and select the project

Pick an absolute destination: by default a new folder named after the game under
the current working directory (confirm the name if it is not obvious). Then:

- blank game: `project_create_blank {"name":"…","destinationPath":"/abs/…/MoonGarden","gameType":"TOPDOWN","colorMode":"color","select":true}`
  (`gameType` is one of `TOPDOWN`, `PLATFORM`, `ADVENTURE`, `SHMUP`,
  `POINTNCLICK`; use `colorMode:"color"` for Chromatic-only games or `mixed`
  to stay playable on a monochrome Game Boy)
- starter sample: `project_create {"template":"starter", …, "select":true}`
- Wrecklight remix: `project_create {"template":"wrecklight", …}` with a matching
  local `templateSourcePath` (see [wrecklight remix](../../docs/wrecklight-remix.md));
  if unavailable, say so and offer the starter instead.

## 4. First playable build

Build and preview immediately: `web_preview {}` compiles with the official GB
Studio CLI and returns a local URL. In the Claude Code desktop app, open it in
the Browser pane and keep that tab for the session; in a terminal session give
the user the URL. Confirm it boots (the Browser pane screenshot, or
`emulator_run` + `emulator_observe` on the built ROM).

## 5. Iterate in small verified steps

For each feature: inspect → edit with the semantic tools (`scene_apply`,
`actor_create`, `script_edit`, `script_transition`, `dialogue_update`,
`collision_edit`, palettes) → rebuild → check. Author art as `.pxg` text grids
with `${CLAUDE_PLUGIN_ROOT}/scripts/claude/pixel-grid.mjs`, review the enlarged
preview, then `asset_import`. Verify behaviour with `emulator_step` frames
rather than assuming it works, and refresh the user's preview at a safe moment.
Summarise what changed and what was verified after each step.

Useful prompts the user can give next (from ModRetro's quickstart):
"Add a village scene with three houses, a fountain and a character to talk to",
"Create a small robot player sprite with idle and walking animations",
"Give this scene a moonlit palette", "Audit backgrounds and sprites for Game Boy
hardware limits".

## 6. Real hardware (optional)

When the user wants it on a Chromatic, switch to the
[deployment skill](../deployment/SKILL.md): vendor CLI check, device discovery,
then a live `play` stream or a consented cartridge `flash` of the exact inspected
ROM. Developer Mode activation happens only in the official ModRetro Updater.
Without an activation code (any non-DevDay Chromatic), follow the deployment
skill's "Without a Developer Mode activation code" loop: live `play` demo plus a
user-owned flash cartridge for native tests.
