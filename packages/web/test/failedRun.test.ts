import { describe, expect, it } from "vitest";
import { failedRunCue } from "../src/failedRun.ts";

describe("failedRunCue", () => {
  it("is null while the run is fine", () => {
    expect(failedRunCue({ error: null, hasPicture: true })).toBeNull();
  });
  it("dims the last good picture and says what went wrong in plain words", () => {
    const cue = failedRunCue({ error: { message: "Centerline traces tone layers.", index: 2 }, hasPicture: true });
    expect(cue).toEqual({ dim: true, message: "This recipe can't run, so this is the last plot that did. Centerline traces tone layers." });
  });
  it("shows the message without dimming when there is no earlier picture", () => {
    const cue = failedRunCue({ error: { message: "Nope." }, hasPicture: false });
    expect(cue).toEqual({ dim: false, message: "This recipe can't run. Nope." });
  });
});
