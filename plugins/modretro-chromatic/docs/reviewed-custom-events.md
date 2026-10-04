# Reviewed custom-event dependencies

The world index can use a reviewed custom-event extractor without evaluating
project JavaScript. This is trusted maintained-source configuration, not a
public project setting. A command name, plugin manifest, successful build, or
project-provided `complete` flag never establishes complete semantic coverage.

The default catalog includes separately reviewed Wrecklight native13, r06, r31,
r36, r37, gameplay-feedback, Condenser-cue and r44 profiles.
Each profile requires its complete matching handler/helper set;
individual hashes from different profiles cannot be combined. The r31 profile
binds its noncontiguous map words, connector rooms and actors, combat targets,
compiled sprites, player states and non-parallax background associations.
Changed or ambiguous inputs leave coverage incomplete. Generic fixture tests
do not substitute for this maintained-source review, and installing the plugin
or playing a game is a separate operation.

When coverage is incomplete, use `world_dependencies` and its `coverageCursor`
to inspect the actual reasons. Some reasons concern native references, such as
an unresolved variable or engine field. `UNVERIFIED_CUSTOM_EVENT_CONTRACT` can
mean changed, mixed or unreviewed handler/compiler sources, an unsupported
authored contract (for example, a different owner or descriptor), or an invalid
invocation. A successful build, retry, or `adopt_binding` cannot establish an
unsupported custom-event contract. Bound-room tilemap operations refuse with
`TILEMAP_DEPENDENCY_UNCERTAIN` and leave native output unchanged. Atlas-only
inspection remains available, but does not grant room-edit coverage.

The bundled-remix successor preserves the chamber profile's event effects and
adds the two Airworks enemy ticks. It binds the curated sample's complete native
source, including its four-channel title score and optimized Cargo/Reactor idle
helpers. It accounts for the sample's updated chamber helper and omitted
inactive source backup. Historical profiles retain their original hashes.
This successor and its performance descendants permit string changes to the
project descriptor's `name` and `author`, as made by `project_create`. Every
other descriptor field must
match the reviewed snapshot, and extra fields are rejected. Engine settings,
variables, plugin files and resource relationships keep their existing guards.
The title music adds no VM-global or authored-resource dependencies.

The performance profiles retain the earlier bundled-remix profile and each bind
a separate complete set of native sources. They accept the combat `grace`
operation: it reads variable 9 and
decrements it when its signed value is positive. The operation has no compiled
child branches. Its calling actor script remains editable and is read by the
ordinary graph. The compiler profile stays unchanged; partial mixtures of
the native source sets remain unreviewed.

The busy-room successor binds the revised sprite renderer, actor collision loop,
VM dispatcher and scheduler, Airworks argument packets, door bounds, rewards,
and HUD charge lookup. It also binds the supported `50000` compiler preset and
the exact descriptor note `Native save compatibility revision: wrecklight-v5-engine-1`.
The note distinguishes the new native RAM and saved-script layout. Earlier
profiles keep their original descriptor notes and source hashes. These source
contracts establish dependencies; performance and save behavior require their
separate native-ROM checks.

The frame-pacing successor retains that complete profile and separately binds
the projectile, door-scan and reward changes, the core frame loop, queued OAM
and camera publication, and the single-column tile upload. The interrupt, shadow-header
and tile-copy patches are required native inputs, not optional extras.
Its descriptor note is `Native save compatibility revision: wrecklight-v6-engine-3`.
The stock tile-copy assembly is an additional compiler dependency for this
profile, so changed or missing patch input prevents complete coverage.
Complete older profiles remain valid; partial upgrades and mismatched save
revisions do not receive reviewed dependency coverage.

The Airworks event requires an explicit `bellows` or `skimmer` profile and its
exact Airworks actor owner at native slot 4 or 12. It publishes player and actor
positions, writes and reads the owning actor's five existing sampled locals,
and records the profile's phase, facing, arming, epoch and timer effects. Its
three compiled branches (`moveLeft`, `moveRight`, `afterMove`) remain authored
events with their own dependencies; both movement branches lead to `afterMove`.
The native call pops all six arguments before any branch can yield. Immediate
sampling and phase decisions now share one native call; this review does not
claim identical scheduler interleaving. Actor scripts remain editable under the
ordinary semantic index, with exact actor membership and ordering still guarded.

The r36 profile covers the Warden Deck and its selected player presentation.
The r37 alternative changes only the exact presentation-helper binding for two
reviewed HUD cue conditions; its dependency effects and other guards stay the
same. Ordinary presentation edits still invalidate an exact binding until their
semantics are reviewed in maintained source. There is no project setting or
refresh call that accepts arbitrary changed helper bytes.

The gameplay-feedback alternative reviews three files together: jump facing,
HUD acknowledgments and door guidance, and Map/Pause input and item labels.
Their variable and resource dependencies are unchanged; their gameplay behavior
is not claimed to be equivalent. Partial mixtures remain unsupported.

The Condenser-cue alternative keeps that feedback set and narrows the Bay exit
cue to the eastern doorway's height. It uses the same coordinate inputs and
notice values; lower Airworks guidance and the wider western approach remain.
This dependency review does not establish that the route has passed a native
playtest.

The r44 alternative adds HUD reads for Dash readiness, Brakemaw recovery and
the Sump return, plus the Condenser-capacity compiler alias. These reads apply
to map, pause and saved operations that can redraw the HUD, not every native
command. The earlier profiles keep their original effects. Ordinary actor
sprite changes still require unique current resource metadata and the same
reviewed actor layout; this profile does not accept missing or ambiguous assets.

The September Warden successor binds the nine changed helper inputs and the
complete added event, native helper, collision patches and resident art. Older
profiles keep their original bindings. Its seven explicit operations retain
their own VM reads/writes and compiled children; missing operations and inherited
object-property names are rejected. The Warden requires its Deck actor at native
slot 5, the reviewed fixed animation, and the exact 40×24 resident background.

The collision overlay substitutes `COLLISION_ALL` (0x0f) at closed seal cells,
then uses the stock scan's mask, coordinate progression and bank restoration.
This replaces the source collision byte, including any ladder bit. The reviewed
scene-load hook clears the private active/seal/material flags for every scene,
including LOGO. Rendering publishes the seal only after drawing its visible cells.
Shared hook reads of globals 8, 21, 58 and 59 appear as verified
`native-engine-render-read` resource dependencies, separately from each event's
direct VM access records. Variable-access-only queries do not include these hook
dependencies. The reset hook has no VM-global accesses.

This successor also accepts the two reviewed title background identities and
the original or Optical steel palette in slot 2. The other seven slots remain
fixed. An unassigned imported image does not invalidate the current title; once
assigned, replacement art must have a complete manual-color grid. Its bottom
60 startup cells must be uniformly 0, matching the legacy background, or uniformly
7, matching previously accepted native-generated metadata. The exact bound native
header supplies palette 7 for the visible menu; startup metadata does not replace
that header. `asset_update.copyTileColorsFrom` preserves the legacy grid exactly;
ordinary painting can then update the art above row 15 without writing reserved
UI slots. This is source eligibility, not build or playtest acceptance.

The combined profile binds one complete source set: September Warden, Map/Pause,
acquisition and title art together with V6 frame pacing, Airworks/grace callbacks
and the title score. It retains the owner interfaces, collision patches, title
alternatives and inactive source backup. Both stock collision and tile-copy
implementations are required compiler inputs. Its reviewed Warden RAM packing
changes private storage while preserving exports, timers, VM accesses and ordered
render effects. Earlier shipped profiles keep their original bindings.

The combined contracts use `-native-combined-v1`, version 3, and require the note
`Native save compatibility revision: wrecklight-sep17-v6-engine-2`. Only string
name/author changes are allowed in the descriptor; older save markers and partial
source mixtures remain unreviewed. Complete dependency coverage establishes
source eligibility. Linked RAM/stack use, timing, save behavior and game acceptance
require separate checks on the resulting ROM.

The sampling successor retains the complete scroll profile and reviews the
Warden's `sample_and_tick` operation. It binds the VM budget patch, native helper,
header and event compiler together. Only the exact Deck actor's direct root
update can use this operation, with the reviewed actor and scene ordinals and
five uniquely owned, typed local captures. Its dependency record includes the
sampled player and boss positions, the five captures, the tick's existing
effects, and both authored `shot` and `move` branches.

This operation batches the sampling prefix only when the remaining VM command
budget permits it, charges the original command count, and otherwise executes
the original prefix. The tick and branch instructions keep their own scheduler
positions. The source contracts use `-native-sampling-v1` and
`-native-sampling-curated-v1`, version 3, and the descriptor note
`Native save compatibility revision: wrecklight-sep18-sampling-budget-engine-1`.
Older profiles reject the new operation and retain their original bindings.
The sampling catalog's 276 contracts fit a 512-contract limit; the per-contract binding
and effect limits are unchanged. Runtime equivalence, stack use and performance
still require separate measurements.

The chamber-cache successor retains the complete sampling profile and changes
only the reviewed chamber-renderer binding. It reuses two resident source-cell
values within one call while preserving destination-priority reads and ordered
map writes. The descriptor note is
`Native save compatibility revision: wrecklight-sep18-chamber-cache-engine-1`.
The maintained exports are `CHAMBER_CACHE_NATIVE` and `CHAMBER_CACHE_CURATED`,
with `-native-chamber-cache-v1` and `-native-chamber-cache-curated-v1` contracts
at version 3. The chamber-cache 850-file bundled and normal-source fixtures both use
the curated profile, which omits the inactive source backup. Historical
sampling bindings remain unchanged. That release has 302 contracts within
the same 512-contract limit. This source review does not establish runtime
equivalence, stack bounds or a performance improvement for every input.


### Historical flat-collision/projectile profile

The flat-collision/projectile successor retains the released chamber-cache
profile and replaces two bindings: `project/engine_field_values.gbsres` disables
the unused slope feature, and the projectile patch avoids a second render scan
when the first scan finds no wings. Calls with wings retain both passes. The
descriptor note is
`Native save compatibility revision: wrecklight-sep18-flat-projectile-engine-1`.
The maintained exports are `FLAT_PROJECTILE_NATIVE` and
`FLAT_PROJECTILE_CURATED`, with `-native-flat-projectile-v1` and
`-native-flat-projectile-curated-v1` contracts at version 3. They contain 110
and 109 project bindings respectively and 13 contracts each. Both 850-file fixtures from that release use the curated profile. Released historical bindings remain
unchanged; the unshipped slope-only trial is not a supported profile. That release's
catalog contained 328 contracts within the same 512-contract limit. Source
binding, runtime equivalence and performance remain separate checks.

### Drive performance profile

The Drive performance successor preserves the flat-collision/projectile and
earlier profiles. It replaces eight source bindings covering chamber tile
reuse and packed cache storage, scroll invalidation, Drive sampling, and
projectile rendering. The emitted registry retains all `13` current curated
version-3 contracts. The normal build's public dependency query qualifies
the `12` command IDs used by this source, sharing `110` exact source bindings.

`DRIVE_PERFORMANCE_NATIVE` and `DRIVE_PERFORMANCE_CURATED` use the
`-native-drive-performance-v1` and `-native-drive-performance-curated-v1`
contract suffixes. Their fixed descriptor carries
`Native save compatibility revision: wrecklight-sep18-drive-performance-engine-1`.

The Drive Hall skimmer actor resource is an explicit exception to the usual
actor-edit rule: its eight-command sampling order, dead guard, typed captures,
global aliases and native handler belong to this profile's exact source
closure. Editing that schedule requires requalification; it is not accepted
by changing a source hash alone. No graph-contract or historical-profile
relaxation is part of this update.

### Three-phase boss profile

`BOSS_THREE_PHASE_NATIVE` and `BOSS_THREE_PHASE_CURATED` add a separate source
family with the `-native-boss-three-phase-v1` and
`-native-boss-three-phase-curated-v1` contract suffixes. They preserve the Drive
profiles, replace twelve native/source bindings, and add the Dynamo Colossus
sprite metadata, Crown countdown helper and Brakemaw guard helper bindings. The fixed descriptor carries
`Native save compatibility revision: wrecklight-sep18-three-phase-bosses-engine-1`.
The bound engine configuration provides 780 VM words. The existing 13 event
commands cover this source; it adds no public tool or event command.

Warden `tick` and `sample_and_tick` require four nonempty authored paths:
`shot`, `move`, `lowShot`, and `highShot`. The graph includes all four possible
paths and refuses incomplete arguments. Older profiles retain their two
optional action paths. The new sprite has 18 frames in its first fixed
animation; the exact Deck actor, slot, scene order, typed local captures and
sampling-prefix constraints still apply. The old Warden metadata remains
bound because that loaded asset can still contribute compiled state names.

Brakemaw's native hit consumption can advance phase variable 141 at the HP
floors, so slot-5 `hit` effects include its read/write access. The extractor
keeps the union of targets sharing a compiled slot, since an event's owner
does not establish the runtime scene. Crown's left native target reads the
cleared flag 98 and has no native HP field. Its authored admitted-hit path
consumes core health 97; those effects belong to the child script. The source
binds the new aliases for GuardianActive (96) and GuardianCoreHealth (97),
while retaining GuardianCleared (98) once.

Only this family accepts `COMBAT crownWaitTick`. Its explicit integer
phase/maximum pairs are `1:32`, `3:40`, `2:80`, `4:28`, `6:12`, `6:40`,
`5:72`, `7:24`, `9:16`, `9:40`, and `8:80`. The direct Relay-machine update
owner must retain compiled scene 11, actor index 8 and its six local aliases;
reusable-script contexts and ambiguous owners are rejected. The helper reads
Crown state, health, service, encounter epoch and L0–L4, then decrements L5 or
writes maximum + 1 on cancellation. Core health 97 is read only for phases
7–9. L5 is the only direct write. The four preceding stock captures retain
their own graph effects; this operation adds no actor, projectile, phase or
waitable-flag write and compiles no child path. The handler and helper must
both match the reviewed source closure. This contract does not establish a
performance gain or completed-fight acceptance.

The five private `ENEMY_CONDITION` kinds for Brakemaw use the direct Turbine
Vault update owner at compiled scene 9, actor index 4 (slot 5).
`brakemawSoft` reads captured camera L0/L1 and player coordinates 0/1.
`brakemawHardFloor` reads health, dead/Cutter/service flags, the captured
HUD/death state L4/L5, boss coordinates 138/139, and captured/current epoch
L2/150. `brakemawHardEndpoint` also reads facing 140;
`brakemawHardPending` additionally reads the remaining opening L3.
`brakemawHardEitherEnd` uses the floor read set without facing or L3.
All five only read game variables; the immediate conditional consumes their
temporary stack result. Their true and false branches remain authored, and
`__disableElse: true` excludes the false branch. The contract rejects malformed
branches, non-boolean else controls, extra arguments and changed owner/alias
bindings. The 24 authored sites exercise all five kinds; together with the
Crown countdown they make all 13 registered event commands used by this sample.
Globals 138/139 already exist in the game; adding their source aliases to the
profile does not allocate new VM variables or change the 780-word heap.

The acquisition cleanup also restores the stock dialogue frame and cursor
tiles. Its added `ui_load_tiles()` call uses the already-bound stock UI code
and assets; it adds no direct VM-variable access to the acquisition contract.

The `native-engine-contact-read` structural relation records globals read by
physical projectile admission, including the Warden damage cap. It is
separate from the later `COMBAT hit` and `WARDEN contact` event effects: the
cap is sampled at contact and is not evaluated again during hit consumption.
Private pending-hit storage and encounter flags are not VM-variable edges.
These source contracts do not establish ROM, gameplay or release acceptance.

Ordinary actor-event edits, actor positions and scene collision edits do not
require a new native-source hash. The index reads their current authored data
and checks the existing identity and layout constraints. Changes to native C,
headers or custom-event helpers need review because they can introduce hidden
dependencies. A successful build or playtest does not establish those effects.
Reusable rules may cover a specifically reviewed class of edits, but a checker
that accepts only two exact files offers no more flexibility than two reviewed
bindings. There is no general safe "accept changed C" switch.

### Opening direction profile

The curated opening successor adds one reviewed source family with the
`-native-opening-direction-v1` suffix. Its fixed descriptor uses
`Native save compatibility revision: wrecklight-opening-direction-1`. It
retains the historical profiles and requires one coherent handler, compiler,
native source, descriptor, and actor-layout match; bytes from other profiles
cannot be substituted.

Bay, Rivet, and Drive each allow their reviewed original background or one
specific additive background ID, metadata path, and dimension. These alternatives
belong to the same source family and can be selected independently. Another UUID,
another room's background, a changed path or dimension, or added parallax does
not acquire coverage. The successor also reviews Bay and Rivet's exact native
enemy ownership and new health/dead globals, and four Turbine continuation
graphs that may read and write the owning actor's local `L3`. Editing those
optimized graphs, their fallback branches, or their owner requires a new review.
Source coverage here does not establish a successful build, gameplay behavior,
or installation.

## What a review must establish

A `ReviewedEventContract` in `src/custom-event-dependencies.ts` records:

- A review ID and version, the reviewed loader profile, and the exported command.
- The complete handler's project-relative path, byte count and SHA256.
- The complete required helper/definition bindings, including data that affects
  exports, field handling, defaults, nested branches and resource resolution.
- The fields accepted by the handler, distinguishing editor defaults from values
  actually supplied to compilation.
- A maintained extractor that enumerates all relevant project variable and
  resource effects, plus only the child branches actually compiled.

Review the complete handler and the relevant helper/definition closure. Hashes
identify that reviewed source; they do not prove what it does. Bump the review
version when its interpretation or extractor dependencies change. The registry
fingerprint includes descriptor metadata and extractor function text, but it
cannot authenticate mutable state captured by a JavaScript closure. Extractors
must therefore use only their supplied immutable input/context and reviewed
maintained constants.

The current binding domain is the existing indexed project snapshot:
`project/**`, `assets/**` and `plugins/**`. A dependency on an external compiler,
SDK, patched engine materialization, emitted actor layout or an unindexed file
does not become verified merely by recording its path or a past build hash.
If those semantics cannot be established within the bound context, the entry
must remain absent or return `status: "incomplete"`. Do not add a broad path
exception, an arbitrary first-seen baseline, or execute a plugin to fill the gap.

## Resolving the handler

The reviewed GB Studio 4.3.2 source loads core handlers before project exports
from `plugins/*/**/events/event*.js`, keyed by exported ID. The registry requires
the exact handler and all dependency hashes/sizes from the complete index. It
does not infer export IDs with a text regex or depend on glob ordering to choose
between competing exports.

Missing or changed bindings, multiple matching exports, multiple reviews
claiming the selected handler, or another unreviewed export make the selected
review uncertain. An unreviewed export can also override a familiar core event;
an indexed graph cannot borrow that event's native semantics in this case.
Direct graph callers without the indexed binding map cannot establish reviewed
custom-event coverage.

`ReviewedEventRegistry` is injected only through the maintained graph/index
constructor options. The ordinary MCP uses the maintained default catalog; it
does not deserialize registry objects or executable extractors from a project.

## Extracting effects

Compilation receives event arguments merged with child fields, with child fields
taking precedence. The extractor follows that behavior and does not automatically
apply editor defaults. Unknown input fields, malformed children, unresolved
targets, unsupported access types, excessive results, thrown exceptions or an
explicitly incomplete effect result keep coverage incomplete.

An extractor receives a cloned, frozen input and context. Its complete result
can describe `read`, `write`, or `read-write` variable effects and typed resource
relationships. Resource targets must resolve uniquely, including scene context
for actor identities. Formal/local variables use the graph's existing binding
rules; an unresolved formal is not a global variable.

Only returned `events` branches are expanded. A declared but uncompiled branch
is not promoted to executable behavior. Authored structural preservation still
retains the underlying data, including opaque and commented content.

Results are bounded to 4096 effects, 256 child branches, 256-character target and
scene IDs, and 128-character relation names. The registry admits at most 697
contracts and 256 dependency/field rows per contract. These are ceilings, not
permission to omit a required dependency or truncate an effect set into success.

## Freshness and destructive changes

The existing plugin semantic generation remains separate from the public
project revision. Handler/helper/export changes invalidate that generation and
the reviewed graph fingerprint. An extractor may depend on other indexed
resources, so nonempty registries conservatively rebuild the semantic graph
instead of taking the optimization that revisits only a changed actor. They
also bypass the opaque-file shortcut: ordinary committed-path updates to helper
files publish new coverage, review evidence and semantic freshness immediately,
including when a helper is deleted, without waiting for a strong refresh.

Prepared transactions retain their existing strong refresh and semantic-generation
comparison immediately before publication. A helper changing after preparation
therefore refuses the write even if the public authored revision did not change.

Hidden variable and resource effects also become structural references, tagged
with their review identity. They protect native background ownership and
destructive resource operations. Same-scene deletion cannot discard a hidden
reference merely because the final authored-argument scan cannot see it. It
remains conservatively in use while its owner survives the transaction; removing
that owner removes the reference. The pre-edit index cannot prove dependencies
introduced by a proposed owner. Until proposed overlays are semantically
evaluated, indexed destructive batches conservatively refuse any simultaneous
creation or change of a surviving scene, actor or trigger, including non-script
field changes. Pure owner removal remains allowed when the remaining reference
checks pass. This guard applies even if no reviewed event was used before the
batch; it does not infer safety from an empty pre-edit reference set.

## Verification boundary

Focused inert fixtures exercise accepted bindings, real-versus-editor defaults,
compiled children, hidden variable/resource preservation, unreviewed/changed/
ambiguous exports, unresolved or incomplete effects, and stale pre-write refusal.
Fixture handler files are read as data and never loaded. The fixtures do not
certify Wrecklight's native closure, a compiler installation, an emulator run or
runtime gameplay.
