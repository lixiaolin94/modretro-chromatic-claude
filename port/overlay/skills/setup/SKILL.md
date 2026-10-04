---
name: setup
description: Prepare missing Game Boy compiler (GB Studio CLI, GBDK) or PyBoy emulator dependencies for the ModRetro Chromatic plugin, install the ModRetro Chromatic device CLI, or diagnose plugin tools that cannot start.
---

# Prepare game dependencies

Follow the shared [agent guide](../../docs/agent-guide.md). Port-specific
differences are in [CLAUDE-PORT.md](../../CLAUDE-PORT.md).

Claude Code installs and updates this plugin (`/plugin`). A working plugin must
not be recreated, re-registered or reinstalled to obtain a compiler. Never edit
installed manifests, `.mcp.json`, receipts or other plugin-cache files by hand.
Do not run `register-personal-plugin`, `prepare-plugin-payload` or any `codex`
command; they belong to the Codex distribution.

The MCP tools come from this plugin's `modretro-chromatic` server. In Claude
Code their full names are `mcp__plugin_modretro-chromatic_modretro-chromatic__<tool>`
(for example `…__toolchain_doctor`).

## Diagnose the failed step

Call `toolchain_doctor` when the tools are available. Authoring/device tools,
compiler dependencies, emulator dependencies, project selection, the device CLI
and Developer Mode are separate.

- `PROJECT_SELECTION_REQUIRED`: select the intended project; do not reinstall.
- Missing compiler/emulator dependencies: install them as below.
- No `modretro-chromatic` tools at all: the MCP server did not start. Check
  `node --version` (Node.js 22 or newer must be on the PATH Claude Code uses),
  then run `node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" doctor --json` and
  report the concrete launcher error. Suggest `/mcp` to reconnect after a fix.
  Do not manufacture a replacement plugin.

## Install only missing dependencies

Prefer `toolchain_prepare {"components":["build"]}` for missing compiler tools,
`["emulator"]` for local stepped play, or both. It plans and prepares
dependencies in a separate setup root without touching the plugin. Show one
concise progress update, then continue the original build or preview. Inspect
an incomplete result before any retry; a refusal is not permission to switch
callers.

First-time setup downloads GB Studio, GBDK, Python/PyBoy and friends and can
take several minutes. If the MCP call times out (Claude Code's MCP tool timeout;
users can raise it with the `MCP_TOOL_TIMEOUT` environment variable, in ms), run
the same packaged setup through Bash instead, in the background if it is slow:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" plan  --components build --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" apply --components build --yes --json
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup.mjs" doctor --components build --probes cli-version,gbdk-version --json
```

- Build or preview a game: `--components build`.
- Play an existing ROM headlessly: `--components emulator`.
- Build and playtest: `--components build,emulator`.
- Add `desktop` only when the user wants the GB Studio visual editor.
- Source editing or flashing an existing ROM needs no compiler setup.

A request to build or play includes the necessary dependency setup; do not add
an extra approval step for these open-source toolchain downloads. Preserve real
access refusals and unresolved installer locks.

Use the same stable dependency root for all commands. By default it is
`~/Library/Application Support/modretro-chromatic` on macOS,
`%LOCALAPPDATA%/modretro-chromatic` on Windows and
`${XDG_DATA_HOME:-~/.local/share}/modretro-chromatic` on Linux (shared with the
Codex distribution if both are installed). An explicit `GB_STUDIO_SETUP_ROOT`
selects another root. Reuse setup-owned components; never take over an unowned
non-empty directory. Verify a real project build afterwards; metadata readiness
alone is not completion.

## Install the ModRetro Chromatic device CLI (hardware only)

Only `device`, `setup`, `play`, `flash` and `device_capture` need it; building,
previews and emulation do not. Unlike the Codex distribution, this port does not
bundle ModRetro's proprietary CLI. Check it with:

```sh
node "${CLAUDE_PLUGIN_ROOT}/scripts/claude/chromatic-cli.mjs" status
```

If it is not installed, tell the user once that it downloads ModRetro's
closed-source `@modretro/chromatic-cli-<platform>@1.2.1` (license UNLICENSED,
ModRetro's terms apply) from the npm registry and verifies it against pinned
SHA-256 values. After the user agrees, run `install --yes`. The verified files
are cached in their own folder (`modretro-chromatic-claude` next to the
dependency root; override with `MODRETRO_CHROMATIC_CLI_CACHE`), and a
SessionStart hook restores them offline after plugin updates. No restart is needed; device tools resolve the CLI per
call.

## Device activation and playtesting

Activation is external: link to the official
[ModRetro Updater](https://support.modretro.com/en_us/articles/chromatic-firmware-updater-ryhoYnzCx).
Never collect activation codes or infer code validity from a generic write
failure. Use the [deployment skill](../deployment/SKILL.md) for device actions
and unknown-write recovery.

Open previews in the host's built-in browser (the Browser pane in the Claude
Code desktop app); in a terminal session give the user the URL. When browser
play is unavailable, use the exact ROM with the local emulator; see
[stepped playtesting](../../docs/stepped-playtesting.md).
