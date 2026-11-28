# Changelog

## 0.1.0 (2026-11-27)

First version for testers. Runs in the browser at
https://lukeandersontrocme.github.io/plotlab/. The user manual is at `/manual/` on the same
site, as a web page and a PDF.

- **Editor** with three modes: Design (recipe strip, step cards, Pin, Compare stages with
  side by side, top to bottom, Lens and Boxes), Page (paper, margin, placement, pens, output
  target) and Plot (time breakdown, Play replay, passes, downloads).
- **13 steps** from Threshold to Stroke order, and **11 presets**. Experimental:
  Reaction–diffusion and Stipple.
- **Four inks (CMYK)**: split, Linked or Independent lanes, Stacked or Four panels,
  See-through or Opaque preview, plotting order.
- **Output targets**: Plotter (SVG), Digital image (PNG, TIFF), Digital vector (SVG, PDF),
  Print prep (one TIFF per ink, halftone, film negative, mirror, registration marks).
- **Checkpoints**: saved by hand or automatically before a preset or restore; Branch from
  here; Back and Forward undo everything.
- **Bundles**: export a project as one .zip and open it on another device; a phone viewer
  for looking at projects.
- **Command line**: `plotlab run`, `steps list`, `steps describe`.

Known limits are in part 7 of the manual.
