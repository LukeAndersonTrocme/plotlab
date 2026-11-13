import { useEffect, useMemo, useRef, useState } from "react";
import { loadRecipe, plotToSvg, type AnyStep, type Recipe } from "@plotlab/engine";
import { createRegistry } from "@plotlab/steps";
import { defaultRecipe } from "./defaults.ts";
import { HelpPanel } from "./Help.tsx";
import { ProjectPanel } from "./ProjectPanel.tsx";
import { EMPTY_RUN, Runner, type RunState } from "./runner.ts";
import { decodeFile, loadSample } from "./sample.ts";
import type { InspectTarget } from "./protocol.ts";
import { StageView } from "./StageView.tsx";
import { StepList } from "./StepList.tsx";

const registry = createRegistry();
const STORAGE_KEY = "plotlab:recipe";

function loadSaved(): Recipe {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return loadRecipe(JSON.parse(raw), registry).recipe;
  } catch {
    /* fall through to default */
  }
  return defaultRecipe();
}

function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
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
  const [recipe, setRecipe] = useState<Recipe>(loadSaved);
  const [run, setRun] = useState<RunState>(EMPTY_RUN);
  const [live, setLive] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [help, setHelp] = useState<AnyStep | null>(null);
  const [showTravel, setShowTravel] = useState(false);
  const [sourceName, setSourceName] = useState("sample");
  const [notice, setNotice] = useState<string | null>(null);
  const [showSource, setShowSource] = useState(false);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const runner = useMemo(() => new Runner(setRun), []);
  const recipeRef = useRef(recipe);
  recipeRef.current = recipe;

  useEffect(() => {
    void loadSample().then((img) => {
      runner.setSource(img, "sample");
      runner.request(recipeRef.current, false);
    });
    return () => runner.dispose();
  }, [runner]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recipe));
    } catch {
      /* storage unavailable: autosave is a convenience */
    }
  }, [recipe]);

  const apply = (next: Recipe, proxy: boolean, step?: AnyStep) => {
    setRecipe(next);
    // On-demand steps' own settings wait for their Run button; the worker holds them back.
    if (!live) {
      setDirty(true);
      return;
    }
    runner.request(next, proxy);
  };

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
      const img = await decodeFile(file);
      setSourceName(file.name);
      runner.setSource(img, `${file.name}:${file.size}:${file.lastModified}`);
      runner.request(recipe, false);
      setNotice(null);
    } catch {
      setNotice(`Couldn't read ${file.name}. Try PNG, JPEG or WebP.`);
    }
  };

  const plot = run.plot;
  // What the view shows: an inspected stage, or the end result (lines + layers that stopped early).
  const view = inspect !== null && run.inspected ? run.inspected : null;
  const viewRasters = view ? view.rasters : run.rasterLayers;
  const viewPlot = view ? view.plot : plot;
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
            {recipe.target.kind === "plotter" && (
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
            <button className="primary" disabled={!plot || run.refining} onClick={() => plot && download(`${stem}.svg`, plotToSvg(plot, { recipe }), "image/svg+xml")}>
              Download SVG
            </button>
            <button onClick={() => download(`${stem}.recipe.json`, JSON.stringify(recipe, null, 2), "application/json")}>Download recipe</button>
            <button onClick={() => void navigator.clipboard?.writeText(cli).then(() => setNotice(`Copied: ${cli}`))}>Copy as CLI command</button>
            <button
              onClick={() => {
                setDirty(false);
                apply(defaultRecipe(), false);
              }}
            >
              Reset
            </button>
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
      </main>
      {help && <HelpPanel markdown={help.help} onClose={() => setHelp(null)} />}
    </div>
  );
}

function notLinesNotice(names: string[]): string {
  const n = names.length;
  return `${n === 1 ? "1 layer isn't" : `${n} layers aren't`} lines yet, so ${n === 1 ? "it" : "they"} won't plot: ${names.join(", ")}. Add Centerline (or another line step) for ${n === 1 ? "it" : "them"}.`;
}
