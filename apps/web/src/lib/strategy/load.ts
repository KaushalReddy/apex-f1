import { loadReplayDataset } from "@/lib/replay/load";
import { lapRows, neutralisedPeriods, type Neutralisation } from "@/lib/replay/laps";
import { ReplayModel } from "@/lib/replay/model";
import { finalGaps, stintsOf, type FinalGap, type StintView } from "./strategy";

export interface StrategyDriver {
  number: number;
  code: string;
  name: string | null;
  team: string | null;
  colour: string | null;
  stints: StintView[];
  /** Official lap times with the reasons a lap is not comparable. */
  laps: { lap: number; lapS: number | null; pit: boolean; neutralisedBy: Neutralisation[] }[];
}

export interface StrategyData {
  season: number;
  sessionKey: number;
  eventName: string;
  date: string;
  totalLaps: number;
  drivers: StrategyDriver[];
  finals: FinalGap[];
  /** Safety Car / VSC / red-flag periods as lap ranges (for the stint chart's background). */
  periods: { kind: Neutralisation; fromLap: number; toLap: number }[];
  source: { fetchedOn: string };
}

/** SERVER ONLY. One race's strategy data from its replay dataset (public/replay), computed once per request; never the whole file to the browser. */
export async function loadStrategy(season: number, sessionKey: number): Promise<{ ok: true; data: StrategyData } | { ok: false; error: string }> {
  const parsed = await loadReplayDataset(season, sessionKey);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const m = new ReplayModel(parsed.value, null);
  const drivers = m.ds.drivers.map((d, i) => {
    const rows = lapRows(m, i);
    return {
      number: d.number,
      code: d.acronym ?? `#${d.number}`,
      name: d.fullName,
      team: d.team,
      colour: d.teamColour,
      stints: stintsOf(m, i, rows),
      laps: rows.map((r) => ({ lap: r.lap, lapS: r.lapS, pit: r.pit, neutralisedBy: r.neutralisedBy })),
    };
  });
  const totalLaps = Math.max(0, ...drivers.flatMap((d) => d.laps.map((l) => l.lap)));
  // Periods in laps, from the leader's lap starts at those times.
  const finals = finalGaps(m);
  const leaderIdx = m.ds.drivers.findIndex((d) => d.number === finals[0]?.number);
  const lapAt = (t: number) => (leaderIdx >= 0 ? (m.lapAt(leaderIdx, t).lap ?? 1) : 1);
  const periods = neutralisedPeriods(m).map((p) => ({ kind: p.kind, fromLap: lapAt(p.from), toLap: lapAt(p.to) }));
  return { ok: true, data: { season, sessionKey, eventName: m.ds.eventName, date: m.ds.date, totalLaps, drivers, finals, periods, source: { fetchedOn: m.ds.source.fetchedOn } } };
}
