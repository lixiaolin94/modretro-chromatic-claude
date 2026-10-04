# Maintaining Wrecklight sources

The editable sample has four distinct homes:

| Path within `examples/wrecklight/` | Purpose |
| --- | --- |
| `authoring/` | Named source data and offline generators |
| `assets/` | Native PNGs, audio and asset sidecars |
| `project/` | native game scenes, events, variables and tilemap recipes |
| `plugins/` | Handwritten native behavior and checked-in generated data |

Start with the [authoring index](https://github.com/OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex/blob/a734c73e21d234e252f6637960d65ec620ce9133/examples/wrecklight/authoring/README.md).
Copies carry named Warden layouts, Cargo animation sources, Reactor layers and
Crown pose definitions without the development review archive. Checked-in
outputs keep the ordinary game build independent of the authoring tools.

## One maintenance command

From the repository root:

```sh
# Stage only intended new source paths so they can enter the sample inventory.
git add examples/wrecklight/authoring
npm run generate:wrecklight
npm run check:wrecklight
git diff --check
```

`scripts/wrecklight/maintain-sample.mjs` prepares the Warden data, the sample's
`MANIFEST.json` and `MANIFEST.sha256`, the copy guard in
`src/bundled-template.ts`, and the package pin in `scripts/setup-runtime.mjs`.
It validates all inputs before writing, updates only changed files, and retains
authored validation/provenance metadata. The `--check` path writes nothing.
Review and stage the resulting diff before committing.

The inventory uses tracked/staged paths and current working bytes. It rejects
untracked sample members, symlinks, nonportable file modes, build output and save
state. Keep local builds outside the bundled sample. Removing source files is a
separate intentional edit; this command never removes a file or stages Git changes.

The script updates checksums; it does not certify changed gameplay. If native
source, asset metadata or compiler inputs change, update the appropriate reviewed
dependency profile and test/build the affected behavior. Historical profiles and
fixtures retain their original bytes. Pure authoring/doc changes do not require a
new runtime profile when all its existing input bytes remain identical.

Maintenance invokes only the trusted Warden generator. Cargo's optional
generator needs Python and Pillow; Crown's needs only Python's standard
library. Run those explicitly in their documented `--check` mode, then regenerate
only the artwork you intend to change. Do not make public builds execute
arbitrary project generators or install their dependencies automatically.

## Plugin organization

Keep sample-generation and inventory tools together in `scripts/wrecklight/`.
They are repository tools, separate from shipped setup/device scripts. Portable
per-project generators live beside their inputs in the sample's `authoring/` and
are copied with a remix. The installed MCP server never imports these generators.

Runtime integration stays in `src/wrecklight-dependencies.ts`. Reviewed source
profiles live in [`src/wrecklight/profiles/`](https://github.com/OpenAI-Partners/ModRetro-Chromatic-Plugin-for-Codex/blob/main/src/wrecklight/profiles/README.md),
separate from project authoring data. Their named exports and explicit import
order preserve the existing compatibility catalog.

The marked C block remains in its existing translation unit. Moving it into a
generated include can be done separately with preprocessed-token and target-output
equivalence checks, without mixing that change into art or performance work.
