# Bands

**What it does:** draws the outline of every level as a shape, like the coloured zones on a
topographic map. Shapes keep their holes (a light patch inside a dark one), so the next step
can fill each band with its own pattern. Or choose **Contour lines** to draw only the borders
between levels.

**Analog history:** *To be written with Nick* (topographic contour maps, isolines in
weather charts, the old R prototype's banded hatching…).

**What the settings do physically:**
- **Make:** *Areas to fill* gives shapes for Fill. *Contour lines* gives one line per border,
  ready to plot as-is.
- **Simplify:** straightens the little stair-steps that come from pixels. Higher = smoother,
  less faithful edges.
