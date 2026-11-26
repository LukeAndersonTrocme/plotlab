import { describe, expect, it } from "vitest";
import type { Recipe } from "@plotlab/engine";
import { getMachine } from "@plotlab/machines";
import { defaultRecipe } from "../src/defaults.ts";
import { fmtTime, paperName, setupSummary } from "../src/setup.ts";

const recipe = (patch: Partial<Recipe> = {}): Recipe => ({ ...defaultRecipe(), ...patch });

describe("setup chip summary", () => {
  it("names the paper, pens, machine profile and time estimate for a plotter", () => {
    const s = setupSummary(recipe(), { totalS: 754 });
    expect(s.paper).toBe("A4");
    expect(s.orientation).toBe("landscape");
    expect(s.pens).toBe("1 pen");
    expect(s.colors).toEqual(["#1a1a1a"]);
    expect(s.machine).toBe(getMachine("generic").name);
    expect(s.time).toBe("~13 min");
  });

  it("leaves the time out until there is an estimate", () => {
    expect(setupSummary(recipe(), null).time).toBeNull();
  });

  it("says inks and the output target when it isn't a plotter, with no time", () => {
    const r = recipe({
      target: { kind: "raster", dpi: 300 },
      paper: { widthMm: 210, heightMm: 297 },
      inks: [
        { id: "a", name: "Red", color: "#c00", mix: "multiply", widthMm: 0.5 },
        { id: "b", name: "Blue", color: "#00c", mix: "multiply", widthMm: 0.5 },
      ],
    });
    const s = setupSummary(r, { totalS: 60 });
    expect(s.paper).toBe("A4");
    expect(s.orientation).toBe("portrait");
    expect(s.pens).toBe("2 inks");
    expect(s.machine).toBe("Digital image");
    expect(s.time).toBeNull();
  });

  it("gives custom paper in mm", () => {
    expect(paperName({ widthMm: 200, heightMm: 200 })).toBeNull();
    const s = setupSummary(recipe({ paper: { widthMm: 200, heightMm: 300 } }), null);
    expect(s.paper).toBe("200 × 300 mm");
    expect(s.orientation).toBeNull();
  });

  it("formats times as seconds, minutes, then hours", () => {
    expect(fmtTime(42)).toBe("42 s");
    expect(fmtTime(600)).toBe("10 min");
    expect(fmtTime(3900)).toBe("1 h 5 min");
  });
});
