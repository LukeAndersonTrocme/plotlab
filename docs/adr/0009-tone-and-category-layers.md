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
