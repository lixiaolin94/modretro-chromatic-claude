# Game editor extensions and local builds

## Choose the smallest extension

1. Prefer existing scene types, actor/trigger scripts, variables, custom events, assets, and project settings.
2. Add a project-local JavaScript script-event plugin when creators need a reusable event in the visual scripting UI; custom commands belong to that extension and must not become privileged global event types.
3. Add an engine plugin when a behavior requires C/assembly runtime changes, configurable engine fields, or a genuinely new scene type.
4. Eject the engine only when authorized and necessary; it increases maintenance and upgrade cost.

Examples: a tactics combat scene can be its own plugin-defined scene type; an RPG shop transaction can often be expressed as existing events plus variables; a new camera/runtime behavior may require a targeted engine plugin. Prefer registering a new scene type over replacing a built-in one because overriding upstream behavior makes upgrades harder.

GB Studio plugins live inside a project's `plugins/` directory and can package assets, JavaScript-defined scripting events, engine configuration, or C/assembly source. Inspect both the installed GB Studio version and neighboring plugin examples before choosing the exact manifest/file shape. Do not assume a plugin format from another release.

Useful official references:

- [Project plugin formats, script events, and custom scene types](https://www.gbstudio.dev/docs/extending-gbstudio/plugins/)
- [Engine eject and upgrade implications](https://www.gbstudio.dev/docs/extending-gbstudio/engine-eject/)
- [Official plugin catalog](https://github.com/gb-studio-dev/gb-studio-plugins)

## Local desktop workflow

The normal creative loop is:

```text
GB Studio desktop editor ↔ real project resources ↔ Claude Code plugin/MCP tools
                                              ↓
                                    GB Studio CLI / GBDK
                                              ↓
                                 actual .gb or .gbc cartridge
                                              ↓
                               emulator screenshot and input
```

Use `toolchain_doctor` to inspect the official CLI, GBDK, runtime, and optional
editor/emulator components. Default readiness is compatible metadata, not
executable proof. Request `tasks:["projectBuild"]` for the native project path;
a ready standalone `cBuild` does not establish it. Named opt-in `cli-version`,
`gbdk-version`, and `emulator-import` probes execute only those bounded checks,
not a game build or ROM boot. Honor the reported roots and provenance; never
infer CLI availability from an app bundle or PyBoy health from a compiler check.

For missing dependencies, follow the [setup skill](../../modretro-chromatic-setup/SKILL.md)
and [Packaged setup](../../../docs/setup.md).
Run `setup.sh` or `setup.ps1` directly from the readable compiled package, review
`plan --root <absolute-owned-root> --components <requested-groups>`, then use
`apply --yes` for that same authorized selection. Reuse existing setup permission;
ask only for missing scope. The launchers cover the pre-Node boundary without
assuming MCP can already start. Choose `runtime` for authoring and add `build`,
`emulator`, or optional `desktop` only as needed. Do not write into the immutable
cache or change shared active toolchains. New preparation is not registration,
installation, or rebind.

Native Windows x64 is experimental; source/stub coverage is not a complete
real-host installation/build/gameplay pass. Follow
[Windows setup](../../../docs/windows-setup.md), without Git Bash or WSL.
The selected toolchain uses `.local/gbdk/bin/lcc.exe`, the official Node CLI,
and `.local/pyboy-venv/Scripts/python.exe`. Windows ARM64 is unsupported; prefer
short local `C:` paths. When `GB_STUDIO_MCP_PATH_VISIBILITY=workspace-only` is
configured, external runtime/toolchain paths are intentionally redacted in MCP
responses; that does not expand project authorization.

The official upstream CLI documents:

```text
gb-studio-cli make:rom path/to/project.gbsproj out/game.gb
gb-studio-cli make:pocket path/to/project.gbsproj out/game.pocket
gb-studio-cli make:web path/to/project.gbsproj out/
gb-studio-cli export path/to/project.gbsproj out/
gb-studio-cli export -d path/to/project.gbsproj out/
```

`export` produces a GBDK source project; `export -d` exports generated project data. `make:rom` is the appropriate genuine Game Boy/Game Boy Color build path. `make:pocket` and `make:web` are separate exports, not proof that a native GB/GBC cartridge was built.

For a quick scene-local check, the official desktop editor's **Run Scene**
uses a temporary starting scene and coordinates. When the project's Run Scene
selection-only option is enabled, that preview can compile the selected scene
set. This is a desktop preview, not a full-game regression from the authored
starting point. The supported CLI exposes no corresponding scene-start or
reduced-scene flag, so do not rewrite the user's starting scene or claim a
reduced CLI build. Keep full-game tests on the ordinary native build path.
See the [upstream desktop build implementation](https://github.com/chrismaltby/gb-studio/blob/ccb891b2670134ba8237416772eea4ed09d34e1e/src/store/features/buildGame/buildGameMiddleware.ts#L54-L72)
and [CLI commands](https://github.com/chrismaltby/gb-studio/blob/ccb891b2670134ba8237416772eea4ed09d34e1e/src/apps/gb-studio-cli/gb-studio-cli.ts#L123-L158).

For interactive browser play, prefer the first-class cached official export:

```text
web_preview {}
web_build {"outputPath":"build/browser-preview"}
web_preview {"outputPath":"build/browser-preview"}
web_preview_close {}
```

Open every `web_preview` or `device_capture` URL, including screenshot Open links, in **the host's built-in browser**. In the Claude Code desktop app that is the Browser pane (open the URL with its `preview_start`/`navigate` tool). If no built-in browser exists (for example Claude Code in a terminal), give the user the exact URL to open in their own browser; never post it anywhere else, and do not launch a browser from the shell unless the user asks. If the browser is blocked, retain the URL and report the concrete limitation.

The preview runs official `make:web` and serves the genuine Binjgb/WebAssembly
player with its actual cartridge at a private capability-authenticated
localhost URL. Reuse that URL while iterating; unchanged authenticated exports
do not recreate HTML or assets, including across MCP sessions, and source
changes refresh the same active preview. `force: true` explicitly requests an
authoritative refresh/rebuild. `web_build` produces the export without a server;
`web_preview_close` closes the server without deleting the cached build. Never
generate a substitute HTML emulator. PyBoy is the separate
[headless gameplay fallback](../../../docs/stepped-playtesting.md#when-browser-play-is-unavailable)
when the browser is unavailable; its frames do not verify browser playback.

Prefer the bundled build tool:

```text
rom_build {"projectPath":"<path-to-project.gbsproj>"}
rom_inspect {"romPath":"<returned-rom-path>"}
```

When the investigation requires authenticated same-build debug information,
request it explicitly from an official project build:

```text
rom_build {"projectPath":"<path-to-project.gbsproj>","captureDebugArtifacts":true}
```

The returned `debugArtifacts` identify the generated `symbols.noi`, `globals.i`,
and SHA-256 digests for both files and their exact ROM. Missing, malformed, or
mismatched artifacts fail the request instead of silently reusing another
build. A direct GBDK C-source probe cannot capture project-build artifacts.
Use those authenticated artifacts with the explicit source-aware mode described
in [Stepped playtesting](../../../docs/stepped-playtesting.md). ROM-only
testing remains available without them. Supported build layouts additionally
return `sourceProvenance` and `sourceDebugAbi`; otherwise inspect
`sourceDebugUnavailableReason` instead of guessing an engine layout.

The build tool may also support a direct GBDK C source path. A successful C compilation proves the local compiler works, but it does not prove that a `.gbsproj` or the user's actual scenes compiled. Report which path ran.

Official CLI builds retain exact stderr and return additive classified
`warnings` and bounded actionable `diagnostics`; `diagnosticsTruncated` reports
when more diagnostic records exist. The exact official-CLI `[DEP0190] DeprecationWarning` record is a
known dependency subprocess warning, not by itself proof of a failed build or
plugin shell injection. Unrelated warning text remains visible; GBDK does not
inherit the official CLI's classification. A nonzero compiler exit, missing
output ROM, invalid cartridge header, or bad Nintendo logo remains a failure.

Build commands must write generated cartridges only to authorized output
locations and leave authored resources plus existing tracked ROMs unchanged.
Replacing a tracked playable cartridge is a separate destructive operation that
requires explicit authorization. Runtime validation should preserve snapshots
of authored resources and existing cartridges before and after execution.

## Color and compatibility

- `mono`: monochrome original-Game-Boy-compatible project.
- `mixed`: color-enhanced project with a monochrome original-hardware fallback.
- `color`: Game Boy Color-only project; additional color-specific hardware features are available.

These are **native game project-setting values**. The ROM builder and cartridge inspector instead use `dmg`, `gbc`, and `gbc-only`, respectively. Do not pass a project-setting value to a ROM-build `colorMode` argument.

The filename extension alone is not authoritative; inspect the cartridge header's CGB flag. Color projects provide eight background palettes and eight sprite palettes, with four colors per palette; sprite index zero is transparent. Actual per-scene limits depend on engine allocation and selected mode, not just the theoretical hardware maximum.

## Source material

- [Upstream GB Studio CLI examples](https://github.com/chrismaltby/gb-studio#cli-examples)
- [Official ROM, web, and Analogue Pocket export documentation](https://www.gbstudio.dev/docs/build/)
- [Official project settings, color modes, and music drivers](https://www.gbstudio.dev/docs/settings/)
- [GBDK-2020 toolchain and examples](https://github.com/gbdk-2020/gbdk-2020)
