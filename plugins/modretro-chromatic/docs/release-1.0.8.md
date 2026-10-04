# ModRetro Chromatic 1.0.8

## Clearer recording and help

You can record browser video before game audio has started, or while its audio
context is suspended. The saved result explicitly reports video-only capture;
recording does not turn audio on without your action. Running game audio keeps
the existing recording behavior.

If no usable video was saved, the error says so and retains bounded recorder
facts for diagnosis. **Ask Codex** distinguishes a requested annotation from a
rejected or unavailable handoff. A requested annotation still needs to be sent
from the editor; it is not proof that a chat received it.

When the annotation cannot open, **Copy details** provides a safe report. If
automatic copying also fails, you can select and copy the visible text. Raw
technical errors stay local; only fixed guidance, validated build IDs and
bounded recorder facts are included in the report. The annotation itself uses
a shorter summary that fits the host's metadata limits.

## Restart without leaving an old view behind

Restart waits for the current idle browser view to retire before reloading.
Recording, pending work or uncertain closure still blocks that transition.
Retired views cannot silently return through a late request, and a late
acknowledgment does not trigger an unexpected reload.

## More useful device diagnostics

Discovery recognizes Chromatic players 1–8. If devices share a player number,
only that conflicting group is unavailable for selection; other uniquely
identified devices remain usable. The install panel also shows discovery
warnings when no device can be selected.

USB, HID, cartridge and activation failures now give specific next steps.
Discovery never repairs a connection, changes activation, retries a write or
skips confirmation automatically. Existing exact-ROM, selection-token and
uncertain-write protections remain intact. These changes adapt the useful
device diagnostics from PR #58 to the current implementation.

## Verification and limits

The combined changes passed 417 focused tests and a TypeScript build. A later
annotation-only correction passed all 24 dialog tests, including host metadata
bounds. Independent source reviews covered device handling, recording and
audio, restart/closure, and the annotation fallback.

A disposable built-in-browser fixture saved a two-second video-only WebM,
restarted into a new view, and closed normally. Separate checks exercised a
requested annotation, a declined annotation with successful copying, and an
explicit clipboard failure with manual text selection. These fixtures use
synthetic player data, not a game or physical device. Direct browser navigation
to the media was blocked. A separate closed-file review decoded all 120 VP9
frames at 160×144 and confirmed one video stream with no audio. Its video end
was 1.990 seconds; the recorder's elapsed time was about 2.023 seconds. These
are different observations, not a gameplay or performance measurement.
The final compact annotation summary has focused test and source
review coverage; the earlier browser fixture is not relabeled as a rerun of it.

The original reported recording failure's encoding and host-rejection causes
remain unknown. This release does not retry those sessions, install a plugin,
flash a cartridge, add OS sandboxing, or include the separate Reactor profile
work. Prior release artifacts and the bundled remix remain unchanged.
