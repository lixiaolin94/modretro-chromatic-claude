# ModRetro Chromatic Plugin for Codex 1.0.27

## Activation and installation recovery

Returning from a completed activation now offers Continue installation when
the previous failed write is ready for review. Continue acknowledges that
original result and refreshes device selection. Installing still requires
reviewing the selected device and confirming the write.

An earlier Developer Mode failure no longer sends this flow back through
activation after the activation command has completed. When the relationship
between the activation and write is uncertain, the dialog keeps status recovery
available and retains the original request identities.

Code correction stays within the relevant failure-recovery flow. Cancelling a
new-code draft preserves the original result. Generic activation errors no
longer speculate that a code was used elsewhere or that another seat is needed.
