# Build, play, fix, and retest

The model editing the game can play it through the
[ModRetro Chromatic plugin](../README.md). Build the native
project, choose a short controller input, inspect real frames, and decide what
to do next. The emulator does not advance while the model is thinking.

## When browser play is unavailable

If the host's built-in browser is unavailable, locked or unreachable, retain its
URL and state, report that browser limitation, and continue **gameplay** checks
with the public headless PyBoy tools. Browser access is not a prerequisite.
Use `emulator_run` on the intended exact ROM, `emulator_step` for bounded inputs,
`emulator_observe` for the current frame, and `emulator_review` for retained
recording evidence. Use the verified cartridge from the intended build/export;
if a build is needed, build the selected project. Do not substitute a sample or
transfer browser save states into PyBoy.

If PyBoy is missing, follow the [setup skill](../skills/modretro-chromatic-setup/SKILL.md)
with the `emulator` component under existing task authorization. A real access
denial, unavailable dependency or uncertain action remains scoped to the
affected work: preserve its result and do not replay it or use another route to
bypass it. Continue only independent authorized checks.

Headless frames establish native-emulator gameplay evidence. Browser UI,
annotations, browser recordings and physical-device/capture acceptance remain
separate; emulator tools do not control hardware. Preserve active user play and
unresolved saves/recordings. Do not switch browsers or reload a blocked view to
continue gameplay. When the built-in browser is available, keep providing the
visible preview described in the [agent guide](agent-guide.md#open-the-official-playable-browser-preview).

## Play the selected project

Select the actual project and check `toolchain_doctor` when compiler or optional
PyBoy availability is uncertain. To select an existing project in an
unconfigured session, use its absolute path. A new project created with
`project_create` still needs selection unless `select: true` was explicit.
Follow the [agent guide](agent-guide.md) for first-create authorization and setup.

Describe the behavior you want to check, then build and play. These inputs are
illustrative; choose a route that exercises your own game.

```text
project_select {"projectPath":"/absolute/path/to/MyGame/project.gbsproj"}
rom_build {"outputPath":"build/playtest-before.gbc"}
rom_inspect {"romPath":"<returned ROM outputPath>"}
emulator_run {"romPath":"<returned ROM outputPath>","restart":true,"initialFrames":120,"recording":{}}
emulator_observe {}
emulator_step {"buttons":["right"],"frames":12}
emulator_step {"buttons":["right","a"],"frames":8,"sampleCount":4}
emulator_step {"buttons":[],"frames":1}
```

Use the absolute paths returned by tools. Build output paths are relative to the
selected project; ROM and recording paths are relative to the authorized
workspace, which may be its parent.

`emulator_run` initializes a fresh boot or reuses the same unchanged ROM,
preserving its current frame and held buttons. `initialFrames` applies only to
a fresh boot. Use `restart:true` for an intentional reboot; changed ROM bytes
or hardware mode start fresh automatically. Every boot is isolated from
adjacent cartridge battery-save and RTC files, with or without recording.
Recording is opt-in: omit `recording` when a retained attempt is unnecessary.

For monochrome compatibility checks, pass `cgb:false`, including for cartridges
that also support Game Boy Color. Omit `cgb` to follow the cartridge's default,
or pass `cgb:true` to request color hardware.

## Make each input explicit

`emulator_step` accepts these fields:

| Field | Meaning |
| --- | --- |
| `buttons` | Required complete held set: any of `a`, `b`, `up`, `down`, `left`, `right`, `start`, `select`. Use `[]` for no buttons. |
| `frames` | Required positive frame count, 1–3,600. |
| `sampleCount` | Optional, 1–8; default 4. Returns up to this many real samples evenly across positive frame offsets, including the endpoint. |
| `includeImages` | Optional, default `true`. `false` omits inline images without changing input, frame advancement, or sampling. |
| `imageLayout` | Optional, `individual` (default) or `contact-sheet`. The sheet labels the same requested samples in memory; it adds no frames, captures, or file writes. |

The held set persists after the step. Sending the same set again does not
release and re-press those buttons. To release a button, leave it out of the
next step's set. A two-frame A press followed by one neutral frame is:

```text
emulator_step {"buttons":["a"],"frames":2,"sampleCount":2}
emulator_step {"buttons":[],"frames":1,"sampleCount":1}
```

The neutral step advances one frame; it is not a pause command. To stop and
discuss the result, simply stop sending steps. Use `buttons:["right"]` after a
right-and-A step when right should remain held and only A should be released.

Read the returned images and exact frame metadata before choosing the next
input. Use shorter steps near a landing, transition, or uncertain interaction.
For suspected flicker, request consecutive frames, for example `frames:8`
with `sampleCount:8`. Samples do not prove what happened in the gaps.

`emulator_observe {}` returns the current genuine 160 × 144 PNG without
advancing a frame, delivering input, or changing the recording journal.
`emulator_observe {"includeImages":false}` returns metadata without the inline
image. Optional `imageLayout:"contact-sheet"` labels the same current image in
memory; the individual PNG remains the default. Observation accepts no actions
or output path and writes no files.

Read `execution` separately from `imageDelivery`. An image-delivery error can
follow completed or partially completed input. Do not repeat a step just to
recover its images; use zero-tick observation or review its retained recording
span. A transport failure with unknown execution is not evidence of zero
advanced frames. Inspect surviving state before deciding whether to continue
or deliberately start a new attempt.
If cancellation cleanup also fails, `cleanup` reports that separately without
discarding the execution result. Resolve cleanup before starting more work in
that session.

## Diagnose, edit, and retest

Use `emulator_inspect` for bounded OAM or allowlisted hardware-memory views.
For named variables or the current scene, build with
`captureDebugArtifacts:true`, start that exact ROM with `debugMode:"source"`,
then call `emulator_debug`. Source diagnostics require the matching successful
build and unchanged authored source; addresses are not guessed.

Preserve the original attempt when it helps explain a failure. Record what the
frames showed and the exact button sets and frame counts. Apply the smallest
relevant native source edit, then build a new cartridge and repeat those steps:

```text
emulator_close {}
rom_build {"outputPath":"build/playtest-after.gbc"}
rom_inspect {"romPath":"<new ROM outputPath>"}
emulator_run {"romPath":"<new ROM outputPath>","restart":true,"initialFrames":120,"recording":{}}
emulator_step {"buttons":["right"],"frames":12}
emulator_step {"buttons":["right","a"],"frames":8,"sampleCount":4}
emulator_step {"buttons":[],"frames":1}
emulator_close {}
```

Keep the starting condition and relevant input sequence comparable. Inspect the
functional result yourself: a changed animation hash is not automatically a
regression, and a completed tool call is not a gameplay pass. A rebuild cannot
reuse an opaque checkpoint from different ROM bytes or a different worker.

## Stop and retain only what you need

Reuse the active preview URL or emulator/capture session for the same task. When temporary testing is complete, close only the session this task owns with `web_preview_close`, `emulator_close`, or `device_capture {"action":"close"}`. Preserve user play (including paused games), ongoing recordings, and unresolved saves or commands; inspect status and retain recovery evidence before closing. Never scan processes, kill by name, claim an unfamiliar port, or clean up another task's session. An unknown action is not safe to replay.

`emulator_status {}` reports the current session. `emulator_close {}` stops
or cancels emulator work and waits for cleanup without deleting recordings.
Close before selecting another project. There is no paced/continuous play mode.
Recording `maxWallTimeMs` bounds cumulative emulator execution time, excluding
idle time between calls; frame and byte limits still apply.

See [recordings and checkpoints](recorded-playtesting.md) for retained-input
export, interval review, optional GIF clips, limits, and archive compatibility.
Use the [runtime validation guide](runtime-validation.md) to verify the packaged
MCP path and report actual platform coverage.

## Migrating older callers

`emulator_step` takes an exact held-button set and returns sampled frames;
`emulator_observe` reads the current frame without advancing play. Migrate older
callers to the direct loop above.

The removed public tools are `emulator_input`, `emulator_timeline`,
`emulator_capture`, `emulator_contact_sheet`, `emulator_recent`,
`emulator_control`, `playtest_save`, and `playtest_replay`. There are no legacy
aliases or separate packaged replay runner. Native authoring/build tools,
official browser previews, persistent PyBoy, bounded diagnostics, recording,
checkpoints, and clips remain available; implementation regression coverage
remains in the development suite.

The emulator surface has 11 tools: `run`, `step`, `observe`, `status`, `close`,
`inspect`, `debug`, `checkpoint`, `recording`, `review`, and `clip`, each prefixed
`emulator_`.
