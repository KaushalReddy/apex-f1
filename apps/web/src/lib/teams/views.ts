import { DEMO_DRIVERS } from "@/domain/demo";
import { teamColour } from "@/lib/drivers/identity";
import type { SeasonResults } from "@/lib/drivers/types";
import { seasonMeta, type SeasonMeta } from "@/lib/drivers/views";
import { cardShade, findTeamBySlug, TEAMS, type Team } from "./registry";
import { seasonName, teamLineup, teammateHeadToHead, teamProgression, teamRounds, teamSeasonStats, type LineupDriver, type TeamRound, type TeamSeasonStats } from "./stats";

/** Directory card data for one team in one season. `order` is the canonical index (the default sort). */
export interface TeamCardData {
  slug: string;
  order: number;
  name: string;
  /** The name published for this season, when it differs from the current one (e.g. "Kick Sauber" for Audi in 2025). */
  racedAs: string | null;
  code: string;
  colour: string;
  shade: string;
  image: Team["image"];
  carViewer: boolean;
  drivers: Array<{ acronym: string; name: string }>;
  /** Further drivers who raced for the team that season (mid-season changes, stand-ins). */
  otherDrivers: number;
  position: number | null;
  points: number | null;
  wins: number;
}

/** One entry per season in the dataset; a team that did not enter a season is not listed for it (nothing is filled in). */
export function teamDirectory(seasons: readonly SeasonResults[]): Array<{ meta: SeasonMeta; teams: TeamCardData[] }> {
  return seasons.map((s) => ({
    meta: seasonMeta(s),
    teams: TEAMS.flatMap((t, order) => {
      const name = seasonName(s, t);
      if (!name) return [];
      const st = teamSeasonStats(s, t);
      const lineup = teamLineup(s, t, seasons);
      const colour = teamColour(s, name);
      return [{
        slug: t.slug, order, name: t.name, racedAs: name !== t.name ? name : null, code: t.code, colour, shade: cardShade(colour),
        image: t.image, carViewer: t.carViewer,
        drivers: lineup.slice(0, 2).map((d) => ({ acronym: d.acronym, name: d.name })),
        otherDrivers: Math.max(0, lineup.length - 2),
        position: st.championship?.position ?? null, points: st.championship?.points ?? null, wins: st.wins,
      }];
    }),
  }));
}

export interface TeamProfileSeason {
  meta: SeasonMeta;
  name: string;
  colour: string;
  stats: TeamSeasonStats;
  rounds: TeamRound[];
  progression: ReturnType<typeof teamProgression>;
  lineup: Array<LineupDriver & { inRaceDemo: boolean }>;
  teammates: ReturnType<typeof teammateHeadToHead>;
}

export interface TeamProfile {
  team: Team;
  shade: string;
  colour: string;
  seasons: TeamProfileSeason[];
  /** Totals over the seasons IN THIS DATASET only. */
  dataset: { seasons: number[]; wins: number; podiums: number; points: number; names: string[] };
}

export function teamProfile(seasons: readonly SeasonResults[], slug: string): TeamProfile | null {
  const team = findTeamBySlug(slug);
  if (!team) return null;
  const per = seasons.flatMap((s): TeamProfileSeason[] => {
    const name = seasonName(s, team);
    if (!name) return [];
    const lineup = teamLineup(s, team, seasons);
    return [{
      meta: seasonMeta(s),
      name,
      colour: teamColour(s, name),
      stats: teamSeasonStats(s, team),
      rounds: teamRounds(s, team),
      progression: teamProgression(s, team),
      lineup: lineup.map((d) => ({ ...d, inRaceDemo: DEMO_DRIVERS.some((x) => x.slug === d.slug && x.code === d.acronym) })),
      teammates: teammateHeadToHead(s, team, lineup),
    }];
  });
  const colour = per[0]?.colour ?? "#8a94a2";
  return {
    team,
    colour,
    shade: cardShade(colour),
    seasons: per,
    dataset: {
      seasons: per.map((p) => p.meta.season),
      wins: per.reduce((a, p) => a + p.stats.wins, 0),
      podiums: per.reduce((a, p) => a + p.stats.podiums, 0),
      points: per.reduce((a, p) => a + p.stats.points, 0),
      names: [...new Set(per.map((p) => p.name))],
    },
  };
}
