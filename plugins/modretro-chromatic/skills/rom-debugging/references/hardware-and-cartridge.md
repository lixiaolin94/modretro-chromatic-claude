# Game Boy Cartridge and Hardware Checks

## Cartridge header

Relevant byte offsets:

| Offset | Meaning | Debugging use |
|---|---|---|
| `0x0134–0x0143` | Title area; later cartridge layouts share its end with manufacturer/CGB metadata | Identify the actual artifact; do not assume all 16 bytes are title text. |
| `0x0143` | CGB flag | `0x80`: CGB enhanced with DMG compatibility; `0xC0`: CGB-only; absent/other conventional legacy values imply DMG behavior. |
| `0x0146` | Super Game Boy flag | Check SGB features when explicitly required. |
| `0x0147` | Cartridge type / memory-bank controller | Match project mapper, battery, RTC, rumble, and RAM expectations. |
| `0x0148` | ROM-size code | Confirm image size and banking expectations. |
| `0x0149` | External-RAM-size code | Confirm save-storage configuration. |
| `0x014D` | Header checksum | Detect invalid or stale cartridge headers. |
| `0x014E–0x014F` | Global checksum | Informational integrity metadata; hardware boot behavior does not rely on it in the same way as the header checksum. |

Use `rom_inspect` first. File extensions are hints, not compatibility checks. A `.gbc` suffix cannot correct an incompatible CGB flag, and a `.gb` suffix does not force original-hardware support.

Project settings and ROM tools use different labels for the same target intent: Project `mono` corresponds to ROM `dmg`; project `mixed` corresponds to ROM `gbc`; and project `color` corresponds to ROM `gbc-only`. Pass the correct vocabulary to each tool.

Common cartridge-type values:

- `0x00`: ROM only.
- `0x01`, `0x02`, `0x03`: MBC1 variants; `0x03` includes RAM and battery.
- `0x0F` through `0x13`: MBC3 variants with differing RTC/RAM/battery features.
- `0x19` through `0x1E`: MBC5 variants with differing RAM/battery/rumble features.

Match the exact feature-bearing variant rather than treating every MBC1, MBC3, or MBC5 value as interchangeable. project settings can select a mapper independently of the filename.

## Display and sprite constraints

- Visible resolution: **160×144 pixels**, or 20×18 background tiles at 8×8 pixels per tile.
- Background tiles: **8×8 pixels**, two-bit color indices, four colors per tile palette.
- Sprite dimensions: 8×8 or 8×16 depending on hardware/engine mode. An 8×16 sprite consumes two tile patterns.
- OAM capacity: **40 hardware sprites total** and **10 sprites on an individual scanline**. Engine metasprites can require several hardware sprites; count their components, not their actor objects.
- CGB color: eight background palettes and eight sprite palettes, four entries per palette, with 15-bit RGB colors. Sprite palette entry zero is transparent.
- Original Game Boy sprite/background palette behavior differs from CGB; verify monochrome legibility when `colorMode` is `mixed`.
- VRAM has two banks on CGB, but availability to a specific native game scene depends on engine allocations, UI, fonts, sprite patterns, background patterns, and selected mode.

`graphics_analyze` checks a concrete PNG. Supply its actual asset kind and
project color mode; evaluate exact fixed-shade unique tile identities,
applicable flip-aware deduplication, palette violations, and visible-viewport
budgets. Palette-independent normalized tile similarity is only a heuristic and
must not collapse genuinely different encoded shade patterns.

`graphics_analyze_scene` resolves the selected scene's actual background and
sprite references, configured palette slots, palette indices truly consumed by
decoded background tiles, background tile usage, stored sprite metadata totals,
and bounded static authored OAM estimates. Sprite totals preserve raw `numTiles`
metadata, not compiled allocations. Their comparison with a nominal 8×16-pair
range is not normalized for 8×8 or mixed sprite modes. An over-range warning or
negative estimated remaining capacity does not prove overflow: compiler
removal/reuse and dynamic reservations require compiled evidence. Check the
build before reducing art; do not rewrite metadata to conceal the warning.

Project-global palette resource counts are not limited to eight; simultaneous
background and object palette tables
are each separately limited to eight. Keep authored OAM estimates distinct from
genuine runtime OAM returned by `emulator_inspect`.

Read actual target-side hardware state only through bounded inspection:

```text
emulator_inspect {"view":"oam","visibleOnly":true,"limit":40,"includeScanlineSummary":true}
emulator_inspect {"view":"vram","region":"vram","offset":0,"length":64,"bank":0}
```

OAM reads inspect at most 40 genuine objects; named VRAM/WRAM/OAM/HRAM reads are
limited to 256 bytes. Cartridge ROM, boot ROM, arbitrary I/O, host memory,
and target writes are not exposed. This ROM-only hardware surface does not
infer high-level gameplay state or named variables. For the user's own project,
the separate explicit source-debugging mode can resolve supported names from
authenticated same-build artifacts; see
[Stepped playtesting](../../../docs/stepped-playtesting.md). Do not promise a
universal engine tile count without checking the installed release and selected
mode.

## Timing and frame budget

The normal Game Boy display refresh is approximately **59.7275 frames per second**, corresponding to **70,224 master-clock cycles per display frame** and **456 cycles per scanline**. A display frame comprises 154 scanlines, of which 144 are visible and 10 are VBlank.

The CPU executes instructions using machine cycles derived from that clock. GBC double-speed mode changes the available CPU instruction-clock budget relative to display timing; do not blindly apply a DMG CPU budget to a confirmed double-speed CGB session.

Useful investigations:

1. Count background tile updates, sprite movement, script work, decompression, and audio activity in the affected frame.
2. Identify whether VRAM/OAM writes occur in permissible LCD modes or are staged through VBlank/DMA.
3. Check whether excessive actors or effects cause the 10-sprites-per-scanline limit, producing flicker even when the total OAM count stays below 40.
4. Confirm an observed in-game skipped update, lag frame, raster artifact, or instrumentation result before calling a scene over budget.

Host-side frames per second, PyBoy stepping speed, and video-encoding frame rates are not measurements of cartridge logic performance.

## Frequent failure patterns

- Invalid PNG dimensions, more than four colors in an 8×8 region, or unexpected transparency: inspect the exact asset and palette indices.
- Background overflow: check deduplicated 8×8 patterns, flipped duplicates, viewport coverage, font/UI allocation, and CGB mode.
- Invisible or flickering actor: inspect sprite references, off-screen coordinates, actor metasprite component count, per-scanline OAM load, and palette transparency.
- Missing saves: compare mapper type, battery/RAM header fields, project settings, and emulator save configuration.
- Wrong boot target: compare project `colorMode`, cartridge CGB flag, and actual emulator-reported CGB mode.
- New dialogue disappears: check event ordering, actor interaction script, event conditions, and whether the actually built ROM contains the new resource.
- Build passes but gameplay remains old: verify artifact path, modification time/content hash, project source path, and emulator restart with the newly built ROM.
- Successful official build emits `[DEP0190]`: inspect structured `warnings`,
  original stderr, exit status, and the actual generated cartridge; this
  specifically classified official-CLI deprecation does not hide failures.
- A dialogue or sprite preview looks correct but gameplay differs: distinguish a
  static `dialogue_preview`, `graphics_preview_scene`, or `sprite_preview` from
  a genuine `emulator_observe` framebuffer or `emulator_step` sample.

## Primary references

- [Pan Docs: cartridge header](https://gbdev.io/pandocs/The_Cartridge_Header.html)
- [Pan Docs: object attribute memory](https://gbdev.io/pandocs/OAM.html)
- [Pan Docs: LCD timing](https://gbdev.io/pandocs/Rendering.html)
- [Pan Docs: CGB palettes](https://gbdev.io/pandocs/Palettes.html)
- [GBDK supported consoles and CGB hardware](https://gbdk.org/docs/api/docs_supported_consoles.html)
