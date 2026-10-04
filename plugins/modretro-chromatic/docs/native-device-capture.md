# Device capture

Watch or record a physical Chromatic through **Device** in the game preview. The browser displays the native feed; it does not access your camera or microphone. Hiding the view does not stop a recording.

## Connect your Chromatic

Turn on the Chromatic with a game inserted and connect it by USB. Give each connected Chromatic a different **Player #** in its System menu. See [ModRetro’s capture guide](https://modretro.com/blogs/blog/how-to-record-and-stream-gameplay-on-chromatic) for the device setup.

| Platform | Connection | Recording |
| --- | --- | --- |
| macOS 13 or later | In Connection settings, turn on **Enable device capture**, allow camera and matching USB audio access. A single Chromatic connects automatically; select one if several are connected. | MP4 with matching USB audio; microphone permission is required. |
| Linux x64 or ARM64 | Choose **Device**, then **Connect**. A single matching Chromatic connects directly; with several, choose one in Connection settings. | WebM video; USB audio is not supported in this build. |
| Windows | Device capture is unavailable in this build. Its disabled button explains why. | Emulation and supported Install/flashing remain separate and available. |

Linux does not have an Enable step or macOS permission prompts. The plugin checks the USB identity and a real V4L2 capture node before opening it. If access fails, check the USB connection, device power, Linux video permissions, and whether another application is using it. It does not choose a default webcam or microphone.

For tool use, open `device_capture({action: "open"})`, then call `list_devices`. Pass the returned `inventoryId` and exact `selection` to `connect`. An inventory expires after 60 seconds. Linux listing briefly opens matching nodes to query capture capabilities; it does not start video streaming. macOS listing is passive.

## Record and inspect

**Record** starts a three-minute recording by default, up to ten minutes. **Stop** saves the recording and keeps the live device feed connected. Start another recording directly, within the session limit. Closing settings or switching views also preserves the connection. Use **Disconnect** when finished with the device. `start_recording` returns an ID and deadline; poll `status`, and use `read_capture` to retrieve a completed recording or screenshot. `screenshot` saves PNG; `live_frame` returns the latest requested native image.

Recordings use nearest-neighbor 8× integer scaling: a 160×144 feed exports at 1280×1152, preserving source timing. On Linux, finishing a recording restarts the preview automatically, so a brief transition is possible.

The live display targets up to 60 frames per second on macOS and ten on Linux. macOS keeps only the newest pending preview while encoding; a slow display does not queue old frames. Actual refresh depends on capture, encoding and display speed. Recording uses its own encoder timestamps and sample counts, not the display refresh count. Linux labels its timestamps relative to each input opening, with a separate source generation after reconnecting or starting a recording. Unknown source-drop counts remain unknown. These values do not establish the game’s rendered frame rate or identify the cartridge ROM.

A partial recording stays partial and is retained for inspection. An uncertain shutdown keeps the session reserved; starting a replacement would risk two owners of the device. A successful download is not proof that gameplay, audio, or every frame looked correct.

## Limits and implementation

Each session permits two recordings and 32 screenshots. macOS retains the latest preview and any frame currently being verified, with at most one additional file during publication; each preview is limited to 1 MiB. A recording is limited to 128 MiB. The server verifies file identity, size, and hash before publishing it through an authenticated local URL. Bounds also apply to image dimensions, pipe buffers, process diagnostics, and shutdown.

macOS uses the bundled AVFoundation helper. Linux uses a pinned minimal FFmpeg/libvpx executable through the plugin’s existing Node runtime; it needs no separately installed Node CLI. There is no shell execution, browser media capture, default-device fallback, or automatic compiler/download at startup. See [native implementation notes](../native/capture/README.md).

Automated and synthetic checks are not physical-device acceptance. Linux hardware capture, long recordings, and rendered UI behavior require their own observations. Flashing a cartridge and updating device firmware are separate operations and are not prerequisites for this capture test.

## Investigating an intermittent live-feed stall

For a specifically chosen diagnostic run, request `device_capture` with `action: "open"` and `diagnosticTrace: true` before connecting. A trace is scoped to the capture session and connection. An existing, disconnected and idle session can be armed without closing it; tracing does not take over an active connection. Keep using the owned view and preserve any recording or unresolved device action.

Read the service trace with `device_capture` using `action: "status"` and `includeTrace: true`. The browser exposes its trace in the Device image's `data-capture-stage-trace` attribute while the view is mounted. Retrieve both before closing the owned session or its browser view. Each trace holds at most 60 rolling one-second buckets, with explicit retained range, omitted or evicted observations, connection identity, and partial or unknown coverage. At most one previous ended trace is retained per layer; a later ended connection replaces it. The previous service trace appears as `previousDiagnosticTrace`, and the previous browser trace as `data-capture-stage-trace-ended`. They contain timing and counters, not image or audio data. Enabling the trace adds observation overhead; label results as instrumented and compare with a separate normal-view observation when needed.

Use the exact connection and frame identities and the same-frame cache-publication anchors to locate related observations. Service and browser times use different monotonic clocks; do not subtract timestamps or assume their bucket boundaries coincide. Native callback and publication times belong to a third clock and describe only the selected published frame. Native cumulative callback, encoder, replacement and drop counters are sampled when the service receives a status response or event: gaps between samples do not identify exactly when a native event occurred. A maximum operation duration is assigned to the bucket where that operation completed, even if it began earlier. A missing bucket, hidden view, unresolved in-flight operation, or event-loop observation gap is unknown, not proof of zero frames. If neither a connection ID nor a source generation is available, connection continuity is unverified and cross-layer correlation cannot establish the same connection. Browser submissions and animation callbacks do not prove display scanout or game FPS.

## Timing fixture diagnostics

For an explicitly selected timing-V2 fixture, open the device-view URL with the fragment `#chromatic-timing-v2` before the view mounts. The normal view does not sample image contents or request a native clock. The opt-in view samples each unique submitted 160 × 144 decoded image, validates the binary counter against its hexadecimal row, and exposes a bounded 60-second summary in the image element's `data-capture-diagnostics` attribute. Unknown geometry, low contrast, disagreement, and unreadable images are counted as invalid. Counter jumps do not identify where frames were missed; transitions, distinct values, ambiguous reversals, and censored initial and trailing gaps are reported separately.

The diagnostic requests a fresh native uptime sample on every tenth frame request when the helper is idle. Each response remains tied to the exact immutable frame. Request, response, submitted-frame, and matching RAF-opportunity counts expose unavailable and superseded samples. Reported callback-to-submission and callback-to-RAF intervals apply only to successfully sampled frames and are conditional on comparable clock rates and no discontinuity; browser timestamp resolution is not independently bounded. The native timestamp is taken inside the capture callback after validation. RAF is a browser callback opportunity, not proof of display scanout or physical latency.

The sampler runs on the live path, so compare the instrumented result with an uninstrumented run. Its fixed window and buffers do not establish physical capture, codec, gameplay, audio, or hardware acceptance.
