# Agent workflow and MCP guide

Use the [ModRetro Chromatic plugin](../README.md) to author, compile,
and playtest the user's actual native game project. Its authoring, pixel-art, and
ROM-debugging skills share the local MCP server and the operating contract in
this guide. Use the [setup skill](../skills/modretro-chromatic-setup/SKILL.md) for first
installation, updates, or missing dependencies, including before MCP can start.

## Operating contract

GB Studio remains the editor and owns its normal project format. The plugin
provides focused, game-neutral tools for engine operations and efficient
iteration. Express gameplay, story, progression, interactions, and other
game-specific behavior through native project resources, visual-script events,
or project-owned extensions; do not invent game-specific MCP capabilities.

The host supplies the `modretro-chromatic` MCP namespace. Local tool names stay short:
`project_select`, `scene_apply`, and `emulator_observe` for project work;
`device`, `setup`, `play`, and `flash` for physical Chromatic use. Do not add a
redundant product prefix. See the [device workflow](chromatic-device-testing.md)
for explicit selection, driver setup, timed live demos, exact-ROM writes, and operation recovery.

Treat these as separate kinds of evidence:

- Focused project inspection establishes authored source state.
- A source-art preview establishes only a static projection.
- An official GB Studio build establishes that the native project compiled.
- An official GB Studio web export provides a real Binjgb browser player and
  its own genuine cartridge; it is distinct from a native ROM-build result.
- A standalone GBDK C build establishes only that its C source compiled.
- A real emulator capture establishes only the observed ROM, inputs, and frames.
- A vendor live demo emulates on the computer and streams to the Chromatic;
  it does not establish native cartridge performance.

Never substitute a mock cartridge, fabricated browser player, unrelated sample
project, or generated image for the user's actual project or running game.

## Recognize platform and setup boundaries

macOS and Linux support x64 and arm64. Native Windows x64 support remains
experimental; a complete native setup/build/installed-plugin/gameplay pass is
still required. Do not claim Windows ARM64 compatibility or report portable
tests or macOS/Linux execution as Windows evidence.

Targeted Linux distributions require GNU/Linux with glibc 2.39+ for runtime
preparation and MCP startup, including authoring-only use. Universal packages
do not impose that vendor libc gate on non-hardware authoring startup;
Chromatic device operations still require a supported target. Choose the
artifact accordingly and report only the platforms actually qualified.

If MCP cannot start, follow the [setup skill](../skills/modretro-chromatic-setup/SKILL.md)
and [packaged setup reference](setup.md). Do not loop on unavailable MCP calls.
The bundled `setup.sh`/`setup.ps1` can report or explicitly bootstrap Node from a
trusted compiled package. Claude runs those entrypoints; do not shift runnable
setup commands to the user or assume a global Node/Python installation. Never
run npm setup inside an immutable cache. A launcher Node `--version` check is
disclosed separately from the full passive dependency report.

Once MCP is available, `toolchain_doctor {}` reads metadata without executing
compilers or Python. Inspect component states, required/detected versions,
provenance, roots, and readiness for the requested task. `ready` is compatible
metadata, not a successful build or emulator session. For explicit executable
checks, select only the needed named probes:

```text
toolchain_doctor {"tasks":["authoring","projectBuild","play"]}
toolchain_doctor {"tasks":["play"],"probes":["cli-version","gbdk-version","emulator-import"]}
```

Doctor and plan never install. New or iterated playable games require
`runtime,build`, including browser previews. Use `runtime` alone for source
inspection, edits without a build, or device tools with an existing ROM; add
`emulator` for local stepped play and `desktop` only when requested. Use the same
root and selection for plan, `apply --yes`, and doctor. Carry necessary setup
through for the authorized game workflow unless the user limits downloads or
changes; ask only for missing scope or required platform approval. Preserve existing
bound toolchains, active games/previews, partial outcomes, and lock ownership.
`--use-existing` on a legacy sub-installer is not a promise that its whole front
door is read-only. The public Chromatic `setup` tool handles device operations,
not dependency installation.

After preparation, use the [supported activation path](setup.md#preparation-is-not-activation-or-gameplay-acceptance)
in the intended desktop user's profile. A portable compiled distribution and a
prepared payload bound to local absolute paths are different artifacts. Verify
the exact installed version and callable tools in a new task after installation;
a new task alone does not install or activate anything.
Then complete the requested real build or browser export. Do not stop at a
passive readiness report or give the user manual Node/npm installation work.
Do not copy `codex.exe` across profiles, infer local Git credentials from a
connected GitHub app, or treat a lifecycle hook/approval UI as installation
consent. On Windows use local paths, preferably short paths on `C:`; UNC/network
roots are unsupported and upstream GBDK has path limitations on other drives.

## Start and select the intended project

The trusted runtime/toolchain checkout, authorized workspace, selected project,
and emulator artifact root are distinct. A plugin cache, installed checkout,
toolchain, or bundled starter never implicitly authorizes a user's project.

Carry returned absolute artifact paths across tools. A relative `rom_build`
`outputPath` is selected-project-relative, while `rom_inspect`, emulator ROM and
recording paths resolve from the authorized
workspace. That workspace may contain a nested selected project. In particular,
pass the build's returned absolute `outputPath` to `rom_inspect` and
`emulator_run`, and retain the returned absolute `recordingPath` for later
export or clip extraction. The short `build/...` examples below assume that the
selected project root is also the authorized workspace.

Begin with read-only `session_status`. To use an existing project when no
workspace has been authorized, `project_select` must use its absolute
`.gbsproj` path. That selection authorizes only the selected project's directory:

```text
session_status {}
toolchain_doctor {}
project_select {"projectPath":"/absolute/path/to/MyGame/project.gbsproj"}
project_inspect {}
project_inventory {"resourceTypes":["scene","actor","asset"],"detail":"standard"}
```

On Windows, provide the actual absolute drive-qualified project path and escape
backslashes when writing JSON. Relative selection remains unavailable until an
appropriate workspace has been explicitly authorized.

For a new project in an unconfigured session, `project_create` accepts an
absolute new destination whose real canonical parent directory already exists.
It creates no missing parents, never overwrites an existing destination, and
authorizes only the created project, not its parent or siblings. Creation
leaves selection unchanged unless `select: true` is explicit.

To create or select sibling projects, configure `GB_STUDIO_WORKSPACE_ROOT` to
their intended common workspace before the server starts. Creation, discovery,
and selection may then use paths relative to that fixed boundary:

```text
project_discover {"projectPath":"MyGame/project.gbsproj"}
project_select {"projectPath":"MyGame/project.gbsproj"}
project_inspect {}
```

`project_discover` is read-only: it never selects or authorizes a project and
cannot precede authorization in an unconfigured session. The selected project
must remain inside the authorized boundary after resolving symlinks. Editing
the bundled starter directly additionally requires `allowStarter: true`.

Within an authorized workspace, `project_create` remains confined to it;
neither creation nor selection can broaden access to a sibling outside it.
Relative creation requires an authorized workspace. Choose `template: "starter"`
for a minimal `Start` scene. For the complete editable
[Wrecklight sample](wrecklight-remix.md), use `template: "wrecklight"` and supply
its matching local `templateSourcePath` when using the compact package.
Wrecklight must be copied: direct
selection of either bundled copy is rejected, even with `allowStarter: true`.
Close an active emulator
with `emulator_close` before selecting another project. `session_status` can report
the selected project, authorized workspace, selection generation, and emulator
state without granting further access. Selecting another project automatically
closes its predecessor's browser preview and invalidates that preview URL.

## Recover the failed step

Use the returned code, original request/operation identity, and dispatch evidence
to choose the next action. Correct a definite input prerequisite under the
user's existing authorization, then continue the requested work. Ask only for
missing project identity, intent, or required permission. A timeout or missing
reply is not evidence that an action never started.

| Evidence | Next action |
| --- | --- |
| `PROJECT_SELECTION_REQUIRED` | Read `session_status`, then `project_select` the known intended absolute `.gbsproj` path and repeat the affected call. This also applies to `device_capture` status/read calls, which require a selected project. Preserve the same owner's capture ID; do not create a substitute project or capture. If another project/session is active, resolve that ownership before switching. For a standalone ROM call whose error offers workspace configuration, follow that instruction; capture still requires a native project. |
| A definite rejected input or stale revision before mutation | Refresh only the relevant state, correct the input, and continue within the original request. For device operations, require positive non-start evidence such as `operationStarted:false`; reuse existing consent, but keep the exact intended ROM and device. A returned operation or uncertain dispatch goes through original-operation recovery instead. |
| `CHROMATIC_JOURNAL_ACCESS_DENIED`, `EACCES`, `EPERM`, or a reported OS denial | Identify the specific file/device permission needed. Apply an already-authorized normal access correction where available; otherwise request that permission once. Preserve the denial and continue independent work. Do not relocate the journal, reinstall dependencies, or bypass the denied surface. |
| An operation is running, unresolved, or its reply was lost | Read the original `device` `operation_status` by `operationId`, or by the caller's original direct-MCP `requestId` if no operation ID returned. A copied preview request ID is preview-scoped: use its copied operation ID, or call `web_preview` `install_status` with `installationRequestId` set to that original UUID. Supplied IDs never fall back to the latest request. Match the returned request ID and known generation before adopting a result; `requestedOperationUnknown: true` preserves the original uncertainty. If exact public lookup is unavailable, that same dialog's **Check status** uses its saved request ID. These are status reads, not replacement attempts. |
| A closed `device.program_failed` | Use the original operation's public error/recovery and the preview's **Copy error** report, including optional `failureDetails`. Preserve `cartridgeWrite: "outcome-unverified"`. The generic code and observed low-level tokens do not identify a cause or authorize a retry. If original details are unavailable, say so once and leave the cause unknown. |
| The built-in browser is unavailable | Retain the URL and concrete browser error. Continue requested gameplay checks with public emulator tools on the exact intended ROM, preparing the emulator component if needed under existing authorization. Follow [stepped playtesting](stepped-playtesting.md#when-browser-play-is-unavailable); report native gameplay separately from unobserved browser UI and physical hardware. |

For a known first-use activation requirement or an explicit Developer Mode error,
direct the user to the official [ModRetro Updater](https://support.modretro.com/en_us/articles/chromatic-firmware-updater-ryhoYnzCx).
The plugin does not manage activation or collect codes. Do not infer an invalid
code or a seat limit from a generic failure. After the updater workflow, use
fresh device discovery and selection and the normal flash confirmation; preserve
any previous write's uncertain outcome. See the
[deployment skill](../skills/chromatic-deployment/SKILL.md#prepare-a-first-write-on-a-new-computer).

After a targeted correction, check its result before proceeding. If the same
failure persists without new evidence, retain the concrete blocker and choose
independent work; do not cycle through resets, new request IDs, or repeat approval
questions. Report what failed, what the original evidence establishes, and which
part of the user's task can still continue.

## Inspect efficiently and manage revisions

Use compact `project_inspect` to obtain identity, selected settings, a project
revision, exact resource and health totals, and bounded diagnostics.
`project_inventory` returns a normalized, paginated resource graph by default.
Filter it by `sceneId`, `resourceTypes`, `assetTypes`, `detail`, `fields`, or
`limit`; scenes reference `actorIds` and `triggerIds` while each resource is
returned only once. A `STALE_CURSOR` requires a fresh inspection.

The session-owned semantic world index performs one complete authored-resource
census when exact initial project health is needed. Subsequent focused reads
and server-authored changes should reuse indexed identities and mutation IDs,
not repeatedly rebuild the entire project graph. The index never writes a
database, cache, lock, or marker into the user's project.

Request `session_status {"includeIndexStats":true}` only when diagnosing index
behavior. Unchanged focused warm reads should not increase counters such as
`fullInventoryBuilds`, `fullHashPasses`, or `authoredFileReads`.

Project revisions use 64-character `sha256-merkle-v2` tokens covering the
selected descriptor, `project/**`, and `assets/**`. Previously issued revisions
and cursors can become stale after an upgrade or change. Local plugin event
handlers can affect semantic-query freshness without being included in the
public project revision.

Server-authored updates become visible immediately. External desktop edits are
eventually observed by the filesystem watcher; an ordinary warm read does not
prove that an undelivered external edit is absent. Request expensive
`project_refresh {"mode":"strong"}` only when an authoritative whole-project
verification is needed, including globally sensitive destructive decisions.

Authoring calls from cooperating plugin processes share locks outside the
project. If an interrupted write later reports `RESOURCE_WRITE_LOCKED`, do not
infer whether it completed or repeat it. Reread the exact native resource when
available. Project-wide locks can be recovered when the same host can prove the
old owner exited; an ambiguous or older resource-level lock stays protected and
has no public unlock tool. A distributed resource lock applies to that owner;
legacy resources share the `.gbsproj`, so its lock can block multiple edits.
If it persists after the writing sessions are closed, preserve the project and
error details for operator recovery. An external GB Studio editor does not
participate in these locks.

`project_inspect` and `project_inventory` with `includeSettings:true` report the
current `compilerPreset`. `settings_update` accepts `expectedRevision` from `project_inspect` and checks
it against a fresh project snapshot before writing. Its `compilerPreset`
setting supports the editor's four compiler search budgets: `1000`, `3000`
(default), `50000`, and `100000`. Larger budgets spend more time compiling; measure the
resulting ROM rather than assuming they improve runtime performance.

## Author native project resources

Use the smallest focused tool that preserves GB Studio's native resource IDs,
unknown fields, event branches, source assets, and neighboring authored files:

- `scene_create`, `scene_update`, `scene_inspect`, `scene_apply`, and
  `scene_delete` manage native scenes and bounded coordinated scene edits.
- `actor_create`, `actor_update`, `actor_inspect`, and `actor_delete`, together
  with `trigger_create`, `trigger_update`, `trigger_inspect`, and
  `trigger_delete`, preserve resource identities and unrelated scripts.
- `script_inspect`, `script_edit`, and `script_transition` inspect nested visual
  events, make focused event edits, and author typed native scene transitions.
- `world_dependencies` traces reusable indexed project relationships without
  assuming a particular genre, game mechanic, or custom event.
- `variable_inspect`, `variable_set`, and `variable_delete` manage authored
  global-variable metadata; they do not map names to hardware addresses or
  mutate running emulator memory. For `variable_set`, omit `variableId` to choose the first free
  ID in the editor's default 0–511 range. Explicit IDs may be higher, but must
  be nonnegative decimal strings that JavaScript can represent exactly as safe
  integers, without leading zeros or other formatting. Higher IDs do not appear
  in the stock editor's variable selector. The compiler assigns memory slots
  separately; accepting metadata does not establish compiled-memory fit.
- `engine_field_inspect` and `engine_field_update` manage engine overrides,
  preserve numeric checkbox values, and accept expected resource revisions.
- `collision_inspect` and `collision_edit` preserve native hexadecimal
  run-length collision grids and untouched opaque cell values.
- `asset_import`, `asset_inspect`, `asset_update`, and `asset_delete` manage
  genuine project-local PNG assets and associated native resource metadata.
  For replacement background art, `asset_update.copyTileColorsFrom` copies an
  existing background's exact palette assignments, including UI cells, into
  empty metadata of the same dimensions. Supply `expectedRevision`; preview
  with `dryRun`. Neither PNG is changed.
- `native_graphics_update` applies a complete inert atlas contract to the
  supported private-title renderer without accepting an arbitrary file path or
  C source. See [native title atlas](native-title-atlas.md) for its revision,
  preservation, and dependency-profile limits.
- `sprite_inspect`, `sprite_edit`, `sprite_preview`, and
  `sprite_contact_sheet` support animation authoring and static visual review.
- `palette_inspect`, `palette_create`, `palette_update`, `palette_assign`, and
  `palette_paint` manage native palettes, scene slots, and tile assignments.
  Use direct `palette_paint` only on unbound backgrounds. For a bound tilemap,
  use `tilemap_inspect` and revisioned `tilemap_edit.replace_cells`, preserving
  inspected pixel hashes when only palette assignments change.
- `graphics_analyze` and `graphics_analyze_scene` inspect hardware and engine
  budgets; `graphics_preview_scene` produces a static authored-art projection.
- `dialogue_analyze`, `dialogue_update`, and `dialogue_preview` operate on
  native dialogue, the selected project font, and static text-box previews.
- `settings_update` patches only requested project settings and rejects an
  unknown selected font before modifying authored resources.

Relationship queries use stable project resource identities:

```text
world_dependencies {"node":{"type":"variable","id":"0"},"direction":"incoming","depth":2,"limit":25}
```

Follow the top-level `nextCursor` with `cursor` to page relationships. Coverage
diagnostics have a separate `coverage.pagination.nextCursor`, passed as
`coverageCursor` with the same query. Their pages contain whole limitations and
reviewed custom-event evidence, exact totals and returned counts; `coverage.complete`
always describes aggregate semantic coverage, not whether a page is full. All
responses stay within 32 KiB. A coverage-cursor request prioritizes diagnostics
and may return no relationships when both streams cannot fit together. Advance
each cursor independently; do not treat an empty page as the end of the other
stream. Freshness or query changes invalidate either cursor.

Distinguish executable relationships from conservative structural preservation
edges. Preserve extension-defined event arguments instead of assigning unknown
custom events privileged semantics. Dependency evidence never proves that a
cartridge was compiled or that runtime behavior was observed.

`scene_apply` accepts 1–100 ordered operations, an optional `dryRun`, and an
expected project revision. A batch may reference actors or triggers created
earlier in that batch. Distributed native project resources receive deterministic
best-effort rollback on recoverable failures, not instantaneous cross-file
atomicity. Concurrent external rollback conflicts surface as
`TRANSACTION_RECOVERY_CONFLICT` instead of overwriting user changes.

Dialogue writes preserve requested text and existing page boundaries by
default. With a selected project font, successful writes return at most eight
`fitWarnings` and a compact `dialogueFit` summary. Explicit
`validation: "reject"` fails with `DIALOGUE_OVERFLOW` before writing; text is
rewritten only when `wrap: "word"` or `paginate: true` is explicitly requested.
Setting an unknown `defaultFontId` fails with `FONT_NOT_FOUND` before changing
project settings.

For new assets, choose the actual resource type and sprite profile, preserve
the project's `mono`, `mixed`, or `color` mode, and follow the distinct native
background/sprite source-color and transparency conventions. Never silently
resize, recolor, overwrite, or import a file outside the selected project.

Write game-specific behavior with existing native `EVENT_TEXT` and other
installed commands where appropriate. Preserve opaque project-defined custom
event definitions and arguments. Add an extension only when requested behavior
cannot be expressed cleanly through the existing project.

## Build authentic cartridges

Use `toolchain_doctor` when compiler readiness is uncertain. A headless Linux
host needs the official GB Studio CLI and GBDK, not a graphical desktop editor.

After selecting the intended native project, compile and inspect its cartridge:

```text
toolchain_doctor {}
rom_build {"outputPath":"build/my-game.gbc"}
rom_inspect {"romPath":"build/my-game.gbc"}
```

`rom_build` invokes the official native game project compiler and validates the
resulting cartridge header. The separate `sourcePath` option instead compiles a
standalone Game Boy C file with GBDK; that probe does not establish that the
native `.gbsproj` compiles.

Request authenticated same-build debugging artifacts only when required:

```text
rom_build {"outputPath":"build/my-game.gbc","captureDebugArtifacts":true}
```

The successful native-build response includes compiler `symbols.noi` and
`globals.i` artifacts with SHA-256 evidence tying both files to the exact ROM
from the same build. Those artifacts are unavailable for standalone C builds.
They can authorize explicit source-aware debugging of that exact cartridge;
they do not authorize symbols from an unrelated build or guessed RAM layouts.

Keep original compiler stderr and process outcomes visible. A specifically
recognized official-CLI `DEP0190` deprecation may be classified as a known
warning; unrelated warnings, nonzero exits, missing cartridges, invalid headers,
or mismatched debugging artifacts are never successful verification.
Use additive `diagnostics`, including any source path, line, and suggested
action, to choose the next focused resource inspection. Preserve the actual
compiler error when no specific diagnosis is supported. The official desktop
editor can [run a selected scene](../skills/modretro-chromatic-authoring/references/extensions-and-build.md)
for a quicker local check; normal CLI builds retain the authored starting point.

## Open the official playable browser preview

Open every `web_preview` or `device_capture` URL, including screenshot Open links, in **the host's built-in browser**. In the Claude Code desktop app that is the Browser pane (open the URL with its `preview_start`/`navigate` tool). If no built-in browser exists (for example Claude Code in a terminal), give the user the exact URL to open in their own browser; never post it anywhere else, and do not launch a browser from the shell unless the user asks. If the browser is blocked, retain the URL and report the concrete limitation.

Browser availability is not a prerequisite for gameplay testing. If the browser
is missing, locked or unreachable, retain its state and continue with public
PyBoy `emulator_run`, `emulator_step` and `emulator_observe` on the intended exact
ROM. Follow [headless fallback](stepped-playtesting.md#when-browser-play-is-unavailable)
for setup and retained evidence; browser UI/annotation and physical capture
still require their own checks.

For new or iterated projects, use `web_preview` to show a successful playable
build early. Keep the appropriate owned preview tab visible and open while
working so the user can follow. After meaningful successful builds, update that
preview at a safe point. Do not interrupt human play, saves or recordings;
resolve unknown outcomes before updating. Do not arbitrarily reload or autoplay.

After a confirmed close, the same plugin instance tries its last port again and uses another free port if it is occupied. The reopened view always gets a new private URL; old links are invalid. This does not discover, adopt, or stop other listeners.

Reuse the active preview URL or emulator/capture session for the same task. When temporary testing is complete, close only the session this task owns with `web_preview_close`, `emulator_close`, or `device_capture {"action":"close"}`. Preserve user play (including paused games), ongoing recordings, and unresolved saves or commands; inspect status and retain recovery evidence before closing. Never scan processes, kill by name, claim an unfamiliar port, or clean up another task's session. An unknown action is not safe to replay.

For human-controlled browser play, use the selected project's official GB Studio
export through the plugin:

```text
web_preview {}
```

`web_preview {}` defaults to `action:"open"`. It runs the official `make:web`
compiler when needed and serves its genuine Binjgb/WebAssembly player and
cartridge. The compact handheld view keeps the original core and canvas. Use
the arrow keys to move, **Z/X** for A/B, **Enter** for Start, and **P** for
Select, or use the on-screen controls. Pause/resume and sound stay in the
toolbar. **⋯ More actions** contains Fullscreen, Restart game, Saved states
with capture timestamps, and the last saved capture.

Use **Emulation / Device** above the player to switch views. Your emulator stays
mounted and pauses in Device view; returning restores its previous play/pause
state. Device capture starts off. Open **Settings → Connection** to enable it,
select a Chromatic, and connect; USB audio is a separate choice. Switching views
does not connect or flash hardware. Finish an active recording or resolve its
uncertain status before switching away.

The plugin also adds native annotations in supporting browsers while retaining
the original exported files. The returned `url` is a reusable, capability-authenticated
`http://127.0.0.1:<port>/<secret>/` address. Treat that full URL as private.
The listener rejects invalid capabilities, foreign Host/Origin values, and
path escapes; player-state requests use private same-origin routes.

An unchanged authored project reuses its authenticated export without rewriting
the HTML, runtime, WebAssembly, or ROM, including across MCP sessions when the
trusted toolchain cache is available. Within one live session, repeated calls
reuse the same server and URL. Authored project or project-local plugin changes
rebuild the real export while retaining the existing live preview URL. Load a
successful new build in the same owned tab only at the safe point described
above; a completed build does not mean the browser has loaded it. Ordinary
warm calls use indexed revisions; request `force: true` only when authoritative
whole-project verification and an intentional rebuild are necessary.

```text
web_build {"outputPath":"build/browser-preview"}
web_preview {"outputPath":"build/browser-preview"}
web_preview {"outputPath":"build/browser-preview","force":true}
web_preview_close {}
```

When an existing export must not be rebuilt, pass `cacheOnly:true` with
`force:false`. A missing, stale, or unverifiable export then fails before
compiler staging; ordinary preview calls retain their existing rebuild behavior.

Use the camera icon beside the handheld for a **Screenshot** of the current
game canvas. The record icon starts **Record video** with game audio; the Stop
control shows elapsed time while recording and finishing. Keep the preview
visible while recording. Muted or paused game audio stays silent. These controls
do not send game inputs or change emulation timing, and need no microphone or
display-capture permission.

The existing local preview server saves captures in the selected project's
`captures/<build-identity>/` folder, outside the authored source and web export.
The Saved toast offers Open, Download, and Copy path without changing the player
layout. Reopen the latest capture saved in this page session from
**⋯ More actions → Last capture**. Files remain after the page closes; their
browser links work while this preview is open. Nothing is sent to an external
service. If a save
fails or its result is uncertain, the original browser copy stays available for
download and is never retried automatically. Download it before leaving or
choosing **Discard unsaved**.

Video timing JSON keeps monotonic event times, media chunk timecodes, and bounded
document-visibility observations separate from emulated frames. Visibility
observations can help compare a timing gap with tab activity; they do not prove
its cause. Browser codec support varies; interrupted recordings are
labeled partial and may not play completely. Each recording retains at most
128 MiB of media; reaching that limit stops capture and preserves available
bytes as partial evidence. Screenshots are limited to 8 MiB and 4,194,304 pixels,
with neither dimension above 4096. Metadata is limited to 2 MiB per capture.

`web_build` exports without starting a server. Optional output directories stay
inside the selected project's generated `build/` directory; source resources
are not rewritten. `web_preview_close` stops the listener and invalidates its
URL without deleting the reusable official export. Binjgb runs the interactive
browser preview; optional PyBoy remains a separate headless backend for exact
agent-controlled frames, inputs, and screenshots. Do not claim one backend's
observations as the other backend's evidence.

### Saved progress

Automatic saving captures changed play about every five seconds without pausing
the game. The newest eight states for each build persist in the selected
project's `save-states/<identity>/` directory, outside the web export.
Reopening the preview restores the latest state paused, ready to annotate.
Choose an earlier capture time from **⋯ More actions → Saved states** to reopen
that moment. **Restart game** starts again and skips recovery once; it does not delete
saved history. If recovery fails, automatic saving pauses to preserve that history.

States require the exact ROM, WebAssembly runtime, and source revision that
created them. A new build uses a separate history. Older build histories remain
on disk; states are not migrated between builds.

Claude uses the existing `web_preview` tool for state operations:

| Action | Result |
| --- | --- |
| `open` (default) | Build or reuse the official preview. |
| `status` | Inspect the open preview and connected browser views. |
| `capture_state` | Pause a connected view and save its current state. |
| `list_states` | List saved states for the current build. |
| `restore_state` | Reopen a listed state in a connected view, paused. |

```text
web_preview {"action":"status"}
web_preview {"action":"capture_state","viewId":"<returned viewId>"}
web_preview {"action":"list_states"}
web_preview {"action":"restore_state","viewId":"<returned viewId>","stateId":"<listed state ID>"}
```

Capture and restore use the already-open browser player. `viewId` is optional
when one view is unambiguous; choose one from `status` when several are open.
Restore requires a `stateId` from `list_states`. Build options `outputPath`,
`force`, and `timeoutMs` apply only to `open`.

### Read the preview evidence

`web_build` and `web_preview`'s `open` action return `exportIdentity.rom`
(relative path, SHA256 and bytes), the index identity and the complete validated
export inventory's digest/count/bytes.
These identify this web compilation's own output, not a separately built native ROM.
`sourceRevision` already includes project-plugin contents; `sourceIdentityScope`
states whether the other inputs came from the selected indexed revision or direct
descriptor/resource/asset hashes. The before/after fingerprint check is not a
continuous source lock, nor evidence that the browser has loaded the output.

`execution.args` is the actual staging invocation; the legacy top-level `args`
describes its published destination. Child PID and available spawn/exit/close,
stream bounds and stop reason are reported without claiming descendant observation.
Cache reuse reports `execution.status: "unrun"` and `exitCode: null`.
`resources` retains created stage/scratch/backup paths, identities, bounded
post-compiler size samples and independent cleanup outcomes, including failures.
Samples are not peak/APFS/RAM quotas; trusted attestation-key allocation remains
explicitly unobserved, separate from scratch and artifact totals. A cleanup warning
retains affected directories; a failed rollback retains the previous export.

`web_preview` with `action:"open"` preserves the build result and adds the
in-process listener identity, start time and reuse state; it is not another
child process. Failures expose
`currentPreview`, including unresolved close ownership. `web_preview_close` reports
whether a listener existed and its close was observed; a repeated empty close is
not a new observed close. Build and listener metadata do not establish gameplay
or visible browser behavior. State acknowledgments report the capture, storage,
or restore operation; verify reopening, audio and mute, fullscreen, and player
interaction in the actual browser before claiming those user-visible outcomes.

### Annotate a game preview

In a supporting Codex/ChatGPT browser (not available in Claude Code), **Annotate game** opens native annotation
mode on the existing player. Selecting the canvas freezes a frame. The picker
offers visible hardware sprites, small adjacent sprite groups, background/window
tiles, and a whole-frame fallback. Sprite grouping is an inference from OAM
positions and palettes; it does not establish character names or source asset IDs.
Raster effects and unusual priority modes can make hardware bounds approximate.
The original framebuffer is the visual reference.

The native color controls preview the selected object's captured pixels.
Color comparison/reset uses the original capture. **Resume game** requests an
exit from native annotations and continues only after that exit is confirmed.
If the host keeps the editor open, use **Esc** (again if the editor has focus),
or hold **Space** and click the player control. Color previews do not change
ROM bytes, live emulator memory, assets, dialogue, or source palettes. The
annotation host owns comments, saved annotations, and sending feedback to the
conversation.

Use the delivered annotation's exact ROM hash, source revision, frame and
hardware context to locate the requested change in the selected project.
Inspect the actual source before choosing an asset or actor: tile/OAM locations
are not source mappings. After editing, rebuild with `web_preview` and load the
successful result at a safe point, preserving current play, saves and recordings.
An older annotation continues to describe its captured build;
do not apply its locations blindly to a new ROM.

The adapter is served by the existing authenticated preview listener. It adds
no simulator executable, MCP tool, dependency, or separate server. Its isolated
Binjgb inspection copy reads captured VRAM/OAM without changing the running
player. The official player retains emulation, input, audio, display settings,
and rewind. `preview.annotations` reports adapter injection only;
actual native support is detected in the page. Ordinary browsers still play the
game. If the host rejects annotation mode while the agent controls the browser,
return control to the user and let them open it normally.

Test doubles cover the callback contract only. Native acceptance requires the
actual host to select an object, preview/compare/reset colors, save and reopen an
annotation, then send it and inspect the received conversation context.

For an authored overview, `graphics_preview_scene` also accepts ordered `sceneIds`
(1–16 distinct scenes), `columns` (1–8) and integer `magnification` (1–4), instead
of `sceneId`. It writes a new labeled STATIC / NOT GAMEPLAY sheet; the original
single-scene behavior remains unchanged.

## Playtest real ROMs

Follow [Stepped playtesting](stepped-playtesting.md) for the canonical
edit → build → play → diagnose → fix → retest loop. The editing model chooses
each next input from real emulator frames; no separate player is required.

PyBoy is installed separately. Check metadata first and explicitly request the
`emulator-import` probe when executable health matters before promising gameplay
verification. Authorized packaged setup isolates Python/uv storage in its owned
root and reuses a healthy environment. It never changes global Python or a live
binding. Do not rerun setup merely to start another session; an import probe
still does not establish that the user's ROM has run.

```text
emulator_run {"romPath":"<returned ROM outputPath>","initialFrames":120,"recording":{}}
emulator_observe {}
emulator_step {"buttons":["right"],"frames":20,"sampleCount":4}
emulator_step {"buttons":[],"frames":1,"sampleCount":1}
emulator_inspect {"view":"oam","visibleOnly":true,"limit":40}
emulator_close {}
```

A step requires the complete held-button set and 1–3,600 frames. The set
persists; repeating it does not add release/press edges. Up to eight genuine
samples are returned across positive frame offsets including the endpoint,
four by default. `emulator_observe` only reads the current frame: it does not
advance, deliver input, or change the recording journal. `includeImages:false`
omits images; optional `imageLayout:"contact-sheet"` lays out the SAME current
image in memory. Individual PNGs remain the default. The same layout option on
`emulator_step` composes only its already-requested samples, without extra steps.

An unchanged `emulator_run` reuses the current session without repeating
`initialFrames`. Request `restart:true` for an intentional fresh boot; changed
ROM bytes or hardware mode boot fresh automatically. Every boot preserves
adjacent cartridge saves. Close before switching projects; `emulator_close`
also cancels outstanding emulator work and waits for cleanup.

`emulator_inspect` provides bounded OAM or allowlisted VRAM, WRAM, OAM, and
HRAM views: at most 40 objects or 256 bytes. It does not infer named variables.
Source-mode `emulator_debug` requires an exact authenticated official build
and unchanged source. Neither tool permits memory writes, cartridge/boot ROM
dumps, arbitrary host files, or a shell.

Use optional [recordings and checkpoints](recorded-playtesting.md) to preserve
failure evidence, export retained input history, review an interval, or extract
a supporting clip. Repeat the relevant steps from a comparable fresh boot
after editing and rebuilding. Checkpoints require matching ROM and worker
identity; they do not transfer to a rebuild.

Inspect actual samples for movement, interactions, collision boundaries, art,
and readability. They establish only the frames and inputs exercised, not
unsampled behavior, audio, saves, physical hardware, or CPU-cycle performance.

## Evidence and safety

Keep all project edits, builds, captures, and emulator artifacts inside their
explicitly authorized roots. Preserve authored scenes, events, assets, unknown
fields, custom extensions, compatibility modes, and existing tracked ROMs.
Never replace a tracked cartridge or change another project without permission.

`GB_STUDIO_MCP_PATH_VISIBILITY=workspace-only` preserves usable authorized
project, ROM, and capture paths while redacting unrelated developer-home,
runtime, toolchain, and Python locations from tool responses. Redaction does
not grant additional filesystem authority.

Reinspect changed focused resources before reporting success. Build the actual
project when compilation matters; repeat bounded emulator steps and inspect the
resulting framebuffer when gameplay behavior matters. State exactly which
project, ROM, compiler, input sequence, and frames were verified, and identify
missing compiler, optional emulator, or hardware evidence honestly.

## Domain references

- [Plugin setup skill](../skills/modretro-chromatic-setup/SKILL.md)
- [ModRetro project authoring skill](../skills/modretro-chromatic-authoring/SKILL.md)
- [Game Boy pixel art skill](../skills/modretro-chromatic-pixel-art/SKILL.md)
- [ROM build and debugging skill](../skills/modretro-chromatic-rom-debugging/SKILL.md)
- [Chromatic device and deployment skill](../skills/chromatic-deployment/SKILL.md)
- [Architecture and security boundaries](architecture.md)
- [End-to-end runtime validation](runtime-validation.md)

### Watch browser play for a fixed duration

Use the existing `web_preview` tool for the browser emulator. `device_capture` is only for physical hardware. Keep the preview in the host's built-in browser and preserve a person's active play.

1. Read `web_preview` with `action: "status"`. Select a visible, running, idle player and copy its listener ID, view ID, ROM/runtime hashes, source revision, and recording generation into `recordingBinding`.
2. Call `action: "start_recording"` with that binding and optional `recordingDurationMs` (1,000–600,000; default 180,000). The immediate receipt is a queued job, not proof that recording began. Save its `recordingId`.
3. Poll `action: "recording_status"` with the original ID. `stop_recording` requests an early stop. The visible capture controls operate the same recorder, so a person's Stop takes priority.
4. Wait for `finished`: recorder stopped, tracks released, file committed, and the browser acknowledged that exact saved result. `read_capture` verifies the original file and returns its receipt; it does not decode media. Then close only your temporary preview.

Keep the view visible. Lost connection, hidden views, size limits, or interrupted finalization can yield partial or UNKNOWN results. Never retry an uncertain start or upload; read its original status. A project-wide unresolved journal blocks conflicting jobs across restarts. Preserve the original browser download and journal for diagnosis. This tool has no reset or reconciliation shortcut.

Closing a preview uses a fresh acknowledgment from every recording-capable view, blocks new capture starts locally, and waits up to a fixed 30 seconds for finalization. A human capture that started first refuses ordinary close. An UNKNOWN close retains the listener for inspection; process shutdown is bounded and may preserve an unresolved recording rather than claim a completed save.

### Open a ready view

Claude manages project selection and preparation before opening a view. For game preview, select or create the requested project, prepare missing build dependencies, and wait for a successful preview result before opening its URL. Never open an empty setup placeholder or ask the user to repeat the same request through an in-view Claude button. For physical capture, select the project used to store its captures first; a compiled game is not required to watch the connected device. Keep the current working view if a replacement cannot open. Real access failures and unresolved operations remain explicit and must not be silently retried.
