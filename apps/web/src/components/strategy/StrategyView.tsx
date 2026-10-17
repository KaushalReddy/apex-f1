"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { niceTicks, TraceChart, type Trace } from "@/components/telemetry/TraceChart";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import type { StrategyData } from "@/lib/strategy/load";
import { positionAfter, whatIf } from "@/lib/strategy/strategy";
import { lapTime } from "@/lib/telemetry/analysis";

/** Tyre compound colours (the sport's conventional colours: red soft, yellow medium, white hard, green intermediate, blue wet). */
export const COMPOUND: Record<string, { colour: string; label: string; short: string }> = {
  SOFT: { colour: "#e8403a", label: "Soft", short: "S" },
  MEDIUM: { colour: "#f2c94c", label: "Medium", short: "M" },
  HARD: { colour: "#e6e8eb", label: "Hard", short: "H" },
  INTERMEDIATE: { colour: "#3ecf8e", label: "Intermediate", short: "I" },
  WET: { colour: "#3d9be0", label: "Wet", short: "W" },
};
const UNKNOWN = { colour: "#6b7380", label: "Not published", short: "?" };
export const compound = (c: string | null) => (c && COMPOUND[c]) || UNKNOWN;
const PERIOD = { "Safety Car": "rgb(245 184 61 / 0.18)", VSC: "rgb(245 184 61 / 0.1)", "Red flag": "rgb(255 122 112 / 0.18)" } as const;
const signed = (v: number, d = 2) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(d)}`;

export function StrategyView({ data, initialDriver, replayHref }: { data: StrategyData; initialDriver: string | null; replayHref: string | null }) {
  const order = useMemo(() => {
    const pos = new Map(data.finals.map((f) => [f.number, f.position]));
    return [...data.drivers].sort((a, b) => (pos.get(a.number) ?? 99) - (pos.get(b.number) ?? 99));
  }, [data]);
  const [sel, setSel] = useState<number>(() => order.find((d) => d.code === initialDriver?.toUpperCase())?.number ?? order[0]?.number);
  const driver = order.find((d) => d.number === sel) ?? order[0];
  const pos = new Map(data.finals.map((f) => [f.number, f]));
  const L = Math.max(1, data.totalLaps);

  return (
    <div className="space-y-6">
      {/* Field overview: every driver's stints over the race. */}
      <section aria-labelledby="stints-heading" className="rounded-lg border border-line bg-surface p-3 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="stints-heading" className="text-sm font-semibold">
            Tyre stints, in finishing order
          </h2>
          <ul className="flex flex-wrap gap-3 text-xs text-muted" aria-label="Legend">
            {[...Object.values(COMPOUND), UNKNOWN].map((c) => (
              <li key={c.label} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2.5 w-4 rounded-sm" style={{ backgroundColor: c.colour }} />
                {c.label}
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-4 rounded-sm bg-warning/30" />
              Safety Car / VSC
            </li>
            <li className="flex items-center gap-1.5">
              <span aria-hidden="true" className="h-2.5 w-4 rounded-sm border border-dashed border-fg/70" />
              Change without a pit record
            </li>
          </ul>
        </div>
        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[36rem]">
            <div className="relative ml-24 h-5 text-[10px] tabular-nums text-subtle" aria-hidden="true">
              {niceTicks(1, L, 8)
                .filter((v) => v >= 1)
                .map((v) => (
                  <span key={v} className="absolute -translate-x-1/2" style={{ left: `${((v - 0.5) / L) * 100}%` }}>
                    L{v}
                  </span>
                ))}
            </div>
            <ol className="relative">
              {/* Neutralised periods behind every row. */}
              <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-24 right-0">
                {data.periods.map((p, i) => (
                  <span key={i} className="absolute inset-y-0" style={{ left: `${((p.fromLap - 1) / L) * 100}%`, width: `${(Math.max(1, p.toLap - p.fromLap + 1) / L) * 100}%`, backgroundColor: PERIOD[p.kind] }} title={p.kind} />
                ))}
              </div>
              {order.map((d) => {
                const f = pos.get(d.number);
                return (
                  <li key={d.number}>
                    <button
                      type="button"
                      onClick={() => setSel(d.number)}
                      aria-pressed={d.number === driver?.number}
                      aria-label={`${d.code}: ${d.stints.map((s) => `${compound(s.compound).label} laps ${s.lapStart}–${s.lapEnd}`).join(", ")}`}
                      className={cn("motion-interactive relative flex h-7 w-full items-center rounded-sm text-left hover:bg-surface-2", d.number === driver?.number && "bg-surface-2")}
                    >
                      <span className="flex w-24 shrink-0 items-center gap-1.5 pl-1 text-xs">
                        <span className="w-6 tabular-nums text-subtle">{f ? `P${f.position}` : ""}</span>
                        <span aria-hidden="true" className="h-3 w-0.5 rounded-sm" style={{ backgroundColor: d.colour ?? "#c9ced6" }} />
                        <span className="font-semibold">{d.code}</span>
                      </span>
                      <span className="relative h-4 flex-1">
                        {d.stints.map((s) => {
                          const c = compound(s.compound);
                          return (
                            <span
                              key={s.stint}
                              className={cn("absolute inset-y-0 flex items-center justify-center rounded-[3px] text-[10px] font-bold text-bg", s.pitMatched === false && "outline-dashed outline-1 outline-offset-1 outline-fg/70")}
                              style={{ left: `calc(${((s.lapStart - 1) / L) * 100}% + 1px)`, width: `calc(${(s.laps / L) * 100}% - 2px)`, backgroundColor: c.colour }}
                            >
                              {s.laps / L > 0.06 ? c.short : ""}
                            </span>
                          );
                        })}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">Stints as published by OpenF1. Select a driver for their stints, pace and a what-if.</p>
      </section>

      {driver && <DriverDetail key={driver.number} data={data} number={driver.number} replayHref={replayHref} />}
    </div>
  );
}

function DriverDetail({ data, number, replayHref }: { data: StrategyData; number: number; replayHref: string | null }) {
  const d = data.drivers.find((x) => x.number === number)!;
  const stops = d.stints.slice(0, -1).map((s, k) => ({ k, lap: d.stints[k + 1].lapStart, from: s, to: d.stints[k + 1] }));
  const [stop, setStop] = useState(0);
  const st = stops[stop];
  const [newLap, setNewLap] = useState<number>(() => st?.lap ?? 1);
  const [hover, setHover] = useState<number | null>(null);
  const result = st ? whatIf(d.stints, st.k, newLap) : null;
  const place = result ? positionAfter(data.finals, d.number, result.delta) : null;

  // Pace chart: comparable laps per stint (in the compound colour) and each stint's fitted line (neutral, thinner reading).
  const traces: Trace[] = [];
  const all: number[] = [];
  for (const s of d.stints) {
    const xs = s.points.map((p) => s.lapStart + (p[0] - (s.ageAtStart ?? 0)));
    traces.push({ id: `s${s.stint}`, color: compound(s.compound).colour, xs, ys: s.points.map((p) => p[1]) });
    all.push(...s.points.map((p) => p[1]));
    if (s.fit && xs.length) {
      const fx = [xs[0], xs[xs.length - 1]];
      traces.push({ id: `f${s.stint}`, color: "#929ba8", xs: fx, ys: fx.map((x) => s.fit!.intercept + s.fit!.slope * ((s.ageAtStart ?? 0) + (x - s.lapStart))) });
    }
  }
  const lo = all.length ? Math.floor(Math.min(...all)) : 80;
  const hi = all.length ? Math.ceil(Math.max(...all)) : 100;

  return (
    <section aria-labelledby="driver-heading" className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="min-w-0 rounded-lg border border-line bg-surface p-3 sm:p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="driver-heading" className="flex items-center gap-2 text-base font-semibold">
            <span aria-hidden="true" className="h-4 w-1 rounded-sm" style={{ backgroundColor: d.colour ?? "#c9ced6" }} />
            {d.name ?? d.code} <span className="text-sm font-normal text-muted">{d.team}</span>
          </h2>
          {replayHref && (
            <Link href={replayHref} className="text-xs font-medium text-fg underline decoration-white/30 underline-offset-4 hover:decoration-white">
              Watch this race in the replay
            </Link>
          )}
        </div>
        <table className="mt-3 w-full text-xs tabular-nums">
          <caption className="sr-only">Stints of {d.code}</caption>
          <thead className="text-[10px] uppercase tracking-wider text-subtle">
            <tr>
              <th scope="col" className="pb-1 text-left font-medium">Stint</th>
              <th scope="col" className="pb-1 text-right font-medium">Laps</th>
              <th scope="col" className="pb-1 text-right font-medium">Tyre age at start</th>
              <th scope="col" className="pb-1 text-right font-medium">
                Degradation <span className="normal-case tracking-normal">calc.</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {d.stints.map((s) => {
              const c = compound(s.compound);
              return (
                <tr key={s.stint}>
                  <th scope="row" className="py-1.5 text-left font-normal">
                    <span className="inline-flex items-center gap-1.5">
                      <span aria-hidden="true" className="size-2.5 rounded-full" style={{ backgroundColor: c.colour }} />
                      {c.label}
                      {s.pitMatched === false && <span className="text-[10px] text-warning">no pit record</span>}
                    </span>
                  </th>
                  <td className="py-1.5 text-right">
                    {s.lapStart}–{s.lapEnd} ({s.laps})
                  </td>
                  <td className="py-1.5 text-right">{s.ageAtStart ?? "—"}</td>
                  <td className="py-1.5 text-right">
                    {s.fit ? (
                      <>
                        {signed(s.fit.slope, 3)} s/lap <span className="text-subtle">± {s.fit.slopeSe.toFixed(3)} · {s.fit.n} laps</span>
                      </>
                    ) : (
                      <span className="text-subtle">too few comparable laps</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-1.5 text-[11px] text-subtle">
          Degradation is the slope of lap time against tyre age over comparable laps (no lap 1, pit in/out, Safety Car, VSC or red-flag laps, and not a stint&apos;s first lap), ± its standard error. It
          includes fuel burn-off, which this data cannot separate, so actual tyre wear is somewhat higher.
        </p>
        <div className="mt-3">
          {all.length ? (
            <TraceChart
              label="Lap time on comparable laps"
              unit="s; grey = fitted trend"
              height={170}
              xDomain={[1, data.totalLaps]}
              yDomain={[lo, hi]}
              yTicks={niceTicks(lo, hi, 4)}
              yFormat={(v) => lapTime(v)}
              traces={traces}
              hoverX={hover}
              onHover={(x) => setHover(x == null ? null : Math.round(x))}
              xAxis={{ ticks: niceTicks(1, data.totalLaps, 6).filter((v) => v >= 1), format: (v) => `L${v}` }}
              readout={
                hover != null
                  ? [{ color: "#929ba8", text: (() => { const l = d.laps.find((x) => x.lap === hover); return l?.lapS != null ? `Lap ${hover} ${lapTime(l.lapS)}${l.pit ? " (pit)" : ""}${l.neutralisedBy.length ? ` (${l.neutralisedBy.join(", ")})` : ""}` : `Lap ${hover} —`; })() }]
                  : undefined
              }
              summary={`Comparable lap times of ${d.code} by lap, coloured by tyre, with each stint's fitted trend.`}
            />
          ) : (
            <p className="text-xs text-muted">No comparable laps to chart.</p>
          )}
        </div>
      </div>

      <aside aria-labelledby="whatif-heading" className="rounded-lg border border-dashed border-warning/50 bg-surface p-3 sm:p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 id="whatif-heading" className="text-sm font-semibold">
            What if?
          </h2>
          <Badge tone="warning">Simulation</Badge>
        </div>
        {stops.length === 0 ? (
          <p className="mt-2 text-xs text-muted">{d.code} made no stop in the published stints, so there is nothing to move.</p>
        ) : (
          <>
            {stops.length > 1 && (
              <label className="mt-3 flex flex-col gap-1 text-xs text-muted">
                Stop
                <select
                  className="h-8 rounded-md border border-line-strong bg-surface-2 px-1.5 text-xs text-fg"
                  value={stop}
                  onChange={(e) => {
                    const k = Number(e.target.value);
                    setStop(k);
                    setNewLap(stops[k].lap);
                  }}
                >
                  {stops.map((x) => (
                    <option key={x.k} value={x.k}>
                      Stop {x.k + 1}: {compound(x.from.compound).label} → {compound(x.to.compound).label}, onto lap {x.lap}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {st && (
              <label className="mt-3 block text-xs text-muted">
                Start the {compound(st.to.compound).label.toLowerCase()} stint on lap <span className="font-semibold tabular-nums text-fg">{newLap}</span> instead of {st.lap}
                <input
                  type="range"
                  min={st.from.lapStart + 1}
                  max={st.to.lapEnd}
                  value={newLap}
                  onChange={(e) => setNewLap(Number(e.target.value))}
                  className="mt-1.5 block w-full"
                  aria-valuetext={`Lap ${newLap}`}
                />
              </label>
            )}
            <div className="mt-3 rounded-md bg-surface-2/70 px-3 py-2.5 text-sm" aria-live="polite">
              {!st || newLap === st.lap ? (
                <p className="text-muted">Move the slider to try a different lap.</p>
              ) : !result ? (
                <p className="text-muted">
                  Not enough comparable laps on one of these two stints to estimate their pace, so no simulation is shown.
                </p>
              ) : (
                <>
                  <p>
                    <span className="font-semibold tabular-nums text-fg">{signed(result.delta, 1)} s</span> over the race{" "}
                    <span className="text-muted">
                      (range {signed(result.low, 1)} to {signed(result.high, 1)} s)
                    </span>
                  </p>
                  {place ? (
                    <p className="mt-1 text-xs text-muted">
                      Others unchanged,{" "}
                      {place.to === place.from ? (
                        <>
                          still <span className="font-semibold text-fg">P{place.from}</span> at the finish.
                        </>
                      ) : (
                        <>
                          finishing <span className="font-semibold text-fg">P{place.to}</span> instead of P{place.from}.
                        </>
                      )}
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-muted">No finishing-position estimate: {d.code} was lapped or has no published final gap.</p>
                  )}
                </>
              )}
            </div>
            <ul className="mt-3 list-disc space-y-1 pl-4 text-[11px] leading-relaxed text-subtle">
              <li>A model, not what happened: each stint&apos;s pace is the fitted line from {d.code}&apos;s own comparable laps; the range uses the slopes ± one standard error.</li>
              <li>Same number of stops, so the pit-lane time cancels out.</li>
              <li>Not modelled: traffic, Safety Cars, tyre warm-up, track and fuel changes, other teams reacting.</li>
            </ul>
          </>
        )}
      </aside>
    </section>
  );
}
