import type { SeasonResults } from "@/lib/drivers/types";

export interface PreviousRace {
  season: number;
  name: string;
  date: string;
  sessionKey: number;
  circuitShortName: string | null;
}

/** The most recent race in the results snapshots held on or before `today` (YYYY-MM-DD): what Live offers when nothing is live. */
export function previousRace(seasons: readonly SeasonResults[], today: string): PreviousRace | null {
  let best: PreviousRace | null = null;
  for (const s of seasons)
    for (const e of s.events)
      if (e.race.date <= today && (!best || e.race.date > best.date))
        best = { season: s.season, name: e.name, date: e.race.date, sessionKey: e.race.sessionKey, circuitShortName: e.circuitShortName };
  return best;
}
