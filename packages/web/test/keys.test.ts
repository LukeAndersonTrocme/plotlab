import { describe, expect, it } from "vitest";
import { shortcut, trapTab, type KeyPress } from "../src/keys.ts";

const press = (key: string, mods: Partial<KeyPress> = {}): KeyPress => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, repeat: false, typing: false, menu: false, ...mods });

describe("keyboard shortcuts", () => {
  it("⌘S and Ctrl+S save a checkpoint", () => {
    expect(shortcut(press("s", { metaKey: true }))).toBe("save");
    expect(shortcut(press("s", { ctrlKey: true }))).toBe("save");
    expect(shortcut(press("S", { metaKey: true }))).toBe("save");
  });

  it("⌘S saves even while typing in a box (the browser's own Save page is never wanted)", () => {
    expect(shortcut(press("s", { metaKey: true, typing: true }))).toBe("save");
  });

  it("holding ⌘S down saves once", () => {
    expect(shortcut(press("s", { metaKey: true, repeat: true }))).toBe("ignore");
  });

  it("S alone shows or hides the checkpoints, but not while typing", () => {
    expect(shortcut(press("s"))).toBe("checkpoints");
    expect(shortcut(press("s", { typing: true }))).toBeNull();
    expect(shortcut(press("s", { shiftKey: true }))).toBeNull();
    expect(shortcut(press("s", { repeat: true }))).toBeNull();
    // A focused drop-down uses letters to pick an option.
    expect(shortcut(press("s", { menu: true }))).toBeNull();
  });

  it("⌘Z is Back, ⇧⌘Z and ⌘Y are Forward; text boxes keep their own undo", () => {
    expect(shortcut(press("z", { metaKey: true }))).toBe("back");
    expect(shortcut(press("z", { ctrlKey: true, shiftKey: true }))).toBe("forward");
    expect(shortcut(press("Z", { metaKey: true, shiftKey: true }))).toBe("forward");
    expect(shortcut(press("y", { ctrlKey: true }))).toBe("forward");
    expect(shortcut(press("z", { metaKey: true, typing: true }))).toBeNull();
    // A drop-down has no undo of its own: ⌘Z right after picking a step undoes it.
    expect(shortcut(press("z", { metaKey: true, menu: true }))).toBe("back");
  });

  it("leaves other keys, and Alt combinations, alone", () => {
    expect(shortcut(press("a", { metaKey: true }))).toBeNull();
    expect(shortcut(press("s", { metaKey: true, altKey: true }))).toBeNull();
    expect(shortcut(press("Escape"))).toBeNull();
  });
});

describe("trapTab: Tab stays inside a modal dialog", () => {
  const items = ["close", "a", "b"];
  it("Tab on the last goes round to the first; Shift+Tab on the first goes to the last", () => {
    expect(trapTab(items, "b", false)).toBe("close");
    expect(trapTab(items, "close", true)).toBe("b");
  });
  it("in between, the browser's own Tab does it", () => {
    expect(trapTab(items, "a", false)).toBeNull();
    expect(trapTab(items, "a", true)).toBeNull();
  });
  it("focus on the dialog itself, or outside it, comes back in", () => {
    expect(trapTab(items, null, false)).toBe("close");
    expect(trapTab(items, null, true)).toBe("b");
    expect(trapTab([], null, false)).toBeNull();
  });
});
