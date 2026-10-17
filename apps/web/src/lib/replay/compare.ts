import { interpAt } from "@/lib/telemetry/analysis";
import { lastAtOrBefore, MAX_INTERP_GAP_MS, type ReplayModel } from "./model";

/**
 * Two-driver comparison over one replay (Race Replay "Compare"). What is official and what is calculated here:
 * - Official (as published): position, lap number, previous and best lap times, sector times, gap to the leader, laps down.
 * - Calculated: the gap between the two drivers (difference of their published gaps to the leader at t), the time elapsed on the current
 *   lap, lap progress (recorded position on the centerline), position swaps between the two (from the official order feed), and the
 *   lap-comparison delta (two laps aligned by distance along the centerline, from recorded positions about 1 s apart).
 */

export interface DriverAt {
  number: number;
  code: string;
  position: number | null;
  lap: number | null;
  /** Fraction of the current lap covered, from the recorded position (null when there is none at t). */
  lapProgress: number | null;
  /** Seconds since the current lap started (calculated). */
  currentLapS: number | null;
  lastS: number | null;
  bestS: number | null;
  /** Sector times of the last completed lap (official), when published. */
  lastSectors: [number | null, number | null, number | null] | null;
  gapToLeaderS: number | null;
  lapsDown: number | null;
  hasPosition: boolean;
  inPit: boolean;
}

export function driverAt(m: ReplayModel, i: number, t: number): DriverAt {
  const d = m.ds.drivers[i];
  const lap = m.lapAt(i, t);
  const pos = m.positionAt(i, t);
  const iv = m.intervalAt(i, t);
  const started = d.laps.filter((l) => l[1] <= t);
  const current = started[started.length - 1];
  const completed = started.filter((l) => l[2] != null && l[1] + (l[2] as number) * 1000 <= t);
  const last = completed[completed.length - 1];
  const sectors = last && last.length >= 6 ? ([last[3] ?? null, last[4] ?? null, last[5] ?? null] as [number | null, number | null, number | null]) : null;
  const running = current && (current[2] == null || current[1] + current[2] * 1000 > t);
  const position = m.positionOf(d.number, t);
  // OpenF1 publishes the leader's gap only when it changes (rarely), so it is often older than the staleness limit. A car that is P1 in the
  // official order is, by definition, 0 s behind the leader.
  const leader = position === 1;
  return {
    number: d.number,
    code: d.acronym ?? `#${d.number}`,
    position,
    lap: lap.lap,
    lapProgress: pos && !pos.stale ? pos.progress : null,
    currentLapS: running && current ? (t - current[1]) / 1000 : null,
    lastS: lap.lastS,
    bestS: lap.bestS,
    lastSectors: sectors,
    gapToLeaderS: leader ? 0 : (iv?.gap ?? null),
    lapsDown: leader ? null : (iv?.lapsDown ?? null),
    hasPosition: pos != null && !pos.stale,
    inPit: m.inPit(i, t),
  };
}

/**
 * Gap between the two (calculated from their published gaps to the leader at t). `seconds` > 0 means B is behind A. When either is a lap
 * or more down, only the lap difference is meaningful, so `seconds` is null.
 */
export function gapBetween(a: DriverAt, b: DriverAt): { seconds: number | null; laps: number | null } {
  if (a.lapsDown != null || b.lapsDown != null) {
    const la = a.lapsDown ?? 0;
    const lb = b.lapsDown ?? 0;
    return { seconds: null, laps: la === lb ? null : lb - la };
  }
  if (a.gapToLeaderS == null || b.gapToLeaderS == null) return { seconds: null, laps: null };
  return { seconds: b.gapToLeaderS - a.gapToLeaderS, laps: null };
}

/** Moments the two swapped places in the official order (after lights out): the car number ahead from then on. */
export function swapsBetween(m: ReplayModel, numberA: number, numberB: number): { t: number; ahead: number }[] {
  const pos = new Map<number, number>();
  const out: { t: number; ahead: number }[] = [];
  let ahead: number | null = null;
  for (const [t, n, p] of m.ds.order) {
    if (n !== numberA && n !== numberB) continue;
    pos.set(n, p);
    const pa = pos.get(numberA);
    const pb = pos.get(numberB);
    if (pa == null || pb == null || pa === pb) continue; // mid-update: both rows of a swap share a timestamp
    const now = pa < pb ? numberA : numberB;
    if (ahead != null && now !== ahead && t > m.ds.lightsOutMs) {
      if (out.length && out[out.length - 1].t === t) out[out.length - 1].ahead = now;
      else out.push({ t, ahead: now });
    }
    ahead = now;
  }
  return out;
}

export interface LapTrace {
  lap: number;
  lapS: number;
  /** Distance (m) from the line and seconds into the lap, from recorded positions; both non-decreasing. */
  d: number[];
  t: number[];
}

/**
 * One lap of driver i as (distance, time) pairs from recorded positions, or null when the lap is not usable: no lap time, no layout, or
 * a gap in the positions longer than MAX_INTERP_GAP_MS (no alignment is invented across it). `lapLength` is the centerline length (m).
 */
export function lapTrace(m: ReplayModel, i: number, lapNumber: number, lapLength: number): LapTrace | null {
  const lap = m.ds.drivers[i].laps.find((l) => l[0] === lapNumber);
  if (!lap || lap[2] == null || !(lapLength > 0)) return null;
  const [, start, dur] = lap;
  const end = start + dur * 1000;
  const ts = m.ds.drivers[i].positions.t;
  const p = m.progress[i];
  const from = Math.max(0, lastAtOrBefore(ts, start));
  const to = lastAtOrBefore(ts, end);
  if (to <= from) return null;
  const d: number[] = [0];
  const t: number[] = [0];
  let unwrapped: number | null = null;
  let prevT = start;
  for (let k = from; k <= to; k++) {
    if (ts[k] <= start) continue;
    if (ts[k] - prevT > MAX_INTERP_GAP_MS) return null;
    prevT = ts[k];
    // Unwrap through the line: the lap starts near progress 0 (or just below 1 when the first sample is slightly early).
    if (unwrapped == null) unwrapped = p[k] > 0.5 ? p[k] - 1 : p[k];
    else {
      let step = p[k] - (((unwrapped % 1) + 1) % 1);
      if (step > 0.5) step -= 1;
      if (step < -0.5) step += 1;
      unwrapped += step;
    }
    const dist = Math.min(lapLength, Math.max(d[d.length - 1], unwrapped * lapLength));
    d.push(dist);
    t.push((ts[k] - start) / 1000);
  }
  if (end - prevT > MAX_INTERP_GAP_MS) return null;
  d.push(lapLength);
  t.push(dur);
  return { lap: lapNumber, lapS: dur, d, t };
}

/** Time B minus time A to reach each distance (s; > 0 = B slower to there), on a fixed grid. Calculated. */
export function lapDelta(a: LapTrace, b: LapTrace, lapLength: number, step = 25): { d: number[]; delta: (number | null)[] } {
  const d: number[] = [];
  for (let v = 0; v <= lapLength + 1e-6; v += step) d.push(v);
  return { d, delta: d.map((v) => {
    const ta = interpAt(a.d, a.t, v);
    const tb = interpAt(b.d, b.t, v);
    return ta == null || tb == null ? null : tb - ta;
  }) };
}
