# 5. Millimetres on paper; source units before that

Status: proposed (2026-11-10), decided while scaffolding. Revisit in the next grilling round.

## Context
Everything physical is in mm. But raster steps run on proxies of different resolutions while
dragging, and geometry must land in the same place whatever the resolution.

## Decision
Rasters (`Image`, `Layers`) carry an `extent` in source units (original pixels). Geometry is
in source units. The `plot` step fits the extent onto the paper inside a margin and converts
to mm. Pens have widths in mm and the preview draws strokes at that width.

## Consequences
- Proxies are invisible to downstream steps.
- Steps that need physical sizes before the plot step (e.g. hatch spacing in mm) will need the
  paper mapping earlier. Likely answer: move "fit to paper" into the project settings and give
  geometry steps the mm-per-source-unit scale. Open question.
