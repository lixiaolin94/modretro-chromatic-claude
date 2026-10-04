# ModRetro Chromatic: Windows setup

> **Claude Code port:** this page describes the original Codex distribution. In the Claude Code port, Claude Code installs and updates the plugin (`/plugin`), so ignore marketplace registration, local payload, `register-personal-plugin` and `codex plugin` steps. Dependency commands (`scripts/setup.mjs doctor|plan|apply`, `toolchain_doctor`, `toolchain_prepare`) work unchanged. See [CLAUDE-PORT.md](../CLAUDE-PORT.md).

This guide covers the [ModRetro Chromatic plugin](../README.md).

Windows x64 support is experimental. The plugin has portable setup and test
coverage, but a complete native Windows installation, official game build,
installed-plugin launch, and gameplay pass is still required. A successful
compiler check or tests run on macOS/Linux do not establish that whole Windows
workflow. Windows ARM64 is unsupported; Git Bash and WSL are not required.

## Use the packaged PowerShell entrypoint

Ask Codex to use the [setup skill](../skills/modretro-chromatic-setup/SKILL.md) and
[shared setup flow](setup.md). The commands here are agent-run or advanced
reference examples, not terminal work required of every user.

Start with a trusted, readable compiled package and PowerShell 5.1+. The new
`scripts/setup.ps1` entrypoint works before MCP starts; it does not require Git
Bash, WSL, preinstalled Python/uv, or the optional GB Studio desktop editor.
Git and Corepack are not prerequisites for its pinned-source CLI build.
If organizational policy prevents running a local script, use the approved
policy/support route rather than changing global execution policy in setup.

Inspect the current bindings, then a dedicated target root:

```powershell
$gbStudioSetupRoot = Join-Path $env:LOCALAPPDATA 'modretro-chromatic'
powershell.exe -NoProfile -File "C:\path\to\plugin\scripts\setup.ps1" doctor --components runtime
powershell.exe -NoProfile -File "C:\path\to\plugin\scripts\setup.ps1" plan --root $gbStudioSetupRoot --components runtime
```

The launcher checks a selected Node executable with `--version`. Without a
compatible Node 22+, it reports only the bootstrap boundary and pinned official
Node source/destination. Doctor and plan do not download or create the root.
They do not claim complete dependency discovery before Node can run the shared
manager. The bootstrap version check is distinct from opt-in compiler/Python
probes.

Review versions, sources, components, and paths before explicitly applying:

```powershell
powershell.exe -NoProfile -File "C:\path\to\plugin\scripts\setup.ps1" apply --root $gbStudioSetupRoot --components runtime --yes
powershell.exe -NoProfile -File "C:\path\to\plugin\scripts\setup.ps1" doctor --root $gbStudioSetupRoot --components runtime --json
```

The examples select only `runtime` for authoring. Use `--components runtime,build`
for builds/browser export, add `emulator` for automatic playtesting, or explicitly
add `desktop` for the visual editor. Omitting the component list defaults to
`runtime,build,emulator`; always select what the user requested. Repeat the
selected `--components` and `--root` on plan,
apply, and doctor so verification checks the capabilities you chose.
`--dry-run` selects a passive plan; it never installs or
runs component probes. See [the shared setup contract](setup.md) for exact pins,
readiness meanings, and `--probes cli-version,gbdk-version,emulator-import`.

Setup prepares an external runtime, verified official CLI/GBDK, and isolated
Python environment in a new or setup-owned root. It never adopts a nonempty
unowned directory, edits `PATH` or profiles, registers an OS application, or
invokes Codex. Use local drive paths, not UNC paths or network shares; prefer a
short `C:` path because upstream GBDK documents failures with spaces on other
drives. Existing shared toolchains and immutable caches are not repair targets.

The plugin cache deliberately has empty npm scripts. Run the packaged
PowerShell script directly; do not run npm installation/build commands in it.
A complete apply with a ready runtime returns a new future payload and writes
`prepared-mcp.json`. Registration, installation, and any active-session handoff
remain separate.

## Install from the desktop user's own profile

Preparation and registration are not installation. Use the intended desktop
user's profile and Codex configuration. Codex must verify that context before
registration; an agent or service account must not write another user's profile.
If that context is unavailable, report the host capability gap and use the
[supported host/UI handoff](setup.md#agent-steps-for-registration-and-installation).
Do not install an unrelated CLI or copy `codex.exe` from another profile,
plugin cache, or sandbox account to bypass this boundary.

The packaged dependency setup does not create a marketplace. After authorized
registration, use its actual marketplace name/root and handoff arguments. If
the intended host already supplies a supported Codex executable, the agent can
run that handoff. Otherwise, add the returned workspace `marketplaceRoot`
through **Plugins → Add a marketplace**, then install the exact plugin entry.
Use the personal-marketplace **View** route only for personal registration.
A separate Codex CLI installation is not a prerequisite.

For an already available CLI, these are advanced workspace-marketplace examples;
prefer the registrar's returned arguments rather than reconstructing them:

```powershell
codex plugin marketplace add "<absolute marketplace root>" --json
codex plugin marketplace list --json
codex plugin add "modretro-chromatic@<marketplace name>" --json
codex plugin list --marketplace "<marketplace name>" --json
```

Verify the returned marketplace root and installed plugin version, then start a
new Codex task and call `session_status` and `toolchain_doctor`. Check the actual
desktop plugin UI separately if visibility there matters. A prepared payload,
an `installed:false` registration receipt, or a successful marketplace command
does not establish that the plugin is installed, enabled, callable, or showing a
View button in another user's app. The
[official plugin commands](https://learn.chatgpt.com/docs/developer-commands#codex-plugin)
describe the JSON installation and listing fields.

Personal registration remains an advanced option. It needs Python 3.10+, a
trusted Node, explicit runtime/toolchain/payload roots when separate, and
`--confirm-user-profile` matching the intended desktop user. Use the registrar's
dry-run before its mutating command. It rejects known sandbox accounts and
never replaces a real user-owned directory; `--replace-link` is only for an
intentional switch of an existing plugin link or junction. Preserve active
consumers and the previous immutable payload during any handoff.

## What setup reuses and how it fails

The shared manager records component outcomes, rechecks compatible tools, and
retains successful stages when another fails. Downloads use pinned verification;
known-owned partial components are preserved before repair. Retry only after
reading the retained error and resolving its cause. A root lock serializes
installers; no stale lock is stolen and no process is killed merely because its
PID appears in a receipt. See [failure and recovery](setup.md#failure-retry-and-cancellation).

The optional editor may be retained as a verified archive with a manual extraction
step when its links cannot be safely materialized by the bounded extractor.
`downloaded-not-installed` is not desktop readiness; no editor is launched.

The installed payload contains only allowlisted plugin files. The larger Node
dependency tree, GB Studio CLI, GBDK, and PyBoy environment stay at stable local
paths; keep those paths available after installation. A generated payload's local
`version` may differ from its `sourceVersion`: its content ID also binds the
chosen Node, runtime, and toolchain paths, preventing a stale cached launcher
after a deliberate switch. Reprepare on another machine instead of copying a
machine-specific payload there.

A generated local payload also verifies its receipt-bound runtime root,
package release, and runtime-critical file hashes when it starts. If the backing
runtime changes or is rebuilt, a stale cached payload reports
`ModRetro Chromatic prepared runtime changed` and refuses to mix old skills with new
runtime code. Prepare a new runtime/payload and reinstall it through Codex; do not edit
the receipt, replace live backing files, or disable the check. Verify actual
callable tools after the intended task receives the new binding. Ordinary
standalone packages without a local payload receipt retain their existing
launch behavior.

## Advanced checkout compatibility

`scripts/setup-windows.ps1` and `npm.cmd run setup:windows` remain the older
checkout-oriented front door. Unlike the new `setup.ps1`, that route needs an
already prepared Node/npm environment and can build the checkout, use Git and
Corepack, prepare payloads, and explicitly register a marketplace. Its
`-DryRun`/`--dry-run` is a no-write plan. `-UseExisting` on its toolchain stage
does not make the surrounding npm/runtime/emulator/payload flow read-only.

An explicitly chosen workspace marketplace uses
`<marketplace-root>/.agents/plugins/marketplace.json` and a
`plugins/modretro-chromatic` junction to the payload. Its `source.path` is relative
to the marketplace root. Existing matching entries are reused and unrelated
entries preserved. Personal registration or changes to an existing marketplace
still require the supported helper and intended-user confirmation.

Private checkout access is separate: a connected GitHub app does not provide
credentials to a local Git command. Use the normal approved authentication flow;
never place a token in a command or URL. Do not change access or choose a public
distribution as an implicit workaround for a failed private clone.
