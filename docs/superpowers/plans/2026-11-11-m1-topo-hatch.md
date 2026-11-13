# M1 Topo-hatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn a photo into topographic bands, each filled with its own hatch or dot pattern, plus a Pixelate step and the first presets. Covers issues #22–#26.

**Architecture:** The chain is Ink density (image → tone layer) → Levels (tone → categories) → Bands (categories → polygons with holes, or contour lines) → Fill (polygons → hatch/dot lines on one shared page lattice) → Stroke order. Geometry gains Polygon features; toPlot draws polygon rings as outlines. Pixelate is layers → layers. Presets are recipe fragments, and each one is proven by a golden case.

**Tech Stack:** TypeScript, Vitest, React (as in M0). No clipping library: scanline clipping against rings is enough for lattices.

**Spec:** issues #22–#26; Workbench `software-design.md` § "Topo bands and fills"; ADR 0009, 0012.

## Global Constraints

- Same as M0: no new runtime deps, `plotlab` stays renameable, Mona Lisa fixture only (no Ben).
- Steps work in mm. Per-band tone ranges travel with the data.
- Each new step has `help.md` ("Analog history: *To be written with Nick*" placeholder), unit tests, and at least one golden.
- `pnpm typecheck && pnpm test && pnpm build` stays green at every commit.

## Decisions taken while planning

- **Ink density step** (`tone`, image → layers): one tone layer, `1 − luminance`. Nothing produced a tone layer from an image before, and Levels needs one.
- **Category order:** label 1 = lightest band (least ink), N = darkest. Categories values gain `bands?: Array<{ lo; hi }>` (tone range per label), so Bands and Fill know each band's tone.
- **Levels** quantile cuts collapse on flat areas (e.g. a white background). Duplicate cuts are merged, so the step can output fewer bands than asked, with no error. Custom cuts come from a new `text` param ("20, 45, 70", in %).
- **Bands** use marching squares on each band's mask, padded with a 0 border so rings close. The outer/hole role comes from signed area, and each hole goes to its containing outer ring. The ambiguous saddle case is resolved as "separate". Contour mode emits iso-lines between k and k+1 and drops segments along the image border.
- **Fill** clips lattice lines (or rows of dots) to polygons by scanline even-odd intervals, with the lattice anchored at paper (0, 0) for every band (shared origin).
  - The mapping uses band tone `t = (lo+hi)/2`.
  - **continuous:** spacing goes from `maxSpacing` (t=0) to `minSpacing` (t=1); angle = `angle + t·angleSpread`.
  - **cycle:** the old R pattern. Angles go 0/90/45/135 by band index; spacing shrinks every 4 bands.
  - **table:** per-band overrides, via a new `table` param type.
  - **Thickness** (a per-feature stroke width) is deferred to M2 digital output, because Plot only knows ink width.
- **Presets** live in `packages/steps/src/presets.ts` as `{ id, title, summary, steps }`. A golden case may say `"preset": "<id>"` instead of listing steps. The UI offers "Start from a preset…", which replaces the steps.
- **Execution:** inline, final self-review (same session rules as M0).

## Review Focus

1. **Bands on a band touching the image edge, and a band with a hole** (a ring inside a ring). Expect closed polygons with the hole as a second ring, and no seam lines along the frame in contour mode. → Task 4 tests.
2. **Levels on an image that is mostly one value** (white background). Expect fewer bands rather than empty or duplicate bands, and no NaN. → Task 3 test.
3. **Fill on concave polygons and holes.** Expect no hatch inside holes and no line crossing outside. → Task 6 test (point-in-polygon check on midpoints).
4. **Fill spacing near 0 / huge plots.** Expect spacing clamped to ≥ 0.1 mm so a slider at 0 can't hang the app. → Task 6 test.
5. **Old recipes and goldens are unaffected** (no envelope change). → existing goldens stay byte-identical until Task 9 adds new ones.

---

### Task 1: Polygons in geometry

**Files:** `packages/engine/src/types.ts`, `project.ts` (toPlot), `packages/steps/src/order/index.ts`; new `packages/engine/src/features.ts`; test `packages/engine/test/features.test.ts`

**Interfaces:**
- `PolygonFeature { type:"Feature"; geometry: { type:"Polygon"; coordinates: Position[][] }; properties }`
- `GeoFeature = LineFeature | PolygonFeature`
- `GeometryLayer.features.features: GeoFeature[]`
- `featurePaths(f: GeoFeature): Position[][]`: a line gives its coordinates; a polygon gives each ring, closed.

- [ ] Test:
  - `featurePaths(polygon with hole)` returns 2 closed rings.
  - `toPlot` of a layer with one polygon gives 2 paths.
  - Order keeps polygon rings.
- [ ] Run; expect FAIL.
- [ ] Implement, using `featurePaths` everywhere strokes are read from features.
- [ ] Run `pnpm test`; expect PASS, with goldens unchanged.
- [ ] Commit `feat(engine): polygon features (#23)`.

### Task 2: `text` and `table` param types

**Files:** `packages/engine/src/params.ts`, `packages/cli/src/main.ts` (describe), `packages/web/src/ParamControl.tsx`; test `packages/engine/test/params.test.ts`

**Interfaces:**
- `TextParam { type:"text"; default: string; placeholder?: string }`
- `TableParam { type:"table"; rowLabel: string; columns: Record<string, { label; min; max; step?; unit? }>; default: Record<string, Record<string, number>> }`. The value maps a row key (e.g. a band number "3") to partial column values.
- `resolveParams`:
  - text must be a string.
  - table must be an object of objects. Unknown columns are dropped with an issue, and numbers are clamped with an issue.

- [ ] Test:
  - Text accepts a string and rejects a number.
  - Table keeps `{ "3": { spacing: 1 } }`.
  - It clamps `spacing: 999` with an issue.
  - It drops `{ "3": { bogus: 1 } }` with an issue.
- [ ] Run; expect FAIL.
- [ ] Implement, including the UI: text input, and a table with "+ Override band" plus a row editor.
- [ ] `pnpm typecheck && pnpm test && pnpm build`.
- [ ] Commit.

### Task 3: Ink density + Levels (#22)

**Files:**
- `packages/steps/src/tone/{index.ts,help.md}`
- `packages/steps/src/levels/{index.ts,help.md}`
- `packages/engine/src/types.ts` (categories `bands?`)
- `packages/steps/src/index.ts`
- test `packages/steps/test/levels.test.ts`

**Interfaces:**
- `tone` v1:
  - Params: `invert` (bool), `contrast` (0.2..5, default 1; `t' = clamp((t − 0.5)·contrast + 0.5)`).
  - Output: layer id `tone`, name "Ink density".
- `levels` v1 (runLayer, accepts tone):
  - `count` 2..12 (default 5).
  - `method` quantile | equal | custom.
  - `cuts` text (visible for custom; % values).
  - `smoothing` 0..5 mm (default 0.5; a box blur ×3 approximating a Gaussian of that sigma in pixels = mm / mmPerPx).
- Exports: `cutPoints(values: Float32Array, count, method, custom: number[]): number[]` (sorted, deduped, in (0,1)); `blurTone(data, w, h, sigmaPx): Float32Array`.

- [ ] Test:
  - `equal` with 4 gives [0.25, 0.5, 0.75].
  - `quantile` on 0..1 uniform gives ≈ equal.
  - `quantile` on 90 % zeros dedupes (fewer cuts, all distinct, none NaN).
  - `custom` "70, 20" gives [0.2, 0.7].
  - Levels output labels 1..N with lightest = 1, and `bands` lo/hi covering [0, 1].
  - Blur preserves mean.
- [ ] Run; expect FAIL.
- [ ] Implement.
- [ ] Run; expect PASS.
- [ ] Regenerate help.
- [ ] Commit `feat(steps): ink density and levels (#22)`.

### Task 4: Marching squares rings and contours (#23)

**Files:** `packages/steps/src/bands/trace.ts`; test `packages/steps/test/trace.test.ts`

**Interfaces:**
- `maskPolygons(mask: Uint8Array, w, h): Position[][][]`: polygons in pixel coordinates (pixel centres at x+0.5), outer ring first then holes. Outer rings are counter-clockwise in y-down coordinates (positive signed area by the shoelace formula on screen coordinates), and holes are the opposite.
- `maskContours(mask, w, h): Position[][]`: iso-lines, with segments along the padded border removed; open or closed polylines.
- `ringArea(r): number` (signed).

- [ ] Test:
  - A 3×3 filled square in a 7×7 mask gives one polygon, one ring, area ≈ 9 − corner cuts (between 7 and 9).
  - A ring (square with a hole) gives one polygon with two rings of opposite sign.
  - Two separate blobs give two polygons.
  - A blob touching the edge gives a closed ring.
  - Contours of a left-half mask give one open vertical line (no border segments).
- [ ] Run; expect FAIL.
- [ ] Implement.
- [ ] Run; expect PASS.
- [ ] Commit.

### Task 5: Bands step (#23)

**Files:** `packages/steps/src/bands/{index.ts,help.md}`; test in `packages/steps/test/bands.test.ts`

**Interfaces:**
- `bands` v1 (runLayer, accepts categories, layers → geometry).
- Params: `mode` areas | contours; `simplify` 0..2 mm (default 0.2).
- Areas: one Polygon feature per polygon, with `properties: { level, toneLo, toneHi }`, in paper mm via `pxToMm` (fractional pixel → mm: `x·frame.widthMm/w + frame.xMm`).
- Contours: LineString features with `{ level }` (boundary between level and level+1).

- [ ] Test:
  - A 2-label grid (left = 1, right = 2) in areas mode gives polygons with levels {1, 2} covering the frame area (sum of |area| ≈ frame area within 5 %).
  - Contours mode gives one line near x = middle.
- [ ] Implement.
- [ ] Commit.

### Task 6: Lattice clipping (#24)

**Files:** `packages/steps/src/fill/lattice.ts`; test `packages/steps/test/lattice.test.ts`

**Interfaces:**
- `hatch(rings: Position[][], spacingMm, angleDeg): Position[][]`: lines at offsets `k·spacing` from the paper origin along the normal, clipped even-odd to the rings.
- `dots(rings, spacingMm, angleDeg, radiusMm): Position[][]`: lattice points inside the rings. Each is a closed 8-gon if radius > 0.15 mm, else `[p, p]`.
- `MIN_SPACING = 0.1`: spacing is clamped.

- [ ] Test:
  - Hatch at 0° spacing 1 in a 10×10 square gives ≈ 10 horizontal lines, each 10 long.
  - Square with a 4×4 hole: no line midpoint inside the hole, and all midpoints inside the outer.
  - Concave L-shape: all midpoints inside.
  - Shared origin: two adjacent squares produce lines at identical y values.
  - Spacing 0 clamps to 0.1 and terminates.
  - Dots in a 10×10 square at spacing 2 give ≈ 25.
- [ ] Implement.
- [ ] Commit.

### Task 7: Fill step (#24)

**Files:** `packages/steps/src/fill/{index.ts,help.md}`; test `packages/steps/test/fill.test.ts`

**Interfaces:**
- `fill` v1, geometry → geometry, run (whole stage).
- Params:
  - `kind` lines | dots
  - `mapping` continuous | cycle | table
  - `minSpacing` (0.3 mm), `maxSpacing` (3 mm)
  - `angle` (45°), `angleSpread` (0° … 180°)
  - `dotSize` (0.1..3 mm, default 0.4; radius scales with t)
  - `overrides` (table: spacing, angle, by band number)
  - `cumulative` (bool, false)
  - `skipLightest` (bool, true)
  - `outline` (bool, false: keep band outlines)
- Behaviour:
  - Non-polygon features pass through.
  - Polygon band k becomes the fill lines of k (plus, if cumulative, those of every inked band j < k, each with j's pattern).
  - `bandPattern(level, toneMid, count, p): { spacing; angle }` is exported for tests.

- [ ] Test:
  - Continuous: darker band → smaller spacing.
  - Cycle: angles for levels 2..5 are [0, 90, 45, 135].
  - A table override for band 3 wins.
  - skipLightest removes band 1's lines.
  - Cumulative adds band 2's pattern inside band 3 (more lines than non-cumulative).
  - Contour lines pass through untouched.
- [ ] Implement.
- [ ] Commit.

### Task 8: Pixelate (#25)

**Files:** `packages/steps/src/pixelate/{index.ts,help.md}`; test `packages/steps/test/pixelate.test.ts`

**Interfaces:**
- `pixelate` v1 (runLayer, both kinds).
- Params: `sizing` mm | across; `cellMm` (0.5..50, default 5); `across` (4..400, default 40).
- Output on the same grid: tone = mean per cell; categories = most frequent label per cell.

- [ ] Test:
  - A 4×4 tone grid with 2 px cells averages each 2×2 block.
  - Categories take the mode.
  - `across: 2` on a 4×4 gives 2 px cells.
- [ ] Implement.
- [ ] Commit.

### Task 9: Presets + goldens (#26)

**Files:**
- `packages/steps/src/presets.ts`
- `golden/golden.test.ts` (adds `preset`)
- `golden/cases/mona-topo-hatch.recipe.json`, `mona-topo-dots.recipe.json`, `mona-contours.recipe.json`, `mona-pixelate-bands.recipe.json`
- `packages/web/src/StepList.tsx` ("Start from a preset…")
- test `packages/steps/test/presets.test.ts`

**Interfaces:**
- `presets: Array<{ id; title; summary; steps: RecipeStep[] }>`:
  - `centerline`
  - `topo-hatch` (tone, levels 6 quantile, bands, fill lines cycle cumulative, order)
  - `topo-dots`
  - `contours`
  - `pixel-bands` (tone, pixelate, levels, bands, fill lines continuous, order)
- `presetSteps(id): RecipeStep[]` (deep copy).

- [ ] Test:
  - Every preset loads through `loadRecipe` without warnings.
  - Every preset id is used by at least one golden case.
- [ ] `pnpm golden:approve`.
- [ ] Render each new SVG with rsvg-convert and look at it.
- [ ] Commit.

### Task 10: Docs + PR

- [ ] Update GLOSSARY (Ink density, Band tone range, Lattice, Cumulative, Preset in code) and the README status.
- [ ] Final self-review against the Review Focus.
- [ ] Headless-Chrome smoke test of the topo-hatch preset.
- [ ] Push and open a PR on top of #40.
