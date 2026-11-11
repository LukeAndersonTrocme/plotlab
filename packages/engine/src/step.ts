import type { ParamDecls, ParamValues } from "./params.ts";
import type { PassOrder, Target } from "./project.ts";
import type { Frame, GeometryLayer, Ink, Layer, LayerValueKind, Paper, StageDataOf, StageKind } from "./types.ts";

/**
 * Cost hint for the UI. `live` steps recompute while a slider is dragged; `on-demand`
 * steps show an Update button. A global Live/Manual toggle overrides it.
 */
export type StepCost = "live" | "on-demand";

/** What a step can see besides its input: project-level settings from the recipe. */
export interface StepContext {
  paper: Paper;
  target: Target;
  inks: Ink[];
  /**
   * The ink for a layer id. Only steps that output a plot should depend on inks: the
   * pipeline leaves ink changes out of other steps' cache keys so recolouring is instant.
   */
  inkFor(layerId: string): Ink;
  passOrder: PassOrder;
  /** Report progress 0..1 for slow steps. */
  progress?: (fraction: number) => void;
}

/** The pixel grid all layers of a Layers value share. */
export interface Grid {
  width: number;
  height: number;
  frame: Frame;
}

/** What a layer-acting step returns for one layer. */
export type LayerOutOf<O extends StageKind> = O extends "layers" ? Layer : O extends "geometry" ? GeometryLayer : never;

export interface StepDefinition<
  I extends StageKind = StageKind,
  O extends StageKind = StageKind,
  D extends ParamDecls = ParamDecls,
> {
  /** Stable id used in recipes and on the CLI. */
  id: string;
  /** Bump when output for the same params changes. Provide `migrate` for param changes. */
  version: number;
  title: string;
  /** One-line summary (tooltip, `steps list`). */
  summary: string;
  input: I;
  output: O;
  cost: StepCost;
  params: D;
  /** Long-form help (markdown): analog history, what the sliders do physically. */
  help: string;
  /** Whole-stage steps implement `run`. */
  run?(input: StageDataOf<I>, params: ParamValues<D>, ctx: StepContext): StageDataOf<O> | Promise<StageDataOf<O>>;
  /**
   * Layer-acting steps (input "layers") implement `runLayer` instead. The engine applies
   * it to the selected layers with their per-layer params and passes the rest through
   * (ADR 0009).
   */
  runLayer?(layer: Layer, params: ParamValues<D>, ctx: StepContext, grid: Grid): LayerOutOf<O> | Promise<LayerOutOf<O>>;
  /** Layer value kinds `runLayer` can handle (default: both). */
  accepts?: LayerValueKind[];
  /**
   * Upgrade params written for an older version. Return the new params plus a
   * human-readable note shown as a warning.
   */
  migrate?(params: Record<string, unknown>, fromVersion: number): { params: Record<string, unknown>; note: string };
}

/** Identity helper that keeps the generic types inferred. */
export function defineStep<I extends StageKind, O extends StageKind, D extends ParamDecls>(
  def: StepDefinition<I, O, D>,
): StepDefinition<I, O, D> {
  if (!def.run === !def.runLayer) throw new Error(`step "${def.id}" must define exactly one of run / runLayer`);
  if (def.runLayer && (def.input !== "layers" || (def.output !== "layers" && def.output !== "geometry"))) {
    throw new Error(`step "${def.id}": runLayer needs layers → layers or layers → lines`);
  }
  return def;
}

// The registry erases per-step generics; validation happens through `resolveParams`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyStep = StepDefinition<any, any, any>;

export class StepRegistry {
  private steps = new Map<string, AnyStep>();
  constructor(steps: AnyStep[] = []) {
    for (const s of steps) this.register(s);
  }
  register(step: AnyStep): void {
    if (this.steps.has(step.id)) throw new Error(`step "${step.id}" registered twice`);
    this.steps.set(step.id, step);
  }
  get(id: string): AnyStep | undefined {
    return this.steps.get(id);
  }
  list(): AnyStep[] {
    return [...this.steps.values()];
  }
}
