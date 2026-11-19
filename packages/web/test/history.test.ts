import { describe, expect, it } from "vitest";
import { canRedo, canUndo, commit, createHistory, preview, redo, undo } from "../src/history.ts";

describe("history", () => {
  it("a slider drag (many previews, one commit) undoes in one step", () => {
    let h = createHistory({ t: 1 });
    h = preview(h, { t: 2 });
    h = preview(h, { t: 3 });
    h = commit(h, { t: 4 });
    expect(h.present).toEqual({ t: 4 });
    h = undo(h);
    expect(h.present).toEqual({ t: 1 });
    expect(canUndo(h)).toBe(false);
  });

  it("Forward replays an undone change, until a new change replaces it", () => {
    let h = commit(commit(createHistory("a"), "b"), "c");
    h = undo(undo(h));
    expect(h.present).toBe("a");
    h = redo(h);
    expect(h.present).toBe("b");
    expect(canRedo(h)).toBe(true);
    h = commit(h, "x");
    expect(canRedo(h)).toBe(false);
    h = undo(h);
    expect(h.present).toBe("b");
  });

  it("a commit that changes nothing isn't an undo step", () => {
    let h = commit(createHistory({ t: 1 }), { t: 2 });
    h = commit(h, { t: 2 });
    h = undo(h);
    expect(h.present).toEqual({ t: 1 });
  });

  it("Back during a drag returns to where the drag started", () => {
    let h = commit(createHistory("a"), "b");
    h = preview(h, "b-dragging");
    h = undo(h);
    expect(h.present).toBe("a");
    h = redo(h);
    expect(h.present).toBe("b");
  });

  it("keeps at most the last 200 steps", () => {
    let h = createHistory(0);
    for (let i = 1; i <= 250; i++) h = commit(h, i);
    let n = 0;
    while (canUndo(h)) {
      h = undo(h);
      n++;
    }
    expect(n).toBe(200);
    expect(h.present).toBe(50);
  });
});
