# ModRetro Chromatic 1.0.18

## Keep the playable preview in view

The MCP initialization instructions now guide Codex to show a successful
playable build early when starting or iterating a project, keep the owned preview
tab visible and open, and update it after meaningful successful builds. The
authoring skill and preview guide carry the same advice.

Updates must preserve human play, saves, recordings and unknown outcomes.
The guidance does not authorize arbitrary reloads or autoplay. Previews remain
in Codex's built-in browser; if it is unavailable, Codex keeps the URL and reports
the limitation instead of switching browsers.

This is an instruction change, not a browser, UI or backend change. A real MCP
initialization regression verifies the delivered guidance. No game build,
browser or hardware action was performed to validate this wording.
