# ModRetro Chromatic 1.0.9

## Activate from the install panel

When installation reports that Developer Mode is required, **Activate this
computer** opens a masked code field. It uses the bundled native ModRetro CLI;
no separate CLI installation is needed. Codex can open the dialog, but activation
codes belong in that field, never in chat or tool arguments.

Submitting or closing clears the field. The plugin retains a random request ID
and bounded process results, not the code, a code hash or raw native output.
The native interface requires the code as a transient process argument, visible
to local process-inspection tools. Native command completion is not independent
verification of activation or available seats. Activation never installs a game
automatically.

Lost responses recover the original request without resubmitting it. **Enter
another code** is available only after a proven non-start or fully observed
native failure. Running or uncertain operations remain blocked.

## Recover from a closed installation failure

**Dismiss failure** acknowledges a known-closed failed installation without
erasing its result or claiming the cartridge is unchanged. A new installation
still requires fresh device selection and erase confirmation. Unconfirmed
processes, retained ownership and stale bindings cannot be dismissed.

Codex can use `web_preview` actions `install_status` and
`dismiss_install_failure` with the returned exact installation binding. The
browser reconciles that same request even when its dialog is closed. Dismissal
does not itself discover devices or write a ROM.

## Copy errors even when the handoff fails

Recording and installation errors offer **Copy error** independently of **Ask
Codex**, including after an annotation request appears accepted. A successful
copy shows confirmation; denied clipboard access exposes selectable text.
Shared reports contain fixed guidance and allowed diagnostic fields, not raw
private errors or activation codes. An annotation request is not proof that a
message reached the composer.

## Verification limits

Tests use synthetic devices, native processes and activation results. The
earlier browser check verified masked entry, Enter submission, field clearing
and isolation from game keys. The later composed check reached the synthetic
installation failure and opened activation, then lost the in-app browser
connection. Its owned fixture shut down normally; the remaining composed flow
was not visually verified. No real code was redeemed, no cartridge was written,
and the previous release artifacts and bundled remix remain unchanged.
