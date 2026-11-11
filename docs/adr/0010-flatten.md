# 10. Flatten: going back a stage on purpose

Status: accepted (provisional, 2026-11-11)

## Context
Some results only exist digitally (e.g. a texture collage), but people may still want to plot them.

## Decision
A **Flatten** step renders layers back into Image data so the chain can continue (threshold,
hatch, bands → plot). It defaults to **per layer**: each layer becomes its own image and keeps
its ink, so a CMYK result stays four plates for a multi-pass plot. A composite mode is
optional. Flatten is the one deliberate exception to "stages only move forward". Exported
PNGs can also be loaded as new sources, with their recipe attached.
