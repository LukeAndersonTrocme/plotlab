# Notes for agents

- Vocabulary: use the terms in `GLOSSARY.md` in code, UI and help. Decisions: `docs/adr/`.
- Issues: GitHub Issues on this repo.
- Keep `plotlab` renameable: don't hard-code it beyond package names, the CLI binary and
  display strings.
- Engine code must not import DOM-only or Node-only APIs.
- Changing a step's output for the same params → bump its `version`. Renaming a param → add `migrate`.
- After editing any `help.md`: `pnpm --filter @plotlab/steps gen:help` (a test checks it).
- Golden output changed on purpose? `pnpm golden:approve` and say so in the commit message.
- Before claiming done: `pnpm typecheck && pnpm test && pnpm build`.
- Every screen must make sense to a non-programmer (Nick). Numbers get a slider *and* a
  numeric field; help opens on click.
