# ModRetro Chromatic CLI 1.2.1

The six executables in this directory are unchanged proprietary, closed-source
binaries published by ModRetro in the official `@modretro/chromatic-cli-*`
version 1.2.1 npm packages. The application packages declare `UNLICENSED`.
The binaries, streaming FPGA image, and embedded Gowin USB driver installer
are not covered by this repository's MIT license.

ModRetro granted permission on September 16, 2026 to embed and redistribute
unchanged binaries in the official ModRetro Chromatic Plugin for Codex. The
maintainers retain the supplier permission record identified in PROVENANCE.json.
This permission does not grant source access, relicensing, modification, or
authority to invoke undocumented protocols. No broader license is granted.

Each target directory also retains its complete, unchanged supplier
THIRD_PARTY_NOTICES.txt. Those files contain dependency license texts, upstream
notices, and applicable source-access information. Their terms apply to the
identified third-party components and do not license the proprietary application
source. Keep these files with the binaries when redistributing the plugin.

PROVENANCE.json records the official npm archive URLs, registry integrity values,
archive hashes, and every bundled file's target, size, mode, and SHA-256.
The unchanged embedded Gowin installer is identified separately. Driver setup
requires an explicit system operation; it never runs during plugin startup.
The streaming FPGA image is loaded into volatile SRAM according to its supplier
notice. Hardware streaming and cartridge flashing remain distinct operations.
