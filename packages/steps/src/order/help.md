# Stroke order

**What it does:** puts the strokes of each pass in an order that keeps pen-up travel
short. It doesn't change what gets drawn, only the order the plotter draws it in. Each ink is
one pass; passes run light → dark unless you change the pass order in the project settings.

**Why it's a separate step:** for big drawings this can take a few seconds, so it runs when
you press **Run** instead of on every slider move. Until it runs, the preview and the time
estimate use the order the strokes were traced in, and say so.

**What the settings do physically:**
- **Order:** "Nearest first" makes the pen hop to the closest unfinished stroke, which can cut
  plot time a lot. "As traced" keeps the order the strokes were made, which can be part of
  the work.
- **Allow reversing strokes:** lets the pen start a stroke from whichever end is closer.

**Time estimate:** based on the machine profile's speeds, acceleration and pen up/down time,
plus a pause for each pen change. Treat it as a rough guide until the profile is calibrated
against a real plotter.
