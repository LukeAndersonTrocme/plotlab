import { describe, expect, it } from "vitest";
import { Jobs } from "../src/jobs.ts";

const tick = () => new Promise((r) => setTimeout(r, 0));
/** A task that waits until released, recording when it starts. */
function gate(log: string[], name: string) {
  let open!: () => void;
  const done = new Promise<void>((r) => (open = r));
  return {
    task: async () => {
      log.push(name);
      await done;
    },
    open: () => open(),
  };
}

describe("jobs: one at a time, foreground first", () => {
  it("runs foreground tasks in order, one at a time", async () => {
    const jobs = new Jobs();
    const log: string[] = [];
    const a = gate(log, "a");
    jobs.foreground(a.task);
    jobs.foreground(async () => void log.push("b"));
    await tick();
    expect(log).toEqual(["a"]);
    a.open();
    await jobs.idle();
    expect(log).toEqual(["a", "b"]);
  });

  it("background work waits for foreground work, even foreground work that arrives later", async () => {
    const jobs = new Jobs();
    const log: string[] = [];
    const a = gate(log, "run 1");
    jobs.foreground(a.task);
    jobs.background("gallery", [async () => void log.push("thumb 1"), async () => void log.push("thumb 2")]);
    await tick();
    jobs.foreground(async () => void log.push("run 2"));
    a.open();
    await jobs.idle();
    expect(log).toEqual(["run 1", "run 2", "thumb 1", "thumb 2"]);
  });

  it("a slider run that arrives mid-gallery goes before the rest of the gallery", async () => {
    const jobs = new Jobs();
    const log: string[] = [];
    const t1 = gate(log, "thumb 1");
    jobs.background("gallery", [t1.task, async () => void log.push("thumb 2")]);
    await tick();
    jobs.foreground(async () => void log.push("run"));
    t1.open();
    await jobs.idle();
    expect(log).toEqual(["thumb 1", "run", "thumb 2"]);
  });

  it("says when foreground work is waiting (so a long job can cut itself short)", async () => {
    const jobs = new Jobs();
    const seen: boolean[] = [];
    const a = gate([], "a");
    jobs.foreground(async () => {
      seen.push(jobs.waiting());
      await a.task();
      seen.push(jobs.waiting());
    });
    await tick();
    jobs.foreground(async () => {});
    a.open();
    await jobs.idle();
    expect(seen).toEqual([false, true]);
  });

  it("new background work in a group replaces what's still queued in that group", async () => {
    const jobs = new Jobs();
    const log: string[] = [];
    const a = gate(log, "run");
    jobs.foreground(a.task);
    jobs.background("gallery", [async () => void log.push("old 1"), async () => void log.push("old 2")]);
    jobs.background("other", [async () => void log.push("other")]);
    jobs.background("gallery", [async () => void log.push("new")]);
    a.open();
    await jobs.idle();
    expect(log).toEqual(["run", "other", "new"]);
  });

  it("a task that throws doesn't stop the queue", async () => {
    const jobs = new Jobs();
    const log: string[] = [];
    jobs.foreground(async () => {
      throw new Error("boom");
    });
    jobs.foreground(async () => void log.push("next"));
    await jobs.idle();
    expect(log).toEqual(["next"]);
  });
});
