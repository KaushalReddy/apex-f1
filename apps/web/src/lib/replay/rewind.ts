import { neutralisedPeriods, type Neutralisation } from "./laps";
import type { ReplayModel } from "./model";
import { classify, messageText } from "./raceControl";

/**
 * Race Rewind (Phase 15): why a driver gained or lost each place, worked out from OpenF1 data only (no AI).
 * - Position changes come from the official running order; changes within GROUP_MS of each other form one step (a pit stop drops a car
 *   several places in a few seconds). A step that nets to zero (pass and re-pass) is left out.
 * - The cars swapped with are those ahead before and behind after (or the reverse), from the official order either side of the step.
 * - Each swap is attributed, first match wins: the driver's own pit stop (losses), the other car's pit stop (gains), a published on-track
 *   pass between the two, the other car stopping (no further laps), otherwise "unexplained" (the order changed with no record nearby).
 * - Context, not cause: a Safety Car / VSC / red flag at the time, and race-control penalty messages about the driver.
 */
export const GROUP_MS = 30_000;
/** How far a pit stop or pass record may be from the order change it explains (pit records are at pit entry; order updates later). */
const PIT_BEFORE_MS = 120_000;
const PIT_AFTER_MS = 45_000;
const PASS_WINDOW_MS = 60_000;

export type SwapCause = "own-pit" | "rival-pit" | "on-track" | "rival-stopped" | "unexplained";

export interface Swap {
  /** The other car (number). */
  other: number;
  cause: SwapCause;
}

export interface RewindStep {
  t: number;
  tEnd: number;
  lap: number | null;
  from: number;
  to: number;
  swaps: Swap[];
  /** The driver's own pit stop, when it explains the step. */
  pit: { lap: number | null; laneS: number | null; stopS: number | null } | null;
  neutralised: Neutralisation | null;
  /** Race-control penalty / investigation messages about the driver around this step. */
  penalties: string[];
}

export interface RewindSummary {
  start: number | null;
  now: number | null;
  /** Places gained (+) or lost (-) per cause over the steps. */
  byCause: Record<SwapCause, number>;
}

/** Positions of every car at time t (official order). */
function snapshot(m: ReplayModel, t: number) {
  return new Map(m.ds.drivers.map((d) => [d.number, m.positionOf(d.number, t)]));
}

export function rewindSteps(m: ReplayModel, i: number): RewindStep[] {
  const me = m.ds.drivers[i].number;
  const lo = m.ds.lightsOutMs;
  // Position changes after lights out.
  const changes: { t: number; pos: number }[] = [];
  let prev = m.positionOf(me, lo);
  for (const [t, n, p] of m.ds.order) {
    if (n !== me || t <= lo) continue;
    if (p !== prev) changes.push({ t, pos: p });
    prev = p;
  }
  const groups: { t: number; tEnd: number }[] = [];
  for (const c of changes) {
    const g = groups.at(-1);
    if (g && c.t - g.tEnd <= GROUP_MS) g.tEnd = c.t;
    else groups.push({ t: c.t, tEnd: c.t });
  }
  const periods = neutralisedPeriods(m);
  const lastLapEnd = new Map(m.ds.drivers.map((d) => [d.number, Math.max(-Infinity, ...d.laps.filter((l) => l[2] != null).map((l) => l[1] + (l[2] as number) * 1000))]));
  const leaderLaps = Math.max(0, ...m.ds.drivers.map((d) => d.laps.at(-1)?.[0] ?? 0));
  const lapsOf = new Map(m.ds.drivers.map((d) => [d.number, d.laps.at(-1)?.[0] ?? 0]));
  const pitNear = (n: number, t0: number, t1: number) => m.ds.pits.find((p) => p.number === n && p.t >= t0 - PIT_BEFORE_MS && p.t <= t1 + PIT_AFTER_MS) ?? null;
  const passed = (a: number, b: number, t0: number, t1: number) => m.ds.overtakes.some(([t, x, y]) => x === a && y === b && t >= t0 - PASS_WINDOW_MS && t <= t1 + PASS_WINDOW_MS);
  const penalties = m.ds.raceControl.map(classify).filter((c) => (c.kind === "penalty" || c.kind === "investigation") && (c.number === me || new RegExp(`\\bCAR ${me}\\b`).test(c.message)));

  const steps: RewindStep[] = [];
  for (const g of groups) {
    const before = snapshot(m, g.t - 1);
    const after = snapshot(m, g.tEnd);
    const from = before.get(me);
    const to = after.get(me);
    if (from == null || to == null || from === to) continue;
    const gain = to < from;
    const ownPit = gain ? null : pitNear(me, g.t, g.tEnd);
    const swaps: Swap[] = [];
    for (const [n, b] of before) {
      const a = after.get(n);
      if (n === me || b == null || a == null) continue;
      const swapped = gain ? b < from && a > to : b > from && a < to;
      if (!swapped) continue;
      let cause: SwapCause;
      if (!gain && ownPit) cause = "own-pit";
      else if (gain && pitNear(n, g.t, g.tEnd)) cause = "rival-pit";
      else if (gain ? passed(me, n, g.t, g.tEnd) : passed(n, me, g.t, g.tEnd)) cause = "on-track";
      else if (gain && (lapsOf.get(n) ?? 0) < leaderLaps && (lastLapEnd.get(n) ?? Infinity) <= g.tEnd + PIT_AFTER_MS) cause = "rival-stopped";
      else cause = "unexplained";
      swaps.push({ other: n, cause });
    }
    const lapNow = m.lapAt(i, g.t).lap;
    steps.push({
      t: g.t,
      tEnd: g.tEnd,
      lap: lapNow,
      from,
      to,
      swaps,
      pit: ownPit ? { lap: ownPit.lap, laneS: ownPit.laneS, stopS: ownPit.stopS } : null,
      neutralised: periods.find((p) => g.t >= p.from && g.t <= p.to)?.kind ?? null,
      penalties: penalties.filter((c) => c.t >= g.t - 5 * 60_000 && c.t <= g.tEnd + 60_000).map((c) => messageText(c.message)),
    });
  }
  return steps;
}

/**
 * Net places per cause over `steps` (each swap is one place), with the start position and the position after the last step. Places a step
 * moved with no car swapped (e.g. a car dropping out of the published order) count as unexplained, so the causes add up to the net change.
 */
export function rewindSummary(m: ReplayModel, i: number, steps: readonly RewindStep[]): RewindSummary {
  const byCause: Record<SwapCause, number> = { "own-pit": 0, "rival-pit": 0, "on-track": 0, "rival-stopped": 0, unexplained: 0 };
  for (const s of steps) {
    const sign = s.to < s.from ? 1 : -1;
    for (const w of s.swaps) byCause[w.cause] += sign;
    byCause.unexplained += sign * (Math.abs(s.to - s.from) - s.swaps.length);
  }
  const n = m.ds.drivers[i].number;
  return { start: m.positionOf(n, m.ds.lightsOutMs), now: steps.at(-1)?.to ?? m.positionOf(n, m.ds.lightsOutMs), byCause };
}
