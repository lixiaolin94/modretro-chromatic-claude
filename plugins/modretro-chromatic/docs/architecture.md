# ModRetro Chromatic architecture

The [ModRetro Chromatic plugin](../README.md) provides a local Game Boy
development environment for authoring, building, and playtesting genuine native
game projects. Its repository home is
[OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex](https://github.com/OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex).

## Ownership boundaries

- GB Studio remains the visual editor and owns its normal project format.
- Game projects remain ordinary user-owned directories containing `.gbsproj`,
  `.gbsres`, PNG, music, and engine-plugin files.
- The Claude plugin provides focused skills and an auditable local MCP server.
- GBDK and the official GB Studio CLI compile real Game Boy and Game Boy Color
  ROMs. A filename or mock web preview is not evidence of hardware compatibility.
- The official GB Studio `make:web` export provides a separate genuine Binjgb
  browser emulator, official player assets, and the selected project's ROM.
- PyBoy is an independently installed optional emulator. It executes the actual
  ROM and provides exact held-button steps and genuine sampled framebuffer PNGs.
  Optional recordings and same-build checkpoints preserve useful evidence in
  this same runtime.
- The optional native project extension provides project-local engine
  configuration without replacing the editor or engine.

The emulator is not bundled into the MIT-licensed plugin: PyBoy is separately
licensed and remains in a local virtual environment. Likewise, a user-installed
GB Studio application and GBDK distribution are local development dependencies,
not checked-in redistributable source.

The official CLI and GBDK also support headless Linux installations; the macOS
desktop application is useful for visual editing but is not required to build
or emulate a project. Native Windows x64 support remains experimental; a
complete native Windows installation/build/gameplay pass is still required.
Windows ARM64 is unsupported. Packaged POSIX-shell and PowerShell entrypoints
can bootstrap a private Node distribution before the shared Node setup manager
or MCP starts. They do not require Git Bash or WSL. Windows resolves `lcc.exe`
and `Scripts/python.exe` instead of POSIX executable paths. Never infer compiler
or emulator readiness from an application-bundle path.

## Packaged dependency setup

`scripts/dependency-catalog.mjs` defines compatibility requirements and separate
new-install pins. `dependency-doctor.mjs` supplies the shared passive detector
and named executable probes; `setup.mjs` uses the same definitions for
`doctor`, `plan`, and explicitly consented `apply --yes`. The packaged
`setup.sh`/`setup.ps1` launchers cover the pre-Node boundary. Their disclosed
Node `--version` prerequisite check is not a compiler/Python smoke probe.
Without Node, they return bootstrap-only information rather than inventing
full readiness or relying on an MCP connection that cannot start.

Passive detection reads bounded metadata, selected roots, and provenance. It
does not install, execute compilers, import Python, or load a cartridge.
`toolchain_doctor` exposes the same task/component report; its optional probes
are only `cli-version`, `gbdk-version`, and `emulator-import`. Metadata readiness,
probe results, official builds, and actual gameplay are distinct evidence.
Overall readiness requires all requested tasks, not a CLI-or-GBDK shortcut.

Plan/apply select a dedicated external setup root containing separate Node,
runtime, and toolchain destinations. Detection may inspect old configured or
receipt-bound roots, but that does not authorize setup to repair them. A new or
empty target can be owned explicitly; nonempty unowned roots and redirected
setup paths fail closed. Downloads, npm/uv storage, staging, receipts, and
payloads stay in that root, outside immutable packages and game projects.

Apply checks/reuses healthy tools, serializes changes with a per-root lock, and
records per-component outcomes. It preserves successes and known-owned partial
state after failure or cancellation; retries do not overwrite unowned tools,
steal stale locks, or kill unrelated processes. Pinned archives are checked
before extraction. The official CLI uses fixed GB Studio/GBVM source archives
and a pinned Yarn executable rather than a global Git/Corepack setup. Production
npm dependencies use a separate reviewed public-registry lock with lifecycle
scripts disabled. Optional desktop extraction can require a documented manual
step and is not then reported as installed.

A successful runtime-enabled preparation creates a new immutable future payload
and `prepared-mcp.json`. It does not edit profiles/PATH, register a marketplace,
install or refresh a Claude plugin, or rebind active MCP processes. No lifecycle
hook is treated as installation consent. See [Packaged setup and doctor](setup.md)
for the user entrypoints, root selection, and recovery contract.

## Trust and verification

Every raw MCP tool uses an unprefixed `<domain>_<operation>` name; the MCP host
already adds its server namespace. The server exposes focused tools, including
`toolchain_doctor`, `project_select`, `script_edit`, `engine_field_inspect`,
`engine_field_update`, `web_build`, `web_preview`, `web_preview_close`,
`emulator_step`, `emulator_observe`, `emulator_recording`, and
`emulator_debug`. Do not add a `gbstudio_`
prefix or expose an ambiguous bare `doctor` tool.

The server maintains separate roots and explicit session ownership:

```text
trusted runtime and separately authorized toolchain
    └── immutable authorized workspace / emulator artifact root
        └── explicitly selected native game project
            ├── revisioned compact resource snapshot
            ├── native assets, scenes, scripts, palettes, and dialogue
            └── bounded official build outputs
```

`GB_STUDIO_WORKSPACE_ROOT` authorizes a workspace without selecting a project.
`GB_STUDIO_PROJECT_ROOT` explicitly selects its project and, absent an explicit
workspace, authorizes only that exact project directory. If neither is set, the
session starts unselected. An explicit absolute `project_select` may authorize
only its discovered project root. Alternatively, `project_create` may bootstrap
an absolute new destination under an existing real canonical parent directory;
only the created project is authorized, never its parent. Relative creation
requires prior workspace authorization, and selection remains opt-in.
`project_discover` cannot grant authorization and must not be called first.
For sibling projects, configure their common `GB_STUDIO_WORKSPACE_ROOT` before
startup; create and select calls never expand an existing boundary. Never infer
authority from the plugin cache, runtime checkout, toolchain installation,
user home directory, or starter.

Registration prepares an immutable, content-addressed payload from the npm
package allowlist. Its generated MCP configuration points to validated local
Node, stable runtime, and canonical toolchain paths; dependencies, compilers,
and emulator environments are not copied into the Claude plugin cache. Keep
those runtime/toolchain locations available after installing. A generated local
payload version can differ from the shipped manifest version because its
content identity also includes these machine-specific launch paths.
The local payload receipt binds its canonical runtime root, package release,
and runtime-critical file hashes. Its launcher rejects a changed backing
runtime with preparation/registration guidance instead of combining stale
cached skills with new executable code. Standalone packages without that local
receipt retain the existing launcher path.

Personal registration targets the current user's home/profile. An explicit
workspace marketplace instead uses `<root>/.agents/plugins/marketplace.json`
and `<root>/plugins/modretro-chromatic`. macOS/Linux use a directory symbolic link;
Windows uses a user-level directory junction without requiring administrator
permissions or Developer Mode. Windows personal registration requires explicit
confirmation of the current OS-user profile; preparing a workspace marketplace
does not install anything into another desktop user's Claude profile. Preserve
unrelated entries and never replace a real user-owned directory. See
[Windows setup](windows-setup.md) for the verified-user handoff and installation
checks.

`project_discover` is read-only and never changes selection. Selecting the
bundled starter requires `allowStarter: true`; switching during an active build
returns `PROJECT_BUSY`, and switching during an active emulator session returns
`EMULATOR_ACTIVE` until the caller explicitly closes it. `project_create`
uses exclusive no-clobber creation, clones real editable starter resources
without generated ROMs, and selects the clone only with explicit `select: true`.
Canonical path checks reject escaping symlinks and parent traversal.
Read-only `session_status` reports selected-project/workspace identity, session
generation, and emulator liveness without changing authorization.

Project mutations remain within the selected project and preserve unrelated
authored resources. Root-confined ROM inspection, C-source builds, emulator
sessions and recorded frame artifacts may use the separately authorized
workspace/emulator root, preserving nested-project workflows. Tool annotations
must distinguish read-only inspection, project mutation, emulator-session
mutation, and generated-file creation. Building invokes known tools without
evaluating arbitrary shell input.

Official web exports remain confined to the selected project's generated
`build/` directory. Their integrity-checked source revisions include indexed
authored resources and project-local extensions; a private trusted-toolchain
attestation prevents a project-controlled forged manifest from legitimizing a
modified HTML player. Authenticated unchanged exports can be reused across
server processes without rewriting official player assets. Ordinary warm
requests reuse indexed revisions; explicit `force: true` performs authoritative
refresh and rebuilding.

The preview server binds only to `127.0.0.1` and authorizes requests with a
256-bit secret embedded in its URL. Exact Host/Origin validation, bounded
GET/HEAD-only static responses, canonical path checks, restrictive MIME types,
and symlink defenses prevent unrelated files or unsafe cross-origin access.
The existing server and URL are reused until explicitly closed, project
selection changes, or the MCP server exits. Never substitute custom generated
HTML or describe Binjgb browser gameplay as deterministic PyBoy evidence.

`GB_STUDIO_MCP_PATH_VISIBILITY=workspace-only` optionally removes paths outside
the authorized workspace from MCP responses, including trusted runtime,
toolchain, Python-interpreter, and home-directory locations. Workspace paths
needed to open project resources, ROMs, captures, and same-build artifacts
remain available. This response-only privacy mode does not expand authorization
or change direct in-process build and diagnostics APIs.

`project_inspect` returns a compact revision, identity, selected settings, exact
resource/health totals, and bounded diagnostic samples. `project_inventory`
defaults to normalized separate scene, actor, trigger, palette, asset,
variable, and diagnostic collections; scene references contain IDs rather than
duplicated actor trees. Filters, allowlisted field projections, limits, and
opaque revision-bound cursors keep responses bounded. Changed content or project
selection invalidates cursors with `STALE_CURSOR`; the larger nested
representation requires explicit `layout: "legacy", detail: "full"`.

### Session-owned semantic world index

Each explicitly selected project has one process-local, session-owned semantic
index. The first exact request performs one complete census of authored files;
warm focused reads then use indexed scenes, actors, assets, scripts, variables,
and relationships, with work proportional to the question and observed changes.
An index is disposed when selection changes or the server exits. It never
writes an index database, cache, lock, or marker into an authored project.
`session_status {"includeIndexStats":true}` exposes opt-in bounded index
telemetry without changing workspace authorization.
Counters include `fullInventoryBuilds`, `fullHashPasses`, `authoredFileReads`,
`authoredBytesRead`, cache hits, watcher events, changed paths, and fallback
rebuilds; unchanged focused warm requests must not increment full-inventory,
full-hash, or authored-read counts.

The project revision is a deterministic, versioned `sha256-merkle-v2` digest
represented by the same 64 hexadecimal characters as earlier revisions.
Previously issued revision tokens and inventory cursors become stale once when
upgrading from the former whole-content digest. Individual resource revisions
remain SHA-256 over their exact authored bytes. The public project-revision
domain remains the selected descriptor plus `project/**` and `assets/**`; it
does not silently include root-level build outputs, artifacts, cartridges, or
project-local plugins. Relevant plugin-owned resources and event handlers also
advance a separate semantic generation, so semantic-query cursors invalidate
when either public or plugin gameplay meaning changes.

Server mutations update the selected index synchronously and support immediate
read-your-own-writes. A bounded filesystem watcher eventually observes external
editor changes; warm reads cannot prove that a concurrent notification has
already arrived. Read-only `project_refresh {"mode":"strong"}` and globally
sensitive destructive reverse-reference checks perform authoritative
whole-project verification when that stronger guarantee is required; strong
refresh is intentionally expensive and inappropriate after every mutation.

Two relationship graphs deliberately answer different questions. The effective
runtime graph follows executable gameplay and ignores commented-out events;
the structural preservation graph conservatively retains authored references,
including opaque/custom event fields, for safe deletion and preservation.
`world_dependencies` reports bounded relationship evidence.
Dependency queries accept a typed `{type,id}` node, bounded direction/depth,
relationship filters, scene scope, limits, and an opaque cursor. This generic
resource graph preserves project-defined events without assuming any particular
game mechanic. Relationship results describe static authored references, not
runtime emulator evidence. Semantic cursors bind the query to project revision,
selection generation, and semantic generation.

Custom JavaScript events require a maintained, byte-bound dependency review;
project declarations cannot grant complete coverage. See
[Reviewed custom-event dependencies](reviewed-custom-events.md) for the resolver,
extractor, invalidation and conservative deletion contract.
Wrecklight's revision-specific data lives in [`src/wrecklight/profiles/`](https://github.com/OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex/blob/main/src/wrecklight/profiles/README.md);
`src/wrecklight-dependencies.ts` retains the resolver and its existing exports.

Native PNG import generates actual native game background or sprite metadata,
retains native animation/state IDs, and never reads outside the selected project
or overwrites existing resources. Typed actors, triggers, nested script edits,
variables, transitions, collisions, palettes, and scene operations validate the
merged resource state while preserving IDs, unknown fields, and unrelated
scripts. Scene collision grids and background `tileColors` use their native
hexadecimal byte-run encoding, not guessed base64.

`engine_field_inspect` and `engine_field_update` operate on native game
engine-field overrides without requiring a particular genre or controller.
Updates preserve unknown resource fields, support optional resource-revision
preconditions, validate bounded identifiers and values, and retain numeric
checkbox representations used by the engine.

`scene_apply` coordinates 1–100 ordered operations under one project mutation
lock with an optional dry run and expected revision. It validates the complete
result before committing and supports references to resources created earlier
in the same batch. Legacy single-file changes are atomic. Distributed project
files commit in deterministic order with byte-preserving best-effort rollback
on recoverable failures; this is explicitly **not** atomic across files.
Unexpected external changes during rollback raise
`TRANSACTION_RECOVERY_CONFLICT` instead of replacing user-authored content.

Hardware claims require three distinct checks:

1. Analyze the actual authored pixels, tiles, palettes, and scene budgets.
2. Compile and inspect a genuine ROM header, target mode, and cartridge data.
3. Boot the ROM in an emulator, advance real frames, inject controller input,
   and inspect genuine sampled frames or other target-side state.

Graphics analysis returns exact issue totals and bounded representative samples;
truncated diagnostics do not mean unreported coordinates or violations are valid.
Fixed-shade tile identities remain distinct even when palette-independent
normalized patterns happen to match. Scene analysis distinguishes configured
palette slots from genuinely consumed tile assignments, scene engine budgets
from hardware limits, and authored static OAM estimates from live emulator OAM.
Project-global palette resources are not limited to eight; each running scene
has separate eight-slot background and object palette tables. The configured UI
palette slot is protected unless a supported assignment explicitly opts in.

Dialogue analysis resolves the project's actual selected font, recursively
inspects native `EVENT_TEXT` dialogue events, preserves existing authored page
boundaries, and reports bounded fit diagnostics. `actor_create` and
`dialogue_update` preserve requested text/pages by default and return at most
eight `fitWarnings` plus a compact selected-font `dialogueFit` result. Explicit
`validation: "reject"` prevents all writes on `DIALOGUE_OVERFLOW`; font-aware
word wrapping or pagination transforms text only when explicitly requested and
preserves authored page boundaries plus unrelated event metadata. Project-defined
custom event commands remain opaque; regular script editing preserves their
identities and arguments without assuming an extension-specific text layout. An
invalid `settings_update.defaultFontId` fails with `FONT_NOT_FOUND` before any
settings write. Font metrics and conservative layout bounds are static
estimates; interpolation tokens and exact runtime dialogue/window behavior may
remain unverified.

`dialogue_preview`, `graphics_preview_scene`, `sprite_preview`, and
`sprite_contact_sheet` create explicitly labeled static authored-source
projections. They are not actual emulator frames, do not prove runtime layout or
gameplay, and must never be passed off as genuine emulator evidence.

`emulator_step` is the public gameplay mutation: it accepts a complete
held-button set and 1–3,600 frames, applies only changed input edges, and returns
up to eight real samples across positive offsets through the endpoint. The
same held set persists between calls. `emulator_observe` returns the current
genuine 160 × 144 PNG with zero frame, input, or recording-journal mutation.
Both tools can omit inline images without changing their other semantics.

`emulator_run` reuses an existing session for the same canonical ROM and
unchanged bytes, preserving its frame and buttons. Explicit `restart:true`,
changed bytes, or a different hardware mode boot fresh. Every boot uses an
isolated cartridge source without reading or overwriting adjacent saves/RTC
files. Worker exits and request failures clear authoritative session liveness.
The worker and diagnostic probes use an explicitly selected isolated Python
interpreter, trusted working directory, and sanitized environment. Healthy
optional-runtime setup is reused without invoking uv again.

The worker owns input delivery and exact frame advancement. It has no
autonomous paced clock or background pumping. `executionWallTimeMs` tracks
native execution work, and recording `maxWallTimeMs` excludes idle time between
calls. Game time follows native frames. Host execution rate is not a cartridge
CPU-cycle performance claim.

Recording is opt-in on `emulator_run`, with bounded ticks, execution time,
bytes, retained frames, checkpoints, and derived clips. Unique no-clobber
directories preserve original attempts and failures. Checkpoints require a
neutral delivered frame and exact ROM, CGB mode, PyBoy version, protocol, and
worker hash. Restore creates a preserved branch. A plugin update can change
worker identity without changing the ROM; archive readability does not imply
checkpoint compatibility.

Recording stop finalizes history. `emulator_close` cancels outstanding
emulator work and waits for cleanup without deleting evidence. Schema-v1
recording status/export, read-only interval review, and clip extraction remain
available after close or a server restart. Review authenticates retained input
and sampled-image evidence while explicitly reporting missing coverage;
integrity does not establish gameplay success.

Every recording directory owns ignore-all Git/npm markers, including custom
output locations. Derived GIFs stay inside the recording or the authorized
workspace's top-level `artifacts/` subtree. These safeguards do not replace
reviewing evidence before sharing it. Host-clock RTC cartridges cannot promise
deterministic results across repeated runs.

The public surface has one direct stepped path and no legacy input/capture
aliases, automatic recipe runner, or model/provider dependency. Existing
low-level regression coverage is development-only. See
[Stepped playtesting](stepped-playtesting.md) for the migration and
[recordings and checkpoints](recorded-playtesting.md) for archive limits.

`emulator_inspect` exposes bounded, read-only target-side observations: at most
40 actual OAM entries or at most 256 bytes from an allowlisted VRAM, WRAM, OAM,
or HRAM region with validated bank selection. It cannot read cartridge ROM,
boot ROM, host memory/files, arbitrary I/O, or write emulated memory. High-level
game-state views are not inferred in ROM-only mode; authored global variable
names do not imply verified runtime memory addresses. The separate
`emulator_debug` capability requires explicit source mode, a paused emulator,
and authenticated artifacts from a successful official build in the same MCP
session. It validates exact cartridge bytes, artifact hashes, supported engine
layout, source fingerprint, and unchanged project plugins before exposing named
variables or the current scene. Authored collision and event links are bounded
source context, not a claim of current virtual-machine event execution.

Stepped samples provide evidence for the exact animation, movement, facing,
interactions, collisions, palette contrast, and accessibility states exercised.
They do not prove untested gameplay, behavior between samples, audio, save/load,
physical hardware compatibility, or cartridge CPU-cycle performance.

Host-emulator frames per second are not Game Boy CPU-cycle measurements. GB
Studio scene budgets are engine policies; they must not be confused with the
underlying hardware limits.

Official GB Studio builds preserve exact stderr, process status, and artifact
validation while returning additive classified `warnings`. Only the exact
official-CLI `DEP0190` record receives the known deprecation classification;
unrelated warning text, GBDK subprocesses, failed compilers, missing outputs,
and invalid cartridges retain their original failure or diagnostic semantics.

`rom_build {"projectPath":"<selected-project.gbsproj>",
"captureDebugArtifacts":true}` can explicitly preserve the linker `symbols.noi`
and compiler `globals.i` from the same successful official project build. Their
SHA-256 digests and the matching ROM digest are returned together; missing,
malformed, ambiguous, or mismatched evidence is never silently replaced with
artifacts from another build. Direct C-source compiler probes cannot request
these project-build artifacts. Capturing symbols alone does not enable source
debugging: the caller must explicitly choose source mode for the matching ROM.
Missing, unused, ambiguous, optimized-out, or unsupported source data remains
unavailable rather than being reconstructed from guessed addresses.

Validation uses a neutral native starter, official project compilation,
verified cartridge headers, genuine emulator frames, and bounded controller
input. Source-preservation snapshots keep generated artifacts separate from
existing authored project resources and tracked cartridges. See
`docs/runtime-validation.md` for the complete evidence contract.

## Primary references

- GB Studio: https://www.gbstudio.dev/docs/
- native game project plugins: https://www.gbstudio.dev/docs/extending-gbstudio/plugins/
- GB Studio source and CLI: https://github.com/chrismaltby/gb-studio
- Pan Docs: https://gbdev.io/pandocs/
- GBDK: https://gbdk.org/docs/api/
- PyBoy: https://docs.pyboy.dk/
- OpenAI plugin architecture: https://developers.openai.com/plugins/concepts/plugins
