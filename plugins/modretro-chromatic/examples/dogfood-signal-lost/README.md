# Signal Lost

A tiny, playable Game Boy Color story about a lighthouse keeper, two wandering
signal sparks, and a beacon that forgot how to sing.

Copy the sample to a writable project folder. Set up the separately installed
compiler, then open `project.gbsproj` in the game editor or select it with the
plugin. Build the project before opening its browser preview or running the
cartridge in an emulator. This sample ships editable source only; it does not
include a prebuilt cartridge.

The story, scene art, characters, font and dialogue UI use original artwork.
See [sample provenance](../SAMPLE-PROVENANCE.json) for exact sources and hashes.
The fixed-width font covers printable ASCII with a small-caps appearance;
other characters use a question-mark fallback.

## Controls

- Press **A** or **START** on the title screen.
- Use the **D-pad** to walk through Moonmoss Cove.
- Face a character, signal spark, or the beacon relay and press **A**.
- Press **A** to advance dialogue.

Moss, the lighthouse keeper, knows what the old relay needs. Find the two
signal sparks, bring their light to the relay, and follow the signal home.

## Project structure

The game remains a normal editable distributed native game project:

- `project/scenes/` contains the title, Moonmoss Cove, and Starfall Beacon.
- `project/scenes/codex_landing/actors/` contains the keeper, both collectible
  sparks, and the stateful relay.
- `project/variables.gbsres` declares the two spark flags and restored-signal
  victory flag.
- `assets/backgrounds/` and `assets/sprites/` contain original hardware-safe
  pixel art and genuine native project resource metadata.
- Arrival and victory sequences use standard native `EVENT_TEXT`
  dialogue, so the project does not require a particular custom event.
- `plugins/modretro-chromatic/` contains an optional example hardware-profile
  event; removing it does not prevent this game from compiling.

## Maintain the sample

The source checkout includes a
[maintenance script](https://github.com/OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex/blob/main/scripts/dogfood-game.mjs)
for this checked-in sample. After the repository's
[development setup](../../README.md#development) and compiler setup, run commands
from the repository root:

```sh
node scripts/dogfood-game.mjs build
```

`build` compiles the current project to the ignored `build/signal-lost.gbc` and
inspects that cartridge. Preview or play that local build after reviewing its
result. `node scripts/dogfood-game.mjs publish` copies a reviewed build to the
ignored `artifacts/signal-lost.gbc` export path. Generated cartridges are not
included in the plugin package.

`node scripts/dogfood-game.mjs author` reapplies the script's authored scenes,
actors, dialogue, settings, and quest logic to this sample. Use it only when you
intend to replace those authored resources. It uses the checkout's compiled
stdio MCP server and existing native artwork; the script is not included in
installed packages. For ordinary edits, work on your copy through the game editor or
the plugin's native project tools.
