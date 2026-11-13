import { DEFAULT_LAYOUT, type Layout } from "./layout.ts";
import { resolveParams } from "./params.ts";
import { TARGET_KINDS, type PassOrder, type Target } from "./project.ts";
import type { StepRegistry } from "./step.ts";
import type { Ink, Paper, StageKind } from "./types.ts";

/** Bump when the recipe envelope changes shape. Add an upgrader to `UPGRADERS`. */
export const RECIPE_SCHEMA_VERSION = 2;

export interface RecipeStep {
  step: string;
  version: number;
  params: Record<string, unknown>;
  /** Disabled steps are skipped but kept in the recipe. */
  enabled?: boolean;
  /** Layer-acting steps: which layers to transform ("all" when absent). */
  layers?: "all" | string[];
  /** Layer-acting steps: per-layer overrides of `params`, by layer id. */
  layerParams?: Record<string, Record<string, unknown>>;
}

/**
 * The central artifact. The pipeline is a pure function of (source, recipe).
 * Project settings (target, paper, layout, inks…) live in the envelope; steps are the chain.
 */
export interface Recipe {
  schemaVersion: number;
  /** Which stage the source enters at. Only "image" is supported so far. */
  input: StageKind;
  target: Target;
  paper: Paper;
  layout: Layout;
  /** Working resolution override; null = derive from the target (ADR 0005). */
  workingMmPerPx: number | null;
  inks: Ink[];
  /** Layer id → ink id. Unlisted layers use the first ink. */
  layerInks: Record<string, string>;
  passOrder: PassOrder;
  /** Machine profile id (plotter target). */
  machine: string;
  steps: RecipeStep[];
}

export interface RecipeWarning {
  /** Step index, or -1 for the recipe envelope. */
  index: number;
  message: string;
}

export class RecipeError extends Error {
  constructor(
    message: string,
    public readonly issues: RecipeWarning[] = [],
  ) {
    super(issues.length ? `${message}\n${issues.map((i) => `  - [${i.index}] ${i.message}`).join("\n")}` : message);
  }
}

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Raw) : {});

const UPGRADERS: Record<number, (r: Raw) => Raw> = {
  // v1 → v2: pens become inks; the plot step's margin moves to the project layout and
  // the step itself becomes Stroke order (ADR 0005, 0008, 0011).
  1: (r) => {
    const pens = Array.isArray(r.pens) ? (r.pens as Raw[]) : [];
    let marginMm = DEFAULT_LAYOUT.marginMm;
    const steps = (Array.isArray(r.steps) ? (r.steps as Raw[]) : []).map((s) => {
      if (s.step !== "plot") return s;
      const p = obj(s.params);
      if (typeof p.margin === "number") marginMm = p.margin;
      const params: Raw = { method: p.order ?? "nearest" };
      if (p.allowReverse !== undefined) params.allowReverse = p.allowReverse;
      return { step: "order", version: 1, params, enabled: s.enabled };
    });
    const { pens: _pens, ...rest } = r;
    return {
      ...rest,
      schemaVersion: 2,
      target: { kind: "plotter" },
      layout: { ...DEFAULT_LAYOUT, marginMm },
      inks: pens.map((p) => ({ id: p.id, name: p.id, color: p.color, mix: "multiply", widthMm: p.widthMm })),
      steps,
    };
  },
};

function readTarget(v: unknown, errors: RecipeWarning[]): Target {
  if (v === undefined) return { kind: "plotter" };
  const t = obj(v);
  if (!TARGET_KINDS.includes(t.kind as never)) {
    errors.push({ index: -1, message: `target.kind must be one of ${TARGET_KINDS.join(", ")}` });
    return { kind: "plotter" };
  }
  const dpi = typeof t.dpi === "number" && t.dpi > 0 ? t.dpi : 300;
  const fin = { ...(t.mirror === true ? { mirror: true } : {}), ...(t.registration === true ? { registration: true } : {}) };
  if (t.kind === "raster") return { kind: "raster", dpi };
  if (t.kind === "print") {
    const h = obj(t.halftone);
    const angles: Record<string, number> = {};
    for (const [k, a] of Object.entries(obj(h.angles))) if (typeof a === "number") angles[k] = a;
    const halftone = t.halftone ? { lpi: typeof h.lpi === "number" && h.lpi > 0 ? h.lpi : 45, angles } : null;
    return { kind: "print", dpi, mode: t.mode === "gray" ? "gray" : "bitmap", halftone, negative: t.negative === true, ...fin };
  }
  if (t.kind === "plotter") return { kind: "plotter", ...fin };
  return { kind: "vector" };
}

function readLayout(v: unknown, warnings: RecipeWarning[]): Layout {
  const l = obj(v);
  const out: Layout = { ...DEFAULT_LAYOUT, position: [...DEFAULT_LAYOUT.position] };
  if (l.fit === "fit" || l.fit === "fill") out.fit = l.fit;
  else if (l.fit !== undefined) warnings.push({ index: -1, message: `layout.fit must be "fit" or "fill"; using "fit"` });
  if (typeof l.marginMm === "number" && l.marginMm >= 0) out.marginMm = l.marginMm;
  const p = l.position;
  if (Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === "number")) {
    out.position = [Math.min(1, Math.max(0, p[0] as number)), Math.min(1, Math.max(0, p[1] as number))];
  }
  return out;
}

function readInks(v: unknown, errors: RecipeWarning[]): Ink[] {
  const raw = Array.isArray(v) ? (v as unknown[]) : [];
  if (raw.length === 0) errors.push({ index: -1, message: "at least one ink is required" });
  const inks: Ink[] = [];
  raw.forEach((x, i) => {
    const k = obj(x);
    if (typeof k.id !== "string" || typeof k.color !== "string") {
      errors.push({ index: -1, message: `ink ${i + 1} needs an id and a color` });
      return;
    }
    if (inks.some((o) => o.id === k.id)) errors.push({ index: -1, message: `ink id "${k.id}" is used twice` });
    inks.push({
      id: k.id,
      name: typeof k.name === "string" ? k.name : k.id,
      color: k.color,
      mix: k.mix === "normal" ? "normal" : "multiply",
      widthMm: typeof k.widthMm === "number" && k.widthMm > 0 ? k.widthMm : 0.5,
    });
  });
  return inks;
}

/**
 * Parse and validate a recipe. Old schema/step versions are upgraded with a warning;
 * unknown steps, future versions and type mismatches between steps are errors.
 */
export function loadRecipe(raw: unknown, registry: StepRegistry): { recipe: Recipe; warnings: RecipeWarning[] } {
  if (typeof raw !== "object" || raw === null) throw new RecipeError("recipe must be a JSON object");
  let r = raw as Raw;
  const warnings: RecipeWarning[] = [];
  const errors: RecipeWarning[] = [];

  let v = r.schemaVersion;
  if (typeof v !== "number") throw new RecipeError("recipe is missing a numeric schemaVersion");
  if (v > RECIPE_SCHEMA_VERSION) {
    throw new RecipeError(`recipe schemaVersion ${v} is newer than this build supports (${RECIPE_SCHEMA_VERSION})`);
  }
  while (v < RECIPE_SCHEMA_VERSION) {
    const up = UPGRADERS[v];
    if (!up) throw new RecipeError(`no upgrade path from recipe schemaVersion ${v}`);
    r = up(r);
    warnings.push({ index: -1, message: `upgraded recipe from schemaVersion ${v} to ${v + 1}` });
    v += 1;
  }

  const paper = r.paper as Paper | undefined;
  if (!paper || typeof paper.widthMm !== "number" || typeof paper.heightMm !== "number") {
    errors.push({ index: -1, message: "paper must be { widthMm, heightMm }" });
  }
  const target = readTarget(r.target, errors);
  const layout = readLayout(r.layout, warnings);
  const inks = readInks(r.inks, errors);
  const layerInks: Record<string, string> = {};
  for (const [layer, ink] of Object.entries(obj(r.layerInks))) {
    if (inks.some((i) => i.id === ink)) layerInks[layer] = ink as string;
    else warnings.push({ index: -1, message: `layer "${layer}" points at unknown ink "${String(ink)}"; using the first ink` });
  }
  const passOrder: PassOrder =
    Array.isArray(r.passOrder) && r.passOrder.every((x) => typeof x === "string") ? (r.passOrder as string[]) : "light-to-dark";
  const workingMmPerPx = typeof r.workingMmPerPx === "number" && r.workingMmPerPx > 0 ? r.workingMmPerPx : null;
  const input = (r.input ?? "image") as StageKind;
  const rawSteps = Array.isArray(r.steps) ? (r.steps as unknown[]) : [];

  const steps: RecipeStep[] = [];
  let current: StageKind = input;
  rawSteps.forEach((rs, index) => {
    const s = rs as Partial<RecipeStep>;
    const def = s.step ? registry.get(s.step) : undefined;
    if (!def) {
      errors.push({ index, message: `unknown step "${String(s.step)}"` });
      return;
    }
    let params = (s.params ?? {}) as Record<string, unknown>;
    let version = typeof s.version === "number" ? s.version : def.version;
    if (version > def.version) {
      errors.push({ index, message: `${def.id} v${version} is newer than this build (v${def.version})` });
      return;
    }
    let layerParams = s.layerParams;
    if (version < def.version) {
      if (def.migrate) {
        const m = def.migrate(params, version);
        params = m.params;
        if (layerParams) {
          layerParams = Object.fromEntries(Object.entries(layerParams).map(([k, lp]) => [k, def.migrate!(lp, version).params]));
        }
        warnings.push({ index, message: `${def.id}: upgraded v${version} → v${def.version}. ${m.note}` });
      } else {
        warnings.push({
          index,
          message: `${def.id}: recipe was written for v${version}, running v${def.version}; output may differ`,
        });
      }
      version = def.version;
    }
    const { values, issues } = resolveParams(def.params, params);
    for (const i of issues) warnings.push({ index, message: `${def.id}.${i.param}: ${i.message}` });
    const enabled = s.enabled !== false;
    if (enabled) {
      if (def.input !== current) {
        errors.push({ index, message: `${def.id} expects ${def.input} but receives ${current}` });
      }
      current = def.output;
    }
    const out: RecipeStep = { step: def.id, version, params: values, enabled };
    if (Array.isArray(s.layers) && s.layers.every((x) => typeof x === "string")) out.layers = s.layers;
    if (layerParams && typeof layerParams === "object") {
      out.layerParams = {};
      for (const [layer, lp] of Object.entries(layerParams)) {
        // Overrides keep only the keys they set; validate them against the merged values.
        const merged = resolveParams(def.params, { ...values, ...obj(lp) });
        for (const i of merged.issues) warnings.push({ index, message: `${def.id}.${i.param} (layer "${layer}"): ${i.message}` });
        out.layerParams[layer] = Object.fromEntries(
          Object.keys(obj(lp)).filter((k) => k in def.params).map((k) => [k, (merged.values as Raw)[k]]),
        );
      }
    }
    steps.push(out);
  });

  if (errors.length) throw new RecipeError("invalid recipe", errors);
  return {
    recipe: {
      schemaVersion: RECIPE_SCHEMA_VERSION,
      input,
      target,
      paper: paper as Paper,
      layout,
      workingMmPerPx,
      inks,
      layerInks,
      passOrder,
      machine: typeof r.machine === "string" ? r.machine : "generic",
      steps,
    },
    warnings,
  };
}
