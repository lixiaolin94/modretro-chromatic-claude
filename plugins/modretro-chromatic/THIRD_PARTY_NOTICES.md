# Third-party notices

This repository includes editable Game Boy projects and example cartridges.
Their original notices remain alongside the included examples.

- Native project-format metadata retains the Chris Maltby MIT notices in
  `examples/starter/LICENSE` and `examples/dogfood-signal-lost/LICENSE`. The
  shipped sample artwork is original to this repository; exact sources and
  hashes are listed in `examples/SAMPLE-PROVENANCE.json`. Historical stock
  regression fixtures remain under `tests/` only and are not distributed.
- Cartridges produced with GB Studio include the GBVM runtime. Its MIT license
  and the copyright notice for Toxa are included in `licenses/GBVM-MIT.txt`.
- Example cartridges link against the GBDK runtime under GPL version 2 with its
  express linking exception. The full text is included in
  `licenses/GBDK-GPL-2.0-linking-exception.txt`.

Packaged setup includes installer code, dependency manifests, and pinned
download identities, not bundled distributions of every dependency. Explicit
setup can download Node.js/npm, GB Studio/GBVM, GBDK, Yarn, uv, managed CPython,
PyBoy, Pillow, and their dependencies into a separate owned root. Those
distributions retain their own notices and licenses; the repository's MIT
license does not replace them. PyBoy remains separately installed under its
LGPL-3.0-only license. Preserve the downloaded distributions' notices when
redistributing or preparing another package.

The repository's own MIT license is available in `LICENSE`.

## ModRetro Chromatic CLI

`third-party/chromatic-cli/` contains six unchanged proprietary,
closed-source ModRetro Chromatic CLI 1.2.1 executables and the Windows binaries'
embedded Gowin USB driver installer. These files are **not MIT-licensed**.
Compact distributions store the same executable bytes in a Brotli bundle;
their supplier notices and provenance remain included and unchanged.
The official npm packages declare `UNLICENSED`. ModRetro granted permission
on September 16, 2026 to embed and redistribute the binaries in the official
ModRetro Chromatic Plugin for Codex. That permission does not grant source
access, relicensing, modification, or use of undocumented protocols.

See [the vendor notice](third-party/chromatic-cli/NOTICE.md) and
[exact provenance](third-party/chromatic-cli/PROVENANCE.json) for its scope,
targets, source archives, embedded installer and file hashes. GNU/Linux requires
glibc 2.39+; Windows requires separately available Visual C++ runtime libraries.
Bundling a target does not establish complete platform or device qualification.
Other plugin features require neither a device nor system-driver installation.

Every target includes its complete unchanged supplier `THIRD_PARTY_NOTICES.txt`,
with dependency license texts, upstream notices, and applicable source-access
information. Source checkouts and raw distributions keep the target paths listed
in the vendor notice and provenance. Compact distributions store the same notice
bytes in an authenticated Brotli stream. Read any target offline with
`node scripts/chromatic-runtime.mjs --notices <target>`; the
[packaging guide](README.md#packaging) lists the target names and usage.
The target notice is also restored beside a materialized CLI executable.
Preserve those files alongside the binaries. The included
streaming FPGA image is loaded into volatile SRAM, as described by the supplier.

The [binary SBOM](third-party/chromatic-cli/SBOM.json) lists these six executables,
their supplier notices, the embedded Windows installer, and identified external Windows prerequisites.
It is not a complete transitive source or license audit of the proprietary CLI.

## Wrecklight sample

The repository's `examples/wrecklight/` preserves the curated September 16, 2026 source snapshot
and its [attribution](https://github.com/OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex/blob/a734c73e21d234e252f6637960d65ec620ce9133/examples/wrecklight/ATTRIBUTION.md), MIT notices, and GBDK
GPLv2 text with its linking exception. Preserve applicable notices when copying
or redistributing source. OpenAI names and credit marks do not grant trademark
rights or imply endorsement. The sample includes no compiler, emulator,
proprietary boot ROM, compiled cartridge, or save data.
It is omitted from compact distributions and available as an optional verified
local template.


## Linux native device capture

> **Claude Code port:** the Linux FFmpeg executables (`native/capture/linux/*/ffmpeg`) are **not included**. They were built with a modification that is published only in the private upstream source repository, so this port cannot offer their corresponding LGPL source. Linux physical-device capture is therefore unavailable; the section below describes the upstream build.

The Linux capture backend uses FFmpeg 8.0.3 (LGPL-2.1-or-later) and libvpx 1.15.2 (BSD-3-Clause plus the WebM patent grant). Its static builds include musl 1.2.5 and zlib 1.3.2 from Alpine Linux. GCC runtime portions use the GCC Runtime Library Exception. Full applicable notices are in `licenses/native-capture/`. FFmpeg's source, libvpx's source, checksums and build recipes are in the release source repository under `native/capture/source/`; they are not downloaded at runtime. The macOS AVFoundation helper is unchanged and does not use these components.
