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
/**
 * The schedule, a one-second clock, and the start picked from it (null while live or unknown). Once the start passes it asks the schedule
 * again (OpenF1 lists a session as current shortly after its start) rather than assuming the session began.
 */
function useCountdownTo(pick: (s: LiveSnapshot) => string | null | undefined) {
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
  const iso = s && s !== "error" && s.status !== "live" ? pick(s) : null;
  const start = iso ? Date.parse(iso) : null;
  const ended = start != null && now != null && now >= start;
  useEffect(() => {
    if (!ended) return;
    const id = setTimeout(() => setNonce((n) => n + 1), 30_000);
    return () => clearTimeout(id);
  }, [ended]);
  return { s, now, start, ended };
}

/** Compact "5d 06:41:22". */
export const shortCountdown = (ms: number) => {
  const c = countdown(ms);
  const p = (v: number) => String(v).padStart(2, "0");
  return `${c.d ? `${c.d}d ` : ""}${p(c.h)}:${p(c.m)}:${p(c.s)}`;
};

/**
 * A small tab for the Live view: a running countdown to the next race (the schedule's next session named Race; the next session when no
 * race is listed yet), or "on track" during a session. Renders nothing when the schedule is unavailable.
 */
export function NextRaceTab({ className }: { className?: string }) {
  const { s, now, start, ended } = useCountdownTo((x) => (x.nextRace ?? x.next)?.start);
  if (s === null || s === "error") return null;
  const target = s.nextRace ?? s.next;
  const live = s.status === "live" && s.session;
  if (!live && !target) return null;
  return (
    <div role="status" className={`flex items-center gap-2 px-3 py-1.5 text-xs ${className ?? ""}`}>
      {live ? (
        <>
          <StatusDot tone="accent" pulse />
          <span className="truncate">
            <span className="font-semibold">{s.session!.event ?? "Session"}</span> <span className="text-muted">{s.session!.name} on track</span>
          </span>
        </>
      ) : (
        <>
          <span className="shrink-0 uppercase tracking-[0.12em] text-subtle">{s.nextRace ? "Next race" : "Next session"}</span>
          <span className="min-w-0 truncate font-semibold" title={`${target!.event ?? ""} ${target!.name}, ${sessionStart(target!.start)}`}>
            {target!.event ?? target!.name}
          </span>
          <span className="ml-auto shrink-0 font-display text-sm font-semibold tabular-nums" aria-label={ended ? "Starting now" : undefined}>
            {now == null || start == null ? "--:--:--" : ended ? "Starting" : shortCountdown(start - now)}
          </span>
        </>
      )}
    </div>
  );
}

/**
 * The next race as a running countdown (OpenF1's public schedule: the next session named Race, else the next session; times in the viewer's
 * time zone), with the weekend's first session under it when that comes earlier. Same target as the Live tab. On track: says so and opens
 * Live. When the countdown ends it asks the schedule again rather than assuming the session started.
 */
export function NextSessionCountdown() {
  const { s, now, start, ended } = useCountdownTo((x) => (x.nextRace ?? x.next)?.start);

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
  else if (s === "error" || !(s.nextRace ?? s.next))
    body = <p className="mt-3 text-sm text-muted">The schedule is unavailable right now, so no countdown is shown.</p>;
  else {
    const target = (s.nextRace ?? s.next)!;
    const first = s.next && s.next.start < target.start ? s.next : null;
    const c = countdown(start! - (now ?? start!));
    const units: [string, number, string][] = [
      ["d", c.d, "days"],
      ["h", c.h, "hours"],
      ["m", c.m, "minutes"],
      ["s", c.s, "seconds"],
    ];
    body = (
      <>
        <p className="mt-3 pr-28 font-display text-2xl font-semibold tracking-[0.01em] sm:pr-32">{target.event ?? "Next event"}</p>
        <p className="mt-1 pr-28 text-sm text-muted sm:pr-32">
          {target.name} · {sessionStart(target.start)}
        </p>
        {first && (
          <p className="mt-0.5 pr-28 text-xs text-subtle sm:pr-32">
            First on track: {first.name} · {sessionStart(first.start)}
          </p>
        )}
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
