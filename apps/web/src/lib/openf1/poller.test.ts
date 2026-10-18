import { describe, expect, it } from "vitest";
import { Poller, type PollUpdate } from "./poller";

function harness(answers: (number | Error)[]) {
  const timers: { fn: () => void; ms: number }[] = [];
  const updates: PollUpdate<number>[] = [];
  let calls = 0;
  let release: (() => void) | null = null;
  const signals: AbortSignal[] = [];
  const p = new Poller<number>({
    load: (signal) => {
      calls++;
      signals.push(signal);
      const a = answers.shift();
      return new Promise((ok, fail) => {
        release = () => (a instanceof Error ? fail(a) : ok(a ?? 0));
      });
    },
    nextMs: (d) => (d > 100 ? 5000 : 60_000),
    onUpdate: (u) => updates.push(u),
    schedule: (fn, ms) => {
      const t = { fn, ms };
      timers.push(t);
      return () => timers.splice(timers.indexOf(t), 1);
    },
  });
  const settle = async () => {
    release?.();
    release = null;
    await new Promise((r) => setTimeout(r, 0));
  };
  return { p, timers, updates, signals, calls: () => calls, settle, fire: () => timers.shift()?.fn() };
}

describe("live Poller", () => {
  it("delivers each new answer and schedules the next by the data (live interval or a minute)", async () => {
    const h = harness([101, 102, 5]);
    h.p.start();
    await h.settle();
    expect(h.updates.at(-1)).toEqual({ data: 101, error: null, failures: 0 });
    expect(h.timers[0].ms).toBe(5000);
    h.fire();
    await h.settle();
    expect(h.updates.at(-1)!.data).toBe(102);
    h.fire();
    await h.settle();
    expect(h.timers[0].ms).toBe(60_000); // nothing live: poll slowly
  });

  it("start() twice is one loop, and no second request starts while one is in flight", async () => {
    const h = harness([101]);
    h.p.start();
    h.p.start();
    expect(h.calls()).toBe(1);
    await h.settle();
    expect(h.timers).toHaveLength(1);
  });

  it("backs off after failures and keeps the last data", async () => {
    const h = harness([101, new Error("HTTP 502"), new Error("HTTP 502"), 103]);
    h.p.start();
    await h.settle();
    h.fire();
    await h.settle();
    expect(h.updates.at(-1)).toEqual({ data: 101, error: "HTTP 502", failures: 1 });
    expect(h.timers[0].ms).toBe(2000);
    h.fire();
    await h.settle();
    expect(h.timers[0].ms).toBe(4000);
    h.fire();
    await h.settle();
    expect(h.updates.at(-1)).toEqual({ data: 103, error: null, failures: 0 });
  });

  it("stop() aborts the request in flight and nothing else runs", async () => {
    const h = harness([101, 102]);
    h.p.start();
    h.p.stop();
    expect(h.signals[0].aborted).toBe(true);
    await h.settle();
    expect(h.updates).toEqual([]);
    expect(h.timers).toEqual([]);
  });
});
