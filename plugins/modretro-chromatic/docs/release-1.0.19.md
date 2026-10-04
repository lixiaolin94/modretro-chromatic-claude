# ModRetro Chromatic 1.0.19

## Finish setup for a playable game

Creating or iterating a game now guides Codex to prepare both the plugin runtime
and the official build tools. Codex performs necessary authorized setup, then
returns to the game; users do not need to install Node/npm manually. Source-only
work can still use just the runtime, and local stepped play adds the emulator.

Missing-compiler errors point to the packaged setup flow instead of a manual
compiler build or a passive doctor check alone. Setup cannot report completion
when its final check still finds a requested dependency missing. Earlier
successful steps and the actual failure remain visible.

On a fresh Mac without Node, the portable MCP initially cannot start. The shell
setup entrypoint can install pinned Node/npm, GB Studio and GBDK, then prepare a
machine-local plugin payload for supported installation. Preparation alone does
not activate it or refresh an existing chat.

The existing setup path was checked with no user Node on `PATH`: managed setup,
the generated MCP configuration, blank-project creation, a valid ROM build and
a noncached official browser export passed. This is macOS evidence, not a new
Windows/Linux, browser-rendering, gameplay or physical-device qualification.
