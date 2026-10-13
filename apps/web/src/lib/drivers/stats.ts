import type { ResultRow, ResultStatus, SeasonEvent, SeasonResults, Standing } from "./types";

/**
 * Metrics DERIVED from one season's source data. Every function works on a single season, so seasons are never mixed. Definitions:
 *
 *  - start            : a race result row whose status is not DNS.
 *  - classified finish: status FIN (a classified position). DNF, DSQ and NC are starts without a classified finish.
 *  - win / podium     : race position 1 / 1-3 (race only; sprints are not counted).
 *  - qualifying P1    : qualifying classification position 1. This is not "pole" in every case: grid penalties can move the starting
 *                       grid, which the snapshot does not include.
 *  - points           : race + sprint points from the classifications. The championship total is the PUBLISHED standing after the last
 *                       race in the snapshot (it can differ from the sum after penalties or other adjustments).
 *  - average finish   : mean race position over classified finishes only (non-finishes have no position and are not counted as last).
 *  - average qualifying: mean qualifying position over sessions with a classified position.
 *  - positions gained : mean (qualifying position - race position) over races with both a qualifying position and a classified finish.
 *                       Qualifying is not the starting grid (penalties), so this is labelled "vs qualifying", not "vs grid".
 *  - finish rate      : classified finishes / starts.
 *  - points per start : (race + sprint points) / starts.
 * Missing data stays missing: a round without a result row for the driver is "no result", never a zero-point finish.
 */

export interface DriverRound {
  round: number;
  name: string;
  date: string;
  circuitShortName: string | null;
  countryCode: string | null;
  race: ResultRow | null;
  sprint: ResultRow | null;
  qualifyingPosition: number | null;
  standing: Standing | null;
}

const rowFor = (rows: readonly ResultRow[] | undefined, acronym: string) => rows?.find((r) => r.acronym === acronym) ?? null;

/** One row per event in the season (including events the driver did not take part in: race === null). */
export function driverRounds(season: SeasonResults, acronym: string): DriverRound[] {
  return season.events.map((e: SeasonEvent) => ({
    round: e.round,
    name: e.name,
    date: e.date,
    circuitShortName: e.circuitShortName,
    countryCode: e.countryCode,
    race: rowFor(e.race.results, acronym),
    sprint: rowFor(e.sprint?.results, acronym),
    qualifyingPosition: rowFor(e.qualifying?.results, acronym)?.position ?? null,
    standing: e.standings?.find((s) => s.acronym === acronym) ?? null,
  }));
}

const mean = (xs: readonly number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

export interface SeasonStats {
  season: number;
  /** Events in the snapshot (completed races). */
  eventsInSnapshot: number;
  /** Events the driver has a race result for. */
  entries: number;
  starts: number;
  classified: number;
  wins: number;
  podiums: number;
  qualifyingP1: number;
  dnf: number;
  dns: number;
  dsq: number;
  nc: number;
  racePoints: number;
  sprintPoints: number;
  championship: { position: number | null; points: number | null; afterRound: number } | null;
  averageFinish: number | null;
  averageQualifying: number | null;
  positionsGainedVsQualifying: number | null;
  finishRate: number | null;
  pointsPerStart: number | null;
  /** Latest team in the season (a driver can change team mid-season). */
  team: string | null;
  number: number | null;
}

export function seasonStats(season: SeasonResults, acronym: string): SeasonStats {
  const rounds = driverRounds(season, acronym);
  const races = rounds.filter((r) => r.race);
  const status = (s: ResultStatus) => races.filter((r) => r.race!.status === s).length;
  const starts = races.filter((r) => r.race!.status !== "DNS");
  const fin = races.filter((r) => r.race!.status === "FIN");
  const sum = (xs: Array<ResultRow | null>) => xs.reduce((a, r) => a + (r?.points ?? 0), 0);
  const lastWithStanding = [...rounds].reverse().find((r) => r.standing);
  const lastRace = [...races].reverse()[0]?.race ?? null;
  const gained = fin.filter((r) => r.qualifyingPosition != null).map((r) => r.qualifyingPosition! - r.race!.position!);
  const racePoints = sum(races.map((r) => r.race));
  const sprintPoints = sum(rounds.map((r) => r.sprint));
  return {
    season: season.season,
    eventsInSnapshot: season.events.length,
    entries: races.length,
    starts: starts.length,
    classified: fin.length,
    wins: races.filter((r) => r.race!.position === 1).length,
    podiums: races.filter((r) => (r.race!.position ?? 99) <= 3).length,
    qualifyingP1: rounds.filter((r) => r.qualifyingPosition === 1).length,
    dnf: status("DNF"),
    dns: status("DNS"),
    dsq: status("DSQ"),
    nc: status("NC"),
    racePoints,
    sprintPoints,
    championship: lastWithStanding ? { position: lastWithStanding.standing!.position, points: lastWithStanding.standing!.points, afterRound: lastWithStanding.round } : null,
    averageFinish: mean(fin.map((r) => r.race!.position!)),
    averageQualifying: mean(rounds.filter((r) => r.qualifyingPosition != null).map((r) => r.qualifyingPosition!)),
    positionsGainedVsQualifying: mean(gained),
    finishRate: starts.length ? fin.length / starts.length : null,
    pointsPerStart: starts.length ? (racePoints + sprintPoints) / starts.length : null,
    team: lastRace?.team ?? null,
    number: lastRace?.number ?? null,
  };
}

/**
 * Championship points after each round, from the PUBLISHED standings. A round without a published standing for the driver is null (a gap in
 * the chart), never carried forward or zeroed. `derived` is the running sum of race + sprint points from the classifications, kept for
 * cross-checking (it can differ from the published total after penalties).
 */
export function pointsProgression(season: SeasonResults, acronym: string): Array<{ round: number; name: string; code: string; points: number | null; derived: number }> {
  let running = 0;
  return driverRounds(season, acronym).map((r) => {
    running += (r.race?.points ?? 0) + (r.sprint?.points ?? 0);
    return { round: r.round, name: r.name, code: r.countryCode ?? `R${r.round}`, points: r.standing?.points ?? null, derived: running };
  });
}

/** Race finishing position per round, keeping the status: a non-finish has position null and its status (DNF/DNS/DSQ/NC); no row = absent. */
export function finishingTrend(season: SeasonResults, acronym: string): Array<{ round: number; name: string; position: number | null; status: ResultStatus | "ABSENT" }> {
  return driverRounds(season, acronym).map((r) => ({ round: r.round, name: r.name, position: r.race?.position ?? null, status: r.race?.status ?? "ABSENT" }));
}

/** Qualifying vs race per round, only where BOTH a qualifying position and a classified finish exist. */
export function qualifyingVsRace(season: SeasonResults, acronym: string): Array<{ round: number; name: string; code: string; qualifying: number; finish: number }> {
  return driverRounds(season, acronym)
    .filter((r) => r.qualifyingPosition != null && r.race?.status === "FIN")
    .map((r) => ({ round: r.round, name: r.name, code: r.countryCode ?? `R${r.round}`, qualifying: r.qualifyingPosition!, finish: r.race!.position! }));
}

/** The last `n` races the driver has a result for, newest first. */
export const recentForm = (season: SeasonResults, acronym: string, n = 5) =>
  driverRounds(season, acronym)
    .filter((r) => r.race)
    .reverse()
    .slice(0, n);

export type Leader = "a" | "b" | "tie" | null;

/**
 * Head-to-head within ONE season, over the SAME events. Rules:
 *  - Race: only events where both drivers started (neither DNS). Both classified: higher finishing position wins. One classified, the other
 *    not (DNF/DSQ/NC): the classified driver wins. Neither classified: no decision (counted as "undecided", not a tie or a loss).
 *  - Qualifying: only events where both have a qualifying position; better position wins (positions are unique, so no ties).
 *  - Events where only one driver took part are listed but not scored.
 */
export function headToHead(season: SeasonResults, a: string, b: string) {
  const ra = driverRounds(season, a);
  const rb = driverRounds(season, b);
  const race = { a: 0, b: 0, undecided: 0, events: 0 };
  const quali = { a: 0, b: 0, events: 0 };
  let onlyA = 0;
  let onlyB = 0;
  ra.forEach((x, i) => {
    const y = rb[i];
    if (x.race && !y.race) onlyA++;
    if (!x.race && y.race) onlyB++;
    if (x.race && y.race && x.race.status !== "DNS" && y.race.status !== "DNS") {
      race.events++;
      const fa = x.race.status === "FIN";
      const fb = y.race.status === "FIN";
      if (fa && fb) {
        if (x.race.position! < y.race.position!) race.a++;
        else race.b++;
      }
      else if (fa) race.a++;
      else if (fb) race.b++;
      else race.undecided++;
    }
    if (x.qualifyingPosition != null && y.qualifyingPosition != null) {
      quali.events++;
      if (x.qualifyingPosition < y.qualifyingPosition) quali.a++;
      else quali.b++;
    }
  });
  return { season: season.season, race, quali, onlyA, onlyB };
}

/** Which driver leads a metric. `higherIsBetter` false for positions. Null when either value is missing (missing is not a loss). */
export function leader(va: number | null | undefined, vb: number | null | undefined, higherIsBetter: boolean): Leader {
  if (va == null || vb == null) return null;
  if (va === vb) return "tie";
  return va > vb === higherIsBetter ? "a" : "b";
}

/** Drivers who took part in a season (have at least one race result row), with their latest team, number and published standing. */
export function seasonLineup(season: SeasonResults) {
  const acronyms = new Set<string>();
  for (const e of season.events) for (const r of e.race.results) if (!r.acronym.startsWith("#")) acronyms.add(r.acronym);
  return [...acronyms].map((acronym) => {
    const s = seasonStats(season, acronym);
    return { acronym, team: s.team, number: s.number, wins: s.wins, podiums: s.podiums, starts: s.starts, championship: s.championship };
  });
}
