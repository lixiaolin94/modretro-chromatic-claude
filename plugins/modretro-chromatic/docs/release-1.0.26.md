# ModRetro Chromatic Plugin for Codex 1.0.26

## Capture

Capture settings show discovery progress after Enable while the device list is
loading. A refresh keeps the selected device visible until the completed list
confirms whether it is still available. Empty results and discovery failures
keep their own guidance.

The native preview now waits for refreshed status when a frame is missing or
belongs to an outdated connection. Repeated frame errors share that recovery
request, and stale replies cannot replace the current connection state.

On macOS, the capture helper gives interactive priority to reading capture
commands. Frame identity checks, frame leases, permission handling and device
lifecycle checks remain in place.

On macOS, while capture is connected, frequent passive status reads reuse
permission results for less than one second. Explicit permission checks and
connection authorization stay fresh. Permission refresh can still pause status
handling.

Native capture uses the host's temporary folder consistently, including when an
MCP client omits the temporary-directory setting or selects a custom folder.
The existing private-folder and captured-file validation remains in place.

The helper reports pipe failures and abnormal exits promptly, while a normal
exit still drains its final response. Invalid request IDs are rejected before
dispatch, and native errors expose bounded diagnostic codes without local paths
or raw operating-system messages.

Opt-in timing diagnostics retain a bounded view of native-frame, service and
browser stages. They identify missing coverage and keep the three clocks
separate, so a gap can be investigated without treating it as measured latency.

## Installation and activation recovery

Codex can look up a specific installation by its original request ID. Recovery
in an already-open preview retains the original request after the selected
project changes. A missing original request stays unknown; it cannot silently
resolve to the latest installation. Failures that are proven to occur before
the native command starts are marked not dispatched, so installation recovery
is no longer blocked. The original failed record remains available.

The activation dialog checks status while another device operation finishes,
offers recovery after an initial status-read failure, and uses fewer redundant
actions. Activation-code entry remains protected and explicit.

After a completed activation command, Enter another code opens an empty protected
form while Back to install remains the primary action. Cancelling returns to the
original result; only deliberate submission starts a new request. When another
operation prevents entry, Check status refreshes readiness. Guidance distinguishes
command completion from code correctness or available seats.

Updated agent guidance uses existing context and supported status checks before
asking for more input. Uncertain writes are reconciled through their original
request, without automatically repeating an installation.
