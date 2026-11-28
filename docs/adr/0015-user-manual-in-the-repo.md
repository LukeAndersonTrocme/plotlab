# 15. The user manual lives in the repo and is versioned with the app

Status: accepted (2026-11-27)

## Context
The first guide for testers was a "guided tour" written as a shared doc for Nick. It works
once, but it drifts from the app: nothing ties its labels to the code, and its section
numbers (if any) are typed by hand. Testers want to point at a spot ("7.3 could do X"), so
the manual needs stable section numbers and page numbers, and a version that says which app
it describes. A French version will follow once the app settles.

## Decision
- The manual is Markdown in `docs/manual/<lang>/`, one file per part, English first.
- `packages/web/scripts/manual.mjs` builds it: pandoc makes one HTML page with numbered
  sections; Playwright's Chromium prints that page to a PDF with page numbers and a
  "plotlab manual v<version>" footer. One stylesheet (`docs/manual/manual.css`) serves both.
- The step reference is generated from each step's `help.md`, and the preset list from
  `presets.ts`, so the in-app help and the manual can't disagree.
- The deploy workflow publishes both next to the app at `/manual/`; CI builds the HTML on
  every push to catch breakage. The app's top bar links to it.
- `docs/manual/VERSION` matches the app release it describes. Each release tag gets the PDF
  attached. Feedback cites version and section ("v0.1, §5.6").
- Screenshots come from `packages/web/scripts/manual-shots.mjs`, run by hand against the
  live site or a production build before a release, and are committed.
- The manual names no personal email address; it says "contact Luke" and links the repo.

## Consequences
- A UI change that renames a label should update the manual in the same PR (AGENTS.md).
- CI needs pandoc (apt) and, for the PDF, Playwright's Chromium.
- French goes in `docs/manual/fr/` with the same file layout, built with `--lang fr`.
