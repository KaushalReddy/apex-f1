import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { profile } from "@/lib/drivers/views";
import { seasonStandings } from "@/lib/drivers/standings";
import { parseSeasonResults } from "@/lib/drivers/parse";
import type { ResultRow, SeasonEvent, SeasonResults } from "@/lib/drivers/types";
import { compareTeams } from "./compare";
import { cardShade, findTeamBySlug, teamFor, TEAMS } from "./registry";
import { seasonName, teammateHeadToHead, teamLineup, teamProgression, teamRounds, teamSeasonStats } from "./stats";
import { teamDirectory, teamProfile } from "./views";

/**
 * Three rounds, three teams. McLaren: AAA + BBB, but BBB moves to Kick Sauber for round 3 and AAA does not start round 2 (DNS).
 * Kick Sauber (the Audi entry): CCC + DDD. Racing Bulls: EEE, no entry in round 2, disqualified in round 3.
 */
const r = (acronym: string, team: string, position: number | null, status: ResultRow["status"], points = 0): ResultRow => ({
  acronym, number: acronym.charCodeAt(0), team, position, status, points, laps: 50,
});
const ev = (round: number, race: ResultRow[], extra: Partial<SeasonEvent> = {}): SeasonEvent => ({
  round, meetingKey: round, name: `Round ${round} Grand Prix`, location: null, countryCode: `C${round}`, circuitShortName: round === 1 ? "Monza" : null,
  date: `2025-0${round}-01`, race: { sessionKey: round, date: "", results: race }, sprint: null, qualifying: null, standings: null, ...extra,
});
const fixture: SeasonResults = {
  schema: "apex-f1/season-results@1",
  season: 2025,
  source: { name: "OpenF1", url: "https://openf1.org", endpoints: [], fetchedOn: "2026-10-13", note: "" },
  scheduledRaces: 3,
  complete: true,
  events: [
    ev(1, [r("AAA", "McLaren", 1, "FIN", 25), r("BBB", "McLaren", 2, "FIN", 18), r("CCC", "Kick Sauber", 3, "FIN", 15), r("EEE", "Racing Bulls", 4, "FIN", 12), r("DDD", "Kick Sauber", null, "DNF")], {
      sprint: { sessionKey: 11, date: "", results: [r("AAA", "McLaren", 1, "FIN", 8), r("CCC", "Kick Sauber", 2, "FIN", 7)] },
      qualifying: { sessionKey: 12, date: "", results: [r("BBB", "McLaren", 1, "FIN"), r("AAA", "McLaren", 2, "FIN")] },
      teamStandings: [{ team: "McLaren", position: 1, points: 51 }, { team: "Kick Sauber", position: 2, points: 22 }, { team: "Racing Bulls", position: 3, points: 12 }],
    }),
    ev(2, [r("BBB", "McLaren", 1, "FIN", 25), r("CCC", "Kick Sauber", 2, "FIN", 18), r("DDD", "Kick Sauber", 3, "FIN", 15), r("AAA", "McLaren", null, "DNS")], {
      teamStandings: [{ team: "McLaren", position: 1, points: 76 }, { team: "Kick Sauber", position: 2, points: 55 }, { team: "Racing Bulls", position: 3, points: 12 }],
    }),
    // Round 3: no published standings; BBB now drives for Kick Sauber.
    ev(3, [r("AAA", "McLaren", 1, "FIN", 25), r("BBB", "Kick Sauber", 2, "FIN", 18), r("CCC", "Kick Sauber", 3, "FIN", 15), r("EEE", "Racing Bulls", null, "DSQ")]),
  ],
  drivers: ["AAA", "BBB", "CCC", "DDD", "EEE"].map((a) => ({ acronym: a, fullName: `Driver ${a}`, firstName: "Driver", lastName: a, countryCode: null, numbers: [a.charCodeAt(0)], teams: [] })),
};
const T = (slug: string) => findTeamBySlug(slug)!;

describe("team registry", () => {
  it("keeps the canonical eleven-team order", () => {
    expect(TEAMS.map((t) => t.name)).toEqual([
      "Mercedes", "Ferrari", "McLaren", "Red Bull Racing", "Racing Bulls", "Alpine", "Haas F1 Team", "Audi", "Williams", "Aston Martin", "Cadillac",
    ]);
  });

  it("resolves the names published in earlier seasons to the same team", () => {
    expect(teamFor("RB")?.slug).toBe("racing-bulls");
    expect(teamFor("Kick Sauber")?.slug).toBe("audi");
    expect(teamFor("haas f1 team")?.slug).toBe("haas");
    expect(teamFor("Toro Rosso")).toBeUndefined();
    expect(TEAMS.filter((t) => t.carViewer).map((t) => t.slug).sort()).toEqual(["ferrari", "mclaren", "mercedes", "red-bull-racing"]);
  });

  it("maps every team to its own car image, present on disk with the declared size", () => {
    expect(new Set(TEAMS.map((t) => t.image?.src)).size).toBe(11);
    for (const t of TEAMS) {
      expect(t.image!.src).toBe(`/teams/cars/${t.slug}.png`);
      const png = readFileSync(path.join(process.cwd(), "public", t.image!.src));
      expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([t.image!.width, t.image!.height]);
    }
  });

  it("darkens a team colour only as far as white text needs (>= 4.5:1)", () => {
    const lum = (hex: string) =>
      [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
    for (const c of ["#27f4d2", "#ff8000", "#9c9fa2", "#f50537", "#229971"]) expect(1.05 / (lum(cardShade(c)) + 0.05)).toBeGreaterThanOrEqual(4.5);
    expect(cardShade("#1e1e1e")).toBe("#1e1e1e");
  });
});

describe("team season stats", () => {
  it("names the team as published that season, and not at all when it did not enter", () => {
    expect(seasonName(fixture, T("audi"))).toBe("Kick Sauber");
    expect(seasonName(fixture, T("cadillac"))).toBeNull();
  });

  it("sums race + sprint points per event; no entry is null, not zero", () => {
    expect(teamRounds(fixture, T("mclaren")).map((x) => x.points)).toEqual([51, 25, 25]);
    expect(teamRounds(fixture, T("racing-bulls")).map((x) => x.points)).toEqual([12, null, 0]);
    expect(teamRounds(fixture, T("audi")).map((x) => x.points)).toEqual([22, 33, 33]); // BBB counts for Kick Sauber only in round 3
  });

  it("derives wins, podiums, starts, rates and takes the championship from the last published standing", () => {
    const s = teamSeasonStats(fixture, T("mclaren"));
    expect(s).toMatchObject({ entries: 3, starts: 4, classified: 4, wins: 3, podiums: 4, qualifyingP1: 1, points: 101, bestFinish: 1, scoringEvents: 3 });
    expect(s.championship).toEqual({ position: 1, points: 76, afterRound: 2 });
    expect(s.pointsPerEvent).toBeCloseTo(101 / 3);
    const rb = teamSeasonStats(fixture, T("racing-bulls"));
    expect(rb).toMatchObject({ entries: 2, starts: 2, classified: 1, finishRate: 0.5, scoringRate: 0.5 });
  });

  it("charts published constructors' points with gaps, keeping the derived sum", () => {
    expect(teamProgression(fixture, T("mclaren")).map((p) => [p.points, p.derived])).toEqual([[51, 51], [76, 76], [null, 101]]);
  });

  it("builds a season-specific line-up: a mid-season move counts for each team only in its own races", () => {
    const mcl = teamLineup(fixture, T("mclaren"));
    expect(mcl.map((d) => [d.acronym, d.rounds, d.starts, d.points])).toEqual([["AAA", [1, 2, 3], 2, 58], ["BBB", [1, 2], 2, 43]]);
    expect(mcl[0].recent).toEqual(["P1", "DNS", "P1"]);
    expect(teamLineup(fixture, T("audi")).find((d) => d.acronym === "BBB")).toMatchObject({ rounds: [3], points: 18 });
  });

  it("scores teammates only over races both drove for the team", () => {
    const h = teammateHeadToHead(fixture, T("mclaren"), teamLineup(fixture, T("mclaren")))!;
    expect(h.race).toEqual({ a: 1, b: 0, undecided: 0, events: 1 }); // round 2 not scored (AAA DNS), round 3 not teammates
  });
});

describe("team comparison", () => {
  it("defaults to the top two of the published standings and scores events both entered", () => {
    const c = compareTeams([fixture], {})!;
    expect([c.a.slug, c.b.slug]).toEqual(["mclaren", "audi"]);
    expect(c.a.racedAs).toBeNull();
    expect(c.b.racedAs).toBe("Kick Sauber");
    expect(c.events).toEqual({ a: 1, b: 2, tie: 0, compared: 3, onlyA: 0, onlyB: 0 });
    expect(c.metrics.find((m) => m.label === "Points (published)")).toMatchObject({ a: 76, b: 55, leader: "a" });
    expect(c.metrics.find((m) => m.label === "Events entered")).toMatchObject({ leader: null, context: true });
  });

  it("counts equal event points as level and leaves single-team events unscored", () => {
    const f = structuredClone(fixture);
    f.events[0].race.results.find((x) => x.acronym === "EEE")!.points = 51;
    expect(compareTeams([f], { a: "mclaren", b: "racing-bulls" })!.events).toEqual({ a: 1, b: 0, tie: 1, compared: 2, onlyA: 1, onlyB: 0 });
  });

  it("resets unknown, absent or duplicated teams with a notice", () => {
    expect(compareTeams([fixture], { a: "cadillac" })!.notices).toEqual(["Cadillac did not race in 2025; team A reset."]);
    expect(compareTeams([fixture], { a: "nope" })!.notices).toEqual(["Unknown team “nope”; team A reset."]);
    const same = compareTeams([fixture], { a: "audi", b: "audi" })!;
    expect(same.b.slug).not.toBe("audi");
    expect(same.notices).toContain("The same team was chosen twice; team B reset.");
    expect(compareTeams([], {})).toBeNull();
  });
});

describe("team views", () => {
  it("lists only entered teams, in canonical order, with the season's published name", () => {
    const [s] = teamDirectory([fixture]);
    expect(s.teams.map((t) => [t.slug, t.racedAs, t.drivers.map((d) => d.acronym)])).toEqual([
      ["mclaren", null, ["AAA", "BBB"]],
      ["racing-bulls", null, ["EEE"]],
      ["audi", "Kick Sauber", ["CCC", "DDD"]],
    ]);
    expect(s.teams[2].otherDrivers).toBe(1); // BBB, round 3
  });

  it("builds a profile per entered season and none for unknown teams", () => {
    expect(teamProfile([fixture], "williams")!.seasons).toEqual([]);
    expect(teamProfile([fixture], "nope")).toBeNull();
    const p = teamProfile([fixture], "mclaren")!;
    expect(p.seasons[0].rounds[0].circuitSlug).toBe("monza");
    expect(p.dataset).toMatchObject({ wins: 3, points: 101, names: ["McLaren"] });
  });
});

describe("real snapshots", () => {
  const seasons = [2026, 2025, 2024].map((y) => {
    const res = parseSeasonResults(JSON.parse(readFileSync(path.join(process.cwd(), `src/data/results/${y}.json`), "utf8")));
    if (!res.ok) throw new Error(res.error);
    return res.season;
  });

  it("all eleven teams raced in 2026; Cadillac is absent before it; historical names are kept", () => {
    expect(teamDirectory(seasons)[0].teams.map((t) => t.slug)).toEqual(TEAMS.map((t) => t.slug));
    expect(teamDirectory([seasons[1]])[0].teams.some((t) => t.slug === "cadillac")).toBe(false);
    expect(seasonName(seasons[2], T("racing-bulls"))).toBe("RB");
    expect(seasonName(seasons[1], T("audi"))).toBe("Kick Sauber");
  });

  it("derived team points equal the published constructors' points at the end of each complete season", () => {
    for (const s of seasons.filter((x) => x.complete))
      for (const t of TEAMS.filter((x) => seasonName(s, x))) {
        const st = teamSeasonStats(s, t);
        expect([t.slug, s.season, st.points]).toEqual([t.slug, s.season, st.championship!.points]);
      }
  });

  it("driver pages and standings link to every team page; the car viewer link only where a 3D car exists", () => {
    expect(profile(seasons, "norris")!.seasons[0]).toMatchObject({ teamSlug: "mclaren", carSlug: "mclaren" });
    expect(profile(seasons, "albon")!.seasons[0]).toMatchObject({ teamSlug: "williams", carSlug: null });
    expect(seasonStandings(seasons[0], seasons).teams!.every((t) => t.teamSlug)).toBe(true);
  });
});
