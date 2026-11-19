/**
 * Undo/redo for the recipe (Back / Forward). A slider drag sends many `preview`s and one
 * `commit`, so a whole drag is one step. Pure and immutable: the UI holds one History.
 */
export interface History<T> {
  past: T[];
  /** What's shown now, possibly mid-drag. */
  present: T;
  /** The last committed state: what `undo` steps back from. */
  base: T;
  future: T[];
}

export function createHistory<T>(initial: T): History<T> {
  return { past: [], present: initial, base: initial, future: [] };
}

/** Show a value without recording it (mid-drag). */
export function preview<T>(h: History<T>, next: T): History<T> {
  return { ...h, present: next };
}

export const MAX_STEPS = 200;

/** Values are plain JSON (recipes), so compare them as JSON. */
const same = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** Record a change as one undo step. A change that changes nothing isn't recorded. */
export function commit<T>(h: History<T>, next: T): History<T> {
  if (same(next, h.base)) return { ...h, present: h.base };
  return { past: [...h.past, h.base].slice(-MAX_STEPS), present: next, base: next, future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  const prev = h.past.at(-1);
  if (prev === undefined) return h;
  return { past: h.past.slice(0, -1), present: prev, base: prev, future: [h.base, ...h.future] };
}

export function redo<T>(h: History<T>): History<T> {
  const [next, ...rest] = h.future;
  if (next === undefined) return h;
  return { past: [...h.past, h.base], present: next, base: next, future: rest };
}

export const canUndo = (h: History<unknown>) => h.past.length > 0;
export const canRedo = (h: History<unknown>) => h.future.length > 0;
