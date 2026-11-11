# 12. Guiding principle: the modular synth

Status: accepted (2026-11-11)

## Context
From a conversation with the person running Concordia's relief studio and printmaking workshop: a
modular synthesizer is complex technology, yet a novice can have fun turning knobs and
hearing what happens without knowing the theory.

## Decision
plotlab aims for the same thing: complex inside, playful on the surface.
- Smart defaults and **presets** (saved recipe fragments; built-ins come from the golden
  examples) to start; everything customizable after that (e.g. custom level cut points).
- Every random step takes a **seed** stored in the recipe, so results are reproducible.
- Slider feedback within ~100 ms. When a step can't keep up, auto-refresh turns off for it
  and the app suggests the matching CLI command.
- An **Explore** button (randomized knobs, a strip of variants) is planned.
- Every screen makes sense to a non-programmer; help explains the analog history.
