# ModRetro Chromatic Plugin for Codex 1.0.22

The macOS device preview now favors the latest captured frame through a bounded
encode, delivery, and browser decode pipeline. It can request up to 60 frames
per second. Actual frame rate and capture-to-display latency depend on the
device and host and have not yet been verified on hardware for this build.

Optional timing diagnostics help separate native callback, encoding, delivery,
browser decode and submission, and animation-frame opportunities. They do not
measure actual presentation or physical display scanout.
Capture settings also fit shorter windows more clearly, device refresh is less
disruptive, and the flash error control appears only when an error is available.

These changes do not alter cartridge write authorization or the existing device
and recording safeguards.
