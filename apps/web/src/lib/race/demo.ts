import { wrap01 } from "./track";
import type { DriverState, RaceSnapshot, SessionInfo } from "./types";

/**
 * DETERMINISTIC RACE SIMULATOR for the DEMO mode. Everything it produces (order, lap times, gaps, pit stops) is generated; none of it
 * is a real result. Each car's race distance is a pure function of race time, so any moment can be computed directly (seek, reset and
 * tests need no stepping), and gaps are exact: the time between the car ahead and this car passing the same point of the circuit.
 */

/** Seeded PRNG (mulberry32): same seed, same race. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pace along the lap derived from the centerline's curvature: cars are slower where the track bends tightly. Returns monotonic tables
 * mapping lap-distance fraction <-> lap-time fraction. Purely illustrative; not a vehicle model.
 */
export interface PaceProfile {
  distFrac: Float64Array;
  timeFrac: Float64Array;
}

export function paceProfile(xyz: Float32Array, cornerFactor = 30, smoothVertices = 8): PaceProfile {
  const n = xyz.length / 3;
  const seg = new Float64Array(n);
  const curv = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = ((i - 1 + n) % n) * 3;
    const b = i * 3;
    const c = ((i + 1) % n) * 3;
    const ux = xyz[b] - xyz[a];
    const uz = xyz[b + 2] - xyz[a + 2];
    const vx = xyz[c] - xyz[b];
    const vz = xyz[c + 2] - xyz[b + 2];
    const lu = Math.hypot(ux, uz) || 1;
    const lv = Math.hypot(vx, vz) || 1;
    seg[i] = Math.hypot(vx, xyz[c + 1] - xyz[b + 1], vz);
    const turn = Math.acos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) / (lu * lv))));
    curv[i] = turn / ((lu + lv) / 2);
  }
  const smooth = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -smoothVertices; k <= smoothVertices; k++) s += curv[(i + k + n) % n];
    smooth[i] = s / (2 * smoothVertices + 1);
  }
  const distFrac = new Float64Array(n + 1);
  const timeFrac = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    distFrac[i + 1] = distFrac[i] + seg[i];
    timeFrac[i + 1] = timeFrac[i] + seg[i] * (1 + cornerFactor * smooth[i]);
  }
  for (let i = 0; i <= n; i++) {
    distFrac[i] /= distFrac[n];
    timeFrac[i] /= timeFrac[n];
  }
  return { distFrac, timeFrac };
}

function lookup(from: Float64Array, to: Float64Array, x: number) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  let lo = 0;
  let hi = from.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (from[mid] <= x) lo = mid;
    else hi = mid;
  }
  const t = (x - from[lo]) / (from[hi] - from[lo] || 1);
  return to[lo] + (to[hi] - to[lo]) * t;
}

export interface DemoEntry {
  id: string;
  code: string;
  name: string | null;
  number: number | null;
  teamSlug: string | null;
}

export interface DemoRaceConfig {
  entries: readonly DemoEntry[];
  profile: PaceProfile;
  session: Omit<SessionInfo, "status" | "lap" | "totalLaps">;
  totalLaps: number;
  seed: number;
  /** Simulated base lap time (s). */
  baseLapS: number;
  pitLossS?: number;
}

/** Where on the lap the simulated pit stop happens (the pit lane itself is not modelled: the car waits on the centerline). */
export const PIT_AT = 0.985;

interface Car {
  entry: DemoEntry;
  startDelay: number;
  laps: number[]; // running lap times without the stop (s)
  cum: number[]; // cumulative lap times including the stop (s), length totalLaps + 1
  pitLap: number;
  pitLoss: number;
  finishT: number;
}

export interface DemoRace {
  /** Race length in ms (until the last car finishes). */
  durationMs: number;
  snapshotAt(tMs: number): Omit<RaceSnapshot, "mode" | "source" | "epoch">;
  /** Race distance in laps (negative before the car reaches the start line). Exposed for tests. */
  distanceAt(id: string, tMs: number): number;
}

export function createDemoRace(cfg: DemoRaceConfig): DemoRace {
  const { profile, totalLaps } = cfg;
  if (!(totalLaps >= 1) || cfg.entries.length === 0) throw new Error("demo race needs at least one lap and one entry");
  const pitLoss = cfg.pitLossS ?? 20;
  const r = rng(cfg.seed);
  const tAtD = (f: number) => lookup(profile.distFrac, profile.timeFrac, f);
  const dAtT = (f: number) => lookup(profile.timeFrac, profile.distFrac, f);

  const cars: Car[] = cfg.entries.map((entry, grid) => {
    const pace = cfg.baseLapS + (r() - 0.35) * 1.6; // a car's underlying pace, independent of grid slot (so overtakes happen)
    const laps = Array.from({ length: totalLaps }, (_, k) => pace + (r() - 0.5) * 0.9 + (k === 0 ? 3 : 0));
    const pitLap = Math.min(totalLaps - 1, Math.max(1, Math.floor(totalLaps * (0.3 + r() * 0.4))));
    const cum = [0];
    for (let k = 0; k < totalLaps; k++) cum.push(cum[k] + laps[k] + (k === pitLap ? pitLoss : 0));
    const startDelay = grid * 0.4;
    return { entry, startDelay, laps, cum, pitLap, pitLoss, finishT: startDelay + cum[totalLaps] };
  });
  const byId = new Map(cars.map((c) => [c.entry.id, c]));

  /** Race distance (laps) at race time t (s), and whether the car is stationary in its pit stop. */
  const distance = (c: Car, t: number): { d: number; inPit: boolean } => {
    const u = t - c.startDelay;
    if (u < 0) return { d: u / c.laps[0], inPit: false };
    if (u >= c.cum[totalLaps]) return { d: totalLaps, inPit: false };
    let k = 0;
    while (c.cum[k + 1] <= u) k++;
    const w = u - c.cum[k];
    const lap = c.laps[k];
    if (k === c.pitLap) {
      const stop = tAtD(PIT_AT) * lap;
      if (w < stop) return { d: k + dAtT(w / lap), inPit: false };
      if (w < stop + c.pitLoss) return { d: k + PIT_AT, inPit: true };
      return { d: k + dAtT((w - c.pitLoss) / lap), inPit: false };
    }
    return { d: k + dAtT(w / lap), inPit: false };
  };

  /** Race time (s) at which the car reached race distance d (the inverse of `distance`; arrival time during a stop). */
  const timeAt = (c: Car, d: number): number => {
    if (d <= 0) return c.startDelay + d * c.laps[0];
    if (d >= totalLaps) return c.finishT;
    const k = Math.floor(d);
    const f = d - k;
    return c.startDelay + c.cum[k] + tAtD(f) * c.laps[k] + (k === c.pitLap && f > PIT_AT ? c.pitLoss : 0);
  };

  const durationS = Math.max(...cars.map((c) => c.finishT));

  return {
    durationMs: durationS * 1000,
    distanceAt: (id, tMs) => distance(byId.get(id)!, tMs / 1000).d,
    snapshotAt(tMs) {
      const t = Math.max(0, Math.min(durationS, tMs / 1000));
      const states = cars.map((c) => ({ c, ...distance(c, t), finished: t >= c.finishT }));
      states.sort((a, b) => {
        if (a.finished !== b.finished) return a.finished ? -1 : 1;
        if (a.finished && b.finished) return a.c.finishT - b.c.finishT;
        return b.d - a.d || a.c.entry.id.localeCompare(b.c.entry.id);
      });
      const leader = states[0];
      const drivers: DriverState[] = states.map((s, i) => {
        const done = Math.max(0, Math.min(totalLaps, Math.floor(s.d)));
        const completed = s.c.laps.slice(0, done).map((l, k) => l + (k === s.c.pitLap ? s.c.pitLoss : 0));
        const gapTo = (o: (typeof states)[number]) => (s.finished ? s.c.finishT - o.c.finishT : t - timeAt(o.c, s.d));
        return {
          id: s.c.entry.id,
          code: s.c.entry.code,
          name: s.c.entry.name,
          number: s.c.entry.number,
          teamSlug: s.c.entry.teamSlug,
          position: i + 1,
          lap: Math.max(1, Math.min(totalLaps, Math.floor(s.d) + 1)),
          progress: s.finished ? 0 : wrap01(s.d),
          lastLapMs: completed.length ? Math.round(completed[completed.length - 1] * 1000) : null,
          bestLapMs: completed.length ? Math.round(Math.min(...completed) * 1000) : null,
          gapToLeaderS: i === 0 ? null : Math.max(0, gapTo(leader)),
          gapAheadS: i === 0 ? null : Math.max(0, gapTo(states[i - 1])),
          lapsDown: i === 0 ? 0 : Math.max(0, Math.floor(leader.d - s.d + 1e-9)),
          pit: s.inPit ? "in-pit" : "none",
          finished: s.finished,
          sampleT: Math.round(t * 1000),
          stale: false,
        };
      });
      const allFinished = states.every((s) => s.finished);
      return {
        session: {
          ...cfg.session,
          status: t <= 0 ? "not-started" : allFinished ? "finished" : "running",
          lap: drivers[0].lap,
          totalLaps,
        },
        drivers,
        ordered: true,
        t: Math.round(t * 1000),
        elapsed: t / durationS,
      };
    },
  };
}
