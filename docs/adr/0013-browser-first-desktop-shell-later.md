# 13. Browser first; a desktop shell later for power users

Status: accepted (provisional, 2026-11-13)

## Context
Wanting to keep sessions in a folder on disk raised the question of whether plotlab should
be a desktop app. The browser is the fastest way to ship and needs no install (ADR 0001).
Power users may eventually want native file access, plotter control outside Chrome, more
compute, and app conventions (menus, recent files, opening `.plotlab` files from Finder).

## Decision
The browser stays the main product. A desktop version is planned but not scheduled. It would
be a **Tauri** shell around the same web app and engine. Tauri is small (~10 MB), uses the
OS web view, and gives native file access. Electron was rejected for now: it adds ~150 MB
of Chromium the engine doesn't need.

Meanwhile plotlab becomes an **installable web app** (PWA: own window, Dock icon, offline).
That tells us whether app-ness is what power users want, at almost no cost.

All persistence goes through one storage interface (ADR 0014), so a desktop file-system
adapter can plug in later without redesign.

## When to build it
Build the desktop shell when one of these signals shows up:
- Direct plotter control is needed outside Chrome (Safari has no WebSerial).
- Files or processing outgrow the browser (memory, huge TSP jobs, video).
- Users ask for native-app behaviour that a PWA can't give.

## Consequences
- No Node-only or desktop-only code in `packages/web`; desktop specifics would live in
  their own package.
- Feature checks (ADR 0014) already handle "this capability may not exist here".
