# Genre-Specific Pixel-Art Direction

Read this reference when the asset's visual quality, animation, or genre identity
matters. Design for the actual 160 × 144 view, not a high-resolution illustration
of an imaginary Game Boy game.

## Universal quality bar

- Give the player, obstacles, hazards, interactables, and exits distinct value
  groupings and silhouettes before adding detail.
- Pick one coherent light direction. Use clusters of pixels to explain form; avoid
  isolated single-pixel noise, pillow shading, accidental tangents, and anti-aliased
  edges that introduce unsupported colors.
- Spend contrast where the player makes decisions. Quiet repetitive ground and
  reserve intense contrast or saturation for characters, hazards, and objectives.
- Build scenery from reusable corner, edge, fill, transition, and accent tiles.
  Change composition through combinations, flips when supported, and palette
  assignments rather than inventing a unique tile for every square.
- Keep movement anchors and foot contact stable. Inspect the complete loop at game
  speed, especially the first/last transition and direction changes.
- Test in motion, through the actual camera, with the real UI and active actors.

## Top-down RPG

Use a readable three-quarter/top-down view. Roofs and tree canopies may obscure
upper portions of objects, but doors, paths, landmarks, and NPC approach positions
must remain immediately legible.

- Start with repeatable path straights/corners, grass, cliff edges, water edge
  transitions, building walls, roof segments, entrances, and two or three accents.
- Use value changes to separate traversable ground from collision surfaces.
- Give villages a recognizable rhythm and one memorable focal point rather than
  random decoration. Make doorway and NPC-facing tiles unambiguous.
- Give player/NPC sprites distinct downward, upward, and right-facing poses;
  mirror right-facing art only when asymmetric equipment or markings allow.
- Animate walking with clear alternating contact poses and a subtle body shift;
  preserve stable footprint and consistent eyes or head direction.
- For color/monochrome compatibility, test every important route in four shades.

## Platformer

Use an unmistakable side view. Ground edges, platform tops, ladders, wall-jump
surfaces, and hazardous silhouettes should read before decorative scenery.

- Create strong top edges for solid platforms. Distinguish pass-through platforms,
  spikes, breakable blocks, ladders, moving platforms, and safe background props.
- Define idle, run, jump ascent, jump apex, fall, and landing poses; add dash,
  climb, wall contact, or attack only when the project uses those states.
- Keep the character's anchor and collision relationship coherent through all
  poses. A dramatic jump silhouette is more valuable than extra internal detail.
- Compose repeated ground/ceiling transitions and distant low-contrast scenery
  without consuming foreground tile or palette budgets.
- Inspect jumps, landings, camera scrolling, and hazard encounters in the emulator.

## Tactics and strategy

Show the board clearly at native size. Terrain, occupancy, active unit, movement
range, attack range, and target selection must be distinguishable without relying
on color alone.

- Keep terrain cells aligned with the project's actual movement grid, whether
  8 × 8 or 16 × 16. Clarify edges and traversability through shapes and values.
- Give unit classes recognizable helmets, equipment, stances, or silhouette
  features. Differentiate factions with controlled palette swaps plus shape cues.
- Reserve palette space for selection, danger, reachable cells, and cursor state.
  Keep animation compact and prioritize hit confirmation over elaborate loops.
- Watch same-row unit concentration: a row of 16 × 16 metasprites can exceed the
  10-hardware-objects-per-scanline limit well before OAM reaches 40 objects.
- Validate menus and numerical readouts against the true UI/font palette.

## Shoot-'em-up

Make projectiles and collision threats instantly recognizable. Preserve enough
negative space to read trajectories at 160 × 144.

- Design player ship, enemy classes, enemy shots, friendly shots, and pickups
  with different silhouettes and value contrasts.
- Prefer compact repeated projectile shapes. Constrain boss appendages,
  explosions, and bullet patterns to the actual object/scanline budget.
- Avoid textured backgrounds that camouflage shots or add hundreds of unique
  tiles. Use reusable starfields, machinery edges, or terrain motifs.
- Inspect several consecutive crowded frames; flicker may only occur when ships,
  effects, and bullets overlap on the same horizontal scanline.
- Match composition to the project's actual horizontal or vertical scroll mode.

## Adventure and point-and-click

Prioritize atmosphere while preserving interaction clarity.

- For adventure movement, build recognizable paths, doorways, blockers, pushable
  objects, and foreground occluders. Separate threats from ambient decoration.
- For point-and-click scenes, make the cursor, hotspot state, dialogue portrait,
  and selection frame readable without overwhelming the illustration.
- Use reusable scenery clusters and palette-controlled lighting to imply rich
  environments while staying inside the actual scene tile allocation.
- Test diagonal motion, occlusion edges, interact prompts, dialogue windows,
  portraits, and transitions in the running game.

The built-in scene types are documented in
[Scene Types](https://www.gbstudio.dev/docs/project-editor/scenes/types/).
Tactics mechanics can be built from existing scene behavior or a custom plugin;
do not imply that an upstream dedicated tactics scene type exists by default.

## Review checklist

At 1× and integer zoom, ask:

1. Is the player identifiable instantly against every supported background?
2. Are goals, walkable areas, collisions, hazards, and interactables readable?
3. Do lighting, perspective, scale, materials, and palette match existing scenes?
4. Are animation loops smooth, anchored, directional, and meaningful?
5. Are tile reuse and repeated motifs intentional rather than visually monotonous?
6. Do dense frames preserve all important actors and projectiles without flicker?
7. Do color correction and monochrome fallback preserve visual hierarchy?

A technically valid but muddy, inconsistent, or unreadable asset is not finished.
