"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { SERIES_A, SERIES_B } from "@/components/drivers/charts";
import { niceTicks, TraceChart, type Trace } from "@/components/telemetry/TraceChart";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { TrackPath } from "@/lib/race/track";
import { lapDelta, lapTrace } from "@/lib/replay/compare";
import { deltaSwings, sectorBreakdown } from "@/lib/replay/laps";
import type { ReplayModel } from "@/lib/replay/model";
import { alignLap, byDistance, deltaTrace, interpAt, lapTime, smooth, type Channel } from "@/lib/telemetry/analysis";
import { fetchSessionTelemetry } from "@/lib/telemetry/client";
import type { SessionTelemetry } from "@/lib/telemetry/types";

const fmtS = (s: number | null) => (s == null ? "—" : s.toFixed(3));
const signed = (v: number | null, digits = 3) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`);
const km = (m: number) => `${(m / 1000).toFixed(2)} km`;

const CHANNELS: { channel: Channel; label: string; unit: string; height: number; stepped?: boolean; domain?: [number, number]; ticks?: number[]; format?: (v: number) => string }[] = [
  { channel: "speed", label: "Speed", unit: "km/h", height: 120 },
  { channel: "throttle", label: "Throttle", unit: "%", height: 64, domain: [0, 100], ticks: [0, 50, 100] },
  { channel: "brake", label: "Brake", unit: "on/off, as published", height: 40, stepped: true, domain: [0, 100], ticks: [0, 100], format: (v) => (v > 0 ? "On" : "Off") },
  { channel: "gear", label: "Gear", unit: "1–8", height: 64, stepped: true, domain: [1, 8], ticks: [2, 4, 6, 8] },
  { channel: "rpm", label: "Engine speed", unit: "rpm", height: 72 },
];

interface Props {
  model: ReplayModel;
  lapLength: number;
  a: number;
  b: number;
  codeA: string;
  codeB: string;
  /** Replay time (ms): drives the chart cursor while it is inside Driver A's chosen lap. */
  t: number;
  onSeek: (t: number) => void;
  path: TrackPath;
  toWorld: (x: number, y: number) => [number, number];
  /** Session whose fastest-lap telemetry exists (null = none exported). */
  telemetrySessionKey: number | null;
}

/**
 * Lap-distance mode: two chosen complete laps compared at the same distance along the circuit (never as simultaneous race positions).
 * Official: lap and sector times. Calculated: the running sector total, the delta along the lap, where it grew most. Car telemetry exists
 * only for each driver's fastest lap (Telemetry Lab export), so its traces appear only when those laps are chosen.
 */
export function LapAnalysis({ model, lapLength, a, b, codeA, codeB, t, onSeek, path, toWorld, telemetrySessionKey }: Props) {
  const timed = (i: number) => model.ds.drivers[i].laps.filter((l) => l[2] != null);
  const fastest = (i: number) => {
    let best: (typeof model.ds.drivers)[number]["laps"][number] | null = null;
    for (const l of timed(i)) if (!best || (l[2] as number) < (best[2] as number)) best = l;
    return best?.[0] ?? null;
  };
  const [lapA, setLapA] = useState<number | null>(() => fastest(a));
  const [lapB, setLapB] = useState<number | null>(() => fastest(b));
  const [hover, setHover] = useState<number | null>(null);
  const [tel, setTel] = useState<{ status: "none" | "loading" | "ok" | "error"; session?: SessionTelemetry; error?: string }>({ status: telemetrySessionKey == null ? "none" : "loading" });
  useEffect(() => {
    if (telemetrySessionKey == null) return;
    let live = true;
    fetchSessionTelemetry(telemetrySessionKey)
      .then((session) => live && setTel({ status: "ok", session }))
      .catch((e: unknown) => live && setTel({ status: "error", error: e instanceof Error ? e.message : "could not load" }));
    return () => {
      live = false;
    };
  }, [telemetrySessionKey]);

  const numA = model.ds.drivers[a].number;
  const numB = model.ds.drivers[b].number;
  const telA = tel.session?.laps.find((l) => l.driverNumber === numA) ?? null;
  const telB = tel.session?.laps.find((l) => l.driverNumber === numB) ?? null;
  const useTel = !!telA && !!telB && telA.lapNumber === lapA && telB.lapNumber === lapB;

  // Positions-based traces (always attempted) and, when the chosen laps have car data, the telemetry alignment.
  const ta = useMemo(() => (lapA != null ? lapTrace(model, a, lapA, lapLength) : null), [model, a, lapA, lapLength]);
  const tb = useMemo(() => (lapB != null ? lapTrace(model, b, lapB, lapLength) : null), [model, b, lapB, lapLength]);
  const telem = useMemo(() => {
    if (!useTel || !telA || !telB) return null;
    const rawA = alignLap(telA, path, toWorld);
    const rawB = alignLap(telB, path, toWorld);
    const A = byDistance(rawA, lapLength, 5);
    const B = byDistance(rawB, lapLength, 5);
    // Top speed from recorded samples within the lap (invalid ones already removed), never from the interpolated grid.
    const top = (r: typeof rawA) => Math.max(0, ...r.channels.speed.filter((v, i): v is number => v != null && r.t[i] >= 0 && r.t[i] <= r.lapDuration));
    return { A, B, delta: smooth(deltaTrace(A, B), 3), topA: top(rawA), topB: top(rawB) };
  }, [useTel, telA, telB, path, toWorld, lapLength]);
  const posDelta = useMemo(() => (ta && tb ? lapDelta(ta, tb, lapLength) : null), [ta, tb, lapLength]);
  const delta = telem ? { d: telem.A.d, delta: telem.delta, source: "car telemetry positions (about 4 Hz)" } : posDelta ? { ...posDelta, source: "recorded positions (about 1 Hz)" } : null;

  const lap = (i: number, n: number | null) => model.ds.drivers[i].laps.find((l) => l[0] === n);
  const la = lap(a, lapA);
  const lb = lap(b, lapB);
  const sectors = sectorBreakdown([la?.[3] ?? null, la?.[4] ?? null, la?.[5] ?? null], [lb?.[3] ?? null, lb?.[4] ?? null, lb?.[5] ?? null]);
  const swings = delta ? deltaSwings(delta.d, delta.delta) : null;

  // Replay -> chart: while the replay is inside A's chosen lap, the cursor marks where A is on it. Chart -> replay: picking a distance
  // seeks to the moment A was there. The replay clock stays the only source of time, so the two never feed each other in a loop.
  const follow = la && la[2] != null && ta && t >= la[1] && t <= la[1] + la[2] * 1000 ? interpAt(ta.t, ta.d, (t - la[1]) / 1000) : null;
  const pick = (x: number) => {
    if (!la || !ta) return;
    const s = interpAt(ta.d, ta.t, x);
    if (s != null) onSeek(la[1] + s * 1000);
  };

  if (!(lapLength > 0)) return <p className="text-xs text-muted">Lap comparison needs the circuit&apos;s generated layout, which this circuit does not have.</p>;
  const select = "h-8 w-full rounded-md border border-line-strong bg-surface-2 px-1.5 text-xs text-fg";
  const span = delta ? Math.max(0.2, ...delta.delta.map((v) => Math.abs(v ?? 0))) : 1;
  const atIdx = (x: number | null) => (x == null || !delta ? null : delta.delta[Math.min(delta.delta.length - 1, Math.round(x / (delta.d[1] - delta.d[0] || 1)))] ?? null);
  const cursorDelta = atIdx(hover);
  const xAxis = { ticks: niceTicks(0, lapLength, 4), format: (v: number) => `${(v / 1000).toFixed(1)} km` };

  return (
    <>
      <p className="text-xs text-muted">Two complete laps compared at the same distance along the circuit, not raced side by side. Δ is {codeB} minus {codeA}. Select a point on a chart to jump the replay to when {codeA} was there.</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {(
          [
            [a, codeA, lapA, setLapA, telA?.lapNumber],
            [b, codeB, lapB, setLapB, telB?.lapNumber],
          ] as const
        ).map(([i, code, value, set, telLap]) => (
          <label key={code} className="flex flex-col gap-1 text-xs text-muted">
            {code} lap
            <select className={select} value={value ?? ""} onChange={(e) => set(Number(e.target.value))}>
              {timed(i).map((l) => (
                <option key={l[0]} value={l[0]}>
                  Lap {l[0]} · {lapTime(l[2] as number)}
                  {l[0] === fastest(i) ? " · fastest" : ""}
                  {l[0] === telLap ? " · car data" : ""}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <table className="mt-2.5 w-full text-xs tabular-nums">
        <caption className="sr-only">Sector and lap times of the chosen laps</caption>
        <thead className="text-[10px] uppercase tracking-wider text-subtle">
          <tr>
            <th scope="col" className="pb-1 text-left font-medium">Official</th>
            <th scope="col" className="pb-1 text-right font-medium">{codeA}</th>
            <th scope="col" className="pb-1 text-right font-medium">{codeB}</th>
            <th scope="col" className="pb-1 text-right font-medium">Δ</th>
            <th scope="col" className="pb-1 text-right font-medium">
              Running <span className="normal-case tracking-normal">calc.</span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {[0, 1, 2].map((k) => (
            <tr key={k}>
              <th scope="row" className="py-1 text-left font-normal text-muted">Sector {k + 1}</th>
              <td className="py-1 text-right text-fg">{fmtS((la?.[k + 3] ?? null) as number | null)}</td>
              <td className="py-1 text-right text-fg">{fmtS((lb?.[k + 3] ?? null) as number | null)}</td>
              <td className={cn("py-1 text-right", sectors.delta[k] == null ? "text-muted" : (sectors.delta[k] as number) < 0 ? "text-success" : (sectors.delta[k] as number) > 0 ? "text-warning" : "text-muted")}>{signed(sectors.delta[k])}</td>
              <td className="py-1 text-right text-muted">{signed(sectors.cumulative[k])}</td>
            </tr>
          ))}
          <tr>
            <th scope="row" className="py-1 text-left font-normal text-muted">Lap</th>
            <td className="py-1 text-right text-fg">{la?.[2] != null ? lapTime(la[2]) : "—"}</td>
            <td className="py-1 text-right text-fg">{lb?.[2] != null ? lapTime(lb[2]) : "—"}</td>
            <td className="py-1 text-right text-muted">{la?.[2] != null && lb?.[2] != null ? signed(lb[2] - la[2]) : "—"}</td>
            <td />
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-subtle">Green: {codeB} faster in that sector. Running is the sum so far; it stops where a sector time was not published.</p>

      <div className="mt-3">
        {delta ? (
          <TraceChart
            label={`Gap along the lap, ${codeB} to ${codeA}`}
            unit="s, above 0 = B slower"
            height={110}
            xDomain={[0, lapLength]}
            yDomain={[-span * 1.1, span * 1.1]}
            yTicks={niceTicks(-span, span, 4)}
            yFormat={(v) => (v === 0 ? "0" : signed(v, 1))}
            reference={0}
            traces={[{ id: "d", color: SERIES_B, xs: delta.d, ys: delta.delta }]}
            hoverX={hover}
            onHover={setHover}
            followX={follow}
            onPick={pick}
            xAxis={telem ? undefined : xAxis}
            readout={cursorDelta != null ? [{ color: SERIES_B, text: `${codeB} ${signed(cursorDelta)} s at ${km(hover as number)}` }] : undefined}
            summary={`Calculated from ${delta.source}: time ${codeB} took to reach each distance minus ${codeA}'s.`}
          />
        ) : (
          <p className="text-xs text-warning">
            {!ta ? codeA : codeB} lap {(!ta ? lapA : lapB) ?? ""} cannot be aligned: its recorded positions have a gap of more than 5 s, so no trace is drawn. The sector times above are still official.
          </p>
        )}
        {delta && <p className="mt-1 text-[11px] text-subtle">Calculated from {delta.source}.</p>}
      </div>

      {telem &&
        CHANNELS.map((r, k) => {
          const traces: Trace[] = [
            { id: "a", color: SERIES_A, xs: telem.A.d, ys: telem.A.channels[r.channel], stepped: r.stepped },
            { id: "b", color: SERIES_B, xs: telem.B.d, ys: telem.B.channels[r.channel], stepped: r.stepped },
          ];
          const vals = [...telem.A.channels[r.channel], ...telem.B.channels[r.channel]].filter((v): v is number => v != null && v > 0);
          const dom: [number, number] = r.domain ?? (r.channel === "speed" ? [0, Math.ceil(Math.max(...vals, 50) / 50) * 50] : [Math.floor(Math.min(...vals) / 1000) * 1000, Math.ceil(Math.max(...vals) / 1000) * 1000]);
          const v = (tr: typeof telem.A) => (hover == null ? null : interpAt(tr.d, tr.channels[r.channel], hover, !!r.stepped));
          const fmt = (x: number | null) => (x == null ? "—" : r.channel === "brake" ? (x > 0 ? "On" : "Off") : String(Math.round(x)));
          return (
            <div key={r.channel} className="mt-2">
              <TraceChart
                label={r.label}
                unit={r.unit}
                height={r.height}
                xDomain={[0, lapLength]}
                yDomain={dom}
                yTicks={r.ticks ?? niceTicks(dom[0], dom[1], 3)}
                yFormat={r.format}
                traces={traces}
                hoverX={hover}
                onHover={setHover}
                followX={follow}
                onPick={pick}
                xAxis={k === CHANNELS.length - 1 ? xAxis : undefined}
                readout={hover != null ? [{ color: SERIES_A, text: `${codeA} ${fmt(v(telem.A))}` }, { color: SERIES_B, text: `${codeB} ${fmt(v(telem.B))}` }] : undefined}
                summary={`${r.label} of ${codeA} lap ${lapA} and ${codeB} lap ${lapB} against distance.`}
              />
            </div>
          );
        })}

      <section aria-labelledby="insights-heading" className="mt-3 rounded-md bg-surface-2/70 px-2.5 py-2">
        <h3 id="insights-heading" className="text-[11px] font-semibold uppercase tracking-wider text-subtle">
          Calculated from these laps
        </h3>
        <ul className="mt-1 space-y-1 text-xs text-muted">
          {sectors.delta.some((d) => d != null) && (
            <li>
              Sectors (official):{" "}
              {sectors.delta.map((d, k) => (d == null ? `S${k + 1} n/a` : `S${k + 1} ${d < 0 ? codeB : d > 0 ? codeA : "level"}${d !== 0 ? ` by ${Math.abs(d).toFixed(3)} s` : ""}`)).join(", ")}.
            </li>
          )}
          {swings?.gain && (
            <li>
              {codeB} gained most between {km(swings.gain.from)} and {km(swings.gain.to)} ({Math.abs(swings.gain.s).toFixed(2)} s).
            </li>
          )}
          {swings?.loss && (
            <li>
              {codeB} lost most between {km(swings.loss.from)} and {km(swings.loss.to)} ({swings.loss.s.toFixed(2)} s).
            </li>
          )}
          {telem && (
            <li>
              Highest recorded speed: {codeA} {telem.topA} km/h, {codeB} {telem.topB} km/h (samples about 4 Hz apart, so a peak between samples can be missed).
            </li>
          )}
        </ul>
        <p className="mt-1 text-[11px] text-subtle">These say where and how much, not why: the data cannot separate driving, set-up, tyres or traffic.</p>
      </section>

      <div className="mt-3 text-xs">
        {tel.status === "loading" && <p className="text-muted">Loading car telemetry…</p>}
        {tel.status === "none" && <p className="text-muted">No car telemetry is exported for this race, so only timing and position comparisons are shown.</p>}
        {tel.status === "error" && <p className="text-warning">Car telemetry could not be loaded: {tel.error}. Timing and position comparisons still work.</p>}
        {tel.status === "ok" && !useTel && (
          <div className="rounded-md border border-white/10 px-2.5 py-2 text-muted">
            {telA && telB ? (
              <>
                Car telemetry (speed, throttle, brake, gear, RPM) exists only for each driver&apos;s fastest valid lap: {codeA} lap {telA.lapNumber}, {codeB} lap {telB.lapNumber}.
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-2 h-7 w-full text-xs"
                  onClick={() => {
                    setLapA(telA.lapNumber);
                    setLapB(telB.lapNumber);
                  }}
                >
                  Compare those laps with telemetry
                </Button>
              </>
            ) : (
              <>No car telemetry was exported for {!telA ? codeA : codeB} in this race.</>
            )}
          </div>
        )}
        {telemetrySessionKey != null && (
          <Link href={`/telemetry?session=${telemetrySessionKey}&a=${numA}&b=${numB}`} className="mt-2 inline-block font-medium text-fg underline decoration-white/30 underline-offset-4 hover:decoration-white">
            Open these drivers in the Telemetry Lab
          </Link>
        )}
      </div>
    </>
  );
}
