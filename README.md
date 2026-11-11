# plotlab

> **Placeholder name.** `plotlab` will be replaced with one search-and-replace
> (`grep -rl plotlab .`) once we pick a real name.

Turn images into pen-plotter drawings, in the browser or from the command line. Load an
image, choose how it becomes lines, see the plot on paper with a time estimate, and export
SVG. Built by Luke Anderson-Trocmé and Nicolas Oligny (bosny) for a CALQ-FRQ Arts-Sciences
project.

**Status:** early scaffold. First slice works end to end:
image → threshold → centerline → place on paper (+ time estimate) → SVG, with live sliders.

## Use it

Web app: `pnpm dev` and open the printed URL (deployed to GitHub Pages from `main`).
Drop an image (or a `recipe.json`) on the window.

CLI:

```sh
pnpm plotlab steps list
pnpm plotlab steps describe threshold
pnpm plotlab run golden/cases/shapes-centerline.recipe.json -i photo.jpg -o out/
pnpm plotlab run recipe.json -i 'frames/*.png' -o out/    # one SVG per frame
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
| `packages/engine` | Stage data types, param declarations, step contract, recipe loading/versioning, pipeline with caching, SVG export. No UI, no Node-only code. |
| `packages/steps` | One folder per step: `index.ts` + `help.md`. Run `pnpm --filter @plotlab/steps gen:help` after editing help. |
| `packages/machines` | Machine profiles (JSON) and time estimates. |
| `packages/web` | React + Vite app. Pipeline runs in a Web Worker; low-res proxy while dragging. |
| `packages/cli` | `plotlab` command. |
| `golden/` | Fixtures, recipes and approved outputs; doubles as an example gallery. |

### Adding a step

1. `packages/steps/src/<id>/index.ts` with `defineStep({...})`, plus `help.md`.
2. Register it in `packages/steps/src/index.ts`.
3. Unit tests in `packages/steps/test/`, and a golden case in `golden/cases/`.

The UI controls, validation and `steps describe` output come from the param declarations.

## Docs

- [`GLOSSARY.md`](GLOSSARY.md): canonical vocabulary. Use these words in code and UI.
- [`docs/adr/`](docs/adr): design decisions. Everything is provisional.

## License

Not yet chosen. It's pending the IP agreement between the authors, so for now all rights are
reserved. Fixture image licenses: [`golden/fixtures/README.md`](golden/fixtures/README.md).
