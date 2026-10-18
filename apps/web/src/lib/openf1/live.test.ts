import { describe, expect, it } from "vitest";
import { OpenF1RequestError, type OpenF1Http } from "./http";
import { LiveFeed, RC_LIMIT } from "./live";

// TEST DATA: OpenF1-shaped rows (field names as documented) for a made-up live race.
const START = Date.parse("2026-10-25T20:00:00Z");
const SESSION = { session_key: 11396, session_name: "Race", country_name: "United States", circuit_short_name: "Austin", date_start: "2026-10-25T20:00:00+00:00", date_end: "2026-10-25T22:00:00+00:00" };
const NEXT = { session_key: 11397, session_name: "Practice 1", country_name: "Mexico", date_start: "2026-10-30T18:30:00+00:00", date_end: "2026-10-30T19:30:00+00:00" };
const at = (s: number) => new Date(START + s * 1000).toISOString();

function fake(routes: Record<string, (path: string) => unknown[] | Error>) {
  const paths: string[] = [];
  const http = {
    get: async (path: string) => {
      paths.push(path);
      const key = Object.keys(routes).find((k) => path.startsWith(k));
      const r = key ? routes[key](path) : [];
      if (r instanceof Error) throw r;
      return r;
    },
    stats: {} as never,
    state: () => ({}) as never,
  } as unknown as OpenF1Http;
  return { http, paths };
}

describe("LiveFeed", () => {
  it("without a subscription: unavailable, the next session from the public schedule, and no authenticated request", async () => {
    const open = fake({ sessions: () => [NEXT] });
    const feed = new LiveFeed({ authed: null, open: open.http, now: () => START + 3600_000 });
    const s = await feed.snapshot();
    expect(s.status).toBe("unavailable");
    expect(s.reason).toMatch(/subscription/);
    expect(s.next).toMatchObject({ name: "Practice 1", event: "Mexico" });
    expect(s.drivers).toEqual([]);
    expect(open.paths).toEqual([expect.stringMatching(/^sessions\?date_start>=/)]);
  });

  it("reports the next Race separately from the next session, and none when the schedule lists no race yet", async () => {
    const RACE = { ...NEXT, session_key: 11401, session_name: "Race", date_start: "2026-11-01T20:00:00+00:00", date_end: "2026-11-01T22:00:00+00:00" };
    const feed = new LiveFeed({ authed: null, open: fake({ sessions: () => [RACE, NEXT] }).http, now: () => START + 3600_000 });
    const s = await feed.snapshot();
    expect(s.next).toMatchObject({ name: "Practice 1" });
    expect(s.nextRace).toEqual({ name: "Race", event: "Mexico", start: RACE.date_start });
    expect((await new LiveFeed({ authed: null, open: fake({ sessions: () => [NEXT] }).http, now: () => START + 3600_000 }).snapshot()).nextRace).toBeNull();
  });

  it("with a subscription but no session running: idle, nothing polled", async () => {
    const open = fake({ sessions: () => [NEXT] });
    const authed = fake({});
    const s = await new LiveFeed({ authed: authed.http, open: open.http, now: () => Date.parse("2026-10-28T12:00:00Z") }).snapshot();
    expect(s.status).toBe("idle");
    expect(authed.paths).toEqual([]);
  });

  it("live: builds the order, shares polls between visitors, then asks only for newer records and ignores stale rows", async () => {
    let now = START + 600_000;
    let round = 0;
    const authed = fake({
      drivers: () => [
        { driver_number: 4, name_acronym: "NOR", full_name: "Lando NORRIS", team_name: "McLaren", team_colour: "F47600" },
        { driver_number: 1, name_acronym: "VER", full_name: "Max VERSTAPPEN", team_name: "Red Bull Racing", team_colour: "4781D7" },
      ],
      position: () =>
        round === 0
          ? [{ date: at(590), driver_number: 1, position: 2 }, { date: at(590), driver_number: 4, position: 1 }]
          : [{ date: at(600), driver_number: 1, position: 1 }, { date: at(600), driver_number: 4, position: 2 }, { date: at(100), driver_number: 1, position: 9 }],
      intervals: () => [{ date: at(595), driver_number: 1, gap_to_leader: 1.234, interval: 1.234 }, { date: at(595), driver_number: 4, gap_to_leader: 0, interval: null }],
      race_control: () => (round === 0 ? [{ date: at(300), category: "Flag", flag: "GREEN", message: "GREEN LIGHT - PIT EXIT OPEN" }] : [{ date: at(300), category: "Flag", flag: "GREEN", message: "GREEN LIGHT - PIT EXIT OPEN" }]),
      location: () => [{ date: at(599), driver_number: 1, x: 100, y: 200 }],
    });
    const open = fake({ sessions: () => [SESSION, NEXT] });
    const feed = new LiveFeed({ authed: authed.http, open: open.http, now: () => now, pollMs: 5000 });
    const a = await feed.snapshot();
    expect(a.status).toBe("live");
    expect(a.session).toMatchObject({ key: 11396, event: "United States" });
    expect(a.drivers.map((d) => [d.code, d.position, d.gapToLeader])).toEqual([["NOR", 1, 0], ["VER", 2, 1.234]]);
    expect(a.drivers[1]).toMatchObject({ colour: "#4781D7", x: 100, y: 200, locationAt: at(599) });
    expect(a.sourceTime).toBe(at(599));
    expect(a.stale).toBe(false);
    // A second visitor within the poll interval: no new requests.
    const before = authed.paths.length;
    await Promise.all([feed.snapshot(), feed.snapshot()]);
    expect(authed.paths.length).toBe(before);
    // Next poll: incremental (date>), the newer order applies, the stale row (t=100) does not, the repeated message is not duplicated.
    round = 1;
    now += 5000;
    const b = await feed.snapshot();
    expect(authed.paths.filter((p) => p.startsWith("position")).at(-1)).toBe(`position?session_key=11396&date>${encodeURIComponent(at(590))}`);
    expect(authed.paths.filter((p) => p.startsWith("drivers"))).toHaveLength(1);
    expect(b.drivers.map((d) => [d.code, d.position])).toEqual([["VER", 1], ["NOR", 2]]);
    expect(b.raceControl).toHaveLength(1);
  });

  it("a failed poll keeps the last data, marked stale with the category; recovery clears it", async () => {
    let now = START + 600_000;
    let fail = false;
    const authed = fake({
      drivers: () => [{ driver_number: 1, name_acronym: "VER" }],
      position: () => (fail ? new OpenF1RequestError("rate-limit", "/position: rate limited") : [{ date: at(590), driver_number: 1, position: 1 }]),
    });
    const feed = new LiveFeed({ authed: authed.http, open: fake({ sessions: () => [SESSION] }).http, now: () => now, pollMs: 5000 });
    await feed.snapshot();
    fail = true;
    now += 5000;
    const s = await feed.snapshot();
    expect(s).toMatchObject({ status: "live", stale: true, errorCategory: "rate-limit" });
    expect(s.reason).toMatch(/last data/);
    expect(s.drivers[0].position).toBe(1);
    fail = false;
    now += 5000;
    expect(await feed.snapshot()).toMatchObject({ stale: false, errorCategory: null });
  });

  it("rejected credentials: an error state, never shown as live", async () => {
    const authed = fake({ drivers: () => new OpenF1RequestError("auth", "/drivers: OpenF1 rejected the credentials (HTTP 401)") });
    const s = await new LiveFeed({ authed: authed.http, open: fake({ sessions: () => [SESSION] }).http, now: () => START + 60_000 }).snapshot();
    expect(s.status).toBe("error");
    expect(s.reason).toMatch(/credentials/);
    expect(s.stale).toBe(true);
  });

  it("race control stays bounded", async () => {
    const msgs = Array.from({ length: RC_LIMIT + 20 }, (_, i) => ({ date: at(i), category: "Other", flag: null, message: `MESSAGE ${i}` }));
    const authed = fake({ race_control: () => msgs });
    const s = await new LiveFeed({ authed: authed.http, open: fake({ sessions: () => [SESSION] }).http, now: () => START + 600_000 }).snapshot();
    expect(s.raceControl).toHaveLength(RC_LIMIT);
    expect(s.raceControl[0].message).toBe(`MESSAGE ${RC_LIMIT + 19}`); // newest first
  });
});
