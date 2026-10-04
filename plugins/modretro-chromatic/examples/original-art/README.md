# Original sample artwork sources

`recipes.mjs` records the authored tile, sprite and glyph rows.
`native-cells.json` records every final indexed pixel, its palette, and its
placement in the room, player sheet, font and dialogue UI. They are portable
source data; no local toolchain or review-machine path is required to read them.
The repository tests reconstruct the shipped PNG pixels from these rows.

Eleven font glyphs reuse the original Signal Lost title glyph definitions at
commit `5929961b938260ad112b87fc57145b7b23c7a196`; the other glyphs and the room,
player and UI were authored for this release. Lowercase ASCII uses a small-caps
appearance. Characters outside printable ASCII use a question-mark fallback.

See [sample provenance](../SAMPLE-PROVENANCE.json) for exact hashes and retained
Signal Lost artwork. Original artwork uses the repository MIT license. Native
project schemas and compiler/runtime components retain their upstream notices.
