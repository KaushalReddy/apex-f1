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

  it("public schedule refused during a live session: retries it with the login", async () => {
    const open = fake({ sessions: () => new OpenF1RequestError("auth", "/sessions: 401") });
    const authed = fake({ sessions: () => [NEXT] });
    const s = await new LiveFeed({ authed: authed.http, open: open.http, now: () => Date.parse("2026-10-28T12:00:00Z") }).snapshot();
    expect(s.next).toMatchObject({ event: "Mexico" });
    expect(authed.paths).toEqual([expect.stringMatching(/^sessions\?date_start>=/)]);
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

  it("empty endpoints (OpenF1 404, e.g. no intervals in practice) never stop the others: race control and locations still load", async () => {
    const authed = fake({
      drivers: () => [{ driver_number: 12, name_acronym: "ANT" }],
      position: () => [],
      intervals: () => [],
      race_control: () => [{ date: at(5), category: "Flag", flag: "GREEN", message: "GREEN LIGHT - PIT EXIT OPEN" }],
      location: () => [{ date: at(6), driver_number: 12, x: 10, y: 20 }],
    });
    const s = await new LiveFeed({ authed: authed.http, open: fake({ sessions: () => [SESSION] }).http, now: () => START + 60_000 }).snapshot();
    expect(s).toMatchObject({ status: "live", stale: false, errorCategory: null });
    expect(s.raceControl).toHaveLength(1);
    expect(s.drivers[0]).toMatchObject({ code: "ANT", x: 10, y: 20, locationAt: at(6) });
  });

  it("one failing endpoint: the rest still update, and the poll is reported as failed (stale)", async () => {
    const authed = fake({
      intervals: () => new OpenF1RequestError("unavailable", "/intervals: HTTP 500", 500),
      location: () => [{ date: at(6), driver_number: 12, x: 10, y: 20 }],
    });
    const s = await new LiveFeed({ authed: authed.http, open: fake({ sessions: () => [SESSION] }).http, now: () => START + 60_000 }).snapshot();
    expect(authed.paths.map((p) => p.split("?")[0])).toEqual(["drivers", "position", "intervals", "race_control", "laps", "location"]);
    expect(s).toMatchObject({ status: "live", stale: true, errorCategory: "unavailable" });
    expect(s.drivers[0]).toMatchObject({ number: 12, x: 10, y: 20 });
  });

  it("a provider-wide failure (login rejected) stops the poll: no further requests", async () => {
    const authed = fake({ drivers: () => new OpenF1RequestError("auth", "/drivers: HTTP 401", 401) });
    await new LiveFeed({ authed: authed.http, open: fake({ sessions: () => [SESSION] }).http, now: () => START + 60_000 }).snapshot();
    expect(authed.paths.map((p) => p.split("?")[0])).toEqual(["drivers"]);
  });

  it("location requests: the first reaches back the backfill window, later ones re-read the overlap before the newest record", async () => {
    let now = START + 600_000;
    const enc = (t: number) => encodeURIComponent(new Date(t).toISOString());
    const authed = fake({ location: () => [{ date: at(599), driver_number: 1, x: 1, y: 2 }] });
    const feed = new LiveFeed({ authed: authed.http, open: fake({ sessions: () => [SESSION] }).http, now: () => now, pollMs: 5000 });
    await feed.snapshot();
    now += 5000;
    await feed.snapshot();
    const loc = authed.paths.filter((p) => p.startsWith("location"));
    expect(loc[0]).toBe(`location?session_key=11396&date>${enc(START + 540_000)}`); // 60 s back
    expect(loc[1]).toBe(`location?session_key=11396&date>${enc(START + 599_000 - 10_000)}`); // newest (t=599) minus 10 s
  });

  it("location windows are configurable (OPENF1_LIVE_LOCATION_BACKFILL_MS / _OVERLAP_MS)", async () => {
    let now = START + 600_000;
    const enc = (t: number) => encodeURIComponent(new Date(t).toISOString());
    const authed = fake({ location: () => [{ date: at(599), driver_number: 1, x: 1, y: 2 }] });
    const feed = new LiveFeed({ authed: authed.http, open: fake({ sessions: () => [SESSION] }).http, now: () => now, pollMs: 5000, locationBackfillMs: 180_000, locationOverlapMs: 30_000 });
    await feed.snapshot();
    now += 5000;
    await feed.snapshot();
    const loc = authed.paths.filter((p) => p.startsWith("location"));
    expect(loc[0]).toContain(`date>${enc(START + 420_000)}`);
    expect(loc[1]).toContain(`date>${enc(START + 569_000)}`);
  });

  it("a car whose samples arrive late still moves (overlap), and repeated or out-of-order rows never move a car backwards", async () => {
    let now = START + 600_000;
    let round = 0;
    // Applies the request's date> filter the way OpenF1 does, so a row older than the requested window is never returned.
    const after = (p: string) => Date.parse(decodeURIComponent(/date>([^&]+)/.exec(p)![1]));
    const authed = fake({
      location: (p) =>
        (round === 0
          ? [{ date: at(598), driver_number: 1, x: 10, y: 10 }]
          : // Car 44's sample from t=595 arrives only now (older than car 1's t=598, the cursor); car 1's t=598 row repeats, plus an older one.
            [{ date: at(595), driver_number: 44, x: 50, y: 50 }, { date: at(598), driver_number: 1, x: 10, y: 10 }, { date: at(590), driver_number: 1, x: -99, y: -99 }, { date: at(603), driver_number: 1, x: 11, y: 11 }]
        ).filter((r) => Date.parse(r.date) > after(p)),
    });
    const feed = new LiveFeed({ authed: authed.http, open: fake({ sessions: () => [SESSION] }).http, now: () => now, pollMs: 5000 });
    await feed.snapshot();
    round = 1;
    now += 5000;
    const s = await feed.snapshot();
    expect(s.drivers.filter((d) => d.number === 1)).toHaveLength(1); // one entry (one marker) per car
    expect(s.drivers.find((d) => d.number === 1)).toMatchObject({ x: 11, y: 11, locationAt: at(603) });
    expect(s.drivers.find((d) => d.number === 44)).toMatchObject({ x: 50, y: 50, locationAt: at(595) });
    // 4 rows: 2 moved a car (44's late sample, 1's t=603), and the late one only the overlap re-read could deliver; the rest were repeats.
    expect(feed.diagnostics()).toMatchObject({ lastLocationRows: 4, lastLocationNew: 2, lastLocationLate: 1 });
  });

  it("after a gap longer than the backfill (no viewer), the next location request reaches back only the backfill, not to the old cursor", async () => {
    let now = START + 600_000;
    const enc = (t: number) => encodeURIComponent(new Date(t).toISOString());
    const authed = fake({ location: () => [{ date: at(599), driver_number: 1, x: 1, y: 2 }] });
    const feed = new LiveFeed({ authed: authed.http, open: fake({ sessions: () => [SESSION] }).http, now: () => now, pollMs: 5000 });
    await feed.snapshot();
    now += 300_000; // five minutes with nobody on the Live page
    await feed.snapshot();
    const loc = authed.paths.filter((p) => p.startsWith("location"));
    expect(loc[1]).toBe(`location?session_key=11396&date>${enc(now - 60_000)}`);
    expect((await feed.snapshot()).drivers.find((d) => d.number === 1)).toMatchObject({ x: 1, y: 2, locationAt: at(599) }); // the car keeps its last position
  });

  it("laps: lap number, last completed lap and best lap per car; the open lap has no time; read every second poll, last three laps", async () => {
    let now = START + 600_000;
    let round = 0;
    const lap = (n: number, no: number, dur: number | null) => ({ driver_number: n, lap_number: no, lap_duration: dur, date_start: at(no * 90) });
    const authed = fake({
      drivers: () => [{ driver_number: 1, name_acronym: "VER" }, { driver_number: 16, name_acronym: "LEC" }],
      laps: () =>
        round === 0
          ? [lap(1, 1, 95.1), lap(1, 2, 82.4), lap(1, 3, null), lap(16, 1, 96), lap(16, 2, 83.9), lap(16, 3, null)]
          : // Lap 3 completes for VER (slower than his best); an old repeated row for lap 1 must not replace the last lap.
            [lap(1, 3, 84.2), lap(1, 4, null), lap(1, 1, 95.1), lap(16, 3, 81.7), lap(16, 4, null)],
    });
    const feed = new LiveFeed({ authed: authed.http, open: fake({ sessions: () => [SESSION] }).http, now: () => now, pollMs: 5000 });
    let s = await feed.snapshot();
    expect(s.drivers.find((d) => d.number === 1)).toMatchObject({ lap: 3, lastLapMs: 82_400, bestLapMs: 82_400 });
    now += 5000;
    await feed.snapshot(); // second poll: no laps request
    round = 1;
    now += 5000;
    s = await feed.snapshot();
    expect(s.drivers.find((d) => d.number === 1)).toMatchObject({ lap: 4, lastLapMs: 84_200, bestLapMs: 82_400 });
    expect(s.drivers.find((d) => d.number === 16)).toMatchObject({ lap: 4, lastLapMs: 81_700, bestLapMs: 81_700 });
    const laps = authed.paths.filter((p) => p.startsWith("laps"));
    expect(laps).toEqual(["laps?session_key=11396", "laps?session_key=11396&lap_number>=1"]); // every second poll; then from (leader's lap 3) - 2
  });

  it("only cars in the session's driver list: other vehicles in OpenF1's location feed (e.g. 241-243) are not shown", async () => {
    const authed = fake({
      drivers: () => [{ driver_number: 1, name_acronym: "VER" }],
      location: () => [{ date: at(599), driver_number: 1, x: 1, y: 2 }, { date: at(599), driver_number: 241, x: 5, y: 5 }],
    });
    const feed = new LiveFeed({ authed: authed.http, open: fake({ sessions: () => [SESSION] }).http, now: () => START + 600_000 });
    expect((await feed.snapshot()).drivers.map((d) => d.number)).toEqual([1]);
    // Without a driver list (endpoint failed or empty) every car with a location is still shown.
    const bare = new LiveFeed({ authed: fake({ location: () => [{ date: at(599), driver_number: 44, x: 1, y: 2 }] }).http, open: fake({ sessions: () => [SESSION] }).http, now: () => START + 600_000 });
    expect((await bare.snapshot()).drivers.map((d) => d.number)).toEqual([44]);
  });

  it("records where each poll spent its time; a slow one (OpenF1 slow on location) is reported, with no URLs or credentials", async () => {
    let now = START + 600_000;
    let delay = 6000;
    const slow: unknown[] = [];
    const authed = fake({ location: () => ((now += delay), [{ date: at(599), driver_number: 1, x: 1, y: 2 }]) });
    const feed = new LiveFeed({ authed: authed.http, open: fake({ sessions: () => [SESSION] }).http, now: () => now, pollMs: 5000, onSlowPoll: (r) => slow.push(r) });
    await feed.snapshot();
    const [r] = feed.diagnostics().recentPolls;
    expect(r).toMatchObject({ ms: 6000, error: null, steps: { location: 6000, position: 0 } });
    expect(slow).toEqual([r]);
    expect(JSON.stringify(r)).not.toMatch(/http|session_key|token|password|bearer/i);
    delay = 200; // OpenF1 fast again: a normal poll, not reported
    await feed.snapshot();
    expect(feed.diagnostics().recentPolls.map((x) => x.ms)).toEqual([200, 6000]);
    now += 1000;
    await feed.snapshot(); // within the poll interval: answered from the last poll, no new record
    expect(feed.diagnostics().recentPolls).toHaveLength(2);
    expect(slow).toHaveLength(1);
  });

  it("race control stays bounded", async () => {
    const msgs = Array.from({ length: RC_LIMIT + 20 }, (_, i) => ({ date: at(i), category: "Other", flag: null, message: `MESSAGE ${i}` }));
    const authed = fake({ race_control: () => msgs });
    const s = await new LiveFeed({ authed: authed.http, open: fake({ sessions: () => [SESSION] }).http, now: () => START + 600_000 }).snapshot();
    expect(s.raceControl).toHaveLength(RC_LIMIT);
    expect(s.raceControl[0].message).toBe(`MESSAGE ${RC_LIMIT + 19}`); // newest first
  });
});

describe("LiveFeed.cached", () => {
  it("knows the live session while a slow poll is still running, without making a request", async () => {
    let release!: () => void;
    const slow = new Promise<void>((r) => (release = r));
    const open = fake({ sessions: () => [SESSION] });
    const authed = { ...fake({}).http, get: async () => (await slow, []) } as unknown as OpenF1Http;
    const feed = new LiveFeed({ authed, open: open.http, now: () => START + 60_000 });
    expect(feed.cached().status).toBe("idle"); // nothing known before the first schedule load
    const pending = feed.snapshot();
    await new Promise((r) => setTimeout(r, 0)); // schedule loaded, poll now waiting on OpenF1
    expect(feed.cached()).toMatchObject({ status: "live", session: { key: 11396 } });
    expect(open.paths).toHaveLength(1);
    release();
    await pending;
  });
});
