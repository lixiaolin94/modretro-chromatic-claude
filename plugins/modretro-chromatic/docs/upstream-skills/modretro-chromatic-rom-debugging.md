---
name: modretro-chromatic-rom-debugging
description: Build, inspect, and debug Game Boy or Game Boy Color ROMs. Use for native project or GBDK build failures, browser previews, direct emulator playtesting, and source or cartridge diagnostics.
---

# ModRetro Chromatic ROM debugging

Work from the user's actual cartridge and project. Select the intended project
explicitly; an unconfigured `project_select` needs its absolute `.gbsproj` path,
and `project_create` leaves it unselected unless called with `select:true`.
Never fall back to the bundled starter. See the [project selection rules](../../docs/agent-guide.md#start-and-select-the-intended-project)
when no authorized project or workspace is selected. If compiler or optional
PyBoy availability is uncertain, use `toolchain_doctor`; report unavailable
checks rather than substituting a sample ROM or silently installing a runtime.
Use authorized ROMs and output roots; preserve existing user saves and evidence.

If MCP cannot start or dependencies are missing, use the [setup skill](../modretro-chromatic-setup/SKILL.md).
Select build and/or emulator components for the requested checks; ROM inspection
alone needs only the runtime.

## Browser previews

Open every `web_preview` or `device_capture` URL, including screenshot Open links, only in **Codex's built-in browser**. If it is unavailable or blocked, retain the URL and report the concrete limitation. Never launch or fall back to an external browser.

If the browser is unavailable, locked or unreachable, retain its state and
continue gameplay with the public PyBoy loop below on the intended exact ROM;
browser access is not a prerequisite. Use the setup skill's `emulator` component
if needed. Keep browser UI/annotation and physical-device/capture checks
separate. See [headless fallback](../../docs/stepped-playtesting.md#when-browser-play-is-unavailable)
for retained evidence and scoped failures.

Reuse the active preview URL or emulator/capture session for the same task. When temporary testing is complete, close only the session this task owns with `web_preview_close`, `emulator_close`, or `device_capture {"action":"close"}`. Preserve user play (including paused games), ongoing recordings, and unresolved saves or commands; inspect status and retain recovery evidence before closing. Never scan processes, kill by name, claim an unfamiliar port, or clean up another task's session. An unknown action is not safe to replay.

### A preview URL refuses the connection

Preview URLs belong to the MCP process that opened them. A plugin update,
restart, or fresh chat can leave an old browser tab pointing at a closed server.
On every platform, including Windows, inspect `web_preview {"action":"status"}`
in the owning session before reusing a URL. A connection-refused page alone is
not evidence of browser policy, a missing emulator, or a device-driver problem.

If there is no live preview in the current session, select the user's original
project and call `web_preview {"action":"recover"}` to reopen its verified export without compiling. If no unchanged export exists, use `web_preview {}` to build and open it, then open the
newly returned URL. Do not invent the port, reuse a historical URL, or rebuild
with `force:true` just to reopen a server. Preserve any unresolved recording or
save from the old owner; opening a new preview does not recover unsaved state.
If a live listener is reported but the browser still fails, retain the exact
error and inspect the current owner; do not reset security settings or loop on
reload. An explicit access refusal must not be bypassed through another caller.

## Build and choose the right evidence

- Build the selected project with `rom_build` and inspect its returned cartridge
  with `rom_inspect`. Preserve compiler stderr and exit status on failures. A
  classified official-CLI `DEP0190` is a known deprecation; a failed process,
  missing/invalid ROM, or mismatched artifact is not a successful build. A GBDK
  `sourcePath` probe proves only its C source compiled.
- For direct model playtesting, use the optional PyBoy `emulator_*` tools. The
  model making the change should choose each bounded input, inspect the actual
  returned frames, and decide what to do next; the emulator stays paused between
  calls.
- For interactive human play or annotation, `web_preview {}` opens or reuses the
  selected project's official Binjgb browser export. [Browser playback](references/emulation-and-regression.md#official-browser-play),
  [saved progress](../../docs/agent-guide.md#saved-progress), and
  [frame annotation](../../docs/agent-guide.md#annotate-a-game-preview) cover
  those modes. A browser export, a native `rom_build`, PyBoy, and physical
  hardware each establish different facts. For physical Chromatic play or
  flashing, use [Chromatic deployment](../chromatic-deployment/SKILL.md).

## Direct play and regression checks

Example: hold right, add A for two frames, then release every button:

```text
emulator_run {"romPath":"<absolute ROM outputPath returned by the build>","restart":true,"initialFrames":120}
emulator_observe {}
emulator_step {"buttons":["right"],"frames":12,"sampleCount":4}
emulator_step {"buttons":["right","a"],"frames":2,"sampleCount":2}
emulator_step {"buttons":[],"frames":1,"sampleCount":1}
```

Every step supplies the **complete held-button set** and advances 1–3,600
frames. The set persists: repeated buttons stay held without a new press; `[]`
releases all buttons but still advances frames. `emulator_observe {}` is inert:
it reads the genuine 160 × 144 framebuffer without advancing frames, delivering
input, or changing a recording. Use short steps near uncertain timings and
consecutive samples for flicker; a sampled frame proves nothing about gaps.

If images fail, check `execution` separately from `imageDelivery`. The input may
have advanced even if no image arrived or transport left execution unknown. Do
not repeat it to recover evidence; use inert observation or `emulator_review`
of a retained interval. See [stepped playtesting](../../docs/stepped-playtesting.md)
for execution status, contact sheets, cancellation, and cleanup.

Preserve the first failure and its inputs. After a source fix, build the new
cartridge and repeat the relevant button sets and frame counts from comparable
starting conditions; inspect behavior separately from animation/hash changes.
An unchanged ROM reuses its session; use `restart:true` for an intentional fresh
boot and `emulator_close {}` before selecting another project. Enable
`recording:{}` on a fresh boot when the input history matters. For branching an
existing attempt, see [recordings and checkpoints](../../docs/recorded-playtesting.md):
first send a neutral frame, and restore only into the identical ROM and runtime,
including the worker hash. A checkpoint from before a rebuild cannot be used for
the regression run.

## Diagnose and report

For named variables, the current scene, or authored collision/event references,
build with `captureDebugArtifacts:true`, start that exact ROM with
`debugMode:"source"`, and call `emulator_debug` while paused. It requires
authenticated same-build artifacts and unchanged source; unsupported or
optimized-out data stays unavailable. For bounded OAM/VRAM/WRAM/HRAM inspection,
use `emulator_inspect`. See [hardware and source diagnostics](references/emulation-and-regression.md#bounded-hardware-and-source-diagnostics)
or [cartridge headers, hardware limits, and common failures](references/hardware-and-cartridge.md).

Distinguish authored source, typechecks or generated imagery, static dialogue or
art previews, a compiled native cartridge, and actual observed runtime frames.
Neither sampled images nor host-side throughput prove audio, saves, physical
hardware behavior, or cartridge CPU-cycle performance. Report what ran, what
the frames showed, and what remains unverified. For host-specific setup, see
[Windows setup](../../docs/windows-setup.md); Windows x64 is experimental and
other-platform results do not validate it.
