# ModRetro Chromatic 1.0.21

## Clearer capture and install controls

Capture and install dialogs use consistent labels, grouping and action placement.
The player has more balanced vertical spacing, and error dialogs offer a small
Copy error action with selectable text when copying is unavailable.

Capture settings select the sole available device and resolve matching USB audio
without a separate audio picker. Where permission is required, one Enable capture
action replaces the permission checkboxes. Connect remains a separate action.
Passive status and frame polling no longer disable device selection or conflict
with control requests.

Repeated status updates preserve active choices and avoid duplicate or premature
errors. Stop, Disconnect, cancellation and uncertain-operation recovery remain
available. Native capture binaries are unchanged; synthetic UI and focused tests
do not establish new physical-device or audio compatibility.
