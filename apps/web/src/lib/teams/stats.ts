import { circuitPage, driverRegistry } from "@/lib/drivers/identity";
import { headToHead } from "@/lib/drivers/stats";
import type { ResultRow, ResultStatus, SeasonResults } from "@/lib/drivers/types";
import type { Team } from "./registry";

/**
 * Constructor metrics DERIVED from one season's source data (same conventions as lib/drivers/stats.ts). A car belongs to the team when its
 * published `team` is one of the team's aliases for that row, so a driver who changed team mid-season counts for each team only in the
 * races they drove for it. Definitions:
 *
 *  - entered event     : the team has at least one race result row in the event.
 *  - team points/event : race + sprint points of the team's cars in that event. Not entered = null ("no entry"), never 0.
 *  - championship      : the PUBLISHED constructors' standing after the latest round that has one. The running sum of team points is kept
 *                        as `derived` for cross-checking.
 *  - wins / podiums    : race finishes in P1 / P1-P3, counted per car (a 1-2 is one win and two podiums). Sprints are not counted.
 *  - qualifying P1     : events where a team car was P1 in qualifying (not "pole": grid penalties are not in the data).
 *  - points per event  : derived team points / entered events.
 *  - finish rate       : classified finishes / car starts (start = any race row except DNS).
 *  - scoring rate      : entered events with team points > 0 / entered events.
 */

const isTeam = (team: Team, name: string | null | undefined) => !!name && team.aliases.some((a) => a.toLowerCase() === name.toLowerCase());

/** The name the team raced under in this season (it can differ from the current name), or null if it did not enter. */
export function seasonName(season: SeasonResults, team: Team): string | null {
  for (const e of season.events) for (const r of e.race.results) if (isTeam(team, r.team)) return r.team;
  return null;
}

export interface TeamCar {
  acronym: string;
  position: number | null;
  status: ResultStatus;
  racePoints: number;
  sprintPoints: number;
  qualifying: number | null;
}

export interface TeamRound {
  round: number;
  name: string;
  code: string;
  date: string;
  circuitShortName: string | null;
  circuitSlug: string | null;
  entered: boolean;
  /** The team's cars in the race, best classified first. */
  cars: TeamCar[];
  /** Race + sprint points of the team's cars; null when the team did not enter. */
  points: number | null;
  /** Published constructors' standing after this round. */
  standing: { position: number | null; points: number | null } | null;
}

const order = (a: ResultRow, b: ResultRow) => (a.position ?? 99) - (b.position ?? 99);

export function teamRounds(season: SeasonResults, team: Team): TeamRound[] {
  return season.events.map((e) => {
    const race = e.race.results.filter((r) => isTeam(team, r.team)).sort(order);
    const cars = race.map((r) => ({
      acronym: r.acronym,
      position: r.position,
      status: r.status,
      racePoints: r.points ?? 0,
      sprintPoints: e.sprint?.results.find((s) => s.acronym === r.acronym && isTeam(team, s.team))?.points ?? 0,
      qualifying: e.qualifying?.results.find((q) => q.acronym === r.acronym)?.position ?? null,
    }));
    const st = e.teamStandings?.find((t) => isTeam(team, t.team));
    return {
      round: e.round,
      name: e.name,
      code: e.countryCode ?? `R${e.round}`,
      date: e.date,
      circuitShortName: e.circuitShortName,
      circuitSlug: circuitPage(e.circuitShortName) ?? null,
      entered: cars.length > 0,
      cars,
      points: cars.length ? cars.reduce((a, c) => a + c.racePoints + c.sprintPoints, 0) : null,
      standing: st ? { position: st.position, points: st.points } : null,
    };
  });
}

export interface TeamSeasonStats {
  season: number;
  name: string | null;
  eventsInSnapshot: number;
  entries: number;
  starts: number;
  classified: number;
  wins: number;
  podiums: number;
  qualifyingP1: number;
  points: number;
  scoringEvents: number;
  bestFinish: number | null;
  championship: { position: number | null; points: number | null; afterRound: number } | null;
  pointsPerEvent: number | null;
  finishRate: number | null;
  scoringRate: number | null;
}

export function teamSeasonStats(season: SeasonResults, team: Team): TeamSeasonStats {
  const rounds = teamRounds(season, team);
  const cars = rounds.flatMap((r) => r.cars);
  const entered = rounds.filter((r) => r.entered);
  const starts = cars.filter((c) => c.status !== "DNS").length;
  const classified = cars.filter((c) => c.status === "FIN").length;
  const points = entered.reduce((a, r) => a + r.points!, 0);
  const lastStanding = [...rounds].reverse().find((r) => r.standing);
  const finishes = cars.filter((c) => c.position != null && c.status === "FIN").map((c) => c.position!);
  return {
    season: season.season,
    name: seasonName(season, team),
    eventsInSnapshot: season.events.length,
    entries: entered.length,
    starts,
    classified,
    wins: cars.filter((c) => c.status === "FIN" && c.position === 1).length,
    podiums: cars.filter((c) => c.status === "FIN" && c.position! <= 3).length,
    qualifyingP1: rounds.filter((r) => r.cars.some((c) => c.qualifying === 1)).length,
    points,
    scoringEvents: entered.filter((r) => r.points! > 0).length,
    bestFinish: finishes.length ? Math.min(...finishes) : null,
    championship: lastStanding ? { ...lastStanding.standing!, afterRound: lastStanding.round } : null,
    pointsPerEvent: entered.length ? points / entered.length : null,
    finishRate: starts ? classified / starts : null,
    scoringRate: entered.length ? entered.filter((r) => r.points! > 0).length / entered.length : null,
  };
}

/** Published constructors' points after each round (null = no published standing: a gap), plus the derived running sum. */
export function teamProgression(season: SeasonResults, team: Team) {
  let running = 0;
  return teamRounds(season, team).map((r) => {
    running += r.points ?? 0;
    return { round: r.round, name: r.name, code: r.code, points: r.standing?.points ?? null, derived: running };
  });
}

export interface LineupDriver {
  acronym: string;
  slug: string | null;
  name: string;
  number: number | null;
  /** Rounds driven for THIS team (a driver can change team mid-season). */
  rounds: number[];
  starts: number;
  points: number;
  wins: number;
  podiums: number;
  bestFinish: number | null;
  averageFinish: number | null;
  /** Published drivers' championship position (whole season, all teams). */
  championshipPosition: number | null;
  /** Last up-to-5 results for this team, newest first: "P4", "DNF", ... */
  recent: string[];
}

/** Everyone who raced for the team in the season, most starts first. Season-specific: no line-up is carried across seasons. */
export function teamLineup(season: SeasonResults, team: Team, allSeasons: readonly SeasonResults[] = [season]): LineupDriver[] {
  const reg = new Map(driverRegistry(allSeasons).map((r) => [r.acronym, r]));
  const rounds = teamRounds(season, team);
  const lastStandings = [...season.events].reverse().find((e) => e.standings?.length)?.standings ?? [];
  const by = new Map<string, LineupDriver>();
  for (const r of rounds)
    for (const c of r.cars) {
      const d =
        by.get(c.acronym) ??
        by.set(c.acronym, {
          acronym: c.acronym,
          slug: reg.get(c.acronym)?.slug ?? null,
          name: reg.get(c.acronym)?.name ?? c.acronym,
          number: season.events.flatMap((e) => e.race.results).find((x) => x.acronym === c.acronym)?.number ?? null,
          rounds: [], starts: 0, points: 0, wins: 0, podiums: 0, bestFinish: null, averageFinish: null,
          championshipPosition: lastStandings.find((s) => s.acronym === c.acronym)?.position ?? null,
          recent: [],
        }).get(c.acronym)!;
      d.rounds.push(r.round);
      if (c.status !== "DNS") d.starts++;
      d.points += c.racePoints + c.sprintPoints;
      if (c.status === "FIN" && c.position === 1) d.wins++;
      if (c.status === "FIN" && c.position! <= 3) d.podiums++;
      d.recent.unshift(c.status === "FIN" ? `P${c.position}` : c.status);
    }
  for (const d of by.values()) {
    const fins = rounds.flatMap((r) => r.cars).filter((c) => c.acronym === d.acronym && c.status === "FIN").map((c) => c.position!);
    d.bestFinish = fins.length ? Math.min(...fins) : null;
    d.averageFinish = fins.length ? fins.reduce((a, b) => a + b, 0) / fins.length : null;
    d.recent = d.recent.slice(0, 5);
  }
  return [...by.values()].sort((a, b) => b.starts - a.starts || b.points - a.points);
}

/**
 * Teammate head-to-head for the two drivers with the most starts, using the driver rules (lib/drivers/stats.ts headToHead) but only over
 * events where BOTH drove for this team, so races from before or after a mid-season move are not compared as teammates.
 */
export function teammateHeadToHead(season: SeasonResults, team: Team, lineup: readonly LineupDriver[]) {
  if (lineup.length < 2) return null;
  const [a, b] = lineup;
  const shared = new Set(a.rounds.filter((r) => b.rounds.includes(r)));
  if (!shared.size) return null;
  return { a: a.acronym, b: b.acronym, ...headToHead({ ...season, events: season.events.filter((e) => shared.has(e.round)) }, a.acronym, b.acronym) };
}
