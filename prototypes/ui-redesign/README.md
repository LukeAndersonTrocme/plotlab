# UI redesign prototype (throwaway)

A clickable prototype of the plotlab UI redesign, built over four rounds of feedback on 2026-11-26. It is a primary source for the redesign spec, not production code: a fake engine on a 160 × 160 grid, no tests, nothing saved.

Open `index.html` in a browser. The left-hand switcher toggles the laptop editor and the phone viewer.

What it settled:
- Design / Page / Plot modes, the setup chip, Presets in the top bar, quick "Save checkpoint".
- A bottom strip of live thumbnails, coloured by stage. Click a box to see that stage and get its sliders in the sidebar. Bypass, "+" that offers only valid steps, drag to reorder with valid gaps, resizable strip.
- Sidebar settings (variant A won), with pinned steps.
- Compare stages: side by side, top to bottom, lens, boxes; live while sliders move. While comparing, a thumbnail click only changes the sidebar; shift-click adds it to the comparison.
- CMYK: split from the photo, Linked / Independent inks, all lanes or one lane, four-panel view, plot order by dragging lanes.
- Phone: viewer only.

Note: the prototype names stages Field / Geometry / Toolpath. The real UI uses the glossary: Image / Layers / Lines / Plot.
