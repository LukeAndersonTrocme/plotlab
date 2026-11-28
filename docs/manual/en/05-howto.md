# How to…

Each section here is one task. They don't depend on each other.

## Start from a preset

1. Click **Presets** in the top bar. Each preset is previewed on your own picture.
2. Click one. It replaces your steps.

Your previous settings are saved as a checkpoint called *Before "…"*, so you can go back
(§5.5). **Back** also undoes a preset. All presets are listed in §6.2.

## Look at each step, and compare them

- Click a box in the recipe strip to see what that step makes.
- Click **Compare stages** above the canvas to see two steps at once. Choose how:
  - side by side or top to bottom, with a divider you drag;
  - **Lens**: a circle that shows the other step where you point;
  - **Boxes**: small boxes you place on the picture.
- **Every step** shows the whole chain at once. Shift-click a box in the strip to add it to
  the comparison.
- Click **Compare stages** again to leave.

## Change the recipe

- **Add a step.** Click the **+** between two boxes. The menu offers only the steps that fit
  at that point. For example, between Threshold and Centerline it offers Levels and
  Pixelate.
- **Move a step.** Drag its box along the strip, or select it and press **Alt+←** or
  **Alt+→**, or use the **↑** and **↓** on its card in the sidebar. Some moves are refused,
  with a message saying why. For example, a step that works on lines can't go before the
  lines exist.
- **Switch a step off** to see the drawing without it: click the **●** on its box, or untick
  the switch on its card. Only steps that make the same kind of thing they receive can be
  switched off. For the others, pointing at the **●** says why not.
- **Remove a step** with the **✕** on its card.
- **Tune two steps together.** Click **Pin** on one step's card, then click another step.
  The pinned card stays in the sidebar.

## Undo, reset and start over

- **Back** (⌘Z) and **Forward** (⇧⌘Z) undo and redo every change, including presets,
  resets and restoring a checkpoint.
- **↺** on a step's card puts that step's settings back to their defaults.
- **↺ Reset** in the top bar goes back to the default three-step recipe and keeps your
  image. **Back** undoes it.

## Save versions with checkpoints

1. With a drawing you like, press **⌘S** or click **＋ Save**. A message confirms it.
2. Press **S** or click **Checkpoints** to open the panel. Your checkpoint is there with a
   small picture.
3. Click its name to rename it. Click **✎** to add a note.
4. To go back to a checkpoint, click its picture. Where you were is saved first, so this
   can't lose work. **Back** undoes the restore.

Other things to know:

- **Branch from here**, on a step's card, saves the current version as a checkpoint so you
  can try a different direction from that step on.
- plotlab saves a checkpoint automatically before a preset or a restore replaces your
  settings, named like *Before "Topographic hatching"*. It keeps the newest 30 of these
  per project. The ones you name, or add a note to, are kept for good.
- Tick **Show all** to see the checkpoints of every image you have worked on, grouped by
  image.
- **×** deletes a checkpoint.

## Split into four inks

![Four inks, Independent: one lane per ink, Four panels on the canvas, and the Stack card.](img/cmyk-lanes.png)

**Split the picture**

1. Click **Presets**, then **CMYK print**. Four coloured dots appear in the setup chip, and
   the time goes up because there are now four pen passes.
2. Or split your own recipe: click the **Source** box, then **Split into CMYK** in the
   sidebar.

After the split, every box shows four small pictures, one per ink. The strip's header reads
**Linked**: one set of settings drives all four inks.

**Look at the inks**

- Above the canvas, switch **Stacked** to **Four panels** to see each ink on its own sheet.
  Untick an ink's checkbox to hide it.
- Click the **Stack** box. In the sidebar, use the arrows to change the order the inks are
  printed in. Switch **See-through** to **Opaque** to see each ink cover the ones before it.
  This changes the preview only, not the files.

**Give one ink its own settings**

- On a step card, **Applies to** chooses which inks the step works on, and **Settings for**
  chooses which ink you're changing. For example, set Fill's spacing for **Cyan** only.
- For more, click **Independent** in the strip header. The strip opens into four lanes, one
  per ink. A **+** inside a lane adds a step for that ink only.
- **All lanes / C / M / Y / K** shows one lane at a time. With a step in one lane selected,
  tick **Show other inks** to see the other inks faintly underneath.

**Put it back**

- Click **Linked** to join the lanes again. plotlab asks which lane to copy to all four, and
  saves a checkpoint first.
- Click **Undo the split** to go back to the single-ink recipe from before the split.

## Set up the paper and pens

![Page mode: paper, pens and machine.](img/page.png)

Click **Page** in the top bar, or click the setup chip.

**Paper**

- **Paper size**: A5, A4, A3 or Letter. **Portrait** or **Landscape**.
- **Margin**, in millimetres.
- **Placement**: **Fit (whole image)** shows all of it; **Fill (crop to margins)** fills the
  space and crops what's left over.
- The 3×3 grid, **Where the image sits**, chooses which edge or corner the image is pushed
  to.

**Pens**

- Each pen has a colour, a name, a width in millimetres and a mix (**Multiply** or
  **Normal**, §3.5). **+ Add pen** adds one, **✕** removes one.
- **Which ink each layer uses** gives each layer its pen.

**Machine**

- Choose the output target: **Plotter**, **Digital image**, **Digital vector** or
  **Print prep** (§3.7). Each one changes what Plot mode offers.
- For a plotter, you can enter a **Time budget** in minutes. The time estimate warns you
  when the plot goes over it.
- Print prep adds options for plates, halftone screens, film negatives, mirroring and
  registration marks. They are described in §6.4.

## Check the time and export

![Plot mode: the time breakdown, the replay, the downloads and the passes strip.](img/plot.png)

1. Click **Plot** in the top bar. Under **Time**, the estimate is split into drawing,
   travel, pen lifts and pen changes.
2. If it says *Traced order*, the lines are still in the order they were traced, and the
   time is too high. Go back to Design, click **Stroke order**, and press
   **Run stroke order** for a shorter, more accurate time.
3. Under **Watch it plot**, press **Play** to watch the plot draw in order, or drag the
   slider.
4. In the **Passes** strip, click a pen to see only its lines.
5. Tick **Show pen-up travel** to see the moves the pen makes while lifted.
6. Tick **Preview as exported** to see the page exactly as the file will look.
7. Under **Output**, download what you need. The buttons depend on the target (§6.5).

**Send to plotter** saves a file to open in your plotter's own software. It doesn't drive a
plotter directly yet (§7).

## Move a project, or look at it on your phone

![The phone viewer.](img/phone.png){width=40%}

**Export the project**

1. Open **Checkpoints** and scroll to **Move or share this project**.
2. To leave the picture out, tick **Leave out source image** first. Whoever opens the
   bundle then needs the same image.
3. Click **Export project (.zip)**. You get one file with the image, the recipe, every
   checkpoint with its picture, and a README that describes the steps in plain words.

**Open it somewhere else**

1. Send the .zip to the other computer or your phone (AirDrop, email, a shared drive).
2. Open plotlab there. Click **Open a bundle…** (in the Checkpoints panel on a computer, on
   the first screen of a phone) and choose the .zip. A message says what was added.

Opening the same bundle twice doesn't duplicate anything. If you export again after saving
a new checkpoint, only the new checkpoint is added.

**On the phone**

The phone shows your projects for viewing only. Open a project to:

- drag the **Before and after** slider, or tap **Full screen**;
- swipe through the **Steps** to see what each one makes;
- tap a checkpoint to see that version.

To change a recipe, use a laptop or another wide screen.
