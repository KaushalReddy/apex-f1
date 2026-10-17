"use client";

import { useMemo, useState } from "react";
import { SERIES_A, SERIES_B } from "@/components/drivers/charts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { TrackPath } from "@/lib/race/track";
import { driverAt, gapBetween, swapsBetween } from "@/lib/replay/compare";
import type { ReplayModel } from "@/lib/replay/model";
import { lapTime } from "@/lib/telemetry/analysis";
import { LapAnalysis } from "./LapAnalysis";
import { LapsTab } from "./LapsTab";

const fmtLap = (s: number | null) => (s == null ? "—" : lapTime(s));
const fmtS = (s: number | null) => (s == null ? "—" : s.toFixed(3));
const signed = (v: number | null, digits = 3) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(digits)}`);
const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  const a = Math.abs(s);
  return `${s < 0 ? "−" : ""}${Math.floor(a / 3600)}:${String(Math.floor((a % 3600) / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
};

interface Props {
  model: ReplayModel;
  /** Centerline length (m); 0 when there is no layout (lap comparison then unavailable). */
  lapLength: number;
  /** Replay time (ms). */
  t: number;
  a: number;
  b: number;
  teamColour: (i: number) => string;
  onSeek: (t: number) => void;
  onSwitch: () => void;
  onExit: () => void;
  /** Session whose fastest-lap car telemetry was exported (null = none). */
  telemetrySessionKey: number | null;
  /** The circuit path and source-to-world mapping the 3D view uses (for aligning telemetry positions). */
  path: TrackPath;
  toWorld: (x: number, y: number) => [number, number];
  /** Wider panel for the stacked charts (desktop). */
  wide: boolean;
  onToggleWide: (() => void) | null;
}

/**
 * Two-driver comparison for the Race Replay. "Race time" is both drivers at the replay's current moment; "Lap comparison" aligns two
 * chosen laps by distance and is never mixed with the simultaneous race view. Official values are shown as published; calculated ones say so.
 */
export function ComparePanel({ model, lapLength, t, a, b, teamColour, onSeek, onSwitch, onExit, telemetrySessionKey, path, toWorld, wide, onToggleWide }: Props) {
  const [tab, setTab] = useState<"race" | "laps" | "lap">("race");
  const [open, setOpen] = useState(true);
  const A = driverAt(model, a, t);
  const B = driverAt(model, b, t);
  const gap = gapBetween(A, B);
  // Keyed by the driver indices (stable props), not by values derived during render.
  const swaps = useMemo(() => swapsBetween(model, model.ds.drivers[a].number, model.ds.drivers[b].number), [model, a, b]);
  const lights = model.ds.lightsOutMs;
  const head = (i: number, code: string, series: string, label: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="h-0.5 w-3 rounded-full" style={{ backgroundColor: series }} />
      <span aria-hidden="true" className="h-3 w-1 rounded-sm" style={{ backgroundColor: teamColour(i) }} />
      <span className="font-semibold text-fg">{code}</span>
      <span className="sr-only">{label}</span>
    </span>
  );

  return (
    <section aria-labelledby="compare-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-white/10 px-3 py-2">
        <h2 id="compare-heading" className="flex min-w-0 shrink-0 items-center gap-2 text-sm">
          <span className="sr-only">Comparing</span>
          {head(a, A.code, SERIES_A, "Driver A")}
          <span className="text-subtle">vs</span>
          {head(b, B.code, SERIES_B, "Driver B")}
        </h2>
        <span className="ml-auto flex shrink-0 gap-0.5">
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            {open ? "Hide" : "Show"}
          </Button>
          {onToggleWide && (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" aria-pressed={wide} onClick={onToggleWide}>
              {wide ? "Narrow" : "Wide"}
            </Button>
          )}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onSwitch}>
            Change
          </Button>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onExit}>
            Exit
          </Button>
        </span>
      </div>
      {open && (
        <>
          <div role="tablist" aria-label="Comparison mode" className="flex gap-0.5 border-b border-white/10 px-1.5 py-1">
            {(
              [
                ["race", "Race time"],
                ["laps", "Laps"],
                ["lap", "Lap comparison"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                onClick={() => setTab(k)}
                className={cn("motion-interactive h-7 rounded-md px-2.5 text-xs font-medium", tab === k ? "bg-surface-3 text-fg" : "text-muted hover:text-fg")}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 text-sm">
            {tab === "race" ? (
              <>
                <p className="text-xs text-muted">
                  Both drivers at {clock(t - lights)} from lights out. Δ is B minus A.
                </p>
                <p className="mt-2 rounded-md bg-surface-2/70 px-2.5 py-2">
                  {gap.seconds != null ? (
                    <>
                      <span className="font-semibold text-fg tabular-nums">{Math.abs(gap.seconds).toFixed(1)} s</span> between them,{" "}
                      {gap.seconds >= 0 ? B.code : A.code} behind.
                    </>
                  ) : gap.laps != null ? (
                    <>
                      <span className="font-semibold text-fg">
                        {Math.abs(gap.laps)} lap{Math.abs(gap.laps) === 1 ? "" : "s"}
                      </span>{" "}
                      between them, {gap.laps > 0 ? B.code : A.code} behind.
                    </>
                  ) : (
                    <span className="text-muted">No gap: a published gap to the leader is missing at this moment.</span>
                  )}
                  <span className="block text-[11px] text-subtle">Calculated from each driver&apos;s published gap to the leader.</span>
                </p>
                <table className="mt-2.5 w-full text-xs tabular-nums">
                  <caption className="sr-only">Comparison at the replay time</caption>
                  <thead className="text-[10px] uppercase tracking-wider text-subtle">
                    <tr>
                      <th scope="col" className="pb-1 text-left font-medium">At this moment</th>
                      <th scope="col" className="pb-1 text-right font-medium">{A.code}</th>
                      <th scope="col" className="pb-1 text-right font-medium">{B.code}</th>
                      <th scope="col" className="pb-1 text-right font-medium">Δ</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {(
                      [
                        ["Position", A.position != null ? `P${A.position}` : "—", B.position != null ? `P${B.position}` : "—", A.position != null && B.position != null ? `${B.position - A.position > 0 ? "+" : ""}${B.position - A.position}` : "—", "official"],
                        ["Lap", A.lap ?? "—", B.lap ?? "—", "", "official"],
                        ["Lap progress", A.lapProgress != null ? `${Math.round(A.lapProgress * 100)}%` : "—", B.lapProgress != null ? `${Math.round(B.lapProgress * 100)}%` : "—", "", "calculated"],
                        ["Current lap", A.currentLapS != null ? A.currentLapS.toFixed(1) : "—", B.currentLapS != null ? B.currentLapS.toFixed(1) : "—", "", "calculated"],
                        ["Previous lap", fmtLap(A.lastS), fmtLap(B.lastS), A.lastS != null && B.lastS != null ? signed(B.lastS - A.lastS) : "—", "official"],
                        ["Best lap so far", fmtLap(A.bestS), fmtLap(B.bestS), A.bestS != null && B.bestS != null ? signed(B.bestS - A.bestS) : "—", "official"],
                        ...[0, 1, 2].map((k) => [
                          `S${k + 1}, previous lap`,
                          fmtS(A.lastSectors?.[k] ?? null),
                          fmtS(B.lastSectors?.[k] ?? null),
                          A.lastSectors?.[k] != null && B.lastSectors?.[k] != null ? signed((B.lastSectors![k] as number) - (A.lastSectors![k] as number)) : "—",
                          "official",
                        ]),
                        ["Gap to leader", A.lapsDown ? `+${A.lapsDown} lap` : A.gapToLeaderS != null ? signed(A.gapToLeaderS, 1) : "—", B.lapsDown ? `+${B.lapsDown} lap` : B.gapToLeaderS != null ? signed(B.gapToLeaderS, 1) : "—", "", "official"],
                      ] as [string, string | number, string | number, string, "official" | "calculated"][]
                    ).map(([k, va, vb, dv, kind]) => (
                      <tr key={k}>
                        <th scope="row" className="py-1 text-left font-normal text-muted">
                          {k}
                          {kind === "calculated" && <span className="ml-1 text-[10px] text-subtle">calc.</span>}
                        </th>
                        <td className="py-1 text-right text-fg">{va}</td>
                        <td className="py-1 text-right text-fg">{vb}</td>
                        <td className="py-1 text-right text-muted">{dv}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {[A, B]
                  .filter((d) => !d.hasPosition)
                  .map((d) => (
                    <p key={d.number} className="mt-2 text-xs text-warning">
                      {d.code}: no recorded position at this moment{d.inPit ? " (in the pit lane)" : ""}; the marker is hidden rather than guessed.
                    </p>
                  ))}
                <h3 className="mt-3 text-[11px] font-semibold uppercase tracking-wider text-subtle">Changes of order between them</h3>
                {swaps.length === 0 ? (
                  <p className="mt-1 text-xs text-muted">They never swapped places in the official order after the start.</p>
                ) : (
                  <ol className="mt-1 divide-y divide-white/10">
                    {swaps.map((s) => (
                      <li key={s.t}>
                        <button type="button" onClick={() => onSeek(Math.max(0, s.t - 5000))} className="motion-interactive flex w-full items-baseline gap-2 py-1 text-left text-xs hover:text-fg">
                          <span className="w-14 shrink-0 tabular-nums text-subtle">{clock(s.t - lights)}</span>
                          <span className={cn(s.t <= t ? "text-fg" : "text-muted")}>{s.ahead === A.number ? A.code : B.code} ahead</span>
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
                <p className="mt-1 text-[11px] text-subtle">From the official order feed: a change can come from a pass, a pit stop or a retirement. Select one to jump there.</p>
              </>
            ) : tab === "laps" ? (
              <LapsTab key={`${a}-${b}`} model={model} a={a} b={b} codeA={A.code} codeB={B.code} t={t} onSeek={onSeek} />
            ) : (
              <LapAnalysis key={`${a}-${b}`} model={model} lapLength={lapLength} a={a} b={b} codeA={A.code} codeB={B.code} t={t} onSeek={onSeek} path={path} toWorld={toWorld} telemetrySessionKey={telemetrySessionKey} />
            )}
          </div>
        </>
      )}
    </section>
  );
}
