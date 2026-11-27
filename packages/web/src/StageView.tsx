import { useEffect, useState } from "react";
import type { Paper, Plot, Position } from "@plotlab/engine";
import type { RasterView } from "./protocol.ts";
import { drawOrder, type DrawOptions } from "./inkview.ts";

/** An object URL for a PNG blob, revoked when it changes or unmounts. */
export function useBlobUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return setUrl(undefined);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

function Raster(props: { view: RasterView; opacity?: number; mix?: "multiply" | "normal"; faint?: boolean }) {
  const { view: v } = props;
  const url = useBlobUrl(v.png);
  if (!url) return null;
  return (
    <image
      href={url}
      x={v.frame.xMm}
      y={v.frame.yMm}
      width={v.frame.widthMm}
      height={v.frame.heightMm}
      preserveAspectRatio="none"
      opacity={props.opacity ?? 1}
      data-ink={v.color !== null ? v.id : undefined}
      data-faint={props.faint || undefined}
      // Working pixels stay crisp; the export proof is finer than the screen, so it is smoothed.
      style={{ mixBlendMode: (props.mix ?? v.mix) === "multiply" ? "multiply" : "normal", imageRendering: v.id === "proof" ? "auto" : "pixelated" }}
    />
  );
}

/**
 * A stroke's SVG path, kept per stroke array: the plot-order animation redraws every frame,
 * and the strokes it has finished are the plot's own arrays, so only the cut one is new.
 */
const dCache = new WeakMap<Position[], string>();
const pathD = (p: Position[]) => {
  let d = dCache.get(p);
  if (d === undefined) dCache.set(p, (d = p.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join("")));
  return d;
};

/** The CMYK views' drawing options (`inkview.ts`): one ink on top with the others faint, opaque inks in pass order. */
export type InkDraw = Omit<DrawOptions, "hidden">;

/** How faint the other inks are under the one being looked at. */
const FAINT = 0.22;

/** What's on the paper (mm units): optional dimmed source, then rasters, then lines (`drawOrder`). Compare stages draws one per strip. */
export function StageLayers(props: { rasters: RasterView[]; plot: Plot | null; showTravel: boolean; underlay: RasterView | null; hidden: ReadonlySet<string>; inks?: InkDraw }) {
  const { plot } = props;
  const lines = plot?.layers.map((l) => ({ id: l.id, mix: l.ink.mix === "multiply" ? ("multiply" as const) : ("normal" as const) })) ?? [];
  const items = drawOrder(props.rasters, lines, { ...props.inks, hidden: props.hidden });
  return (
    <>
      {props.underlay && <Raster view={props.underlay} opacity={0.25} />}
      <g style={{ isolation: "isolate" }}>
        {items.map((d) => {
          const opacity = d.faint ? FAINT : undefined;
          if (d.kind === "raster") {
            const r = props.rasters.find((x) => x.id === d.id)!;
            return <Raster key={`r:${d.id}`} view={r} opacity={opacity} mix={d.mix} faint={d.faint} />;
          }
          const l = plot!.layers.find((x) => x.id === d.id)!;
          return (
            <g key={`l:${d.id}`} data-ink={d.id} data-faint={d.faint || undefined} opacity={opacity} style={{ mixBlendMode: d.mix }}>
              <path d={l.paths.map(pathD).join("")} fill="none" stroke={l.ink.color} strokeWidth={l.ink.widthMm} strokeLinecap="round" strokeLinejoin="round" />
              {props.showTravel && !d.faint && (
                <path
                  d={l.paths
                    .map((p, i) => {
                      const from = i === 0 ? ([0, 0] as Position) : l.paths[i - 1]![l.paths[i - 1]!.length - 1]!;
                      return `M${from[0]} ${from[1]}L${p[0]![0]} ${p[0]![1]}`;
                    })
                    .join("")}
                  className="travel"
                />
              )}
            </g>
          );
        })}
      </g>
    </>
  );
}

/**
 * The paper in mm: optional dimmed source underneath, then rasters (image or layers,
 * composited with each ink's mix mode), then lines at their real ink width.
 */
export function StageView(props: {
  paper: Paper;
  rasters: RasterView[];
  plot: Plot | null;
  showTravel: boolean;
  underlay: RasterView | null;
  hidden: ReadonlySet<string>;
  inks?: InkDraw;
  empty?: string;
  /** Where the pen is in the plot-order animation, in its ink's colour. */
  head?: { at: Position; color: string } | null;
}) {
  const { paper, plot } = props;
  const { widthMm: w, heightMm: h } = paper;
  const nothing = !props.rasters.length && !plot;
  return (
    <svg className="preview" viewBox={`-5 -5 ${w + 10} ${h + 10}`} preserveAspectRatio="xMidYMid meet">
      <rect x={0} y={0} width={w} height={h} className="paper" />
      <StageLayers rasters={props.rasters} plot={plot} showTravel={props.showTravel} underlay={props.underlay} hidden={props.hidden} inks={props.inks} />
      {props.head && <circle className="pen-head" cx={props.head.at[0]} cy={props.head.at[1]} r={Math.max(1.5, Math.min(w, h) / 120)} fill={props.head.color} />}
      {nothing && props.empty && (
        <text x={w / 2} y={h / 2} textAnchor="middle" className="empty-text">
          {props.empty}
        </text>
      )}
    </svg>
  );
}
