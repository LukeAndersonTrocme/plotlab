# plotlab

> **Placeholder name.** `plotlab` will be replaced with one search-and-replace
> (`grep -rl plotlab .`) once we pick a real name.

Turn images into pen-plotter drawings, in the browser or from the command line. Load an
image, choose how it becomes lines, see the plot on paper with a time estimate, and export
SVG/PDF, PNG/TIFF, or one print-ready plate per ink. Built by Luke Anderson-Trocmé and Nicolas Oligny (bosny) for a CALQ-FRQ Arts-Sciences
project.

Think of a modular synth: complex inside, but you can have fun turning the knobs without
knowing the theory. Plotters are one output; pure digital work and print prep (riso,
screen print, relief, intaglio) are equally supported.

**Status:** early. Works end to end: image → threshold → centerline → stroke order → SVG,
with live sliders, a time estimate, and the source placed on paper in mm. Pick an output
target (plotter, digital image, digital vector, print prep), give each layer an ink, reorder
or add steps, and click any step to see its output. Topographic looks: Ink density → Levels
→ Bands → Fill (hatching or dots, per-band patterns, cross-hatching), contour maps, and
Pixelate. Start from a preset ("Topographic hatching", "Dotted bands", "Contour map", "Pixel
hatching", "Single-line trace"); each one is a golden example in `golden/approved/`.
Export follows the target: SVG for plotters; SVG or PDF for digital vector (layers that
aren't lines are embedded as images); PNG or TIFF at a DPI for digital images, with inks
mixed like ink on paper; for print prep, one 1-bit or gray TIFF per ink (optional halftone
screen with an angle per ink, film negative, mirror, registration marks) plus a proof.
"Preview as exported" shows the page as the file will look. Input: PNG, JPEG, WebP (web),
TIFF including 16-bit.

## Use it

Web app: `pnpm dev` and open the printed URL (deployed to GitHub Pages from `main`).
Drop an image (or a `recipe.json`) on the window.

CLI:

```sh
pnpm plotlab steps list
pnpm plotlab steps describe threshold
pnpm plotlab run golden/cases/shapes-centerline.recipe.json -i photo.jpg -o out/
pnpm plotlab run recipe.json -i 'frames/*.png' -o out/    # one file per frame
pnpm plotlab run recipe.json -i scan.tif -o out/ -f plates # print prep: a TIFF per ink + proof
```

## Develop

Requires Node 20+ and pnpm (`corepack enable`).

```sh
pnpm install
pnpm dev            # web app
pnpm test           # unit + golden tests
pnpm typecheck
pnpm golden:approve # accept changed golden output, then review the diff in git
```

| Package | What's in it |
|---|---|
| `packages/engine` | Stage data types, param declarations, step contract, recipe loading/versioning (schema v2: target, layout, inks), placing the source on paper, pipeline with caching, chain rules, export (SVG, PDF, PNG, TIFF, print plates; TIFF input). No UI, no Node-only code. |
| `packages/steps` | One folder per step: `index.ts` + `help.md`. Run `pnpm --filter @plotlab/steps gen:help` after editing help. |
| `packages/machines` | Machine profiles (JSON) and time estimates. |
| `packages/web` | React + Vite app. Pipeline runs in a Web Worker; low-res proxy while dragging. |
| `packages/cli` | `plotlab` command. |
| `golden/` | Fixtures, recipes and approved outputs; doubles as an example gallery. |

### Adding a step

1. `packages/steps/src/<id>/index.ts` with `defineStep({...})`, plus `help.md`. Steps work in
   mm on the paper. A step that transforms layers one at a time implements `runLayer` (and
   `accepts: ["tone"]` etc.); the engine handles layer selection, per-layer settings and
   pass-through. Random steps take `seed: seedParam()` and draw from `createRng(seed)`.
2. Register it in `packages/steps/src/index.ts`.
3. Unit tests in `packages/steps/test/`, and a golden case in `golden/cases/`.

The UI controls, validation and `steps describe` output come from the param declarations.

## Docs

- [`GLOSSARY.md`](GLOSSARY.md): canonical vocabulary. Use these words in code and UI.
- [`docs/adr/`](docs/adr): design decisions. Everything is provisional.

## License

Not yet chosen. It's pending the IP agreement between the authors, so for now all rights are
reserved. Fixture image licenses: [`golden/fixtures/README.md`](golden/fixtures/README.md).
