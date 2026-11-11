import { useEffect, useMemo, useRef, useState } from "react";
import { isVisible, loadRecipe, plotToSvg, type AnyStep, type ParamDecl, type Recipe, type StageKind } from "@plotlab/engine";
import { createRegistry } from "@plotlab/steps";
import { defaultRecipe, PAPERS } from "./defaults.ts";
import { HelpPanel } from "./Help.tsx";
import { ParamControl } from "./ParamControl.tsx";
import { PlotPreview } from "./PlotPreview.tsx";
import { Runner, type RunState } from "./runner.ts";
import { decodeFile, loadSample } from "./sample.ts";

const registry = createRegistry();
const STORAGE_KEY = "plotlab:recipe";

/** UI stages group steps by what they produce. */
const STAGES: Array<{ name: string; produces: StageKind[] }> = [
  { name: "Input", produces: [] },
  { name: "Image", produces: ["image"] },
  { name: "Layers", produces: ["layers"] },
  { name: "Output", produces: ["geometry", "plot"] },
];

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
  const [run, setRun] = useState<RunState>({ plot: null, refining: false, busy: false, error: null, timings: [] });
  const [live, setLive] = useState(true);
  const [dirty, setDirty] = useState(false);
  const [help, setHelp] = useState<AnyStep | null>(null);
  const [showTravel, setShowTravel] = useState(false);
  const [sourceName, setSourceName] = useState("sample");
  const [notice, setNotice] = useState<string | null>(null);
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
    if (!live || step?.cost === "on-demand") {
      setDirty(true);
      return;
    }
    runner.request(next, proxy);
  };

  const setParam = (index: number, name: string, value: unknown, proxy: boolean) => {
    const steps = recipe.steps.map((s, i) => (i === index ? { ...s, params: { ...s.params, [name]: value } } : s));
    apply({ ...recipe, steps }, proxy, registry.get(recipe.steps[index]!.step));
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
        <nav className="stages">
          {STAGES.map((s, i) => (
            <span key={s.name}>
              {i > 0 && <span className="arrow">→</span>}
              {s.name}
            </span>
          ))}
        </nav>
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
          {STAGES.map((stage) => (
            <div key={stage.name} className="stage">
              <h2>{stage.name}</h2>
              {stage.name === "Input" && (
                <div className="card">
                  <label className="file">
                    <input type="file" accept="image/*,.json" onChange={(e) => e.target.files?.[0] && loadFile(e.target.files[0])} />
                    <span>{sourceName === "sample" ? "Open image or recipe…" : sourceName}</span>
                  </label>
                  <div className="param">
                    <label>Paper</label>
                    <div className="param-row">
                      <select
                        value={Object.entries(PAPERS).find(([, p]) => Math.min(p.widthMm, p.heightMm) === Math.min(recipe.paper.widthMm, recipe.paper.heightMm))?.[0] ?? ""}
                        onChange={(e) => {
                          const p = PAPERS[e.target.value]!;
                          const landscape = recipe.paper.widthMm > recipe.paper.heightMm;
                          apply({ ...recipe, paper: landscape ? { widthMm: p.heightMm, heightMm: p.widthMm } : p }, false);
                        }}
                      >
                        {Object.keys(PAPERS).map((k) => (
                          <option key={k}>{k}</option>
                        ))}
                      </select>
                      <button onClick={() => apply({ ...recipe, paper: { widthMm: recipe.paper.heightMm, heightMm: recipe.paper.widthMm } }, false)}>
                        {recipe.paper.widthMm > recipe.paper.heightMm ? "Landscape" : "Portrait"} ⟲
                      </button>
                    </div>
                  </div>
                  <div className="param">
                    <label>Pen</label>
                    <div className="param-row">
                      <input
                        className="num"
                        type="number"
                        min={0.05}
                        max={5}
                        step={0.05}
                        value={recipe.pens[0]!.widthMm}
                        onChange={(e) => apply({ ...recipe, pens: [{ ...recipe.pens[0]!, widthMm: Number(e.target.value) || 0.5 }] }, false)}
                      />
                      <span className="unit">mm</span>
                      <input
                        type="color"
                        value={recipe.pens[0]!.color}
                        onChange={(e) => apply({ ...recipe, pens: [{ ...recipe.pens[0]!, color: e.target.value }] }, false)}
                      />
                    </div>
                  </div>
                </div>
              )}
              {recipe.steps.map((rs, index) => {
                const def = registry.get(rs.step);
                if (!def || !stage.produces.includes(def.output)) return null;
                return (
                  <div key={index} className="card">
                    <div className="card-head">
                      <span className="title">{def.title}</span>
                      <button className="help-btn" onClick={() => setHelp(def)} aria-label={`Help for ${def.title}`}>
                        ?
                      </button>
                    </div>
                    <p className="summary">{def.summary}</p>
                    {Object.entries(def.params).map(([name, decl]) =>
                      isVisible(def.params, name, rs.params) ? (
                        <ParamControl
                          key={name}
                          name={name}
                          decl={decl as ParamDecl}
                          value={rs.params[name]}
                          onDrag={(v) => setParam(index, name, v, true)}
                          onCommit={(v) => setParam(index, name, v, false)}
                        />
                      ) : null,
                    )}
                  </div>
                );
              })}
              {stage.name === "Image" && <p className="empty-stage">No image steps yet (levels, blur, crop… coming).</p>}
            </div>
          ))}
        </section>

        <section className="view">
          <div className="stats">
            {plot && (
              <>
                <span className="big">~{fmtTime(plot.timeEstimateS)}</span>
                <span>{plot.layers.reduce((n, l) => n + l.paths.length, 0)} strokes</span>
                <span>{(plot.layers.reduce((n, l) => n + l.drawLengthMm, 0) / 1000).toFixed(1)} m drawn</span>
                <span>{(plot.layers.reduce((n, l) => n + l.travelLengthMm, 0) / 1000).toFixed(1)} m travel</span>
              </>
            )}
            {run.refining && <span className="refining">low-res preview…</span>}
            {run.busy && !run.refining && <span className="refining">working…</span>}
            <label className="toggle">
              <input type="checkbox" checked={showTravel} onChange={(e) => setShowTravel(e.target.checked)} /> Show pen-up travel
            </label>
          </div>
          {run.error && <div className="error">{run.error}</div>}
          {notice && (
            <div className="notice" onClick={() => setNotice(null)}>
              {notice}
            </div>
          )}
          <PlotPreview plot={plot} showTravel={showTravel} />
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
            {run.timings.map((t, i) => (
              <div key={i}>
                {t.step}: {t.cached ? "cached" : `${t.ms.toFixed(0)} ms`}
              </div>
            ))}
          </details>
        </section>
      </main>
      {help && <HelpPanel markdown={help.help} onClose={() => setHelp(null)} />}
    </div>
  );
}
