# ModRetro Chromatic for Claude Code - port notes

This plugin is a community port of the MIT-licensed **ModRetro Chromatic Plugin
for Codex** (upstream version recorded in `PORT-MANIFEST.json`) to Claude Code.
It is not published, endorsed or supported by ModRetro or OpenAI.

## What is the same

- The complete upstream MCP server (`dist/server.js`, 81 tools), launcher
  (`scripts/start-mcp.mjs`), dependency setup (`scripts/setup.mjs`), emulator
  worker, native capture helpers, examples and docs. Project-format safety,
  revision guards, evidence rules, device consent and recovery rules are
  unchanged.
- GB Studio / GBDK / PyBoy are installed by the upstream setup into the same
  external dependency root (`~/Library/Application Support/modretro-chromatic`
  on macOS), so an existing Codex installation's toolchain is reused.

## What differs in Claude Code

| Area | Codex distribution | This port |
| --- | --- | --- |
| Manifest | `.codex-plugin/plugin.json` (kept for upstream scripts) | `.claude-plugin/plugin.json` |
| MCP launch | `node ./scripts/start-mcp.mjs`, 900 s tool timeout | `node ${CLAUDE_PLUGIN_ROOT}/scripts/start-mcp.mjs`; Claude Code's MCP tool timeout applies (raise with `MCP_TOOL_TIMEOUT`, ms) |
| Tool names | `modretro-chromatic` namespace | `mcp__plugin_modretro-chromatic_modretro-chromatic__<tool>` |
| Skills | `modretro-chromatic-*`, `chromatic-deployment` | `/modretro-chromatic:new-game`, `:authoring`, `:pixel-art`, `:rom-debugging`, `:deployment`, `:setup` (original Codex skill text kept in `docs/upstream-skills/`) |
| Browser previews | Codex's built-in browser only | Claude Code desktop Browser pane; in a terminal, the user opens the localhost URL |
| "Annotate game" | `document.oai.annotation` host API | Not available (the player hides it automatically) |
| Pixel art | Built-in image generation + grid recovery | Exact text grids: `scripts/claude/pixel-grid.mjs` (`.pxg` ⇄ PNG, GB checks, enlarged previews); image generation only if an image tool is present |
| ModRetro Chromatic CLI | Bundled under a Codex-only redistribution permission | Not bundled. `scripts/claude/chromatic-cli.mjs install --yes` downloads ModRetro's official npm package for this platform after user consent, verifies pinned SHA-256s, caches it in a separate `modretro-chromatic-claude` data folder (never inside the dependency root, which setup refuses to adopt when non-empty); a SessionStart hook restores it after plugin updates |
| Device artwork | Brotli pack | Plain WebP files |
| Physical-device capture (`device_capture`) | macOS and Linux | macOS only. The Linux backend is a statically linked, patched FFmpeg (LGPL-2.1) whose patch is only in the private upstream repository, so its corresponding source cannot be offered and the binaries are not shipped |

## Environment variables

Set these in the environment Claude Code starts from (or in Claude Code's
`settings.json` `env`) when needed:

- `GB_STUDIO_WORKSPACE_ROOT` - authorise a folder of game projects up front.
- `GB_STUDIO_PROJECT_ROOT` - pre-select one project.
- `GB_STUDIO_SETUP_ROOT` - use another dependency root.
- `MODRETRO_CHROMATIC_CLI_CACHE` - use another cache folder for the verified vendor CLI.
- `GB_STUDIO_MCP_PATH_VISIBILITY=workspace-only` - redact paths outside the workspace.
- `MCP_TOOL_TIMEOUT` - Claude Code's MCP tool timeout in ms (e.g. `900000`) for slow first-time setup or builds.

## Regenerating from a newer upstream

From the repository root: `node port/port.mjs <new-upstream.zip>`. Every text
patch is count-checked; if upstream wording changed the port stops and names the
rule to review. Then run `node port/smoke.mjs`.
