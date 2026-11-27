# 9. Layers hold tone or categories; one chain, per-layer engines

Status: accepted (provisional, 2026-11-11)

## Context
The first scaffold's layers were 1-bit masks. Topo bands, halftone, dithering and collage
need richer values. Nick and Luke want each layer treated by a different engine (pixelated
cyan, striped yellow, stippled magenta).

## Decision
- A layer's values are either **tone** (0..1 ink density) or **categories** (label 1..N).
  Steps declare which they accept. When one doesn't fit, the UI explains and suggests a
  converting step (e.g. Levels turns tone into categories).
- The recipe stays **one chain**. Steps that act on layers take a layer selector and
  per-layer settings; layers they don't touch pass through unchanged.
- A layer's chain may stop at any stage; digital targets composite each layer from where it stopped.
- Steps can be reordered wherever types allow; invalid orders get a plain-language reason.
- Branching recipes wait for a node view.

## Implementation notes (M0, 2026-11-11)
- Threshold makes a **1-bit tone** layer (0/1), not two categories, so nobody has to pick
  which category is "ink". Levels (M1) is the first step that makes categories.
- Layer-acting steps implement `runLayer`; the recipe step carries `layers` (selection) and
  `layerParams` (per-layer overrides). Layers that stop before becoming lines travel on as
  `rasterLayers`.

## Implementation notes (CMYK lanes, #78, 2026-11-26)
- **One line step per ink.** Once the chain has lines, a layer step may still work on the
  layers a line step left (`rasterLayers`), so each ink can have its own line step
  (pixelated magenta, stippled yellow). The rule is exact (`stages.ts`): the chain tracks the
  ids of the layers still layers, known from a step that declares its layers (`layerInks`,
  e.g. Separate CMYK). A layer step after lines must name a non-empty subset of them in its
  selector; a selector of "all", a layer already lines, or unknown ids (a single-layer step,
  a layers source) are refused as before. A line step there adds its lines after the ones
  already made; the plot orders passes by `passOrder`.
- **Lines steps per layer.** A lines → lines step that treats each layer alone
  (`linesPerLayer`: Fill) takes a selector and per-layer settings like a layer step; the
  engine runs it per selected layer only when it has either.
- **Lanes** (`lanesOf`) are a view of this one chain, not a tree. Each lane must make sense on
  its own (`laneIssues`): no layer step after that ink is lines, no Fill before it is. Lane
  edits keep every lane valid, and whole-chain edits (move, add, remove, switch on/off) are
  refused when they would break a lane that worked (`newLaneIssue`).
