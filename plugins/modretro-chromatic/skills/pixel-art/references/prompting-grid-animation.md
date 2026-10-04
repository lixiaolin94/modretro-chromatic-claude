# Native pixel animation

## Workflow: optional motion reference → native frames → timed review

Use this for a small idle based on an approved pixel-art character. image generation can
suggest a small movement; author the actual animation by editing native pixels.
Keep the exact canonical still and any already approved animation frame
unchanged. Choose the fixed anatomy, intended movement, poses, and timing for
the actual character. Whole-cell fills and constant total pixel counts do not
establish good motion; user feedback remains the visual acceptance criterion.

### 1. Optionally explore the movement with image generation

- If a movement reference would help, give an available image-generation tool the exact still as an identity reference and
  ask for a small, single-action motion board: neutral, outward, and inward.
  Identify the fixed body parts and attachments. Preserve the generated
  board and prompt as reference material.
- Review the movement idea and any unwanted changes to anatomy or design.
  Translate the useful movement into native edits of the approved character.
  Recovering a generated chart is a [static-asset workflow](prompting-recoverable-grids.md),
  not the default way to construct animation frames.

### 2. Author the native frames by hand

- Start each frame at the required native size from the exact still, with its
  approved palette, transparency, and fixed anchor. Protect stationary parts,
  body proportions, attachments, and equipment. Preserve an approved blink as
  its exact native source. If combined later with another motion, copy only
  its approved eye cells and verify that every
  other protected cell still matches the still.
- Choose key poses and draw the in-betweens directly on the native grid. For a
  small translation, deliberate one-column placements can preserve each
  affected row's volume and color run. Check local shape and markings as well
  as total pixel counts. Adapt these checks to the actual motion; a rotation
  need not preserve every row's width. Keep moving parts attached and curves
  continuous. Do not smooth or resample the whole sprite to invent in-betweens.
- A guide or mask only marks where drawing is expected and what stays protected.
  Compare each frame with the still and review any outside change; expanding a
  mask does not make a bad shape acceptable. If the anatomy is wrong, fix the
  native drawing. Retain editable frames and a simple pose/timing manifest.

### 3. Review the in-betweens and timing before building the full sheet

- Preview the complete character at native 1× and an enlarged moving-part crop.
  First step through each pose; then loop the study at its proposed speed and
  at a slower review speed. Watch the rest transition and loop seam, motion
  arc, attachment, markings, volume, and any sudden popping or sliding.
- Use difference overlays and per-row color/width checks to catch mistakes;
  they do not decide whether the animation feels right. If it still snaps,
  redraw an in-between or adjust the timing, then play it again. Apply any user
  feedback directly; static review or passing counts cannot outweigh it.
- Once the study reads in motion, assemble the accepted full-size frames
  deterministically in manifest order, with no gutters, trimming, smoothing,
  or new colors. Store individual editable PNGs and timing separately from the
  sheet. Label a GIF or browser loop as a **source animation preview**; record
  when playback or user acceptance is still missing.

A sheet of 32 × 32 frames is not the plugin's simple **96 × 16**
`directional_animated` profile. Native registration requires a compatible
existing sprite template with the exact source-sheet dimensions and a 32 × 32
metasprite layout; otherwise report the import gap. A native PNG or source
preview does not establish engine import, ROM behavior, or physical hardware
appearance. See [sprite import](hardware-and-imports.md#sprites).

## Optional example: fox idle

In a 32 × 32 fox idle trial,
the user said the neck changed, the blink worked, and the tail looked awful.
The two purported breath pixels changed the collar; the tail changed width and
its marking across rows, then snapped between two poses. Preserve the approved
blink; discard that neck change and tail animation.

The follow-up manually authored study uses five native tail poses while
protecting the rest of the character. Its generated motion board suggested an
outward/inward arc but also changed shape and recolored parts;
only the movement idea informed the native edits. This is an experimental
candidate, still unaccepted pending timed review. Its pose count, palette, and
protected regions are specific to that character.

## Legacy reference: simple 16 × 16 directional walk

This independent native game profile is not applicable to the fox idle. The simple
`directional_animated` importer expects six 16 × 16 frames on a 96 × 16 sheet:
down A/B at x=0/16, up A/B at x=32/48, and right A/B at x=64/80. It uses A for
idle, plays B then A for movement, and mirrors right for left. Separate left
art requires a compatible existing native template. The current default
collision bounds are `(0,0,16,8)` and `animSpeed:15`; that is not 15 fps. See
the [native import rules](hardware-and-imports.md#sprites).
