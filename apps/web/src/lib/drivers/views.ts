import { DEMO_DRIVERS } from "@/domain/demo";
import { teamFor } from "@/lib/teams/registry";
import { circuitPage, domainTeam, driverRegistry, teamColour, type DriverRef } from "./identity";
import { driverRounds, finishingTrend, pointsProgression, qualifyingVsRace, seasonLineup, seasonStats, type DriverRound, type SeasonStats } from "./stats";
import type { SeasonResults } from "./types";

/** Compact, serialisable data for the pages (computed on the server; the browser receives only what it shows). */

export interface SeasonMeta {
  season: number;
  complete: boolean;
  eventsInSnapshot: number;
  scheduledRaces: number;
  fetchedOn: string;
  source: string;
  sourceUrl: string;
  skipped: Array<{ round: number; name: string; date: string }>;
}

export const seasonMeta = (s: SeasonResults): SeasonMeta => ({
  season: s.season,
  complete: s.complete,
  eventsInSnapshot: s.events.length,
  scheduledRaces: s.scheduledRaces,
  fetchedOn: s.source.fetchedOn,
  source: s.source.name,
  sourceUrl: s.source.url,
  skipped: (s.skipped ?? []).map(({ round, name, date }) => ({ round, name, date })),
});

export interface DirectoryEntry {
  slug: string;
  acronym: string;
  name: string;
  countryCode: string | null;
  team: string | null;
  teamColour: string;
  number: number | null;
  championshipPosition: number | null;
  championshipPoints: number | null;
  wins: number;
  podiums: number;
  starts: number;
}

export function directory(seasons: readonly SeasonResults[]): Array<{ meta: SeasonMeta; drivers: DirectoryEntry[] }> {
  const reg = new Map(driverRegistry(seasons).map((r) => [r.acronym, r]));
  return seasons.map((s) => ({
    meta: seasonMeta(s),
    drivers: seasonLineup(s)
      .map((l) => {
        const ref = reg.get(l.acronym);
        return ref
          ? {
              slug: ref.slug,
              acronym: l.acronym,
              name: ref.name,
              countryCode: ref.countryCode,
              team: l.team,
              teamColour: teamColour(s, l.team),
              number: l.number,
              championshipPosition: l.championship?.position ?? null,
              championshipPoints: l.championship?.points ?? null,
              wins: l.wins,
              podiums: l.podiums,
              starts: l.starts,
            }
          : null;
      })
      .filter((d): d is DirectoryEntry => d !== null),
  }));
}

export interface ProfileSeason {
  meta: SeasonMeta;
  stats: SeasonStats;
  team: string | null;
  teamColour: string;
  teamSlug: string | null;
  /** Set only when the team has a Phase 4 3D car (/cars/<slug>). */
  carSlug: string | null;
  rounds: Array<DriverRound & { circuitSlug: string | null }>;
  progression: ReturnType<typeof pointsProgression>;
  trend: ReturnType<typeof finishingTrend>;
  qualiVsRace: ReturnType<typeof qualifyingVsRace>;
}

export interface Profile {
  ref: DriverRef;
  seasons: ProfileSeason[];
  /** Totals over the seasons IN THIS DATASET only (not career totals). */
  dataset: { seasons: number[]; starts: number; wins: number; podiums: number; qualifyingP1: number; points: number; teams: string[] };
  /** The driver exists in the simulated race demo (the race view can open with them selected). */
  inRaceDemo: boolean;
}

export function profile(seasons: readonly SeasonResults[], slug: string): Profile | null {
  const ref = driverRegistry(seasons).find((r) => r.slug === slug);
  if (!ref) return null;
  const per: ProfileSeason[] = seasons
    .map((s) => {
      const stats = seasonStats(s, ref.acronym);
      if (stats.entries === 0) return null;
      const team = domainTeam(stats.team);
      return {
        meta: seasonMeta(s),
        stats,
        team: stats.team,
        teamColour: teamColour(s, stats.team),
        teamSlug: teamFor(stats.team)?.slug ?? null,
        carSlug: team?.slug ?? null,
        rounds: driverRounds(s, ref.acronym).map((r) => ({ ...r, circuitSlug: circuitPage(r.circuitShortName) ?? null })),
        progression: pointsProgression(s, ref.acronym),
        trend: finishingTrend(s, ref.acronym),
        qualiVsRace: qualifyingVsRace(s, ref.acronym),
      };
    })
    .filter((p): p is ProfileSeason => p !== null);
  const teams = [...new Set(per.flatMap((p) => p.rounds.map((r) => r.race?.team).filter((t): t is string => !!t)))];
  return {
    ref,
    seasons: per,
    dataset: {
      seasons: per.map((p) => p.meta.season),
      starts: per.reduce((a, p) => a + p.stats.starts, 0),
      wins: per.reduce((a, p) => a + p.stats.wins, 0),
      podiums: per.reduce((a, p) => a + p.stats.podiums, 0),
      qualifyingP1: per.reduce((a, p) => a + p.stats.qualifyingP1, 0),
      points: per.reduce((a, p) => a + p.stats.racePoints + p.stats.sprintPoints, 0),
      teams,
    },
    inRaceDemo: DEMO_DRIVERS.some((d) => d.slug === slug && d.code === ref.acronym),
  };
}
