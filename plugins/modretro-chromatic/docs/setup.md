> **Store-installed self-contained packages (1.0.29+):** use the
> [dependency setup skill](../skills/modretro-chromatic-setup/SKILL.md).
> Codex owns installation and updates. Run setup with `build` and/or `emulator`
> only; the launcher automatically uses the stable per-user toolchain directory.
> Do not generate/register a replacement plugin. The legacy runtime/payload
> sections below apply to development distributions, not store dependency repair.

# ModRetro Chromatic: setup

The [ModRetro Chromatic plugin](../README.md) can author, build, and
directly playtest games without the GB Studio desktop editor. The plugin ships
installers and a shared dependency catalog, not every third-party binary.
Necessary dependency preparation is part of an authorized request to create,
build, or preview a game, unless the user limits downloads or changes. Codex
performs that setup in a separate owned dependency directory and asks only for
missing scope or required platform permission.

The plugin ZIP does not include the standalone GB Studio compiler or PyBoy
emulator. Setup installs the pinned GB Studio 4.3.2 compiler and PyBoy 2.7.0
separately when the requested components need them. The bundled Chromatic
device CLI is a separate supplier component; its embedded Binjgb runtime and
required third-party notices remain intact.

Ask Codex for the work you want to do:

> Use the ModRetro Chromatic plugin to make a small playable game and show me
> its browser preview. Prepare any missing dependencies in a dedicated tools
> folder.

The [setup skill](../skills/modretro-chromatic-setup/SKILL.md) runs the existing setup
entrypoints and carries the result through supported activation. It can start
without a working MCP server. The commands below are reference instructions
for Codex and maintainers; users do not need to copy them into a terminal.
No manual Node/npm installation is required: the OS-shell setup entrypoint can
prepare the pinned runtime. The portable MCP configuration itself invokes
`node`, so on a host without Node it remains unavailable until Codex completes
first-use setup and installs the generated machine-local plugin payload. This
is not automatic bootstrap by the MCP launcher.

## Obtain and add the compiled release

The distributor must provide a compiled bundle for the recipient's platform,
its version, source commit, and a checksum. Get the actual release asset or
reviewed local bundle from the project maintainer. Do not invent a download URL
or treat a Git clone/source archive as a compiled release: this repository does not commit
`dist`. Publication of a downloadable release is a separate delivery step.

The first-install bundle uses Codex's supported local marketplace layout:

```text
release-root/
  .agents/plugins/marketplace.json
  plugins/modretro-chromatic/
    .codex-plugin/plugin.json
    .mcp.json
    dist/
    scripts/
    skills/modretro-chromatic-setup/SKILL.md
```

Its marketplace entry points to `./plugins/modretro-chromatic`. Keep the complete
bundle together when extracting it. In a Codex host with local marketplace
support, open **Plugins → Add a marketplace**, supply `release-root`, then
install **ModRetro Chromatic** from that marketplace. This
initial UI operation does not require a terminal command or global Python.
Do not use a hosted plugin-upload action as a substitute for this native stdio
plugin's local installation.

In a fresh task, invoke the setup skill from the installed plugin. The host
loads skills separately from MCP status, and dependency setup itself does not
use MCP. An initially unavailable Node or MCP server is still a setup problem
to report; source-level separation is not proof of cold-host skill discovery.
If discovery is unavailable, an explicit request to read the supplied
`plugins/modretro-chromatic/skills/modretro-chromatic-setup/SKILL.md` is a file-directed setup
route. Distinguish that result from a discovered skill.

This initial installation exposes the setup instructions; it is not the final
machine-local binding. The registrar refuses to overwrite the real plugin
directory in a downloaded bundle. After dependency preparation, use the
explicit local-marketplace transition below, in the same desktop profile.
Keep the original bundle untouched and identify each installation by its
actual marketplace and plugin ID, not just its display name.

## Upgrade from codex-gb-studio

Version 0.5.6 uses **ModRetro Chromatic**, plugin/package ID `modretro-chromatic`,
and MCP server key `modretro-chromatic`. Older versions use `codex-gb-studio`
and `gb-studio`. Codex treats these as separate plugins, not an in-place rename.

1. Finish active games, previews, setup runs, and device operations through their
   original sessions. Resolve uncertain device writes before starting another.
2. Disable or uninstall the old plugin through Codex's supported controls.
   Removing an entry alone does not confirm that its old processes have closed.
3. Prepare and install the new package, then start a fresh task and verify its
   identity and callable tools. Do not enable both identities together.

New installations default to a `modretro-chromatic` dependency directory.
Nothing automatically moves, deletes, or adopts an older `codex-gb-studio`
directory. To reuse one that setup already owns, explicitly select it with
`--root` or `GB_STUDIO_SETUP_ROOT` and review the plan. Compatible dependencies
can be reused; the old plugin runtime is not the new package and must be
prepared for this release. Keep any old runtime needed by an active session.

Registration adds a new `modretro-chromatic` entry and leaves the old entry,
link, and unrelated plugins intact. Existing marketplace names stay unchanged;
use the actual marketplace name returned by registration when installing.

Some names deliberately remain compatible: `GB_STUDIO_*` configuration,
`.gb-studio-setup.json` and its ownership schema, project locks/revision hashes,
and `~/.codex-gb-studio/chromatic` device-operation records. Do not rename or
clear them. Actual upstream `gb-studio` compiler names, application paths and
third-party credits also remain accurate.

Version 1.0.2 names the skills `modretro-chromatic-authoring`,
`modretro-chromatic-pixel-art`, and `modretro-chromatic-rom-debugging`, alongside
`modretro-chromatic-setup`. The first-party extension now lives in
`native-game-plugin/plugins/modretro-chromatic/`; its event IDs are unchanged.
Compiler installer entrypoints are `scripts/setup-compiler.mjs` and
`scripts/setup-compiler.sh`, with the `npm run setup:compiler` shortcut. Use these
new package paths; existing project copies and upstream compiler files are not
automatically moved.

### Preview an existing project

After upgrading, ask Codex to open your existing `.gbsproj` with the current
plugin. Keep custom launchers such as `tools/preview.mjs` and project scripts
intact; the plugin does not need to rewrite them to preview your game.

Codex should use these public tools in order:

1. `session_status {}` to check the current session. Finish any active operation
   through its original session before switching projects.
2. `project_select {"projectPath":"/absolute/path/to/game.gbsproj"}` to select
   the existing project within the authorized workspace.
3. `project_inspect {}` to confirm the selected project and source.
4. `toolchain_doctor {"tasks":["projectBuild"]}` to check build dependencies.
   Omit `probes` for this passive check. Missing dependencies need the setup
   flow below; metadata readiness alone does not prove a successful build.
5. `web_preview {"outputPath":"build/current-preview"}` to build or reuse an
   authenticated official browser export, then open its returned URL in
   Codex's built-in browser.

This path uses the official GB Studio `make:web` compiler and the current
plugin's player controls. It does not run your npm scripts or import behavior
from a custom preview launcher. Keep the launcher and game source unchanged;
any custom behavior still needs a separate review. For a physical Chromatic
feed, use `device_capture {"action":"open_settings"}` instead of modifying a
browser launcher.

## Start before MCP is available

Obtain a trusted, readable compiled plugin package through an authorized
distribution path. Repository access and Codex plugin installation are separate
from dependency setup; a private repository does not become public through this
installer. A source checkout must first be built by its maintainer.

Use the scripts in that package, including when it is an immutable installed
payload. Do not run `npm install` or `npm run setup` in the plugin cache: prepared
payloads intentionally have empty npm scripts, and changing their bytes can
invalidate verification.

On macOS/Linux, start with the packaged POSIX-shell entrypoint:

```sh
sh "/absolute/path/to/plugin/scripts/setup.sh" doctor --components runtime,build
sh "/absolute/path/to/plugin/scripts/setup.sh" plan --root "$HOME/chromatic-tools" --components runtime,build
```

On Windows x64, use PowerShell 5.1+; see [Windows setup](windows-setup.md):

```powershell
powershell.exe -NoProfile -File "C:\path\to\plugin\scripts\setup.ps1" doctor --components runtime,build
powershell.exe -NoProfile -File "C:\path\to\plugin\scripts\setup.ps1" plan --root "C:\chromatic-tools" --components runtime,build
```

The OS shell and its download/archive facilities must be available. The launchers
do not assume a Node runtime bundled with Codex or inherited by MCP. They check
an available Node with `--version`; this bootstrap-prerequisite check is disclosed
separately from component probes. If no compatible Node is available, the result
is **bootstrap-only**, showing the pinned official Node download and destination,
not a complete dependency diagnosis. `doctor` and `plan` never install Node.

These examples prepare a playable game and its browser preview. Choose the
components below for other work. Review the plan against the user's request;
necessary setup does not require a fresh confirmation at every step. Keep
doctor and plan passive, then apply the authorized plan. For example, on
macOS/Linux:

```sh
sh "/absolute/path/to/plugin/scripts/setup.sh" apply --root "$HOME/chromatic-tools" --components runtime,build --yes
sh "/absolute/path/to/plugin/scripts/setup.sh" doctor --root "$HOME/chromatic-tools" --components runtime,build --json
```

PowerShell accepts the same positional commands and `--options`. `--yes` records
the caller's explicit setup choice; it must not be inferred from a lifecycle
hook, a connected MCP server, or whether a shell approval prompt appears.

## Choose capabilities, not a desktop application

Pass `--components` explicitly rather than relying on the broader
`runtime,build,emulator` default. Use `runtime` for source inspection or edits
without a build, or Chromatic device tools with an existing ROM;
`runtime,build` to create or iterate a playable game, compile it, or show an
official browser preview; `runtime,emulator` to playtest an existing ROM;
and `runtime,build,emulator` for the edit/build/play loop. Add `desktop` only
when the user wants the visual editor. Use the same selection and `--root`
for plan, apply, and the follow-up doctor.

| Component group | What setup prepares | Required for |
| --- | --- | --- |
| `runtime` | Compiled plugin and locked production npm dependencies | Project inspection/authoring, ROM inspection, and Chromatic device tools through MCP |
| `build` | Official GB Studio CLI and GBDK | Native game project builds and official browser exports |
| `emulator` | Isolated Python, PyBoy, and Pillow; managed uv when needed | Direct stepped play and real-frame observation |
| `desktop` | Optional official GB Studio editor distribution | Visual editing in the desktop application |

Node is the prerequisite for the shared setup manager and MCP runtime. A
standalone C build needs GBDK but does not establish project-build readiness.
The doctor task `play` describes the complete edit/build/play path, including
the build dependencies; emulator-only setup does not make that whole path ready.
Official browser playback uses Binjgb from the CLI export, not PyBoy.
The public Chromatic `setup` tool handles driver installation and cartridge
detection; it does not prepare the plugin's dependencies. Device actions keep
their own [selection and consent requirements](chromatic-device-testing.md).

New installs use the catalog pins below. Compatible healthy dependencies in the
owned root can be reused; install pins and compatibility requirements are not
the same claim.

| Dependency | New-install version | Compatibility requirement |
| --- | --- | --- |
| Node.js | 24.15.0, with its npm | Node 22+; runtime preparation also needs a compatible sibling npm |
| GB Studio CLI / optional editor | 4.3.2 | 4.3.2 |
| GBDK | 4.5.0 | 4.5.0 |
| Python | Managed CPython 3.13.12 | Isolated Python 3.13 |
| PyBoy | 2.7.0 | 2.7.0 |
| Pillow | 12.3.0 | 11.x or 12.x |
| uv | 0.12.6 | Installer-only; unnecessary when the emulator is already healthy |

The CLI is built from pinned official GB Studio and GBVM source archives with
pinned Yarn 4.4.1. This path does not require Git, Corepack, or a global Yarn
installation. Source archive hashes and build provenance are retained; no
game-engine patch is part of setup. Runtime npm installation uses the packaged
public-registry production lock with lifecycle scripts disabled. This is not a
claim that every downloaded dependency or reused installation is byte-identical.

## Read doctor results correctly

The shell entrypoints, `scripts/doctor.mjs`, setup planning, and MCP
`toolchain_doctor` use the same dependency definitions. After the launcher has a
Node runtime, default detection reads bounded files and version metadata; it
does not run compilers, import Python packages, load a ROM, or install anything.

Each component reports `ready`, `missing`, `broken`, `incompatible`, or
`unsupported`, its required and detected version, selected path, provenance,
evidence, and next steps. `ready` means **compatible metadata**, not executable
health or a successful game build. Missing version evidence is not silently
treated as readiness.

Task readiness is separate for `authoring`, `projectBuild`, `cBuild`, `play`, and
`desktop`. Overall `ready` requires every requested task, not “CLI or GBDK.” The
optional editor and installer-only uv do not block tasks that do not need them.

When executable checks are wanted, name them explicitly:

```sh
sh "/absolute/path/to/plugin/scripts/setup.sh" doctor --root "$HOME/chromatic-tools" --components runtime,build,emulator --probes cli-version,gbdk-version,emulator-import
```

Or, once MCP is running:

```text
toolchain_doctor {"tasks":["authoring","projectBuild","play"]}
toolchain_doctor {"tasks":["play"],"probes":["cli-version","gbdk-version","emulator-import"]}
```

These bounded probes execute only CLI `--version`, GBDK `-v`, and isolated
Python imports respectively. Their results and `probesPassed` remain separate
from metadata readiness. They do not build a project or boot an emulator ROM.
`plan` and `--dry-run` reject probes and perform no installation or component
probe; `--dry-run` selects the passive plan even when supplied with `apply`.

## Roots and immutable packages

Without `--root`, doctor inspects configured runtime/toolchain bindings or the
package's local-payload receipt. That is inspection, not permission to repair
those locations. With `--root`, doctor inspects that managed target instead.
Plan/apply always target the owned setup root, not an existing bound toolchain.

The passive shell doctor can also run from `<root>/runtime` with the enclosing
`--root`. It still requires the setup ownership marker and never changes that
root. Use the original compiled package outside the managed root for plan,
apply, or doctor with executable `--probes`.

Choose an absolute, dedicated `--root` outside the plugin package and immutable
cache. It must not enclose the plugin either, except for passive doctor above.
Setup accepts a new/empty directory or one carrying its ownership marker.
It refuses nonempty unowned roots and redirected setup paths; do not use a game
directory or select an existing shared toolchain for
adoption. `GB_STUDIO_SETUP_ROOT` selects the default managed root. Otherwise:

| Platform | Default dependency root |
| --- | --- |
| macOS | `~/Library/Application Support/modretro-chromatic` |
| Linux | `$XDG_DATA_HOME/modretro-chromatic`, or `~/.local/share/modretro-chromatic` |
| Windows | `%LOCALAPPDATA%\modretro-chromatic` |

The root contains separate `node`, `runtime`, `toolchain`, staging/cache,
receipt, and payload locations. Yarn uses one archive cache inside this root;
separate setup roots remain isolated. Each toolchain still needs its own
`node_modules`. Setup does not migrate or delete older caches.

Setup does not change global Python, shell
profiles, `PATH`, OS application registration, marketplaces, installed plugin
bindings, or active MCP sessions. Keep prepared dependency paths available if
a later installation binds to them.

## Failure, retry, and cancellation

Apply serializes work through the selected root's `.setup-lock`. A second apply
fails with the lock information; it never steals the lock or kills its owner.
After a crash, verify that the recorded process has ended before preserving or
moving the stale lock. Do not remove a lock just to make another run proceed.

Per-component outcomes and errors remain in `runs/<run-id>.json` and
`last-run.json`; component receipts record owned destinations and preparation
state. Successful earlier components remain available after another component
fails. Inspect the error, resolve its cause, then repeat the same explicit apply
command. Healthy tools are checked and reused. Known-owned partial destinations
are preserved in quarantine before repair; unowned occupied paths are not
overwritten. Damaged/partial downloads must pass pinned verification before use.

Cancel with the normal terminal interrupt. Setup stops its owned subprocesses,
retains completed/partial outcomes, and releases its own lock when possible.
Read any cleanup error separately: cancellation is not a rollback of everything
already installed. After a forced process exit, inspect retained state before
retrying. Never stop unrelated Node, Python, compiler, or game processes.

Some optional desktop archives contain links that the bounded extractor will
not materialize. Such a result is `manual-step-required` or
`downloaded-not-installed`, with the retained archive and next steps—not a ready
editor. Setup never launches the desktop application.

## Preparation is not activation or gameplay acceptance

A completed apply with a ready runtime prepares a new immutable payload under
`payloads/` and writes `prepared-mcp.json` for a future launch. The result names
the exact payload and bindings. It does not install, replace, enable, or refresh
the plugin in Codex. Continue authorized registration and installation needed
for the requested game workflow; a request only to prepare dependencies is not
activation authority. The generated configuration selects the chosen Node
executable directly (managed Node on a fresh host), so later MCP startup does
not depend on a user-installed Node being on `PATH`.

### Keep distributions and local updates distinct

The compact universal package includes all six Chromatic CLI builds in a
compressed offline bundle. This does not change the supported setup platforms.
Build and emulator dependencies still use the explicit setup flow above.

A **portable compiled distribution** carries the compiled plugin,
skills, setup entrypoints, and distribution manifest. It does not bind the
producer's absolute runtime or toolchain paths. The enclosing release bundle
adds the local marketplace metadata. Prepare dependencies on the recipient
host before expecting working MCP tools; installing the bundle does not
promise that Node or the MCP server will start automatically there.

A **local update payload** uses `+codex.payload.<hash>` and binds exact local
Node/runtime/toolchain paths in its receipt. Keep those paths available. Do not
copy that payload to another machine as a portable release, edit its launcher,
or run the generic `update_plugin_cachebuster.py` on it. Prepare a new payload
from the selected compiled source for changed bindings instead.

The payload suffix identifies those local bindings, not a source commit or a
new public release. Use the distributor's version, source commit and bundle
checksum when comparing an installation with a reported issue.

### Agent steps for registration and installation

Use the host's supported plugin installation capabilities. The existing
personal-marketplace registrar is one route when a trusted host Python and
the Plugin Creator marketplace helper are available:

For the first-install bundle above, select a separate machine-local marketplace
at `<root>/marketplace`; pass that explicit `--marketplace-root`. For an
existing managed installation, retain its known marketplace and owned link
instead. The registrar can replace a verified owned link with authorized
`--replace-link`, but never a real plugin directory. Do not silently fall back
to another marketplace or rewrite the bundle's entry.

Payload preparation gives npm a temporary private cache, logs and configuration
under the selected payload output directory. Explicit npm configuration and
network policy are preserved; the default user cache is not changed. A dry run
removes its temporary inspection files and creates no payload or marketplace.

1. Obtain a verified absolute Python 3.10+ executable from the host. A Codex
   desktop host may expose its bundled dependency-runtime instructions; that
   capability can be disabled or unavailable. Runtime-only setup does **not**
   install Python or a Codex command. Do not guess their paths or add the
   emulator merely to obtain Python.
2. Run that Python with `-I -B` and `scripts/register-personal-plugin.py` from
   the prepared `<root>/runtime` directory. Supply `--source <root>/runtime`,
   `--runtime-root <root>/runtime`, `--toolchain-root <root>/toolchain`,
   `--payload-root <root>/payloads`, the selected `--marketplace-root` when
   using an explicit marketplace, and `--json`. Prefix only this child's
   `PATH` with the directory of the returned Node executable. Do not change
   global `PATH`. The working directory must be `<root>/runtime`, not `<root>`:
   the registrar rejects executables located inside its working directory.
   On Windows, use the intended desktop user's normal profile. Personal
   registration requires `--confirm-user-profile`; an explicit marketplace
   uses `--marketplace-root` instead, never both. See
   [profile requirements](windows-setup.md#install-from-the-desktop-users-own-profile).
3. Retain the returned `marketplaceName`, `marketplaceRoot`, `marketplacePath`, `pluginPath`,
   payload identity/bindings, and `handoff` argument arrays. Registration reports
   `installed:false`. Validate the marketplace name with the host Plugin
   Creator skill's `scripts/read_marketplace_name.py`, using the same trusted
   Python and `--marketplace-path` for the selected marketplace. Check it even
   when the registrar reused an existing entry; do not invent the name.
4. For the initial bundle flow, use Codex's supported **Uninstall** action on
   the exact bootstrap installation, identified by its actual marketplace and
   plugin ID. Verify it is no longer installed/enabled before installing the
   machine-local entry. Preserve the bundle for rollback; do not delete or
   overwrite it. Uninstall does not prove that an old task's backend process
   has closed, so settle any active work separately.
5. Use an actually available, supported host Codex executable for the returned
   marketplace/install/list arguments. If no such command is available, add an
   explicit marketplace through **Plugins → Add a marketplace**, supplying the
   returned `marketplaceRoot`, then install the exact returned plugin and
   marketplace entry. Use the personal-marketplace **View** UI only for the
   default personal route. Do not install
   an unrelated user CLI, copy `codex.exe` between profiles, or treat
   `prepared-mcp.json` or the dependency root as a marketplace. If the host
   cannot complete this route, report the missing capability and retain the
   prepared result.

Use existing authorization for the selected registration and installation;
ask only when scope is missing or the platform requires approval. Do not switch
an active game's runtime underneath it. Verify the exact installed/enabled
plugin identity, then check read-only `session_status` and the relevant
`toolchain_doctor` tasks in a **fresh Codex task**. Starting a new task alone
does not install or activate a plugin, and an on-disk receipt does not prove
tools were loaded. Keep preparation, registration, installation, and callable
verification as separate results.

Packaged targets are macOS and Linux x64/arm64, plus experimental Windows x64.
Windows ARM64 is unsupported. A targeted `linux-*-gnu` distribution requires
glibc 2.39+ during runtime preparation and MCP startup, even for
`--components runtime` and authoring-only use. A universal distribution leaves
non-hardware authoring startup available without that vendor libc gate;
Chromatic device commands retain their supported-target checks. This does not
extend the setup platforms listed above.

Source tests, stubbed platform tests, a clean
dependency root on a prepared host, and a clean-machine native installation are
different evidence. A doctor probe is not an official build, and a build is not
direct gameplay acceptance. Report the actual platform and checks performed.

Existing checkout-oriented `setup:compiler`, `setup:emulator`, and Windows
front-door scripts remain advanced compatibility paths, not the primary
installed-payload workflow. Their `--dry-run` is detection/planning only;
`--use-existing` on a legacy sub-installer does not make every surrounding
preparation or registration step read-only.
