/**
 * Machine profile: everything the pipeline needs to know about a plotter.
 * A new plotter = a new profile JSON, plus at most a small driver for its protocol.
 * Kept protocol-agnostic on purpose; the purchase isn't decided yet.
 */
export type Protocol = "svg" | "gcode-grbl" | "hpgl" | "ebb";

export interface MachineProfile {
  id: string;
  name: string;
  /** Drawable area in mm. */
  bed: { widthMm: number; heightMm: number };
  /** Where the machine's (0,0) is relative to the paper as seen in the preview. */
  origin: "top-left" | "bottom-left";
  pen: {
    /** Time to lift / lower the pen, seconds. */
    upS: number;
    downS: number;
    /** Manual pen change between layers, seconds (used in time estimates only). */
    changeS: number;
  };
  motion: {
    drawMmS: number;
    travelMmS: number;
    /** Acceleration used for trapezoidal move timing. */
    accelMmS2: number;
    /**
     * Fraction of draw speed kept through a corner (0 = full stop at every vertex,
     * 1 = no slowdown). Crude stand-in for junction deviation / lookahead.
     */
    cornerSpeedFactor: number;
  };
  protocol: Protocol;
}
