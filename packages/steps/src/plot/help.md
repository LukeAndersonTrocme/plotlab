# Place on paper

**What it does:** scales the drawing to fit the paper inside the margin, puts the strokes in
an order that keeps pen-up travel short, and estimates how long the plotter will take.

**What the settings do physically:**
- **Margin:** blank paper around the drawing, in millimetres.
- **Stroke order:** "Nearest first" makes the pen hop to the closest unfinished stroke, which
  can cut plot time a lot. "As traced" is useful when the drawing order is part of the work.
- **Allow reversing strokes:** lets the pen start a stroke from whichever end is closer.

**Time estimate:** based on the machine profile's speeds, acceleration and pen up/down time.
Treat it as a rough guide until the profile is calibrated against a real plotter.
