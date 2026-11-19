import type { PlotEstimate } from "./estimate.ts";

/** Where a plot's time goes: pen-down drawing, pen-up travel, pen lifts, pen changes. */
export type TimeComponent = "draw" | "travel" | "pen" | "penChanges";

export interface BudgetCheck {
  /** Strictly over: an estimate exactly at the budget is within it. */
  over: boolean;
  /** Estimate ÷ budget. */
  ratio: number;
  /** The component that takes the most time. */
  dominant: TimeComponent;
  /** One sentence for the readout; when over, it says what to change. */
  message: string;
}

const SUGGEST: Record<TimeComponent, string> = {
  draw: "most time is drawing — try wider Fill spacing or fewer bands",
  travel: "most time is pen-up travel — add or tune the Stroke order step",
  pen: "most time is lifting and lowering the pen — fewer, longer strokes help (raise Centerline's minimum length, or simplify)",
  penChanges: "most time is pen changes — try fewer inks",
};

/** The budget as entered: `String` drops trailing zeros and never rounds. */
const fmtMin = (m: number) => `${String(m)} min`;

/** Time split of an estimate, summed over passes. */
export function timeBreakdown(e: PlotEstimate): Record<TimeComponent, number> {
  const sum = (k: "drawS" | "travelS" | "penS") => e.passes.reduce((t, p) => t + p[k], 0);
  return { draw: sum("drawS"), travel: sum("travelS"), pen: sum("penS"), penChanges: e.penChangeS };
}

/**
 * Compare a time estimate with a budget in minutes. Advisory only: it never changes
 * parameters, it says which part of the plot to work on.
 */
export function budgetCheck(e: PlotEstimate, budgetMin: number): BudgetCheck {
  const ratio = e.totalS / (budgetMin * 60);
  const parts = timeBreakdown(e);
  const dominant = (Object.keys(parts) as TimeComponent[]).reduce((a, b) => (parts[b] > parts[a] ? b : a));
  const over = ratio > 1;
  const budget = `${fmtMin(budgetMin)} budget`;
  let message: string;
  if (!over) message = `within the ${budget} (${ratio < 0.005 ? "<1" : Math.round(ratio * 100)}%)`;
  else {
    const by = ratio >= 2 ? `about ${Number(ratio.toFixed(1))}× the ${budget}` : `about ${Math.max(1, Math.round((ratio - 1) * 100))}% over the ${budget}`;
    message = `${by}; ${SUGGEST[dominant]}`;
  }
  return { over, ratio, dominant, message };
}
