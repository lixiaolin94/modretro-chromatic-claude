# Updating a supported native title atlas

`native_graphics_update` accepts inert graphics data for the registered
`wrecklight-title-v1` renderer. It is not a general C-file editor. It can update
only that renderer's fixed title-pattern and map arrays in the selected editable
project. The path in the contract is descriptive; the tool never uses it as a
write destination. The bundled Wrecklight sample remains read-only.

Supply the complete atlas contract as `contract`, the profile name as `profile`,
and the current whole-project `expectedRevision`. Begin with `dryRun: true`.
The contract's `currentHeader.bytes` and `currentHeader.sha256` must match the
current header; a project revision alone does not cover plugin files. If the
dry run succeeds and the project remains unchanged, the same request without
`dryRun` applies the data. The response includes the old and new header digests,
change counts, preserved-data counts, and the ordinary transaction receipt.
Do not replay an uncertain write; inspect the project first.

The contract must contain exactly 196 ordered 8×8 patterns with matching pixel
rows and two-bitplane bytes, and a 360-cell map and attribute grid. The tool
checks the existing literal layout, all map references and the fixed pattern
budget. It refuses changes to the 17 animated patterns or their map locations,
all 360 attributes, palette-7 UI cells and their referenced patterns, and the
font and credit arrays bound by the contract. It retains every other header byte
and preserves the header's existing 0600 or 0644 mode. It does not execute the
contract, generate artwork, change renderer code, or infer that the resulting
image is correct.

Plugin headers are outside the public project-revision tree. Use the returned
`headerSha256` and actual byte count as the next contract's header preimage;
reusing the old contract after a successful update is stale even if the project
revision is unchanged. Changing the header does not update a reviewed custom
native dependency profile. A later dependency query may therefore refuse until
a separately reviewed coherent profile covers the new source. Build, play, and
visual review are separate work and are not established by a successful update.
