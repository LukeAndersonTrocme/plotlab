/** Wraps an async action so a call while one is still running is ignored (a double click). */
export function once<A extends unknown[]>(fn: (...a: A) => Promise<void>): (...a: A) => Promise<void> {
  let running = false;
  return async (...a) => {
    if (running) return;
    running = true;
    try {
      await fn(...a);
    } finally {
      running = false;
    }
  };
}
