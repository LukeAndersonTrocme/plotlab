import { useEffect, useMemo, useRef, useState } from "react";
import { budgetOnlyChange, describeEntry, enterAt, loadRecipe, sourceLabel, sourceStage, type AnyStep, type ExportFormat, type Recipe, type Source, type StageKind } from "@plotlab/engine";
import { budgetCheck } from "@plotlab/machines";
import { createRegistry } from "@plotlab/steps";
import { defaultRecipe } from "./defaults.ts";
import { HelpPanel } from "./Help.tsx";
import { PagePanel } from "./PagePanel.tsx";
import { PassStrip, PlotPanel, usePlayback } from "./PlotPanel.tsx";
import { fitSolo, framePlot, passBoxes, soloPlot } from "./plotmode.ts";
import { fmtTime, setupSummary } from "./setup.ts";
import { ModeSwitch, SetupChip } from "./Shell.tsx";
import { canvasTarget, fitView, fromViewBlock, initialView, isPinned, openSetup, pin, readThumbSize, resizeThumbs, RESULT, select, selectedIndex, setMode, sidebarSteps, SOURCE, stepSelection, toggleSelect, togglePin, toggleSolo, toViewBlock, writeThumbSize, type ViewState } from "./view.ts";
import { Strip } from "./Strip.tsx";
import { addAt, moveToGap } from "./gaps.ts";
import { STEP_DRAG, stripBoxes, thumbRenderSide, toggleBypass } from "./strip.ts";
import { EMPTY_RUN, Runner, type RunState } from "./runner.ts";
import { decodeFile, loadSample, sampleSource } from "./sample.ts";
import { canRedo, canUndo, commit, createHistory, preview, redo, undo, type History } from "./history.ts";
import type { InspectTarget } from "./protocol.ts";
import { StageView } from "./StageView.tsx";
import { StepList, type SidebarCards } from "./StepList.tsx";
import { CheckpointSidebar } from "./CheckpointSidebar.tsx";
import { PhoneViewer, usePhoneWidth } from "./PhoneViewer.tsx";
import { keepEditor } from "./phone.ts";
import { attachThumbnail, checkpointLabel, createCheckpoint, restoreSafely } from "./checkpoints.ts";
import { galleryItems, pickPreset, type GalleryItem } from "./gallery.ts";
import { focusOf, shortcut } from "./keys.ts";
import { PresetGallery, type GalleryThumb } from "./PresetGallery.tsx";
import { openImage, readView, SAMPLE_NAME, saveView, startSession } from "./session.ts";
import { defaultLocalStorage, openLibrary, type Checkpoint, type Library, type ProjectStore, type Source as StoredSource } from "./storage/index.ts";

const registry = createRegistry();
/** A checkpoint's picture, in pixels on the paper's long side (the sidebar shows it ~200 px wide). */
const CHECKPOINT_SIDE = 240;
/** A preset gallery picture: ~200 CSS px wide, sharp on high-density screens. */
const gallerySide = () => Math.min(400, Math.round(200 * (window.devicePixelRatio || 1)));

/** A stored recipe, upgraded (ADR 0002); throws if it can't be read. */
const parseRecipe = (json: unknown) => {
  const { recipe, warnings } = loadRecipe(json, registry);
  return { recipe, warnings: warnings.map((w) => w.message) };
};
const decodeStored = (p: ProjectStore, s: StoredSource, warn?: (m: string) => void) => decodeFile(new File([s.bytes], p.name, { type: s.type }), warn);
/** The label and file stem for a project's image ("sample" keeps its special wording). */
const nameOf = (p: ProjectStore) => (p.name === SAMPLE_NAME ? "sample" : p.name);
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

function download(name: string, data: string | Uint8Array, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/**
 * Phone-sized screens get the viewer only (#74); the editor doesn't even mount there, so
 * none of its work starts. Turning the phone or resizing the window switches between them.
 */
export function App() {
  const phone = usePhoneWidth();
  // Once the editor has started it stays (hidden), so narrowing the window loses no work.
  const editor = useRef(false);
  editor.current = keepEditor(editor.current, phone);
  return (
    <>
      {editor.current && (
        <div className="editor-host" hidden={phone}>
          <Editor hidden={phone} />
        </div>
      )}
      {phone && <PhoneViewer />}
    </>
  );
}

/** `hidden`: the phone viewer is on screen; the editor keeps its state but takes no keys. */
function Editor(props: { hidden: boolean }) {
  const [history, setHistory] = useState<History<Recipe>>(() => createHistory(defaultRecipe()));
  const recipe = history.present;
  const [run, setRun] = useState<RunState>(EMPTY_RUN);
  const [live, setLive] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [help, setHelp] = useState<AnyStep | null>(null);
  const [showTravel, setShowTravel] = useState(false);
  const [sourceName, setSourceName] = useState("sample");
  const [notice, setNotice] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [asExported, setAsExported] = useState(false);
  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const runner = useMemo(() => new Runner(setRun), []);
  const recipeRef = useRef(recipe);
  recipeRef.current = recipe;
  // What the screen shows (mode, selection): not a recipe edit, so never a Back step.
  // The thumbnail size is remembered by this browser, not the project.
  const [view, setView] = useState<ViewState>(() => resizeThumbs(initialView, readThumbSize(defaultLocalStorage() ?? null)));
  const viewRef = useRef(view);
  viewRef.current = view;
  const playback = usePlayback(view.mode === "plot");
  /** The worker has its first source: runs can go out. */
  const started = useRef(false);
  /** Strip thumbnails only while the strip shows steps (Design mode)… */
  const thumbSide = (v: ViewState) => (v.mode === "design" ? thumbRenderSide(v.thumb, window.devicePixelRatio || 1) : null);
  /** …and one picture per pass while it shows passes (Plot mode). */
  const passSide = (v: ViewState) => (v.mode === "plot" ? thumbRenderSide(v.thumb, window.devicePixelRatio || 1) : null);
  /** Run a recipe. The selected step is found by id in that recipe, so it survives reordering. */
  const send = (r: Recipe, proxy: boolean, runOnDemand = false) => {
    runner.inspect = canvasTarget(viewRef.current, r);
    runner.thumbs = thumbSide(viewRef.current);
    runner.passes = passSide(viewRef.current);
    runner.request(r, proxy, runOnDemand);
  };
  // Storage (ADR 0014): the open project (its image, recipe and checkpoints) in a library.
  const [library, setLibrary] = useState<Library | null>(null);
  const [project, setProject] = useState<ProjectStore | null>(null);
  const [persistent, setPersistent] = useState(true);
  // Input waits until the last session is back, so nothing done meanwhile gets overwritten.
  const [ready, setReady] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [saved, setSaved] = useState(0);
  /**
   * The open project's view block (pins), as last read or saved: saves keep the fields a
   * newer build added. Null until it's read, so nothing saves over it before then.
   */
  const viewBlock = useRef<{ project: string; kept: unknown } | null>(null);
  const wantView = useRef<string | null>(null);
  // Where the current source enters the chain (an SVG enters as lines, separations as layers).
  const entry = useRef<{ stage: StageKind; label: string }>({ stage: "image", label: "the sample" });
  /** Fit a recipe to the current source's entry stage; returns it and what to tell the person. */
  const enter = (r: Recipe): { recipe: Recipe; note: string | null } => {
    const e = enterAt(r, entry.current.stage, registry);
    return { recipe: e.recipe, note: describeEntry(entry.current.label, entry.current.stage, e) };
  };
  /** Show a decoded source. Every way in (startup, open, restore) goes through here, then `enter`. */
  const takeSource = (src: Source, name: string, key: string) => {
    entry.current = { stage: sourceStage(src), label: name === "sample" ? "the sample" : sourceLabel(name, src) };
    runner.setSource(src, key);
    setSourceName(name);
  };

  // Start: reopen the last project with its recipe (image and settings survive a reload).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const ls = defaultLocalStorage();
      const sample = () => sampleSource(SAMPLE_NAME);
      const lost = () => setNotice("Storage was upgraded in another tab. Reload this page to keep saving.");
      let opened = await openLibrary({ localStorage: ls, onLost: lost });
      let session;
      try {
        session = await startSession({ ...opened, localStorage: ls, sample, parse: parseRecipe });
      } catch {
        // Storage opened but failed on use: carry on in memory (ADR 0014: never block the work).
        opened = await openLibrary({ factory: undefined, localStorage: ls });
        session = await startSession({ ...opened, localStorage: ls, sample, parse: parseRecipe });
      }
      const s = session;
      const img = await decodeStored(s.project, s.source, (m) => s.warnings.push(m)).catch(() => {
        s.warnings.push("Couldn't read the saved image; showing the sample.");
        return loadSample();
      });
      if (!alive) return;
      takeSource(img, nameOf(s.project), s.project.id);
      // Fitting the restored session to its image isn't a Back step: it's where the work starts.
      const { recipe: start, note } = enter(s.recipe ?? recipeRef.current);
      setHistory(createHistory(start));
      recipeRef.current = start;
      if (note) s.warnings.push(note);
      if (s.warnings.length) setNotice(s.warnings.join("\n"));
      setLibrary(opened.library);
      setProject(s.project);
      openProjectView(s.project, start);
      setPersistent(opened.persistent);
      setReady(true);
      started.current = true;
      send(recipeRef.current, false);
    })();
    return () => {
      alive = false;
      runner.dispose();
    };
  }, [runner]);

  // Autosave what's committed (not every mid-drag preview) into the open project.
  useEffect(() => {
    void project?.setRecipe({ recipe: history.base, savedAt: Date.now() }).catch((e) => setNotice(`Couldn't autosave: ${errText(e)}`));
  }, [project, history.base]);

  // Save the pins into the project's view block: not a recipe edit (no Back step, no checkpoint).
  const pinKey = view.pins.join("\n");
  useEffect(() => {
    const b = viewBlock.current;
    if (!project || b?.project !== project.id) return;
    if (JSON.stringify(toViewBlock(viewRef.current, b.kept)) === JSON.stringify(b.kept)) return;
    void saveView(project, viewRef.current, b.kept)
      .then((block) => {
        if (viewBlock.current?.project === project.id) viewBlock.current.kept = block;
      })
      .catch((e) => setNotice(`Couldn't save your pinned steps: ${errText(e)}`));
  }, [project, pinKey]);

  // A short confirmation that goes away by itself (saving a checkpoint).
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout>>();
  const confirmSaved = (msg: string) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 3500);
  };

  /**
   * A checkpoint's picture: the end result, drawn by the strip's thumbnail renderer in the
   * worker's background (behind any run, at picture size, on-demand steps not run) and added
   * once it's ready, so saving never waits for it.
   */
  const addPicture = (p: ProjectStore, cp: Checkpoint, r: Recipe) => {
    void runner
      .thumbnail(r, CHECKPOINT_SIDE)
      .then(async (png) => {
        if (!png) return;
        await attachThumbnail(p, cp.id, new Uint8Array(await png.arrayBuffer()));
        setSaved((n) => n + 1);
      })
      .catch(() => undefined);
  };

  /** Save checkpoint, ⌘S and Branch from here: saved at once, with a confirmation. */
  const saveCheckpoint = async (name?: string, message?: string) => {
    if (!project) {
      if (ready) setNotice("Checkpoints are off for this image (it isn't in browser storage). Reload the page to turn them back on.");
      return;
    }
    const r = recipeRef.current;
    try {
      const cp = await createCheckpoint(project, { recipe: r, name });
      addPicture(project, cp, r);
      setSaved((n) => n + 1);
      confirmSaved(message ?? (sidebar ? "Checkpoint saved." : "Checkpoint saved. Press S to see your checkpoints."));
    } catch (e) {
      setNotice(`Couldn't save the checkpoint: ${errText(e)}`);
    }
  };

  // Restoring saves where you are first, then is one Back step. A checkpoint of another
  // image opens that project too (the image switch itself isn't a Back step, as when
  // opening an image).
  const restore = async (cp: Checkpoint) => {
    if (!library || !project || !ready) return;
    const before = history.present;
    const label = checkpointLabel(cp);
    try {
      const r = await restoreSafely(library, project, cp, history, parseRecipe, { name: `Before restoring “${label}”` });
      if (r.saved.created) addPicture(project, r.saved.checkpoint, before);
      setSaved((n) => n + 1);
      if (r.source) takeSource(await decodeStored(r.project, r.source, (m) => r.warnings.push(m)), nameOf(r.project), r.project.id);
      const { recipe: fitted, note } = enter(r.recipe);
      if (note) r.warnings.push(note);
      setProject(r.project);
      openProjectView(r.project, fitted);
      setHistory((h) => commit(h, fitted));
      const where = r.saved.created ? "Where you were is saved as a checkpoint." : "Where you were was already a checkpoint.";
      setNotice([`Restored “${label}”. ${where}`, ...r.warnings].join("\n"));
      if (live) send(fitted, false);
      else setDirty(true);
    } catch (e) {
      setNotice(`Couldn't restore that checkpoint: ${errText(e)}`);
    }
  };

  // The preset gallery: each preset drawn on your picture, in the worker's background.
  const [gallery, setGallery] = useState<GalleryItem[] | null>(null);
  const [galleryThumbs, setGalleryThumbs] = useState<Record<string, GalleryThumb>>({});
  const openGallery = () => {
    if (!ready) return;
    const items = galleryItems(recipeRef.current, enter);
    setGallery(items);
    setGalleryThumbs({});
    runner.gallery(
      items.map((i) => ({ key: i.id, recipe: i.recipe })),
      gallerySide(),
      (key, png) => setGalleryThumbs((t) => ({ ...t, [key]: png })),
    );
  };
  const closeGallery = () => {
    setGallery(null);
    runner.closeGallery();
  };
  /** Picking a preset saves the current settings as a checkpoint first, then replaces the steps. */
  const choosePreset = async (id: string) => {
    const before = recipeRef.current;
    closeGallery();
    try {
      const r = await pickPreset(project, before, id, enter);
      if (r.saved) {
        if (r.saved.created && project) addPicture(project, r.saved.checkpoint, before);
        setSaved((n) => n + 1);
      }
      setDirty(false);
      apply(r.recipe, false);
      setNotice(r.message);
    } catch (e) {
      setNotice(`Couldn't save your settings as a checkpoint first, so the preset wasn't applied: ${errText(e)}`);
    }
  };

  const apply = (next: Recipe, proxy: boolean, _step?: AnyStep) => {
    if (!ready) return;
    // A drag previews; releasing commits, so one drag is one Back step.
    setHistory((h) => (proxy ? preview(h, next) : commit(h, next)));
    // The time budget only changes the readout, which is computed from the last estimate.
    if (budgetOnlyChange(recipe, next)) return;
    // On-demand steps' own settings wait for their Run button; the worker holds them back.
    if (!live) {
      setDirty(true);
      return;
    }
    send(next, proxy);
  };

  const travel = (move: typeof undo) => {
    const h = move(history);
    if (h === history) return;
    setHistory(h);
    setNotice(null);
    if (live) send(h.present, false);
    else setDirty(true);
  };
  const back = () => travel(undo);
  const forward = () => travel(redo);
  const startOver = () => {
    setDirty(false);
    apply(enter(defaultRecipe()).recipe, false);
    setNotice("Reset to the default recipe (your image stays). Back undoes this.");
  };

  // ⌘S saves a checkpoint, S shows the checkpoints, ⌘Z / ⇧⌘Z go Back / Forward (keys.ts).
  // While the preset gallery is open only ⌘S works (Escape closes it).
  const keys = useRef({ back, forward, save: () => void saveCheckpoint(), checkpoints: () => setSidebar((o) => !o), modal: false, hidden: props.hidden });
  keys.current = { back, forward, save: () => void saveCheckpoint(), checkpoints: () => setSidebar((o) => !o), modal: gallery !== null, hidden: props.hidden };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keys.current.hidden) return;
      const s = shortcut({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, repeat: e.repeat, ...focusOf(e.target) });
      if (!s || (keys.current.modal && s !== "save" && s !== "ignore")) return;
      e.preventDefault();
      if (s !== "ignore") keys.current[s]();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const inspect = canvasTarget(view, recipe);
  /** Chain position of the selected step, or -1. */
  const selected = selectedIndex(view, recipe);
  const changeView = (next: ViewState) => {
    if (next === viewRef.current) return;
    setView(next);
    if (next.thumb !== viewRef.current.thumb) writeThumbSize(defaultLocalStorage() ?? null, next.thumb);
    viewRef.current = next;
    // Only ask the worker again when what it draws changes (the canvas, or thumbnail size).
    if (!started.current) return;
    if (canvasTarget(next, recipeRef.current) !== runner.inspect || thumbSide(next) !== runner.thumbs || passSide(next) !== runner.passes) send(recipeRef.current, false);
  };
  /** A chain edit from the strip that ends with a step selected: the canvas shows that step. */
  const applySelecting = (next: Recipe, id: string) => {
    if (!ready) return;
    const v = select(viewRef.current, stepSelection(id));
    // Set the view first, so the run this edit sends already draws the selected step.
    viewRef.current = v;
    setView(v);
    apply(next, false);
  };
  /**
   * Another project's pins replace these (read from its view block); the same project keeps
   * them. Until the block is read, nothing is saved, so a slow read can't be overwritten.
   */
  function openProjectView(p: ProjectStore | null, r: Recipe) {
    if (p && viewBlock.current?.project === p.id) return;
    viewBlock.current = null;
    wantView.current = p?.id ?? null;
    changeView(fromViewBlock(viewRef.current, undefined, r));
    if (!p) return;
    void readView(p).then((kept) => {
      if (wantView.current !== p.id) return;
      viewBlock.current = { project: p.id, kept };
      changeView(fromViewBlock(viewRef.current, kept, recipeRef.current));
    });
  }
  const stepName = (id: string) => {
    const rs = recipeRef.current.steps.find((s) => s.id === id);
    return registry.get(rs?.step ?? "")?.title ?? "That step";
  };
  /** The Pin button: pin or unpin, and say so. */
  const flipPin = (id: string) => {
    const was = isPinned(viewRef.current, id);
    changeView(togglePin(viewRef.current, id));
    confirmSaved(was ? `Unpinned ${stepName(id)}.` : `Pinned ${stepName(id)}. Its settings stay in the sidebar.`);
  };
  /** A strip box dropped on the sidebar: pin it (dropping a pinned one again changes nothing). */
  const pinDropped = (id: string) => {
    if (!recipeRef.current.steps.some((s) => s.id === id)) return;
    const was = isPinned(viewRef.current, id);
    changeView(pin(viewRef.current, id));
    confirmSaved(was ? `${stepName(id)} is already pinned.` : `Pinned ${stepName(id)}. Its settings stay in the sidebar.`);
  };
  const [pinOver, setPinOver] = useState(false);
  const inspectStage = (t: InspectTarget) => {
    const id = typeof t === "number" ? recipe.steps[t]?.id : undefined;
    changeView(toggleSelect(view, t === "source" ? SOURCE : id ? stepSelection(id) : RESULT));
  };
  // A removed step can't stay selected (fall back to the step before it, or the result), nor pinned.
  const stepIds = recipe.steps.map((s) => s.id).join("\n");
  const chainBefore = useRef(recipe);
  useEffect(() => {
    changeView(fitView(viewRef.current, chainBefore.current, recipe));
    chainBefore.current = recipe;
  }, [stepIds]);

  const loadFile = async (file: File) => {
    if (!ready) return;
    if (file.name.endsWith(".json")) {
      try {
        const { recipe: loaded, warnings } = loadRecipe(JSON.parse(await file.text()), registry);
        const { recipe: r, note } = enter(loaded);
        const lines = [...warnings.map((w) => w.message), ...(note ? [note] : [])];
        setNotice(lines.length ? lines.join("\n") : `Loaded recipe ${file.name}`);
        apply(r, false);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    try {
      const warnings: string[] = [];
      const img = await decodeFile(file, (m) => warnings.push(m));
      // The image is a project (id: its content hash): new, or reopened with its last settings.
      const opened = library ? await openImage(library, { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name, type: file.type }).catch((e) => e as Error) : null;
      let next = recipe;
      if (opened instanceof Error || !opened) {
        warnings.push(`Couldn't keep ${file.name} in browser storage (${opened ? opened.message : "storage isn't open"}). It won't survive a reload, and checkpoints are off until you reload.`);
        setProject(null);
        openProjectView(null, next);
      } else {
        if (opened.saved) {
          try {
            next = parseRecipe(opened.saved.recipe).recipe;
            warnings.push(`Reopened ${file.name} with its last settings. Back returns to the settings you had.`);
          } catch {
            warnings.push(`${file.name}'s last settings couldn't be read; keeping the current ones.`);
          }
        }
        setProject(opened.project);
        openProjectView(opened.project, next);
      }
      takeSource(img, file.name, opened && !(opened instanceof Error) ? opened.project.id : `${file.name}:${file.size}:${file.lastModified}`);
      // Reopened settings, and steps this source can't use switched off, are one Back step.
      const { recipe: fitted, note } = enter(next);
      setHistory((h) => commit(h, fitted));
      if (note) warnings.push(note);
      send(fitted, false);
      setNotice(warnings.length ? warnings.join("\n") : null);
    } catch (e) {
      setNotice(`Couldn't read ${file.name}${e instanceof Error && e.message ? `: ${e.message}` : ""}. Try PNG, JPEG, WebP, TIFF or SVG.`);
    }
  };

  const showAsExported = (on: boolean) => {
    setAsExported(on);
    runner.proof = on;
    send(recipe, false);
  };

  const exportAs = async (format: ExportFormat) => {
    setExporting(format);
    try {
      const f = await runner.export(recipe, format, stem);
      download(f.name, f.data, f.mime);
      setNotice(f.notes.length ? f.notes.join("\n") : null);
    } catch (e) {
      setNotice(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(null);
    }
  };

  /**
   * Send to plotter. No plotter driver exists yet (ADR 0004: drivers come later; the machine
   * profile's protocol is "svg"), so sending is the existing plotter export: the SVG to open in
   * the plotter's own software. `PlotPanel` keeps it off for digital targets (`sendState`).
   */
  const sendToPlotter = async () => {
    setExporting("svg");
    try {
      const f = await runner.export(recipe, "svg", stem);
      download(f.name, f.data, f.mime);
      setNotice([`Saved ${f.name} for the plotter. plotlab can't drive a plotter directly yet: open this file in your plotter's own software to plot it.`, ...f.notes].join("\n"));
    } catch (e) {
      setNotice(`Couldn't make the plotter file: ${errText(e)}`);
    } finally {
      setExporting(null);
    }
  };

  const plot = run.plot;
  // Plot mode: one pen on its own, and the plot-order animation (only the view, never an edit).
  const solo = view.mode === "plot" ? fitSolo(view.solo, plot) : null;
  const shown = view.mode === "plot" && plot ? soloPlot(plot, solo) : null;
  const frame = shown ? framePlot(shown, playback.t) : null;
  /** Plot mode is showing part of the plot: only lines, never the leftover layers or the export proof. */
  const partPlot = !!shown && (solo !== null || playback.t < 1);
  // What the view shows: an inspected stage, the page as it will export, or the end result
  // (lines + layers that stopped early).
  const inspected = inspect !== null && run.inspected ? run.inspected : null;
  const proof = !inspected && asExported && !partPlot ? run.proof : null;
  const viewRasters = inspected ? inspected.rasters : proof ? [proof] : partPlot ? [] : run.rasterLayers;
  const viewPlot = inspected ? inspected.plot : proof ? null : (frame?.plot ?? plot);
  const head = frame?.head ? { at: frame.head.at, color: shown!.layers.find((l) => l.id === frame.head!.layerId)!.ink.color } : null;
  const viewLayers = [
    ...(viewPlot?.layers.map((l) => ({ id: l.id, name: l.name, color: l.ink.color })) ?? []),
    ...viewRasters.filter((r) => r.color !== null).map((r) => ({ id: r.id, name: r.name, color: r.color! })),
  ];
  const stepTitle = (i: number) => registry.get(recipe.steps[i]?.step ?? "")?.title ?? "step";
  // A switched-off step shows what passes through it; an on-demand step that hasn't run, traced order.
  const viewNote = (i: number) =>
    recipe.steps[i]?.enabled === false ? " (switched off: what passes through)" : run.steps.some((x) => x.index === i) ? "" : run.stale.length ? " (not run yet: traced order)" : "";
  const viewTitle = inspect === "source" ? "the source, as placed on the paper" : typeof inspect === "number" ? `${stepTitle(inspect)} output${viewNote(inspect)}` : null;
  const finalLayers = run.steps.at(-1)?.layers ?? [];
  const strokes = plot?.layers.reduce((n, l) => n + l.paths.length, 0) ?? 0;
  const notLines = run.rasterLayers.filter((r) => r.color !== null).map((r) => r.name);
  const stem = sourceName.replace(/\.[^.]+$/, "");
  const cli = `plotlab run recipe.json -i ${sourceName === "sample" ? "photo.jpg" : JSON.stringify(sourceName)} -o out/`;

  // Looking at a step or the source: that, then the pinned steps. Looking at the result: every step.
  const side = sidebarSteps(view, recipe);
  const indexOf = (id: string) => recipe.steps.findIndex((s) => s.id === id);
  const cards: SidebarCards | undefined =
    view.selection.kind === "result" ? undefined : { looking: side.looking === null ? null : indexOf(side.looking), pinned: side.pinned.map(indexOf), lookingPinned: side.lookingPinned };
  const branch = (i: number) => {
    const name = `Before branching at ${stepTitle(i)}`;
    void saveCheckpoint(name, `Saved this version as “${name}”. Your changes from here on are a new version; the saved one stays in Checkpoints.`);
  };

  const summary = setupSummary(recipe, run.estimate);
  const projectName = sourceName === "sample" ? "Sample image" : sourceName;

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) void loadFile(f);
      }}
    >
      <header className="top">
        <strong className="brand">plotlab</strong>
        <span className="project-name" title={projectName}>
          {projectName}
        </span>
        <span className="history-btns">
          <button onClick={back} disabled={!canUndo(history)} title="Back: undo the last change (⌘Z)" aria-label="Back">
            ← <span className="label">Back</span>
          </button>
          <button onClick={forward} disabled={!canRedo(history)} title="Forward: redo (⇧⌘Z)" aria-label="Forward">
            <span className="label">Forward</span> →
          </button>
        </span>
        <button className="presets-btn" onClick={openGallery} disabled={!ready} title="Start from a ready-made set of steps, shown on your picture">
          Presets
        </button>
        <ModeSwitch mode={view.mode} onMode={(m) => changeView(setMode(view, m))} />
        <span className="spacer" />
        <SetupChip summary={summary} onOpen={() => changeView(openSetup(view))} />
        <label className="toggle" title="Live: recompute while you drag. Manual: press Update.">
          <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live
        </label>
        {dirty && (
          <button
            className="primary"
            onClick={() => {
              setDirty(false);
              send(recipe, false);
            }}
          >
            Update
          </button>
        )}
        <span className="cp-group">
          <button className="cp-save" onClick={() => void saveCheckpoint()} disabled={!project} title="Save the current settings as a checkpoint, with a small picture (⌘S)" aria-label="Save checkpoint">
            ＋ <span className="label">
              Save<span className="long"> checkpoint</span>
            </span>
          </button>
          <button className={sidebar ? "on" : ""} onClick={() => setSidebar(!sidebar)} aria-pressed={sidebar} title="Show or hide your checkpoints (S)">
            Checkpoints
          </button>
        </span>
        <button className="reset" onClick={startOver} title="Start over from the default recipe. Keeps your image. Back undoes it." aria-label="Reset">
          ↺ <span className="label">Reset</span>
        </button>
      </header>

      <main className="work">
        <section className="view">
          <div className="stats">
            {run.estimate && (() => {
              const b = recipe.target.kind === "plotter" && recipe.target.budgetMin ? budgetCheck(run.estimate, recipe.target.budgetMin) : null;
              return (
                <>
                  <span className={`big${b?.over ? " over-budget" : ""}`} title="Estimated from the machine profile; includes pen changes.">
                    ~{fmtTime(run.estimate.totalS)}
                  </span>
                  {b && <span className={b.over ? "budget over-budget" : "budget"} role={b.over ? "alert" : undefined}>{b.over ? `⚠ Over budget: ${b.message}` : b.message}</span>}
                </>
              );
            })()}
            {run.estimate && plot && !plot.ordered && <span className="caveat">traced order: add Stroke order for a better estimate</span>}
            {plot && <span>{strokes} strokes</span>}
            {run.estimate && run.estimate.penChanges > 0 && <span>{run.estimate.penChanges} pen changes</span>}
            {run.estimate && (
              <>
                <span>{(run.estimate.passes.reduce((n, l) => n + l.drawLengthMm, 0) / 1000).toFixed(1)} m drawn</span>
                <span>{(run.estimate.passes.reduce((n, l) => n + l.travelLengthMm, 0) / 1000).toFixed(1)} m travel</span>
              </>
            )}
            {run.refining && <span className="refining">low-res preview…</span>}
            {run.busy && !run.refining && <span className="refining">working…</span>}
            <label className="toggle" title="Draw the page the way the exported file will look: at the target's resolution, with halftones, mirror and registration marks.">
              <input type="checkbox" checked={asExported} onChange={(e) => showAsExported(e.target.checked)} /> Preview as exported
            </label>
            {recipe.target.kind === "plotter" && !asExported && (
              <label className="toggle">
                <input type="checkbox" checked={showTravel} onChange={(e) => setShowTravel(e.target.checked)} /> Show pen-up travel
              </label>
            )}
          </div>
          {run.error && run.error.index === undefined && <div className="error">{run.error.message}</div>}
          {[...run.warnings, ...(recipe.target.kind === "plotter" && notLines.length ? [notLinesNotice(notLines)] : [])].map((w) => (
            <div key={w} className="notice">
              {w}
            </div>
          ))}
          {notice && (
            <div className="notice" onClick={() => setNotice(null)}>
              {notice}
            </div>
          )}
          <div className="view-bar">
            {solo !== null && shown ? (
              <>
                <span>
                  Showing only <strong>{shown.layers[0]!.name}</strong>
                </span>
                <button onClick={() => changeView(toggleSolo(view, null))} title="Show every pen again">
                  All pens
                </button>
              </>
            ) : viewTitle ? (
              <>
                <span>
                  Viewing: <strong>{viewTitle}</strong>
                </span>
                <button onClick={() => changeView(select(view, RESULT))} title="Show the end result again">
                  Show final
                </button>
              </>
            ) : (
              <span>Result</span>
            )}
            {viewLayers.length > 1 &&
              viewLayers.map((l) => (
                <label key={l.id} className="chip" title="Show or hide this layer">
                  <input
                    type="checkbox"
                    checked={!hidden.has(l.id)}
                    onChange={() => {
                      const h = new Set(hidden);
                      if (h.has(l.id)) h.delete(l.id);
                      else h.add(l.id);
                      setHidden(h);
                    }}
                  />
                  <span className="swatch" style={{ background: l.color }} /> {l.name}
                </label>
              ))}
            {inspect !== "source" && (
              <label className="toggle">
                <input type="checkbox" checked={showSource} onChange={(e) => setShowSource(e.target.checked)} /> Show source underneath
              </label>
            )}
          </div>
          <StageView
            paper={recipe.paper}
            rasters={viewRasters}
            plot={viewPlot}
            showTravel={showTravel && recipe.target.kind === "plotter" && (!inspected || inspected.kind === "plot")}
            underlay={showSource && inspect !== "source" ? run.underlay : null}
            hidden={hidden}
            empty={run.busy ? "Working…" : "Nothing to show at this stage"}
            head={head}
          />
        </section>

        <aside
          className={`side${pinOver ? " pin-over" : ""}`}
          aria-label={view.mode === "design" ? "Steps" : view.mode === "page" ? "Page setup" : "Plot"}
          onDragOver={(e) => {
            if (view.mode !== "design" || !e.dataTransfer.types.includes(STEP_DRAG)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setPinOver(true);
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setPinOver(false);
          }}
          onDrop={(e) => {
            const id = e.dataTransfer.getData(STEP_DRAG);
            setPinOver(false);
            if (!id) return;
            // A box from the strip, not a file: don't open anything.
            e.preventDefault();
            e.stopPropagation();
            pinDropped(id);
          }}
        >
          {view.mode === "design" && (
            <>
              <div className="card">
                <label className="file">
                  <input type="file" accept="image/*,.png,.jpg,.jpeg,.webp,.tif,.tiff,.svg,.json" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
                  <span>{sourceName === "sample" ? "Open image, SVG or recipe…" : sourceName}</span>
                </label>
              </div>
              {(selected >= 0 || view.selection.kind === "source") && (
                <div className="side-head">
                  <span>{selected >= 0 ? `Looking at step ${selected + 1} of ${recipe.steps.length}` : "Looking at the source"}</span>
                  <span className="side-head-tools">
                    <button className="link" onClick={() => changeView(select(view, RESULT))} title="Show the end result and every step's settings">
                      All steps
                    </button>
                  </span>
                </div>
              )}
              {view.selection.kind === "source" && <p className="hint side-note">The source, as placed on the paper. Pick a step in the strip below to change its settings.</p>}
              <StepList
                recipe={recipe}
                {...(cards && { cards })}
                pins={view.pins}
                onPin={flipPin}
                onBranch={project ? branch : null}
                registry={registry}
                steps={run.steps}
                stale={run.stale}
                error={run.error}
                inspect={inspect}
                onInspect={inspectStage}
                onChange={(r, proxy, step) => apply(r, proxy, step)}
                onRun={() => {
                  setDirty(false);
                  send(recipe, false, true);
                }}
                onHelp={setHelp}
                onNotice={setNotice}
              />
            </>
          )}
          {view.mode === "page" && (
            <PagePanel
              recipe={recipe}
              onChange={(r, proxy) => apply(r, proxy ?? false)}
              layers={finalLayers}
              working={run.working}
            />
          )}
          {view.mode === "plot" && (
            <PlotPanel
              recipe={recipe}
              registry={registry}
              steps={run.steps}
              plot={plot}
              shown={shown}
              estimate={run.estimate}
              busy={run.busy}
              playback={playback}
              onSend={() => void sendToPlotter()}
              onPassOrder={(order) => apply({ ...recipe, passOrder: order }, false)}
              canExport={recipe.target.kind !== "plotter" || plot !== null}
              exporting={exporting}
              onExport={(f) => void exportAs(f)}
              onDownloadRecipe={() => download(`${stem}.recipe.json`, JSON.stringify(recipe, null, 2), "application/json")}
              onCopyCli={() => void navigator.clipboard?.writeText(cli).then(() => setNotice(`Copied: ${cli}`))}
            />
          )}
        </aside>
        <CheckpointSidebar
          open={sidebar}
          onToggle={() => setSidebar((o) => !o)}
          library={library}
          project={project}
          persistent={persistent}
          version={saved}
          onSave={() => void saveCheckpoint()}
          onRestore={(cp) => void restore(cp)}
        />
      </main>
      {view.mode === "design" && (
        <Strip
          recipe={recipe}
          registry={registry}
          boxes={stripBoxes(recipe, registry, run)}
          thumbs={run.thumbs}
          selected={view.selection.kind === "step" ? view.selection.id : view.selection.kind === "source" ? "source" : null}
          size={view.thumb}
          pins={view.pins}
          onSelect={(key) => changeView(select(view, key === "source" ? SOURCE : stepSelection(key)))}
          onBypass={(index) => {
            const res = toggleBypass(recipe, index, registry);
            if ("reason" in res) setNotice(res.reason);
            else apply(res.recipe, false);
          }}
          onResize={(px) => changeView(resizeThumbs(viewRef.current, px))}
          onNotice={setNotice}
          onAdd={(gap, stepId) => {
            const res = addAt(recipe, registry, gap, stepId);
            if ("reason" in res) setNotice(res.reason);
            else applySelecting(res.recipe, res.id);
          }}
          onMove={(from, gap) => {
            const id = recipe.steps[from]?.id;
            const res = moveToGap(recipe, registry, from, gap);
            if ("reason" in res) setNotice(res.reason);
            else if (id) applySelecting(res.recipe, id);
          }}
        />
      )}
      {view.mode === "plot" && plot && plot.layers.length > 0 && (
        <PassStrip boxes={passBoxes(plot, run.estimate)} thumbs={run.passThumbs} solo={solo} size={view.thumb} onSolo={(id) => changeView(toggleSolo(viewRef.current, id))} />
      )}
      {!ready && (
        <div className="starting" role="status">
          Opening your last session…
        </div>
      )}
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {gallery && <PresetGallery items={gallery} thumbs={galleryThumbs} onPick={(id) => void choosePreset(id)} onClose={closeGallery} />}
      {help && <HelpPanel markdown={help.help} onClose={() => setHelp(null)} />}
    </div>
  );
}

function notLinesNotice(names: string[]): string {
  const n = names.length;
  return `${n === 1 ? "1 layer isn't" : `${n} layers aren't`} lines yet, so ${n === 1 ? "it" : "they"} won't plot: ${names.join(", ")}. Add Centerline (or another line step) for ${n === 1 ? "it" : "them"}.`;
}
