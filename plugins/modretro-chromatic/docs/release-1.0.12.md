# ModRetro Chromatic 1.0.12

## Consistent preview controls

Emulation and Device now use the same centered toolbar spacing, button and icon
sizes, and color-chip spacing. Both views use an outlined video-camera icon for
idle recording. Active recording keeps its Stop control and elapsed time.

Device status stays visible below the handheld, without squeezing the toolbar.
The standalone Device page reserves space for its title. The shared preview
keeps the same measured handheld position when switching views.

## Verification limits

The change passed the existing focused layout-contract and recording-control
tests, a TypeScript build, and independent source review against the supplied
screenshots. These checks do not establish rendered browser or hardware
acceptance. Capture behavior, consent, bundled tools, artwork and samples are
unchanged; no device or flash operation was performed.
