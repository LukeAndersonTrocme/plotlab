# Separate CMYK

**What it does:** splits the picture into four layers, one per ink: cyan (C), magenta (M),
yellow (Y) and black (K). Each layer says how much of that ink each spot gets. Adding the
step also adds the four inks to the project and gives each layer its ink. Steps after it
(Levels, Pixelate, Fill…) work on all four layers, or on the ones you pick.

**Analog history:** *To be written with Nick* (process cameras shooting through red, green
and blue filters, undercolour removal on the press…).

**What the sliders do physically:**
- **Black generation:** where cyan, magenta and yellow all overlap, they make a muddy grey.
  This setting moves that shared grey into the black ink instead. At 0 there is no black
  at all and the darks are built from three inks. At 1 every grey is printed with black
  alone, and the colour inks only carry colour. More black generation means less colour
  ink and sharper darks; less means richer, softer shadows.

**How it is worked out:** cyan starts as 1 − red, magenta as 1 − green, yellow as 1 − blue.
Black is *black generation* × the smallest of the three. Each colour ink then becomes
(colour − black) / (1 − black), so the four inks printed over each other give back the
original colour, whatever the setting. This is the plain textbook split; it doesn't model
a particular printer's inks or paper.
