# Store launcher

> **Claude Code port:** this page describes the original Codex distribution. In the Claude Code port, Claude Code installs and updates the plugin (`/plugin`), so ignore marketplace registration, local payload, `register-personal-plugin` and `codex plugin` steps. Dependency commands (`scripts/setup.mjs doctor|plan|apply`, `toolchain_doctor`, `toolchain_prepare`) work unchanged. See [CLAUDE-PORT.md](../CLAUDE-PORT.md).

The universal ZIP uses one stdio entrypoint on every platform:
`node ./scripts/start-mcp.mjs`, with the plugin directory as its working directory.
It contains bundled JavaScript dependencies and platform-specific native tooling.
MCP startup does not run npm, download Node, or install libraries. Optional game
build and emulator toolchains are prepared separately when needed.

The shipping host must resolve `node` before JavaScript can run. The package does
not hard-code a Mac or Windows cache path, modify Codex, or replace the store
installation with a personal marketplace. A Python wrapper would also require
an interpreter to be resolved first and is not included.

Release validation uses the Codex-provided Node executable against an extracted
ZIP outside the development checkout, without node_modules or npm. This proves
package startup under that executable. It does not prove marketplace command
resolution or execution on Windows/Linux. Those require their respective host
integration tests; do not describe this package as universally verified.

Activation is external: use ModRetro Updater, then return to the plugin for
normal device selection and flash confirmation. The plugin has no activation
code-entry UI, activation service, or activation MCP command.
