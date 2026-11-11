# 5. Paper fit is a project setting; steps work in mm

Status: accepted (provisional). Revised 2026-11-11 (grilling round 2); supersedes the
"source units" version of 2026-11-10.

## Context
The first scaffold kept rasters and geometry in *source units* (original pixels) and only
mapped to mm in the `plot` step. That made low-res proxies easy, but hatch spacing, halftone
cells and pixelate cell size all want physical units earlier. Full-resolution processing also
wasted time: 4501 px → 83k strokes, ~42 s.

## Decision
- Paper fit (paper size, margin, fit/fill/crop, position) is a **project setting** applied
  before any step. Every step works in mm on the paper.
- The project has a **working resolution** (mm per pixel) derived from the output target
  (ADR 0007): about half the narrowest ink width for plotters, DPI for raster output, with an
  override. The source is resampled to it once at load. The drag proxy is a coarser copy of
  the same mm extent.
- The `plot` step loses its layout role (see ADR 0011).

## Consequences
- Changing the paper or fit re-runs every step.
- Steps receive mm-per-pixel and never see source pixels.
