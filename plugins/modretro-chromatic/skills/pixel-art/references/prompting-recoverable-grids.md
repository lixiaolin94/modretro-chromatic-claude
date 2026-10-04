# Prompting image generation for recoverable pixel grids

Use this route for a **new static sprite** when image generation should design
it and a deterministic process should recover individual native pixels. There
are two generation steps: make a coarse ungridded design, then rebuild it on an
exact blank chart. Review and recovery follow; they are not another generation
step. The guides are extraction aids, never part of the sprite.

## Start with one small asset

- A user-requested size or an existing project's asset/profile size takes
  precedence. Otherwise prefer a standalone **32 × 32** character. Use a
  matching exact chart; surface any mismatch between requested design and native
  profile before treating the result as a project-ready sprite.
- Choose the facing, an approximate occupied footprint, important identity cues,
  and three high-contrast artwork colors. A simple control may fit 20 × 28;
  the more complex fox used about 26 × 29. These are examples, not limits.
- For edits to already-authored pixels, go to [manual authoring and native
  tools](#other-routes) instead. For motion, use the separate [animation
  route](prompting-grid-animation.md).

## Prompt recipes

Use an available image-generation tool. Save both original outputs and their prompts.
The tested [blank 32 × 32 chart](../assets/keyed-grid-32x32.png)
is 1024 × 1024: origin `(32,32)`, 30-source-pixel pitch, 33 pure-black guides
per axis, 4-source-pixel guides, white margin, and magenta cell interiors.
Those are template facts, not a guarantee about the generated edit.

### Step 1: Generate a coarse design without a grid

Ask for visible native-scale square blocks, large flat color clusters, and a
readable silhouette. Create richness through asymmetry, overlaps, and whole
one-pixel accents; avoid a polished portrait, texture, or marks smaller than one
logical pixel. Named cues can be numerous if they fit the actual resolution.

```text
Create one [subject/facing] game sprite without a visible grid. It should look
like a native [32 by 32] design enlarged with nearest-neighbor square blocks;
the figure, including [important equipment], fits roughly [26 by 29] cells.
Preserve [silhouette and priority identity cues]. Use three flat colors:
[navy #22303A, green #86C06C, cream #E0F8CF], on opaque magenta #FF00FF.
Use large connected clusters and whole single-pixel accents. No subpixel marks,
smoothing, gradients, material texture, rendered lighting, or ground shadow.
```

Review the effective feature size **before** moving on. If the smallest steps
suggest a finer canvas than requested, ask for fewer, larger contour steps and
give feature budgets (e.g. a six-pixel head or one-pixel staff). A stated image
size alone does not enforce a native pixel grid. This output is a design
reference, not an exact native sprite; generated alpha may also differ from the
request.

### Step 2: Rebuild on the exact blank grid

Attach **Image 1: exact blank chart, edit target** and **Image 2: accepted
design, content reference only**, in that order. Ask image generation to
reconstruct the design by recoloring whole existing cells; never overlay the
illustration beneath the grid. Keep black exclusive to guides and use a
visibly different dark artwork color. Empty cells are opaque chart magenta,
not a painted checkerboard or a claim of native alpha.

```text
Edit Image 1, the blank [32 by 32] chart. Image 2 is the character reference
only. Rebuild [subject and key cues] by recoloring existing squares. Each square
gets exactly one flat color across its entire interior, up to all four black
boundaries. Preserve the white margin and all [33] horizontal and [33] vertical
guides, continuous and equally spaced. Use only [three artwork swatches] or
magenta #FF00FF for empty cells; pure black is reserved for the guides. Make
the chart opaque. Express even eyes, outlines, overlaps, and equipment as whole
squares; omit a detail if necessary. Never paste the design under the grid, move
a guide, split a square, add tiny marks, or blend colors.
```

## Measure before trusting extraction

- Confirm the actual row/column count and every enclosing guide. Check the
  **entire usable cell interior**, excluding measured guide bands and at most
  one source pixel of raster fringe at their edges. Inspect occupied, boundary/spill, and empty cells
  separately; a large clean background cannot hide split character cells.
- Visually reject every intentional subdivision, even when a center or majority
  sampler yields a plausible pixel. Inspect flagged source crops for guide-edge
  antialias versus artwork inside the cell; retain raw flags and record any
  manual adjudication separately. Unscored guides are not an automatic pass.
  Revise a failed grid edit or use native authoring; do not average away a split.
- Recover one declared palette index per cell; do not downscale the whole chart.
  Inspect the recovery at 1× and enlarged for silhouette, cues, gaps, and anchor.
  If the chart has the wrong count, record it. Separately cropping only wholly
  empty border cells or adding empty padding may preserve a target-sized sprite;
  never resize or remove occupied cells, or call that an exact generated chart.
- Chart swatches are **image generation source colors**, not guaranteed GB
  Studio source colors. The tested navy differs from native darkest `#071821`;
  chart magenta `#FF00FF` is not the conventional sprite marker `#65FF00`.
  Map explicitly to the project's three visible native shades plus its alpha or
  chromakey convention; see [sprite import rules](hardware-and-imports.md#sprites).
  A 32 × 32 recovery is not the built-in 16 × 16 `static` import profile; use a
  verified compatible template or preserve the candidate pending native setup.

### Run the grid diagnostic

The bundled [grid diagnostic](../scripts/evaluate-grid.mjs) is a local helper,
not an MCP tool. For an unscaled edit of the supplied 1024 × 1024 template, run
from the plugin root with a new output directory:

```sh
node skills/modretro-chromatic-pixel-art/scripts/evaluate-grid.mjs /absolute/path/chart.png \
  --out /absolute/path/new-review-directory --name sprite \
  --cells 32 --grid 32,32,30,30 --guide black \
  --palette 'transparent=#ff00ff,ink=#22303a,green=#86c06c,cream=#e0f8cf' \
  --transparent transparent
```

Use the actual input dimensions and declared colors; scale the origin and pitch
with the image if image generation changed its resolution. For a lean plugin
payload, set `GB_STUDIO_RUNTIME_ROOT` to its configured prepared runtime so the
helper can resolve `pngjs`; a development checkout resolves dependencies locally.
`--help` works before that runtime is configured. Batch inputs need distinct
output names; existing outputs are preserved and cause an error. Optional
`--phase-search` and `--pitch-search` bounds must be finite and nonnegative,
and cannot exceed the largest dimension of the source image or selected crop.
Searches also have a 25,000-candidate budget per axis; correct the expected grid
or narrow the search bounds if that budget is exceeded.

Inspect `sprite.json`, the source-size `sprite-strict-overlay.png`, and the
native `sprite-strict-majority.png`. The helper writes candidate PNGs even for
failed or incomplete grids. A zero exit status only means analysis completed.
Use the JSON's `strict.status`, acquired-cell count, flagged coordinates, source
palette/alpha measurements, and visual review to decide whether recovery is
usable. Preserve raw flags and separately record any manual adjudication.

Two 32 × 32 fox reconstructions from one design required manual review and
differed in 11 native cells. That experiment established useful prompts and
failure checks, not general reliability or native project/runtime acceptance.

## Other routes

- **Manual or native authoring:** use [native pixel tools](native-pixel-tools.md)
  for explicit PNG/cel edits and compatible import; the plugin's sprite tools
  edit metadata and do not provide a general pixel painter. Use [editable pixel
  sources](authoring-and-interchange.md#aseprite) when working in an editor.
- **Animation:** see [motion reference and native frame authoring](prompting-grid-animation.md).
- **Environments or ordinary bitmap conversion:** use [authoring and
  interchange](authoring-and-interchange.md#generated-images-to-native-assets).
