# The plotlab user manual

Source of the manual published at `https://lukeandersontrocme.github.io/plotlab/manual/`
(HTML) and `…/manual/plotlab-manual-v<version>.pdf`. Why it's built this way: ADR 0015.

- `en/*.md`: the text, one file per part, in file-name order. Parts and sections are
  numbered by pandoc; don't type numbers into headings. Cross-references are written by hand
  (`§5.6`), so check them when you add or move a section.
- `<!-- GENERATED:steps -->` and `<!-- GENERATED:presets -->` in `en/06-reference.md` are
  replaced at build time from `packages/steps/src/<id>/help.md` and `presets.ts`. Fix step
  and preset wording there, not here.
- `img/`: screenshots, made by `pnpm --filter @plotlab/web manual:shots` (add
  `--aria <dir>` to also dump each screen's labels for checking the text).
- `VERSION`: the app version this manual describes. Bump it with each release.
- `manual.css`: one stylesheet for the page and the PDF.

Build locally (needs pandoc; the PDF needs `pnpm --filter @plotlab/web exec playwright install chromium`):

```sh
pnpm --filter @plotlab/web manual -- --out /tmp/manual           # HTML + PDF
pnpm --filter @plotlab/web manual -- --out /tmp/manual --no-pdf  # HTML only
```

Writing rules: plain words, short sentences, labels in **bold** exactly as on screen. Use the
terms in `GLOSSARY.md`. Don't describe anything the app doesn't do yet, except in part 7.
