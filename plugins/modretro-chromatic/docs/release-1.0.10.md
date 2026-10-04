# ModRetro Chromatic 1.0.10

## Clearer activation and recovery dialogs

Activation, installation recovery, and preview errors now share the compact
styling used by the player settings: consistent spacing, readable status text,
and clear primary actions. Narrow dialogs stack their footer controls.

After an activation request is submitted, its status replaces the code field.
**Activation command completed** makes **Back to install** the primary action;
it does not claim that activation or available seats were independently verified.
Status lookups are labeled separately from an activation in progress.

When a closed installation failure reports that Developer Mode is required,
**Activate this computer** is the primary action. **Copy error** remains available
independently of **Ask Codex**, with the same safe diagnostics and selectable
fallback when clipboard access fails.

## Keyboard focus and safeguards

The code field receives focus once it is ready, unless you have moved elsewhere.
Submission moves focus off the hidden field. Delayed replies and status polling
do not take focus back from another control or a closed dialog.

Codes remain masked and are cleared after submission or close. Request recovery,
explicit **Enter another code**, installation confirmation, and the existing
device and privacy safeguards are unchanged. No game is installed automatically.

## Verification limits

The polish passed 208 focused interaction and related tests, a TypeScript build,
and independent source review. Rendered IAB polish remains unverified because the
built-in browser was unavailable; no alternate browser was used. These checks do
not establish native browser focus, rendered narrow layouts, real activation, or
hardware behavior. Bundled tools, artwork, samples, and the previous release
archives are unchanged.
