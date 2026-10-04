# ModRetro Chromatic 1.0.15

## A compact, consistent preview footer

Emulation and Device now share one quiet caption directly below the console.
Keyboard hints stay compact in Emulation. Device shows one line that reflects
its actual connection state instead of claiming a live feed while disconnected.

Device notices no longer reserve space beneath the hidden console when you
return to Emulation. Recording status, uncertain-operation recovery and feedback
remain available in the shared footer. The top controls, Install action, automatic
device detection and console artwork are unchanged.

## Verification limits

The TypeScript build and all 55 focused tests pass. They cover repeated mode
switches, notice relocation, connection-state wording, recovery priority,
keyboard containment and cleanup. Independent source review found no required
corrections. These checks do not render browser CSS: exact pixel spacing, narrow
layouts and long-message wrapping remain visually unverified. No physical
device, camera or microphone was used.
