# ModRetro Chromatic 1.0.4

## Changes

Codex can now send a short button press to an already-running browser game with
`web_preview(action: "input")`. Each request checks the listener, view, ROM,
runtime, source, and input generation against the current status before acting.
The default hold is 250 ms, with a two-second maximum.

The action does not open or resume a game. Human input and page lifecycle changes
cancel tool input. A renewable lease and checks before emulation limit stale
commands. If release cannot be confirmed, that uncertainty remains visible and
blocks further tool input; it is not treated as success or retried automatically.

This patch packages the merged browser-input change. It retains the 1.0.3
features, supported platforms, bundled samples, dependencies, and portable ZIP
layout. Native device capture and guarded sprite import remain unchanged; their
[existing limits](release-1.0.3.md) still apply.

## Validation and remaining limits

Live public-tool checks on Jump Test issued one 250 ms Right press and two 250 ms
A presses. Release observations were 251.7, 251.9, and 250.8 ms. Media review of
1,807 decoded frames showed two complete jumps of about 0.60 seconds and 50 native
pixels, with stable grounded periods and no extra jump or drift. The Right press
preceded recording, so the video does not prove that movement.

These observations establish the tested Jump Test input sequence, not sustained
frame rate, Wrecklight gameplay, or physical-device capture. An earlier attempt
with unknown release remains unresolved. A pointer click on Resume had no
observable effect while focused Return worked; its cause remains unclassified.
Neither observation is hidden by this patch release.

No installation, device flash, activation, or new hardware test is part of this
release preparation. The portable ZIP remains a candidate until independently
reviewed.
