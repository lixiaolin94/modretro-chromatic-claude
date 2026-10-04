# ModRetro Chromatic 1.0.3

## Changes

- Optional native capture on macOS 13 or later: exact Chromatic selection,
  screenshots, live frames, and asynchronous recordings with a three-minute
  default and ten-minute maximum. Windows and Linux keep the existing emulator
  and device-install tools; native physical capture reports that it is unsupported.
- Explicit **Enable device capture** in Connection settings, off by default.
  Optional USB audio requires separate consent. Opening a view, checking status,
  or listing devices never grants consent or starts a device stream.
- A display-only view in Codex's built-in browser with handheld skins, compact
  capture controls, settings tabs, saved capture links, and actionable alerts.
  The live preview updates at up to 10 frames per second; recordings preserve
  native source timing separately. Live audio playback is not implemented.
- Normal MCP actions configure connections and recording duration, open settings,
  return live frames, and read saved captures. Emulator controls cannot drive a
  physical device. Owned temporary sessions close normally; active user play is
  preserved.
- Guarded native sprite import accepts an authored PNG and its native metadata
  together. It verifies hashes and the project revision, maps every ID to a fresh
  value, reserves IDs in orphan metadata files too, and creates new assets without
  overwriting existing ones. The public import schema is discoverable through MCP.
- Developer activation errors clarify that these activation codes apply to one
  computer. Recovery keeps the original operation's status and never retries a
  device write automatically.

## Validation and remaining limits

A two-second physical video probe received 111 frames at 160 × 144 and confirmed
that its session stopped and released its inputs and outputs. This establishes
basic video capture capability, not full-duration hardware acceptance.

Generated media tests covered three-minute and ten-minute recording timelines,
plus a short video/audio file. Those tests run faster than real time. They are
not evidence of sustained physical capture, USB audio on hardware, or end-to-end
latency. Those hardware checks remain unverified in this release candidate.

A separate read-only startup/permission-status/close check passed through the
real helper protocol. Camera and microphone access were unavailable in that
process context; that result does not identify whether user privacy settings,
helper identity, or the launch environment caused it.

The local browser was tested with visibly synthetic device data for consent,
permission errors, exact-device connection, recording indicators, screenshots,
disable/finalize, saved results, and settings tabs that do not move the handheld.

Native capture uses AVFoundation and native H.264/AAC encoding, with no FFmpeg.
Source review and failure tests cover consent races, exact-device admission,
protocol and file bounds, partial results, and cleanup uncertainty. The helper is
hash-pinned and ad-hoc signed; it is not notarized or claimed to run in an
independent OS sandbox. Maximum recording size is 128 MiB. When cleanup cannot be
confirmed, the session stays reserved and reports the uncertainty.

Compiler and emulator dependencies remain separately installed from pinned
versions. This release does not install, activate, flash, or update a device merely
by opening the plugin. Full Wrecklight source remains available from the
repository rather than the compact plugin ZIP.
