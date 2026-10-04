---
name: chromatic-deployment
description: Find or set up a physical ModRetro Chromatic, capture its USB video feed, stream a live ROM demo to it, or flash a homebrew cartridge.
---

# ModRetro Chromatic deployment

The plugin bundles its vendor backend; no separate CLI is needed. Use the public
`device`, `device_capture`, `setup`, `play`, and `flash` tools. See the [device guide](../../docs/chromatic-device-testing.md)
for platform details and manual checks.

If the plugin itself needs preparation, use the [setup skill](../modretro-chromatic-setup/SKILL.md).
Device tools with an existing ROM need only the runtime component. The public
`setup` tool below handles hardware, not plugin dependencies.
For a tool error, follow [recover the failed step](../../docs/agent-guide.md#recover-the-failed-step):
missing project context, denied access, and an uncertain device action need different responses.

## Browser previews

Open every `web_preview` or `device_capture` URL, including screenshot Open links, only in **Codex's built-in browser**. If it is unavailable or blocked, retain the URL and report the concrete limitation. Never launch or fall back to an external browser.

Reuse the active preview URL or emulator/capture session for the same task. When temporary testing is complete, close only the session this task owns with `web_preview_close`, `emulator_close`, or `device_capture {"action":"close"}`. Preserve user play (including paused games), ongoing recordings, and unresolved saves or commands; inspect status and retain recovery evidence before closing. Never scan processes, kill by name, claim an unfamiliar port, or clean up another task's session. An unknown action is not safe to replay.

## Choose the device and ROM

`device {"command":"status"}` reports requirements without probing USB or proving
driver health. When discovery is in scope, use
`device {"command":"list_devices","requestId":"<unique discovery ID>"}` so a lost
reply can be recovered. Read the returned operation and select the intended `deviceToken`, never player 1
by default. Tokens identify the current enumeration, expire after five minutes,
and are consumed by accepted cartridge detection, live play, or flash. After one
of those actions settles, rediscover and reselect before another. Reconnection,
changed enumeration, or ambiguity also requires a fresh choice.

Players 1–8 are supported. Report discovery `diagnostics` even when another
device is selectable. `conflicts` contains duplicate player numbers without
tokens: have the user assign distinct numbers on the devices, reconnect them,
then discover again. `unmatched` preserves incomplete USB associations; check
the reported connection/access issue without claiming a driver diagnosis.

For live play or flash, use `rom_inspect` on the intended file within the
authorized project or workspace. Pass its exact path, `sizeBytes`, and SHA-256;
never substitute a different ROM, digest, or device. If no project or workspace
is authorized, follow [project selection](../../docs/agent-guide.md#start-and-select-the-intended-project).

## Prepare a first write on a new computer

Developer Mode activation is handled by the official [ModRetro Updater](https://support.modretro.com/en_us/articles/chromatic-firmware-updater-ryhoYnzCx),
not this plugin. For a known never-activated computer or an explicit
`feature.developer_mode_required` result, direct the user to that updater.
Do not request, accept, submit, store, or inspect activation codes through chat,
plugin tools, a plugin browser form, or a terminal. The plugin has no activation or
activation-status workflow. Code correction also belongs in the updater.

A new plugin installation, missing local record, or successful device discovery
does not establish whether activation is needed. A generic write failure does
not establish an invalid code, a seat limit, or a USB cause. Preserve the original
write result and any uncertain cartridge outcome; do not automatically retry it.

After the user completes the updater workflow, return to the plugin for fresh
device discovery, selection, and the normal flash confirmation. Reuse existing
explicit erase/write consent only when it covers this intended device and action.
Updater completion is not permission to write a cartridge and does not verify
that the game was installed. Build and emulator work can continue independently.

## Choose the requested action

- **Drivers:** `setup` with `command:"install_drivers"` uses the current session
  ID. Explain Linux's all-user udev access or Windows's elevated unsigned driver
  installer before acting; macOS reports `not_required` without launching one.
  See [driver setup](../../docs/chromatic-device-testing.md#driver-setup-depends-on-the-platform)
  for platform prerequisites.
- **Cartridge detection:** `setup` with `command:"detect_cartridge"` uses the
  selected token and may reconfigure the FPGA. Do not reset, activate, reinstall,
  or invoke a privileged shell as automatic recovery.
- **Live play:** `play` streams host-emulated video/audio without writing the
  cartridge. See [live-demo options](../../docs/chromatic-device-testing.md#stream-a-live-demo)
  for duration and saves; use the local emulator for automated input or profiling.
- **Physical video:** `device_capture {"action":"open"}` returns a local page.
  On macOS, open Connection settings with `open_settings`; the user explicitly
  enables capture and grants normal OS access. Tools cannot enable it silently.
  Linux x64/ARM64 uses Connect without an Enable or macOS permission step and is
  video-only. Windows device capture is unavailable; other supported device
  actions remain separate. The browser is display-only. Use `permission_status`
  and `list_devices` to inspect access and exact Chromatic choices, then connect
  that selection. Linux listing briefly opens matching nodes for capabilities
  without streaming. Optional macOS audio requires the same player’s USB input,
  never another camera or microphone. For “watch me play,” `start_recording` returns an accepted
  capture ID immediately: 3 minutes default, 10 minutes maximum. Poll `status` with
  that ID; the deadline stops the camera. Inspect fresh `live_frame` images during
  recording, save `screenshot` PNGs, and use `read_capture` for the last two frame
  IDs or completed video downloads/paths. `stop_recording` ends early; `close`
  releases the session. Partial/unknown outcomes are not duration success.
  Open the returned URL in Codex's built-in browser for the physical live view.
  Emulator buttons, stepping, memory and profiling do not control this feed.
  Screenshots return a real
  physical-feed image; videos stay download-only. Keep emulator images and
  host-to-device live demos distinct from this feed. Native labels do not prove
  which ROM is installed. Do not replay a timed-out command; inspect its status
  and preserve recovery downloads. See [physical capture](../../docs/chromatic-device-testing.md#capture-the-physical-device).
- **Flash:** Apply the eligibility and consent rules below. Tell the user the ROM
  path, size, digest, and device. For a flash-only request, report the original
  write result; label gameplay unverified unless it was observed and offer the
  [manual checks](../../docs/chromatic-device-testing.md#check-the-game-manually).
  If gameplay verification was also requested, continue with available evidence
  and ask only for missing observations the tools cannot make.

Set `confirm:true` only when the user has explicitly requested the specific setup,
live-play, or write action. Give each approved attempt a unique `requestId`.

## Check the ROM and get first-flash consent

Treat the exact ROM you compiled from game project source as homebrew; no extra
provenance check is needed unless it is a known third-party commercial game.
Refuse clearly third-party commercial games even if the user owns or modifies a
copy. A game the user or their team made is eligible even if sold. For other
supplied ROMs of unknown origin, try to boot the exact inspected file in the
[local emulator](../../docs/agent-guide.md#playtest-real-roms) and use any credible
evidence already available that identifies that file. If eligibility remains
unclear, do not flash; ask only for the missing evidence. See the [flash guide](../../docs/chromatic-device-testing.md#flash-the-exact-inspected-rom)
for evidence examples and refusal wording.

Before the first flash on a device, explain that it **will erase the selected
cartridge’s existing game data, saves may be lost, and no backup is made**. Get
explicit acknowledgement and permission to write; a bare flash request is not
enough. A request that already acknowledges the loss and approves this write
satisfies it. Use that consent for later user-requested writes on the same device
without asking again; a fresh discovery token alone does not reset it.
Ask only if consent is unavailable or narrower, or device identity has changed or
is uncertain.

## Use the reported recovery guidance

After the original operation settles, use its recognized failure and
`error.details.recovery` guidance. A successful cartridge detection can also
return `result.recovery` when its flash chip is explicitly unidentified.
Keep unknown causes unknown and preserve original command evidence.

`device.program_failed` alone does not identify an activation, USB, or cartridge
cause. Read the original `device` `operation_status` by its `operationId` and
inspect `error.message`, `error.details.vendorCode`, and any reported recovery.
For a copied preview error, use `operationId`: its displayed `requestId` is
preview-scoped, not the service request ID. Start with **Copy error** and the
public error summary. Optional `failureDetails` records only supported structured
evidence; an observed token does not establish a cause. If original diagnostics
are unavailable, report that limit once and keep the cause unknown. Raw command
evidence may contain sensitive text. A closed process still leaves
`cartridgeWrite: "outcome-unverified"`; do not retry automatically.

USB/HID failures call for the indicated platform access checks, not automatic
driver installation. Cartridge contact guidance does not establish that a
non-ModRetro cartridge is supported. Developer Mode errors direct the user to the
official ModRetro Updater. Unknown capacity stays unknown; do not request a code
or automatically retry the write. See the
[recovery guide](../../docs/chromatic-device-testing.md#use-the-original-failure-to-choose-recovery).

## Recover an interrupted action

Poll `device {"command":"operation_status","operationId":"<returned ID>"}` until
the original attempt settles. If a direct MCP discovery, setup, play, or flash
reply was lost, use its original caller-supplied `requestId` instead of
`operationId`. A preview's request ID is not interchangeable; use its copied
operation ID, or call `web_preview` action `install_status` with
`installationRequestId` set to the original preview UUID. A supplied ID never
falls back to the latest request; omission inspects the latest request and must
not substitute for original-attempt recovery. Match the returned request ID and
known generation before adopting its result. `requestedOperationUnknown: true`
leaves the original outcome unconfirmed. If exact public lookup is unavailable,
that same dialog's **Check status** sends its saved request ID. These reads
never retry an attempt or renew an expired device token. Activation and its
status are managed outside the plugin by the official ModRetro Updater.
Progress, cancellation, timeout, or a vendor `retryable` flag is not
proof of process closure or permission to repeat the action. Do not delete an
unresolved reservation, infer closure from a PID, or bypass it with a new request.
Preserve error causes, process-close evidence, captured output, and any unverified
hardware outcome. The journal survives server restarts but cannot supervise a
child after host termination. See [interruption and completion](../../docs/chromatic-device-testing.md#keep-interruption-and-completion-distinct).

## First-run recovery

Keep preview readiness and USB device readiness separate. A refused localhost
preview does not justify installing a driver. When device diagnostics actually
require Windows driver setup, explain the normal administrator prompt once,
use the existing `setup` driver action within the user's authorization, then
rediscover devices. Installer exit success alone is not a connection check.
Continue with fresh device selection and the existing write confirmation; never
replay an uncertain write. Missing activation goes to ModRetro Updater, never
to code collection.
