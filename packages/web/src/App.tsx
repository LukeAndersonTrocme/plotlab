import { useEffect, useMemo, useRef, useState } from "react";
import { exportFormats, FORMAT_LABEL, loadRecipe, type AnyStep, type ExportFormat, type Recipe } from "@plotlab/engine";
import { createRegistry } from "@plotlab/steps";
import { defaultRecipe } from "./defaults.ts";
import { HelpPanel } from "./Help.tsx";
import { ProjectPanel } from "./ProjectPanel.tsx";
import { EMPTY_RUN, Runner, type RunState } from "./runner.ts";
import { decodeFile, loadSample } from "./sample.ts";
import { canRedo, canUndo, commit, createHistory, preview, redo, undo, type History } from "./history.ts";
import type { InspectTarget } from "./protocol.ts";
import { StageView } from "./StageView.tsx";
import { StepList } from "./StepList.tsx";
import { CheckpointSidebar } from "./CheckpointSidebar.tsx";
import { createCheckpoint, restoreCheckpoint, SAMPLE_NAME, type CheckpointGroup } from "./checkpoints.ts";
import { openStore, SAMPLE_SOURCE, sha256Hex, type Checkpoint, type ProjectStore, type StoredSource } from "./storage/index.ts";
import { captureThumbnail } from "./thumbnail.ts";

const registry = createRegistry();

/** A stored recipe, upgraded (ADR 0002); throws if it can't be read. */
const parseRecipe = (json: unknown) => {
  const { recipe, warnings } = loadRecipe(json, registry);
  return { recipe, warnings: warnings.map((w) => w.message) };
};

function download(name: string, data: string | Uint8Array, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([data], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const fmtTime = (s: number) => {
  if (s < 60) return `${Math.round(s)} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

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
  // Storage (ADR 0014): the source by hash, the current recipe, checkpoints.
  const [store, setStore] = useState<ProjectStore | null>(null);
  const [persistent, setPersistent] = useState(true);
  const [sourceHash, setSourceHash] = useState(SAMPLE_SOURCE);
  const [sidebar, setSidebar] = useState(false);
  const [saved, setSaved] = useState(0);

  /** Show a stored source, or the sample when there's none (or it can't be read). */
  const openSource = async (src: StoredSource | undefined) => {
    if (src) {
      try {
        const img = await decodeFile(new File([src.bytes], src.name, { type: src.type }));
        runner.setSource(img, src.hash);
        setSourceName(src.name);
        setSourceHash(src.hash);
        return;
      } catch {
        setNotice(`Couldn't read the saved image ${src.name}; showing the sample.`);
      }
    }
    runner.setSource(await loadSample(), SAMPLE_SOURCE);
    setSourceName("sample");
    setSourceHash(SAMPLE_SOURCE);
  };

  // Start: open storage, then reopen the last recipe and its source (both survive a reload).
  useEffect(() => {
    let alive = true;
    void (async () => {
      const { store: s, persistent: p } = await openStore();
      const cur = await s.getCurrent().catch(() => undefined);
      let src: StoredSource | undefined;
      if (cur && cur.sourceHash !== SAMPLE_SOURCE) src = await s.getSource(cur.sourceHash).catch(() => undefined);
      if (!alive) return;
      if (cur) {
        try {
          const r = parseRecipe(cur.recipe);
          setHistory(createHistory(r.recipe));
          recipeRef.current = r.recipe;
          if (r.warnings.length) setNotice(r.warnings.join("\n"));
        } catch {
          setNotice("Couldn't read the saved recipe; starting from the default.");
        }
      }
      await openSource(src);
      if (!alive) return;
      // Only now, so autosave never pairs the saved recipe with the wrong source.
      setStore(s);
      setPersistent(p);
      runner.request(recipeRef.current, false);
    })();
    return () => {
      alive = false;
      runner.dispose();
    };
  }, [runner]);

  // Autosave what's committed (not every mid-drag preview).
  useEffect(() => {
    void store?.setCurrent({ recipe: history.base, sourceHash }).catch(() => {
      /* autosave is a convenience */
    });
  }, [store, history.base, sourceHash]);

  const saveCheckpoint = async () => {
    if (!store) return;
    const svg = document.querySelector<SVGSVGElement>(".view svg.preview");
    const thumbnail = svg ? await captureThumbnail(svg).catch(() => undefined) : undefined;
    try {
      await createCheckpoint(store, { recipe, sourceHash, ...(thumbnail && { thumbnail }) });
      setSaved((n) => n + 1);
      setNotice(sidebar ? null : "Saved a checkpoint. Press S to see your checkpoints.");
    } catch (e) {
      setNotice(`Couldn't save the checkpoint: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // Restoring is one Back step. A checkpoint of another image brings that image back too
  // (changing the image itself isn't a Back step, as when opening one).
  const restore = async (cp: Checkpoint, group: CheckpointGroup) => {
    let parsed: ReturnType<typeof parseRecipe>;
    try {
      parsed = parseRecipe(cp.recipe);
    } catch (e) {
      setNotice(`Couldn't restore that checkpoint: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    const notes = [...parsed.warnings];
    if (cp.sourceHash !== sourceHash) {
      const src = cp.sourceHash === SAMPLE_SOURCE ? undefined : await store?.getSource(cp.sourceHash);
      if (src || cp.sourceHash === SAMPLE_SOURCE) await openSource(src);
      else notes.push(`The image “${group.name}” isn't stored any more, so this keeps the current image.`);
    }
    setHistory((h) => restoreCheckpoint(h, cp, () => parsed).history);
    setNotice(notes.length ? notes.join("\n") : null);
    if (live) runner.request(parsed.recipe, false);
    else setDirty(true);
  };

  const apply = (next: Recipe, proxy: boolean, _step?: AnyStep) => {
    // A drag previews; releasing commits, so one drag is one Back step.
    setHistory((h) => (proxy ? preview(h, next) : commit(h, next)));
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
    apply(defaultRecipe(), false);
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

  const [inspect, setInspect] = useState<InspectTarget>(null);
  const inspectStage = (t: InspectTarget) => {
    const next = t === inspect ? null : t;
    setInspect(next);
    runner.inspect = next;
    runner.request(recipe, false);
  };

  const loadFile = async (file: File) => {
    if (file.name.endsWith(".json")) {
      try {
        const { recipe: r, warnings } = loadRecipe(JSON.parse(await file.text()), registry);
        setNotice(warnings.length ? warnings.map((w) => w.message).join("\n") : `Loaded recipe ${file.name}`);
        apply(r, false);
      } catch (e) {
        setNotice(e instanceof Error ? e.message : String(e));
      }
      return;
    }
    try {
      const warnings: string[] = [];
      const img = await decodeFile(file, (m) => warnings.push(m));
      // Stored once by content hash, so it survives a reload and checkpoints can find it.
      const bytes = new Uint8Array(await file.arrayBuffer());
      const hash = (await store?.putSource(bytes, { name: file.name, type: file.type }).catch(() => undefined))?.hash ?? (await sha256Hex(bytes));
      setSourceName(file.name);
      setSourceHash(hash);
      runner.setSource(img, hash);
      runner.request(recipe, false);
      setNotice(warnings.length ? warnings.join("\n") : null);
    } catch {
      setNotice(`Couldn't read ${file.name}. Try PNG, JPEG, WebP or TIFF.`);
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
  const view = inspect !== null && run.inspected ? run.inspected : null;
  const proof = !view && asExported ? run.proof : null;
  const viewRasters = view ? view.rasters : proof ? [proof] : run.rasterLayers;
  const viewPlot = view ? view.plot : proof ? null : plot;
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
      <header>
        <strong className="brand">plotlab</strong>
        <span className="history-btns">
          <button onClick={back} disabled={!canUndo(history)} title="Back: undo the last change (⌘Z)" aria-label="Back">
            ← Back
          </button>
          <button onClick={forward} disabled={!canRedo(history)} title="Forward: redo (⇧⌘Z)" aria-label="Forward">
            Forward →
          </button>
        </span>
        <span className="spacer" />
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
        <button onClick={() => void saveCheckpoint()} disabled={!store} title="Save the current settings as a checkpoint, with a small picture">
          ＋ Checkpoint
        </button>
        <button className={sidebar ? "on" : ""} onClick={() => setSidebar(!sidebar)} aria-pressed={sidebar} title="Show or hide your checkpoints (S)">
          Checkpoints
        </button>
        <button className="reset" onClick={startOver} title="Start over from the default recipe. Keeps your image. Back undoes it.">
          ↺ Reset
        </button>
      </header>

      <main>
        <section className="panel">
          <div className="card">
            <label className="file">
              <input type="file" accept="image/*,.json" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
              <span>{sourceName === "sample" ? "Open image or recipe…" : sourceName}</span>
            </label>
          </div>
          <ProjectPanel
            recipe={recipe}
            onChange={(r, proxy) => apply(r, proxy ?? false)}
            layers={finalLayers}
            passes={plot?.layers.map((l) => ({ id: l.id, name: l.name })) ?? []}
            working={run.working}
          />
          <h2 className="section">Steps</h2>
          <StepList
            recipe={recipe}
            registry={registry}
            steps={run.steps}
            stale={run.stale}
            error={run.error}
            inspect={inspect}
            onInspect={inspectStage}
            onChange={(r, proxy, step) => apply(r, proxy, step)}
            onRun={() => {
              setDirty(false);
              runner.request(recipe, false, true);
            }}
            onHelp={setHelp}
            onNotice={setNotice}
          />
        </section>

        <section className="view">
          <div className="stats">
            {run.estimate && (
              <span className="big" title="Estimated from the machine profile; includes pen changes.">
                ~{fmtTime(run.estimate.totalS)}
              </span>
            )}
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
            showTravel={showTravel && recipe.target.kind === "plotter" && (!view || view.kind === "plot")}
            underlay={showSource && inspect !== "source" ? run.underlay : null}
            hidden={hidden}
            empty={run.busy ? "Working…" : "Nothing to show at this stage"}
          />
          <div className="actions">
            {exportFormats(recipe.target).map((f, i) => (
              <button
                key={f}
                className={i === 0 ? "primary" : ""}
                disabled={exporting !== null || (recipe.target.kind === "plotter" && !plot)}
                onClick={() => void exportAs(f)}
              >
                {exporting === f ? "Exporting…" : `Download ${FORMAT_LABEL[f]}`}
              </button>
            ))}
            <button onClick={() => download(`${stem}.recipe.json`, JSON.stringify(recipe, null, 2), "application/json")}>Download recipe</button>
            <button onClick={() => void navigator.clipboard?.writeText(cli).then(() => setNotice(`Copied: ${cli}`))}>Copy as CLI command</button>
          </div>
          <details className="timings">
            <summary>Step timings</summary>
            {run.steps.map((t) => (
              <div key={t.index}>
                {registry.get(t.step)?.title ?? t.step}: {t.cached ? "cached" : `${t.ms.toFixed(0)} ms`}
              </div>
            ))}
          </details>
        </section>
        <CheckpointSidebar
          open={sidebar}
          onToggle={() => setSidebar((o) => !o)}
          store={store}
          persistent={persistent}
          sourceHash={sourceHash}
          sourceName={sourceName === "sample" ? SAMPLE_NAME : sourceName}
          version={saved}
          onSave={() => void saveCheckpoint()}
          onRestore={(cp, g) => void restore(cp, g)}
        />
      </main>
      {help && <HelpPanel markdown={help.help} onClose={() => setHelp(null)} />}
    </div>
  );
}

function notLinesNotice(names: string[]): string {
  const n = names.length;
  return `${n === 1 ? "1 layer isn't" : `${n} layers aren't`} lines yet, so ${n === 1 ? "it" : "they"} won't plot: ${names.join(", ")}. Add Centerline (or another line step) for ${n === 1 ? "it" : "them"}.`;
}
