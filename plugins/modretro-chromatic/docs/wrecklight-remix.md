# Make a Wrecklight remix

Wrecklight is a GB Studio salvage adventure with connected rooms, editable
artwork and audio, and four local engine extensions. Its complete source stays
in the repository rather than the compact plugin ZIP.

Read the [core game design](wrecklight-design.md) for Wrecklight's creative
direction, progression, art, combat, and performance goals.

## Create your own copy

Obtain the [matching Wrecklight source directory](https://github.com/OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex/tree/a734c73e21d234e252f6637960d65ec620ce9133/examples/wrecklight)
by checking out that repository revision or downloading its source archive.
Use its local `examples/wrecklight` folder in the request below.

Ask Claude:

> Create a Wrecklight remix from `/absolute/repository/examples/wrecklight`
> at `/absolute/existing-parent/MyWrecklight`, select it, and show me the controls
> and starting rooms.

The corresponding public tool call is:

```text
project_create {"name":"My Wrecklight","destinationPath":"/absolute/existing-parent/MyWrecklight","template":"wrecklight","templateSourcePath":"/absolute/repository/examples/wrecklight","select":true}
```

Use the unchanged template from the source revision linked below. The tool
verifies its manifest and files before copying, never modifies the source, and
does not download missing templates. A full package that already includes
Wrecklight can omit `templateSourcePath`.

The destination must be new. Without a configured workspace, its parent must
already exist; with a workspace, the destination must stay inside it. The tool
copies the authenticated sample and changes only the project name and optional
author. It never overwrites an existing project or selects a bundled Wrecklight
template for editing. Use `template: "starter"` for a minimal project instead.

Try changing one room's dialogue or a background PNG first. Keep resource IDs,
`.gbsres` metadata, and all four engine extensions unless you intend to change
the systems that depend on them. Your copy opens in the ordinary GB Studio
editor. The included manifests describe the original bundled snapshot; they
are provenance, not a claim that your renamed or edited copy is unchanged.

## Build and play

Use **GB Studio 4.3.2** with its **4.2.3-v3** build-tools bundle. Recorded baseline
builds used Node.js 24.15.0.
[BUILD-VERIFICATION.md](https://github.com/OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex/blob/a734c73e21d234e252f6637960d65ec620ce9133/examples/wrecklight/BUILD-VERIFICATION.md) ties recorded
builds and targeted gameplay checks to specific source revisions and describes
their remaining limits.

Keep that compatible toolchain:
the local extensions patch the engine. The sample contains no compiler,
emulator, proprietary boot ROM, compiled cartridge, or save file. Use the
plugin's [setup guide](setup.md) if these tools are not ready.

Once dependencies are installed, the project builds offline. After editing your
copy, ask Claude to build it with `rom_build`, then test the returned cartridge
with the ordinary emulator tools. Use a short local compiler temporary path. A successful
build does not establish complete gameplay, heard audio, or physical hardware
acceptance. Use the [controls](https://github.com/OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex/blob/a734c73e21d234e252f6637960d65ec620ce9133/examples/wrecklight/CONTROLS.md) when playing.

Start a new save for your remix and keep original saves separate. This GB Studio
version includes loaded asset metadata in its save signature, so even unchanged
source can produce a different ROM hash and save signature on rebuild. The
included [build verification](https://github.com/OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex/blob/a734c73e21d234e252f6637960d65ec620ce9133/examples/wrecklight/BUILD-VERIFICATION.md)
records the original result and compiler warnings, not a reproducibility promise.

## Credits and redistribution

Keep the supplied [attribution](https://github.com/OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex/blob/a734c73e21d234e252f6637960d65ec620ce9133/examples/wrecklight/ATTRIBUTION.md) and
applicable license notices with copied source. OpenAI names and credit marks do
not grant trademark rights or imply endorsement; review project-specific credits
before distributing your remix. Preserve the notices required by the exact
toolchain used for generated output. The sample is not a separate rights audit.
