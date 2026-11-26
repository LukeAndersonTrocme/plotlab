import type { SetupSummary } from "./setup.ts";
import { MODES, type Mode } from "./view.ts";

/** Design / Page / Plot, in the top bar. */
export function ModeSwitch(props: { mode: Mode; onMode: (m: Mode) => void }) {
  return (
    <nav className="modes" aria-label="Mode">
      {MODES.map((m) => (
        <button key={m.mode} aria-pressed={props.mode === m.mode} title={m.hint} onClick={() => props.onMode(m.mode)}>
          {m.label}
        </button>
      ))}
    </nav>
  );
}

/** Paper · pens · machine · time estimate. Clicking it opens Page mode. */
export function SetupChip(props: { summary: SetupSummary; onOpen: () => void }) {
  const s = props.summary;
  const paper = s.orientation ? `${s.paper} ${s.orientation}` : s.paper;
  return (
    <button className="setup-chip" title={`${[paper, s.pens, s.machine, s.time].filter(Boolean).join(" · ")}. Click to change the paper, pens and machine.`} onClick={props.onOpen}>
      <span className="paper">
        {s.paper}
        {s.orientation && <span className="orientation"> {s.orientation}</span>}
      </span>
      <span className="sep">·</span>
      <span className="dots" aria-hidden="true">
        {s.colors.slice(0, 6).map((c, i) => (
          <span key={i} className="dot" style={{ background: c }} />
        ))}
      </span>
      <span className="pens">{s.pens}</span>
      <span className="sep machine-sep">·</span>
      <span className="machine">{s.machine}</span>
      {s.time && (
        <>
          <span className="sep">·</span>
          <span className="time">{s.time}</span>
        </>
      )}
    </button>
  );
}
