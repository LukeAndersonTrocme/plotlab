# 3. Typed steps; stages are a view

Status: accepted (provisional, 2026-11-10)

## Context
The catalog is broad (threshold, dithering, CMYK, hatching, Turing, contours…). Inputs can
enter mid-pipeline (SVG at Geometry, pre-separated TIFFs at Layers).

## Decision
Every step declares an input and output type among `image`, `layers`, `geometry`, `plot`.
The UI groups steps into stages by output type (Input → Image → Layers → Output). A recipe
declares which type its source enters as. A step is `defineStep({ id, version, params, cost,
help, run })`; param declarations (with `visibleWhen` conditions) generate UI controls,
validation and CLI docs. Help lives in `help.md` next to the step.

## Consequences
- Internally it's a chain of typed nodes, so a node-graph view is possible later.
- One layer = one physical pen pass, by definition.
