# ModRetro Chromatic 1.0.5

## Timed browser recording

Use `web_preview` to record an already-running browser game for a fixed duration.
The default is three minutes; supported requests range from one second to ten
minutes. This uses the same recorder as the visible capture controls, not the
physical-device capture backend.

- `start_recording` returns a job ID. A queued job is not proof that recording
  has begun.
- `recording_status` reports that original job's progress and outcome.
- `stop_recording` requests an early stop. The visible Stop control takes priority
  too.
- `read_capture` verifies the saved file and returns its media and metadata paths;
  it does not decode the recording.

Keep the preview visible and open until saving finishes. The recorder checks the
selected view and build, retains partial or unknown outcomes, and blocks
conflicting work while an earlier recording is unresolved. It does not retry an
uncertain start or upload. A `finished` job can still have a partial outcome.

## Validation and remaining limits

Real idle-browser recordings were saved at 180,006.3 ms and 600,011.8 ms, then
fully decoded: 10,801 and 36,002 video frames respectively. The ten-minute video's
declared end was 600.007 seconds. Both audio tracks decoded but were digitally
silent, so these runs do not establish audible gameplay or physical USB audio.
The recorded public-tool and SDK transports closed normally.

Full UI validation remains incomplete. Fixed UI acknowledgment deadlines were
missed, and direct navigation to the ten-minute recording's Timing URL returned
`ERR_BLOCKED_BY_CLIENT`. The Timing control is a named download; opening its URL
directly exercises a different path. Source inspection found no concrete broken
route or proven cause for the browser block. No header change or browser bypass
is included, and the original failed UI results remain unchanged. Durable local
media and metadata paths remain in the `read_capture` receipt.

These are browser-recording results, not engine frame-rate, Wrecklight gameplay,
or physical-device endurance acceptance. The 1.0.4 input controls, 1.0.3 native
capture and sprite import, supported platforms, samples, dependencies, and
portable package layout remain unchanged. See the [1.0.3 limits](release-1.0.3.md)
for physical capture. This release preparation does not install or activate a
plugin or device.
