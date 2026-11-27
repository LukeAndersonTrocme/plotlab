import { inkFor, renderInkThumbnail, renderLaneThumbnail, renderThumbnail, type Recipe, type StageData } from "@plotlab/engine";

/**
 * Thumbnails of stage data as PNG blobs (the step strip; meant for the preset gallery and
 * checkpoint pictures too). Runs wherever OffscreenCanvas does, the pipeline worker in
 * practice. Renders are cached per output object: the pipeline hands back the same object
 * for a step whose inputs didn't change, so only changed steps are drawn again.
 */
export class ThumbnailRenderer {
  private cache = new WeakMap<object, Map<string, Promise<Blob>>>();

  /** Forget every render (a new source). */
  reset(): void {
    this.cache = new WeakMap();
  }

  /** True when this exact picture is already rendered (or on its way). */
  has(data: StageData, recipe: Recipe, side: number, lanes?: Lanes): boolean {
    return this.cache.get(data)?.has(key(recipe, side, lanes)) ?? false;
  }

  /**
   * `lanes`: draw each of these layers alone, as a 2×2 (a step in the linked CMYK lanes), or
   * one layer id: only that ink (a step in an independent lane).
   */
  png(data: StageData, recipe: Recipe, side: number, lanes?: Lanes): Promise<Blob> {
    let m = this.cache.get(data);
    if (!m) this.cache.set(data, (m = new Map()));
    const k = key(recipe, side, lanes);
    let p = m.get(k);
    if (!p) {
      const s = { paper: recipe.paper, inks: recipe.inks, inkFor: (id: string) => inkFor(recipe, id), passOrder: recipe.passOrder };
      const t = typeof lanes === "string" ? renderInkThumbnail(data, s, side, lanes) : lanes ? renderLaneThumbnail(data, s, side, lanes) : renderThumbnail(data, s, side);
      const c = new OffscreenCanvas(t.width, t.height);
      c.getContext("2d")!.putImageData(new ImageData(t.rgba, t.width, t.height), 0, 0);
      p = c.convertToBlob({ type: "image/png" });
      m.set(k, p);
    }
    return p;
  }
}

/** Layers as a 2×2, or one ink alone. */
type Lanes = string[] | string;

/** Everything besides the data that changes the picture. */
const key = (r: Recipe, side: number, lanes?: Lanes) => JSON.stringify([side, r.paper, r.inks, r.layerInks, r.passOrder, lanes ?? null]);
