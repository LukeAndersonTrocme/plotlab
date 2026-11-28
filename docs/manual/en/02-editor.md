# The editor at a glance

![The editor in Design mode, on the sample image.](img/design.png)

The editor has four areas: a **top bar**, the **canvas** in the middle, a **sidebar** on the
right, and the **recipe strip** along the bottom.

## The top bar

From left to right:

- **The project name.** The sample is called *Sample image*.
- **Back** (←) and **Forward** (→): undo and redo. See §5.4.
- **Presets**: ready-made looks. See §5.1.
- **The three modes**, **Design**, **Page** and **Plot** (§2.5).
- **The setup chip**: paper size, inks, machine and the time estimate, for example
  *A4 landscape · Generic A3 pen plotter (placeholder numbers) · ~17 min*. Click it to go
  to Page mode.
- **Live**. When it's ticked, the picture updates while you drag a slider. Untick it for
  slow recipes; an **Update** button then appears when there are changes to apply.
- **＋ Save** saves a checkpoint, **Checkpoints** shows or hides your saved versions
  (§5.5), and **↺ Reset** goes back to the default recipe and keeps your image (§5.4).

## The canvas

The canvas shows the picture as it will come out on paper. Above it is a line of figures:
the time estimate, the number of strokes, the metres drawn and the metres of pen-up travel.

Beside the figures are these switches:

- **Preview as exported**: show the page exactly as the downloaded file will look.
- **Show pen-up travel**: draw the moves the pen makes while lifted.
- **Show source underneath**: put your image under the lines, to check how they sit.
- **Compare stages**: look at two or more steps at once (§5.2). This switch is only there
  in Design mode.

## The sidebar

What the sidebar shows depends on the mode:

- **Design**: a card for each step, with its settings. On each card, **?** opens the step's
  help, **Pin** keeps the card in view while you look at another step, **↑** and **↓**
  move the step, and **✕** removes it. At the top is **Open image, SVG or recipe…**.
- **Page**: paper, pens and machine (§5.7).
- **Plot**: the time breakdown, the replay and the downloads (§5.8).

## The recipe strip

One box per step, left to right, each with a small picture of what that step makes. The
colour band on each box tells you what kind of thing the step makes: **Image**, **Layers**,
**Lines** or **Plot** (§3.2).

- Click a box to see its output on the canvas and its settings in the sidebar.
- A **+** between boxes adds a step there (§5.3).
- Drag a box to move it.
- **− / +** (Thumbnails, at the right end) makes the boxes smaller or bigger. You can also
  drag the strip's top edge to make it taller.

In Plot mode the strip lists the pen passes instead (§5.8).

## The three modes

| Mode | What it's for | Where to look |
|---|---|---|
| **Design** | Building the look: which steps, in what order, with what settings | Recipe strip, and the step's settings in the sidebar |
| **Page** | Paper size and orientation, margin, where the image sits, pens and inks, and the output target | Sidebar |
| **Plot** | The time estimate broken down, a replay of the plot, and the downloads | Sidebar, and the passes strip |

## Keyboard shortcuts

On Windows and Linux, use Ctrl where this says ⌘.

| Keys | What they do |
|---|---|
| **⌘Z** | Back (undo) |
| **⇧⌘Z** | Forward (redo) |
| **⌘S** | Save a checkpoint |
| **S** | Show or hide the checkpoints |
| **Alt+←** / **Alt+→** | Move the selected step left or right in the strip |
