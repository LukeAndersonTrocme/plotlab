import type { RecipeStep } from "./recipe.ts";
import type { AnyStep } from "./step.ts";
import type { StageKind } from "./types.ts";

/**
 * Where a chain is between steps (ADR 0009): its kind of data and, when they are known, the
 * ids of the layers that are still layers. Layer ids are known after a step that declares its
 * layers (Separate CMYK's C, M, Y, K, through `layerInks`). Once the chain has lines, a layer
 * step can still work on the layers a line step left (one that named only some of them), so
 * each ink can have its own line step: pixelated magenta, stippled yellow. It must name those
 * layers exactly (a subset of the ones left); with unknown ids nothing follows the lines.
 */
export interface ChainStage {
  kind: StageKind;
  /**
   * The known layer ids still layers: at the layers stage, every layer; once there are lines,
   * the ones a line step left. Null when unknown (a single-layer step, a layers source).
   */
  layers: string[] | null;
}

export const stageOf = (kind: StageKind): ChainStage => ({ kind, layers: null });

const selector = (rs: Pick<RecipeStep, "layers">) => (Array.isArray(rs.layers) ? rs.layers : null);
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** A layer step working on lines that still carry layers. */
const onLeftLayers = (stage: ChainStage, def: AnyStep) => !!def.runLayer && def.input === "layers" && stage.kind === "geometry";

/** Why a step can't take what the chain has here (null: it can). `title` and stage words come from the caller. */
export function stageMismatch(stage: ChainStage, def: AnyStep, rs: Pick<RecipeStep, "layers">): "kind" | { reason: string } | null {
  if (def.input === stage.kind) return null;
  if (!onLeftLayers(stage, def)) return "kind";
  const left = stage.layers ?? [];
  if (left.length === 0) return "kind";
  const sel = selector(rs);
  if (!sel) return { reason: `${def.title} acts on every ink, but some are already lines at that point. Name the inks that are still layers (${list(left)}) in "Applies to".` };
  const gone = sel.filter((id) => !left.includes(id));
  if (sel.length === 0 || gone.length) {
    return { reason: `${def.title} needs ${list(sel)} as layers, but at that point only ${list(left)} ${left.length === 1 ? "is" : "are"} still layers; the others are lines. Put it before the line step that takes ${list(gone)}.` };
  }
  return null;
}

/** Whether a step can take what the chain has here. */
export const fitsStage = (stage: ChainStage, def: AnyStep, rs: Pick<RecipeStep, "layers">): boolean => stageMismatch(stage, def, rs) === null;

/** Where the chain is after the (switched-on) step `rs`. */
export function stageAfter(stage: ChainStage, def: AnyStep, rs: Pick<RecipeStep, "layers">): ChainStage {
  const sel = selector(rs);
  if (def.runLayer && def.output === "geometry") {
    // The layers a line step leaves: only knowable when it names them and the ids are known.
    const left = stage.layers && sel ? stage.layers.filter((id) => !sel.includes(id)) : [];
    return { kind: "geometry", layers: left };
  }
  if (def.runLayer || (stage.kind === "geometry" && def.output === "geometry")) return { kind: def.output as StageKind, layers: stage.layers };
  if (def.output === "layers") {
    const declared = Object.keys(def.layerInks ?? {});
    return { kind: "layers", layers: declared.length ? declared : null };
  }
  return stageOf(def.output as StageKind);
}
