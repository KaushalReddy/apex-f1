import { teamColour } from "@/lib/drivers/identity";
import { leader, type Leader } from "@/lib/drivers/stats";
import type { SeasonResults } from "@/lib/drivers/types";
import { findTeamBySlug, TEAMS, type Team } from "./registry";
import { seasonName, teamLineup, teamProgression, teamRounds, teamSeasonStats } from "./stats";

export interface TeamCompareMetric {
  label: string;
  a: number | null;
  b: number | null;
  kind: "int" | "dec" | "pos" | "pct";
  leader: Leader;
  /** Shown for context, not scored (e.g. entries). */
  context?: boolean;
}

/**
 * Two teams, ONE season. Defaults: the latest season and the top two of its published constructors' standings. Event head-to-head counts
 * only events both teams entered: more team points (race + sprint) wins the event; equal points (including both on zero) is a tie.
 * Metrics with no value for either team are "not comparable", never a loss.
 */
export function compareTeams(seasons: readonly SeasonResults[], q: { season?: string; a?: string; b?: string }) {
  if (!seasons.length) return null;
  const notices: string[] = [];
  let season = seasons.find((s) => String(s.season) === q.season);
  if (q.season && !season) notices.push(`No results for ${q.season}; showing ${seasons[0].season}.`);
  season ??= seasons[0];
  const entered = TEAMS.filter((t) => seasonName(season!, t));
  const byStanding = [...entered].sort((x, y) => (teamSeasonStats(season!, x).championship?.position ?? 99) - (teamSeasonStats(season!, y).championship?.position ?? 99));

  const pick = (slug: string | undefined, label: string, fallback: Team): Team => {
    const t = slug ? findTeamBySlug(slug) : undefined;
    if (slug && !t) notices.push(`Unknown team “${slug}”; team ${label} reset.`);
    else if (t && !entered.includes(t)) notices.push(`${t.name} did not race in ${season!.season}; team ${label} reset.`);
    else if (t) return t;
    return fallback;
  };
  const a = pick(q.a, "A", byStanding[0]);
  let b = pick(q.b, "B", byStanding.find((t) => t !== a)!);
  if (a === b) {
    notices.push("The same team was chosen twice; team B reset.");
    b = byStanding.find((t) => t !== a)!;
  }

  const side = (t: Team) => {
    const name = seasonName(season!, t)!;
    return { slug: t.slug, name: t.name, racedAs: name !== t.name ? name : null, code: t.code, colour: teamColour(season!, name), stats: teamSeasonStats(season!, t), lineup: teamLineup(season!, t, seasons) };
  };
  const A = side(a);
  const B = side(b);
  const m = (label: string, va: number | null, vb: number | null, kind: TeamCompareMetric["kind"], higher: boolean, context = false): TeamCompareMetric => ({
    label, a: va, b: vb, kind, leader: context ? null : leader(va, vb, higher), context,
  });
  const metrics = [
    m("Championship position", A.stats.championship?.position ?? null, B.stats.championship?.position ?? null, "pos", false),
    m("Points (published)", A.stats.championship?.points ?? null, B.stats.championship?.points ?? null, "int", true),
    m("Wins", A.stats.wins, B.stats.wins, "int", true),
    m("Podium finishes", A.stats.podiums, B.stats.podiums, "int", true),
    m("Qualifying P1", A.stats.qualifyingP1, B.stats.qualifyingP1, "int", true),
    m("Points per event", A.stats.pointsPerEvent, B.stats.pointsPerEvent, "dec", true),
    m("Best finish", A.stats.bestFinish, B.stats.bestFinish, "pos", false),
    m("Finish rate", A.stats.finishRate, B.stats.finishRate, "pct", true),
    m("Scoring rate", A.stats.scoringRate, B.stats.scoringRate, "pct", true),
    m("Events entered", A.stats.entries, B.stats.entries, "int", true, true),
  ];

  const ra = teamRounds(season, a);
  const rb = teamRounds(season, b);
  const events = { a: 0, b: 0, tie: 0, compared: 0, onlyA: 0, onlyB: 0 };
  ra.forEach((x, i) => {
    const y = rb[i];
    if (x.entered && !y.entered) events.onlyA++;
    if (!x.entered && y.entered) events.onlyB++;
    if (!x.entered || !y.entered) return;
    events.compared++;
    if (x.points! > y.points!) events.a++;
    else if (y.points! > x.points!) events.b++;
    else events.tie++;
  });

  const pa = teamProgression(season, a);
  const pb = teamProgression(season, b);
  return {
    season: season.season,
    seasonOptions: seasons.map((s) => s.season),
    teams: entered.map((t) => ({ slug: t.slug, name: t.name })),
    a: A,
    b: B,
    notices,
    metrics,
    events,
    progression: pa.map((p, i) => ({ code: p.code, name: p.name, a: p.points, b: pb[i].points })),
    skipped: (season.skipped ?? []).map((s) => `${s.name} (${s.date})`),
  };
}
