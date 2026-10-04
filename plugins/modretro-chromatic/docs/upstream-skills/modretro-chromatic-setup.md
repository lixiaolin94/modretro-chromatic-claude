---
name: modretro-chromatic-setup
description: Prepare missing game compiler or emulator dependencies for an installed ModRetro Chromatic plugin, or diagnose tools that cannot start.
---

# Prepare game dependencies

Follow the shared [agent guide](../../docs/agent-guide.md).

Codex manages plugin installation and updates. A working plugin must not be
recreated, registered in another marketplace, or reinstalled to obtain a compiler.
Never edit installed manifests, MCP configuration, receipts or plugin-cache files.
Do not invoke Plugin Creator, register-personal-plugin, prepare-plugin-payload,
or `codex plugin add` during game dependency setup.

## Diagnose the failed step

Call `toolchain_doctor` when available. Authoring/device tools, compiler dependencies,
emulator dependencies, project selection and Developer Mode are separate.
For PROJECT_SELECTION_REQUIRED select the intended project; do not reinstall.
For missing compiler/emulator dependencies use the packaged commands below.
If MCP cannot start, report the concrete launcher error; do not manufacture a
replacement plugin. Codex must supply the initial Node executable.

## Install only missing dependencies

Prefer `toolchain_prepare {"components":["build"]}` for missing compiler tools,
or `["emulator"]` for local play, or both. It plans and prepares dependencies
without replacing the plugin. Show one concise progress update, then continue
the original build/preview after success. Inspect incomplete results before any
retry; a refusal is not permission to switch callers.

If this tool is unavailable, use the exact Node executable and setup command returned by `toolchain_doctor`.
The installed self-contained package retains its own runtime. Even legacy
`--components runtime,build` requests skip runtime replacement in this package.

- Build or preview a game: `--components build`.
- Play an existing ROM: `--components emulator`.
- Build and playtest: `--components build,emulator`.
- Add `desktop` only when the visual editor is requested.
- Source editing or flashing an existing ROM needs no compiler setup.

Run `node <installed-plugin>/scripts/setup.mjs plan --components build --json`,
then `apply --components build --yes --json`, then
`doctor --components build --probes cli-version,gbdk-version --json`.
Substitute the exact executable/path and requested components; quote paths with
spaces. On PowerShell prefix the quoted executable with `&`.
A request to build/play includes necessary dependency setup; do not create an
extra approval step. Preserve real access refusals and unresolved installer locks.

Use the same stable dependency root for all commands. By default this is
`~/Library/Application Support/modretro-chromatic` on macOS,
`%LOCALAPPDATA%/modretro-chromatic` on Windows, and
`${XDG_DATA_HOME:-~/.local/share}/modretro-chromatic` on Linux.
The launcher reads its `toolchain` subdirectory independently of plugin version.
An explicit GB_STUDIO_SETUP_ROOT selects another root; preserve configured roots.
Do not silently repoint or overwrite an independently configured toolchain.
Reuse setup-owned components; never take over an unowned nonempty directory.

After setup, continue the actual requested build in the same installed plugin.
Do not follow legacy docs into local-payload generation or marketplace registration.
Verify a real project build; metadata readiness alone is not completion.

## Device activation and playtesting

Activation is external: link to the official
[ModRetro Updater](https://support.modretro.com/en_us/articles/chromatic-firmware-updater-ryhoYnzCx).
Never collect activation codes or infer code validity from a generic write failure.
Use the deployment skill for installation confirmation and unknown-write recovery.

Use the built-in browser for previews unless the user explicitly selects another
browser. When browser play is unavailable, use the exact ROM with the supported
local emulator; see [stepped playtesting](../../docs/stepped-playtesting.md).
