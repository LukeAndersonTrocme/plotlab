# Reaction–diffusion (experimental)

**What it does:** grows a Turing pattern over the picture: two imaginary chemicals spread
out and react with each other, and out of a random start they settle into spots, winding
stripes or a honeycomb of holes. The picture's tone decides which: light areas grow the
**Light areas** pattern, dark areas the **Dark areas** pattern, and the tones in between
blend the two. With the defaults, light areas get sparse spots, mid-tones become a maze
and dark areas fill in leaving only small holes, so the pattern still reads as the picture.

The result is a grey picture. Follow it with Threshold (or Ink density and Levels) to
turn it into shapes to trace or fill.

This step is **experimental** and slow: it runs when you press Update, not while you drag
sliders. The method may still change, so a recipe made with it may look different after
an update.

**The science:** Alan Turing (1952) showed how two chemicals that react and spread at
different speeds can make stable patterns from almost nothing, and proposed it as the
origin of spots and stripes on animals. This step uses the Gray–Scott model (Pearson
1993): one chemical is fed in, the other eats it and is slowly removed. The feed and
removal rates pick the kind of pattern.

**Analog history:** *To be written with Nick* (zebra and leopard coats, fingerprints,
marbled endpapers, the Belousov–Zhabotinsky reaction in a dish…).

**What the sliders do:**
- **Light areas / Dark areas:** the pattern grown in the lightest and the darkest parts.
  Spots leave the most paper bare, mazes about half, holes the least. Swap them for a
  negative.
- **Feature size:** the distance from one spot or stripe to the next, in mm on the paper.
  Bigger is faster to compute and easier to plot.
- **Growth steps:** how long the pattern grows. Too few and parts are still blurry or
  unformed; more lets the shapes settle and line up, but takes longer.
- **Seed:** a different random start gives a different arrangement of the same pattern.
  The same seed always gives the same result.
