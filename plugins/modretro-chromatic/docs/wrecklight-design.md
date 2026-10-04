# Wrecklight: core game design

September 2026. This document consolidates the accepted creative direction.
It describes the intended game; the [remix guide](wrecklight-remix.md) tracks
the bundled version and its validation limits.

## The game

A nimble, eye-headed salvage robot explores a graveyard of welded generation
ships, restores a dead wreck, and sends its beacon's light home.

An interconnected 2D exploration-action game for Game Boy Color and Chromatic,
with readable monochrome support. Target a compact 2–4-hour first playthrough
with optional exploration. Movement is fun immediately; new tools make the
robot more capable and familiar places more useful. The emotional arc is
isolation, mastery, restoration, and hope.

## Story and payoff

Start in dormant Salvage Bay. Recover tools and return with the Core;
installing it restores circulation and opens the second half of the journey.
Explore the outer wreck, climb the Beacon Mast, overcome the Relay Crown,
activate the beacon, and return to the Bay for extraction.

Machinery waking and routes opening carry the story, with brief, purposeful
dialogue. The ending provides a musical and visual release: a warm dawn
tableau, then “THE SIGNAL REACHES HOME. THE WRECK WAKES.” Give the player closure
and the option to keep exploring.

## Exploration and progression

Explore, fight or traverse, recover a tool, open a route, and return with new
possibilities. Connect the world through useful loops, short corridors,
rewarding dead ends, secrets, and earned shortcuts.

| Region | Identity and role |
| --- | --- |
| Condenser Wells | Pressure vessels, coolant pipes, maintenance cavities, vertical routes. |
| Dynamo Galleries | Flywheels, generators, busbars, powered crossings. |
| Keel Yard | Broken hull ribs, suspended freight, exposed space, beacon ascent. |

Landmarks, cables, light pools, and framed openings suggest the main path,
especially early on. Keep the HUD restrained, use the map to support memory,
and reserve text hints for genuine ambiguity. Alternate encounters and
traversal with quieter Cargo and Mast stretches. Each room offers a route,
challenge, discovery, or change of pace.

Major upgrades have distinctive enclosed chambers, clear doors, a physical
machine release, and a visible spent state. The exit teaches the ability
immediately. Smaller health, beam, and ammunition rewards justify detours;
the main route never requires every optional upgrade. Missed jumps usually
lead to readable recovery routes and manageable retries.

## Movement and tools

Walking is quick and responsive. Jumps have useful tap height, bounded extra
height when held, and decisive landings. Jump buffering and late-jump grace
honor intent; animation never delays input. Shoot while moving, airborne,
dashing, or crouching.

| Tool | What it adds |
| --- | --- |
| Dash | Early aerial mobility, gap crossing, combat repositioning. |
| Ram Dynamo | Sustained running powers longer horizontal jumps. |
| Wall Grip | Later wall kicks open high pockets and improve return routes. |
| Cutter | Opens recognizable welded passages and new connections. |
| Pogo Striker | An optional downward strike rebounds from eligible enemies. |
| Beam upgrades and missiles | Optional combat choices; scarce ammunition never gates progress. |

Keep controls predictable: A handles jumps and earned wall-kick/dash actions;
B fires, Select opens the map, Start opens pause, and Gear selects weapons.
See [full controls](https://github.com/OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex/blob/a734c73e21d234e252f6637960d65ec620ce9133/examples/wrecklight/CONTROLS.md) for crouch, Pogo,
platform descent, and interactions.

## Enemies and bosses

Develop regional walkers, ranged sentries, chargers, airborne threats, and
hoppers into readable combinations. Timing, position, terrain, and attack
openings create enough pressure to make movement and upgrades matter.

Every boss has a unique, imposing silhouette, a dramatic room, repeatable
patterns, and **three actual fighting phases**. Warden expresses heavy flywheel
machinery; Brakemaw combines ground rushes and aerial attacks; Relay Crown
escalates through relay destruction to an exposed core. Develop patterns with
fair warnings and recovery windows, nearby retries, and meaningful rewards.
Death preserves permanent upgrades, opened routes, and completed bosses.

## Art, animation, and sound

Keep the eye-headed robot recognizable at native size and in motion, with a
coherent body, limbs, and tool. Compose dark teal hulls, restrained rust and
warm accents, strong silhouettes, and large landmarks for 160×144. Player,
threats, and landing edges lead the visual hierarchy. Rich industrial detail
supports readability; essential meaning survives through shape and brightness.

Stage the skippable animated title around the robot and wreck, with deliberate
lighting and environmental movement. Original music feels epic and builds
through the title screens. Give attacks, discoveries, machinery, and the
ending distinct, satisfying audio.

## Performance, scope, and quality

Target roughly 60 fps in the busiest sections. Reduce cosmetic work before
compromising combat or input. Design within native hardware budgets. Keep the
native game project editable, organize art and data clearly, and generate
repetitive tables without adding runtime overhead.

Polish this journey before adding major regions or abilities. Double jump is
cut; grapple is deferred; glide and rocket boots remain unselected. The
protagonist's name and deeper fleet lore remain open.

Judge success in play: newcomers find a direction, enjoy moving, understand
threats, feel each upgrade's value, and reach an ending that makes restoration
matter.
