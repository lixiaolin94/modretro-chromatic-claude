---
name: deployment
description: Find or set up a physical ModRetro Chromatic, capture its USB video feed, stream a live ROM demo to it, or flash a homebrew game onto a Chromatic cartridge.
---

# ModRetro Chromatic deployment

Use the `device`, `device_capture`, `setup`, `play` and `flash` MCP tools. See
the [device guide](../../docs/chromatic-device-testing.md) for platform details
and manual checks. For a tool error, follow
[recover the failed step](../../docs/agent-guide.md#recover-the-failed-step):
missing project context, denied access and an uncertain device action need
different responses.

## Prerequisite: the vendor CLI

This Claude Code port does not bundle ModRetro's proprietary Chromatic CLI.
Before the first device action, run
`node "${CLAUDE_PLUGIN_ROOT}/scripts/claude/chromatic-cli.mjs" status`. If it is
not installed, follow the [setup skill](../setup/SKILL.md#install-the-modretro-chromatic-device-cli-hardware-only):
explain the download once, get the user's agreement, then `install --yes`.
Building and emulator work never need it. The public `setup` MCP tool below
handles hardware (drivers, cartridge detection), not plugin dependencies.

## Browser previews

Open every `web_preview` or `device_capture` URL, including screenshot Open
links, in **the host's built-in browser** - the Browser pane in the Claude Code
desktop app. In a terminal session give the user the exact URL to open; never
post it elsewhere, and do not launch a browser from the shell unless asked. If
blocked, retain the URL and report the concrete limitation.

Reuse the active preview URL or capture session for the same task. Close only
the session this task owns. Preserve user play, ongoing recordings and
unresolved saves or commands. Never scan processes, kill by name or claim an
unfamiliar port. An unknown action is not safe to replay.

## Choose the device and ROM

`device {"command":"status"}` reports requirements without probing USB. For
discovery use `device {"command":"list_devices","requestId":"<unique ID>"}` so a
lost reply can be recovered. Select the intended `deviceToken`, never player 1
by default. Tokens identify the current enumeration, expire after five minutes,
and are consumed by accepted cartridge detection, live play or flash; rediscover
and reselect afterwards. Report discovery `diagnostics`; `conflicts` (duplicate
player numbers) need distinct numbers on the devices and reconnection;
`unmatched` needs the reported access check, not a driver diagnosis.

For live play or flash, `rom_inspect` the intended file within the authorized
project or workspace and pass its exact path, `sizeBytes` and SHA-256; never
substitute a different ROM, digest or device.

## Prepare a first write on a new computer

Developer Mode activation is handled by the official
[ModRetro Updater](https://support.modretro.com/en_us/articles/chromatic-firmware-updater-ryhoYnzCx)
(in the DevDay Edition, press Cmd-I / Ctrl-I there to enter the activation
code). For a never-activated computer or an explicit
`feature.developer_mode_required` result, direct the user to that updater.
**Never request, accept, store or inspect activation codes** through chat,
tools, files or a terminal. A generic write failure does not establish an
invalid code, a seat limit or a USB cause. Preserve the original write result
and any uncertain cartridge outcome; do not automatically retry. After the user
completes the updater, do fresh device discovery, selection and the normal flash
confirmation.

## Choose the requested action

- **Drivers:** `setup` with `command:"install_drivers"` uses the current session
  ID. Explain Linux's all-user udev access or Windows's elevated driver
  installer before acting; macOS reports `not_required`.
- **Cartridge detection:** `setup` with `command:"detect_cartridge"` uses the
  selected token and may reconfigure the FPGA. Do not reset, activate, reinstall
  or use a privileged shell as automatic recovery.
- **Live play:** `play` streams host-emulated video/audio without writing the
  cartridge. See [live-demo options](../../docs/chromatic-device-testing.md#stream-a-live-demo).
- **Physical video:** `device_capture {"action":"open"}` returns a local page to
  open as above. On macOS, `open_settings` opens Connection settings; the user
  explicitly enables capture and grants normal OS access. In this port, Linux
  and Windows capture are unavailable (the Linux FFmpeg backend is not shipped;
  see CLAUDE-PORT.md); say so instead of retrying. Use
  `permission_status`, `list_devices`, then `connect` with the exact selection.
  For "watch me play", `start_recording` (3 minutes default, 10 maximum), poll
  `status`, use `live_frame`/`screenshot` to look, `read_capture` for results.
  Emulator controls do not drive this feed. See
  [physical capture](../../docs/chromatic-device-testing.md#capture-the-physical-device).
- **Flash:** apply the eligibility and consent rules below. Tell the user the ROM
  path, size, digest and device. Report the original write result; label
  gameplay unverified unless observed, and offer the
  [manual checks](../../docs/chromatic-device-testing.md#check-the-game-manually).

Set `confirm:true` only when the user explicitly requested that specific setup,
live-play or write action. Give each approved attempt a unique `requestId`.

## Check the ROM and get first-flash consent

A ROM you compiled from the user's game project source is homebrew. **Refuse
third-party commercial games**, including retail rebuilds, even if the user owns
or modified a copy. A game the user or their team made is eligible even if sold.
For supplied ROMs of unknown origin, boot the exact file in the
[local emulator](../../docs/agent-guide.md#playtest-real-roms) and use credible
evidence; if eligibility stays unclear, do not flash. See the
[flash guide](../../docs/chromatic-device-testing.md#flash-the-exact-inspected-rom).

Before the first flash on a device, explain that it **will erase the selected
cartridge's existing game data, saves may be lost, and no backup is made**, and
get explicit acknowledgement and permission; a bare "flash it" is not enough.
Reuse that consent for later user-requested writes on the same device; ask again
only if consent was narrower or the device identity changed or is uncertain.

## Use the reported recovery guidance

After the operation settles, use its recognised failure and
`error.details.recovery`. `device.program_failed` alone does not identify an
activation, USB or cartridge cause: read the original `device`
`operation_status` by `operationId` and inspect `error.message`,
`error.details.vendorCode` and any recovery. A closed process can still leave
`cartridgeWrite: "outcome-unverified"`; do not retry automatically. See the
[recovery guide](../../docs/chromatic-device-testing.md#use-the-original-failure-to-choose-recovery).

## Recover an interrupted action

Poll `device {"command":"operation_status","operationId":"<returned ID>"}` until
the original attempt settles; for a lost direct reply use its original
`requestId`. A preview's request ID is not interchangeable; use its copied
operation ID or `web_preview` `install_status`. Progress, cancellation, timeout
or a vendor `retryable` flag is not proof of closure or permission to repeat.
Preserve error causes, process-close evidence and any unverified hardware
outcome. See [interruption and completion](../../docs/chromatic-device-testing.md#keep-interruption-and-completion-distinct).
