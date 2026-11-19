# Dither

**What it does:** turns the tones of the image into a field of on/off dots. Each dot is
either full ink or bare paper; dark areas get many dots and light areas few, so from a
distance the dots read as greys. The result is one layer: one ink.

For now dithering is a **digital and print** method: it shows in the preview and exports
to PNG, print plates and screens. It becomes plottable once the Stipple step lands
(issue #45), which turns the dots into pen marks.

**Analog history:** <!-- Nick: newspaper halftone screens and how dithering imitates them
without a screen; early computer graphics and 1-bit displays; Bryce Bayer's ordered
matrix (Kodak, 1973); Robert Floyd and Louis Steinberg's error diffusion (1976); Bill
Atkinson's variant on the original Macintosh (1984)… --> *To be written with Nick.*

**What the sliders do physically:**
- **Method:**
  - *Floyd–Steinberg* rounds each dot to ink or paper and passes the leftover error on to
    its neighbours. Fine, organic grain that keeps detail.
  - *Atkinson* passes on only part of the error, so highlights and shadows stay clean and
    contrast goes up. The look of early Mac pictures.
  - *Ordered (Bayer)* compares each dot to a fixed repeating tile of levels. A regular
    cross-hatch texture, the same everywhere, with no grain.
- **Pattern size (Bayer only):** the tile is 2×2, 4×4 or 8×8 dots. Bigger tiles can show
  more grey levels (5, 17 or 65) but the pattern is coarser.
- **Serpentine scan (error diffusion only):** works along alternate rows in opposite
  directions, which breaks up the diagonal "worms" a one-way scan leaves.
- **Dot size:** the width of one dot on the paper, in mm. It stays the same whatever the
  preview resolution. Dots can't be smaller than one working pixel.
- **Invert:** put ink on the light areas instead (light ink on dark paper).
