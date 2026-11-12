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

## Implementation notes (M2, 2026-11-11)
- One export module (`engine/src/exporter.ts`) serves the web worker and the CLI, so both
  write the same bytes. The end of the chain is drawn onto the paper as one **plate** per
  ink (layers sharing an ink share a plate), then written per target: plotter → SVG;
  vector → SVG or PDF; raster → PNG or TIFF; print → one TIFF per ink plus a proof PNG.
- Raster files composite plates in pass order with each ink's mix mode; a leftover image
  is the paper underneath. Vector files put embedded rasters under the lines (multiply is
  order-free; for "normal" inks the raster files are the reference).
- Plotter SVG leaves out layers that aren't lines and says so. Registration marks are
  added to every pass; mirror flips the page (a transform in SVG/PDF, pixels in rasters).
- Halftone is a round-dot screen whose dot area equals the tone. Without a screen, 1-bit
  plates cut at 50%. Categories print as label/count density, like the preview.
- The print target's options live on the target (`mode`, `halftone`, `negative`, `mirror`,
  `registration`); the plotter target takes `mirror` and `registration`. No schema bump:
  missing fields read as defaults.
- Not yet: multi-page TIFF as separations (enters at layers) and SVG input (enters at
  lines) need the pipeline to accept those stages as input; CLI WebP needs a decoder.
