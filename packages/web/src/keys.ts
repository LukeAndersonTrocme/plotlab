/**
 * The app's keyboard shortcuts, as a pure function of a key press. ⌘ is Ctrl on other systems.
 * - ⌘S / Ctrl+S: save a checkpoint (anywhere, so the browser's Save page never opens).
 * - S: show or hide the checkpoints.
 * - ⌘Z: Back; ⇧⌘Z or ⌘Y: Forward. Text boxes keep their own undo.
 */
export interface KeyPress {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  repeat: boolean;
  /** Focus is in a text box (letters type, ⌘Z undoes the typing). */
  typing: boolean;
  /** Focus is in a drop-down (letters pick an option). */
  menu: boolean;
}

/** "ignore": swallow the key (stop the browser's own action) and do nothing. */
export type Shortcut = "save" | "checkpoints" | "back" | "forward" | "ignore";

export function shortcut(e: KeyPress): Shortcut | null {
  const k = e.key.toLowerCase();
  if (e.altKey) return null;
  if (e.metaKey || e.ctrlKey) {
    if (k === "s" && !e.shiftKey) return e.repeat ? "ignore" : "save";
    if (e.typing) return null;
    if (k === "z") return e.shiftKey ? "forward" : "back";
    if (k === "y") return "forward";
    return null;
  }
  if (k === "s" && !e.shiftKey && !e.repeat && !e.typing && !e.menu) return "checkpoints";
  return null;
}

/** Where the key press landed, for `shortcut`. */
export function focusOf(t: EventTarget | null): { typing: boolean; menu: boolean } {
  if (typeof HTMLElement === "undefined" || !(t instanceof HTMLElement)) return { typing: false, menu: false };
  const typing = t.isContentEditable || t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && !["range", "checkbox", "radio", "button", "color", "file"].includes(t.type));
  return { typing, menu: t instanceof HTMLSelectElement };
}

/**
 * A modal dialog's focus trap: where Tab (Shift+Tab: `back`) should go from `active` among the
 * dialog's focusable `items`, or null to let the browser's own Tab do it. Past either end it goes
 * round; from the dialog itself or outside it (`active` not in `items`), it comes back in.
 */
export function trapTab<T>(items: readonly T[], active: T | null, back: boolean): T | null {
  if (items.length === 0) return null;
  const i = active === null ? -1 : items.indexOf(active);
  if (i < 0) return back ? items[items.length - 1]! : items[0]!;
  if (back && i === 0) return items[items.length - 1]!;
  if (!back && i === items.length - 1) return items[0]!;
  return null;
}
