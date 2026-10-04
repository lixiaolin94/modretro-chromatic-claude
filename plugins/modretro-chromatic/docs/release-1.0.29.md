# 1.0.29

- Store-installed plugins prepare only missing compiler/emulator dependencies; no replacement runtime, plugin registration or reinstall.
- The launcher uses a stable per-user dependency directory across plugin versions, while preserving explicit toolchain bindings.
- Dependency diagnosis recognizes the bundled MCP runtime without node_modules.
- First launch works before the dependency directory exists.
- Setup instructions return directly to the requested build/play workflow.

Retains 1.0.28 external ModRetro Updater activation and concise installation UI.

- Preview recovery now tells Codex to check the owning listener and reopen the original project after a restart, instead of reusing an expired localhost URL or attributing connection refusal to browser policy.
