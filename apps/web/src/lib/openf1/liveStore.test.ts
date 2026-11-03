import { describe, expect, it } from "vitest";
import { indicator } from "./indicator";
import type { LiveSnapshot } from "./live";
import { createLiveStore, IDLE_MS, NAV_LIVE_MS } from "./liveStore";
import type { PollUpdate } from "./poller";

const SESSION = { key: 11400, name: "Qualifying", event: "Mexico", circuit: "Mexico City", start: "2026-10-31T21:00:00+00:00", end: "2026-10-31T22:00:00+00:00" };
const snap = (o: Partial<LiveSnapshot> = {}): LiveSnapshot => ({ status: "idle", reason: null, errorCategory: null, session: null, next: null, nextRace: null, drivers: [], raceControl: [], sourceTime: null, fetchedAt: null, stale: false, pollMs: 5000, ...o });
const flush = () => new Promise((r) => setTimeout(r, 0));

function harness(data: () => LiveSnapshot | Error) {
  let loads = 0;
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const listeners = new Set<() => void>();
  const doc = { visibilityState: "visible" as DocumentVisibilityState, addEventListener: (_: string, fn: () => void) => void listeners.add(fn), removeEventListener: (_: string, fn: () => void) => void listeners.delete(fn) };
  const store = createLiveStore({
    load: async () => {
      loads++;
      const d = data();
      if (d instanceof Error) throw d;
      return d;
    },
    schedule: (fn, ms) => {
      const t = { fn, ms, live: true };
      timers.push(t);
      return () => void (t.live = false);
    },
    doc: doc as never,
  });
  const fire = async () => {
    const t = timers.filter((x) => x.live).at(-1)!;
    t.live = false;
    t.fn();
    await flush();
  };
  const setHidden = (h: boolean) => {
    doc.visibilityState = h ? "hidden" : "visible";
    for (const fn of listeners) fn();
  };
  return { store, loads: () => loads, next: () => timers.filter((x) => x.live).at(-1)?.ms ?? null, fire, setHidden };
}

describe("shared live store (one /api/live poll per tab)", () => {
  it("every subscriber shares one poll; a late subscriber gets the last answer at once", async () => {
    const h = harness(() => snap());
    const a: PollUpdate<LiveSnapshot>[] = [];
    const b: PollUpdate<LiveSnapshot>[] = [];
    h.store.subscribe((u) => a.push(u));
    await flush();
    h.store.subscribe((u) => b.push(u));
    expect(h.loads()).toBe(1);
    expect(b).toHaveLength(1);
    await h.fire();
    expect(h.loads()).toBe(2);
    expect([a.length, b.length]).toEqual([2, 2]);
  });

  it("interval: idle once a minute; live every 30 s for the nav alone, the live interval while the Live page is open", async () => {
    let live = false;
    const h = harness(() => (live ? snap({ status: "live", session: SESSION }) : snap()));
    const off = h.store.subscribe(() => {});
    await flush();
    expect(h.next()).toBe(IDLE_MS);
    live = true;
    await h.fire();
    expect(h.next()).toBe(NAV_LIVE_MS);
    h.store.subscribe(() => {}, { fast: true }); // asks at once (see below), then keeps the live interval
    await flush();
    expect(h.next()).toBe(5000);
    await h.fire();
    expect(h.next()).toBe(5000);
    off();
  });

  it("the live view joining while only the nav's 30 s timer is pending asks at once, not up to 30 s later", async () => {
    const h = harness(() => snap({ status: "live", session: SESSION }));
    h.store.subscribe(() => {});
    await flush();
    expect(h.next()).toBe(NAV_LIVE_MS);
    h.store.subscribe(() => {}, { fast: true });
    await flush();
    expect(h.loads()).toBe(2);
    expect(h.next()).toBe(5000);
    h.store.subscribe(() => {}, { fast: true }); // a second live view: the cadence is already live, no extra request
    await flush();
    expect(h.loads()).toBe(2);
  });

  it("hidden tab: no polling; visible again: asks at once; last unsubscribe stops everything", async () => {
    const h = harness(() => snap());
    const off = h.store.subscribe(() => {});
    await flush();
    h.setHidden(true);
    expect(h.next()).toBeNull();
    h.setHidden(false);
    await flush();
    expect(h.loads()).toBe(2);
    off();
    expect(h.next()).toBeNull();
  });

  it("a slow answer: nothing else is sent meanwhile, the next ask is the live interval after it, and the gap is recorded", async () => {
    let clock = 0;
    let release: (d: LiveSnapshot) => void = () => {};
    let loads = 0;
    const timers: { fn: () => void; ms: number }[] = [];
    const store = createLiveStore({
      load: () => (loads++, new Promise<LiveSnapshot>((r) => (release = r))),
      schedule: (fn, ms) => (timers.push({ fn, ms }), () => {}),
      doc: null,
      now: () => clock,
    });
    store.subscribe(() => {}, { fast: true });
    release(snap({ status: "live", session: SESSION }));
    await flush();
    clock = 5000;
    timers.at(-1)!.fn(); // the live interval elapses: one request, then OpenF1 is slow
    clock = 25_000;
    expect(loads).toBe(2);
    expect(timers).toHaveLength(1); // no timer, no second request while it is in flight
    release(snap({ status: "live", session: SESSION }));
    await flush();
    expect(timers.at(-1)!.ms).toBe(5000);
    expect(store.status()).toMatchObject({ dataReceivedAt: 25_000, gapsMs: [25_000] });
  });

  it("recovery: failures back off (never stop polling), and the first success returns to the live interval", async () => {
    let fail = true;
    const h = harness(() => (fail ? new Error("HTTP 502") : snap({ status: "live", session: SESSION })));
    const got: PollUpdate<LiveSnapshot>[] = [];
    h.store.subscribe((u) => got.push(u), { fast: true });
    await flush();
    expect(got.at(-1)).toMatchObject({ error: "HTTP 502", failures: 1 });
    expect(h.next()).toBeGreaterThan(0); // a retry is scheduled
    await h.fire();
    expect(got.at(-1)!.failures).toBe(2);
    fail = false;
    await h.fire();
    expect(got.at(-1)).toMatchObject({ error: null, failures: 0, data: { status: "live" } });
    expect(h.next()).toBe(5000);
  });

  it("a failed request keeps the previous data and reports the error", async () => {
    let fail = false;
    const h = harness(() => (fail ? new Error("HTTP 502") : snap({ status: "live", session: SESSION })));
    const got: PollUpdate<LiveSnapshot>[] = [];
    h.store.subscribe((u) => got.push(u));
    await flush();
    fail = true;
    await h.fire();
    expect(got.at(-1)).toMatchObject({ error: "HTTP 502", data: { session: { key: 11400 } } });
  });
});

describe("header indicator", () => {
  const at = (iso: string) => iso.slice(11, 16);
  const u = (data: LiveSnapshot | null, error: string | null = null): PollUpdate<LiveSnapshot> => ({ data, error, failures: error ? 1 : 0 });
  const t = (iso: string) => Date.parse(iso);
  it("live, upcoming (in the pre-session window and from the schedule), ended, none, unavailable, checking", () => {
    const live = snap({ status: "live", session: SESSION });
    expect(indicator(u(live), t("2026-10-31T21:10:00Z"), at)).toMatchObject({ state: "live", label: "Live: Mexico Qualifying" });
    expect(indicator(u(live), t("2026-10-31T20:50:00Z"), at)).toMatchObject({ state: "upcoming", label: "Mexico Qualifying at 21:00" });
    expect(indicator(u(live), t("2026-10-31T22:10:00Z"), at)).toMatchObject({ state: "ended", label: "Mexico Qualifying ended" });
    expect(indicator(u(snap({ next: { name: "Race", event: "Mexico", start: "2026-11-01T20:00:00+00:00" } })), 0, at)).toMatchObject({ state: "upcoming", label: "Next: Mexico Race, 20:00" });
    expect(indicator(u(snap()), 0, at).state).toBe("none");
    expect(indicator(u(snap({ status: "unavailable" })), 0, at).state).toBe("unavailable");
    expect(indicator(u(snap({ status: "error", session: SESSION })), 0, at).state).toBe("unavailable");
    expect(indicator(u(null, "HTTP 500"), 0, at).state).toBe("unavailable");
    expect(indicator(null, 0, at).state).toBe("checking");
  });
});
