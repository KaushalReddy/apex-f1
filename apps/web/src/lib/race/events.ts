import { battles } from "./session";
import type { RaceSnapshot } from "./types";

/**
 * Race events derived by comparing consecutive snapshots of ONE session state, so they always agree with the leaderboard and markers.
 * Only what the data supports is reported: order-based events need an ordered source; nothing about real incidents is invented.
 */
export type RaceEvent =
  | { id: string; t: number; kind: "overtake"; driver: string; passed: string | null; to: number }
  | { id: string; t: number; kind: "lap"; lap: number; totalLaps: number | null }
  | { id: string; t: number; kind: "pit-entry" | "pit-exit" | "finish"; driver: string }
  | { id: string; t: number; kind: "battle"; ahead: string; behind: string }
  | { id: string; t: number; kind: "session"; status: RaceSnapshot["session"]["status"] }
  // Historical replay (lib/replay): official race-control messages, published pit stops, and position changes derived from the official
  // order feed (a gain can come from a pass, a rival pitting or a retirement, so it is never called an overtake).
  | { id: string; t: number; kind: "official"; text: string; tone: "start" | "finish" | "safety-car" | "red-flag" }
  | { id: string; t: number; kind: "pit-stop"; driver: string; lap: number | null; laneS: number | null }
  | { id: string; t: number; kind: "position"; driver: string; from: number; to: number };

/** Battle thresholds with hysteresis, so a pair hovering around one value is reported once, not on every update. */
export const BATTLE_ENTER_S = 0.8;
export const BATTLE_EXIT_S = 1.2;

/**
 * Updates the set of active battles ("ahead|behind") and returns the pairs that have just started. A battle starts when the gap drops to
 * BATTLE_ENTER_S and ends once it grows past BATTLE_EXIT_S (or either car pits, finishes or the pair is no longer adjacent).
 */
export function updateBattles(active: Set<string>, s: RaceSnapshot): Array<[string, string]> {
  const started: Array<[string, string]> = [];
  const still = new Set<string>();
  for (const [a, b] of battles(s, BATTLE_EXIT_S)) {
    const key = `${a}|${b}`;
    const gap = s.drivers.find((d) => d.id === b)?.gapAheadS ?? Infinity;
    if (active.has(key) || gap <= BATTLE_ENTER_S) {
      still.add(key);
      if (!active.has(key)) started.push([a, b]);
    }
  }
  active.clear();
  still.forEach((k) => active.add(k));
  return started;
}

/**
 * With `battleState`, battles use hysteresis and are not reported on lap 1 (the field is still bunched behind the start); without it, a
 * battle is any newly adjacent pair within 1 s.
 */
export function diffSnapshots(prev: RaceSnapshot | null, next: RaceSnapshot, battleState?: Set<string>): RaceEvent[] {
  const out: RaceEvent[] = [];
  const t = next.t;
  if (!prev || prev.epoch !== next.epoch) return out;
  if (prev.session.status !== next.session.status) out.push({ id: `session:${next.session.status}:${t}`, t, kind: "session", status: next.session.status });
  if (next.session.lap != null && prev.session.lap != null && next.session.lap > prev.session.lap)
    out.push({ id: `lap:${next.session.lap}`, t, kind: "lap", lap: next.session.lap, totalLaps: next.session.totalLaps });

  const before = new Map(prev.drivers.map((d) => [d.id, d]));
  if (prev.ordered && next.ordered) {
    const prevAt = new Map(prev.drivers.filter((d) => d.position != null).map((d) => [d.position!, d.id]));
    for (const d of next.drivers) {
      const p = before.get(d.id);
      if (!p || p.position == null || d.position == null || d.position >= p.position || d.finished) continue;
      // Gains caused by a rival pitting still count: the order really changed. The car previously in the new slot is the one passed.
      const passed = prevAt.get(d.position) ?? null;
      out.push({ id: `overtake:${d.id}:${d.position}:${t}`, t, kind: "overtake", driver: d.id, passed: passed === d.id ? null : passed, to: d.position });
    }
    if (battleState) {
      const started = updateBattles(battleState, next);
      if ((next.session.lap ?? 0) > 1) for (const [a, b] of started) out.push({ id: `battle:${a}:${b}:${t}`, t, kind: "battle", ahead: a, behind: b });
    } else {
      const was = new Set(battles(prev).map(([a, b]) => `${a}|${b}`));
      for (const [a, b] of battles(next)) if (!was.has(`${a}|${b}`)) out.push({ id: `battle:${a}:${b}:${t}`, t, kind: "battle", ahead: a, behind: b });
    }
  }
  for (const d of next.drivers) {
    const p = before.get(d.id);
    if (!p) continue;
    if (p.pit !== "in-pit" && d.pit === "in-pit") out.push({ id: `pit-entry:${d.id}:${t}`, t, kind: "pit-entry", driver: d.id });
    if (p.pit === "in-pit" && d.pit === "none") out.push({ id: `pit-exit:${d.id}:${t}`, t, kind: "pit-exit", driver: d.id });
    if (!p.finished && d.finished) out.push({ id: `finish:${d.id}`, t, kind: "finish", driver: d.id });
  }
  return out;
}

/** Keeps the newest `max` events, newest first, without duplicates. */
export function appendEvents(log: readonly RaceEvent[], incoming: readonly RaceEvent[], max = 40): RaceEvent[] {
  if (incoming.length === 0) return log as RaceEvent[];
  const seen = new Set(log.map((e) => e.id));
  const fresh = incoming.filter((e) => !seen.has(e.id)).reverse();
  return [...fresh, ...log].slice(0, max);
}
