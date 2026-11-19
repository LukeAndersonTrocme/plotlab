# Stipple

**What it does:** draws the tone as dots. Darker areas get more dots, packed closer together;
light areas get a few scattered dots; bare paper gets none. The dots are then nudged around
until they sit evenly, so the picture reads as smooth shading instead of random grain.

**Experimental:** this step is new. Its settings and output may still change between
versions; old recipes will load with a warning instead of breaking.

**Analog history:** *To be written with Nick* (stippling in engraving and scientific
illustration, pointillism, dot-and-pen technical drawing…).

**How it works:** the dots are first scattered at random, keeping more of them where the tone
is darker (the seed picks the scatter). Then, a few times over, each dot moves to the middle
of the patch of tone closest to it, weighted by how dark that patch is. This is weighted
Voronoi stippling (Secord, 2002). It can take a second or two on a big picture, so it runs
when you press **Run**.

**What the settings do physically:**
- **Darkest spacing:** the distance between dots where the ink is full. A spacing of 1 mm
  means about one dot per square millimetre in the blacks. Lighter areas spread out from
  there. Halving the spacing makes four times as many dots, and a much longer plot. Very fine spacing on a big page is capped at 60 000 dots.
- **Even out:** how many rounds of relaxation. 0 keeps the raw random scatter, which looks
  grainy; around 10 is smooth; more rarely changes much.
- **Dot:** a *pen tap* lowers the pen once and lifts it, so each dot is the width of the pen.
  A *small circle* draws a tiny ring, for dots bigger than the pen (a fine pen fills it in
  if the ring is not much wider than the line).
- **Dot size:** the diameter of each circle.
- **Seed:** a different random scatter. The same seed always gives the same dots.

Tip: put **Stroke order** after it. Its *Single stroke* mode joins all the dots into one
continuous line, a "TSP art" drawing that never lifts the pen.
