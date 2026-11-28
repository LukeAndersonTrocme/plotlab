# Ideas

plotlab has a few ideas that come up everywhere. This part explains them once.

## The recipe

The **recipe** is the ordered list of steps that turns your image into lines, together with
every setting of every step. Everything you do in Design mode changes the recipe.

The recipe is separate from your image. You can save a recipe as a small file
(**Download recipe**, §5.8) and use it on another picture.

## Steps, and what they make

A **step** does one thing to what the step before it made. Each step makes one of four
kinds of thing, shown by the colour band on its box in the strip:

| Kind | What it is | Steps that make it |
|---|---|---|
| **Image** | A picture made of pixels, like a photo | the Source, Reaction–diffusion |
| **Layers** | One or more maps of where ink goes, one per ink or per band | Threshold, Ink density, Separate CMYK, Levels, Pixelate, Dither |
| **Lines** | Strokes and shapes, measured in millimetres on the paper | Centerline, Bands, Fill, Grid cells, Stipple |
| **Plot** | The lines in the order the pen will draw them | Stroke order |

Steps can only follow steps that make what they need. That's why the **+** in the strip
only offers steps that fit at that point, and why some moves are refused. You can't build a
recipe that doesn't work.

Every step is described in §6.1.

## Presets

A **preset** is a ready-made recipe, such as *Topographic hatching* or *CMYK print*. Picking
one replaces your steps. A few presets also change the output target; for example
*Atkinson print* switches to Print prep. Your previous settings are saved as a checkpoint
first, so you lose nothing.

The full list is in §6.2.

## Checkpoints

A **checkpoint** is a saved copy of your recipe, with a small picture, a name and an
optional note. Click a checkpoint to go back to it. Where you were is saved first, so
nothing is lost.

You save checkpoints yourself (**＋ Save**, ⌘S, **Branch from here**). plotlab also saves
one automatically before a preset or a restore replaces your settings. See §5.5.

## Inks, layers and pens

A **layer** is one map of where ink goes. Each layer is drawn with an **ink**: a colour, a
width and a way of mixing with the inks under it. On a plotter, each ink is a **pen**, and
each pen is one **pass**: the plotter draws everything in that pen, then you change pens.

Mixing has two choices. **Multiply**: overlapping inks darken, like real transparent ink.
**Normal**: the top ink covers the ones under it.

## Four inks, lanes and the stack

Splitting a picture into four inks, cyan, magenta, yellow and black (**CMYK**), gives four
layers. From there you choose:

- **Linked**: one set of steps and settings drives all four inks.
- **Independent**: each ink gets its own row of steps, called a **lane**. The magenta can
  be pixelated while the yellow is stippled.

The lanes meet at the **stack**, where all four inks are put together in the order they
will be printed. See §5.6.

## Output targets

The **output target** says where the work will end up. It decides what the downloads are.

| Target | What you get |
|---|---|
| **Plotter** | Pens on paper. Shows the plot time and pen changes. Downloads an SVG |
| **Digital image** | A PNG or TIFF at a resolution you choose. Inks mix like ink on paper |
| **Digital vector** | An SVG or PDF with strokes at their ink width. Layers that aren't lines are embedded as images |
| **Print prep** | One 1-bit or grey TIFF per ink (riso, screen print, relief, film), plus a proof |

You set the target in Page mode (§5.7).

## Projects and bundles

A **project** is one image, with its recipe and its checkpoints. plotlab keeps each project
in your browser.

A **bundle** is a whole project packed into one .zip file. Use it to keep a copy, to move a
project to another computer or your phone, or to share it. See §5.9.
