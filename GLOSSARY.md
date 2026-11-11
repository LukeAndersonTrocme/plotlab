# Glossary

Shared vocabulary between Nick (image-making) and Luke (data science). Each concept gets one
canonical term, used in code, UI and help panels. Seeded from the 2026-11 design session and
still to be argued over with Nick. Change a term here first, then rename it everywhere.

| Canonical term | Means | Nick might say | Luke might say |
|---|---|---|---|
| **Source** | The input file(s): photo, scan, SVG, frame sequence | the image | input data |
| **Image** | A raster: a grid of pixels, possibly with several channels | bitmap | XY grid with a Z value per cell |
| **Channel / Z** | The value(s) stored at each pixel (gray, R/G/B, C/M/Y/K) | colors, layers of color | Z-axis, discrete or continuous |
| **Levels** | How many distinct Z values are kept (2 = black/white) | shades | breaks, quantization, contour count |
| **Layer** | One physical pen pass: a mask of where one pen/color goes | a color, a separation, a plate | a binary/few-level mask |
| **Separation** | Splitting an image into layers (CMYK, palette, split darks) | separating colors | decomposition |
| **Color mosaic** | Discrete opaque color areas, relying on optical mixing | mosaic, color bitmap | palette reduction, clustering |
| **Screen angle** | Rotation of a layer's halftone/hatch grid; controls moiré | screen angle | grid rotation |
| **Dither** | Spreading dots to fake intermediate tones with 1-bit | dither, halftone-ish | error diffusion / ordered threshold |
| **Halftone** | A regular grid of dots/lines whose size encodes tone | halftone | fixed-resolution tone encoding |
| **Reaction-diffusion** | Turing-pattern transform of an image | Turing pattern | reaction-diffusion system |
| **Geometry** | Vector paths and polygons derived from layers | vector, lines | spatial features (sf/GeoJSON) |
| **Centerline** | A single stroke down the middle of a shape | centerline trace | medial axis / skeleton |
| **Fill** | Strokes that cover a shape's area (hatch, halftone, pattern) | fill | area coverage |
| **Pen** | A tool with a width (mm) and color, assigned to a layer | marker, pen | stroke width parameter |
| **Plot** | Geometry on paper in mm, ordered, with pen-up travel | the print, the file for the machine | path / job |
| **Travel** | Pen-up moves between strokes | | TSP edges |
| **Time estimate** | Predicted plot duration from the machine profile | how long it'll take (and cost) | runtime estimate |
| **Machine profile** | Description of a plotter: bed, speeds, protocol | the machine settings | device config |
| **Step** | One operation in the pipeline, with its own parameters | a trick, a move | function |
| **Recipe** | The ordered steps + all parameter values, as JSON | the settings, the process | pipeline config |
| **Variant** | A named snapshot of a recipe within a project | a version | branch / parameter set |
| **Stage** | UI grouping of steps by data type (Input, Image, Layers, Output) | step in the process | pipeline phase |

## Open terminology questions

- "Layer" vs "separation" vs "plate": Nick's preference?
- Is "bitmap" 1-bit only, or any raster? (It varies in common usage. Pick one meaning.)
- Mosaic vs color bitmap: confirm the term Nick uses.

## Code-level terms

| Term | Means |
|---|---|
| **Stage data** | The typed value passed between steps: `Image`, `Layers`, `Geometry` or `Plot` (`packages/engine/src/types.ts`). |
| **Source units** | Coordinates in the original Source's pixels. Rasters carry an `extent` in source units so a low-res **proxy** traces to the same place as full resolution. The `plot` step maps source units to mm. |
| **Proxy** | A downscaled copy of the Source used while a slider is being dragged. |
| **Step contract** | A step = `run` function + param declarations + `help.md` + tests (`defineStep`). |
| **Cost** | A step's `live` / `on-demand` hint for the UI. |
| **Golden test** | A recipe + fixture whose output is compared to a human-approved file in `golden/approved/`. |
