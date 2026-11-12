import { DEFAULT_PRINT, finishing, MARK_INSET_MM, screenAngle, type Ink, type LayerInfo, type Recipe, type Target, type TargetKind } from "@plotlab/engine";
import { PAPERS } from "./defaults.ts";

const TARGETS: Array<{ kind: TargetKind; label: string; hint: string }> = [
  { kind: "plotter", label: "Plotter", hint: "Pens on paper. Shows plot time and pen changes." },
  { kind: "raster", label: "Digital image", hint: "A PNG or TIFF at the resolution below; inks mix like ink on paper." },
  { kind: "vector", label: "Digital vector", hint: "An SVG or PDF with strokes at their ink width; layers that aren't lines are embedded as images." },
  { kind: "print", label: "Print prep", hint: "One 1-bit or gray TIFF per ink (riso, screen print, relief, film), plus a proof." },
];

type PrintTarget = Extract<Target, { kind: "print" }>;

const ANCHORS: Array<[number, number]> = [0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x): [number, number] => [x, y]));

let inkCounter = 0;
const newInkId = (inks: Ink[]) => {
  let id: string;
  do id = `ink-${inks.length + 1 + inkCounter++}`;
  while (inks.some((i) => i.id === id));
  return id;
};

/**
 * Project settings (ADR 0005, 0007, 0008, 0011): output target, paper and placement,
 * working detail, inks, which layer uses which ink, and pass order.
 */
export function ProjectPanel(props: {
  recipe: Recipe;
  onChange: (r: Recipe, proxy?: boolean) => void;
  /** Layers at the end of the chain (from the last run). */
  layers: LayerInfo[];
  /** Line layers in their current pass order (from the last plot). */
  passes: Array<{ id: string; name: string }>;
  working: { width: number; height: number; mmPerPx: number } | null;
}) {
  const { recipe: r, onChange } = props;
  const set = (patch: Partial<Recipe>, proxy = false) => onChange({ ...r, ...patch }, proxy);
  const setInk = (i: number, patch: Partial<Ink>, proxy = false) =>
    set({ inks: r.inks.map((ink, j) => (j === i ? { ...ink, ...patch } : ink)) }, proxy);
  const setTarget = (kind: TargetKind) => {
    const dpi = "dpi" in r.target ? r.target.dpi : 300;
    const fin = finishing(r.target);
    const keep = { ...(fin.mirror ? { mirror: true } : {}), ...(fin.registration ? { registration: true } : {}) };
    const t: Target =
      kind === "raster" ? { kind, dpi } : kind === "print" ? { kind, dpi: Math.max(dpi, 600), ...DEFAULT_PRINT, ...keep } : kind === "plotter" ? { kind, ...keep } : { kind };
    set({ target: t });
  };
  const paperName =
    Object.entries(PAPERS).find(([, p]) => Math.min(p.widthMm, p.heightMm) === Math.min(r.paper.widthMm, r.paper.heightMm))?.[0] ?? "";
  const landscape = r.paper.widthMm > r.paper.heightMm;
  const movePass = (i: number, d: -1 | 1) => {
    const ids = props.passes.map((p) => p.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    set({ passOrder: ids });
  };

  return (
    <div className="project">
      <details open>
        <summary>Output</summary>
        <div className="target-grid" role="radiogroup" aria-label="Output target">
          {TARGETS.map((t) => (
            <button key={t.kind} role="radio" aria-checked={r.target.kind === t.kind} className={r.target.kind === t.kind ? "on" : ""} title={t.hint} onClick={() => setTarget(t.kind)}>
              {t.label}
            </button>
          ))}
        </div>
        <p className="hint">{TARGETS.find((t) => t.kind === r.target.kind)?.hint}</p>
        {"dpi" in r.target && (
          <div className="param">
            <label>Resolution</label>
            <div className="param-row">
              <input
                className="num"
                type="number"
                min={30}
                max={2400}
                step={10}
                value={r.target.dpi}
                onChange={(e) => Number(e.target.value) > 0 && set({ target: { ...r.target, dpi: Number(e.target.value) } as Target })}
              />
              <span className="unit">dpi</span>
            </div>
          </div>
        )}
        {r.target.kind === "print" && (
          <>
            <div className="param">
              <label title="1-bit: each pixel is ink or no ink, which is what riso, screen and film need. Gray keeps density for processes that take it.">Plates</label>
              <div className="param-row">
                <select value={r.target.mode} onChange={(e) => set({ target: { ...r.target, mode: e.target.value as "bitmap" | "gray" } as Target })}>
                  <option value="bitmap">1-bit (ink or no ink)</option>
                  <option value="gray">Gray (density)</option>
                </select>
              </div>
            </div>
            {r.target.mode === "bitmap" && (
              <div className="param">
                <label title="A grid of dots whose size follows the tone. Without it, tone is cut at 50%. Coarser screens (fewer lines per inch) are easier to print.">
                  <input
                    type="checkbox"
                    checked={r.target.halftone !== null}
                    onChange={(e) => set({ target: { ...r.target, halftone: e.target.checked ? { lpi: 45, angles: {} } : null } as Target })}
                  />{" "}
                  Halftone screen
                </label>
                {r.target.halftone && (
                  <div className="param-row">
                    <input
                      className="num"
                      type="number"
                      min={5}
                      max={200}
                      step={5}
                      value={r.target.halftone.lpi}
                      onChange={(e) => Number(e.target.value) > 0 && set({ target: { ...r.target, halftone: { ...(r.target as PrintTarget).halftone!, lpi: Number(e.target.value) } } as Target })}
                    />
                    <span className="unit">lines per inch; angle per ink below</span>
                  </div>
                )}
              </div>
            )}
            <label className="toggle" title="Ink areas clear and the rest black, for processes that expose through a negative.">
              <input type="checkbox" checked={r.target.negative} onChange={(e) => set({ target: { ...r.target, negative: e.target.checked } as Target })} /> Film negative
            </label>
          </>
        )}
        {(r.target.kind === "plotter" || r.target.kind === "print") && (
          <>
            <label className="toggle" title="Flip left-right: for screens and plates printed face down, or transfers.">
              <input type="checkbox" checked={!!r.target.mirror} onChange={(e) => set({ target: { ...r.target, mirror: e.target.checked } as Target })} /> Mirror
            </label>
            <label className="toggle" title="Circle-and-cross marks at the middle of each edge, on every plate or pass, so the inks line up.">
              <input type="checkbox" checked={!!r.target.registration} onChange={(e) => set({ target: { ...r.target, registration: e.target.checked } as Target })} /> Registration marks
            </label>
            {r.target.registration && r.layout.marginMm < MARK_INSET_MM * 2 && (
              <p className="hint">The marks sit {MARK_INSET_MM} mm from the paper edge; with a margin under {MARK_INSET_MM * 2} mm they may touch the art.</p>
            )}
          </>
        )}
      </details>

      <details open>
        <summary>Paper</summary>
        <div className="param-row">
          <select
            value={paperName}
            onChange={(e) => {
              const p = PAPERS[e.target.value]!;
              set({ paper: landscape ? { widthMm: p.heightMm, heightMm: p.widthMm } : p });
            }}
          >
            {!paperName && <option value="">Custom</option>}
            {Object.keys(PAPERS).map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
          <button onClick={() => set({ paper: { widthMm: r.paper.heightMm, heightMm: r.paper.widthMm } })}>{landscape ? "Landscape" : "Portrait"} ⟲</button>
          <span className="unit">
            {r.paper.widthMm} × {r.paper.heightMm} mm
          </span>
        </div>
        <div className="param">
          <label title="Fit shows the whole image; Fill covers the area inside the margins and crops the rest.">Placement</label>
          <div className="param-row">
            <select value={r.layout.fit} onChange={(e) => set({ layout: { ...r.layout, fit: e.target.value as "fit" | "fill" } })}>
              <option value="fit">Fit (whole image)</option>
              <option value="fill">Fill (crop to margins)</option>
            </select>
            <div className="anchor" role="group" aria-label={r.layout.fit === "fit" ? "Where the image sits" : "Which part is kept"}>
              {ANCHORS.map(([x, y]) => (
                <button
                  key={`${x},${y}`}
                  className={r.layout.position[0] === x && r.layout.position[1] === y ? "on" : ""}
                  aria-label={`anchor ${x},${y}`}
                  onClick={() => set({ layout: { ...r.layout, position: [x, y] } })}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="param">
          <label>Margin</label>
          <div className="param-row">
            <input
              type="range"
              min={0}
              max={Math.floor(Math.min(r.paper.widthMm, r.paper.heightMm) / 2) - 1}
              step={1}
              value={r.layout.marginMm}
              onChange={(e) => set({ layout: { ...r.layout, marginMm: Number(e.target.value) } }, true)}
              onPointerUp={() => set({})}
            />
            <input className="num" type="number" min={0} value={r.layout.marginMm} onChange={(e) => set({ layout: { ...r.layout, marginMm: Math.max(0, Number(e.target.value)) } })} />
            <span className="unit">mm</span>
          </div>
        </div>
        <div className="param">
          <label title="How fine the image is sampled before the steps run. Automatic: half the narrowest ink for plotters and vectors, the DPI for images.">
            Working detail
          </label>
          <div className="param-row">
            <input
              className="num"
              type="number"
              min={0.01}
              max={5}
              step={0.01}
              placeholder="auto"
              value={r.workingMmPerPx ?? ""}
              onChange={(e) => set({ workingMmPerPx: e.target.value === "" || Number(e.target.value) <= 0 ? null : Number(e.target.value) })}
            />
            <span className="unit">mm/px</span>
            {r.workingMmPerPx !== null && <button onClick={() => set({ workingMmPerPx: null })}>Automatic</button>}
          </div>
          {props.working && (
            <p className="hint">
              Working at {props.working.mmPerPx.toFixed(3)} mm per pixel ({props.working.width} × {props.working.height} px)
            </p>
          )}
        </div>
      </details>

      <details open>
        <summary>Inks</summary>
        {r.inks.map((ink, i) => (
          <div key={ink.id} className="ink-row">
            <input type="color" value={ink.color} aria-label={`${ink.name} colour`} onChange={(e) => setInk(i, { color: e.target.value }, true)} onBlur={() => set({})} />
            <input className="ink-name" value={ink.name} aria-label="Ink name" onChange={(e) => setInk(i, { name: e.target.value })} />
            <input
              className="num"
              type="number"
              min={0.05}
              max={10}
              step={0.05}
              value={ink.widthMm}
              title={r.target.kind === "plotter" ? "Pen width" : "Line width"}
              onChange={(e) => Number(e.target.value) > 0 && setInk(i, { widthMm: Number(e.target.value) })}
            />
            <span className="unit">mm</span>
            <select value={ink.mix} title="Multiply: overlapping inks darken like real ink. Normal: the top ink covers." onChange={(e) => setInk(i, { mix: e.target.value as Ink["mix"] })}>
              <option value="multiply">Multiply</option>
              <option value="normal">Normal</option>
            </select>
            <button
              className="icon"
              disabled={r.inks.length < 2}
              aria-label={`Remove ${ink.name}`}
              onClick={() => {
                const inks = r.inks.filter((_, j) => j !== i);
                const layerInks = Object.fromEntries(Object.entries(r.layerInks).filter(([, v]) => v !== ink.id));
                set({ inks, layerInks });
              }}
            >
              ✕
            </button>
            {r.target.kind === "print" && r.target.mode === "bitmap" && r.target.halftone && (
              <span className="ink-angle">
                Screen angle
                <input
                  className="num"
                  type="number"
                  min={0}
                  max={180}
                  step={7.5}
                  title="Screen angle. Different angles per ink keep the dot grids from beating against each other (moiré)."
                  aria-label={`${ink.name} screen angle`}
                  value={screenAngle(r.target.halftone, ink.id, i)}
                  onChange={(e) => {
                    const h = (r.target as PrintTarget).halftone!;
                    set({ target: { ...r.target, halftone: { ...h, angles: { ...h.angles, [ink.id]: Number(e.target.value) } } } as Target });
                  }}
                />
                <span className="unit">°</span>
              </span>
            )}
          </div>
        ))}
        <button onClick={() => set({ inks: [...r.inks, { id: newInkId(r.inks), name: `Ink ${r.inks.length + 1}`, color: "#2f5d8a", mix: "multiply", widthMm: r.inks[0]?.widthMm ?? 0.5 }] })}>
          + Add ink
        </button>
        {props.layers.length > 0 && (
          <div className="param">
            <label>Which ink each layer uses</label>
            {props.layers.map((l) => (
              <div key={l.id} className="param-row">
                <span className="layer-name">{l.name}</span>
                <select
                  value={r.layerInks[l.id] ?? r.inks[0]!.id}
                  onChange={(e) => set({ layerInks: { ...r.layerInks, [l.id]: e.target.value } })}
                >
                  {r.inks.map((ink) => (
                    <option key={ink.id} value={ink.id}>
                      {ink.name}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
      </details>

      {r.target.kind === "plotter" && props.passes.length > 1 && (
        <details open>
          <summary>Pass order</summary>
          <p className="hint">Each ink is one pass, with a pen change between passes. Light inks usually go first.</p>
          {props.passes.map((p, i) => (
            <div key={p.id} className="param-row pass">
              <span className="swatch" style={{ background: r.inks.find((k) => k.id === (r.layerInks[p.id] ?? r.inks[0]!.id))?.color }} />
              <span className="layer-name">
                {i + 1}. {p.name}
              </span>
              <button className="icon" disabled={i === 0} aria-label={`Move ${p.name} earlier`} onClick={() => movePass(i, -1)}>
                ↑
              </button>
              <button className="icon" disabled={i === props.passes.length - 1} aria-label={`Move ${p.name} later`} onClick={() => movePass(i, 1)}>
                ↓
              </button>
            </div>
          ))}
          {Array.isArray(r.passOrder) && <button onClick={() => set({ passOrder: "light-to-dark" })}>Light → dark</button>}
        </details>
      )}
    </div>
  );
}

