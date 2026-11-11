# Centerline

**What it does:** shrinks each inked shape down to a one-pixel "skeleton", then follows it to
make strokes. A thick letter becomes a single line down its middle, the way you'd write it
with a pen instead of filling it in.

**Analog history:** *To be written with Nick* (single-line fonts for engraving, Hershey fonts,
technical-pen lettering…).

**What the sliders do physically:**
- **Minimum length:** strokes shorter than this are dropped. Raise it if the plot is full of
  tiny ticks from dust or noise.
- **Simplify:** how much small wiggles are straightened. More simplify means fewer pen
  segments, so faster and smoother plots, but less detail.

Note: the line has the pen's width, not the shape's width. Thick shapes get thinner.
Use a fill step (coming later) to cover areas.
