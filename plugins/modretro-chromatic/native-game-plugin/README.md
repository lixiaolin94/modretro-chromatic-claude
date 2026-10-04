# ModRetro Chromatic project extension

This directory contains an optional **native game project plugin**, separate from
the [ModRetro Chromatic Plugin for Codex](../README.md) at the root of this
repository. Install it in an existing GB Studio 4.3 project to add an optional
hardware-profile event to the normal visual event editor. It does not eject,
fork, or replace the game engine. Ordinary
projects and the included neutral starter do not require this optional plugin.

## Install into a project

Copy `plugins/modretro-chromatic` into the `plugins` folder beside the project's
`.gbsproj` file:

```sh
mkdir -p /path/to/game/plugins
cp -R native-game-plugin/plugins/modretro-chromatic /path/to/game/plugins/
```

The resulting project structure must be:

```text
game/
  project.gbsproj
  plugins/
    modretro-chromatic/
      plugin.json
      events/
        eventCodexHardwareProfile.js
```

Reopen the project if the game editor does not immediately discover the new event.
Install optional extensions only into a project that actually requests them;
the checked-in starter intentionally contains no preinstalled custom events.

## Codex: Detect Hardware Profile

This event branches at runtime on whether the current device supports Game Boy
Color features. It stores `1` for a color-capable device or `0` for a monochrome
device in a selected project variable, then runs the corresponding child
events. Put palette changes or color-specific effects in the color branch and a
readable, monochrome-safe alternative in the monochrome branch.

The event uses the same `ifDeviceCGB` compiler helper as the editor's built-in
**If Color Supported** event. Variable assignments use the standard built-in
`EVENT_SET_VALUE` event, so the result is actual GBVM code in the exported ROM,
not a host-side editor setting or an emulator-only flag.

Projects remain free to define any project-owned native custom events.
Normal dialogue should use the built-in `EVENT_TEXT` event; the Codex plugin
does not require or privilege a particular custom dialogue command.

## Verify

From the source checkout's repository root:

```sh
node --test native-game-plugin/tests/event-handlers.test.mjs
```

The tests verify the official project discovery layout, plugin metadata,
non-destructive child-event handling, both hardware-profile values, and the
absence of a privileged bundled dialogue-card handler.
The [test file](https://github.com/OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex/blob/main/native-game-plugin/tests/event-handlers.test.mjs)
is a development resource and is not included in installed packages.

## Compatibility

- GB Studio: `>=4.3.0 <5.0.0`.
- Dependencies: none.
- Engine overrides or engine ejection: none.
- Plugin type: `eventsPlugin`.
- License: MIT, matching the parent Codex plugin.
