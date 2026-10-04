# ModRetro Chromatic 1.0.6

## Native JPEG admission

Native capture now checks JPEG headers before forwarding an image to the browser
preview or a Codex tool response. It reads the dimensions from the image itself
and requires them to match the capture metadata and existing pixel limits.

The bounded header parser supports 8-bit Huffman baseline and progressive JPEGs
with one or three components. It rejects truncated segments, unsupported or
conflicting frame headers, later geometry changes, and invalid progressive scan
ordering. Encoded bytes, header work and scan counts are limited before an image
is forwarded. Existing checksum, file ownership, permissions, size and PNG
validation checks are unchanged. No image-decoder dependency was added.

## Verification and limits

The source fix passed 63 focused tests covering native capture, lifecycle and
publication. Coverage includes tiny complete baseline/progressive JPEG fixtures,
malformed headers, every truncated prefix, metadata mismatches, parser limits,
and refusal before both tool responses and background HTTP image forwarding.
Independent review identified and resolved a progressive scan-ordering gap.

These are offline source and fixture checks. Actual helper JPEG output, browser
decoding and physical-device compatibility were not newly exercised. Header
validation is not full entropy decoding or a guarantee about every image
decoder. Existing physical-capture and full-duration limitations remain; see
the [1.0.3 notes](release-1.0.3.md).

The native helper binary is unchanged. Its arm64 slice has a linker-generated
ad-hoc signature; x86_64 is unsigned. Independent App Sandbox confinement,
Hardened Runtime and notarization remain unestablished. No exploit was
demonstrated. The separate sandbox/protocol design is not implemented or included
in this release.

Browser recording and input, supported platforms, bundled samples, dependencies
and the portable package layout are unchanged. This candidate does not install,
activate or flash a device. Existing 1.0.5 artifacts and their evidence are
preserved.
