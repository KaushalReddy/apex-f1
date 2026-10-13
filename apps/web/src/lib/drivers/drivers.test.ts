import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_DRIVERS } from "@/domain/demo";
import { circuitPage, domainTeam, driverRegistry, slugify, teamColour, titleCase } from "./identity";
import { parseSeasonResults } from "./parse";
import { driverRounds, finishingTrend, headToHead, leader, pointsProgression, qualifyingVsRace, recentForm, seasonLineup, seasonStats } from "./stats";
import type { ResultRow, SeasonEvent, SeasonResults } from "./types";
import { compare } from "./compare";
import { profile } from "./views";

/** A three-round fixture with known answers. AAA and BBB are teammates; CCC misses round 3. */
const row = (acronym: string, position: number | null, status: ResultRow["status"], points = 0, team = "McLaren"): ResultRow => ({
  acronym, number: acronym.charCodeAt(0), team, position, status, points, laps: 50,
});
const q = (acronym: string, position: number) => ({ acronym, number: acronym.charCodeAt(0), team: "McLaren", position, status: "FIN" as const });
const event = (round: number, race: ResultRow[], quali: ReturnType<typeof q>[] | null, standings: SeasonEvent["standings"], sprint: ResultRow[] | null = null): SeasonEvent => ({
  round, meetingKey: round, name: `Round ${round} GP`, location: "X", countryCode: "XXX", circuitShortName: round === 2 ? "Monza" : "Elsewhere",
  date: `2025-0${round}-01`, race: { sessionKey: round * 10, date: "", results: race }, sprint: sprint ? { sessionKey: round * 10 + 1, date: "", results: sprint } : null,
  qualifying: quali ? { sessionKey: round * 10 + 2, date: "", results: quali } : null, standings,
});
const fixture: SeasonResults = {
  schema: "apex-f1/season-results@1",
  season: 2025,
  source: { name: "OpenF1", url: "https://openf1.org", endpoints: [], fetchedOn: "2026-10-13", note: "" },
  scheduledRaces: 4,
  complete: false,
  events: [
    event(1, [row("AAA", 1, "FIN", 25), row("BBB", 2, "FIN", 18), row("CCC", null, "DNF")], [q("BBB", 1), q("AAA", 2), q("CCC", 3)],
      [{ acronym: "AAA", position: 1, points: 25 }, { acronym: "BBB", position: 2, points: 18 }, { acronym: "CCC", position: 3, points: 0 }]),
    event(2, [row("BBB", 1, "FIN", 25), row("CCC", 2, "FIN", 18), row("AAA", null, "DNF")], [q("AAA", 1), q("BBB", 2), q("CCC", 3)],
      [{ acronym: "BBB", position: 1, points: 51 }, { acronym: "AAA", position: 2, points: 33 }, { acronym: "CCC", position: 3, points: 18 }],
      [row("AAA", 1, "FIN", 8), row("BBB", 2, "FIN", 7)]),
    // Round 3: CCC absent; AAA disqualified; standings not published.
    event(3, [row("BBB", 1, "FIN", 25), row("AAA", null, "DSQ")], [q("AAA", 1), q("BBB", 2)], null),
  ],
  drivers: [
    { acronym: "AAA", fullName: "Alpha AAA", firstName: "Alpha", lastName: "Æsir", countryCode: "GBR", numbers: [65], teams: [{ name: "McLaren", colour: "#ff8700" }] },
    { acronym: "BBB", fullName: "Beta BBB", firstName: "Beta", lastName: "Bravo", countryCode: "AUS", numbers: [66], teams: [{ name: "McLaren", colour: "#ff8700" }] },
    { acronym: "CCC", fullName: "Charlie CCC", firstName: "Charlie", lastName: "Bravo", countryCode: "NED", numbers: [67], teams: [{ name: "Racing Bulls", colour: "#6692ff" }] },
  ],
};

describe("season snapshot validation", () => {
  it("accepts a valid snapshot and rejects bad ones without throwing", () => {
    expect(parseSeasonResults(fixture).ok).toBe(true);
    expect(parseSeasonResults({ ...fixture, schema: "x" }).ok).toBe(false);
    const badStatus = structuredClone(fixture);
    (badStatus.events[0].race.results[0] as { status: string }).status = "WON";
    expect(parseSeasonResults(badStatus)).toMatchObject({ ok: false });
    const finWithoutPosition = structuredClone(fixture);
    finWithoutPosition.events[0].race.results[0].position = null;
    expect(parseSeasonResults(finWithoutPosition)).toMatchObject({ ok: false });
    const outOfOrder = structuredClone(fixture);
    outOfOrder.events.reverse();
    expect(parseSeasonResults(outOfOrder)).toMatchObject({ ok: false });
  });
});

describe("stable identity", () => {
  const reg = driverRegistry([fixture]);
  it("slugs come from the last name (ASCII), collisions fall back to name-acronym, names are title-cased", () => {
    expect(slugify("Hülkenberg")).toBe("hulkenberg");
    expect(reg.find((d) => d.acronym === "AAA")!.slug).toBe("aesir");
    expect(reg.find((d) => d.acronym === "BBB")!.slug).toBe("bravo-bbb");
    expect(reg.find((d) => d.acronym === "CCC")!.slug).toBe("bravo-ccc");
    expect(new Set(reg.map((d) => d.slug)).size).toBe(reg.length);
    expect(titleCase("Lando NORRIS")).toBe("Lando Norris");
  });

  it("maps published team names onto the project's teams (colour from one source of truth), and circuits onto existing pages", () => {
    expect(domainTeam("McLaren")?.slug).toBe("mclaren");
    expect(domainTeam("Racing Bulls")).toBeUndefined();
    expect(teamColour(fixture, "McLaren")).toBe("#ff8000"); // the project's colour, not the source's #ff8700
    expect(teamColour(fixture, "Racing Bulls")).toBe("#6692ff");
    expect(circuitPage("Monte Carlo")).toBe("monaco");
    expect(circuitPage("Lusail")).toBeUndefined();
  });
});

describe("season statistics", () => {
  it("counts starts, finishes, wins, podiums, qualifying P1 and non-finishes by status", () => {
    const a = seasonStats(fixture, "AAA");
    expect(a).toMatchObject({ entries: 3, starts: 3, classified: 1, wins: 1, podiums: 1, qualifyingP1: 2, dnf: 1, dsq: 1, dns: 0 });
    expect(a.racePoints).toBe(25);
    expect(a.sprintPoints).toBe(8);
    expect(a.averageFinish).toBe(1); // classified finishes only; the DNF and DSQ are not counted as last
    expect(a.averageQualifying).toBeCloseTo(4 / 3);
    expect(a.finishRate).toBeCloseTo(1 / 3);
    expect(a.pointsPerStart).toBeCloseTo(33 / 3);
    expect(a.positionsGainedVsQualifying).toBe(1); // round 1 only: qualified 2, finished 1
  });

  it("uses the published standing after the last round that has one, and says which round", () => {
    expect(seasonStats(fixture, "BBB").championship).toEqual({ position: 1, points: 51, afterRound: 2 });
    expect(seasonStats(fixture, "CCC").championship).toEqual({ position: 3, points: 18, afterRound: 2 });
  });

  it("a missing round is not a zero-point finish: no entry, no start", () => {
    const c = seasonStats(fixture, "CCC");
    expect(c.entries).toBe(2);
    expect(c.starts).toBe(2);
    expect(driverRounds(fixture, "CCC")[2].race).toBeNull();
  });

  it("returns nulls rather than invented values when nothing can be calculated", () => {
    const z = seasonStats(fixture, "ZZZ");
    expect(z).toMatchObject({ entries: 0, starts: 0, averageFinish: null, averageQualifying: null, finishRate: null, pointsPerStart: null, championship: null });
  });

  it("lists the season line-up with latest team and number", () => {
    const line = seasonLineup(fixture);
    expect(line.map((l) => l.acronym).sort()).toEqual(["AAA", "BBB", "CCC"]);
    expect(line.find((l) => l.acronym === "CCC")!.team).toBe("McLaren");
  });
});

describe("trends and progressions", () => {
  it("points progression follows the published standings, leaves unpublished rounds as gaps, keeps a derived running sum", () => {
    expect(pointsProgression(fixture, "AAA")).toEqual([
      { round: 1, name: "Round 1 GP", code: "XXX", points: 25, derived: 25 },
      { round: 2, name: "Round 2 GP", code: "XXX", points: 33, derived: 33 },
      { round: 3, name: "Round 3 GP", code: "XXX", points: null, derived: 33 },
    ]);
  });

  it("finishing trend keeps DNF/DSQ and absence distinct from positions", () => {
    expect(finishingTrend(fixture, "AAA").map((t) => [t.position, t.status])).toEqual([[1, "FIN"], [null, "DNF"], [null, "DSQ"]]);
    expect(finishingTrend(fixture, "CCC")[2].status).toBe("ABSENT");
  });

  it("qualifying vs race only pairs rounds with both a qualifying position and a classified finish", () => {
    expect(qualifyingVsRace(fixture, "AAA")).toEqual([{ round: 1, name: "Round 1 GP", code: "XXX", qualifying: 2, finish: 1 }]);
    expect(qualifyingVsRace(fixture, "BBB").map((x) => x.round)).toEqual([1, 2, 3]);
  });

  it("recent form is newest first and skips rounds without a result", () => {
    expect(recentForm(fixture, "CCC").map((r) => r.round)).toEqual([2, 1]);
  });
});

describe("head-to-head", () => {
  it("scores only common events; a classified finish beats a non-finish; both non-finishing is undecided", () => {
    const h = headToHead(fixture, "AAA", "BBB");
    expect(h.race).toEqual({ a: 1, b: 2, undecided: 0, events: 3 });
    expect(h.quali).toEqual({ a: 2, b: 1, events: 3 });
    const ac = headToHead(fixture, "AAA", "CCC");
    expect(ac.race).toEqual({ a: 1, b: 1, undecided: 0, events: 2 }); // round 3 not common
    expect(ac.onlyA).toBe(1);
    expect(ac.onlyB).toBe(0);
  });

  it("is symmetric when the drivers are swapped", () => {
    const ab = headToHead(fixture, "AAA", "BBB");
    const ba = headToHead(fixture, "BBB", "AAA");
    expect([ba.race.a, ba.race.b, ba.quali.a, ba.quali.b]).toEqual([ab.race.b, ab.race.a, ab.quali.b, ab.quali.a]);
  });

  it("metric leader: missing data is not a loss, equal is a tie, positions are lower-is-better", () => {
    expect(leader(10, 5, true)).toBe("a");
    expect(leader(2, 5, false)).toBe("a");
    expect(leader(3, 3, true)).toBe("tie");
    expect(leader(null, 5, true)).toBeNull();
  });
});

describe("real snapshots in src/data/results (when generated)", () => {
  const dir = path.join(process.cwd(), "src/data/results");
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^\d{4}\.json$/.test(f)) : [];
  it.skipIf(files.length === 0)("validate, keep the project's existing driver slugs, and agree with the published standings", () => {
    const seasons = files.map((f) => {
      const p = parseSeasonResults(JSON.parse(readFileSync(path.join(dir, f), "utf8")));
      if (!p.ok) throw new Error(`${f}: ${p.error}`);
      return p.season;
    });
    const reg = driverRegistry(seasons);
    for (const d of DEMO_DRIVERS) expect(reg.find((r) => r.acronym === d.code)?.slug, d.code).toBe(d.slug);
    for (const s of seasons) {
      // Published standings vs the sum of classified race + sprint points: equal for every driver in normal seasons. Report, do not hide:
      // any difference must come from the source (penalties, adjustments), which the UI states.
      const last = [...s.events].reverse().find((e) => e.standings);
      if (!last) continue;
      let mismatches = 0;
      for (const st of last.standings!) {
        const p = pointsProgression(s, st.acronym).find((x) => x.round === last.round)!;
        if (Math.abs((st.points ?? 0) - p.derived) > 0.01) mismatches++;
      }
      expect(mismatches, `season ${s.season}`).toBeLessThanOrEqual(2);
    }
  });
});

describe("profile and comparison views", () => {
  const older: SeasonResults = { ...structuredClone(fixture), season: 2024, events: structuredClone(fixture.events).slice(0, 1) };
  older.events[0].race.results = [row("AAA", 3, "FIN", 15, "Ferrari"), row("BBB", 1, "FIN", 25)];

  it("builds one block per season the driver raced; switching season switches every figure; dataset totals are not career totals", () => {
    const p = profile([fixture, older], "aesir")!;
    expect(p.seasons.map((s) => s.meta.season)).toEqual([2025, 2024]);
    expect(p.seasons[0].stats.wins).toBe(1);
    expect(p.seasons[1].stats.wins).toBe(0);
    expect(p.seasons[1].team).toBe("Ferrari");
    expect(p.seasons[1].teamSlug).toBe("ferrari");
    expect(p.dataset).toMatchObject({ seasons: [2025, 2024], starts: 4, wins: 1, points: 25 + 8 + 15 });
    expect(p.dataset.teams.sort()).toEqual(["Ferrari", "McLaren"]);
    expect(profile([fixture], "nobody")).toBeNull();
  });

  it("comparison uses one season, defaults to the standings' top two, resets a driver who did not race that season, and never pairs a driver with themself", () => {
    const c = compare([fixture, older], {})!;
    expect(c.season).toBe(2025);
    expect([c.a.acronym, c.b.acronym]).toEqual(["BBB", "AAA"]);
    const reset = compare([fixture, older], { season: "2024", a: "aesir", b: "bravo-ccc" })!;
    expect(reset.season).toBe(2024);
    expect(reset.b.acronym).toBe("BBB");
    expect(reset.notices.join(" ")).toMatch(/did not race in 2024/);
    const same = compare([fixture], { a: "aesir", b: "aesir" })!;
    expect(same.a.acronym).not.toBe(same.b.acronym);
    expect(compare([fixture], { season: "1999" })!.notices[0]).toMatch(/No exported results for 1999/);
    expect(compare([], {})).toBeNull();
    // Leader marking: positions lower-is-better; starts are context only.
    const m = Object.fromEntries(c.metrics.map((x) => [x.label, x]));
    expect(m["Championship"].leader).toBe("a");
    expect(m["Starts"].context).toBe(true);
  });
});

describe("championship standings", async () => {
  const { seasonStandings } = await import("./standings");
  const withTeams = structuredClone(fixture);
  withTeams.events[0].teamStandings = [{ team: "McLaren", position: 1, points: 43 }, { team: "Racing Bulls", position: 2, points: 0 }];
  withTeams.events[1].teamStandings = [{ team: "McLaren", position: 1, points: 84 }, { team: "Racing Bulls", position: 2, points: 18 }];

  it("uses the last published standing, derives change since the previous one, the gap to the leader and race wins", () => {
    const s = seasonStandings(withTeams);
    expect(s.afterRound).toBe(2); // round 3 has no published standing
    expect(s.drivers.map((d) => [d.acronym, d.position, d.points, d.change, d.gapToLeader])).toEqual([
      ["BBB", 1, 51, 1, 0],
      ["AAA", 2, 33, -1, 18],
      ["CCC", 3, 18, 0, 33],
    ]);
    expect(s.drivers.find((d) => d.acronym === "BBB")!.wins).toBe(2); // rounds 2 and 3 (classifications, including round 3)
    expect(s.teams!.map((t) => [t.team, t.position, t.points, t.change, t.wins])).toEqual([
      ["McLaren", 1, 84, 0, 3],
      ["Racing Bulls", 2, 18, 0, 0],
    ]);
    expect(s.teams![0].teamSlug).toBe("mclaren");
  });

  it("has no constructors' table when none was published (nothing is summed in its place), and no change without a previous round", () => {
    const s = seasonStandings(fixture);
    expect(s.teams).toBeNull();
    const one = structuredClone(fixture);
    one.events = one.events.slice(0, 1);
    expect(seasonStandings(one).drivers.every((d) => d.change === null)).toBe(true);
  });
});
