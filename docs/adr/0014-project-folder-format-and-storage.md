# 14. One project-folder format; storage behind one interface; progressive enhancement

Status: accepted (provisional, 2026-11-13)

## Context
Luke wants to save checkpoints on his phone and look at them on his desktop, to keep
sessions in a folder on disk, and to share "the documentation" so Nick can recreate an
effect. Hosting stays static (no accounts or backend for now), and nobody is sure yet where
the project will go.

## Decision
**One format.** A project is a folder:
```
<project>/
  source.<ext>          the source image (optional in a share; see below)
  recipe.json           current state
  checkpoints/
    <timestamp>-<slug>.json   recipe + name + note + source hash
    <timestamp>-<slug>.png    thumbnail (~160 px capture of the main view)
  README.md             generated: steps and settings in plain words, the CLI command,
                        the plotlab version
```
The **bundle** (`.zip`) is that folder, zipped. The same format serves the desktop
workspace, phone→desktop transfer (export, AirDrop or iCloud Drive, open), and sharing.
The CLI reads the same folder. Opening a bundle **merges** its checkpoints into what's
already there (by id, no overwrite, no duplicates). The bundle includes the source by
default, with a "leave out source image" option (consent, issue #1). Smaller export sizes
(recipe only, outputs only) are export-dialog options over this format.

**One storage interface.** Checkpoints, sources and the current recipe are saved through a
single interface with swappable adapters: IndexedDB (every browser), connected folder
(File System Access API), and later a desktop file system (ADR 0013) or a third-party
store. Sources are stored once, keyed by content hash, and shared by their checkpoints.

**Progressive enhancement.** Every browser, phones included, gets the full editing
workflow: checkpoints, Library, bundle import/export. Chrome-family browsers add the
connected folder and WebSerial plotter control. Capabilities are feature-checked; where
one is missing the UI shows a short note ("Connect a folder: available in Chrome"),
never a broken button. Chrome is the assumed desktop browser for now.

## Consequences
- The source image now survives a reload (IndexedDB), fixing the recipe-only autosave.
- A backend or Drive sync can be added as an adapter without changing the format.
- README.md is generated from the recipe, so it can't drift from it.
