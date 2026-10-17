import type { ReplayModel } from "./model";
import { timelineMarkers } from "./provider";
import { redPeriods } from "./raceControl";

/**
 * Lap-by-lap analysis for the Race Replay comparison. Official: lap and sector times, pit stops (lap numbers as published), Safety Car /
 * VSC / red-flag periods (race control). Calculated, and labelled so in the UI: which laps are "comparable" (see `comparable`), the
 * consistency figure, cumulative sector deltas and where a lap delta grew.
 */
export interface LapRow {
  lap: number;
  start: number;
  lapS: number | null;
  sectors: [number | null, number | null, number | null];
  /** A published pit stop on this lap (in or out). */
  pit: boolean;
  /** The lap overlapped a Safety Car, VSC or red-flag period. */
  neutralised: boolean;
  /** Which, in race order: "Safety Car", "VSC", "Red flag" (the same names the track status uses). */
  neutralisedBy: Neutralisation[];
}

export type Neutralisation = "Safety Car" | "VSC" | "Red flag";

/** Safety Car / VSC periods and red flags from race control, as [start, end] ms with their kind (red flags: see `redPeriods`). */
export function neutralisedPeriods(m: ReplayModel): { from: number; to: number; kind: Neutralisation }[] {
  const markers = timelineMarkers(m.events, (n) => String(n));
  const out = markers
    .filter((x) => x.kind === "safety-car" && x.end != null)
    .map((x) => ({ from: x.t, to: x.end!, kind: (/virtual/i.test(x.label) ? "VSC" : "Safety Car") as Neutralisation }));
  for (const r of redPeriods(m.ds.raceControl, m.ds.durationMs)) out.push({ from: r.from, to: r.to, kind: "Red flag" });
  return out.sort((a, b) => a.from - b.from);
}

export function lapRows(m: ReplayModel, i: number): LapRow[] {
  const d = m.ds.drivers[i];
  const periods = neutralisedPeriods(m);
  const pitLaps = new Set(m.ds.pits.filter((p) => p.number === d.number && p.lap != null).map((p) => p.lap as number));
  return d.laps.map((l) => {
    const end = l[2] != null ? l[1] + l[2] * 1000 : l[1];
    return {
      lap: l[0],
      start: l[1],
      lapS: l[2],
      sectors: [l[3] ?? null, l[4] ?? null, l[5] ?? null],
      // OpenF1's pit lap is the in-lap; the out-lap is the next one. Both are slow for reasons other than pace.
      pit: pitLaps.has(l[0]) || pitLaps.has(l[0] - 1),
      neutralised: periods.some((p) => p.from < end && p.to > l[1]),
      neutralisedBy: [...new Set(periods.filter((p) => p.from < end && p.to > l[1]).map((p) => p.kind))],
    };
  });
}

/** Laps fit for pace comparison: timed, not the standing-start lap 1, no pit in/out, not neutralised. */
export const comparable = (r: LapRow) => r.lapS != null && r.lap > 1 && !r.pit && !r.neutralised;

/** Mean and standard deviation (s) of comparable lap times; null with fewer than 3 such laps. */
export function consistency(rows: readonly LapRow[]): { laps: number; meanS: number; sdS: number } | null {
  const xs = rows.filter(comparable).map((r) => r.lapS as number);
  if (xs.length < 3) return null;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
  return { laps: xs.length, meanS: mean, sdS: sd };
}

/**
 * Sector-by-sector difference of two laps, B minus A (s; negative = B faster there), and the running total after each sector. Null
 * entries where either sector time is missing, and the running total stops there (it would otherwise mix in an unknown).
 */
export function sectorBreakdown(a: LapRow["sectors"], b: LapRow["sectors"]): { delta: (number | null)[]; cumulative: (number | null)[] } {
  const delta = a.map((x, k) => (x == null || b[k] == null ? null : (b[k] as number) - x));
  const cumulative: (number | null)[] = [];
  let sum: number | null = 0;
  for (const d of delta) {
    sum = sum == null || d == null ? null : sum + d;
    cumulative.push(sum);
  }
  return { delta, cumulative };
}

/**
 * Where a distance-aligned delta trace changed most: the window (of `windowM` metres) with the largest gain for B and the one with the
 * largest loss. Calculated from the trace only; says where, never why.
 */
export function deltaSwings(d: readonly number[], delta: readonly (number | null)[], windowM = 250): { gain: { from: number; to: number; s: number } | null; loss: { from: number; to: number; s: number } | null } {
  let gain: { from: number; to: number; s: number } | null = null;
  let loss: { from: number; to: number; s: number } | null = null;
  for (let i = 0; i < d.length; i++) {
    const j = d.findIndex((x) => x >= d[i] + windowM);
    if (j < 0) break;
    if (delta[i] == null || delta[j] == null) continue;
    const change = (delta[j] as number) - (delta[i] as number);
    if (change < 0 && (!gain || change < gain.s)) gain = { from: d[i], to: d[j], s: change };
    if (change > 0 && (!loss || change > loss.s)) loss = { from: d[i], to: d[j], s: change };
  }
  return { gain, loss };
}
