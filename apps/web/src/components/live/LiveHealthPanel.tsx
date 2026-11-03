"use client";

import { useEffect, useState, type ReactNode } from "react";
import { StatusDot } from "@/components/ui/status-dot";
import { liveHealth, type Health } from "@/lib/openf1/health";
import { liveStore, useLiveState } from "@/lib/openf1/liveStore";

const TONE: Record<Health, "success" | "warning" | "neutral" | "danger"> = { Healthy: "success", Delayed: "warning", Stale: "danger", Waiting: "neutral", Unavailable: "neutral", "Authentication Error": "danger" };
const NA = "Not available";

/** "21:03:12 UTC · 02:33:12 GMT+5:30": the same instant in UTC and in this browser's time zone. */
function when(t: string | number | null | undefined) {
  const d = t == null ? null : new Date(t);
  if (!d || !Number.isFinite(d.getTime())) return NA;
  const local = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
  return `${d.toISOString().slice(11, 19)} UTC · ${local}`;
}
const num = (v: number | null | undefined, unit = "") => (v == null ? NA : `${v}${unit}`);

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-subtle">{k}</dt>
      <dd className="min-w-0 break-words text-fg">{children}</dd>
    </>
  );
}

/**
 * DEVELOPER DIAGNOSTICS (rendered only by `next dev`; see app/live/page.tsx). Live Race Health: whether the live pipeline is genuinely
 * receiving and processing OpenF1 data, from the tab's existing shared /api/live poll (no request of its own) and the read-only metadata
 * /api/live adds in development. Collapsed by default; only the panel itself takes pointer events, so the circuit stays usable.
 */
export function LiveHealthPanel() {
  const u = useLiveState();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);
  if (now == null) return null; // client only: no server/client clock difference to hydrate
  const r = liveHealth(u, liveStore().status(), now);
  const l = r.location;
  const p = r.polling;
  return (
    // Bottom right, above the replay playback bar at every width (the live view has none), clear of the circuit's centre.
    <details className="group pointer-events-auto fixed bottom-28 right-3 z-[75] w-[min(22rem,calc(100vw-1.5rem))] rounded-lg border border-white/10 bg-surface/80 text-xs shadow-2 backdrop-blur-xl">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 [&::-webkit-details-marker]:hidden">
        <span className="rounded-sm border border-line px-1 py-px font-mono text-[10px] uppercase tracking-[0.08em] text-subtle">Dev</span>
        <StatusDot tone={TONE[r.health]} pulse={r.health === "Healthy"} />
        <span className="font-medium text-fg">Live health: {r.health}</span>
        <svg aria-hidden="true" viewBox="0 0 20 20" className="ml-auto size-4 text-subtle transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m5 8 5 5 5-5" />
        </svg>
      </summary>
      <div className="max-h-[min(70vh,34rem)] space-y-3 overflow-y-auto border-t border-line px-3 pb-3 pt-2">
        <p className="text-muted">{r.why}</p>
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-subtle">At a glance</h3>
          <dl className="grid grid-cols-[8.5rem_1fr] gap-x-2 gap-y-0.5">
            <Row k="Connection">{r.connection.state}</Row>
            <Row k="OpenF1 login">{r.auth.state}</Row>
            <Row k="Position freshness">{l.state}</Row>
            <Row k="Newest sample age">{l.sampleAgeNowS == null ? NA : `${l.sampleAgeNowS} s now · ${num(l.sampleAgeServedS, " s")} when served`}</Row>
            <Row k="Cars current">{l.currentCars == null ? NA : `${l.currentCars} of ${l.carsWithAnyPosition} with a position`}</Row>
            <Row k="Rows last cycle">{l.rowsLastCycle == null ? NA : `${l.rowsLastCycle} · ${num(l.newRowsLastCycle)} new · ${num(l.lateRowsLastCycle)} late`}</Row>
            <Row k="Server poll">{num(p.serverPollS, " s")}</Row>
            <Row k="Last poll detail">
              {p.lastPoll
                ? `${Object.entries(p.lastPoll.steps).filter(([, v]) => v > 0).map(([k, v]) => `${k} ${v} ms`).join(" · ")}${p.lastPoll.scheduleMs != null ? ` · schedule ${p.lastPoll.scheduleMs} ms` : ""} · ${p.lastPoll.requests} req, ${p.lastPoll.retries} retries`
                : NA}
            </Row>
            <Row k="Answer gap">{p.lastGapS == null ? NA : `${p.lastGapS} s last · ${p.longestGapS} s longest (recent)`}</Row>
            <Row k="Delivery to browser">{num(p.deliveryS, " s")}</Row>
            <Row k="Last success">{when(p.serverLastSuccessAt)}</Row>
            <Row k="Last error">{p.error ? `${p.error.category}: ${p.error.message}` : "None"}</Row>
          </dl>
        </section>
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-subtle">Session</h3>
          <dl className="grid grid-cols-[8.5rem_1fr] gap-x-2 gap-y-0.5">
            <Row k="Session">{r.session?.name ?? NA}</Row>
            <Row k="Meeting">{r.session?.meeting ?? NA}</Row>
            <Row k="Session ID">{r.session?.key ?? NA}</Row>
            <Row k="Feed status">{u?.data?.status ?? "Unknown"}</Row>
          </dl>
        </section>
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-subtle">Why</h3>
          <dl className="grid grid-cols-[8.5rem_1fr] gap-x-2 gap-y-0.5">
            <Row k="Connection">{r.connection.why}</Row>
            <Row k="Login">{r.auth.why}</Row>
          </dl>
        </section>
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-subtle">Location feed</h3>
          <dl className="grid grid-cols-[8.5rem_1fr] gap-x-2 gap-y-0.5">
            <Row k="Newest sample (OpenF1)">{when(l.newestSampleAt)}</Row>
            <Row k="Rows last received">{when(l.lastRowsAt)}</Row>
          </dl>
        </section>
        <section>
          <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-subtle">Polling</h3>
          <dl className="grid grid-cols-[8.5rem_1fr] gap-x-2 gap-y-0.5">
            <Row k="State">{p.state}</Row>
            <Row k="Server last attempt">{when(p.serverLastAttemptAt)}</Row>
            <Row k="Browser received">{when(p.browserReceivedAt)}</Row>
          </dl>
        </section>
        <p className="text-[10px] text-subtle">Developer diagnostics · development server only · reads the page&apos;s existing /api/live poll</p>
      </div>
    </details>
  );
}
