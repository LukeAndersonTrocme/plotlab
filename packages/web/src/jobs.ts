/**
 * The worker's to-do list: one task at a time, foreground first. Foreground tasks are the
 * messages the screen waits on (runs, exports, a checkpoint's picture), in the order they
 * came. Background tasks (preset gallery pictures) run only when nothing else waits, one
 * small task at a time, so a slider moved meanwhile is never stuck behind them.
 */
type Task = () => Promise<void>;

export class Jobs {
  private fg: Task[] = [];
  private bg: Array<{ group: string; task: Task }> = [];
  private running: Promise<void> | null = null;

  foreground(task: Task): void {
    this.fg.push(task);
    this.pump();
  }

  /** Queue background tasks; what's still queued in the same group is dropped (a newer request replaces it). */
  background(group: string, tasks: Task[]): void {
    this.bg = [...this.bg.filter((b) => b.group !== group), ...tasks.map((task) => ({ group, task }))];
    this.pump();
  }

  /** True when foreground work is waiting: a long task can cut itself short. */
  waiting(): boolean {
    return this.fg.length > 0;
  }

  /** Resolves when nothing is left to do. */
  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private pump(): void {
    if (this.running) return;
    this.running = (async () => {
      for (;;) {
        const next = this.fg.shift() ?? this.bg.shift()?.task;
        if (!next) break;
        try {
          await next();
        } catch {
          // A task reports its own failure; the queue carries on.
        }
      }
      this.running = null;
    })();
  }
}
