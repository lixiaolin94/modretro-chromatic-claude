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

If the user has no activation code (any Chromatic other than the DevDay
Edition, or a code already used on its two allowed computers), use the next
section instead of the flash tool.

## Without a Developer Mode activation code

Activation codes ship only with the Chromatic: DevDay Edition, and activation
belongs to the computer, not the handheld. The vendor CLI gates **only
cartridge writes** on it (`feature.developer_mode_required`: "Developer mode must
be activated before writing homebrew"). Apply this section when the user says
they have no code or a non-DevDay Chromatic, or when a write returned
`feature.developer_mode_required` and the user confirms they have no code. Never
ask for, guess or work around a code: do not call the vendor CLI's
`write-homebrew` or `activate` directly, patch the CLI, or suggest firmware
modifications to bypass the check. Do not retry the refused write.

Tell the user plainly what still works, then follow this loop:

1. **Iterate on the computer.** Edit, `rom_build`, and test in the
   `web_preview` player and with PyBoy `emulator_run`/`emulator_step`. This is
   unchanged and needs no device.
2. **Feel it on the real screen and buttons with a live demo.** Discover the
   device, `rom_inspect` the build, then `play` with explicit user approval
   (`saveMode:"isolated"` keeps battery saves). The ROM runs in an emulator on
   the computer and streams video/audio to the Chromatic; it never writes the
   cartridge. Say that this is not native-hardware evidence (CPU timing,
   cartridge saves, physical cartridge boot). Activation does not gate this in
   the vendor CLI, but this port has not verified it on a non-DevDay unit; if
   `play` reports `feature.developer_mode_required` or another refusal, report
   it as-is and continue with step 3.
3. **Native test from a flash cartridge the user owns.** This is the only
   no-activation route to running the cartridge on the real hardware:
   - Build, then `rom_inspect` the exact file. Tell the user its path, size,
     SHA-256 and header facts (CGB-only or dual-mode, MBC/RAM/battery), and
     that GB Studio's output is a standard Game Boy Color cartridge image.
   - **SD-card flash carts** (for example EverDrive GB X-series or EZ-Flash
     Junior): copy the ROM onto the card's storage, insert the cart in the
     Chromatic and launch it from the cart's menu. Claude may do the copy when
     the user names the mounted volume (e.g. `/Volumes/<CARD>/`): give the file a
     descriptive `.gbc` name, never overwrite an existing file without asking,
     never format, delete or reorganise the card, verify the copied file's
     SHA-256 matches `rom_inspect`, and remind the user to eject the volume
     before removing it. Battery saves then live on the flash cart.
   - **Rewritable cartridges with a USB cart reader/writer** (for example
     GBxCart RW with the open-source FlashGBX, which lists Chromatic cartridge
     flash chips): the user writes the ROM with that tool. Explain that it
     erases the cartridge's existing game and save; Claude does not drive that
     third-party tool unless the user asks and it is installed.
   - Flash-cart compatibility with the Chromatic's FPGA hardware varies by
     model and firmware; suggest checking community reports rather than
     promising it works. The homebrew-only rule still applies: only the user's
     own games, never commercial ROMs.
4. **Check on hardware manually.** Ask the user to report boot, controls,
   audio, save/load and any visual glitches, using the
   [manual checks](../../docs/chromatic-device-testing.md#check-the-game-manually).
   Only their observations establish native behaviour; reproduce reported bugs
   in PyBoy to fix them, then repeat the loop.

`device_capture` (macOS) can record what the handheld shows during steps 2 and 4
when the user enables capture in the Chromatic's Connection settings.

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
