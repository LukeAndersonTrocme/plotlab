import { useEffect, useMemo, useRef, useState } from "react";
import { budgetOnlyChange, describeEntry, enterAt, loadRecipe, sourceLabel, sourceStage, type AnyStep, type ExportFormat, type Recipe, type Source, type StageKind } from "@plotlab/engine";
import { budgetCheck } from "@plotlab/machines";
import { createRegistry } from "@plotlab/steps";
import { defaultRecipe } from "./defaults.ts";
import { HelpPanel } from "./Help.tsx";
import { PagePanel } from "./PagePanel.tsx";
import { PlotPanel } from "./PlotPanel.tsx";
import { fmtTime, setupSummary } from "./setup.ts";
import { ModeSwitch, SetupChip } from "./Shell.tsx";
import { canvasTarget, fitSelection, initialView, openSetup, RESULT, setMode, SOURCE, stepSelection, toggleSelect, type ViewState } from "./view.ts";
import { EMPTY_RUN, Runner, type RunState } from "./runner.ts";
import { decodeFile, loadSample, sampleSource } from "./sample.ts";
import { canRedo, canUndo, commit, createHistory, preview, redo, undo, type History } from "./history.ts";
import type { InspectTarget } from "./protocol.ts";
import { StageView } from "./StageView.tsx";
import { StepList } from "./StepList.tsx";
import { CheckpointSidebar } from "./CheckpointSidebar.tsx";
import { createCheckpoint, restoreFrom } from "./checkpoints.ts";
import { openImage, SAMPLE_NAME, startSession } from "./session.ts";
import { defaultLocalStorage, openLibrary, type Checkpoint, type Library, type ProjectStore, type Source as StoredSource } from "./storage/index.ts";
import { captureThumbnail } from "./thumbnail.ts";

const registry = createRegistry();

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

export function App() {
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
  // Storage (ADR 0014): the open project (its image, recipe and checkpoints) in a library.
  const [library, setLibrary] = useState<Library | null>(null);
  const [project, setProject] = useState<ProjectStore | null>(null);
  const [persistent, setPersistent] = useState(true);
  // Input waits until the last session is back, so nothing done meanwhile gets overwritten.
  const [ready, setReady] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [saved, setSaved] = useState(0);
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
      setPersistent(opened.persistent);
      setReady(true);
      runner.request(recipeRef.current, false);
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

  const saveCheckpoint = async () => {
    if (!project) return;
    const svg = document.querySelector<SVGSVGElement>(".view svg.preview");
    const thumbnail = svg ? await captureThumbnail(svg).catch(() => undefined) : undefined;
    try {
      await createCheckpoint(project, { recipe, ...(thumbnail && { thumbnail }) });
      setSaved((n) => n + 1);
      setNotice(sidebar ? null : "Saved a checkpoint. Press S to see your checkpoints.");
    } catch (e) {
      setNotice(`Couldn't save the checkpoint: ${errText(e)}`);
    }
  };

  // Restoring is one Back step. A checkpoint of another image opens that project too
  // (the image switch itself isn't a Back step, as when opening an image).
  const restore = async (cp: Checkpoint) => {
    if (!library || !project) return;
    try {
      const r = await restoreFrom(library, project, cp, history, parseRecipe);
      if (r.source) takeSource(await decodeStored(r.project, r.source, (m) => r.warnings.push(m)), nameOf(r.project), r.project.id);
      const { recipe: fitted, note } = enter(r.recipe);
      if (note) r.warnings.push(note);
      setProject(r.project);
      setHistory((h) => commit(h, fitted));
      setNotice(r.warnings.length ? r.warnings.join("\n") : null);
      if (live) runner.request(fitted, false);
      else setDirty(true);
    } catch (e) {
      setNotice(`Couldn't restore that checkpoint: ${errText(e)}`);
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
    runner.request(next, proxy);
  };

  const travel = (move: typeof undo) => {
    const h = move(history);
    if (h === history) return;
    setHistory(h);
    setNotice(null);
    if (live) runner.request(h.present, false);
    else setDirty(true);
  };
  const back = () => travel(undo);
  const forward = () => travel(redo);
  const startOver = () => {
    setDirty(false);
    apply(enter(defaultRecipe()).recipe, false);
    setNotice("Reset to the default recipe (your image stays). Back undoes this.");
  };

  // ⌘Z / ⇧⌘Z (Ctrl on other systems). Text and number boxes keep their own undo.
  const keys = useRef({ back, forward });
  keys.current = { back, forward };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && (t.type === "text" || t.type === "number"))) return;
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) keys.current.back();
      else if ((k === "z" && e.shiftKey) || k === "y") keys.current.forward();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // What the screen shows (mode, selection): not a recipe edit, so never a Back step.
  const [view, setView] = useState<ViewState>(initialView);
  const inspect = canvasTarget(view);
  const changeView = (next: ViewState) => {
    if (next === view) return;
    setView(next);
    const t = canvasTarget(next);
    if (t === runner.inspect) return;
    runner.inspect = t;
    runner.request(recipeRef.current, false);
  };
  const inspectStage = (t: InspectTarget) =>
    changeView(toggleSelect(view, t === null ? RESULT : t === "source" ? SOURCE : stepSelection(t)));
  // A removed step can't stay selected.
  const stepCount = recipe.steps.length;
  useEffect(() => changeView(fitSelection(view, stepCount)), [stepCount]);

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
      }
      takeSource(img, file.name, opened && !(opened instanceof Error) ? opened.project.id : `${file.name}:${file.size}:${file.lastModified}`);
      // Reopened settings, and steps this source can't use switched off, are one Back step.
      const { recipe: fitted, note } = enter(next);
      setHistory((h) => commit(h, fitted));
      if (note) warnings.push(note);
      runner.request(fitted, false);
      setNotice(warnings.length ? warnings.join("\n") : null);
    } catch (e) {
      setNotice(`Couldn't read ${file.name}${e instanceof Error && e.message ? `: ${e.message}` : ""}. Try PNG, JPEG, WebP, TIFF or SVG.`);
    }
  };

  const showAsExported = (on: boolean) => {
    setAsExported(on);
    runner.proof = on;
    runner.request(recipe, false);
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

  const plot = run.plot;
  // What the view shows: an inspected stage, the page as it will export, or the end result
  // (lines + layers that stopped early).
  const inspected = inspect !== null && run.inspected ? run.inspected : null;
  const proof = !inspected && asExported ? run.proof : null;
  const viewRasters = inspected ? inspected.rasters : proof ? [proof] : run.rasterLayers;
  const viewPlot = inspected ? inspected.plot : proof ? null : plot;
  const viewLayers = [
    ...(viewPlot?.layers.map((l) => ({ id: l.id, name: l.name, color: l.ink.color })) ?? []),
    ...viewRasters.filter((r) => r.color !== null).map((r) => ({ id: r.id, name: r.name, color: r.color! })),
  ];
  const viewTitle =
    inspect === "source" ? "the source, as placed on the paper" : typeof inspect === "number" ? `${registry.get(recipe.steps[inspect]?.step ?? "")?.title ?? "step"} output` : null;
  const finalLayers = run.steps.at(-1)?.layers ?? [];
  const strokes = plot?.layers.reduce((n, l) => n + l.paths.length, 0) ?? 0;
  const notLines = run.rasterLayers.filter((r) => r.color !== null).map((r) => r.name);
  const stem = sourceName.replace(/\.[^.]+$/, "");
  const cli = `plotlab run recipe.json -i ${sourceName === "sample" ? "photo.jpg" : JSON.stringify(sourceName)} -o out/`;

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
              runner.request(recipe, false);
            }}
          >
            Update
          </button>
        )}
        <button onClick={() => void saveCheckpoint()} disabled={!project} title="Save the current settings as a checkpoint, with a small picture" aria-label="Save a checkpoint">
          ＋ <span className="label">Checkpoint</span>
        </button>
        <button className={sidebar ? "on" : ""} onClick={() => setSidebar(!sidebar)} aria-pressed={sidebar} title="Show or hide your checkpoints (S)">
          Checkpoints
        </button>
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
            {viewTitle ? (
              <>
                <span>
                  Viewing: <strong>{viewTitle}</strong>
                </span>
                <button onClick={() => inspectStage(null)}>Back to result</button>
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
          />
        </section>

        <aside className="side" aria-label={view.mode === "design" ? "Steps" : view.mode === "page" ? "Page setup" : "Plot"}>
          {view.mode === "design" && (
            <>
              <div className="card">
                <label className="file">
                  <input type="file" accept="image/*,.png,.jpg,.jpeg,.webp,.tif,.tiff,.svg,.json" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
                  <span>{sourceName === "sample" ? "Open image, SVG or recipe…" : sourceName}</span>
                </label>
              </div>
              <StepList
                recipe={recipe}
                registry={registry}
                steps={run.steps}
                stale={run.stale}
                error={run.error}
                inspect={inspect}
                onInspect={inspectStage}
                onChange={(r, proxy, step) => apply(r, proxy, step)}
                onReplace={(r) => {
                  // A preset meets the source where it enters, like opening a recipe file does.
                  const { recipe: fitted, note } = enter(r);
                  apply(fitted, false);
                  setNotice(note);
                }}
                onRun={() => {
                  setDirty(false);
                  runner.request(recipe, false, true);
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
              passes={plot?.layers.map((l) => ({ id: l.id, name: l.name })) ?? []}
              working={run.working}
            />
          )}
          {view.mode === "plot" && (
            <PlotPanel
              recipe={recipe}
              registry={registry}
              steps={run.steps}
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
      {!ready && (
        <div className="starting" role="status">
          Opening your last session…
        </div>
      )}
      {help && <HelpPanel markdown={help.help} onClose={() => setHelp(null)} />}
    </div>
  );
}

function notLinesNotice(names: string[]): string {
  const n = names.length;
  return `${n === 1 ? "1 layer isn't" : `${n} layers aren't`} lines yet, so ${n === 1 ? "it" : "they"} won't plot: ${names.join(", ")}. Add Centerline (or another line step) for ${n === 1 ? "it" : "them"}.`;
}
