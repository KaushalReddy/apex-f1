"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { ErrorBoundary } from "@/components/circuit/ErrorBoundary";
import { SERIES_A, SERIES_B } from "@/components/drivers/charts";
import { TeamMarker } from "@/components/data/team-marker";
import { centerlineToWorld, createWorldTransform } from "@/lib/circuit/transform";
import type { CircuitGeometry } from "@/lib/circuit/types";
import { cn } from "@/lib/cn";
import { createTrackPath, wrap01 } from "@/lib/race/track";
import { alignLap, byDistance, deltaTrace, distanceAtTime, interpAt, lapTime, smooth, valuesAtTime, type Channel } from "@/lib/telemetry/analysis";
import type { LapTelemetry } from "@/lib/telemetry/types";
import { useWebGL } from "@/lib/use-client-env";
import { niceTicks, TraceChart, type Trace } from "./TraceChart";

const Scene = dynamic(() => import("./TelemetryScene"), {
  ssr: false,
  loading: () => <p className="flex h-full items-center justify-center text-sm text-muted">Loading the circuit…</p>,
});

type Axis = "distance" | "time";

const signed = (v: number, digits = 3) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)}`;

const ROWS: { channel: Channel; label: string; unit: string; height: number; stepped?: boolean; domain?: [number, number]; ticks?: number[]; format?: (v: number) => string }[] = [
  { channel: "speed", label: "Speed", unit: "km/h", height: 168 },
  { channel: "throttle", label: "Throttle", unit: "%", height: 84, domain: [0, 100], ticks: [0, 50, 100] },
  { channel: "brake", label: "Brake", unit: "on/off, as published", height: 44, stepped: true, domain: [0, 100], ticks: [0, 100], format: (v) => (v > 0 ? "On" : "Off") },
  { channel: "gear", label: "Gear", unit: "1–8", height: 84, stepped: true, domain: [1, 8], ticks: [2, 4, 6, 8] },
  { channel: "rpm", label: "Engine speed", unit: "rpm", height: 96 },
];

interface Props {
  a: LapTelemetry;
  b: LapTelemetry;
  geometry: CircuitGeometry | null;
}

export function TelemetryLab({ a, b, geometry }: Props) {
  const webgl = useWebGL();
  // One world frame for projection and drawing: the transform and centerline the circuit scene builds (as in the race view).
  const frame = useMemo(() => {
    if (!geometry) return null;
    const transform = createWorldTransform(geometry);
    const path = createTrackPath(centerlineToWorld(geometry, transform));
    const toWorld = (x: number, y: number): [number, number] => {
      const w = transform.toWorld(x, y, transform.origin[2]);
      return [w[0], w[2]];
    };
    return { path, toWorld };
  }, [geometry]);
  const A = useMemo(() => alignLap(a, frame?.path ?? null, frame?.toWorld ?? null), [a, frame]);
  const B = useMemo(() => alignLap(b, frame?.path ?? null, frame?.toWorld ?? null), [b, frame]);
  const [axisChoice, setAxis] = useState<Axis>("distance");
  const axis: Axis = frame ? axisChoice : "time";
  const [hoverX, setHoverX] = useState<number | null>(null);

  const L = frame?.path.length ?? 0;
  const dist = useMemo(() => (frame ? { a: byDistance(A, L, 5), b: byDistance(B, L, 5) } : null), [A, B, L, frame]);
  const delta = useMemo(() => (dist ? smooth(deltaTrace(dist.a, dist.b), 3) : null), [dist]);

  const xDomain: [number, number] = axis === "distance" ? [0, L] : [0, Math.max(a.lapDuration, b.lapDuration)];
  const traces = (ch: Channel, stepped?: boolean): Trace[] =>
    axis === "distance" && dist
      ? [
          { id: "a", color: SERIES_A, xs: dist.a.d, ys: dist.a.channels[ch], stepped },
          { id: "b", color: SERIES_B, xs: dist.b.d, ys: dist.b.channels[ch], stepped },
        ]
      : [
          { id: "a", color: SERIES_A, xs: A.t, ys: A.channels[ch], stepped },
          { id: "b", color: SERIES_B, xs: B.t, ys: B.channels[ch], stepped },
        ];

  // Readout and 3D markers at the cursor. Both cars are shown at the SAME elapsed lap time: in distance mode, A's time at the cursor.
  const cursor = useMemo(() => {
    if (hoverX == null) return null;
    if (axis === "distance" && dist) {
      const pick = (t: typeof dist.a, ch: Channel, stepped: boolean) => interpAt(t.d, t.channels[ch], hoverX, stepped);
      const tA = interpAt(dist.a.d, dist.a.time, hoverX);
      const tB = interpAt(dist.b.d, dist.b.time, hoverX);
      const vals = (t: typeof dist.a) => Object.fromEntries(ROWS.map((r) => [r.channel, pick(t, r.channel, !!r.stepped)])) as Record<Channel, number | null>;
      const bDist = tA == null ? null : distanceAtTime(B, tA);
      return {
        label: `${(hoverX / 1000).toFixed(2)} km from the line`,
        a: vals(dist.a),
        b: vals(dist.b),
        gap: tA != null && tB != null ? tB - tA : null,
        elapsed: tA,
        progress: { a: wrap01(hoverX / L), b: bDist == null ? null : wrap01(bDist / L) },
      };
    }
    const dA = distanceAtTime(A, hoverX);
    const dB = distanceAtTime(B, hoverX);
    return {
      label: `${hoverX.toFixed(2)} s into the lap`,
      a: valuesAtTime(A, hoverX),
      b: valuesAtTime(B, hoverX),
      gap: null,
      elapsed: hoverX,
      progress: { a: dA == null || !L ? null : wrap01(dA / L), b: dB == null || !L ? null : wrap01(dB / L) },
    };
  }, [hoverX, axis, dist, A, B, L]);

  // Axes and summaries from validated samples only (invalid ones are already null in the aligned channels).
  const top = (l: typeof A) => Math.max(0, ...l.channels.speed.map((v) => v ?? 0));
  const maxSpeed = Math.max(top(A), top(B));
  const rpms = [...A.channels.rpm, ...B.channels.rpm].filter((v): v is number => v != null && v > 0);
  const rpmLo = Math.floor(Math.min(...rpms) / 1000) * 1000;
  const rpmHi = Math.ceil(Math.max(...rpms) / 1000) * 1000;
  const deltaAbs = delta ? Math.max(0.05, ...delta.map((v) => Math.abs(v ?? 0))) : 0.1;
  const xTicks = axis === "distance" ? niceTicks(0, L, 6) : niceTicks(0, xDomain[1], 6);
  const xFormat = axis === "distance" ? (v: number) => `${(v / 1000).toFixed(1)} km` : (v: number) => `${v} s`;
  const drivers = [
    { key: "a" as const, lap: a, color: SERIES_A },
    { key: "b" as const, lap: b, color: SERIES_B },
  ];
  const name = (l: LapTelemetry) => l.acronym ?? `#${l.driverNumber}`;
  const read = (ch: Channel) =>
    cursor
      ? [
          { color: SERIES_A, text: `${name(a)} ${fmt(ch, cursor.a[ch])}` },
          { color: SERIES_B, text: `${name(b)} ${fmt(ch, cursor.b[ch])}` },
        ]
      : undefined;
  const fmt = (ch: Channel, v: number | null) => (v == null ? "—" : ch === "brake" ? (v > 0 ? "On" : "Off") : ch === "speed" || ch === "rpm" || ch === "throttle" ? String(Math.round(v)) : String(v));

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <section aria-label="Telemetry traces" className="min-w-0 rounded-lg border border-line bg-surface p-3 sm:p-4">
        {/* Lap summary: lap times, gap and sectors as published; the faster sector of each pair is emphasised. */}
        <table className="w-full text-sm tabular-nums">
          <caption className="sr-only">Lap times and sectors</caption>
          <thead className="text-[11px] uppercase tracking-wider text-subtle">
            <tr>
              <th scope="col" className="pb-1.5 text-left font-medium">Driver</th>
              <th scope="col" className="pb-1.5 text-right font-medium">Lap</th>
              {[1, 2, 3].map((s) => (
                <th key={s} scope="col" className="hidden pb-1.5 text-right font-medium sm:table-cell">S{s}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {drivers.map(({ key, lap, color }) => {
              const other = key === "a" ? b : a;
              return (
                <tr key={key} className="border-t border-line">
                  <th scope="row" className="py-1.5 text-left font-normal">
                    <span className="flex items-center gap-2">
                      <span aria-hidden="true" className="h-0.5 w-4 rounded-full" style={{ backgroundColor: color }} />
                      <span className="font-semibold text-fg">{name(lap)}</span>
                      <span className="hidden items-center gap-1.5 text-muted sm:inline-flex">
                        {lap.teamColour && <TeamMarker color={lap.teamColour} />}
                        {lap.team ?? "—"}
                      </span>
                      <span className="text-xs text-subtle">lap {lap.lapNumber}</span>
                    </span>
                  </th>
                  <td className={cn("py-1.5 text-right", lap.lapDuration <= other.lapDuration && "font-semibold text-fg")}>
                    {lapTime(lap.lapDuration)}
                    {key === "b" && <span className="ml-2 text-xs text-muted">{signed(b.lapDuration - a.lapDuration)}</span>}
                  </td>
                  {lap.sectors.map((s, i) => (
                    <td key={i} className={cn("hidden py-1.5 text-right sm:table-cell", s != null && other.sectors[i] != null && s <= (other.sectors[i] as number) ? "font-semibold text-fg" : "text-muted")}>
                      {s == null ? "—" : s.toFixed(3)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>

        {[
          { lap: a, al: A },
          { lap: b, al: B },
        ]
          .filter(({ al }) => al.invalidSeconds > 0.5)
          .map(({ lap, al }) => (
            <p key={lap.driverNumber} role="note" className="mt-2 text-xs leading-relaxed text-muted">
              <span className="font-medium text-warning">
                {name(lap)}: no valid car data for {al.invalidSeconds.toFixed(1)} s
              </span>{" "}
              ({al.invalidRanges.map(([f, e]) => `${f.toFixed(1)}–${e.toFixed(1)} s`).join(", ")}); the feed sent placeholder values, shown as gaps.
            </p>
          ))}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <div role="radiogroup" aria-label="Horizontal axis" className="inline-flex rounded-md border border-line p-0.5">
            {(["distance", "time"] as const).map((v) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={axis === v}
                disabled={v === "distance" && !frame}
                title={v === "distance" && !frame ? "Distance needs the circuit's generated layout, which this circuit does not have" : undefined}
                onClick={() => {
                  setAxis(v);
                  setHoverX(null);
                }}
                className={cn(
                  "motion-interactive h-8 rounded-[5px] px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50",
                  axis === v ? "bg-surface-3 text-fg" : "text-muted hover:text-fg",
                )}
              >
                {v === "distance" ? "Distance" : "Time"}
              </button>
            ))}
          </div>
          <p aria-live="polite" className="min-h-5 text-xs text-muted tabular-nums">
            {cursor ? (
              <>
                {cursor.label}
                {cursor.gap != null && (
                  <span className="ml-2">
                    {name(b)} {cursor.gap >= 0 ? "behind" : "ahead"} by <span className="text-fg">{Math.abs(cursor.gap).toFixed(3)} s</span>
                  </span>
                )}
              </>
            ) : (
              "Point at a trace (or focus it and use the arrow keys) to read values"
            )}
          </p>
        </div>

        <div className="mt-2 space-y-3">
          <TraceChart
            label="Speed"
            unit="km/h"
            height={168}
            xDomain={xDomain}
            yDomain={[0, Math.ceil(maxSpeed / 50) * 50]}
            yTicks={niceTicks(0, Math.ceil(maxSpeed / 50) * 50, 4)}
            traces={traces("speed")}
            readout={read("speed")}
            hoverX={hoverX}
            onHover={setHoverX}
            summary={`${name(a)} top speed ${top(A)} km/h, ${name(b)} ${top(B)} km/h.`}
          />
          {axis === "distance" && delta && dist && (
            <TraceChart
              label={`Gap, ${name(b)} to ${name(a)}`}
              unit="s, above 0 = behind"
              height={96}
              xDomain={xDomain}
              yDomain={[-deltaAbs * 1.1, deltaAbs * 1.1]}
              yTicks={niceTicks(-deltaAbs, deltaAbs, 4)}
              yFormat={(v) => (v === 0 ? "0" : signed(v, 1))}
              reference={0}
              traces={[{ id: "delta", color: SERIES_B, xs: dist.a.d, ys: delta }]}
              readout={cursor?.gap != null ? [{ color: SERIES_B, text: `${name(b)} ${signed(cursor.gap)} s` }] : undefined}
              hoverX={hoverX}
              onHover={setHoverX}
              summary={`Derived: time ${name(b)} took to reach each distance minus ${name(a)}'s, averaged over 35 m.`}
            />
          )}
          {ROWS.slice(1).map((r, i, rows) => (
            <TraceChart
              key={r.channel}
              label={r.label}
              unit={r.unit}
              height={r.height}
              xDomain={xDomain}
              yDomain={r.domain ?? [rpmLo, rpmHi]}
              yTicks={r.ticks ?? niceTicks(rpmLo, rpmHi, 3)}
              yFormat={r.format}
              traces={traces(r.channel, r.stepped)}
              readout={read(r.channel)}
              hoverX={hoverX}
              onHover={setHoverX}
              xAxis={i === rows.length - 1 ? { ticks: xTicks, format: xFormat } : undefined}
              summary={`${r.label} of both laps.`}
            />
          ))}
        </div>
      </section>

      <aside className="flex flex-col gap-4 lg:sticky lg:top-28 lg:self-start">
        <div className="overflow-hidden rounded-lg border border-line bg-surface">
          <div className="relative h-64 sm:h-80 lg:h-72">
            {!geometry ? (
              <p className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">No generated layout for this circuit, so the cars cannot be placed on a map. Time traces are still available.</p>
            ) : webgl === false ? (
              <p className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">The circuit map needs WebGL, which this browser does not provide.</p>
            ) : (
              <ErrorBoundary fallback={(e) => <p className="flex h-full items-center justify-center p-6 text-center text-sm text-muted">The circuit map could not start ({e.message}).</p>}>
                <Scene
                  geometry={geometry}
                  cars={[
                    { id: "a", color: SERIES_A, progress: cursor?.progress.a ?? null },
                    { id: "b", color: SERIES_B, progress: cursor?.progress.b ?? null },
                  ]}
                />
              </ErrorBoundary>
            )}
          </div>
          {geometry && (
          <p className="border-t border-line px-3 py-2 text-xs leading-relaxed text-muted">
            {cursor?.elapsed != null
              ? `Both cars ${cursor.elapsed.toFixed(2)} s into their laps.`
              : "Point at the traces to place both cars on the circuit at the same elapsed lap time."}
          </p>
          )}
        </div>

      </aside>
    </div>
  );
}
