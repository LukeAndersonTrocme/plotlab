import type { RecipeStep } from "./recipe.ts";
import type { AnyStep } from "./step.ts";
import type { StageKind } from "./types.ts";

/**
 * Where a chain is between steps (ADR 0009): its kind of data, and, once it has lines, whether
 * some layers may still be layers (a line step that took only some of them, leaving the rest
 * to ride along). Those can still go through layer steps, so each ink can have its own line
 * step: pixelated magenta, stippled yellow.
 */
export interface ChainStage {
  kind: StageKind;
  layersLeft: boolean;
}

export const stageOf = (kind: StageKind): ChainStage => ({ kind, layersLeft: false });

/** Whether a step can take what the chain has here. */
export function fitsStage(stage: ChainStage, def: AnyStep): boolean {
  if (def.input === stage.kind) return true;
  return !!def.runLayer && def.input === "layers" && stage.kind === "geometry" && stage.layersLeft;
}

/** Where the chain is after the (switched-on) step `rs`. */
export function stageAfter(stage: ChainStage, def: AnyStep, rs: Pick<RecipeStep, "layers">): ChainStage {
  const narrowed = Array.isArray(rs.layers);
  if (def.runLayer && stage.kind === "geometry") return { kind: "geometry", layersLeft: def.output === "layers" || narrowed };
  if (def.runLayer && def.output === "geometry") return { kind: "geometry", layersLeft: narrowed };
  if (stage.kind === "geometry" && def.output === "geometry") return stage;
  return stageOf(def.output as StageKind);
}
