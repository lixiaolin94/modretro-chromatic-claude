# ModRetro Chromatic 1.0.7

## Device checks when you need them

The browser preview now waits until you open **Install on Chromatic** before
checking device status or looking for a connection. Ordinary browser play no
longer displays a device-access warning before you ask to use a Chromatic.

Saved requests still recover by their original ID, without repeating a write.
Recovery stops after a terminal result even if the browser cannot remove its
saved ID. If saved-request storage cannot be read, the panel refuses a new
operation rather than assuming no write is pending.

Device-access failures remain visible in the panel, with their diagnostic code
and a clear explanation that browser play is still available. The device
backend, permissions, exact-ROM checks, confirmation and uncertain-write guards
are unchanged.

## Bring an existing project forward

The [setup guide](setup.md#preview-an-existing-project) now explains how to
select an existing `.gbsproj` and preview it through the official compiler.
Custom launchers and npm scripts remain untouched; no generic launcher upgrader
or automatic game-source migration is included.

## Verification and limits

The source fix passed 96 focused panel, backend and diagnostic tests plus 17
tooltip tests. Independent review found no remaining issue. A fresh built-in
browser check with a mocked journal-access denial confirmed zero device
requests on the untouched page, contextual diagnostics after opening the panel,
and available game and capture controls after closing it.

All eight server-preview integration tests pass, including a regression that
preserves custom launchers and game files while using the official export
route. That regression uses a mock compiler, not the remote project's launcher.

That UI check used synthetic player/media data and no hardware backend. It does
not establish a real cartridge write, gameplay or physical-device compatibility.
The existing native-capture limitations, supported platforms, bundled samples,
dependencies and portable package layout are unchanged. No sandbox-v2 adapter,
remote custom-launcher updater or direct unsent-composer integration is included.

This release does not itself install or activate a plugin or flash a device.
Existing 1.0.6 artifacts remain unchanged.
