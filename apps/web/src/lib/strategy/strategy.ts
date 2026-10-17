import { comparable, lapRows, type LapRow } from "@/lib/replay/laps";
import type { ReplayModel } from "@/lib/replay/model";

/**
 * Strategy analysis (Phase 13). Source data (OpenF1, as published): stints (compound, laps, tyre age at start), pit stops, lap times.
 * Calculated, and labelled as such in the UI:
 * - Degradation: a least-squares line of lap time against tyre age over a stint's comparable laps (no lap 1, pit in/out, Safety Car, VSC
 *   or red-flag laps, nor the stint's first lap). It includes the fuel burn-off over those laps, which cannot be separated from tyre wear
 *   with this data, so true tyre degradation is somewhat larger than the slope shows.
 * - What-if (SIMULATION): see `whatIf`.
 */
export const MIN_FIT_LAPS = 5;

export interface Fit {
  /** Seconds per lap of tyre age. */
  slope: number;
  /** Predicted lap time (s) at tyre age 0. */
  intercept: number;
  /** Standard error of the slope (s/lap). */
  slopeSe: number;
  /** Residual standard deviation (s): how far laps scatter around the line. */
  sd: number;
  n: number;
}

/** Ordinary least squares y = a + b·x; null below MIN_FIT_LAPS points or when x does not vary. */
export function linearFit(xs: readonly number[], ys: readonly number[]): Fit | null {
  const n = xs.length;
  if (n < MIN_FIT_LAPS || n !== ys.length) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (xs[i] - mx) ** 2;
    sxy += (xs[i] - mx) * (ys[i] - my);
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  const intercept = my - slope * mx;
  const sse = xs.reduce((a, x, i) => a + (ys[i] - (intercept + slope * x)) ** 2, 0);
  const sd = Math.sqrt(sse / (n - 2));
  return { slope, intercept, slopeSe: sd / Math.sqrt(sxx), sd, n };
}

export interface StintView {
  stint: number;
  compound: string | null;
  lapStart: number;
  lapEnd: number;
  laps: number;
  ageAtStart: number | null;
  /** For stints after the first: whether a published pit stop matches the change (false = changed in the data without a pit record). */
  pitMatched: boolean | null;
  /** Comparable laps used for the fit, as [tyre age, lap time]. */
  points: [number, number][];
  fit: Fit | null;
}

const age = (s: { lapStart: number; ageAtStart: number | null }, lap: number) => (s.ageAtStart ?? 0) + (lap - s.lapStart);

export function stintsOf(m: ReplayModel, i: number, rows: LapRow[] = lapRows(m, i)): StintView[] {
  const d = m.ds.drivers[i];
  const pitLaps = new Set(m.ds.pits.filter((p) => p.number === d.number && p.lap != null).map((p) => p.lap as number));
  const byLap = new Map(rows.map((r) => [r.lap, r]));
  const lastLap = rows.length ? rows[rows.length - 1].lap : 0;
  const valid = d.stints.filter((s) => s.lapStart != null);
  return valid.map((s, k) => {
    const lapStart = s.lapStart as number;
    const lapEnd = s.lapEnd ?? valid[k + 1]?.lapStart ?? lastLap;
    const prev = valid[k - 1];
    const points: [number, number][] = [];
    for (let lap = lapStart + 1; lap <= lapEnd; lap++) {
      const r = byLap.get(lap);
      if (r && comparable(r)) points.push([age({ lapStart, ageAtStart: s.ageAtStart }, lap), r.lapS as number]);
    }
    return {
      stint: s.stint,
      compound: s.compound,
      lapStart,
      lapEnd,
      laps: lapEnd - lapStart + 1,
      ageAtStart: s.ageAtStart,
      pitMatched: prev ? [prev.lapEnd ?? lapStart - 1, (prev.lapEnd ?? lapStart - 1) + 1, lapStart].some((l) => pitLaps.has(l)) : null,
      points,
      fit: linearFit(
        points.map((p) => p[0]),
        points.map((p) => p[1]),
      ),
    };
  });
}

export interface WhatIfResult {
  /** Change in race time (s) for the driver: negative = faster. Central estimate, then with both slopes at -1 / +1 standard error. */
  delta: number;
  low: number;
  high: number;
  /** Laps that change tyres between the two scenarios. */
  lapsMoved: number;
}

/** Predicted time (s) of laps `from..to` on a stint described by `fit`, starting that stint at lap `start` with tyre age `age0`. */
function stintTime(fit: Fit, slope: number, start: number, age0: number, from: number, to: number) {
  let t = 0;
  for (let lap = from; lap <= to; lap++) t += fit.intercept + slope * (age0 + (lap - start));
  return t;
}

/**
 * SIMULATION: the stop between stint k and k+1 made at the end of lap `newLap - 1` (the next stint starting on `newLap`) instead of when it
 * really was. Both stints are re-predicted from the driver's own fitted lines over the same laps; the number of stops is unchanged, so the
 * pit-lane time cancels out. Not modelled: traffic, Safety Cars, tyre warm-up, track evolution, fuel, rivals reacting. Null when either
 * stint has no fit or the lap is outside the two stints.
 */
export function whatIf(stints: readonly StintView[], k: number, newLap: number): WhatIfResult | null {
  const a = stints[k];
  const b = stints[k + 1];
  if (!a || !b || !a.fit || !b.fit) return null;
  const realStart = b.lapStart;
  if (newLap <= a.lapStart || newLap > b.lapEnd || newLap === realStart) return null;
  const run = (sa: number, sb: number) => {
    const realT = stintTime(a.fit!, sa, a.lapStart, a.ageAtStart ?? 0, a.lapStart, realStart - 1) + stintTime(b.fit!, sb, realStart, b.ageAtStart ?? 0, realStart, b.lapEnd);
    const newT = stintTime(a.fit!, sa, a.lapStart, a.ageAtStart ?? 0, a.lapStart, newLap - 1) + stintTime(b.fit!, sb, newLap, b.ageAtStart ?? 0, newLap, b.lapEnd);
    return newT - realT;
  };
  const central = run(a.fit.slope, b.fit.slope);
  const bounds = [run(a.fit.slope - a.fit.slopeSe, b.fit.slope - b.fit.slopeSe), run(a.fit.slope + a.fit.slopeSe, b.fit.slope + b.fit.slopeSe), run(a.fit.slope - a.fit.slopeSe, b.fit.slope + b.fit.slopeSe), run(a.fit.slope + a.fit.slopeSe, b.fit.slope - b.fit.slopeSe)];
  return { delta: central, low: Math.min(central, ...bounds), high: Math.max(central, ...bounds), lapsMoved: Math.abs(newLap - realStart) };
}

export interface FinalGap {
  number: number;
  position: number;
  /** Seconds behind the winner at the finish (0 for the winner); null if not published. */
  gap: number | null;
  /** Whole laps down at the finish, if lapped. */
  lapsDown: number | null;
}

/**
 * Official finishing order and gaps to the winner: each driver's LAST published gap (at the finish there are no further updates, so the
 * replay's "not older than 30 s" rule for a current gap does not apply here).
 */
export function finalGaps(m: ReplayModel): FinalGap[] {
  const end = m.ds.durationMs;
  return m.ds.drivers
    .map((d) => {
      const position = m.positionOf(d.number, end);
      const iv = d.intervals;
      const k = iv.t.length - 1;
      return { number: d.number, position: position ?? 0, gap: position === 1 ? 0 : k >= 0 ? iv.gap[k] : null, lapsDown: position === 1 ? null : k >= 0 ? iv.lapsDown[k] : null };
    })
    .filter((r) => r.position > 0)
    .sort((a, b) => a.position - b.position);
}

/**
 * SIMULATION: where a race-time change would have left driver `number` at the finish, everyone else unchanged (another simplification).
 * Null when the driver was lapped or their gap is missing. Lapped rivals stay behind.
 */
export function positionAfter(finals: readonly FinalGap[], number: number, delta: number): { from: number; to: number } | null {
  const me = finals.find((f) => f.number === number);
  if (!me || me.gap == null || me.lapsDown) return null;
  const mine = me.gap + delta;
  const ahead = finals.filter((f) => f.number !== number && f.gap != null && !f.lapsDown && (f.gap as number) < mine).length;
  return { from: me.position, to: ahead + 1 };
}
