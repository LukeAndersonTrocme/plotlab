# 1. Browser-first, with one shared engine for web and CLI

Status: accepted (provisional, 2026-11-10)

## Context
Nick is the primary v1 user and shouldn't install anything. Power users want batch runs and
animation from the command line. Two implementations would drift.

## Decision
TypeScript everywhere. `packages/engine` has no UI or Node-only code and is used by both
`packages/web` (React + Vite, static hosting) and `packages/cli` (Node). Heavy work runs in a
Web Worker in the browser. File decoding stays at the edges (canvas in web, pngjs/jpeg-js in CLI).

## Consequences
- Same recipe → same output in both places; golden tests run the engine in Node.
- Anything too slow for JS later goes to WASM or an optional Python helper, not a fork.
