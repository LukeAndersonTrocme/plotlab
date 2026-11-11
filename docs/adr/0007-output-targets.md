# 7. Output targets; the pure digital workflow is first-class

Status: accepted (provisional, 2026-11-11)

## Context
The project builds a full pipeline to an XY plotter, but plotlab must be fully usable without
one: digital art, and as a reference for riso, screen print, relief and intaglio.

## Decision
A project has one active **output target**, switchable at any time:
- **Plotter:** machine profile, pens, paper; Plot stage, stroke ordering, print time.
- **Digital raster:** PNG/TIFF at pixel size or print size + DPI.
- **Digital vector:** SVG/PDF at a page size; strokes and filled shapes.
- **Print prep:** one file per ink; 1-bit or gray; DPI; mirror; registration marks; film
  positive; halftone screen (LPI + angle per ink). Mirror and registration also apply to plotter output.

The recipe does not depend on the target. The target sets units, working resolution
(ADR 0005) and which end-of-pipeline steps and readouts apply. Print time shows only for plotters.

## Consequences
- Each layer may end at a different stage (ADR 0009). Targets that need lines or 1-bit
  output say which layers aren't ready and suggest a step.
