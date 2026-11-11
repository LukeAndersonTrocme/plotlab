import { useEffect, useState } from "react";
import type { Paper, Plot, Position } from "@plotlab/engine";
import type { RasterView } from "./protocol.ts";

/** An object URL for a PNG blob, revoked when it changes or unmounts. */
function useBlobUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) return setUrl(undefined);
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob]);
  return url;
}

function Raster(props: { view: RasterView; opacity?: number }) {
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
      style={{ mixBlendMode: v.mix === "multiply" ? "multiply" : "normal", imageRendering: "pixelated" }}
    />
  );
}

const pathD = (p: Position[]) => p.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join("");

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
  hidden: Set<string>;
  empty?: string;
}) {
  const { paper, plot } = props;
  const { widthMm: w, heightMm: h } = paper;
  const nothing = !props.rasters.length && !plot;
  return (
    <svg className="preview" viewBox={`-5 -5 ${w + 10} ${h + 10}`} preserveAspectRatio="xMidYMid meet">
      <rect x={0} y={0} width={w} height={h} className="paper" />
      {props.underlay && <Raster view={props.underlay} opacity={0.25} />}
      <g style={{ isolation: "isolate" }}>
        {props.rasters.filter((r) => !props.hidden.has(r.id)).map((r) => (
          <Raster key={r.id} view={r} />
        ))}
        {plot?.layers
          .filter((l) => !props.hidden.has(l.id))
          .map((l) => (
            <g key={l.id} style={{ mixBlendMode: l.ink.mix === "multiply" ? "multiply" : "normal" }}>
              <path d={l.paths.map(pathD).join("")} fill="none" stroke={l.ink.color} strokeWidth={l.ink.widthMm} strokeLinecap="round" strokeLinejoin="round" />
              {props.showTravel && (
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
          ))}
      </g>
      {nothing && props.empty && (
        <text x={w / 2} y={h / 2} textAnchor="middle" className="empty-text">
          {props.empty}
        </text>
      )}
    </svg>
  );
}
