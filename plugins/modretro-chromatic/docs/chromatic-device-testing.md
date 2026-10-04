# Play your game on a Chromatic

For a compact package, the plugin verifies the bundled executable bytes and
writes only the selected platform's CLI to its private cache at
`~/.modretro-chromatic-runtime`. Reused entries are verified before
execution. An unsafe or damaged entry stops the command; the plugin does not
silently replace it or modify its installed package.

Use the [ModRetro Chromatic plugin](../README.md) to find your device,
set up required drivers, stream a live demo, or flash a selected homebrew ROM. The official vendor
backend is pinned to version 1.2.1 and bundled inside the plugin; you don't need
a separate CLI installation.

Start with a request like:

> Find my Chromatic and check what setup it needs. Inspect `build/game.gbc`,
> but ask me before changing drivers or writing the cartridge.

## Flash from the browser preview

Open your game with `web_preview`. **Install on Chromatic** appears beneath the
player and keyboard controls. Device checks start when you open that panel,
so browser play does not need access to the device status files. A saved pending
request still recovers its original status without repeating the operation.

After you use the panel, visible previews check the connection about every five
seconds while it is closed. If no device is found, the button reads **Connect
your Chromatic to install**. These checks only list devices; they never install
drivers, detect a cartridge, or write a game.

Run the plugin on the computer connected to the Chromatic. A forwarded preview
does not give a remote server access to your local USB devices. Set up any
[required drivers](#driver-setup-depends-on-the-platform) with Claude first.

1. Connect your Chromatic with a compatible homebrew cartridge, then choose
   **Install on Chromatic**. Opening the panel refreshes its device list.
2. Choose the intended device; none is selected automatically.
3. Choose **Install**, review the warning that the current game will be erased,
   saved progress may be lost, and no backup is made, then choose **Confirm
   Install**. Cancel from either step sends no write. Every new installation
   requires confirmation; a remembered browser preference cannot authorize a
   different device.
4. Keep the device connected until the operation finishes. Closing the panel
   does not cancel the write; reopen it to recover the original status.

If discovery fails, **Check device connection** opens the diagnostic. Automatic
scans pause after a failure. Resolve the cause, then close and reopen the panel
to request another scan. Successful background scans retain only the latest
record; failed scans and explicit device actions remain recoverable by their
original operation IDs. Unresolved operations keep their reservation.

**Preview connection lost** means the local preview server could not be reached,
not that a USB device was detected. If **Chromatic installation unavailable**
reports inaccessible local status files, browser play remains available. Ask
Claude to diagnose the required access to `~/.codex-gb-studio/chromatic`; do not
delete, move, or replace the journal to work around a pending operation.

This writes the cartridge, unlike the `play` tool’s host-streamed demo. For a
lost or in-progress write result, use **Check status**, never another Install.
Status recovery controls apply to unresolved operations, failed status reads,
or discovery recovery. A finished installation failure shows its cause separately
from whether cartridge data changed; it does not offer **Refresh status**.
Use **Copy error** and paste its report into Claude. The report retains the original
operation ID and bounded structured diagnostics for reading that same operation;
it does not copy raw vendor output. If clipboard access fails, the selectable
report expands for manual copying. Copying does not retry the write or
automatically send a chat message.

For a fully closed failed installation, **Dismiss** acknowledges the failure
and closes the panel. The original failure and its unverified cartridge effect
remain recorded. Reopen **Install on Chromatic** to choose a device and confirm
a new installation. Stale bindings, journal failures, unconfirmed closure and
retained ownership still block dismissal.

Through MCP, call `web_preview` with `action:"install_status"`, then use
`action:"dismiss_install_failure"` with its exact `installationBinding`
(`generation`, `requestId`, `operationId`). Dismissal itself does not discover
devices or write a ROM. The browser can then reopen fresh device selection.
Vendor success still needs a separate manual boot/gameplay check. See
[local preview testing](chromatic-preview-install-testing.md) for fixture and
hardware verification boundaries.

## Public tools

The existing `modretro-chromatic` MCP server exposes these short local names:

| Tool | Use |
| --- | --- |
| `device` | Passive status, explicit device discovery, and original-operation status. |
| `setup` | Explicit driver installation or cartridge detection. |
| `flash` | Write one exact, inspected homebrew or user-created ROM to the selected device. |
| `play` | Run one inspected ROM on the host and stream video/audio to the selected Chromatic. |
| `device_capture` | Open the native device view; inspect permissions, open settings, list/connect devices, capture PNG/video, or close. |

## Capture the physical device

Chromatic exposes a USB video feed. `device_capture` supports macOS and Linux
(x64/ARM64), using a native backend and an authenticated local page. Windows
device capture is unavailable; Emulation and supported Install/flashing remain
available. Open the capture URL only in
the host's built-in browser. The browser never requests camera or microphone access.
If the built-in browser is unavailable, retain the URL and report the limitation;
never switch to an external browser.

The page reuses the emulator preview's eight device colors, compact toolbar,
tooltips, and side capture controls. Settings is a fixed dialog with Connection
and Recording tabs. Live mode supports annotations, fullscreen, screenshots and
recording; it does not pretend to pause, reset or control physical game input.
macOS can record matching USB audio; Linux capture is video-only. Live audio
playback is not implemented.
The Emulator tab offers a user-sent Claude annotation for opening a project preview
or creating a blank project. It does not replace or close an existing session.

1. Call `device_capture {"action":"open"}`. On macOS, use `open_settings` with
   `tab: "connection"`; the user turns on **Enable device capture** and grants
   normal camera access. Optional USB audio requests microphone access separately.
   Tools cannot silently enable macOS capture. Turning it off revokes admission
   immediately, including during a pending permission request. On Linux, continue
   to device selection: there is no Enable step or macOS permission prompt.
2. `list_devices` returns exact Chromatic choices and counts of unlabeled,
   unsupported, and omitted inputs. macOS listing is passive; Linux listing
   briefly opens matching nodes to query capture capabilities without streaming.
   `permission_status` reports platform-specific access state without prompting. Neither
   operation proves capture will succeed. A denial can depend on OS permission or
   launch context; do not assume the user refused access.
3. `connect` requires that inventory's UUID and exact selected IDs and labels,
   within 60 seconds. Optional macOS audio must match the same player's USB input.
   Never substitute a laptop camera or ambient microphone.
   ```json
   {"action":"connect","inventoryId":"<returned UUID>","selection":{"videoId":"<returned deviceId>","videoLabel":"Chromatic - Player 01"}}
   ```
4. `start_recording` returns promptly with an ID and deadline. The default is
   180000 ms; `durationMs` accepts 1000–600000 ms. Poll `status` with that ID.
   The native deadline and `stop_recording` finalize video while preserving the
   live connection; `disconnect` explicitly releases the device. Hiding the browser
   does not stop recording. Video exports use nearest-neighbor 8× scaling and are
   capped at 128 MiB and retains native source timestamps without retiming.
5. `live_frame` returns the latest native JPEG and a transient ID; `read_capture`
   retains the last two requested frames. `screenshot` saves a full PNG. Both work
   during recording. `read_capture` returns the selected completed recording, or
   the latest completed recording when no ID is supplied. Videos are download-only.
   The preview updates at up to 10 Hz independently of native video recording.
6. Status preserves original native errors and distinguishes complete, partial,
   failed and uncertain results. Alerts are deduplicated. Partial native files
   retain their paths. A crash never leaves an unfinished recording looking live.
   Closing a listener alone does not prove the device was released; unconfirmed
   cleanup retains session ownership and blocks a conflicting replacement.

Reuse the active preview URL or emulator/capture session for the same task. When temporary testing is complete, close only the session this task owns with `web_preview_close`, `emulator_close`, or `device_capture {"action":"close"}`. Preserve user play (including paused games), ongoing recordings, and unresolved saves or commands; inspect status and retain recovery evidence before closing. Never scan processes, kill by name, claim an unfamiliar port, or clean up another task's session. An unknown action is not safe to replay.
A confirmed close permits reuse of the prior port with a new private capability URL.

Native files use generated private directories and verified metadata/hashes.
Completed captures are published inside the selected project's `captures/`
directory. Keep token URLs private. Each native helper allows two recordings,
32 PNGs and two retained previews; the server enforces a separate 256 MiB session
publication quota. macOS uses system codecs; Linux uses pinned FFmpeg/libvpx.
Neither backend alone establishes
independent OS sandboxing or immunity to decoder vulnerabilities.

For the full contract, limits and qualification boundaries, see
[native device capture](native-device-capture.md). Actual long-duration hardware
capture and supported audio need separate
observed validation; generated media duration is not physical elapsed runtime.

Emulator buttons, stepping, memory and profiling do not forward to hardware.
Physical capture does not flash, reset or identify the cartridge. Native device
labels and sample counts do not authenticate its ROM or prove game-render FPS.
`play` sends host-emulated video to the device; `web_preview` and `emulator_*`
observe emulators. Keep those sources distinct from physical capture.

## Discover the device for deployment

`device {"command":"status"}` describes platform requirements without accessing
USB or installing anything. For discovery, choose a unique ID and call
`device {"command":"list_devices","requestId":"discover-1"}`. Read the returned
operation with `device`'s `operation_status` command. If the first reply was lost,
look up `{"command":"operation_status","requestId":"discover-1"}` to recover
the same attempt without another USB probe. The ID is optional for existing
callers, but only a known ID can directly recover a lost first reply. A recovered
result does not extend the life of its tokens or make them valid in a new server
instance; once the original operation is resolved, start fresh discovery if needed.
An older installed release can reject a supplied discovery ID with
`CHROMATIC_INVALID_INPUT` and `operationStarted:false`. That exact response
establishes that discovery did not launch; the older bare call can then be
requested explicitly. Do not automatically fall back after a timeout, lost reply,
or any result that does not establish non-dispatch.

Choose the intended device from that result. Each device has a short-lived
`deviceToken`; the plugin never silently chooses player 1. The token binds a
current bus/port/player enumeration, not a permanent serial number. It expires
after five minutes, is consumed by a device action, and is checked against fresh
discovery before that action. Reconnects, changed identities, and ambiguous
results require a new explicit choice.

Players 1–8 are supported, with USB VID `0x374e` and matching PIDs
`0x0101`–`0x0108`. Discovery returns tokens only for uniquely numbered devices.
If `conflicts` lists duplicate players, give those devices different numbers in
their on-device settings, then unplug, reconnect and discover them again.
Other uniquely numbered devices remain selectable. Background observation does
not renew a token's expiry and revokes a selection that becomes ambiguous.

Read `diagnostics` even when discovery succeeds. `unmatched` retains USB
functions that could not be associated with a complete Chromatic. Check the
reported association reason, device connection and platform access; the message
does not prove that a driver is missing or that installing one fixed access.

## Driver setup depends on the platform

| Platform | Bundled backend | Driver and runtime requirements |
| --- | --- | --- |
| macOS | arm64, x64 | No vendor driver installation required. |
| GNU/Linux | arm64, x64 | glibc 2.39+; vendor udev rules may be needed. musl is unsupported. |
| Windows | arm64, x64 | Gowin USB driver, Visual C++ runtime (`VCRUNTIME140.dll`), and Universal C Runtime. |

These are vendor binary targets, not full-plugin qualification claims.
[Windows x64 remains experimental and full-plugin Windows ARM64 is unsupported](windows-setup.md).
Windows runtime libraries are not bundled or installed by the driver command.
A missing runtime or denied elevation can fail before the vendor starts.
The tool retains the original result without retrying.

For an authorized driver change, use `setup` with `command:"install_drivers"`,
the current `sessionId`, a unique `requestId`, and `confirm:true`.

- **Linux:** the plugin uses the system's `pkexec` and desktop consent agent
  to run the bundled driver command. It installs udev permissions for the
  supported USB devices. If polkit or its desktop agent is unavailable, setup
  fails without opening a terminal or falling back to `sudo`.
- **Windows:** the plugin requests administrator consent through Windows UAC,
  then waits for the bundled driver command. Its receipt records the vendor's
  process ID and exit code separately from the PowerShell adapter. Vendor
  console output is unavailable through this route; exit zero is not an
  independent driver-health check. The embedded Gowin installer is unsigned.
- **macOS:** the tool returns `not_required` without launching the installer.
  This is not a fix for an unrelated USB error.

Only the operating system may ask for administrator credentials; the plugin
never requests or handles passwords. Keep the original operation open while
consent is pending. A denied request, missing result, or lost connection is
not permission to retry or bypass OS policy.
The Windows route trusts the host's `SystemRoot` and installed PowerShell. Its
path checks do not verify Microsoft's executable signature.

There is no vendor driver-status, dry-run, or uninstall command. Passive status
therefore reports requirements and the last retained attempt, not invented
driver-health results. Setup never runs during plugin startup or discovery.

Cartridge detection uses `setup` with `command:"detect_cartridge"`, a selected
`deviceToken`, a unique `requestId`, and `confirm:true`. It may load Cart Clinic
or reconfigure the FPGA, so it also needs explicit permission. Reset and
activation are not exposed as automatic recovery actions.
A Developer Mode error is not permission to retry a write. Direct the user to
the official ModRetro Updater described below. The plugin does not manage
activation or collect codes, and a generic failure does not establish an invalid
code or a seat limit. Use **Copy error** and read the original `device`
`operation_status` by its `operationId`. An unconfirmed process retains its lock.
A known-closed failure can be explicitly dismissed as described above without
claiming the cartridge is unchanged.
After successful detection, run discovery again and choose a new token before
flashing. The old token was consumed, and the device enumeration may have changed.

### Activate with ModRetro Updater

Use the official [ModRetro Updater](https://support.modretro.com/en_us/articles/chromatic-firmware-updater-ryhoYnzCx)
for Developer Mode activation and any code correction. This plugin provides no
activation form, activation command, or activation-status endpoint. Never put
activation codes in chat, plugin arguments, logs, or a terminal.

If a computer is known to need activation, complete the updater workflow before
flashing. If a write reports `feature.developer_mode_required`, preserve that
original result and its cartridge outcome and direct the user to the updater.
Do not infer an invalid code or exhausted seats from that error. A new plugin
installation or successful device discovery does not establish activation state.

After the user completes the updater workflow, return to the plugin, discover
and select the intended device again, and use the normal flash confirmation.
Existing explicit erase/write consent can be reused when it covers the same
intended device and action. Do not automatically retry an earlier failed or
uncertain write. The updater's completion does not prove a game was installed.

### Use the original failure to choose recovery

Completed vendor failures retain their original code and command evidence.
The plugin adds guidance for recognized failures; it never performs recovery
or repeats the command automatically.

- **USB access:** check OS permissions and the platform setup above. Reuse
  authorization that already covers the needed change, while preserving normal
  OS approval. macOS needs no additional vendor driver.
- **Cartridge detection:** an unreadable cartridge, unsupported flash ID or
  explicitly unidentified flash chip gets contact-cleaning guidance. Only
  ModRetro cartridges are supported; cleaning does not make another cartridge
  supported. Wait for the user to reseat it before a new authorized attempt.
- **HID input during live play:** distinguish a missing accessible gamepad,
  multiple matches, denied access and an unknown cause. Linux needs readable
  `hidraw` access to the selected streaming device (`0x374e:0x010f`); Windows
  users can check USB/HID entries in Device Manager. These are checks to make,
  not newly executed probes or proof of driver health.

An unrecognized error stays unclassified. Read the original operation to
completion. An unconfirmed process blocks another write; a known-closed failure
requires explicit dismissal before another installation. A new write must be
requested; reuse a prior data-loss acknowledgement that still covers the same
device, as described under [flash consent](#flash-the-exact-inspected-rom).

In particular, `device.program_failed` alone does not identify an activation,
USB-permission, cartridge-contact, or programming-phase cause. In the reporting
computer's original plugin, read `device` with `command: "operation_status"`
and the copied `operationId`. Inspect its public `error.message`,
`error.details.vendorCode`, and any `error.details.recovery` first. A preview's
copied `requestId` is scoped to that preview and is not the service request ID;
use the operation ID for this lookup. The retained command evidence has the
original vendor error, including any message, causes, and phase, but may contain
sensitive text. Prefer **Copy error**, whose optional `failureDetails` carries
only supported structured evidence, not arbitrary vendor text. An observed token
does not establish the cause. If original details are unavailable, report that
limit once and leave the cause unknown; do not request a complete journal or
activation credentials. Process closure does not
prove that the cartridge was untouched or authorize an automatic retry.

## Flash the exact inspected ROM

Use `rom_inspect` on the intended file inside the authorized project or
workspace. It returns its canonical path, `sizeBytes`, SHA-256, cartridge header,
and validation status. Build results include the same ROM metadata. These fields
identify the file; they do not establish who made it.

A standalone ROM does not need a dummy native game project. Configure
`GB_STUDIO_WORKSPACE_ROOT` to its containing workspace before starting the server.
For GB Studio authoring, use `project_select` with the intended `.gbsproj` path.
`session_status` shows the current authorization; all paths must remain inside it.

A ROM Claude compiled from game project source counts as homebrew; an extra emulator
check is not needed for provenance. That does not make a known third-party
commercial game eligible: wrapping, patching, or rebuilding it from leaked or
decompiled source does not qualify. For a supplied ROM of unknown origin, try to
boot that exact inspected file locally with `emulator_run` and inspect the
title, credits, or opening gameplay with `emulator_step` or `emulator_observe`
([emulator workflow](agent-guide.md#playtest-real-roms)). Use credible project,
creator, or release evidence already available that identifies this exact file as
homebrew or the user’s own game, such as a creator-published checksum that matches
the inspected ROM.
A filename, cartridge header, standard Nintendo boot logo, successful boot, or
absence of familiar branding is not enough. If it will not boot, report that
separately; reliable provenance does not establish that the game works. If
provenance remains unclear or contradictory, do not flash; ask only for the
missing project source or credible creator/release information. Refuse clearly
third-party commercial games, including retail dumps and patched copies; buying
or owning a copy does not make the user its creator. A commercial game the user
or their team made is eligible when that authorship is clear. For example: “This
plugin is meant for homebrew. I can’t flash someone else’s commercial game, but
I can help flash a game you made.”

Tell the user which ROM (path, size, and SHA-256) and device will be used. Before
the first flash on that device, explain that it **will erase the selected
cartridge’s existing game data, saves may be lost, and no backup is made**. Get
explicit permission acknowledging that data loss before writing. A bare first
request to flash is not enough; an existing explicit acknowledgement and approval
for the write is enough. Later flash requests on the same device use that prior
consent without repeating the warning or question; each later write must still be
requested for its intended ROM and device. A newly issued discovery token is not
a new device for consent purposes. If prior consent is unavailable, the device
is different or uncertain, or the user explicitly limited their consent, obtain
consent for the new scope before writing. This never authorizes retrying an
unresolved write.

Call `flash` with the chosen `deviceToken`, `romPath`, `expectedSizeBytes`,
`expectedSha256`, a unique `requestId`, and `confirm:true`. The plugin checks
the ROM before and after fresh device discovery, then passes the exact digest
to the vendor writer. It rejects oversized, nonregular, changed, or invalid ROM
inputs before writing.

Each action returns an `operationId`. Read `device` with
`command:"operation_status"` and that ID until the original operation settles.
A repeated request ID retrieves that same attempt; it never starts a new one.

## Stream a live demo

Ask Claude to live-play an inspected ROM on your selected Chromatic for a stated
duration. The plugin calls the bundled vendor's `live-demo`: emulation runs on
the computer, with video and audio streamed to the Chromatic. This does not write
the cartridge and is not evidence of native cartridge performance.

Call `play` with the same `deviceToken`, `romPath`, `expectedSizeBytes`,
`expectedSha256`, `requestId`, and `confirm:true` fields used for an explicit
device action. `durationSeconds` defaults to 60 and accepts fractional seconds
from 0.1 to 300. The session ends through the vendor's duration option.
Read its progress and final result with `device`'s `operation_status`; do not
start another action while that session is active.

`saveMode` defaults to `"none"`, which disables battery-save loading and writing.
Choose `"isolated"` to retain battery saves under the authorized project or
workspace's `artifacts/chromatic-live-saves/<ROM SHA-256>/` directory. Reopening
that exact ROM reuses its saves; a different ROM digest gets separate storage.
These are the game's battery saves, separate from emulator snapshots used for
annotation.

Vendor lifecycle messages are retained as progress. A completed session requires
the final vendor result and an observed clean process close. This release exposes
no vendor command for remote button injection, framebuffer capture, or hardware
performance counters; use the existing emulator tools for automated input,
frame inspection, and profiling.

## Keep interruption and completion distinct

The plugin stores operation records outside immutable packages, under
`~/.codex-gb-studio/chromatic`. A shared claim prevents separate plugin instances
from overlapping device operations. Status lists the recent operations; older
request IDs remain available without a lifetime operation limit. Available output is saved as it arrives:
responses contain a 512 KiB preview per stream, and raw files retain up to
8 MiB per stream. Exceeding a capture or response bound is reported explicitly,
with the hardware outcome unverified. On Windows, these limits apply to the
PowerShell adapter's output; the elevated vendor's console streams are not captured.

Cancellation before the next vendor command stops that next command. Once a
vendor write or live demo has started, the plugin waits for its original close
rather than killing or retrying it. A live demo uses its selected duration to
finish. A forced host termination can still interrupt observation.
A retained reservation then stays unresolved across restarts; do not delete it,
infer completion from a PID, or reflash automatically.

A closed process and an understood hardware result are separate facts. For
example, exit 0 followed by malformed JSON does not prove that the cartridge
was untouched. Preserve all error causes, including a vendor `retryable` flag,
without treating them as permission to retry, reset, or change setup.

## Check the game manually

For a flash-only request, report the original write result. A successful vendor
write completes the requested flash; say when cartridge gameplay is unverified
and offer these checks without making a user reply part of the flash. If the user
also requested gameplay verification, continue with available evidence and ask
only for missing observations the device tools cannot make; leave them unverified
until observed.

After a successful vendor write, the manual checks are the intended title and
starting scene, controls and one representative route, and expected audio. Record
any slowdown, flicker, input delay, or missing sound against that ROM digest and device.

The Chromatic device tools do not inject buttons, capture cartridge gameplay,
or measure hardware FPS.
Write verification and the user's boot/play/audio observations remain separate.

## Developer MCP client

`scripts/device-mcp.mjs` is a thin client for testing a compiled or installed
package. It launches that package's configured MCP server and calls these public
tools; it does not import the device service or invoke the vendor directly.

```sh
node scripts/device-mcp.mjs --package /absolute/compiled/plugin --schema
node scripts/device-mcp.mjs --package /absolute/compiled/plugin --tool device --arguments '{"command":"status"}'
```

Those one-shot commands are passive. For a complete workflow, keep one server
and its device tokens alive with the foreground JSONL mode:

```sh
node scripts/device-mcp.mjs --package /absolute/compiled/plugin --workspace /absolute/project --jsonl
```

Submit one request per line, for example:

```json
{"id":"status","tool":"device","arguments":{"command":"status"}}
{"id":"scan","tool":"device","arguments":{"command":"list_devices"}}
```

Read the results, explicitly choose a returned token, then submit the approved
`setup`, `flash`, or `play` arguments in that same session. The client neither chooses a
device nor adds confirmation for you. Tokens from a closed server cannot be
carried into another invocation.

Send `{"id":"done","close":true}` or EOF when finished. If an action is still
uncertain, the client stays in the foreground and reads only its original status;
it does not force-close the server, repeat the action, or launch a replacement.
A broken transport remains an unknown outcome. Programmatic tests can use the
same session through `openDeviceMcpSession`.

Discovery, setup, flashing, and live play still require their normal explicit scope. A mocked
test or a schema listing is not hardware qualification.
