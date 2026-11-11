import type { Plot, Position } from "@plotlab/engine";

/** Paper in mm with strokes at their real pen width. Optional pen-up travel overlay. */
export function PlotPreview(props: { plot: Plot | null; showTravel: boolean }) {
  const { plot } = props;
  if (!plot) return <div className="preview empty">Working…</div>;
  const { widthMm: w, heightMm: h } = plot.paper;
  const d = (p: Position[]) => p.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)} ${y.toFixed(2)}`).join("");
  return (
    <svg className="preview" viewBox={`-5 -5 ${w + 10} ${h + 10}`} preserveAspectRatio="xMidYMid meet">
      <rect x={0} y={0} width={w} height={h} className="paper" />
      {plot.layers.map((l) => (
        <g key={l.id}>
          <path d={l.paths.map(d).join("")} fill="none" stroke={l.pen.color} strokeWidth={l.pen.widthMm} strokeLinecap="round" strokeLinejoin="round" />
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
    </svg>
  );
}
