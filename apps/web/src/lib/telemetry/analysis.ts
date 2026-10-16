import type { TrackPath } from "@/lib/race/track";
import type { LapTelemetry } from "./types";

/**
 * DERIVED values for the Telemetry Lab. Everything here is computed from the published samples and documented, never filled in:
 * - Distance: each sample's position (linearly interpolated between position samples to the car sample's time) projected onto the circuit
 *   centerline the 3D track is drawn from, measured from the start/finish line. Both drivers share that reference line, so distances are
 *   comparable; the lap length is the centerline length, not the driver's own path.
 * - Values between samples: linear interpolation for continuous channels (speed, throttle, RPM), the last sample for stepped ones (gear,
 *   brake). Gaps wider than MAX_GAP_MS are not bridged.
 * - Delta: time to reach each distance for driver B minus driver A (positive = B behind A there).
 * - Invalid samples are shown as missing, never drawn: values outside the channel's range (the feed's placeholder throttle/brake of 104)
 *   and frozen stretches where every channel repeats unchanged for FROZEN_MS or longer while the car keeps moving (see `invalidSamples`).
 */
export type Channel = "speed" | "throttle" | "brake" | "rpm" | "gear";
export const CHANNELS: readonly Channel[] = ["speed", "throttle", "brake", "rpm", "gear"];
const STEPPED: ReadonlySet<Channel> = new Set(["brake", "gear"]);
/** Samples further apart than this are not interpolated across (OpenF1 car data arrives about every 250 ms). */
export const MAX_GAP_MS = 1500;

/** Lap time as m:ss.sss. */
export const lapTime = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(3).padStart(6, "0")}`;

/** Value of ys at x by linear (or stepped) interpolation; null outside the data, across a null, or across a gap wider than maxGap. */
export function interpAt(xs: ArrayLike<number>, ys: ArrayLike<number | null>, x: number, stepped = false, maxGap = Infinity): number | null {
  const n = xs.length;
  if (n === 0 || x < xs[0] || x > xs[n - 1]) return null;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  if (xs[hi] === x) return ys[hi];
  const a = ys[lo];
  const b = ys[hi];
  if (a == null || b == null || xs[hi] - xs[lo] > maxGap) return null;
  if (stepped || xs[hi] === xs[lo]) return a;
  return a + ((b - a) * (x - xs[lo])) / (xs[hi] - xs[lo]);
}

/** A feed that repeats every channel unchanged for this long is frozen (real samples always vary within a couple of seconds). */
export const FROZEN_MS = 2500;

/**
 * Per car sample: true when the published values cannot be real. Out-of-range throttle (> 100) or brake (not 0/100) marks the sample;
 * so does a run of identical speed, throttle, brake, gear and RPM lasting FROZEN_MS or more (the feed stalled while positions kept coming).
 */
export function invalidSamples(car: LapTelemetry["car"]): boolean[] {
  const n = car.t.length;
  const bad = new Array<boolean>(n).fill(false);
  for (let i = 0; i < n; i++) {
    const th = car.throttle[i];
    const br = car.brake[i];
    if ((th != null && (th < 0 || th > 100)) || (br != null && br !== 0 && br !== 100)) bad[i] = true;
  }
  const same = (i: number, j: number) => car.speed[i] === car.speed[j] && car.throttle[i] === car.throttle[j] && car.brake[i] === car.brake[j] && car.gear[i] === car.gear[j] && car.rpm[i] === car.rpm[j];
  for (let i = 0; i < n; ) {
    let j = i;
    while (j + 1 < n && same(i, j + 1)) j++;
    if (car.t[j] - car.t[i] >= FROZEN_MS) for (let k = i; k <= j; k++) bad[k] = true;
    i = j + 1;
  }
  return bad;
}

export interface AlignedLap {
  /** Seconds from the lap start, per car sample. */
  t: number[];
  /** Metres from the start/finish line along the circuit centerline, per car sample (null where the position is unknown). */
  distance: (number | null)[];
  /** Lap fraction of each car sample on the centerline (for placing the 3D marker). */
  progress: (number | null)[];
  channels: Record<Channel, (number | null)[]>;
  lapDuration: number;
  /** Seconds of the lap (0 to lapDuration) whose car data was invalid and is shown as missing. */
  invalidSeconds: number;
  /** Stretches of the lap (s, from–to) whose car data is invalid, in order. */
  invalidRanges: [number, number][];
}

/**
 * Puts a lap's car samples on the circuit: `toWorld` maps an OpenF1 location (x, y) into the same world plane as `path`. Without a path
 * (no generated layout for the circuit) there is no distance or 3D position, only time.
 */
export function alignLap(lap: LapTelemetry, path: TrackPath | null, toWorld: ((x: number, y: number) => [number, number]) | null): AlignedLap {
  const n = lap.car.t.length;
  const distance: (number | null)[] = new Array(n).fill(null);
  const progress: (number | null)[] = new Array(n).fill(null);
  if (path && toWorld) {
    let hint = 0; // the lap starts on the start/finish line (centerline vertex 0)
    let unwrapped: number | null = null;
    for (let i = 0; i < n; i++) {
      const tm = lap.car.t[i];
      const x = interpAt(lap.position.t, lap.position.x, tm, false, MAX_GAP_MS);
      const y = interpAt(lap.position.t, lap.position.y, tm, false, MAX_GAP_MS);
      if (x == null || y == null) continue;
      const [wx, wz] = toWorld(x, y);
      const p = path.project(wx, wz, hint);
      hint = p;
      progress[i] = p;
      // Unwrap across the line: just before the start reads ~0.99 (-> negative distance); after a full lap past 1.
      if (unwrapped == null) unwrapped = p > 0.5 ? p - 1 : p;
      else {
        const prev = ((unwrapped % 1) + 1) % 1;
        let d = p - prev;
        if (d > 0.5) d -= 1;
        if (d < -0.5) d += 1;
        unwrapped += d;
      }
      distance[i] = unwrapped * path.length;
    }
  }
  const bad = invalidSamples(lap.car);
  const channels = Object.fromEntries(CHANNELS.map((c) => [c, lap.car[c].map((v, i) => (bad[i] ? null : v))])) as Record<Channel, (number | null)[]>;
  const t = lap.car.t.map((v) => v / 1000);
  const invalidRanges: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    if (!bad[i]) continue;
    let j = i;
    while (j + 1 < n && bad[j + 1]) j++;
    // Each run lasts until the next valid sample (or the end of the lap), clipped to the lap.
    const from = Math.max(0, t[i]);
    const to = Math.min(lap.lapDuration, t[j + 1] ?? t[j]);
    if (to > from) invalidRanges.push([from, to]);
    i = j;
  }
  const invalidSeconds = invalidRanges.reduce((sum, [f, e]) => sum + e - f, 0);
  return { t, distance, progress, channels, lapDuration: lap.lapDuration, invalidSeconds, invalidRanges };
}

export interface DistanceTrace {
  /** Grid of distances (m) from 0 to the lap length. */
  d: number[];
  /** Seconds from the lap start at which the car reached each distance. */
  time: (number | null)[];
  channels: Record<Channel, (number | null)[]>;
  progress: (number | null)[];
}

/** Resamples an aligned lap onto a fixed distance grid (needs distances). Distance is made non-decreasing first (projection noise). */
export function byDistance(lap: AlignedLap, lapLength: number, step = 5): DistanceTrace {
  const idx = lap.distance.flatMap((d, i) => (d == null ? [] : [i]));
  const xs: number[] = [];
  let max = -Infinity;
  for (const i of idx) xs.push((max = Math.max(max, lap.distance[i] as number)));
  const pick = <T,>(arr: T[]) => idx.map((i) => arr[i]);
  const d: number[] = [];
  for (let v = 0; v <= lapLength + 1e-6; v += step) d.push(Math.round(v * 100) / 100);
  const at = (ys: (number | null)[], stepped = false) => d.map((v) => interpAt(xs, ys, v, stepped));
  return {
    d,
    time: at(pick(lap.t)),
    channels: Object.fromEntries(CHANNELS.map((c) => [c, at(pick(lap.channels[c]), STEPPED.has(c))])) as Record<Channel, (number | null)[]>,
    progress: at(pick(lap.progress)).map((p) => (p == null ? null : ((p % 1) + 1) % 1)),
  };
}

/** B minus A: seconds by which B reached each distance later than A (null where either is unknown). */
export function deltaTrace(a: DistanceTrace, b: DistanceTrace): (number | null)[] {
  return a.d.map((_, i) => (a.time[i] == null || b.time[i] == null ? null : (b.time[i] as number) - (a.time[i] as number)));
}

/**
 * Centred moving average over 2·half+1 points, skipping nulls (null stays null). Used on the gap trace only: interpolating ~4 Hz samples
 * leaves a sampling sawtooth of a few hundredths of a second that is not real; at the 5 m grid, half = 3 averages over 35 m.
 */
export function smooth(ys: (number | null)[], half: number): (number | null)[] {
  return ys.map((y, i) => {
    if (y == null) return null;
    let sum = 0;
    let k = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(ys.length - 1, i + half); j++) {
      const v = ys[j];
      if (v != null) {
        sum += v;
        k++;
      }
    }
    return sum / k;
  });
}

/** Channel values of an aligned lap at `seconds` from its start (time mode). */
export function valuesAtTime(lap: AlignedLap, seconds: number): Record<Channel, number | null> {
  return Object.fromEntries(CHANNELS.map((c) => [c, interpAt(lap.t, lap.channels[c], seconds, STEPPED.has(c), MAX_GAP_MS / 1000)])) as Record<Channel, number | null>;
}

/** Distance (m) reached at `seconds` from the lap start (time mode marker); null without a layout or outside the samples. */
export function distanceAtTime(lap: AlignedLap, seconds: number): number | null {
  return interpAt(lap.t, lap.distance, seconds, false, MAX_GAP_MS / 1000);
}
