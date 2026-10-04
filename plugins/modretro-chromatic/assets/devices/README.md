# Device artwork

The seven Chromatic color variants come from the user-provided [Play site](https://play.openai.chatgpt.site/). The translucent Codex edition is rendered from user-provided device photos using the Cloud artwork as its geometry reference; see `codex-generation.md`. All variants are bundled locally so the emulator preview does not depend on the hosted site or its authentication. Asset hashes and sources are recorded in `provenance.json`.

The preview positions the official live game canvas and its interactive controls over the artwork. The artwork contains no game framebuffer.

## Compression

The bundled images use WebP at their original dimensions, with lossless alpha and the original ICC color profiles. They are encoded offline with `cwebp` 1.6.0:

```sh
cwebp -q 90 -m 6 -sharp_yuv -alpha_q 100 -metadata icc input.png -o output.webp
```

The original PNGs are available in Git at commit `820a692`; only the WebP files are included in the package. `provenance.json` records both source and bundled asset hashes. The encoder is not a runtime dependency.
