import { lerpProgress } from "@/lib/race/track";
import type { ReplayDataset } from "./dataset";

/**
 * Time-indexed lookups over one replay dataset. Every query is a binary search at an arbitrary replay time, so seeking never replays
 * earlier frames. What is recorded and what is derived:
 * - Positions: recorded samples projected onto the circuit centerline (windowed, so crossovers do not snap to the wrong branch). Between
 *   two samples at most MAX_INTERP_GAP_MS apart the car moves forward along the centerline in proportion to time (interpolated, flagged
 *   `measured: false` unless within MEASURED_WINDOW_MS of a sample). Wider gaps are not bridged: the car holds its last position, `stale`.
 * - Running order: the official order changes as published (not the final classification), the latest at or before t.
 * - Gaps: the latest published interval at or before t (not older than STALE_INTERVAL_MS).
 * - Laps: lap starts as published; lap times only once the lap is complete at t.
 */
export const MAX_INTERP_GAP_MS = 5000;
export const MEASURED_WINDOW_MS = 300;
export const STALE_INTERVAL_MS = 30_000;

export interface CarPosition {
  /** Lap fraction on the centerline, 0..1. */
  progress: number;
  /** True when t is within MEASURED_WINDOW_MS of a recorded sample. */
  measured: boolean;
  /** True when the surrounding samples are too far apart to interpolate (held at the last recorded position). */
  stale: boolean;
}

export type OfficialTone = "start" | "finish" | "safety-car" | "red-flag";

export type ReplayEvent =
  | { id: string; t: number; kind: "official"; text: string; tone: OfficialTone }
  | { id: string; t: number; kind: "pit"; number: number; lap: number | null; laneS: number | null }
  | { id: string; t: number; kind: "position"; number: number; from: number; to: number };

/** Binary search: index of the last element of a sorted array <= x, or -1. */
export function lastAtOrBefore(xs: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Official race-control messages worth a timeline marker: starts, Safety Car / VSC, red flags and the chequered flag. */
export function officialTone(m: { category: string | null; flag: string | null; message: string }): OfficialTone | null {
  const msg = m.message.toUpperCase();
  if (m.flag === "CHEQUERED" || msg.includes("CHEQUERED FLAG")) return "finish";
  if (m.flag === "RED" || msg.includes("RED FLAG")) return "red-flag";
  if (m.category === "SafetyCar") return "safety-car";
  if (/\bRACE (START|RESUM)/.test(msg)) return "start";
  return null;
}

export class ReplayModel {
  readonly progress: Float64Array[];
  private readonly orderByCar = new Map<number, { t: number[]; pos: number[] }>();
  readonly events: ReplayEvent[];
  private readonly eventTimes: number[];
  readonly chequeredT: number | null;

  /** `project(x, y, hint)` maps an OpenF1 location to a lap fraction on the circuit centerline (null = no layout). */
  constructor(
    readonly ds: ReplayDataset,
    project: ((x: number, y: number, hint: number | null) => number) | null,
  ) {
    this.progress = ds.drivers.map((d) => {
      const out = new Float64Array(d.positions.t.length);
      if (!project) return out;
      let hint: number | null = null;
      for (let i = 0; i < out.length; i++) hint = out[i] = project(d.positions.x[i], d.positions.y[i], hint);
      return out;
    });
    for (const [t, n, p] of ds.order) {
      const o = this.orderByCar.get(n) ?? { t: [], pos: [] };
      o.t.push(t);
      o.pos.push(p);
      this.orderByCar.set(n, o);
    }
    this.chequeredT = ds.raceControl.find((m) => officialTone(m) === "finish")?.t ?? null;
    this.events = this.buildEvents();
    this.eventTimes = this.events.map((e) => e.t);
  }

  /** Where car `i` (index into ds.drivers) is at replay time t, or null before its first / after its last recorded sample. */
  positionAt(i: number, t: number): CarPosition | null {
    const ts = this.ds.drivers[i].positions.t;
    const p = this.progress[i];
    const k = lastAtOrBefore(ts, t);
    // Just before the first sample (the grid at the start of the window): its recorded position, not measured at t.
    if (k < 0) return ts.length && ts[0] - t <= MAX_INTERP_GAP_MS ? { progress: p[0], measured: false, stale: false } : null;
    if (k === ts.length - 1 && t - ts[k] > MAX_INTERP_GAP_MS) return null;
    const measured = Math.abs(t - ts[k]) <= MEASURED_WINDOW_MS || (k + 1 < ts.length && Math.abs(ts[k + 1] - t) <= MEASURED_WINDOW_MS);
    if (k === ts.length - 1) return { progress: p[k], measured, stale: false };
    const span = ts[k + 1] - ts[k];
    if (span > MAX_INTERP_GAP_MS) return { progress: p[k], measured, stale: t - ts[k] > MEASURED_WINDOW_MS };
    return { progress: lerpProgress(p[k], p[k + 1], (t - ts[k]) / span), measured, stale: false };
  }

  /** Official position of car `number` at t, or null before its first published position. */
  positionOf(number: number, t: number): number | null {
    const o = this.orderByCar.get(number);
    if (!o) return null;
    const k = lastAtOrBefore(o.t, t);
    return k < 0 ? null : o.pos[k];
  }

  /** Latest published gaps for driver i at t (null when none within STALE_INTERVAL_MS). */
  intervalAt(i: number, t: number): { gap: number | null; interval: number | null; lapsDown: number | null } | null {
    const iv = this.ds.drivers[i].intervals;
    const k = lastAtOrBefore(iv.t, t);
    if (k < 0 || t - iv.t[k] > STALE_INTERVAL_MS) return null;
    return { gap: iv.gap[k], interval: iv.interval[k], lapsDown: iv.lapsDown[k] };
  }

  /** Current lap (latest started), last completed lap time and best completed lap time at t (seconds). */
  lapAt(i: number, t: number): { lap: number | null; lastS: number | null; bestS: number | null } {
    const laps = this.ds.drivers[i].laps;
    let lap: number | null = null;
    let lastS: number | null = null;
    let bestS: number | null = null;
    for (const [n, start, dur] of laps) {
      if (start > t) break;
      lap = n;
      if (dur != null && start + dur * 1000 <= t) {
        lastS = dur;
        bestS = bestS == null ? dur : Math.min(bestS, dur);
      }
    }
    return { lap, lastS, bestS };
  }

  inPit(i: number, t: number): boolean {
    const n = this.ds.drivers[i].number;
    return this.ds.pits.some((p) => p.number === n && t >= p.t && t <= p.t + (p.laneS ?? 25) * 1000);
  }

  /** Took the chequered flag: the flag is out and this car's final recorded lap has ended. */
  finished(i: number, t: number): boolean {
    if (this.chequeredT == null || t < this.chequeredT) return false;
    const laps = this.ds.drivers[i].laps;
    const last = laps[laps.length - 1];
    return !!last && last[2] != null && last[1] + last[2] * 1000 <= t && last[1] + last[2] * 1000 >= this.chequeredT;
  }

  /** Events at or before t, oldest first. */
  eventsUntil(t: number): ReplayEvent[] {
    return this.events.slice(0, lastAtOrBefore(this.eventTimes, t) + 1);
  }

  private buildEvents(): ReplayEvent[] {
    const out: ReplayEvent[] = [];
    for (const m of this.ds.raceControl) {
      const tone = officialTone(m);
      if (tone) out.push({ id: `rc:${m.t}:${m.message}`, t: m.t, kind: "official", text: m.message, tone });
    }
    for (const p of this.ds.pits) out.push({ id: `pit:${p.number}:${p.t}`, t: p.t, kind: "pit", number: p.number, lap: p.lap, laneS: p.laneS });
    // Position changes after the start, derived from the official order feed (a gain can come from a pass, a rival pitting or a retirement).
    const last = new Map<number, number>();
    for (const [t, n, pos] of this.ds.order) {
      const prev = last.get(n);
      last.set(n, pos);
      if (prev != null && t > this.ds.lightsOutMs && pos !== prev) out.push({ id: `pos:${n}:${t}`, t, kind: "position", number: n, from: prev, to: pos });
    }
    return out.sort((a, b) => a.t - b.t);
  }
}
