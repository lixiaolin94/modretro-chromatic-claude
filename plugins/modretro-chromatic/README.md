> **Claude Code port:** this page describes the original Codex distribution. In the Claude Code port, Claude Code installs and updates the plugin (`/plugin`), so ignore marketplace registration, local payload, `register-personal-plugin` and `codex plugin` steps. Dependency commands (`scripts/setup.mjs doctor|plan|apply`, `toolchain_doctor`, `toolchain_prepare`) work unchanged. See [CLAUDE-PORT.md](CLAUDE-PORT.md).

# ModRetro Chromatic

Create, edit, build, and playtest real Game Boy and Game Boy Color games with
ModRetro Chromatic in Codex. Your game remains an editable native project: the
visual game editor and Codex work with the same project files.

Source and issue tracking live in
[OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex](https://github.com/OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex).

## What's new in 1.0.8

Browser recording works without starting game audio and clearly labels a
video-only result. Failed recordings retain useful diagnostics; **Ask Codex**
explains whether an annotation was requested, or offers **Copy details** and
manual selection when it could not be opened. Restart retires the old browser
view before reloading, so it cannot leave an idle view blocking closure.

Chromatic discovery supports players 1–8, explains conflicting player numbers,
and gives specific recovery advice without weakening write confirmation.
See the [1.0.8 release notes](docs/release-1.0.8.md) for verification and limits.

## What's new in 1.0.7

Browser play no longer checks device access before you open **Install on
Chromatic**. Saved device requests still recover their original status without
repeating a write. If device access is unavailable, the panel explains the issue
while browser play remains available.

See the [1.0.7 release notes](docs/release-1.0.7.md) for verification and limits.

## What's new in 1.0.6

Native capture now checks a JPEG's actual dimensions and headers before sending
it to the preview or Codex. Malformed or unsupported headers are rejected while
the existing file, checksum and size checks stay in place.

The native helper is unchanged. This update does not establish OS sandboxing or
new physical-device compatibility. See the [1.0.6 release notes](docs/release-1.0.6.md)
for the validation scope and remaining limits.

## What's new in 1.0.5

Ask Codex to record a running browser game for a fixed time: three minutes by
default, up to ten minutes. The `web_preview` recording actions share the visible
capture controls, so you can stop early. Keep the preview visible until the file
is saved. Interrupted or uncertain recordings retain their original status.

Real three-minute and ten-minute idle captures were saved and decoded. Full UI
validation remains incomplete, including a blocked direct navigation to a
Timing URL. Saved media and metadata paths are available through `read_capture`.
See the [1.0.5 release notes](docs/release-1.0.5.md) for the exact scope and limits.

## What's new in 1.0.4

Ask Codex to press buttons briefly in an already-running browser game. The
`web_preview` input action checks the current game and view before acting, holds
buttons for 250 ms by default (up to two seconds), then releases them. It never
resumes a paused game automatically. Human input or a changed view cancels the
command; an uncertain release blocks further tool input.

Live checks on Jump Test confirmed two complete jumps and released input. This
does not establish Wrecklight gameplay, sustained frame rate, or physical-device
capture. All 1.0.3 features remain available. See the
[1.0.4 release notes](docs/release-1.0.4.md) for details and limits.

## What's new in 1.0.3

Watch a connected Chromatic in Codex's built-in browser with the optional macOS
native capture backend. Turn on **Enable device capture** in Connection settings,
then select the device. Take screenshots or ask Codex to record for a fixed time:
three minutes by default, up to ten minutes. The local view keeps the handheld
skins, capture controls, settings overlay, and clear error dialogs. Native capture
uses macOS permissions and native codecs; the browser never opens a camera or
microphone.

Import complete authored sprite PNG/native-metadata pairs with the
`asset_import` `native_metadata` profile. Dry-run validation, paired hashes,
project revisions, and fresh IDs protect the existing project.

A short physical video probe passed. Longer recordings and optional USB audio
have synthetic coverage but still need physical-device validation. See the
[1.0.3 release notes](docs/release-1.0.3.md) for supported platforms and limits.

## What's new in 1.0.2

Project authoring, pixel art, and ROM debugging now use consistent ModRetro
Chromatic skill names and prompts. Setup commands and the optional project
extension use the same product identity. Native compiler, saved-data, and
third-party attribution compatibility remains intact.

Start a new game with `project_create_blank`, choosing its game type and color
mode. Starter and Signal Lost now use original artwork, font and dialogue UI;
their editable sources ship without prebuilt cartridges. See the
[sample provenance](examples/SAMPLE-PROVENANCE.json) for sources and hashes.

## What's new in 1.0.1

Preview errors open clear alert dialogs with an explanation and a next step.
**Ask Codex** prepares an annotation with safe diagnostic details for you to send;
it never retries a device write. Device errors keep the original operation's
status separate from the current preview, with expandable technical details and
a link to ModRetro firmware help. Successful captures still use a quiet saved toast.

## What's new in 1.0.0

**Install on Chromatic** now follows the device connection and opens a compact,
two-step installation dialog. Failed or interrupted requests keep their original
status for recovery, without repeating a write. The centered title and single
Annotate control fit alongside the existing capture controls and keyboard hints.

Take screenshots and record gameplay video directly from the browser preview.
Quiet camera and recording controls sit beside the handheld, with elapsed time
inside the Stop button. A small toast confirms local saves; **More → Last
capture** brings back the latest result. Keyboard hints use two centered rows
and a compact grid in narrow windows.
Web controls show tooltips on hover and keyboard focus, including the available
game-control shortcuts. Labels follow the current action, such as Pause or Resume.

## Start with your game

If the plugin is already installed, start a fresh Codex task and try:

> Use the ModRetro Chromatic plugin to inspect
> `/absolute/path/to/MyGame/project.gbsproj`. Summarize its scenes and artwork,
> and suggest one useful next step.

For a new game, choose a new folder inside an existing directory:

> Create a blank platformer at `/absolute/existing-parent/MyGame` in color mode,
> select it, and show me the starting scene.

Want a larger starting point? **Wrecklight** is an editable salvage adventure
available from the repository. It is not included in the compact ZIP. Give
Codex its matching local source folder to create a verified, separate copy:

> Create a Wrecklight remix from `/absolute/repository/examples/wrecklight`
> at `/absolute/existing-parent/MyWrecklight`, select it, and show me its rooms
> and controls.

The source stays untouched. See the [remix guide](docs/wrecklight-remix.md)
for preparation, build requirements, and credits.

Codex works on your actual project files. You can continue editing them in
the visual game editor. Builds and emulator captures stay separate from
authored assets.

If you have not installed the plugin, [ask Codex to set it up](#prepare-the-tools)
from a trusted compiled package. A source checkout first needs the
[development build](#development).

Once connected, you can ask Codex to:

- Inspect and edit scenes, characters, dialogue, scripts, collisions, and
  project settings.
- Create or update pixel art, animations, palettes, and other native assets.
- Compose fixed-size native room backgrounds from reusable 8 × 8 tile primitives,
  with explicit palette and collision edits.
- Check Game Boy hardware limits and build genuine `.gb` or `.gbc` cartridges.
- Play the official Binjgb browser emulator in a compact handheld view,
  revisit saved moments, select game objects, and preview color changes
  through native annotations.
- Playtest a real cartridge in short steps, inspect screenshots, fix a problem,
  and repeat the relevant inputs against a rebuilt cartridge. Record attempts
  when useful.

## Requirements

Use Codex with local-plugin support and a trusted, readable plugin package.
Packaged installers target macOS/Linux x64 or arm64 and experimental Windows
x64. Windows ARM64 is unsupported; portable tests do not establish a complete
native Windows installation/build/gameplay pass.

Platform-targeted Linux bundles require GNU/Linux with **glibc 2.39 or newer**
before MCP can start, including authoring-only use. A universal bundle does not
apply that vendor check to non-hardware authoring startup; Chromatic device
commands still require a supported vendor target.

The bundled setup entrypoint can prepare Node/npm, the plugin runtime, the
official GB Studio CLI and GBDK, and an isolated PyBoy emulator when requested.
The GB Studio 4.3.2 compiler and PyBoy 2.7.0 emulator are installed separately
from pinned sources into the selected tools directory; neither standalone
package is included in the plugin ZIP. The bundled Chromatic device CLI is a
separate supplier component with its own embedded runtime and required notices.
Dependency preparation does not require Git, Corepack, global Python, or the
**optional GB Studio desktop editor**. Existing projects can be inspected and
edited without a compiler or emulator. Activating the prepared plugin also
needs a supported Codex host path, described below.

## Prepare the tools

For a first installation, obtain the **compiled release bundle for your
platform** from the project maintainer, together with its version and checksum.
The bundle must include its local marketplace metadata. A Git clone or GitHub
source archive lacks `dist` and is not that release. If no compiled download is
published yet, request the reviewed local bundle rather than installing source.

1. Extract the complete bundle, keeping its hidden `.agents` directory.
2. In Codex, open **Plugins → Add a marketplace** and choose the extracted
   release folder. Install **ModRetro Chromatic** from it.
3. Start a fresh task and ask for a game or setup as below. The setup skill uses local
   files and shell tools; it does not need a running ModRetro Chromatic MCP server.

After setup, Codex replaces this bootstrap installation with the prepared
machine-local entry through the supported installation flow. The downloaded
bundle stays untouched. Existing active games must close normally before
their runtime is changed.

This requires a Codex host with local marketplace support. If the setup skill
is not discovered, ask Codex to read the bundle's
`plugins/modretro-chromatic/skills/modretro-chromatic-setup/SKILL.md` explicitly; report that
as a file-based setup, not successful skill discovery. See the
[first-install details](docs/setup.md#obtain-and-add-the-compiled-release).

Ask Codex for the result you want, for example:

> Use the ModRetro Chromatic plugin to make a small playable game and show me
> its browser preview. Prepare missing dependencies in a dedicated tools
> folder and finish any required plugin setup.

The [setup skill](skills/modretro-chromatic-setup/SKILL.md) works before the plugin's MCP
tools are available. Codex uses the package's existing shell or PowerShell
entrypoint, reviews the plan, and prepares only the capabilities you requested.
New or iterated playable games need `runtime,build`, including browser previews.
Source inspection or edits without a build need only the runtime; local stepped
playtesting adds the emulator. The desktop editor stays optional.

Necessary setup is part of the requested game workflow unless you limit
downloads or changes. Codex asks only for missing scope or required platform approval. Downloads,
caches, and prepared tools stay in the chosen owned root, outside the immutable
package. Nothing is silently installed just by loading the plugin.
You do not need to install Node/npm manually. On a Mac without Node, the portable
MCP initially cannot start; Codex uses the shell setup entrypoint and installs
the generated machine-local plugin payload, bound to its managed Node and toolchain.

[Packaged setup and doctor](docs/setup.md) contains the commands Codex runs,
component readiness, cancellation, and recovery details. [Windows setup](docs/windows-setup.md)
covers its experimental platform-specific path.

For physical hardware, [deploy to a Chromatic](docs/chromatic-device-testing.md)
through the plugin's `device`, `setup`, `play`, and `flash` tools. Ask Codex to find your
device, help with any required drivers, stream a timed live demo, or write an
inspected homebrew game or a game you made. Before your first flash on a device,
Codex asks you to explicitly accept that flashing will erase the cartridge’s existing
game data, saves may be lost, and no backup is made. When that consent is still
available, you do not need to repeat it for later flashes you request on the same
device. Live demos run on the computer and stream video/audio to the Chromatic;
flashing installs the game on the cartridge. The vendor backend is bundled; no
separate CLI installation is needed. Finish a cartridge deployment with a manual
boot, play, and audio check.

To debug what the physical device displays, use
[`device_capture`](docs/chromatic-device-testing.md#capture-the-physical-device).
Its local page displays a native macOS capture feed and saves screenshots or
bounded native-cadence video. Enable device capture in Connection settings, grant
normal OS access, then select the exact Chromatic USB device. The browser never
requests camera or microphone access. Ask Codex to
watch for a fixed duration (3 minutes by default, up to 10), poll the capture ID,
and inspect native preview frames while you play. The camera stops at the deadline;
size limits or interrupted capture report partial results. Open the returned URL in a
Codex built-in browser side panel. If it is blocked or unavailable, keep the URL
and report the limitation; never launch or fall back to an external browser.
The same built-in-browser rule applies to `web_preview` and screenshot Open links.
Completed videos remain download-only. This is separate from
emulator capture and does not authenticate the installed cartridge ROM.

## Finish setup and verify

In Codex, look for **ModRetro Chromatic**. Starting with 0.5.6, its plugin/package
ID and MCP server key are both `modretro-chromatic`.

Upgrading from `codex-gb-studio`? Finish active games, previews, and device
operations before switching. Disable or uninstall the old plugin through
Codex, then enable the new identity in a fresh task. Uninstalling alone does
not prove an old session has closed. Follow the
[migration guide](docs/setup.md#upgrade-from-codex-gb-studio) to reuse dependencies
without moving or deleting existing state.

A completed setup with a ready runtime prepares a plugin copy for Codex, called
an immutable payload, and `prepared-mcp.json`; it **does not install or refresh
the plugin in Codex**. When you requested installation too, Codex continues
through the [supported host installation path](docs/setup.md#preparation-is-not-activation-or-gameplay-acceptance).
Registration can use a trusted host-provided Python; installation uses an
existing Codex command or the supported marketplace UI. You do not need to
install a global Python or unrelated CLI for that route. If a required host
capability is missing, Codex reports it rather than claiming the plugin is active.

The prepared payload binds this machine's absolute paths. Keep its dependencies
available; use a portable compiled distribution for another machine, then run
setup there. Never patch an installed cache or refresh a payload's version by
hand. Account for active games and previews before changing their runtime.

After installation, start a fresh Codex task and verify the installed identity
and callable tools there. Then try the first request above. Preparation,
registration, and a new task alone do not establish successful activation.

## Use the plugin

An absolute `.gbsproj` path selects and authorizes only that project's directory.
A new project needs an unused destination whose parent already exists; ask
Codex to select it too, as in the new-project request above. Creating or selecting a
project never expands an existing access boundary. For sibling projects and
advanced workspace configuration, see
[project selection](docs/agent-guide.md#start-and-select-the-intended-project).

Try requests such as:

- “In my selected native game project, add a village scene, place a character in
  it, and connect it to the existing starting area.”
- “Open my selected game in a playable browser preview, then reuse that preview
  as we make changes.”
- “Build the game and check that the door opens after I collect the key. Play
  it in short steps, inspect the frames, fix any failure, and retest the new
  build. Keep the before and after evidence.”

Browser previews keep the official Binjgb player with keyboard, gamepad,
touch, and audio support. Pause/resume and sound stay in the toolbar;
**⋯ More actions** contains Fullscreen, Restart game, Saved states, and the last
saved capture.
Progress saves automatically as you play. Reopening restores the latest saved
moment, paused and ready to annotate.
Restart starts again without deleting history. Saved moments require the same
game build. See
[browser playback and saved progress](docs/agent-guide.md#open-the-official-playable-browser-preview).

Use the camera icon beside the handheld to save a **Screenshot**. Use the record
icon for **Record video → Stop recording**, including game audio. The Stop
control contains the elapsed timer. A Saved toast links to the file in your
project's `captures/` folder, without adding a list below the player. No
microphone, screen-sharing permission, or external upload is needed. If saving
cannot be confirmed, download the retained browser copy before leaving.
Interrupted recordings are marked partial.

The preview’s **Install on Chromatic** button opens the device panel for that
compiled game. Browser play does not check devices until you open this panel,
except to recover a saved request. Choose a device, then confirm the game-erasure
and save-loss warning before writing. See [flashing from the preview](docs/chromatic-device-testing.md#flash-from-the-browser-preview)
for setup and status recovery.

Unchanged games reuse their existing export; editing the game refreshes the
same preview. If the browser is unavailable, locked or unreachable, keep its
URL/state and continue [headless gameplay testing](docs/stepped-playtesting.md#when-browser-play-is-unavailable)
with PyBoy on the intended exact ROM. Browser UI and physical-device checks
remain separate.

## Play, fix, and retest

The same model that edits the game can play it. It chooses controller inputs,
inspects real frames, edits the native project, and retests a rebuilt cartridge
from the same starting condition. The game stays paused between decisions.
Optional recordings preserve input history and original failures. Compare the
expected behavior; a changed animation frame alone is not a gameplay regression.

ROM-only testing needs no source or symbols. Source diagnostics require an exact
authenticated build. Checkpoints belong to the same ROM and emulator worker;
use a fresh boot after either changes. Boots preserve adjacent cartridge saves.

See [Stepped playtesting](docs/stepped-playtesting.md) for the direct tool loop
and migration from older tools. [Recordings and checkpoints](docs/recorded-playtesting.md)
covers optional retained evidence, archive review, and supporting GIF clips.

## Included examples

- The [neutral starter project](examples/starter/project.gbsproj) contains one
  minimal `Start` scene and does not impose a story, genre, or game mechanic.
- [Signal Lost](examples/dogfood-signal-lost/README.md) is a complete, editable
  sample game. Build its source with the separately installed compiler before
  previewing or playing it.
- [Hello Color](examples/hello-color/README.md) is a standalone GBDK C compiler
  demonstration, not a native game project.

## Troubleshooting

- **Missing tools:** ask Codex to use the [setup skill](skills/modretro-chromatic-setup/SKILL.md).
  It uses packaged `doctor` before MCP is available, or `toolchain_doctor {}`
  once connected. Default `ready` means compatible metadata. Optional
  `cli-version`, `gbdk-version`, and
  `emulator-import` probes check executables; they do not build or play a game.
- **Incomplete setup:** retain component errors and completed stages, then
  follow [setup and recovery](docs/setup.md#failure-retry-and-cancellation).
  Inspect an occupied unowned root or another setup's lock; do not overwrite
  it or kill its processes. Review a new plan before retrying apply.
- **Build failure:** keep the original compiler message and use any returned
  diagnostic location or suggested action. The desktop editor's
  [Run Scene](skills/modretro-chromatic-authoring/references/extensions-and-build.md#local-desktop-workflow)
  offers a scene-local check; plugin builds retain your authored starting point.
- **Changed backing runtime:** prepare a new runtime/payload and reinstall it
  through Codex. Keep the old runtime available to its active games and previews;
  do not patch a cached launcher or receipt. See
  [installation and replacement](docs/windows-setup.md#install-from-the-desktop-users-own-profile)
  for the advanced registrar's intentional replacement flow.

## Documentation

For setup and creative work:

- [Packaged setup and doctor](docs/setup.md): consented dependency installation,
  passive readiness, explicit probes, owned roots, and recovery.
- [Reusable native tilemaps](docs/tilemaps.md): named tile atlases, explicit room
  capture or fill, bounded primitive edits, and revision-guarded native outputs.
- [Windows setup](docs/windows-setup.md): PowerShell bootstrap, experimental
  platform limits, and separate desktop-user activation.
- [Stepped playtesting](docs/stepped-playtesting.md): play directly, inspect
  real frames, diagnose a failure, rebuild, and repeat the relevant steps.
- [Recordings and checkpoints](docs/recorded-playtesting.md): optional input
  history, preserved attempts, same-build checkpoints, review, and clips.

For agents and plugin maintainers:

- [Setup skill](skills/modretro-chromatic-setup/SKILL.md): prepare requested dependencies
  before MCP is available, then complete supported installation and verification.
- [Agent operating guide](docs/agent-guide.md): project access, tool usage,
  native authoring, official browser previews, building, and emulator workflows.
- [Project authoring skill](skills/modretro-chromatic-authoring/SKILL.md): safe native
  project and resource editing.
- [Pixel art skill](skills/modretro-chromatic-pixel-art/SKILL.md): native sprites,
  backgrounds, palettes, and hardware-aware artwork.
- [ROM debugging skill](skills/modretro-chromatic-rom-debugging/SKILL.md): authentic
  builds, emulator inspection, and evidence-backed debugging.
- [Chromatic deployment skill](skills/chromatic-deployment/SKILL.md): device
  discovery, host-streamed demos, and approved homebrew cartridge writes.
- [Architecture and security model](docs/architecture.md): ownership,
  authorization, indexing, and integration boundaries.
- [Runtime validation](docs/runtime-validation.md): maintainer verification of
  project builds and emulator behavior. Its npm checks require a development
  checkout; do not run them inside an installed payload.

## Development

In a trusted source checkout with Node/npm available, install the locked
development dependencies and build before preparing a distribution:

```sh
npm ci
npm run build
```

```sh
npm run dev             # Start the TypeScript server in watch mode.
npm run check           # Type-check the project.
npm run validate        # Type-check, test, and build the complete plugin.
npm run test:native-project  # Verify a real official native game project build.
```

### Packaging

To create an uploader ZIP on a POSIX maintainer host after building:

```sh
npm run package:upload -- --output-root /absolute/path/to/new-output
```

This creates a compact universal ZIP with all six pinned Chromatic CLI builds
available offline. It keeps the starter, Signal Lost, and Hello Color examples;
Wrecklight remains an optional repository template. Compression uses Node's
built-in Brotli support, with no extra compression tool or CLI download.
Executables, complete supplier notices and device artwork use separate,
authenticated streams. Reading a notice or showing the preview does not decode
or launch a CLI executable. The images keep their original WebP bytes and URLs;
source maps remain included.

Read a complete supplier notice offline from the extracted plugin directory:

```sh
node scripts/chromatic-runtime.mjs --notices darwin-arm64
```

Use `darwin-arm64`, `darwin-x64`, `linux-arm64-gnu`, `linux-x64-gnu`,
`win32-arm64`, or `win32-x64`. Any target can be read on any supported Node host,
without a device or setup. Redirect stdout to a new file outside the plugin if
you want to save it. A requested CLI invocation also places its unchanged notice
beside the verified executable in the owned cache.

Upload the resulting `modretro-chromatic-plugin-for-codex-<version>-universal-upload.zip`.
It contains the plugin at ZIP root, including the hidden manifest, MCP configuration,
the square Chromaguy icon and portable executable modes. Keep the separately staged
`distribution.json` as the file inventory; it is not part of the upload. Existing
ZIPs are never overwritten, so choose a new output directory for another package.

To stage the compact directory without a ZIP, use
`npm run prepare:distribution -- --compact --output-root /absolute/path/to/new-output`.
Compact packaging is universal. Add `--target darwin-arm64` to `package:upload`
for the existing full platform-specific ZIP instead; an explicit target keeps
the raw single-platform format and the Wrecklight template.
These are maintainer commands, not first-run setup. Windows can consume a matching distribution but cannot stage
portable archives because its file modes cannot preserve the pinned POSIX modes.
`npm run prepare:plugin` remains the separate local update path and binds absolute
runtime/toolchain locations.

The source checkout also retains [historical review records](https://github.com/OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex/tree/main/docs/reviews).
They describe their reviewed revisions and are excluded from distributed
packages. Current tool contracts come from the running server's discovered
schemas and the maintained guides above.

The Signal Lost authoring and acceptance scripts under `scripts/dogfood-*.mjs`
are development tools. They require this checkout and its dependencies; see the
[sample's maintenance notes](examples/dogfood-signal-lost/README.md#maintain-the-sample)
before running them.

## Developer Mode activation

Use the official [ModRetro Updater](https://support.modretro.com/en_us/articles/chromatic-firmware-updater-ryhoYnzCx)
for Developer Mode activation. The plugin does not collect activation codes or
manage activation. After completing the updater workflow, return to the plugin
for fresh device selection and the normal flash confirmation. An earlier failed
or uncertain write is not retried automatically.


## License

This plugin is available under the [MIT license](LICENSE). Included examples
and cartridge-runtime components retain their
[third-party notices](THIRD_PARTY_NOTICES.md). GB Studio, GBDK, and the
separately installed PyBoy emulator retain their respective licenses; PyBoy is
LGPL-3.0-only. Do not redistribute commercial game ROMs or proprietary boot ROMs.
