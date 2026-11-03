import { useEffect, useState } from "react";
import type { LiveSnapshot } from "./live";
import { Poller, type PollUpdate } from "./poller";

/**
 * One /api/live poll per browser tab, shared by everything that shows live state (nav indicator, Live page status and countdowns, the
 * live 3D view, the session watcher): no component polls on its own. While a session is on track it polls at the live interval if a
 * "fast" subscriber (the Live page) is mounted, else every NAV_LIVE_MS; with nothing live, every IDLE_MS. Paused while the tab is hidden.
 */
export const IDLE_MS = 60_000;
export const NAV_LIVE_MS = 30_000;

type Listener = (u: PollUpdate<LiveSnapshot>) => void;

export function createLiveStore(o: { load?: (signal: AbortSignal) => Promise<LiveSnapshot>; schedule?: (fn: () => void, ms: number) => () => void; doc?: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener"> | null; now?: () => number } = {}) {
  const subs = new Map<Listener, boolean>();
  const now = o.now ?? Date.now;
  let last: PollUpdate<LiveSnapshot> | null = null;
  let lastAt = -Infinity;
  let dataAt = -Infinity;
  /** Time between consecutive successful answers (ms, newest last, at most 20): read by the developer health panel only. */
  let gaps: number[] = [];
  const fast = () => [...subs.values()].some(Boolean);
  const poller = new Poller<LiveSnapshot>({
    load:
      o.load ??
      (async (signal) => {
        const r = await fetch("/api/live", { signal, cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as LiveSnapshot;
      }),
    nextMs: (d) => (d.status === "live" ? (fast() ? d.pollMs : NAV_LIVE_MS) : IDLE_MS),
    onUpdate: (u) => {
      last = u;
      lastAt = now();
      if (!u.error) {
        if (Number.isFinite(dataAt)) gaps = [...gaps, lastAt - dataAt].slice(-20);
        dataAt = lastAt;
      }
      for (const fn of subs.keys()) fn(u);
    },
    schedule: o.schedule,
  });
  const visible = () => o.doc?.visibilityState !== "hidden";
  const onVisibility = () => (visible() ? poller.start() : poller.stop());
  const refresh = () => {
    poller.stop();
    if (subs.size && visible()) poller.start();
  };
  return {
    subscribe(fn: Listener, opts: { fast?: boolean } = {}) {
      const first = subs.size === 0;
      const wasFast = fast();
      subs.set(fn, !!opts.fast);
      if (last) fn(last);
      if (first) {
        o.doc?.addEventListener("visibilitychange", onVisibility);
        if (visible()) poller.start();
        // A slower (navigation) timer may be pending, up to NAV_LIVE_MS away: ask now and keep the live cadence from here. A request this soon
        // after the last is answered from the server's last poll (no extra OpenF1 request).
      } else if (opts.fast && !wasFast && last?.data?.status === "live") refresh();
      return () => {
        subs.delete(fn);
        if (subs.size) return;
        poller.stop();
        o.doc?.removeEventListener("visibilitychange", onVisibility);
      };
    },
    /** Ask now instead of at the next scheduled poll (e.g. a countdown just ended). */
    refresh,
    /** Read-only state for developer diagnostics: never triggers a request. `receivedAt`: when this tab last got an answer (or error);
     * `dataReceivedAt`: when it last got data (a successful answer). */
    status: () => ({ subscribers: subs.size, hidden: !visible(), receivedAt: Number.isFinite(lastAt) ? lastAt : null, dataReceivedAt: Number.isFinite(dataAt) ? dataAt : null, gapsMs: gaps }),
  };
}

let tabStore: ReturnType<typeof createLiveStore> | null = null;
export const liveStore = () => (tabStore ??= createLiveStore({ doc: typeof document === "undefined" ? null : document }));

/** The tab's shared live state (null until the first answer). `fast`: this view needs the live interval while a session is on track. */
export function useLiveState(fast = false): PollUpdate<LiveSnapshot> | null {
  const [u, setU] = useState<PollUpdate<LiveSnapshot> | null>(null);
  useEffect(() => liveStore().subscribe(setU, { fast }), [fast]);
  return u;
}
