# ModRetro Chromatic 1.0.14

## Preview controls stay within reach

The shared preview header now groups the Emulation/Device switch, contextual
controls and **Install** above the console. It stays reachable while scrolling
and wraps into two compact rows in narrow panes. The game or device title moves
to a quiet caption below the console, before the keyboard hints.

Both modes keep the same install controller. A missing device still disables
Install, and automatic connection checks remain unchanged. Hover or keyboard
focus on the disabled control's wrapper explains what is needed. Full status
and recovery details remain in the tooltip and dialog; cartridge erasure still
requires explicit confirmation.

Device controls keep their original handlers and state when shown in the
header. The screenshot/video rail, skin choices, capture consent, pending
operations and failure recovery are preserved.

## Verification limits

The 143 focused tests and TypeScript build pass, including toolbar relocation,
keyboard containment, disabled-control explanations and connection refresh.
Independent source review is clear. The built-in browser was unavailable for
the isolated visual fixture, so rendered narrow-pane, sticky-header and mode
geometry remain unverified. No physical device, camera or microphone was used.
