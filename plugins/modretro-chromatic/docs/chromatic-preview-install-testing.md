# Test Install on Chromatic

> **Claude Code port:** this page describes the original Codex distribution. In the Claude Code port, Claude Code installs and updates the plugin (`/plugin`), so ignore marketplace registration, local payload, `register-personal-plugin` and `codex plugin` steps. Dependency commands (`scripts/setup.mjs doctor|plan|apply`, `toolchain_doctor`, `toolchain_prepare`) work unchanged. See [CLAUDE-PORT.md](../CLAUDE-PORT.md).

Run the plugin process on the computer connected to the Chromatic. Opening a
forwarded browser preview cannot grant a remote process access to local USB.
Use a separate source checkout; preserve any live preview and installed runtime.

## Check the UI without hardware

From a trusted checkout with its locked dependencies prepared:

```sh
npm run check
npm run build
node --import tsx --test tests/chromatic-device.test.ts tests/web-preview-flash.test.ts tests/web-flash-control.test.ts tests/web-tooltips.test.ts
node --import tsx tests/fixtures/preview-flash-browser.ts
```

The fixture prints local URLs for simulated connection and installation states.
It uses the real composed player UI with fake devices and media; it neither
queries USB nor writes a cartridge. Stop the fixture normally when done.
Review both a desktop window and a narrow phone-sized viewport:

- Keep one Annotate control, More, the screenshot/recording rail, Saved toast,
  Last capture and keyboard hints available. P remains Select.
- Check hover and keyboard-focus tooltips, including inside the install dialog.
- Leave the install panel untouched, including hiding and showing the page:
  no device status or discovery request should run unless a saved request needs
  recovery. The initial Install on Chromatic button opens the panel.
- After opening it, confirm disconnected, discovery failure, permission failure
  and preview-server loss are distinct. A permission failure needs visible text
  and reachable diagnostics, while browser play remains available.
- Opening the panel refreshes devices. Choosing one and clicking Install opens
  confirmation; only Confirm Install sends a write. Cancel sends none.
- Running or uncertain writes retain Check status and the original request ID.
  A failure keeps its original explanation. Closing/reopening never repeats it.
- A closed vendor failure distinguishes process completion from an unverified
  cartridge outcome. Refresh status must not promise to resolve that failure.
- Ask Codex is explicit: verify safe diagnostic metadata reaches the annotation
  request, not a new device request. Acceptance acknowledges that request; verify
  visible annotation attachment separately, and do not call it a sent chat message.
  Check unavailable/declined handoff without hiding the original error. **Copy
  error** must work before Ask Codex and after any handoff result, including nominal
  acceptance. Confirm copied feedback and selectable text on clipboard denial.
  Repeat these checks in the recording-error dialog. Reopening the panel permits
  a fresh explicit handoff.
- ModRetro firmware help opens only on a click in a separate tab. It does not
  promise to resolve activation, workspace authorization, or an uncertain write.
- After a confirmed success, Done allows a later explicit installation with a
  fresh device choice and confirmation.
- A `feature.developer_mode_required` result offers the official ModRetro Updater
  link with short, neutral copy. It has no activation-code field, code submission,
  re-entry control, or plugin activation-status request. The link opens only on
  user action and does not dispatch a device operation.
- Returning from the updater does not automatically write or clear an uncertain
  operation. A new flash uses fresh device selection and normal confirmation.
- **Dismiss failure** works for a known-closed failed installation independently
  of activation. Keep its original cartridge outcome unverified and require fresh
  device selection and erase confirmation. Check both UI dismissal and MCP dismissal
  while the browser dialog is closed; the panel must remain reachable. A stale
  binding or uncertain closure must not clear the pending request.

## Check a real device only when authorized

UI fixtures do not establish device detection, driver health, cartridge writes
or gameplay. Request each intended hardware action separately. Read the
[device workflow](chromatic-device-testing.md#flash-from-the-browser-preview)
before proceeding.

Use the ordinary packaged MCP and `web_preview` for the selected project. Open its
URL only in Codex's built-in browser. If blocked or unavailable, keep the URL and
report the limitation; do not switch to an external browser. Keep
any healthy existing dependencies. Discovery is not permission to install a
driver or erase a cartridge. Journal access failures need scoped filesystem
access; never replace its shared journal or clear a retained operation.

For an authorized write, retain the exact ROM and device selection, original
request/operation ID, result and errors. If the result is uncertain, recover its
original status; do not retry. Report vendor completion separately from the
user’s manual boot, audio and gameplay checks.
