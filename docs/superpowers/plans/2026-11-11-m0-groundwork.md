# M0 Groundwork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the engine model around output targets, paper-space mm, inks, tone/category layers and a split plot step, then expose it in the web app (stage inspection, reorderable steps, seeds). Covers issues #14–#21.

**Architecture:** The recipe envelope moves to schema v2 (target, layout, inks, layer→ink map, pass order). Before step 1, the pipeline places the source on paper at a working resolution. Every raster carries a `Frame` (its rectangle on the paper, in mm), and all geometry is in paper mm. Layer-acting steps implement `runLayer`, and the engine handles layer selection, per-layer params and pass-through. Plot output is machine-agnostic. Time is a readout computed from a machine profile.

**Tech Stack:** TypeScript 5.6, pnpm workspace, Vitest 2, React 18 + Vite 5, Web Worker.

**Spec:** `docs/adr/0005`, `0007`–`0012`, issues #14–#21, and Workbench `software-design.md` § "Round 2 decisions (2026-11-11)".

## Global Constraints

- Node 20.19.2, pnpm 9.15.4; no new runtime dependencies.
- `plotlab` stays renameable by one search-and-replace (no new spellings like `PlotLab`).
- Fixture images: Mona Lisa and the generated shapes only. No Ben photos (#1).
- Every slice keeps `pnpm typecheck && pnpm test` green at its commit.
- UI copy is plain language for non-programmers. Use "pen" only in plotter-facing text; the model says "ink".
- Old recipes (schema v1) must still load, upgraded with a warning.
- Golden SVGs change only via `pnpm golden:approve`, and I look at the result before committing.

## Decisions taken while planning (not settled in the ADRs)

- **Threshold outputs a 1-bit tone layer** (values exactly 0 or 1), not 2 categories, so the user never has to pick which category is "ink". Levels (M1) is the first category producer.
- **Frame = rectangle in mm** (`{xMm, yMm, widthMm, heightMm}`), not mm-per-pixel. Pixel → mm is `x + (px + 0.5) · widthMm / width`, so proxies that round their pixel size still land exactly on paper.
- **Working resolution never goes finer than the source** (no upsampling to be "sharper") and is capped at `MAX_WORKING_SIDE = 4096` px, with a warning.
- **Fit modes in M0:** `fit` (whole image inside the margin box) and `fill` (cover the box, crop overflow), with an anchor `position: [0..1, 0..1]`. A free crop rectangle waits for the edit-layer view (M3).
- **Plot data carries no times.** `estimatePlot(plot, machine)` (machines package) returns per-pass time plus pen changes. A recipe that ends at Lines still gets a Plot (traced order, `ordered: false`) so preview and estimate work before ordering runs.
- **`plot` step removed; `order` step added** (geometry → plot, on-demand). The v1→v2 upgrader moves `plot.margin` into `layout.marginMm` and turns `plot` into `order`.
- **Layers that stop early** ride along as `rasterLayers` on Geometry and Plot. SVG export skips them and the UI says so; the preview composites them.
- **Native execution, no review sub-agent** (session rule: no agents unless asked). I review the whole branch myself at the end and offer `/code-review`.

## Review Focus

1. **Huge or tiny inputs.** Very thin inks (0.05 mm) on A3 would ask for a 16k px working image; a 4501 px source shouldn't be upsampled. Expect the 4096 px cap with a warning, and no upsampling beyond the source. → tests in Task 2.
2. **Old saved recipes** (localStorage v1, the golden v1 JSON, a CLI user's file) must load with a warning, not crash. → Task 3 upgrader test against the exact v1 golden case.
3. **A recipe that ends early** (only Threshold, or Centerline disabled). The plotter target shows "0 strokes; 1 layer isn't lines yet", not an error. → Task 4 test.
4. **Reordering into an invalid chain**, and **deleting the only step that makes layers**. Expect a plain reason and an unchanged recipe. → Task 6 tests.
5. **Ordering performance on large plots** (83k strokes). Ordering must finish within seconds and never increase travel over greedy. → Task 5 benchmark test.

---

### Task 1: Seeded randomness (#21)

**Files:**
- Create: `packages/engine/src/rng.ts`
- Modify: `packages/engine/src/params.ts` (`NumberParam.seed?: true`, helper `seedParam`), `packages/engine/src/index.ts`
- Test: `packages/engine/test/rng.test.ts`

**Interfaces:**
- Produces: `createRng(seed: number): () => number` (mulberry32, returns [0,1)); `seedParam(label = "Seed"): NumberParam` (`min 0, max 999999, step 1, default 1, seed: true`); `randomSeed(): number`.

- [ ] Test `same seed → same sequence; different seeds differ; values in [0,1)`, and `seedParam passes resolveParams with default 1`.
- [ ] Run `pnpm vitest run packages/engine/test/rng.test.ts`; expect FAIL (module missing).
- [ ] Implement.
- [ ] Re-run; expect PASS.
- [ ] Commit `feat(engine): seeded PRNG and seed param (#21)`.

### Task 2: Place source on paper at a working resolution (#15, part)

**Files:**
- Create: `packages/engine/src/layout.ts`
- Test: `packages/engine/test/layout.test.ts`

**Interfaces:**
- Produces:
  - `interface Frame { xMm: number; yMm: number; widthMm: number; heightMm: number }`
  - `interface Layout { fit: "fit" | "fill"; marginMm: number; position: [number, number] }`
  - `DEFAULT_LAYOUT = { fit: "fit", marginMm: 15, position: [0.5, 0.5] }`
  - `MAX_WORKING_SIDE = 4096`
  - `placeOnPaper(src: {width, height}, paper: Paper, layout: Layout): { frame: Frame; crop: {x, y, w, h} }` (crop in source px)
  - `workingSize(frame, crop, mmPerPx: number, maxSide?: number): { width, height, warnings: string[] }`
  - `resample(img: RawImage, crop, width, height): Float32Array` (box filter when shrinking, bilinear when growing)
  - `pxToMm(frame, width, height, px, py): Position`

- [ ] Write tests:
  - A 200×100 source on 100×100 paper with a 10 mm margin, `fit`: frame `{xMm:10, yMm:30, widthMm:80, heightMm:40}`, crop = whole source.
  - `fill`: frame `{10,10,80,80}`, crop width 100 px centred (x=50). With `position [0, 0.5]` the crop starts at x=0.
  - `workingSize` at 0.25 mm/px for the fit frame gives 200×100 capped at source size (no upsampling); at 1 mm/px gives 80×40.
  - A 0.01 mm/px request on a 297 mm frame gives a long side of 4096 plus one warning matching `/capped/`.
  - `resample` of a 4×4 checker to 2×2 gives all 0.5.
  - `pxToMm(frame,80,40,0,0)` = `[10.5, 30.5]`.
- [ ] Run; expect FAIL.
- [ ] Implement.
- [ ] Run; expect PASS.
- [ ] Commit `feat(engine): place source on paper at working resolution (#15)`.

### Task 3: Model v2: target, inks, frames, tone/category layers, recipe schema v2 (#14, #15, #16, #17 part)

This is the one "switch-over" task. The shared types change, so every package is updated in the same commit.

**Files:**
- Modify: `packages/engine/src/types.ts`, `recipe.ts`, `step.ts`, `pipeline.ts`, `image.ts`, `svg.ts`, `params.ts` (drop `"source-units"` unit)
- Create: `packages/engine/src/target.ts`, `packages/engine/src/ink.ts`
- Modify: `packages/steps/src/threshold/index.ts`, `centerline/index.ts`
- Rename: `plot/` → `order/` (help.md rewritten)
- Modify: `packages/steps/src/index.ts`, `packages/machines/src/estimate.ts`, `packages/cli/src/main.ts`, `golden/golden.test.ts`, `golden/cases/*.json` (to v2), `packages/web/src/*` (compile-level only; UI comes in Tasks 7–9)
- Tests: update `packages/*/test/*.test.ts`; add `packages/engine/test/upgrade.test.ts`

**Interfaces:**
- Produces (types):
  - `Ink { id; name; color: string; mix: "multiply" | "normal"; widthMm: number }`
  - `Target = { kind: "plotter" } | { kind: "vector" } | { kind: "raster"; dpi: number } | { kind: "print"; dpi: number }`
  - `Image { kind:"image"; width; height; channels; data: Float32Array; frame: Frame }`
  - `LayerValues = { kind: "tone"; data: Float32Array } | { kind: "categories"; data: Uint16Array; count: number }` (0 = no ink)
  - `Layer { id; name; values: LayerValues }`
  - `Layers { kind:"layers"; width; height; frame: Frame; layers: Layer[] }`
  - `GeometryLayer { id; name; features }` (coordinates in paper mm)
  - `Geometry { kind:"geometry"; paper: Paper; layers: GeometryLayer[]; rasterLayers?: Layers }`
  - `PlotLayer { id; name; ink: Ink; paths: Position[][] }`
  - `Plot { kind:"plot"; paper; layers: PlotLayer[]; ordered: boolean; rasterLayers?: Layers }` (`layers` in pass order)
- Produces (recipe v2):
  - `Recipe { schemaVersion: 2; input; target: Target; paper; layout: Layout; workingMmPerPx: number | null; inks: Ink[]; layerInks: Record<string,string>; passOrder: "light-to-dark" | string[]; machine; steps: RecipeStep[] }`
  - `RecipeStep { step; version; params; enabled?; layers?: "all" | string[]; layerParams?: Record<string, Record<string, unknown>> }`
- Produces (functions):
  - `workingMmPerPx(recipe): number`: override, else plotter/vector = `min(ink.widthMm) / 2`, raster/print = `25.4 / dpi`.
  - `inkFor(recipe, layerId): Ink`: `layerInks` lookup, else `inks[0]`.
  - `toPlot(geo: Geometry, recipe, paths?: Position[][][]): Plot`: applies pass order; traced order unless `paths` is given.
  - `showsTime(target): boolean`: plotter only.
- `StepContext { paper; inks; inkFor(layerId): Ink; target; progress? }`
- `Pipeline.run(source: Image, recipe, opts: { sourceKey?; maxSidePx?; onStep? }): Promise<{ output; results; placed: Image; plot: Plot | null; warnings: string[] }>`. Placement is cached like a step. `plot` is the output if it is a Plot, `toPlot(output)` if it is Geometry, else null.
- `estimatePlot(plot, machine): { passes: Array<{ layerId; drawLengthMm; travelLengthMm; timeS }>; penChanges: number; totalS: number }` in `packages/machines/src/estimate.ts`.
- Step `order` (id `order`, v1, geometry → plot, cost `on-demand`). Params: `method: nearest | as-traced`, `allowReverse` (visible for nearest). It reuses the current greedy `orderPaths`; Task 5 makes it fast.
- Centerline v2 (`minLength` default 2 mm, `smoothing` default 0.2 mm). Its `migrate` from v1 keeps the values and notes they are now mm.
- Threshold v2 emits `{ kind:"tone" }` 0/1. Its `migrate` from v1 is a no-op with the note "layer is now a 1-bit tone layer".

- [ ] Write `upgrade.test.ts`. Loading the literal `golden/cases/shapes-centerline` v1 JSON (inlined) gives:
  - `schemaVersion 2`
  - `layout.marginMm 15`
  - `inks[0] = { id:"black", name:"black", color:"#111111", mix:"multiply", widthMm:0.5 }`
  - `target { kind:"plotter" }`
  - steps `["threshold","centerline","order"]`, with `order.params.method "nearest"`
  - one warning matching `/schemaVersion 1 to 2/`
- [ ] Write the remaining tests:
  - `workingMmPerPx`: 0.3 mm ink → 0.15; raster 300 dpi → 0.08467; override wins.
  - `estimatePlot`: two passes → `penChanges 1`, total = sum of passes + `changeS`.
  - `toPlot`: with inks light `#ffff00` and dark `#000000`, the light layer comes first under `light-to-dark`; an explicit `passOrder` array wins.
  - Pipeline places the source so the Threshold output's `frame` equals `placeOnPaper` frame.
  - Pipeline with `maxSidePx: 100` gives `placed.width <= 100` and the same frame.
  - Update existing step and engine tests to the new types.
- [ ] Run `pnpm test`; expect FAIL.
- [ ] Implement the types, the recipe v2 loader and upgrader, pipeline placement and `toPlot`, the step updates, `order`, `estimatePlot`, SVG from `layer.ink`, the CLI (prints time only when `showsTime`), the golden runner (uses `plot` from `run`) and compile-level web fixes.
- [ ] Run `pnpm typecheck && pnpm test`. Expect only golden mismatches.
- [ ] Run `pnpm golden:approve`, then `pnpm plotlab run golden/cases/...` and check stroke counts and that the SVG opens sensibly (open the SVG and look at it). Mona at 0.3 mm ink → 0.15 mm/px, capped by the 600 px source.
- [ ] Run `pnpm typecheck && pnpm test`; expect PASS.
- [ ] Commit `feat!: recipe v2 with targets, inks, paper-space mm and tone layers (#14 #15 #16)`.

### Task 4: Layer selection, per-layer params, value-kind checks (#17)

**Files:**
- Create: `packages/engine/src/layers.ts`
- Modify: `step.ts` (adds `runLayer`, `accepts`), `pipeline.ts`, `recipe.ts` (validates `layerParams` with `resolveParams`), `centerline/index.ts` (becomes `runLayer`)
- Test: `packages/engine/test/layers.test.ts`

**Interfaces:**
- `StepDefinition.runLayer?(layer: Layer, params, ctx, grid: { width; height; frame }): Layer | GeometryLayer`. Exactly one of `run` / `runLayer`; `defineStep` throws otherwise.
- `StepDefinition.accepts?: Array<"tone" | "categories">` (default both).
- `applyLayerStep(def, input: Layers, rs: RecipeStep, ctx): Layers | Geometry`. Selected layers are transformed with `{ ...params, ...layerParams[id] }`. For layers → layers, the rest pass through in place. For layers → geometry, the rest go to `rasterLayers`.
- `StepInputError(stepIndex, message)`. Its message names the step, the layer and its kind, and suggests a fix. Example: `Centerline traces tone layers, but "Bands" holds categories. Add a step that turns categories into tone before it.`
- `StepResult.layers: Array<{ id; name; kind: "tone" | "categories" | "lines" }>` describes the output, so the UI can offer selectors.

- [ ] Write tests, using test-only steps `invert` (layers → layers, tone) and `fake-levels` (tone → categories):
  - `layers: ["b"]` inverts only b and leaves a byte-identical.
  - `layerParams.b.amount` overrides only for b.
  - An invalid `layerParams` value gives a load warning and is clamped.
  - Centerline on a categories layer throws `StepInputError` with `/holds categories/`.
  - Centerline with `layers: ["a"]` gives Geometry with one line layer and `rasterLayers.layers[0].id === "b"`.
  - A recipe ending at Threshold gives `plot: null`. A recipe where Centerline selects nothing gives a Plot with 0 strokes and 1 raster layer.
- [ ] Run; expect FAIL.
- [ ] Implement.
- [ ] Run `pnpm test`; expect PASS, with golden unchanged.
- [ ] Commit `feat(engine): per-layer selection, settings and value kinds (#17)`.

### Task 5: Fast stroke ordering (#18)

**Files:**
- Modify: `packages/steps/src/order/index.ts`
- Create: `packages/steps/src/order/sort.ts`
- Test: `packages/steps/test/order.test.ts`

**Interfaces:**
- `orderPaths(paths: Position[][], opts: { allowReverse: boolean; improve: boolean }): Position[][]`
- `travelLength(paths): number`

Approach:
- Greedy nearest neighbour over a uniform grid of stroke endpoints. Cell size is `sqrt(bboxArea / n)`; search rings of cells outward until the best distance is smaller than the ring radius. Remove used strokes from their cells.
- When `improve && allowReverse`, run a windowed 2-opt: for i, j within 64 positions, reversing the segment i+1..j also reverses each stroke in it. Accept a move if it lowers the summed travel. At most 3 sweeps, stopping early when a sweep finds nothing.
- `order` gets the `improve` param (boolean, default true, visible for nearest) and bumps to v2 with a no-op migrate.

- [ ] Write tests:
  - Same multiset of strokes out as in (as sets of point strings, reversed strokes normalised).
  - Travel ≤ the as-traced travel on a random set.
  - `improve` never increases travel vs `improve:false`.
  - 20 000 random 2-point strokes on 300×300 order in < 1500 ms.
  - Empty input → `[]`.
  - `allowReverse:false` never reverses.
- [ ] Run; expect FAIL on time and on `improve`.
- [ ] Implement.
- [ ] Run; expect PASS.
- [ ] `pnpm golden:approve`, then look at the travel change.
- [ ] Commit `feat(steps): grid nearest-neighbour + 2-opt stroke ordering (#18)`.

### Task 6: Chain rules for reorder / add / remove (#20, engine)

**Files:**
- Create: `packages/engine/src/chain.ts`
- Test: `packages/engine/test/chain.test.ts`

**Interfaces:**
- `checkChain(input: StageKind, steps: RecipeStep[], registry): Array<{ index; reason }>` (disabled steps are skipped)
- `moveStep(recipe, from, to, registry): { recipe } | { reason: string }`
- `insertStep(recipe, stepId, registry, at?: number): { recipe; index } | { reason }`: default position is the first index that keeps the chain valid, otherwise a reason.
- `removeStep(recipe, index, registry): { recipe } | { reason }`
- `STAGE_WORDS = { image: "an image", layers: "layers", geometry: "lines", plot: "a plot" }`. Reason template: `"<Title> needs <kind words>, but at that point the chain has <kind words>. Put it after a step that makes <kind words>, like <first registry step producing it>."`

- [ ] Write tests:
  - Moving Centerline before Threshold gives a reason matching `/Centerline needs layers, but .* has an image/` and a recipe identical to the input.
  - Moving it back is valid.
  - Inserting `order` into `[threshold, centerline]` gives index 2.
  - Inserting `centerline` into `[]` gives a reason.
  - Removing Threshold from `[threshold, centerline, order]` gives a reason that names Centerline.
  - Removing `order` is OK.
- [ ] Run; expect FAIL.
- [ ] Implement.
- [ ] Run; expect PASS.
- [ ] Commit `feat(engine): chain rules with plain-language reasons (#20)`.

### Task 7: Inspect stage data (#19, engine + worker)

**Files:**
- Create: `packages/engine/src/render.ts`
- Modify: `packages/web/src/protocol.ts`, `worker.ts`, `runner.ts`
- Test: `packages/engine/test/render.test.ts`

**Interfaces:**
- `imageToRGBA(img: Image): Uint8ClampedArray`
- `layerToRGBA(layer: Layer, width, height, color: string): Uint8ClampedArray`. The ink colour is applied with alpha = tone. For categories, alpha = label/count, and label 0 is transparent.
- Protocol:
  - `ToWorker.run` gains `inspect: number | "source" | null` (step index).
  - `FromWorker.result` gains:
    - `plot: Plot | null`
    - `estimate: PlotEstimate | null` (worker computes it with `getMachine(recipe.machine)`)
    - `inspected: InspectView | null`
    - `underlay: RasterView | null`
    - `steps: Array<{ index; step; ms; cached; layers }>`
    - `warnings: string[]`
  - `error` gains `index?: number`.
  - `RasterView = { frame: Frame; png: Blob }`.
  - `InspectView = { kind: "image"; raster: RasterView } | { kind: "layers"; layers: Array<{ id; name; color; mix; raster: RasterView }> } | { kind: "lines"; plot: Plot }`.
- The worker encodes PNGs with `OffscreenCanvas.convertToBlob`. The underlay is the placed source (always sent; the UI decides whether to show it). The worker caches the encoded underlay per placement key.

- [ ] Write tests:
  - `imageToRGBA` of a 1-channel 2×1 [0, 1] gives `[0,0,0,255, 255,255,255,255]`.
  - `layerToRGBA` tone 0.5 with `#ff0000` gives `[255,0,0,128]`.
  - Categories label 0 gives alpha 0.
- [ ] Run; expect FAIL.
- [ ] Implement `render.ts`.
- [ ] Update protocol, worker and runner.
- [ ] `pnpm typecheck && pnpm test && pnpm build`; expect PASS.
- [ ] Commit `feat: worker returns inspectable stage data (#19)`.

### Task 8: Web: project settings, targets, inks, readouts (#14, #15, #16, #18 UI)

**Files:**
- Create: `packages/web/src/ProjectPanel.tsx` (target, paper, layout, resolution, inks, layer→ink, pass order)
- Modify: `App.tsx`, `defaults.ts` (v2 default recipe), `PlotPreview.tsx`, `styles.css`

Behaviour:
- **Target switcher:** Plotter / Digital (image) / Digital (vector) / Print prep. Raster and print show a DPI field (default 300).
- **Readout:** "Working detail: 0.25 mm per pixel (1188 × 840 px)", with an override number field and a "reset to automatic" link.
- **Layout:** fit/fill, margin mm, and position as a 3×3 anchor picker.
- **Inks:** list with colour, name, width mm and mix (multiply/normal); add/remove, keeping at least one.
- **Layer → ink:** a dropdown per layer name from the last result's final layers.
- **Pass order:** a list of line layers with up/down buttons and a "light → dark" reset.
- **Stats:** time only for the plotter target. It reads "~2 h 5 min (traced order; add Stroke order for a better estimate)" when `plot.ordered === false`, and includes pen changes in the stats.
- **Preview:** `mix-blend-mode` per ink group, and raster layers (from `plot.rasterLayers`, rendered in the worker as an InspectView) composited under the lines.
- **Notice:** when the target is plotter and raster layers exist: "1 layer isn't lines yet, so it won't plot: <names>. Add Centerline (or another line step) for it."

- [ ] Implement.
- [ ] `pnpm typecheck && pnpm build`; expect PASS.
- [ ] Run `pnpm dev` and fetch `/` with curl to confirm it serves. Watch the worker for errors by loading the bundle in vite-node? No; the UI check is manual. Note in the PR what to try.
- [ ] Commit `feat(web): project settings, targets, inks and readouts`.

### Task 9: Web: step list with drag-reorder, catalog, layer selectors, per-layer settings, seeds (#17, #20, #21 UI)

**Files:**
- Create: `packages/web/src/StepList.tsx`, `packages/web/src/LayerScope.tsx`
- Modify: `App.tsx`, `ParamControl.tsx` (seed → number + 🎲 reroll with `randomSeed()`), `styles.css`

Behaviour:
- **Step list:** one ordered list of step cards, with a stage divider wherever the output kind changes.
- **Reordering:** HTML5 drag handle, plus keyboard ↑/↓ buttons. Invalid drops leave the order unchanged and show the `moveStep` reason in a notice.
- **Catalog:** "+ Add step" lists every registry step and uses `insertStep`; unavailable ones are greyed out with the reason as a tooltip. Each card has ✕ remove (`removeStep`) and an enable checkbox.
- **Layer scope:** layer-acting cards show "Applies to: All layers ▾ / pick layers", built from the previous step's `layers`, plus "Settings for: All | <layer>" chips. Edits with a layer chip selected write `layerParams[layer]`; a "use shared settings" link removes the override.
- **Errors:** a step error (`StepInputError.index`) shows on its card.
- **On-demand steps** (Stroke order) show "Run" on their card when stale, instead of auto-running.

- [ ] Implement.
- [ ] `pnpm typecheck && pnpm build`; expect PASS.
- [ ] Commit `feat(web): reorderable steps, catalog, layer scope, seeds`.

### Task 10: Web: click a stage to inspect it (#19 UI)

**Files:**
- Create: `packages/web/src/StageView.tsx`
- Modify: `App.tsx`, `runner.ts` (remembers `inspect`), `PlotPreview.tsx`

Behaviour:
- **What to inspect:** clicking a step card or stage divider sets `inspect` to that index; "Source" inspects the placed source. The default is the last step.
- **What each stage shows:**
  - Image: the raster.
  - Layers: tinted layers with a per-layer eye toggle, composited with each ink's mix mode.
  - Lines: strokes without travel.
  - Plot: the current view.
- **Underlay:** a "Show source underneath" toggle draws the underlay at 25 % opacity.
- **Header:** shows "Viewing: <step title> output".

- [ ] Implement.
- [ ] `pnpm typecheck && pnpm build`; expect PASS.
- [ ] Commit `feat(web): inspect any stage (#19)`.

### Task 11: Docs, CLI polish, PR

**Files:**
- Modify:
  - `GLOSSARY.md` (Frame, rasterLayers → "layers not yet lines", 1-bit tone; source units removed)
  - `docs/adr/0009` (note: threshold = 1-bit tone)
  - `docs/adr/0011` (`order` step + traced-order Plot)
  - `README.md` (CLI example)
  - `packages/cli/src/main.ts` (`steps describe` prints seed and per-layer support)
  - `AGENTS.md` if commands changed

- [ ] Update the docs.
- [ ] Run `pnpm typecheck && pnpm test && pnpm build`, then `pnpm plotlab run golden/cases/mona-lisa-centerline.recipe.json -i golden/fixtures/mona-lisa-600.jpg -o /tmp/x` (scratchpad). Expect PASS and a time printed.
- [ ] Review the whole branch diff against this plan and the ADRs myself.
- [ ] Push and open a PR that closes #14–#21; link it.
