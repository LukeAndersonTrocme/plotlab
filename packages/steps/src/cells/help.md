# Grid cells

**What it does:** lays a square grid over each layer and draws one square per cell, as
pen lines. It is the vector twin of **Pixelate**: Pixelate keeps the cells as pixels, Grid
cells turns them into shapes a plotter can draw or an SVG keeps sharp at any size. The grid
starts at the paper's top-left corner, like **Fill**'s lines, so every layer gets the same
cells. On a **Levels** layer each cell takes its most common band, so the squares come in
one size per band. Cells cut by the picture's edge are clipped to it, and left out when
less than a quarter of the cell is left.

**Analog history:** *To be written with Nick* (mosaic tesserae, cross-stitch and
needlepoint charts, early bitmap displays and their visible pixels…).

**What the settings do physically:**
- **Squares:** *Outline every inked cell* draws a full square in each cell dark enough to
  pass the threshold, like a tile mosaic. *Sized by darkness* draws a square in the middle
  of each cell that grows with its ink, like a halftone made of squares.
- **Cell size:** the width of each cell on the paper. Bigger cells = a blockier picture and
  a shorter plot.
- **Leave lighter cells empty:** cells at or below this ink density stay paper.
- **Smallest / largest square:** the square's size for the lightest and the darkest ink, as
  a share of the cell.
- **Gap:** space between neighbouring squares, so tiles don't touch.
- **Rotate:** turns every square about its cell's centre; 45° gives diamonds. Turned
  squares shrink so they stay inside their cell.
- **Shift grid across / down:** moves the grid's lines from the paper's corner, in
  millimetres, to choose where the cells fall on the picture. Shifting by a whole cell gives
  the same grid again. A **Pixelate** with the same cell size and shifts lines up exactly.

The squares are outlines: the pen draws each square's edge, and a digital export keeps
them as sharp vector squares. Solid filled squares are not available yet, and a **Fill**
after Grid cells doesn't hatch the squares by darkness yet.
