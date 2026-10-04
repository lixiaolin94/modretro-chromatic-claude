---
name: modretro-chromatic-authoring
description: Create or edit native game projects, scenes, events, and gameplay for Game Boy or Game Boy Color.
---

# ModRetro Chromatic authoring

Work in the creator's genuine `.gbsproj` / `.gbsres` project so the result stays editable in the game editor and builds to a real cartridge.

If the plugin needs setup or its tools cannot start, use the [setup skill](../modretro-chromatic-setup/SKILL.md) first. Creating or iterating a playable game needs `runtime,build`, including its browser preview. Use runtime alone only for source inspection or edits that do not require a build; add `emulator` for local stepped play. Carry necessary authorized setup through installation and callable tools, then return to the requested game. Do not stop at a passive doctor report or ask the user to install Node/npm manually.

## Browser previews

Open every `web_preview` or `device_capture` URL, including screenshot Open links, only in **Codex's built-in browser**. If it is unavailable or blocked, retain the URL and report the concrete limitation. Never launch or fall back to an external browser.

A missing, locked or unreachable browser does not block gameplay checks. Retain
its state and continue with public PyBoy `emulator_run`, `emulator_step` and
`emulator_observe` on the intended exact ROM. Follow the [headless fallback](../../docs/stepped-playtesting.md#when-browser-play-is-unavailable)
for setup, retained evidence and the separate browser/physical acceptance limits.

For new or iterated projects, use `web_preview` to show a successful playable
build early. Keep the appropriate owned preview tab visible and open while
working so the user can follow. Update it after meaningful successful builds
at a safe point: do not interrupt human play, saves or recordings, and resolve
unknown outcomes first. Do not arbitrarily reload or autoplay.

## Select the intended project

`session_status {}` reports the current selection without granting access. Confirm it is the project the user intends; if none is selected or a different one is active, use `project_select` with the intended absolute `.gbsproj` path before reading or editing project resources. To start a game, use `project_create` with an absolute unused destination under an existing canonical parent and `select:true` when continuing in it. `starter` is included. `wrecklight` creates an editable adventure copy; compact installations require its matching local `templateSourcePath`. Never edit the source template. Discovery grants no access and neither creation nor selection expands an existing authorization boundary. See [project selection](../../docs/agent-guide.md#start-and-select-the-intended-project) for configured workspaces and sibling projects, or the [Wrecklight remix guide](../../docs/wrecklight-remix.md) for that template.

## Author native resources

- Start with `project_inspect {}` and narrow `project_inventory` or focused scene/script reads to the part being changed. `scene_apply` uses the project `revision`; script edits use the exact target's `script_inspect.revision`, and `trigger_create` uses `scene_inspect.sceneRevision`. Restart after `STALE_CURSOR`. For concurrent editor changes or a destructive global reverse-reference decision, see [revisions and the world index](../../docs/agent-guide.md#inspect-efficiently-and-manage-revisions); the latter needs `project_refresh {"mode":"strong"}`.
- Prefer semantic tools such as `scene_apply`, `script_edit`, `script_transition`, and `collision_edit`. Preserve unknown fields, stable resource/event IDs, script branches, collision bytes, plugins, and format versions. If a tool cannot express the change, inspect neighboring resources and make the smallest compatible native edit. A distributed `scene_apply` has best-effort rollback, not cross-file atomicity.
- Use the project's actual `mono`, `mixed`, or `color` mode. Actor coordinates are normally gameplay tiles; scene `x`/`y` are editor-canvas positions. Keep assets inside the selected project, preserve authored PNGs/sidecars and the reserved UI palette, and keep generated outputs separate from authored resources and existing tracked cartridges.
- Preserve native `EVENT_TEXT` wording and page boundaries by default; request wrapping or pagination only when the user wants a rewrite. Guard `dialogue_update` with the same owner's `script_inspect.revision`; use `validation:"reject"` when overflow must block the write. Unknown custom events remain opaque. See [dialogue and resource examples](references/project-authoring.md#dialogue-representation).

For example, to make a door go to another room: find both scene IDs, inspect the trigger and destination collision, insert a typed `script_transition` using a valid landing tile, then build and directly check that entering and leaving the door works if gameplay verification is in scope.

## Choose the relevant detail

- [Native resource layout and tool examples](references/project-authoring.md): scenes, actors, events, variables, collision, palettes, settings, and focused edits.
- [Native tilemaps](../../docs/tilemaps.md): fixed-size rooms built from named 8 × 8 tiles. Capture exact existing patterns or deliberately fill; mutations need the current revision. Ordinary edits preserve protected cells; exclusive replacement operations require inspected preimages. Decoration must not infer or clear collisions.
- [Extensions and builds](references/extensions-and-build.md): custom events, scene modes, project-local plugins, official CLI and GBDK. Use existing visual events and scene modes when they express the mechanic; engine ejection needs authorization.
- [Packaged setup](../../docs/setup.md) and [Windows setup](../../docs/windows-setup.md): dependency details. `toolchain_doctor` metadata readiness is not executable health; the setup skill preserves the user's authorized scope.
- [Pixel art](../modretro-chromatic-pixel-art/SKILL.md) for image/palette work; [ROM debugging](../modretro-chromatic-rom-debugging/SKILL.md) and [stepped playtesting](../../docs/stepped-playtesting.md) for compilation, input-driven bugs, and real framebuffer evidence.

Verify the change at the level the request needs: reread the native resources, build the actual project when compilation matters, and inspect genuine emulator frames when behavior matters. A static preview or compiler probe does not show that the game was built or played; state any missing evidence.
