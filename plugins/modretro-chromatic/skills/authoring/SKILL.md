---
name: authoring
description: Create or edit native GB Studio game projects for Game Boy / Game Boy Color (ModRetro Chromatic) - scenes, actors, triggers, events, dialogue, variables, collisions, palettes and gameplay - through the modretro-chromatic MCP tools.
---

# ModRetro Chromatic authoring

Work in the creator's genuine `.gbsproj` / `.gbsres` project so the result stays
editable in the GB Studio editor and builds to a real cartridge. The tools come
from this plugin's `modretro-chromatic` MCP server
(`mcp__plugin_modretro-chromatic_modretro-chromatic__<tool>` in Claude Code).

If the plugin needs setup or its tools cannot start, use the
[setup skill](../setup/SKILL.md) first. Creating or iterating a playable game
needs the `build` component, including its browser preview; add `emulator` for
local stepped play. Carry necessary setup through, then return to the requested
game. Do not stop at a passive doctor report.

## Browser previews

Open every `web_preview` or `device_capture` URL, including screenshot Open
links, in **the host's built-in browser**. In the Claude Code desktop app that
is the Browser pane (open the URL with its `preview_start`/`navigate` tool). If
no built-in browser exists (Claude Code in a terminal), give the user the exact
URL to open in their own browser; never post it anywhere else, and do not launch
a browser from the shell unless the user asks. If the browser is blocked, retain
the URL and report the concrete limitation.

A missing, locked or unreachable browser does not block gameplay checks. Retain
its state and continue with PyBoy `emulator_run`, `emulator_step` and
`emulator_observe` on the intended exact ROM. Follow the
[headless fallback](../../docs/stepped-playtesting.md#when-browser-play-is-unavailable).

For new or iterated projects, use `web_preview` to show a successful playable
build early, and keep that preview open while working so the user can follow.
Update it after meaningful successful builds at a safe point: do not interrupt
human play, saves or recordings, and resolve unknown outcomes first. Do not
arbitrarily reload or autoplay. The Codex-only "Annotate game" feature is not
available in Claude Code; when the user points at something on screen, use
`emulator_observe`, a Browser-pane screenshot, or their description instead.

## Select the intended project

`session_status {}` reports the current selection without granting access.
Confirm it is the project the user intends; if none is selected or a different
one is active, use `project_select` with the intended absolute `.gbsproj` path
before reading or editing project resources.

To start a game, use `project_create_blank` (empty Start scene) or
`project_create` (`starter`, or `wrecklight` with its matching local
`templateSourcePath`) with an absolute unused destination under an existing
directory and `select:true`. In Claude Code, a good default parent is the
session's working directory; confirm the folder name with the user if unsure.
Never edit the source template. Discovery grants no access and neither creation
nor selection expands an existing authorization boundary. Users who keep several
games together can set `GB_STUDIO_WORKSPACE_ROOT` in their environment before
starting Claude Code. See [project selection](../../docs/agent-guide.md#start-and-select-the-intended-project)
and the [Wrecklight remix guide](../../docs/wrecklight-remix.md).

## Author native resources

- Start with `project_inspect {}` and narrow `project_inventory` or focused
  scene/script reads to the part being changed. `scene_apply` uses the project
  `revision`; script edits use the exact target's `script_inspect.revision`, and
  `trigger_create` uses `scene_inspect.sceneRevision`. Restart after
  `STALE_CURSOR`. For concurrent editor changes or a destructive global
  reverse-reference decision, see
  [revisions and the world index](../../docs/agent-guide.md#inspect-efficiently-and-manage-revisions);
  the latter needs `project_refresh {"mode":"strong"}`.
- Prefer semantic tools such as `scene_apply`, `script_edit`,
  `script_transition` and `collision_edit`. Preserve unknown fields, stable
  resource/event IDs, script branches, collision bytes, plugins and format
  versions. If a tool cannot express the change, inspect neighbouring resources
  and make the smallest compatible native edit with Claude's file tools. A
  distributed `scene_apply` has best-effort rollback, not cross-file atomicity.
- Use the project's actual `mono`, `mixed` or `color` mode. Actor coordinates
  are normally gameplay tiles; scene `x`/`y` are editor-canvas positions. Keep
  assets inside the selected project, preserve authored PNGs/sidecars and the
  reserved UI palette, and keep generated outputs separate from authored
  resources and existing tracked cartridges.
- Preserve native `EVENT_TEXT` wording and page boundaries by default; request
  wrapping or pagination only when the user wants a rewrite. Guard
  `dialogue_update` with the same owner's `script_inspect.revision`; use
  `validation:"reject"` when overflow must block the write. Unknown custom
  events remain opaque. See [dialogue and resource examples](references/project-authoring.md#dialogue-representation).

Example: to make a door lead to another room, find both scene IDs, inspect the
trigger and destination collision, insert a typed `script_transition` with a
valid landing tile, then build and check entering and leaving the door works if
gameplay verification is in scope.

## Choose the relevant detail

- [Native resource layout and tool examples](references/project-authoring.md).
- [Native tilemaps](../../docs/tilemaps.md): fixed-size rooms from named 8 × 8
  tiles; mutations need the current revision.
- [Extensions and builds](references/extensions-and-build.md): custom events,
  scene modes, project-local plugins, official CLI and GBDK. Engine ejection
  needs authorization.
- [Pixel art](../pixel-art/SKILL.md) for sprites, backgrounds and palettes;
  [ROM debugging](../rom-debugging/SKILL.md) and
  [stepped playtesting](../../docs/stepped-playtesting.md) for compilation,
  input-driven bugs and real framebuffer evidence;
  [deployment](../deployment/SKILL.md) for a physical Chromatic.

Verify the change at the level the request needs: reread the native resources,
build the actual project when compilation matters, and inspect genuine emulator
frames when behaviour matters. A static preview or compiler probe does not show
that the game was built or played; state any missing evidence.
