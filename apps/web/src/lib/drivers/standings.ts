import { teamFor } from "@/lib/teams/registry";
import { driverRegistry, teamColour } from "./identity";
import { seasonStats } from "./stats";
import type { SeasonResults } from "./types";

/**
 * Championship tables for one season. Positions and points are the PUBLISHED standings after the latest round that has them; everything
 * else is derived from the same season's classifications and labelled so: the position change (vs the previous published standing),
 * the gap to the leader (leader's points minus this entry's points) and wins/podiums (race classifications only).
 */
export interface DriverStandingRow {
  position: number | null;
  acronym: string;
  slug: string | null;
  name: string;
  team: string | null;
  teamColour: string;
  points: number | null;
  gapToLeader: number | null;
  /** Places gained (+) or lost (-) since the previous published standing; null when there is none to compare with. */
  change: number | null;
  wins: number;
  podiums: number;
}

export interface TeamStandingRow {
  position: number | null;
  team: string;
  teamColour: string;
  teamSlug: string | null;
  points: number | null;
  gapToLeader: number | null;
  change: number | null;
  wins: number;
}

export interface SeasonStandings {
  season: number;
  complete: boolean;
  afterRound: number | null;
  afterEvent: string | null;
  racesCounted: number;
  scheduledRaces: number;
  drivers: DriverStandingRow[];
  /** Null when the snapshot has no published constructors' standings. */
  teams: TeamStandingRow[] | null;
}

export function seasonStandings(season: SeasonResults, allSeasons: readonly SeasonResults[] = [season]): SeasonStandings {
  const withDrivers = season.events.filter((e) => e.standings?.length);
  const last = withDrivers[withDrivers.length - 1] ?? null;
  const prev = withDrivers[withDrivers.length - 2] ?? null;
  const reg = new Map(driverRegistry(allSeasons).map((r) => [r.acronym, r]));
  const prevPos = new Map((prev?.standings ?? []).map((s) => [s.acronym, s.position]));
  const leaderPts = last?.standings?.[0]?.points ?? null;

  const drivers: DriverStandingRow[] = (last?.standings ?? []).map((s) => {
    const st = seasonStats(season, s.acronym);
    const before = prevPos.get(s.acronym);
    return {
      position: s.position,
      acronym: s.acronym,
      slug: reg.get(s.acronym)?.slug ?? null,
      name: reg.get(s.acronym)?.name ?? s.acronym,
      team: st.team,
      teamColour: teamColour(season, st.team),
      points: s.points,
      gapToLeader: leaderPts != null && s.points != null ? leaderPts - s.points : null,
      change: before != null && s.position != null ? before - s.position : null,
      wins: st.wins,
      podiums: st.podiums,
    };
  });

  const withTeams = season.events.filter((e) => e.teamStandings?.length);
  const lastT = withTeams[withTeams.length - 1] ?? null;
  const prevT = withTeams[withTeams.length - 2] ?? null;
  const prevTeamPos = new Map((prevT?.teamStandings ?? []).map((t) => [t.team, t.position]));
  const teamWins = new Map<string, number>();
  for (const e of season.events) {
    const winner = e.race.results.find((r) => r.position === 1);
    if (winner?.team) teamWins.set(winner.team, (teamWins.get(winner.team) ?? 0) + 1);
  }
  const leaderT = lastT?.teamStandings?.[0]?.points ?? null;
  const teams: TeamStandingRow[] | null = lastT
    ? lastT.teamStandings!.map((t) => {
        const before = prevTeamPos.get(t.team);
        return {
          position: t.position,
          team: t.team,
          teamColour: teamColour(season, t.team),
          teamSlug: teamFor(t.team)?.slug ?? null,
          points: t.points,
          gapToLeader: leaderT != null && t.points != null ? leaderT - t.points : null,
          change: before != null && t.position != null ? before - t.position : null,
          wins: teamWins.get(t.team) ?? 0,
        };
      })
    : null;

  return {
    season: season.season,
    complete: season.complete,
    afterRound: last?.round ?? null,
    afterEvent: last?.name ?? null,
    racesCounted: season.events.length,
    scheduledRaces: season.scheduledRaces,
    drivers,
    teams,
  };
}
