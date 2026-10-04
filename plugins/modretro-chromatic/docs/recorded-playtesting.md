# Recordings, checkpoints, and clips

The [ModRetro Chromatic plugin](../README.md) can retain recordings,
checkpoints, and clips from real play. Use [stepped playtesting](stepped-playtesting.md)
for the edit → build → play → diagnose → fix → retest loop. This reference covers
optional retained evidence and same-build checkpoints; it does not introduce
another playing path.

## Retain an attempt

Enable recording on a fresh boot:

```text
emulator_run {"romPath":"<returned ROM outputPath>","restart":true,"initialFrames":120,"recording":{}}
emulator_recording {"action":"status"}
emulator_recording {"action":"export","actionOffset":0,"limit":64}
```

The default output is a unique directory under the authorized workspace's
`artifacts/playtests/`. An explicit `recording.outputPath` must be an unused
authorized directory. Retain the returned absolute `recordingPath`.
All boots, including unrecorded boots, preserve adjacent cartridge save files.

Export reports bounded pages of normalized input history and retained evidence.
By default it returns up to 64 actions. Use `nextActionOffset` for the next
action page. Evidence always contains the latest `min(limit, 32)` samples;
`actionOffset` does not page that evidence. `actionCount` and `evidenceCount`
are full retained totals, and `truncation` identifies omitted entries.
Use that history to repeat the relevant button sets and frame counts directly
after a rebuild. Exporting does not play the game or judge its behavior.

```text
emulator_recording {"action":"stop","outcome":"failed","reason":"The player cannot pass through the opened door."}
emulator_close {}
```

The example outcome is the caller's observation, not an automatic grade.
`stop` finalizes evidence; further state changes require a fresh run or restart.
Optional outcomes are `passed`, `failed`, `needs-review`, and `cancelled`,
with a reason of at most 1,000 characters. Failed and cancelled attempts retain
those statuses; other completed recordings use `stopped` with a separate
functional outcome. Closing cancels active work without deleting the attempt.

## Review an interval already played

`emulator_review` reads committed normalized inputs and existing sampled PNGs.
It does not advance play, deliver input, capture a new frame, or append a journal
event. It also works after close without loading a ROM.

When `emulator_step` returns `recordingSpan`, copy its `recordingPath`,
`sessionId`, `branchId`, `fromActionIndex`, `toActionIndex`, `fromFrame`,
`toFrame`, and `prefixPin` into the review request. Keep `fromPrefixPin`
separately; it is not an input field. Do not reconstruct normalized indices
from the number of requested steps.

Review selects `(fromActionIndex,toActionIndex]` on one exact session and
branch. Equal indices select an explicitly empty interval. Limits are 4,096
normalized actions, 3,600 native frames, and 2 MiB of response metadata.
`maxImages` defaults to four and accepts 1–8. With at least two requested
images, selection includes the first and last retained images and evenly
spaced retained records between them. `includeImages:false` changes only inline
image delivery, not evidence selection or verification.

Set `imageLayout:"contact-sheet"` to compose those SAME verified retained PNGs
into one inline sheet, with source hashes, frame/action labels, tile mapping and
existing gaps/provenance preserved. Individual images remain the default;
`includeImages:false` suppresses either layout. An empty interval with no retained
frames produces no fabricated sheet. The complete review plus sheet metadata
still has the existing 2 MiB limit. No new frame, journal event or file is written,
and post-close review does not reopen the ROM.

For an already-authorized retained interval, keep its exact returned recording,
session, branch and action bounds; do not step merely to produce an overview:

```text
emulator_review {"recordingPath":"<existing returned recordingPath>","sessionId":"0123456789abcdef0123456789abcdef","branchId":"branch-0001","fromActionIndex":0,"toActionIndex":3,"maxImages":8,"imageLayout":"contact-sheet"}
```

The IDs and action indices above are examples. Replace them with the exact
returned identities and owner-selected bounds; do not invent a retained interval. Sheet integrity
and labels do not establish gameplay quality, unsampled states or heard audio.

The result separates exact retained `inputs`, available `physicalEvents`,
verified `frames`, and `coverage`. Missing endpoints, unsampled intervals,
or missing physical-delivery records remain unavailable. Imported checkpoint
prefixes can lack physical events; copied legacy frame sequence numbers are
not unique event identities. PNG dimensions and SHA-256 are verified, while
`rgbaSha256` remains the recorded pixel hash.

A prefix pin authenticates committed bytes, not authorization or a gameplay
outcome. Earlier pins remain usable after later events are appended, and
finalized recordings still require valid complete tails. Review reports
`semanticValidity:"not-adjudicated"`: inspect the actual evidence before
claiming an interaction or other outcome succeeded.

## Checkpoints are for the same build

Before saving, deliver one neutral frame so releases reach the emulated
hardware:

```text
emulator_step {"buttons":[],"frames":1,"sampleCount":1}
emulator_checkpoint {"action":"save","label":"Before the jump"}
emulator_checkpoint {"action":"restore","checkpointId":"<returned-checkpoint-id>"}
emulator_observe {}
```

A restore preserves the original route and creates a new recorded branch.
Checkpoint IDs and state files are opaque. Identity includes exact ROM bytes,
active CGB mode, PyBoy version, worker protocol, and worker implementation hash.
Changing the plugin worker can therefore invalidate an old checkpoint even
when the ROM is unchanged. A damaged, stale, or incompatible state is refused;
start from boot to retest a rebuild. Checkpoints are not battery-save backups
or evidence of physical save-hardware behavior.

## Extract a supporting GIF

`emulator_clip` uses existing archived frames without reopening or advancing
the ROM. Select the interval needed to explain the issue:

```text
emulator_clip {"recordingPath":"<returned recordingPath>","outputPath":"artifacts/clips/door-before.gif","startFrame":120,"endFrame":156,"maxFrames":64}
```

A GIF uses at most 600 source images and reports source-frame/timing metadata.
Its output is no-clobber and must remain inside the recording directory or the
authorized workspace's top-level `artifacts/` subtree. Sampling gaps remain
gaps in the evidence; a clip does not establish unsampled motion or audio.

For a short montage, pass ordered cuts instead of top-level frame bounds:

```text
emulator_clip {"recordingPath":"<returned recordingPath>","outputPath":"artifacts/clips/jump-montage.gif","cuts":[{"startFrame":120,"endFrame":156},{"startFrame":132,"endFrame":148}]}
```

Cuts preserve order and repeats, require exact retained endpoints, and reject
more than 16 intervals, 600 selected image occurrences, or 60 seconds of summed
native game time. They are not silently downsampled. The returned `cuts` map
source frames to output time and list sampling gaps; `timing` labels held samples
at native game time with decision pauses omitted. Missing motion is never
interpolated. Record with `sampleEveryFrames:1` prospectively when every native
frame is needed. Actual encoded GIF frame count and duration can differ from
source sample count because identical images merge and GIF time is quantized.
This exporter never replays input, captures new evidence, or annotates inferred
controls. It also works after the emulator closes.

## Limits, archives, and sharing

| Recording option | Default | Maximum |
| --- | ---: | ---: |
| `maxBytes` | 64 MiB | 512 MiB |
| `maxFrames` | 36,000 native ticks | 216,000 native ticks |
| `maxWallTimeMs` | 900,000 ms of emulator execution | 3,600,000 ms |
| `recentFrameCount` | 12 retained frames | 64 frames |
| `sampleEveryFrames` | Every 4 frames | Every 3,600 frames |

Execution time excludes idle time between calls. `executionWallTimeMs` reports
that work; game time follows executed native frames. Neither measures cartridge
CPU-cycle performance. The minimum byte budget is 64 KiB. Use
`sampleEveryFrames:1` when consecutive recorded frames matter.

Frame limits count work across branches, not only the current rewindable frame.
Byte accounting includes evidence and derived clips. Within one recording
parent, new attempts are refused at 64 directories or when reserved byte
budgets would exceed 1 GiB. This is not a machine-wide quota, and old attempts
are not pruned automatically.

Each attempt owns `recording.json`, an append-only `events.jsonl`, sampled
`frames/`, opaque `checkpoints/`, and a derived-output quota ledger. Preserve
the worker-owned ignore-all `.gitignore` and `.npmignore` markers, including
in custom output directories. Do not redirect recording or clip storage through
symlinks/junctions or rewrite its journals.

Schema-v1 archives remain readable through recording status/export, review,
and clip tools after close or a server restart. Reader compatibility does not
make old checkpoints compatible with a different worker. Preserve old recipe
files as user data, but the plugin no longer exposes a recipe-saving or replay
runner. Retest through explicit steps from the required starting condition.

Generated evidence remains separate from authored game assets. Keep failed
attempts until they are understood, delete only with the owner's permission,
and inspect contents before sharing. Distribute only ROMs, images, and save
data you own or have permission to share.

## Reversible recording maintenance

### Diagnose access without opening a recording

```json
{"action":"access_diagnostic"}
```

This explicit `emulator_recording` action accepts no other fields. It reads only
the authorized root's fixed access metadata (at most 4 KiB), not recording
contents. It does not create directories or markers, acquire or release access,
start an emulator or artifact worker, query processes, or queue behind a pending
worker. Unsafe, redirected, malformed, changing or unreadable metadata remains
`unresolved` without a retry. The observation is not an atomic filesystem snapshot.

The response separates the current observation from the **last acquisition
failure recorded by this service**. A new service cannot reconstruct an earlier
failure. Future failed acquisitions also return bounded `recordingAccessFailure`
details alongside the existing error: operation, time, category and available
filesystem code/errno. Raw error messages, stacks and the lease token are omitted.
An `already-exists` category is not proof that its owner is alive; other errors
such as permission or storage failure retain their own category.

An observed PID is only an unverified lease claim. The old lease format has no
process-start identity or host/client mapping. `matches-this-services-saved-lease`
means this service retains the release capability and the observed file identity
and bytes match; PID equality alone is never sufficient. Local service/transport
fields describe only the responding instance. No result establishes process
liveness, global quiescence or permission to recover; `recoveryAuthorized` is
always false. Even absence does not authorize a new run.

Use the original owning client's ordinary `emulator_close` only when that client
is still addressable and closure is selected. A fresh caller cannot close another
instance's lease. If the original client is inaccessible, preserve the evidence
and resolve its host/client lifecycle first. There is no public takeover,
force-unlock or orphan-finalization action. Do not remove a lease, kill a PID,
retry a refused call, or restart a ROM to try to recover access. A turn interruption
or inactive session is not a receipt for the original client's transport closure.

### Archive, retrieve and restore

`emulator_recording` accepts `archive`, `retrieve`, and `restore`, each with an
explicit `recordingPath` and no other operation fields. Maintenance is filesystem
only: it does not boot a ROM or launch an emulator. It requires POSIX ownership
checks and same-filesystem directory moves within the authorized project.

First close recording readers/writers and their emulator/artifact workers, and
settle every outstanding request and transport. This does not require terminating
the MCP server or stopping its unrelated web previews. Recording access must be
quiescent, including older versions without the new advisory access lease. Supported clients hold that lease while a worker is open; competing
clients and maintenance refuse it. Stale leases and unresolved cleanup are never
automatically cleared. This is coordination between supported clients using the
same authorized project root, not a census of unrelated programs or protection
against unmanaged filesystem writers. Close legacy clients explicitly before use.

```json
{"action":"archive","recordingPath":"artifacts/playtests/original-attempt"}
```

Archive requires a finalized, integrity-valid `stopped`, `cancelled`, or `failed`
recording. Live and interrupted records are ineligible. All files and directories,
including frames, checkpoints, ledgers and required ignore markers, are verified
within the existing 512 MiB recording maximum and a 20,000-member maintenance
limit. Symlinks, hard links, special files, writable-by-others paths and changes
during inspection are refused.

The destination is an exclusively created
`artifacts/recording-archives/<unique-id>/recording` in the same project. There is
no arbitrary output-root option or overwrite mode. The directory move preserves
all recording bytes, modes and provenance. A protected mapping directory remains
at the ORIGINAL path. Keep it and the archive container together; historical
closure/index records containing that path are not rewritten.

```json
{"action":"retrieve","recordingPath":"artifacts/playtests/original-attempt"}
```

Retrieve verifies both mapping copies, complete inventory digest, modes, manifest
and finalized journal, and returns the original/archive paths and session identity.
Supported status/export/review calls also resolve the original path through this
verified mapping. Direct archive paths undergo the same checks. External exported
clips remain at their original paths; they are neither copied nor deleted. Restore
before creating new derived clips, because archived bytes are immutable.

The original parent's ordinary admission check no longer finds this recording's
`recording.json` in an immediate child. Its original `maxBytes` reservation is
therefore released without changing any quota or historical limit. This does NOT
reclaim disk space: `bytesReclaimed` is zero. Recording bytes and new mapping
metadata remain on disk and still require storage accounting.

```json
{"action":"restore","recordingPath":"artifacts/playtests/original-attempt"}
```

Restore verifies again, checks the unchanged parent quota, parks the exact mapping
directory in the archive container, and returns the recording to its original
path. It refuses unrelated content or a quota filled by newer recordings. The
original reservation becomes chargeable again. Mapping metadata stays for audit.

An incomplete move/publication is a failure: bytes and recovery mapping remain
retained and the lease stays unresolved. Stop for owner reconciliation; do not
repeat the call, remove a lease, or overwrite a reported path. There is no automatic
pruning, deletion, cross-filesystem copy, quota increase, or old-runtime relabeling.
Source/unit coverage does not expose the new actions in an installed host. Use
the normal installation owner and fresh deployed validation before maintaining
any real retained recording.
