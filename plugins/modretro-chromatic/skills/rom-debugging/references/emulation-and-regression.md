# Stepped emulation and gameplay checks

## Runtime availability

PyBoy is an optional, separately installed LGPL Python runtime. The plugin
discovers toolchain-local `.local/pyboy-venv/bin/python` on macOS/Linux,
`.local/pyboy-venv/Scripts/python.exe` on experimental Windows x64, or the
interpreter explicitly configured with `GB_STUDIO_PYTHON`.

Headless play of an existing ROM needs the `runtime,emulator` components;
building a ROM also needs `build` for the official GB Studio CLI and GBDK. Linux
needs no macOS application bundle or graphical desktop. `toolchain_doctor` reports compatible
metadata by default; it does not launch Python or a game. An explicitly selected
`emulator-import` probe checks isolated PyBoy/Pillow imports and reports its
result separately. Neither a successful generic compiler check nor an import
probe proves that the user's ROM has run.

If the emulator is missing or unhealthy, follow the [setup skill](../../modretro-chromatic-setup/SKILL.md)
and [Packaged setup](../../../docs/setup.md) or
[Windows setup](../../../docs/windows-setup.md): use the bundled entrypoint
directly and review a plan for an external owned root. Use existing task
authorization for necessary setup; ask only for missing scope or required
platform approval before `apply --yes`. If setup remains unavailable, report
that gameplay and real-frame observation did not run. The `emulator` group prepares isolated managed Python,
PyBoy, and Pillow and reuses healthy tools. Do not run npm in the immutable
payload, modify global Python, repair an active shared runtime, or rerun setup
for every session. A prepared future payload needs a separate authorized
activation handoff. Use only authorized homebrew or licensed ROMs, never
proprietary boot ROMs.

## Official browser play

```text
web_preview {}
web_build {"outputPath":"build/browser-preview"}
web_preview {"outputPath":"build/browser-preview"}
web_preview_close {}
```

Open every `web_preview` or `device_capture` URL, including screenshot Open links, in **the host's built-in browser**. In the Claude Code desktop app that is the Browser pane (open the URL with its `preview_start`/`navigate` tool). If no built-in browser exists (for example Claude Code in a terminal), give the user the exact URL to open in their own browser; never post it anywhere else, and do not launch a browser from the shell unless the user asks. If the browser is blocked, retain the URL and report the concrete limitation.

For an unavailable, locked or unreachable browser, continue the separate
[headless gameplay workflow](../../../docs/stepped-playtesting.md#when-browser-play-is-unavailable).

After a confirmed close, the same plugin instance tries its last port again and uses another free port if it is occupied. The reopened view always gets a new private URL; old links are invalid. This does not discover, adopt, or stop other listeners.

Reuse the active preview URL or emulator/capture session for the same task. When temporary testing is complete, close only the session this task owns with `web_preview_close`, `emulator_close`, or `device_capture {"action":"close"}`. Preserve user play (including paused games), ongoing recordings, and unresolved saves or commands; inspect status and retain recovery evidence before closing. Never scan processes, kill by name, claim an unfamiliar port, or clean up another task's session. An unknown action is not safe to replay.

The official `make:web` export contains GB Studio's Binjgb/WebAssembly player
and actual cartridge, including its keyboard, gamepad, touch, and audio
behavior. Do not replace its HTML, build a second browser player, or add an
ad hoc server.

The URL binds to loopback and contains a private capability. An authenticated
unchanged export is reused across server sessions; an active session also
reuses its listener and URL. Indexed source/plugin changes refresh the export
without changing that URL. Use `force:true` only for an intentional
authoritative rebuild. Closing stops the server without deleting the export.

Browser observations do not establish PyBoy behavior, a dedicated native ROM
build, or physical-hardware compatibility.

## Direct steps and observations

Follow [stepped playtesting](../../../docs/stepped-playtesting.md) for the
canonical tool contract and native edit/build/retest loop. Pass the absolute
ROM path returned by the build: build outputs are project-relative, while ROM
and recording paths resolve from the authorized workspace.

```text
emulator_run {"romPath":"<returned ROM outputPath>","cgb":true,"initialFrames":120}
emulator_observe {}
emulator_step {"buttons":["right","a"],"frames":12,"sampleCount":4}
emulator_step {"buttons":["right"],"frames":8,"sampleCount":4}
emulator_step {"buttons":[],"frames":1,"sampleCount":1}
```

The first step holds right and A. The second releases only A; right stays held
without another press edge. The last step releases all buttons. Frame counts
are explicit, positive, and bounded to 3,600 per call. A step returns up to eight
evenly spaced genuine samples including its endpoint, four by default.

Observe has zero frame, input, and recording-journal mutation. `includeImages`
controls only inline image delivery on step or observe. Read the actual images
before describing visual content; hashes alone do not establish behavior.
For flicker, sample consecutive frames rather than widely spaced states.

An unchanged `emulator_run` reuses its current frame and buttons without
repeating `initialFrames`. Use `restart:true` for an intentional reboot;
changed cartridge bytes or hardware mode boot fresh. Both recorded and
unrecorded boots ignore adjacent battery-save/RTC files. Close before changing
projects, and use `emulator_close {}` to stop or cancel work.

There is no autonomous emulator clock. Thinking between calls advances zero frames.
Recording `maxWallTimeMs` counts emulator execution, reported as
`executionWallTimeMs`, not idle time. Game time follows actual native frames.
Host throughput is not a cartridge CPU-cycle or physical-hardware measurement.

Optional [recordings, checkpoints, and clips](../../../docs/recorded-playtesting.md)
preserve input history and failures. Checkpoints require a neutral delivered
frame and exact ROM/runtime identity, including the worker implementation hash.
Archive-read compatibility does not authorize loading an old state into a new
build.

## Bounded hardware and source diagnostics

```text
emulator_inspect {"view":"oam","visibleOnly":true,"limit":40,"includeScanlineSummary":true}
emulator_inspect {"view":"memory","region":"wram","offset":0,"length":32}
emulator_inspect {"view":"vram","region":"vram","offset":0,"length":32,"bank":0}
```

OAM inspection reads at most 40 hardware objects; its optional scanline summary
compares with the physical 10-objects-per-scanline limit. Memory reads are
limited to 256 bytes from named VRAM, WRAM, OAM, or HRAM regions, with bank
selection validated against actual hardware mode. Cartridge/boot ROM, arbitrary
I/O, host files or memory, and target-memory writes are unavailable.

ROM-only mode does not infer high-level game state or named variable addresses.
For the selected source project, request a successful official build with
`captureDebugArtifacts:true`, then explicitly start its exact ROM with
`debugMode:"source"` in the same MCP session:

```text
rom_build {"outputPath":"build/debug.gbc","captureDebugArtifacts":true}
emulator_run {"romPath":"<returned ROM outputPath>","restart":true,"initialFrames":120,"debugMode":"source"}
emulator_debug {"variableNames":["Has key"],"includeScene":true}
```

Use actual unique names or IDs from the selected project. Supported source
queries expose signed 16-bit variables, current scene, up to 256 authored
collision tiles, and bounded resource/event references. Up to 32 variable
selectors and 64 references are supported. Exact ROM bytes, same-build
`symbols.noi` / `globals.i`, supported engine layout, and unchanged source
and plugins must agree. Missing or optimized-out values stay unavailable.
Compiler artifacts alone do not guarantee a decodable layout.

Authored collision/event links explain source context, not the virtual
machine's currently executing event. After an edit, rebuild with fresh
artifacts before making source-aware claims. Preserve compiler stderr and
failure diagnostics; an aborted build cannot authenticate a new debug context.

## Report the check, not more

Keep the same functional expectation and relevant starting condition before
and after a fix. Repeat the exact button sets and frame counts through the
stepped API, inspect the result, and check nearby behavior when relevant.
Report ROM identity, inputs, observed frames, source diagnosis, and remaining
gaps.

A sample proves only its actual frame; intervening motion, audio, save/load,
and physical hardware remain unverified unless exercised separately. Static
`dialogue_preview`, `graphics_preview_scene`, `sprite_preview`, and
`sprite_contact_sheet` outputs are authoring aids, not running-ROM evidence.
Animation changes can alter hashes without a functional regression.

## Sources

- [PyBoy upstream README and API](https://github.com/Baekalfen/PyBoy)
- [GB Studio native build and web export documentation](https://www.gbstudio.dev/docs/build/)
- [Pan Docs Game Boy hardware reference](https://gbdev.io/pandocs/)
