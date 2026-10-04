# Runtime validation

Verify the [ModRetro Chromatic plugin](../README.md) against a real
native game project. Each layer establishes a different fact: TypeScript
checks validate plugin
source; project inspection validates editable resources; official compilation
produces an authentic cartridge; an official browser export provides a genuine
interactive Binjgb player; and PyBoy frames establish observed deterministic
runtime behavior. None substitutes for another.

Windows x64 support remains experimental. Portable tests or validation performed
on macOS/Linux do not establish that a Windows installation, native compiler,
local plugin registration, authenticated preview, NTFS path boundaries, or PyBoy
worker actually runs. Windows ARM64 is unsupported. Execute the complete
equivalent workflow on a real Windows host before claiming Windows end-to-end
compatibility.

## Prepare a neutral project

The bundled `examples/starter/project.gbsproj` is a minimal native game
project with one `Start` scene, valid editable resources, and no prescribed
gameplay, custom event, story, or genre-specific mechanic. Preserve this
starter and use `project_create` for a disposable editable clone.

An unconfigured MCP session starts with no project or authorized workspace.
For an existing project, `project_select` must use its absolute descriptor path:

```text
session_status {}
project_select {"projectPath":"/absolute/path/to/MyGame/project.gbsproj"}
project_inspect {}
project_inventory {"resourceTypes":["scene","actor","asset"],"detail":"standard"}
```

For a new project, `project_create` can bootstrap from an absolute new
destination under an existing real canonical parent directory. Only the
created project is authorized; selection still requires `select: true` or a
later explicit `project_select`.

For sibling projects, configure `GB_STUDIO_WORKSPACE_ROOT` before server
startup; creation, discovery, and selection can then use paths relative to
that fixed boundary. An existing authorization is never expanded by a create
or select call; relative creation cannot bootstrap an unconfigured session.
`project_discover` never grants authorization. Access remains confined after
resolving symlinks, and the bundled starter additionally requires
`allowStarter: true` for direct selection.

## Check setup and compile a real ROM

The npm commands below are for maintainers in a trusted development checkout
with its locked dependencies installed. Do not run them inside an installed
plugin cache. Packaged users should follow [setup](setup.md), then use
`toolchain_doctor` and `rom_build` in their selected project.

```sh
npm run check
npm test
npm run build
npm run doctor
npm run test:native-project
```

For experimental Windows x64, follow [Windows setup](windows-setup.md), then
prepare the native runtime from PowerShell without Git Bash or WSL:

```powershell
npm.cmd run setup:windows -- --dry-run
npm.cmd run setup:windows
npm.cmd run doctor
```

Verify that the diagnosed GBDK compiler is `lcc.exe`, the optional PyBoy
interpreter is `.local/pyboy-venv/Scripts/python.exe`, the intended desktop
application is detected only when installed, and Windows project paths remain
inside their explicitly authorized drive-qualified roots. Separately opt into a
workspace marketplace and run the emitted installation commands as the intended
desktop user. Verify its marketplace root, effective local payload version,
installed MCP launcher, and actual tool calls; payload preparation alone is not
installation. Prefer a short `C:` location without spaces. Record these checks
as unverified until they run on actual Windows.

`toolchain_doctor {}` reports compatible metadata and task readiness for the
selected CLI, GBDK, and optional emulator. It does not execute them unless named
probes are requested, and no probe establishes a game build or boot.
Headless project compilation does not require a desktop editor.
A standalone GBDK C build verifies that C compiler only; use the official GB
Studio CLI to establish that a native `.gbsproj` compiles.
Use the build's returned absolute `outputPath` in later ROM/emulator calls and
retain returned recording paths. A configured authorized workspace may
be above the selected project: relative build output paths are project-relative,
whereas ROM inspection and emulator paths are workspace-relative. The
short paths below assume those roots are the same.

```text
rom_build {"outputPath":"build/game.gbc","captureDebugArtifacts":true}
rom_inspect {"romPath":"build/game.gbc"}
```

Accept the build only when the compiler succeeds, the cartridge exists, and its
Nintendo logo, header checksum, mapper, and declared compatibility are valid.
When debug capture is requested, `symbols.noi` and `globals.i` must come from
the same build and include matching SHA-256 evidence for both files and the
exact ROM. Compilation warnings remain visible; a failed process, malformed
ROM, or missing authenticated artifact is not a success.

## Validate the official browser preview

```text
web_preview {"outputPath":"build/browser-preview"}
web_preview {"outputPath":"build/browser-preview"}
web_preview_close {}
```

The first call must return the real official `make:web` export with Binjgb
JavaScript/WebAssembly, its selected-project cartridge, and a secret-bearing
loopback URL. Verify the actual HTML, CSS, JavaScript, WebAssembly, and ROM over
HTTP; malformed tokens or foreign Host headers must be rejected. The unchanged
second call must reuse the same URL and authenticated export without rewriting
its assets. An authored source change rebuilds the export while preserving the
active URL; closing the preview invalidates that URL. Browser play uses Binjgb,
not PyBoy, and is distinct from a dedicated native ROM build.

## Validate stepped gameplay through the packaged MCP interface

Run [Stepped playtesting](stepped-playtesting.md) through the freshly built,
packaged MCP launcher, not only imported classes or mocked workers. Installing
or replacing a user's local plugin is a separate action; an existing installed
version is not evidence for new source.

Use an owned/homebrew fixture with observable controller behavior and an
ordinary native game project. Preserve the first failing attempt, make a
small source fix, build a new cartridge, and have the editing model repeat the
relevant explicit steps from the same starting condition.

```text
emulator_run {"romPath":"<returned ROM outputPath>","initialFrames":120,"recording":{}}
emulator_observe {}
emulator_step {"buttons":["right","a"],"frames":12,"sampleCount":4}
emulator_step {"buttons":["right","a"],"frames":8,"sampleCount":4}
emulator_step {"buttons":[],"frames":1,"sampleCount":1}
emulator_inspect {"view":"oam","visibleOnly":true,"limit":40}
emulator_close {}
```

Verify the actual discovered surface and old-to-new migration. There must be
no callable aliases for the removed tools, and the maintained examples and
development smoke callers must use the new step/observe contract. Keep useful
low-level regression tests without advertising a second playing API.

Check exact held-button transitions, simultaneous holds, release by omission,
and consecutive calls with the same set. Use game-side observations to confirm
delivery rather than trusting only worker bookkeeping. Frame advancement must
equal the requested count. Samples must come from the advertised positive
offsets, include the endpoint, and carry genuine 160 × 144 PNGs. Test one-frame
steps, fewer frames than requested samples, bounds, invalid input, and
`includeImages:false` without changing gameplay or sampling.

Between calls, waiting must not advance the game. Repeated observation must
preserve frame, buttons, and recording bytes. Verify both recorded and
unrecorded boots leave existing battery-save/RTC files unchanged. An unchanged
run must reuse frame/input state; changed ROM bytes must start fresh.
Static art, dialogue, and scene previews are not emulator evidence.

Exercise close during outstanding work, request timeout, worker exit, invalid
requests, and recording frame/byte/execution-time limits. Check idle time does
not consume the execution-time allowance. Failed attempts must remain available,
and close must wait for process cleanup. A successful tool response does not
establish an untested gameplay outcome.

Fail image delivery after confirmed input and check that execution metadata and
any recorded span survive. Do not retry a step to repair its images. Recover
through inert observation or archive review. Distinguish known partial work,
pre-execution rejection, and unknown transport execution; unknown is not zero.

Save and restore a same-ROM checkpoint after a neutral frame; confirm the
original attempt survives branching. Reject changed ROM bytes and incompatible
worker/runtime identity. Review a returned recording span, append later steps,
and review the earlier pin again. Check exact identities, missing endpoints,
imported physical-event gaps, image integrity, refusal without journal changes,
and post-close archive reads. Exercise clip bounds and no-clobber output paths.
Use schema-v1 fixtures to check archived reads without relaxing checkpoint
identity or introducing a public recipe runner.

Hardware inspection must remain limited to 40 OAM entries or 256 bytes from
allowlisted VRAM, WRAM, OAM, and HRAM regions. It must not expose cartridge/boot
ROM, arbitrary I/O, host files/memory, or target writes. For source diagnostics,
build with `captureDebugArtifacts:true`, start that exact ROM in source mode,
and compare named values and resource links with the authored project. Reject
stale artifacts and unchanged-ROM sessions whose source changed; high-level
diagnostics must stay unavailable in ROM-only mode.

Preserve compiler failures, stderr, and cancellation diagnostics. Use
`compilerStderr ?? stderr` for the byte-exact compiler stream. Cancel a real
official build through its MCP request and check descendant-process cleanup
alongside `cancelled:true` / `BUILD_CANCELLED`; report any cleanup warning
rather than claiming an unconfirmed process exit.

The normal test suite can skip unavailable native prerequisites or compiled
launcher checks. Build first, then explicitly require the authentic suite:

```sh
GB_STUDIO_AUTHENTIC_MCP_ENTRYPOINT=compiled GB_STUDIO_REQUIRE_AUTHENTIC_INTEGRATION=1 node --import tsx --test --test-concurrency=1 tests/authentic-project-runtime.test.ts tests/recorded-mcp-runtime.test.ts
```

Configure the intended toolchain/interpreter through documented environment
variables when they live outside this checkout. The command above is POSIX shell
syntax, not evidence of native Windows execution; use the equivalent environment
configuration on the actual target host.

Record OS/architecture, dependency versions, packaged launcher identity, tool
calls, before/after ROMs, observed functional results, and remaining gaps.
A passing source test, successful build, or completed route does not establish
game quality or acceptance on another platform.

## Preserve user resources

Record a before-and-after snapshot of authored project descriptors, resources,
assets, extension files, and existing cartridges. Build output and screenshots
must stay inside authorized generated-output directories and must never replace
an existing tracked ROM without explicit authorization.

The session-owned resource index remains in memory and never writes a project
database or cache. Verify efficient repeated authoring with:

```text
session_status {"includeIndexStats":true}
world_dependencies {"node":{"type":"variable","id":"0"},"direction":"incoming","depth":2,"limit":25}
engine_field_inspect {"limit":25}
```

After the initial authored-resource census, focused warm inspection should not
require repeated whole-project inventories or full hash passes. The dependency
graph preserves opaque extension-defined script events while distinguishing
effective runtime references from conservative structural preservation edges.
Use `project_refresh {"mode":"strong"}` only when an authoritative complete
verification is actually required.

Set `GB_STUDIO_MCP_PATH_VISIBILITY=workspace-only` when MCP responses must hide
trusted runtime, toolchain, Python, and unrelated host paths while preserving
usable authorized project, cartridge, and capture paths.

## Report evidence precisely

Report which project was inspected, whether its authentic official build
succeeded, which emulator inputs and frame numbers were observed, and whether
authored resources were preserved. Clearly identify unavailable optional
tooling. A passing test double, static PNG, unrelated sample cartridge, or
compiler probe must never be presented as evidence that another project was
built or played.
