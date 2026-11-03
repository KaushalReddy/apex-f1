import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCircuitGeometry } from "@/lib/circuit/geometry";
import { centerlineToWorld, createWorldTransform } from "@/lib/circuit/transform";
import type { OpenF1Http } from "@/lib/openf1/http";
import { LiveFeed, type LiveSnapshot } from "@/lib/openf1/live";
import type { PollUpdate } from "@/lib/openf1/poller";
import { liveLocationState, LiveProvider, servedAgeMs, SWITCHING, toRaceSnapshot } from "./live";
import type { ProviderUpdate } from "./providers";
import { createTrackPath } from "./track";

// RECORDED TEST FIXTURE, not live data: real OpenF1 rows from the United States GP race (25 Oct 2026, session 11396), 2 s at 20:40 UTC.
// It goes through the real LiveFeed with a fake HTTP client, so the test exercises the same parsing the live page uses.
const fx = JSON.parse(readFileSync(join(process.cwd(), "src/lib/race/__fixtures__/openf1-11396-recorded.json"), "utf8"));
const SESSION = { session_key: 11396, session_name: "Race", country_name: "United States", circuit_short_name: "Austin", date_start: "2026-10-25T20:00:00+00:00", date_end: "2026-10-25T22:00:00+00:00" };
const NOW = Date.parse("2026-10-25T20:40:03Z");

const parsed = parseCircuitGeometry(JSON.parse(readFileSync(join(process.cwd(), "src/data/circuits/cota.geometry.json"), "utf8")));
if (!parsed.ok) throw new Error(parsed.error);
const cota = parsed.geometry;
const transform = createWorldTransform(cota);
const path = createTrackPath(centerlineToWorld(cota, transform));
const opts = () => ({ toWorld: transform.toWorld, z: transform.origin[2], path, hints: new Map<number, number>(), circuit: { circuitSlug: "cota", circuitName: "Austin" }, epoch: 0 });

function http(routes: Record<string, unknown[]>) {
  return { get: async (p: string) => routes[Object.keys(routes).find((k) => p.startsWith(k)) ?? ""] ?? [], stats: {} as never, state: () => ({}) as never } as unknown as OpenF1Http;
}
async function recordedSnapshot(location = fx.location): Promise<LiveSnapshot> {
  const authed = http({ drivers: fx.drivers, position: fx.position, location });
  return new LiveFeed({ authed, open: http({ sessions: [SESSION] }), now: () => NOW }).snapshot();
}

describe("live 3D mode (recorded 25 Oct fixture)", () => {
  it("places every car on the circuit: OpenF1 x/y through the shared transform lands within the road's reach of the centerline", async () => {
    const s = toRaceSnapshot(await recordedSnapshot(), opts())!;
    expect(s.mode).toBe("LIVE");
    expect(s.drivers).toHaveLength(22);
    const out = [0, 0, 0];
    for (const d of s.drivers) {
      expect(d.progress).not.toBeNull();
      const src = fx.location.filter((r: { driver_number: number }) => r.driver_number === d.number).at(-1);
      const [wx, , wz] = transform.toWorld(src.x, src.y, transform.origin[2]);
      path.pointAt(d.progress!, out);
      // The layout is built from the same OpenF1 coordinates: on this data every car projects within 1 m of the centerline.
      expect(Math.hypot(out[0] - wx, out[2] - wz)).toBeLessThan(5);
    }
  });

  it("keeps driver identity from OpenF1: acronym, team colour, team, running order", async () => {
    const s = toRaceSnapshot(await recordedSnapshot(), opts())!;
    for (const d of s.drivers) {
      const src = fx.drivers.find((x: { driver_number: number }) => x.driver_number === d.number);
      expect(d.code).toBe(src.name_acronym);
      expect(d.teamColour).toBe(`#${src.team_colour}`);
      expect(d.teamSlug).not.toBeNull();
    }
    expect(s.ordered).toBe(true);
    expect(s.drivers.map((d) => d.position).filter((p) => p != null)).toEqual([...Array(22).keys()].map((i) => i + 1));
  });

  it("availability: live, waiting (no locations yet), delayed (feed behind), unavailable (no session)", async () => {
    const live = await recordedSnapshot();
    expect(liveLocationState(live).state).toBe("live");
    expect(liveLocationState(await recordedSnapshot([])).state).toBe("waiting");
    expect(liveLocationState({ ...live, fetchedAt: new Date(NOW + 60_000).toISOString() }).state).toBe("delayed");
    expect(liveLocationState({ ...live, stale: true }).state).toBe("delayed");
    expect(liveLocationState({ ...live, status: "idle", session: null }).state).toBe("unavailable");
    // Waiting: drivers listed, no car placed; delayed: all marked stale.
    expect(toRaceSnapshot(await recordedSnapshot([]), opts())!.drivers.every((d) => d.progress === null)).toBe(true);
    expect(toRaceSnapshot({ ...live, stale: true }, opts())!.drivers.every((d) => d.stale)).toBe(true);
  });
});

describe("LiveProvider", () => {
  const scheduler = { now: () => Date.now(), every: () => () => {} };
  // A stand-in for the tab's shared store: the test pushes poll results in.
  function setup(sessionKey = 11396) {
    let push: (u: PollUpdate<LiveSnapshot>) => void = () => {};
    let unsubscribed = false;
    const p = new LiveProvider(
      { toWorld: transform.toWorld, z: transform.origin[2], path, circuit: { circuitSlug: "cota", circuitName: "Austin" }, sessionKey, source: (fn) => ((push = fn), () => void (unsubscribed = true)) },
      scheduler,
    );
    const got: ProviderUpdate[] = [];
    p.subscribe((u) => got.push(u));
    p.start();
    return { p, got, push: (data: LiveSnapshot | null, error: string | null = null) => push({ data, error, failures: error ? 1 : 0 }), unsubscribed: () => unsubscribed };
  }

  it("places all cars from the shared live state; the first update starts a fresh event log; dispose unsubscribes", async () => {
    const { p, got, push, unsubscribed } = setup();
    push(await recordedSnapshot());
    expect(got.at(-1)!.snapshot!.drivers.filter((d) => d.progress != null)).toHaveLength(22);
    expect(got.at(-1)).toMatchObject({ playback: null, eventsReset: true, source: { status: "ok" } });
    push(await recordedSnapshot());
    expect(got.at(-1)!.eventsReset).toBe(false);
    p.dispose();
    expect(unsubscribed()).toBe(true);
  });

  it("stamps each update with when OpenF1 recorded the newest position (receipt minus its age when served), not when it arrived", async () => {
    let clock = 50_000;
    let push: (u: PollUpdate<LiveSnapshot>) => void = () => {};
    const p = new LiveProvider({ toWorld: transform.toWorld, z: transform.origin[2], path, circuit: { circuitSlug: "cota", circuitName: "Austin" }, sessionKey: 11396, source: (fn) => ((push = fn), () => {}) }, { now: () => clock, every: () => () => {} });
    const got: ProviderUpdate[] = [];
    p.subscribe((u) => got.push(u));
    p.start();
    const live = await recordedSnapshot();
    const age = servedAgeMs(live, liveLocationState(live).latest)!;
    expect(age).toBeGreaterThan(0);
    push({ data: live, error: null, failures: 0 });
    expect(got.at(-1)!.at).toBe(50_000 - age);
    // The same positions again, 5 s later: no newer sample, so the stamp (and the age the toolbar shows) keeps growing from the same point.
    clock += 5000;
    push({ data: { ...live, servedAt: new Date(Date.parse(live.servedAt!) + 5000).toISOString() }, error: null, failures: 0 });
    expect(got.at(-1)!.at).toBe(50_000 - age);
    // Drawn three poll intervals behind, so markers glide between genuine samples (arrival lag + one cycle) instead of stopping and jumping.
    expect(p.renderDelayMs).toBe(3 * p.updateIntervalMs);
  });

  it("after a gap (failed requests), newer positions replace the stale ones; stationary cars with new samples (red flag) stay live", async () => {
    const { got, push } = setup();
    const live = await recordedSnapshot();
    push(live);
    push(live, "HTTP 502");
    expect(got.at(-1)!.snapshot!.drivers.every((d) => d.stale)).toBe(true);
    // Recovery: the same cars, newer samples at the same place (stopped in the pit lane under a red flag).
    const later = (iso: string | null) => (iso ? new Date(Date.parse(iso) + 30_000).toISOString() : iso);
    const next = { ...live, fetchedAt: later(live.fetchedAt), servedAt: later(live.servedAt!) ?? undefined, drivers: live.drivers.map((d) => ({ ...d, locationAt: later(d.locationAt) })) };
    push(next);
    const u = got.at(-1)!;
    expect(u.source.status).toBe("ok");
    expect(u.snapshot!.drivers.filter((d) => d.progress != null).every((d) => !d.stale)).toBe(true);
    expect(u.at).toBeGreaterThan(got[0].at); // the newest sample moved on, so the age shown resets
  });

  it("failed request: keeps the last positions, all stale, source error", async () => {
    const { got, push } = setup();
    const live = await recordedSnapshot();
    push(live);
    push(live, "HTTP 502");
    expect(got.at(-1)!.source.status).toBe("error");
    expect(got.at(-1)!.snapshot!.drivers.every((d) => d.stale)).toBe(true);
  });

  it("a different session on track: nothing from it is shown, the view says it is switching", async () => {
    const { got, push } = setup(99999);
    push(await recordedSnapshot());
    expect(got.at(-1)).toMatchObject({ snapshot: null, source: { status: "connecting", detail: SWITCHING } });
  });

  it("the session leaves the live window: unavailable, no cars", async () => {
    const { got, push } = setup();
    const live = await recordedSnapshot();
    push(live);
    push({ ...live, status: "idle", session: null, drivers: [], reason: "No session is running." });
    expect(got.at(-1)).toMatchObject({ snapshot: null, source: { status: "error", detail: "No session is running." } });
  });

  it("login rejected (feed status error): unavailable, no cars", async () => {
    const { got, push } = setup();
    const live = await recordedSnapshot();
    push({ ...live, status: "error", reason: "OpenF1 did not accept this site's credentials, so live timing is unavailable." });
    expect(got.at(-1)).toMatchObject({ snapshot: null, source: { status: "error", detail: expect.stringMatching(/credentials/) } });
  });
});
