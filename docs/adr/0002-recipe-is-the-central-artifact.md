# 2. The recipe is the central artifact

Status: accepted (provisional, 2026-11-10)

## Context
Batch runs, animation, camera input, variants and the CLI all need the processing to be
replayable without the UI.

## Decision
Output is a pure function of (source, recipe). A recipe is versioned JSON: `schemaVersion`
for the envelope plus a `version` per step. `loadRecipe` upgrades old recipes with warnings
(envelope upgraders, per-step `migrate`) and rejects unknown steps, future versions and type
mismatches. Every export carries its recipe (SVG `<metadata>`, `recipe.json` beside CLI output).

## Consequences
- Changing a step's output for the same params means bumping its `version`.
- Renaming/removing a param needs a `migrate`.
