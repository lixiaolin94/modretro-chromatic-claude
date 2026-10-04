# ModRetro Chromatic 1.0.13

## Install from either preview view

**Install on Chromatic** is now available in both Emulation and Device. Both
views share one button, device list, confirmation dialog and operation history.

With no detected device, the button stays grey. The visible preview checks the
existing device connection route automatically, so plugging in a Chromatic can
enable the button without reloading or opening the panel. Unplugging disables
it again. Focus and visibility changes refresh the check; a routine scan does
not briefly grey out a valid connected device.

An actual detection failure still offers diagnostics and an explicit refresh.
Pending or uncertain installs retain their original recovery path. Device
capture blocks a new install without being stopped, and cartridge erasure still
requires explicit confirmation. Camera availability is not flash availability.

## Verification limits

The affected flash/player tests and focused layout contract pass, including the
mounted UI with the real connection backend and a mocked vendor executor. That
test covers initial absence, later connection, disconnection and focus/resume
without a write, reload or implicit device choice. Independent source review
and the TypeScript build pass. Physical hotplug and rendered browser layout
remain unverified; no hardware operation was performed.
