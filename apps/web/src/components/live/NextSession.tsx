"use client";

import { useEffect, useState } from "react";
import { ButtonLink } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import type { LiveSnapshot } from "@/lib/openf1/live";
import { sessionStart } from "@/lib/openf1/time";

// One /api/live request per page, shared by the components below; dropped when a countdown ends so the next answer is fresh.
let shared: Promise<LiveSnapshot> | null = null;
const loadLive = (fresh = false) => {
  if (fresh || !shared)
    shared = fetch("/api/live").then((r) => (r.ok ? (r.json() as Promise<LiveSnapshot>) : Promise.reject(new Error(String(r.status)))));
  return shared;
};

function useLive(nonce = 0) {
  const [s, setS] = useState<LiveSnapshot | null | "error">(null);
  useEffect(() => {
    let on = true;
    loadLive(nonce > 0).then(
      (x) => on && setS(x),
      () => on && setS("error"),
    );
    return () => {
      on = false;
    };
  }, [nonce]);
  return s;
}

/** Days, hours, minutes and seconds until a time (zero once it has passed). */
export function countdown(ms: number) {
  const t = Math.max(0, Math.floor(ms / 1000));
  return {
    d: Math.floor(t / 86_400),
    h: Math.floor(t / 3600) % 24,
    m: Math.floor(t / 60) % 60,
    s: t % 60,
  };
}

/**
 * The next session as a running countdown (OpenF1's public schedule, start shown in the viewer's time zone). On track: says so and opens
 * Live. When the countdown ends it asks the schedule again rather than assuming the session started.
 */
export function NextSessionCountdown() {
  const [nonce, setNonce] = useState(0);
  const s = useLive(nonce);
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    // The clock starts after hydration (the server has no viewer clock); "--" until then.
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  const start = s && s !== "error" && s.status !== "live" && s.next ? Date.parse(s.next.start) : null;
  const ended = start != null && now != null && now >= start;
  useEffect(() => {
    if (!ended) return;
    const id = setTimeout(() => setNonce((n) => n + 1), 30_000); // OpenF1 lists a session as current shortly after its start
    return () => clearTimeout(id);
  }, [ended]);

  let body;
  if (s === null) body = <p className="mt-3 text-sm text-muted">Checking the schedule…</p>;
  else if (s !== "error" && s.status === "live" && s.session)
    body = (
      <>
        <p className="mt-3 font-display text-2xl font-semibold tracking-[0.01em]">{s.session.event ?? "Session"}</p>
        <p className="mt-1 flex items-center gap-2 text-sm text-muted">
          <StatusDot tone="accent" pulse /> {s.session.name} on track now
        </p>
        <ButtonLink href="/live" size="sm" className="mt-4">
          Open live timing
        </ButtonLink>
      </>
    );
  else if (s === "error" || !s.next)
    body = <p className="mt-3 text-sm text-muted">The schedule is unavailable right now, so no countdown is shown.</p>;
  else {
    const c = countdown(start! - (now ?? start!));
    const units: [string, number, string][] = [
      ["d", c.d, "days"],
      ["h", c.h, "hours"],
      ["m", c.m, "minutes"],
      ["s", c.s, "seconds"],
    ];
    body = (
      <>
        <p className="mt-3 pr-28 font-display text-2xl font-semibold tracking-[0.01em] sm:pr-32">{s.next.event ?? "Next event"}</p>
        <p className="mt-1 pr-28 text-sm text-muted sm:pr-32">
          {s.next.name} · {sessionStart(s.next.start)}
        </p>
        {ended ? (
          <p className="mt-4 text-sm text-muted">Starting now: checking whether it is on track…</p>
        ) : (
          <div role="timer" aria-label={`Starts in ${c.d} days, ${c.h} hours, ${c.m} minutes`} className="mt-4 grid grid-cols-4 gap-2">
            {units.map(([k, v, label]) => (
              <div key={k} aria-hidden="true" className="rounded-md border border-line bg-bg/40 px-2 py-2.5 text-center">
                <span className="block font-display text-3xl font-semibold leading-none tabular-nums">
                  {now == null ? "--" : String(v).padStart(2, "0")}
                </span>
                <span className="mt-1.5 block text-[0.6875rem] uppercase tracking-[0.12em] text-subtle">{label}</span>
              </div>
            ))}
          </div>
        )}
      </>
    );
  }
  return body;
}
