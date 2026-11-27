# Reference

## Steps

These are the steps you can add with **+** in the recipe strip, in the order the menu lists
them. The same text opens in the app when you click **?** on a step's card. Steps marked
*experimental* are still being worked out: their settings may change in a later version.

<!-- GENERATED:steps -->

## Presets

Picking a preset replaces your steps (§5.1). The experimental ones can be slow on big
images.

<!-- GENERATED:presets -->

## Page settings

| Setting | What it does |
|---|---|
| **Paper size** | A5, A4, A3 or Letter |
| **Portrait / Landscape** | The paper's orientation. The size in millimetres shows below |
| **Margin** | Blank border around the image, in millimetres |
| **Placement** | **Fit (whole image)**: all of the image fits inside the margins. **Fill (crop to margins)**: the image fills the space inside the margins and the overflow is cropped |
| **Where the image sits** | The 3×3 grid. Which side or corner the image is pushed to when it doesn't fill the space |
| **Working detail** | How fine the grid of pixels plotlab works with is, in mm per pixel. Leave it on *auto* unless a step is too slow (make it coarser) or too blocky (make it finer) |
| **Pens** | Each pen's colour, name, width in mm and mix (**Multiply** or **Normal**). **+ Add pen**, **✕** to remove |
| **Which ink each layer uses** | Gives each layer its pen |
| **Output target** | **Plotter**, **Digital image**, **Digital vector** or **Print prep** (§3.7) |
| **Plotter** | The machine profile used for the time estimate |
| **Time budget** | Optional, in minutes. The estimate warns when the plot is over it |
| **Resolution** | For Digital image and Print prep: dots per inch of the file |

## Print prep options

These are in the **Print prep** section at the bottom of Page mode. Click its title to open
it. The section is there when the output target is **Plotter** or **Print prep**. **Plates**,
**Halftone screen** and **Film negative** only appear for Print prep, and **Halftone screen**
only for 1-bit plates.

| Option | What it does |
|---|---|
| **Plates** | **1-bit (ink or no ink)**, which riso, screen and film need, or **Gray (density)**, for processes that can print shades |
| **Halftone screen** | A grid of dots whose size follows the tone, in lines per inch. Without it, tone is cut at 50%. Coarser screens (fewer lines per inch) are easier to print. The angle of each ink's screen is set under its ink |
| **Film negative** | Ink areas clear and the rest black, for processes that expose through a negative |
| **Mirror** | Flip left to right, for screens and plates printed face down, or transfers |
| **Registration marks** | Circle-and-cross marks at the middle of each edge, on every plate or pass, so the inks line up |
## Downloads and file types

**What plotlab opens**

- Images: PNG, JPEG, WebP, TIFF (including 16-bit TIFF).
- An SVG.
- A recipe (`recipe.json`), to use its steps on the current image.
- A bundle (.zip), from **Open a bundle…** (§5.9).

**What Plot mode downloads**

| Target | Buttons |
|---|---|
| **Plotter** | **Download SVG**, **Download PNG**, **Send to plotter** |
| **Digital image** | **Download PNG**, **Download TIFF**, **Download SVG** |
| **Digital vector** | **Download SVG**, **Download PDF**, **Download PNG** |
| **Print prep** | **Download plates (.zip)**: one TIFF per ink plus a proof. Also **Download SVG** and **Download PNG** |

Every target also has **Download recipe**, which saves the steps and settings as a small
`recipe.json`, and **Copy as CLI command**, which copies the matching command for the
command-line version (Appendix B).

## The bundle

A bundle is a .zip of one project. Inside:

| File | What it holds |
|---|---|
| `source.jpg` (or .png, .tif…) | Your picture, unless you ticked **Leave out source image** |
| `recipe.json` | The current steps and settings |
| `view.json` | What the screen keeps for the project, such as pinned steps |
| `checkpoints/` | Every checkpoint: a `.json` file with its settings, name and note, and a `.png` of its picture |
| `README.md` | The steps and settings in plain words |

You can unzip a bundle and read the README without plotlab.

## Keyboard

See §2.6.
