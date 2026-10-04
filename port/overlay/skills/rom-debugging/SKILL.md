---
name: rom-debugging
description: Build, inspect, and debug Game Boy or Game Boy Color ROMs for ModRetro Chromatic - GB Studio or GBDK build failures, browser previews, direct PyBoy emulator playtesting with real frames, and source or cartridge diagnostics.
---

# ModRetro Chromatic ROM debugging

Work from the user's actual cartridge and project. Select the intended project
explicitly; an unconfigured `project_select` needs its absolute `.gbsproj` path,
and `project_create` leaves it unselected unless called with `select:true`.
Never fall back to the bundled starter. See the
[project selection rules](../../docs/agent-guide.md#start-and-select-the-intended-project).
If compiler or PyBoy availability is uncertain, use `toolchain_doctor`; report
unavailable checks rather than substituting a sample ROM. Use authorized ROMs
and output roots; preserve existing user saves and evidence.

If MCP cannot start or dependencies are missing, use the
[setup skill](../setup/SKILL.md). Select `build` and/or `emulator` components
for the requested checks; ROM inspection alone needs neither.

## Browser previews

Open every `web_preview` or `device_capture` URL, including screenshot Open
links, in **the host's built-in browser**. In the Claude Code desktop app that
is the Browser pane (open the URL with its `preview_start`/`navigate` tool). If
no built-in browser exists (Claude Code in a terminal), give the user the exact
URL to open in their own browser; never post it anywhere else, and do not launch
a browser from the shell unless the user asks. If the browser is blocked, retain
the URL and report the concrete limitation.

If the browser is unavailable, retain its state and continue gameplay with the
PyBoy loop below on the intended exact ROM; browser access is not a
prerequisite. Keep browser UI and physical-device checks separate. See
[headless fallback](../../docs/stepped-playtesting.md#when-browser-play-is-unavailable).

Reuse the active preview URL or emulator/capture session for the same task.
When temporary testing is complete, close only the session this task owns with
`web_preview_close`, `emulator_close` or `device_capture {"action":"close"}`.
Preserve user play (including paused games), ongoing recordings and unresolved
saves or commands. Never scan processes, kill by name, claim an unfamiliar port,
or clean up another task's session. An unknown action is not safe to replay.

### A preview URL refuses the connection

Preview URLs belong to the MCP process that opened them. A plugin update, `/mcp`
reconnect, restart or new Claude Code session can leave an old browser tab
pointing at a closed server. Inspect `web_preview {"action":"status"}` before
reusing a URL; a connection-refused page alone is not evidence of browser
policy, a missing emulator or a driver problem. If there is no live preview,
select the user's original project and call `web_preview {"action":"recover"}`
to reopen its verified export without compiling; if no unchanged export exists,
use `web_preview {}` and open the newly returned URL. Do not invent the port,
reuse a historical URL, or rebuild with `force:true` just to reopen a server.

## Build and choose the right evidence

- Build with `rom_build` and inspect the returned cartridge with `rom_inspect`.
  Preserve compiler stderr and exit status on failures. A classified official-CLI
  `DEP0190` is a known deprecation; a failed process, missing/invalid ROM or
  mismatched artifact is not a successful build. A GBDK `sourcePath` probe proves
  only that its C source compiled.
- For direct model playtesting, use the PyBoy `emulator_*` tools. Choose each
  bounded input, **look at the returned frames**, and decide what to do next; the
  emulator stays paused between calls.
- For interactive human play, `web_preview {}` opens or reuses the official
  Binjgb browser export. See [browser playback](references/emulation-and-regression.md#official-browser-play)
  and [saved progress](../../docs/agent-guide.md#saved-progress). A browser
  export, a native `rom_build`, PyBoy and physical hardware each establish
  different facts. For physical Chromatic play or flashing, use the
  [deployment skill](../deployment/SKILL.md).

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
frames. The set persists; `[]` releases all buttons but still advances frames.
`emulator_observe {}` reads the genuine 160 × 144 framebuffer without advancing.
Use short steps near uncertain timings and consecutive samples for flicker; a
sampled frame proves nothing about gaps. If images fail, check `execution`
separately from `imageDelivery`; do not repeat an input to recover evidence. See
[stepped playtesting](../../docs/stepped-playtesting.md).

Preserve the first failure and its inputs. After a source fix, rebuild and repeat
the relevant button sets and frame counts from comparable starting conditions.
An unchanged ROM reuses its session; use `restart:true` for a fresh boot and
`emulator_close {}` before selecting another project. Enable `recording:{}` on a
fresh boot when the input history matters; see
[recordings and checkpoints](../../docs/recorded-playtesting.md). `emulator_clip`
can export a GIF of retained frames to show the user.

## Diagnose and report

For named variables, the current scene or authored collision/event references,
build with `captureDebugArtifacts:true`, start that exact ROM with
`debugMode:"source"`, and call `emulator_debug` while paused. For bounded
OAM/VRAM/WRAM/HRAM inspection use `emulator_inspect`. See
[hardware and source diagnostics](references/emulation-and-regression.md#bounded-hardware-and-source-diagnostics)
and [cartridge headers and common failures](references/hardware-and-cartridge.md).

Distinguish authored source, static previews, a compiled cartridge and actually
observed runtime frames. Sampled images and host throughput prove nothing about
audio, saves, physical hardware or cartridge CPU-cycle performance. Report what
ran, what the frames showed and what remains unverified.
