"use client";

import { useEffect, useState } from "react";
import { StatusDot } from "@/components/ui/status-dot";
import type { LiveSnapshot } from "@/lib/openf1/live";
import { Poller, type PollUpdate } from "@/lib/openf1/poller";
import { ago, clockTime, sessionStart } from "@/lib/openf1/time";

/** Polls /api/live while the page is visible (stops when hidden or left). Live sessions every poll interval, otherwise once a minute. */
export function useLiveTiming(): PollUpdate<LiveSnapshot> | null {
  const [u, setU] = useState<PollUpdate<LiveSnapshot> | null>(null);
  useEffect(() => {
    const p = new Poller<LiveSnapshot>({
      load: async (signal) => {
        const r = await fetch("/api/live", { signal, cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as LiveSnapshot;
      },
      nextMs: (d) => (d.status === "live" ? d.pollMs : 60_000),
      onUpdate: setU,
    });
    const onVisibility = () => (document.hidden ? p.stop() : p.start());
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) p.start();
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      p.stop();
    };
  }, []);
  return u;
}

const gap = (d: LiveSnapshot["drivers"][number]) => (d.position === 1 ? "Leader" : d.lapsDown ? `+${d.lapsDown} lap${d.lapsDown > 1 ? "s" : ""}` : d.gapToLeader != null ? `+${d.gapToLeader.toFixed(3)}` : "—");

/**
 * Live-timing state for the race view's notice. Real OpenF1 data only: "Live" (with the pulsing dot) only while fresh data arrives; a failed
 * poll reads "Reconnecting" with the age of the last data; without a subscription it says live timing is unavailable and when the next
 * session starts. Each time is labelled as recorded by OpenF1 or received by APEX F1.
 */
export function LiveTimingStatus() {
  const u = useLiveTiming();
  // Only read once data has arrived (the server renders "Checking…"), so a client-only start value is safe.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  const s = u?.data;
  const next = s?.next ? `Next session: ${[s.next.event, s.next.name].filter(Boolean).join(" · ")}, ${sessionStart(s.next.start)}.` : null;

  if (!u) return <Line tone="neutral">Checking live timing…</Line>;
  if (!s) return <Line tone="neutral">Live timing status unavailable: the APEX F1 server could not be reached ({u.error}). Retrying.</Line>;
  if (s.status === "unavailable") return <Line tone="neutral">Live timing unavailable: this site has no OpenF1 real-time subscription. {next}</Line>;
  if (s.status === "idle") return <Line tone="neutral">No session is running. {next}</Line>;
  if (s.status === "error") return <Line tone="danger">{s.reason}</Line>;

  const title = [s.session?.event, s.session?.name].filter(Boolean).join(" · ");
  const recorded = s.sourceTime ? `recorded by OpenF1 at ${clockTime(s.sourceTime)}` : "no data recorded yet";
  const received = ago(s.fetchedAt, now);
  const stale = s.stale || !!u.error;
  return (
    <div role="status" aria-live="polite" className="space-y-2">
      <Line tone={stale ? "warning" : "accent"} pulse={!stale}>
        <span className="font-semibold text-fg">{stale ? "Reconnecting" : "Live"}</span> · {title}. Latest data {recorded}
        {received ? `, received ${received}` : ""}.{stale ? " Showing the last data received; it is not current." : ""}
      </Line>
      {s.drivers.some((d) => d.position != null) && (
        <ol aria-label="Live running order" className={`grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-x-4 gap-y-1 text-xs tabular-nums ${stale ? "opacity-60" : ""}`}>
          {s.drivers
            .filter((d) => d.position != null)
            .slice(0, 10)
            .map((d) => (
              <li key={d.number} className="flex items-baseline gap-1.5">
                <span className="w-5 text-right text-subtle">{d.position}</span>
                <span aria-hidden="true" className="h-2.5 w-0.5 rounded-sm" style={{ backgroundColor: d.colour ?? "#9aa3ad" }} />
                <span className="font-semibold text-fg">{d.code ?? `#${d.number}`}</span>
                <span className="ml-auto text-muted">{gap(d)}</span>
              </li>
            ))}
        </ol>
      )}
    </div>
  );
}

function Line({ tone, pulse = false, children }: { tone: "neutral" | "accent" | "warning" | "danger"; pulse?: boolean; children: React.ReactNode }) {
  return (
    <p role="status" className="flex items-start gap-2 text-sm text-muted">
      <StatusDot tone={tone} pulse={pulse} className="mt-1.5" />
      <span>{children}</span>
    </p>
  );
}
