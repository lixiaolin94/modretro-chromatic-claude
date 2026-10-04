# ModRetro Chromatic 1.0.11

## Emulation and Device in one preview

Use the compact **Emulation / Device** selector above the player to switch
views. Your emulator stays mounted, with the same game and saved progress.
Device view pauses emulation and releases its input and audio; returning
restores your previous play/pause state.

Device capture starts **off**. Opening Device view does not discover, connect
or flash hardware. With nothing connected, it shows a quiet prompt to enable
capture or connect a Chromatic. **Settings → Connection** holds the device
selection and consent controls; USB audio is a separate choice.

The handheld keeps the same size and position between views. Skin choices and
capture controls remain available, and recovery notices appear below the device.

## Clearer failures and recovery

A disconnected game preview no longer implies that a device operation failed.
It offers **Retry connection** and **Ask Codex** to reopen the preview.

Real recording or installation failures keep their original status and recovery
details. An unconfirmed recording request blocks another start and switching
away; **Check capture status** reads the original state instead of replaying it.
Settings tabs remain keyboard-accessible without sending their keys to the game.

## Verification limits

The change passed 251 focused tests, a TypeScript build and independent source
review. These checks cover no-device startup, capture-off consent, lost replies,
served module imports, mode switching and keyboard handling. Rendered layout in
Codex's built-in browser and real hardware remain unverified; no alternate
browser or device write was used. Bundled tools, artwork, samples and the
1.0.10 archive are unchanged.
