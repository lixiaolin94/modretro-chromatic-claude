# ModRetro Chromatic Plugin for Codex 1.0.23

The macOS device preview delivers the latest validated frame through a bounded
queue and wakes waiting browser clients when a newer frame is ready. It is designed
to reduce waiting in the delivery path; actual capture-to-display latency and frame rate
depend on the host and device and have not yet been verified for this release.
Timing diagnostics distinguish browser submission and animation-frame callbacks
from actual screen presentation.

The standalone Device view aligns its controls with the main player and improves
keyboard focus. A guarded native title-atlas update can preserve existing title
metadata while applying a reviewed change. Cartridge write authorization and
existing capture, recording, and recovery safeguards remain in place.
