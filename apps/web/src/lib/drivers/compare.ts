import { teamFor } from "@/lib/teams/registry";
import { driverRegistry, teamColour } from "./identity";
import { headToHead, leader, pointsProgression, seasonLineup, seasonStats, type Leader } from "./stats";
import type { SeasonResults } from "./types";

export interface CompareSide {
  slug: string;
  acronym: string;
  name: string;
  team: string | null;
  teamColour: string;
  teamSlug: string | null;
  number: number | null;
}

export interface CompareMetric {
  label: string;
  /** Shown for context only; no leader is marked. */
  context?: boolean;
  a: number | null;
  b: number | null;
  kind: "int" | "dec" | "pos" | "pct";
  leader: Leader;
}

/**
 * Builds a fair comparison from URL parameters: one season (default: latest), two drivers who both took part in it (defaults: the top two
 * of its published standings). An unknown season or a driver who did not race that season falls back to the default and says so in
 * `notices`, rather than silently comparing different datasets.
 */
export function compare(seasons: readonly SeasonResults[], q: { season?: string; a?: string; b?: string }) {
  if (seasons.length === 0) return null;
  const notices: string[] = [];
  const requested = Number(q.season);
  let season = seasons.find((s) => s.season === requested);
  if (q.season && !season) notices.push(`No results for ${q.season}; showing ${seasons[0].season}.`);
  season ??= seasons[0];

  const reg = driverRegistry(seasons);
  const bySlug = new Map(reg.map((r) => [r.slug, r]));
  const lineup = seasonLineup(season)
    .map((l) => ({ ...l, ref: reg.find((r) => r.acronym === l.acronym) }))
    .filter((l) => l.ref)
    .sort((x, y) => (x.championship?.position ?? 99) - (y.championship?.position ?? 99));
  const inSeason = (slug?: string) => lineup.find((l) => l.ref!.slug === slug);

  const pick = (slug: string | undefined, fallback: number, label: string) => {
    const hit = inSeason(slug);
    if (slug && !hit) notices.push(`${bySlug.get(slug)?.name ?? slug} did not race in ${season!.season}; driver ${label} reset.`);
    return hit ?? lineup[fallback] ?? lineup[0];
  };
  const la = pick(q.a, 0, "A");
  let lb = pick(q.b, 1, "B");
  if (lb.acronym === la.acronym) {
    if (q.b) notices.push("The same driver was chosen twice; driver B changed.");
    lb = lineup.find((l) => l.acronym !== la.acronym) ?? lb;
  }

  const side = (l: (typeof lineup)[number]): CompareSide => ({
    slug: l.ref!.slug,
    acronym: l.acronym,
    name: l.ref!.name,
    team: l.team,
    teamColour: teamColour(season!, l.team),
    teamSlug: teamFor(l.team)?.slug ?? null,
    number: l.number,
  });
  const sa = seasonStats(season, la.acronym);
  const sb = seasonStats(season, lb.acronym);
  const m = (label: string, a: number | null, b: number | null, kind: CompareMetric["kind"], higherIsBetter: boolean): CompareMetric => ({ label, a, b, kind, leader: leader(a, b, higherIsBetter) });
  const pa = pointsProgression(season, la.acronym);
  const pb = pointsProgression(season, lb.acronym);

  return {
    season: season.season,
    seasonOptions: seasons.map((s) => s.season),
    lineup: lineup.map((l) => ({ slug: l.ref!.slug, acronym: l.acronym, name: l.ref!.name })).sort((x, y) => x.name.localeCompare(y.name)),
    a: side(la),
    b: side(lb),
    teammates: !!sa.team && sa.team === sb.team,
    notices,
    metrics: [
      m("Championship", sa.championship?.position ?? null, sb.championship?.position ?? null, "pos", false),
      m("Points", sa.championship?.points ?? null, sb.championship?.points ?? null, "int", true),
      m("Wins", sa.wins, sb.wins, "int", true),
      m("Podiums", sa.podiums, sb.podiums, "int", true),
      m("Qualifying P1", sa.qualifyingP1, sb.qualifyingP1, "int", true),
      m("Starts", sa.starts, sb.starts, "int", true),
      m("Avg finish", sa.averageFinish, sb.averageFinish, "dec", false),
      m("Avg qualifying", sa.averageQualifying, sb.averageQualifying, "dec", false),
      m("Finish rate", sa.finishRate, sb.finishRate, "pct", true),
      m("Points / start", sa.pointsPerStart, sb.pointsPerStart, "dec", true),
    ].map((x) => (x.label === "Starts" ? { ...x, context: true } : x)), // starts are context, not a contest
    h2h: headToHead(season, la.acronym, lb.acronym),
    progression: pa.map((p, i) => ({ round: p.round, name: p.name, code: p.code, a: p.points, b: pb[i].points })),
    skipped: (season.skipped ?? []).map((s) => `${s.name} (${s.date})`),
  };
}
