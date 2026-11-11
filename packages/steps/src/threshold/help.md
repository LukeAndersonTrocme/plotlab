# Threshold

**What it does:** every pixel darker than the *level* becomes ink; everything else stays
paper. The result is one layer: one pass of one pen.

**Analog history:** <!-- Nick: line film / lith film, high-contrast copy work, photocopier
"darkness" knob… --> *To be written with Nick.*

**What the sliders do physically:**
- **Level:** moves the line between "ink" and "paper". Lower = only the darkest areas get
  drawn, so less ink and a shorter plot.
- **Automatic (Otsu):** picks the level that best splits the image's tones into two groups.
  Good starting point for scans and high-contrast photos.
- **Invert:** draw the light areas instead (useful on dark paper with a light pen).
