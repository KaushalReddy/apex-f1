"use client";

import { useMemo, useState } from "react";
import { SERIES_A, SERIES_B } from "@/components/drivers/charts";
import { niceTicks, TraceChart } from "@/components/telemetry/TraceChart";
import { cn } from "@/lib/cn";
import { comparable, consistency, lapRows } from "@/lib/replay/laps";
import type { ReplayModel } from "@/lib/replay/model";
import { lapTime } from "@/lib/telemetry/analysis";

const signed = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(3)}`;

/**
 * Lap-by-lap comparison: official lap times for both drivers, with pit in/out and neutralised (Safety Car, VSC, red flag) laps marked and
 * left out of the chart and the consistency figure, since they are slow for reasons other than pace. Selecting a lap seeks the replay.
 */
export function LapsTab({ model, a, b, codeA, codeB, t, onSeek }: { model: ReplayModel; a: number; b: number; codeA: string; codeB: string; t: number; onSeek: (t: number) => void }) {
  const rowsA = useMemo(() => lapRows(model, a), [model, a]);
  const rowsB = useMemo(() => lapRows(model, b), [model, b]);
  const [hover, setHover] = useState<number | null>(null);
  const maxLap = Math.max(1, ...rowsA.map((r) => r.lap), ...rowsB.map((r) => r.lap));
  const series = (rows: typeof rowsA) => {
    const ys: (number | null)[] = Array.from({ length: maxLap + 1 }, () => null);
    for (const r of rows) if (comparable(r)) ys[r.lap] = r.lapS;
    return ys;
  };
  const ya = series(rowsA);
  const yb = series(rowsB);
  const xs = ya.map((_, i) => i);
  const vals = [...ya, ...yb].filter((v): v is number => v != null);
  const ca = consistency(rowsA);
  const cb = consistency(rowsB);
  const byLapB = new Map(rowsB.map((r) => [r.lap, r]));
  const lapAt = (n: number) => Math.round(n);
  const current = rowsA.filter((r) => r.start <= t).at(-1)?.lap ?? null;

  if (!vals.length) return <p className="text-xs text-muted">Neither driver has comparable timed laps (all laps are pit, Safety Car or untimed).</p>;
  const lo = Math.floor(Math.min(...vals));
  const hi = Math.ceil(Math.max(...vals));

  return (
    <>
      <p className="text-xs text-muted">Official lap times. Pit in/out laps, laps under Safety Car, VSC or red flag, and lap 1 are marked and left out of the chart and the consistency figure.</p>
      <div className="mt-2">
        <TraceChart
          label="Lap time"
          unit="s"
          height={140}
          xDomain={[1, maxLap]}
          yDomain={[lo, hi]}
          yTicks={niceTicks(lo, hi, 4)}
          yFormat={(v) => lapTime(v)}
          traces={[
            { id: "a", color: SERIES_A, xs, ys: ya },
            { id: "b", color: SERIES_B, xs, ys: yb },
          ]}
          hoverX={hover}
          onHover={(x) => setHover(x == null ? null : lapAt(x))}
          followX={current}
          onPick={(x) => {
            const r = rowsA.find((q) => q.lap === lapAt(x));
            if (r) onSeek(r.start);
          }}
          readout={
            hover != null
              ? [
                  { color: SERIES_A, text: `${codeA} ${ya[hover] != null ? lapTime(ya[hover] as number) : "—"}` },
                  { color: SERIES_B, text: `${codeB} ${yb[hover] != null ? lapTime(yb[hover] as number) : "—"}` },
                ]
              : undefined
          }
          xAxis={{ ticks: niceTicks(1, maxLap, 5).filter((v) => v >= 1), format: (v) => `L${v}` }}
          summary={`Comparable lap times of ${codeA} and ${codeB} by lap number.`}
        />
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
        {(
          [
            [codeA, ca, SERIES_A],
            [codeB, cb, SERIES_B],
          ] as const
        ).map(([code, c, color]) => (
          <div key={code} className="rounded-md bg-surface-2/70 px-2.5 py-1.5">
            <dt className="flex items-center gap-1.5 text-muted">
              <span aria-hidden="true" className="h-0.5 w-3 rounded-full" style={{ backgroundColor: color }} />
              {code} consistency <span className="text-[10px] text-subtle">calc.</span>
            </dt>
            <dd className="mt-0.5 tabular-nums text-fg">{c ? `${lapTime(c.meanS)} ± ${c.sdS.toFixed(3)} s (${c.laps} laps)` : "Fewer than 3 comparable laps"}</dd>
          </div>
        ))}
      </dl>
      <table className="mt-2.5 w-full text-xs tabular-nums">
        <caption className="sr-only">Lap times of both drivers; select a lap to go there in the replay</caption>
        <thead className="text-[10px] uppercase tracking-wider text-subtle">
          <tr>
            <th scope="col" className="pb-1 text-left font-medium">Lap</th>
            <th scope="col" className="pb-1 text-right font-medium">{codeA}</th>
            <th scope="col" className="pb-1 text-right font-medium">{codeB}</th>
            <th scope="col" className="pb-1 text-right font-medium">Δ</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/10">
          {rowsA.map((r) => {
            const rb = byLapB.get(r.lap);
            const flag = (x: typeof r | undefined) => (x ? [x.pit && "pit", ...x.neutralisedBy].filter(Boolean).join(", ") : "");
            const flags = [...new Set([flag(r), flag(rb)].filter(Boolean))].join(" · ");
            return (
              <tr key={r.lap} className={cn(current === r.lap && "bg-surface-2/70")}>
                <th scope="row" className="py-1 text-left font-normal">
                  <button type="button" onClick={() => onSeek(r.start)} className="text-muted underline decoration-white/20 underline-offset-2 hover:text-fg" aria-label={`Go to lap ${r.lap}`}>
                    {r.lap}
                  </button>
                  {flags && <span className="ml-1.5 text-[10px] text-subtle">{flags}</span>}
                </th>
                <td className="py-1 text-right text-fg">{r.lapS != null ? lapTime(r.lapS) : "—"}</td>
                <td className="py-1 text-right text-fg">{rb?.lapS != null ? lapTime(rb.lapS) : "—"}</td>
                <td className={cn("py-1 text-right", r.lapS != null && rb?.lapS != null ? (rb.lapS < r.lapS ? "text-success" : "text-muted") : "text-muted")}>
                  {r.lapS != null && rb?.lapS != null ? signed(rb.lapS - r.lapS) : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-subtle">Δ is {codeB} minus {codeA}; green where {codeB} was faster. A lap-time difference is not the gap between the cars on track.</p>
    </>
  );
}
