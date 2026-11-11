# 11. Split "Place on paper": layout, ordering, time readout, passes

Status: accepted (provisional, 2026-11-11)

## Context
Greedy O(n²) stroke ordering took 26 s on 83k strokes, and the step mixed layout, ordering
and estimating.

## Decision
- Layout belongs to project settings (ADR 0005).
- **Stroke ordering** is its own on-demand Plot step (spatial index + 2-opt); its modes can be
  artistic choices too. Until it runs, the preview and estimate use traced order and say so.
- **Print time** is an always-visible readout (plotter targets only), never a limit. An
  optional time budget comes later.
- A multi-ink plot is a sequence of **passes** with pen-change pauses; layer order is
  adjustable (light → dark by default) and pen changes count toward the time.
