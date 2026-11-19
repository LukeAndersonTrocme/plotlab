# Pixelate

**What it does:** turns each layer into a grid of big square cells. A tone layer gets the
average darkness of each cell; a levels layer gets the most common level. For digital output
the cells stay as pixels; for plotting, follow it with Levels → Bands → Fill. The grid starts
at the paper's top-left corner, not the picture's, so it lines up with **Grid cells** and
**Fill** at the same size: a Pixelate and a Grid cells with the same cell size and shifts
give exactly the same cells. Cells cut by the picture's edge stay as narrower blocks (Grid
cells leaves out the thinnest of these).

**Analog history:** *To be written with Nick* (mosaics, cross-stitch charts, knitting
patterns, the old R prototype's pixelated grids…).

**What the settings do physically:**
- **Cell size by:** millimetres on the paper, or a number of cells across the picture.
- **Cell size / Cells across:** bigger cells = a blockier, more abstract picture.
- **Shift grid across / down:** moves the grid's lines from the paper's corner, in
  millimetres, to choose where the cells fall on the picture. Shifting by a whole cell gives
  the same grid again. Give Grid cells the same shifts to keep the two lined up.
