import { resolveParams } from "./params.ts";
import type { StepRegistry } from "./step.ts";
import type { Paper, Pen, StageKind } from "./types.ts";

/** Bump when the recipe envelope changes shape. Add an upgrader to `UPGRADERS`. */
export const RECIPE_SCHEMA_VERSION = 1;

export interface RecipeStep {
  step: string;
  version: number;
  params: Record<string, unknown>;
  /** Disabled steps are skipped but kept in the recipe. */
  enabled?: boolean;
}

/**
 * The central artifact. The pipeline is a pure function of (source, recipe).
 */
export interface Recipe {
  schemaVersion: number;
  /** Which stage the source enters at (an SVG enters at geometry, separations at layers). */
  input: StageKind;
  paper: Paper;
  pens: Pen[];
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

const UPGRADERS: Record<number, (r: Record<string, unknown>) => Record<string, unknown>> = {
  // 1: (r) => ({ ...r, schemaVersion: 2, ... }),
};

/**
 * Parse and validate a recipe. Old schema/step versions are upgraded with a warning;
 * unknown steps, future versions and type mismatches between steps are errors.
 */
export function loadRecipe(raw: unknown, registry: StepRegistry): { recipe: Recipe; warnings: RecipeWarning[] } {
  if (typeof raw !== "object" || raw === null) throw new RecipeError("recipe must be a JSON object");
  let r = raw as Record<string, unknown>;
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
  const pens = (Array.isArray(r.pens) ? r.pens : []) as Pen[];
  if (pens.length === 0) errors.push({ index: -1, message: "at least one pen is required" });
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
    if (version < def.version) {
      if (def.migrate) {
        const m = def.migrate(params, version);
        params = m.params;
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
    steps.push({ step: def.id, version, params: values, enabled });
  });

  if (errors.length) throw new RecipeError("invalid recipe", errors);
  return {
    recipe: {
      schemaVersion: RECIPE_SCHEMA_VERSION,
      input,
      paper: paper as Paper,
      pens,
      machine: typeof r.machine === "string" ? r.machine : "generic",
      steps,
    },
    warnings,
  };
}
