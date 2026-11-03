import { describe, expect, it } from "vitest";
import { devDiagnosticsEnabled, withDiagnostics } from "./diagnostics";
import { freshness } from "@/lib/race/session";
import type { RaceSnapshot } from "@/lib/race/types";
import { liveHealth } from "./health";
import type { OpenF1Http } from "./http";
import { OpenF1RequestError } from "./http";
import { LiveFeed, type LiveDiagnostics, type LiveDriver, type LiveSnapshot } from "./live";
import type { PollUpdate } from "./poller";

const SESSION = { key: 11400, name: "Qualifying", event: "Mexico", circuit: "Mexico City", start: "2026-10-31T21:00:00+00:00", end: "2026-10-31T22:00:00+00:00" };
const T = Date.parse("2026-10-31T21:10:00Z");
const iso = (t: number) => new Date(t).toISOString();
const DIAG: LiveDiagnostics = { credentialsConfigured: true, lastPollAt: iso(T), lastLocationRows: 80, lastLocationRowsAt: iso(T), lastLocationNew: 30, lastLocationLate: 0, lastPollMs: 1500, recentPolls: [], lastError: null };
const car = (n: number, at: number | null): LiveDriver => ({ number: n, code: `C${n}`, name: null, team: null, colour: null, position: n, positionAt: null, gapToLeader: null, lapsDown: null, interval: null, lap: null, lastLapMs: null, bestLapMs: null, x: at == null ? null : 1, y: at == null ? null : 2, locationAt: at == null ? null : iso(at) });
const snap = (o: Partial<LiveSnapshot> = {}): LiveSnapshot => ({ status: "live", reason: null, errorCategory: null, session: SESSION, next: null, nextRace: null, drivers: [car(1, T - 1000), car(2, T - 1500)], raceControl: [], sourceTime: null, fetchedAt: iso(T), servedAt: iso(T), stale: false, pollMs: 5000, diag: DIAG, ...o });
const ok = (data: LiveSnapshot): PollUpdate<LiveSnapshot> => ({ data, error: null, failures: 0 });
/** This tab received the answer at T (same instant the server sent it, as on one machine). */
const store = { subscribers: 1, hidden: false, receivedAt: T, dataReceivedAt: T };

describe("Live Race Health: connection and position freshness are separate", () => {
  it("Healthy only when connected, authenticated and the shown positions are live", () => {
    const r = liveHealth(ok(snap()), store, T + 2000);
    expect(r).toMatchObject({ health: "Healthy", connection: { state: "Connected" }, auth: { state: "Authenticated" }, session: { name: "Qualifying", meeting: "Mexico", key: 11400, status: "live" } });
    expect(r.location).toMatchObject({ state: "live", newestSampleAt: iso(T - 1000), sampleAgeServedS: 1, sampleAgeNowS: 3, currentCars: 2, carsWithAnyPosition: 2, rowsLastCycle: 80, newRowsLastCycle: 30, lateRowsLastCycle: 0 });
    expect(r.polling).toMatchObject({ serverPollS: 1.5, deliveryS: 0 });
  });

  it("the Mexico race reading (3.4 s old when served, 13.2 s since received): connected, but positions delayed, so never Healthy", () => {
    const s = snap({ drivers: [car(1, T - 3400)] });
    const r = liveHealth(ok(s), store, T + 13_200);
    expect(r).toMatchObject({ health: "Delayed", connection: { state: "Connected" }, location: { state: "delayed", sampleAgeNowS: 16.6, sampleAgeServedS: 3.4, currentCars: 0 } });
  });

  it("healthy connection with stale positions is Stale; delayed positions are Delayed", () => {
    expect(liveHealth(ok(snap()), store, T + 40_000)).toMatchObject({ health: "Stale", connection: { state: "Connected" }, location: { state: "stale" } });
    expect(liveHealth(ok(snap()), store, T + 20_000)).toMatchObject({ health: "Delayed", connection: { state: "Connected" }, location: { state: "delayed" } });
    // OpenF1 itself behind: the newest sample was already 40 s old when the server sent it.
    expect(liveHealth(ok(snap({ drivers: [car(1, T - 40_000)] })), store, T).location.state).toBe("stale");
  });

  it("recovers: newer positions received after a stale period are live again", () => {
    expect(liveHealth(ok(snap()), store, T + 40_000).health).toBe("Stale");
    const later = T + 45_000;
    const fresh = snap({ drivers: [car(1, later - 3000)], fetchedAt: iso(later), servedAt: iso(later) });
    expect(liveHealth(ok(fresh), { ...store, receivedAt: later, dataReceivedAt: later }, later + 1000)).toMatchObject({ health: "Healthy", location: { state: "live" } });
  });

  it("a car more than 10 s behind the newest is not current", () => {
    expect(liveHealth(ok(snap({ drivers: [car(1, T - 1000), car(2, T - 20_000)] })), store, T).location.currentCars).toBe(1);
  });

  it("empty location responses are Waiting, never a location update", () => {
    const r = liveHealth(ok(snap({ drivers: [car(1, null)], diag: { ...DIAG, lastLocationRows: 0, lastLocationNew: 0, lastLocationRowsAt: null } })), store, T);
    expect(r).toMatchObject({ health: "Waiting", connection: { state: "Connected" }, location: { state: "waiting", newestSampleAt: null, sampleAgeNowS: null, currentCars: 0, rowsLastCycle: 0, lastRowsAt: null } });
  });

  it("authentication: rejected, not configured, and never inferred from a session merely existing", () => {
    expect(liveHealth(ok(snap({ status: "error", errorCategory: "auth", reason: "OpenF1 did not accept this site's credentials." })), store, T)).toMatchObject({ health: "Authentication Error", connection: { state: "Authentication rejected" }, auth: { state: "Rejected" } });
    expect(liveHealth(ok(snap({ status: "unavailable", session: null, diag: { ...DIAG, credentialsConfigured: false } })), store, T)).toMatchObject({ health: "Unavailable", auth: { state: "Not authenticated" } });
    // Session listed and live, but no authenticated poll has completed: Unknown, not Authenticated.
    expect(liveHealth(ok(snap({ fetchedAt: null, drivers: [] })), store, T).auth.state).toBe("Unknown");
    expect(liveHealth(ok(snap({ status: "idle", session: null, fetchedAt: null, drivers: [] })), store, T)).toMatchObject({ health: "Waiting", auth: { state: "Unknown" } });
  });

  it("polling: a failing /api/live with recent positions is Delayed; with stale or no data, Unavailable; server-side failures; hidden tab", () => {
    const failing = { data: snap(), error: "HTTP 502", failures: 2 };
    expect(liveHealth(failing, store, T + 6000)).toMatchObject({ health: "Delayed", connection: { state: "Polling failed" }, polling: { state: "Failing (2 in a row), backing off", error: { category: "request", message: "/api/live: HTTP 502" } } });
    expect(liveHealth(failing, store, T + 40_000)).toMatchObject({ health: "Unavailable", connection: { state: "Polling failed" }, location: { state: "stale" } });
    expect(liveHealth({ data: null, error: "HTTP 500", failures: 1 }, store, T).health).toBe("Unavailable");
    expect(liveHealth(ok(snap({ stale: true, errorCategory: "unavailable" })), store, T).connection.state).toBe("Polling failed");
    expect(liveHealth(ok(snap({ errorCategory: "unavailable" })), store, T)).toMatchObject({ health: "Delayed", connection: { state: "Polling delayed" }, location: { state: "live" } });
    expect(liveHealth(ok(snap()), { ...store, hidden: true }, T).polling.state).toBe("Paused: tab hidden");
  });

  it("missing values stay unknown: no answer yet, and production answers without diagnostics", () => {
    const none = liveHealth(null, { subscribers: 1, hidden: false, receivedAt: null, dataReceivedAt: null }, T);
    expect(none).toMatchObject({ health: "Unavailable", connection: { state: "Unavailable" }, session: null, auth: { state: "Unknown" }, location: { state: "unavailable", newestSampleAt: null, currentCars: null, rowsLastCycle: null }, polling: { serverLastAttemptAt: null, serverLastSuccessAt: null, serverPollS: null, browserReceivedAt: null, deliveryS: null, error: null } });
    const prod = liveHealth(ok(snap({ diag: undefined })), store, T);
    expect(prod.location).toMatchObject({ rowsLastCycle: null, newRowsLastCycle: null, lateRowsLastCycle: null, lastRowsAt: null });
    expect(prod.polling.serverLastAttemptAt).toBeNull();
  });

  it("the panel and the circuit toolbar classify the same positions the same way", () => {
    const toolbar = { fresh: "live", delayed: "delayed", stale: "stale" } as const;
    const race = { mode: "LIVE", session: { status: "running" } } as RaceSnapshot;
    for (const ageS of [3, 8, 15, 16.6, 25, 30, 31, 120]) {
      // Panel: 1 s old when served, received (ageS - 1) s ago. Toolbar: LiveProvider stamps the sample's time, so its age is ageS.
      const panel = liveHealth(ok(snap({ drivers: [car(1, T - 1000)] })), store, T + (ageS - 1) * 1000).location.state;
      const chip = freshness({ snapshot: race, receivedAt: 0, now: ageS * 1000, playing: false, sourceStatus: "ok" }).state;
      expect([ageS, panel]).toEqual([ageS, toolbar[chip as keyof typeof toolbar]]);
    }
  });
});

describe("development-only diagnostics", () => {
  const feed = { diagnostics: () => DIAG };
  it("are attached only on a development server; production /api/live is the snapshot unchanged", () => {
    expect(devDiagnosticsEnabled("development")).toBe(true);
    expect(devDiagnosticsEnabled("production")).toBe(false);
    expect(devDiagnosticsEnabled("test")).toBe(false);
    expect(devDiagnosticsEnabled(undefined)).toBe(false);
    const s = snap();
    delete s.diag; // a snapshot as the feed produces it (no diag key)
    expect(withDiagnostics(s, feed, "development").diag).toEqual(DIAG);
    expect(withDiagnostics(s, feed, "production")).toBe(s);
    expect("diag" in withDiagnostics(s, feed, "production")).toBe(false);
  });

  it("feed counters: rows per cycle, last time rows arrived (not on an empty answer), sanitised last error; never credentials", async () => {
    let now = Date.parse(SESSION.start) + 60_000;
    let rows: unknown[] | Error = [{ date: iso(now - 500), driver_number: 1, x: 1, y: 2 }];
    const authed = { get: async (p: string) => (p.startsWith("location") ? (rows instanceof Error ? Promise.reject(rows) : rows) : []), stats: {} as never, state: () => ({}) as never } as unknown as OpenF1Http;
    const open = { get: async () => [{ session_key: 11400, session_name: "Qualifying", country_name: "Mexico", circuit_short_name: "Mexico City", date_start: SESSION.start, date_end: SESSION.end }], stats: {} as never, state: () => ({}) as never } as unknown as OpenF1Http;
    const f = new LiveFeed({ authed, open, now: () => now, pollMs: 5000 });
    await f.snapshot();
    const first = now;
    expect(f.diagnostics()).toMatchObject({ credentialsConfigured: true, lastLocationRows: 1, lastLocationNew: 1, lastLocationLate: 0, lastLocationRowsAt: iso(first), lastError: null, lastPollAt: iso(first), lastPollMs: 0 });
    rows = [];
    now += 5000;
    await f.snapshot();
    expect(f.diagnostics()).toMatchObject({ lastLocationRows: 0, lastLocationNew: 0, lastLocationRowsAt: iso(first) });
    rows = new OpenF1RequestError("unavailable", "/location: HTTP 503", 503);
    now += 5000;
    await f.snapshot();
    expect(f.diagnostics()).toMatchObject({ lastLocationRows: null, lastError: { category: "unavailable", message: "/location: HTTP 503" } });
    expect(JSON.stringify(f.diagnostics())).not.toMatch(/password|token|bearer/i);
    expect(new LiveFeed({ authed: null, open }).diagnostics().credentialsConfigured).toBe(false);
  });
});
