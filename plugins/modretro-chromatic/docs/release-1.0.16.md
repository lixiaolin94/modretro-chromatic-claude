# ModRetro Chromatic 1.0.16

## Device capture on Linux

On Linux x64 and ARM64, choose **Device**, then **Connect** to watch a matching
Chromatic. A single device connects directly; select one in Connection settings
when several are attached. There is no macOS permission or Enable step.

Linux records video as WebM and saves screenshots as PNG. USB audio is not
supported in this build. The bundled native encoder needs no separate Node CLI
or runtime download. It checks the selected USB instance and video node before
opening it and retains partial recordings when capture fails.

On Windows, the unsupported **Device** choice is disabled with a keyboard- and
pointer-accessible explanation. Emulation and supported cartridge installation
remain available. macOS capture is unchanged.

See the [device capture guide](native-device-capture.md) for connection steps,
recording limits and troubleshooting.

## Verification limits

Independent source review and 69 focused tests cover connection policy, exact
selection, packet integrity, recording handoff, failures and process closure.
Two packaging regressions cover native executable hashes and modes.

Both Linux binaries produced real, decodable WebM and PNG output from synthetic
input in an isolated Linux VM. The decoded frame counts match the recorded
encoder counts. x64 ran through instruction translation on an ARM64 host.
These results do not establish physical Linux USB capture, native x64 hardware
compatibility, long recordings or rendered browser behavior. No cartridge was
flashed. Source archives, build recipes, the V4L2 patch and dependency notices
are retained with the release source.
