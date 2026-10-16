import { describe, expect, it } from "vitest";
import { createTrackPath } from "@/lib/race/track";
import { decodePositions, parseReplay } from "./dataset";
import { lastAtOrBefore, ReplayModel } from "./model";

/**
 * TEST DATA (synthetic, not a real race): two cars on a circular "circuit" of radius 1000 (world = source plane), one lap per 100 s for
 * car 1 and per 110 s for car 2, recorded every 1 s from t = 0 (lights out at 10 s).
 */
const R = 1000;
const N = 720;
const ring = new Float32Array(N * 3);
for (let i = 0; i < N; i++) [ring[i * 3], ring[i * 3 + 1], ring[i * 3 + 2]] = [R * Math.cos((2 * Math.PI * i) / N), 0, R * Math.sin((2 * Math.PI * i) / N)];
const path = createTrackPath(ring);
export const project = (x: number, y: number, hint: number | null) => path.project(x, y, hint);

function track(lapS: number, untilS: number, skip: (s: number) => boolean = () => false) {
  const pts: [number, number, number][] = [];
  for (let s = 0; s <= untilS; s++) if (!skip(s)) pts.push([s * 1000, R * Math.cos((2 * Math.PI * s) / lapS), R * Math.sin((2 * Math.PI * s) / lapS)]);
  const delta = (k: number) => pts.map((p, i) => (i === 0 ? p[k] : p[k] - pts[i - 1][k]));
  return { dt: delta(0), dx: delta(1), dy: delta(2) };
}
export const fixture = () => ({
  schema: "apex-f1/race-replay@1",
  season: 2026, meetingKey: 1, sessionKey: 99, eventName: "Test GP", circuitShortName: "Test", date: "2026-01-01", coordinateSystem: "openf1-location",
  startUtc: "2026-01-01T12:00:00Z", lightsOutMs: 10_000, durationMs: 400_000, positionStepMs: 1000, source: {},
  drivers: [
    { number: 1, acronym: "AAA", team: "Team A", teamColour: "#112233", positions: track(100, 300), laps: [[1, 10_000, 100], [2, 110_000, 100], [3, 210_000, 100]], intervals: { t: [20_000, 120_000], gap: [0, 0], interval: [null, null], lapsDown: [null, null] } },
    // Car 2 has a 20 s hole in its recorded positions (150–170 s).
    { number: 2, acronym: "BBB", team: "Team B", teamColour: "#445566", positions: track(110, 300, (s) => s > 150 && s < 170), laps: [[1, 10_000, 110], [2, 120_000, null]], intervals: { t: [20_000, 120_000], gap: [0.4, 10.2], interval: [0.4, 10.2], lapsDown: [null, null] } },
    { number: 2, acronym: "DUP", positions: track(100, 10), laps: [], intervals: {} }, // duplicated identity: dropped, never merged
  ],
  order: [[0, 1, 1], [0, 2, 2], [15_000, 2, 1], [15_000, 1, 2], [60_000, 1, 1], [60_000, 2, 2], [70_000, 77, 3]],
  pits: [{ t: 130_000, number: 2, lap: 2, laneS: 20, stopS: 2.5 }],
  raceControl: [
    { t: 10_000, category: "Other", flag: null, message: "RACE START" },
    { t: 90_000, category: "SafetyCar", flag: null, message: "VIRTUAL SAFETY CAR DEPLOYED" },
    { t: 95_000, category: "Other", flag: null, message: "CAR 1 TIME 1:40.000 DELETED - TRACK LIMITS" },
    { t: 310_000, category: "Flag", flag: "CHEQUERED", message: "CHEQUERED FLAG" },
  ],
});

describe("parseReplay", () => {
  it("validates, decodes deltas and reports what it dropped", () => {
    const r = parseReplay(fixture());
    if (!r.ok) throw new Error(r.error);
    expect(r.value.drivers.map((d) => d.number)).toEqual([1, 2]);
    expect(r.value.dropped).toEqual({ positionSamples: 0, orderRows: 1, drivers: 1 }); // car 77 is unknown; duplicate car 2
    expect(r.value.drivers[0].positions.t.slice(0, 3)).toEqual([0, 1000, 2000]);
    expect(r.value.drivers[0].positions.x[0]).toBe(R);
  });
  it("rejects malformed files", () => {
    expect(parseReplay({ ...fixture(), schema: "x" }).ok).toBe(false);
    expect(parseReplay({ ...fixture(), durationMs: -1 }).ok).toBe(false);
    expect(parseReplay({ ...fixture(), startUtc: "yesterday" }).ok).toBe(false);
    expect(parseReplay({ ...fixture(), drivers: [] }).ok).toBe(false);
  });
  it("drops duplicate/backwards timestamps and stops at a corrupt delta", () => {
    expect(decodePositions({ dt: [0, 1000, 0, -500, 1000], dx: [0, 1, 1, 1, 1], dy: [0, 0, 0, 0, 0] })).toMatchObject({ t: [0, 1000, 1500], dropped: 2 }); // deltas are relative to the previous raw sample
    expect(decodePositions({ dt: [0, 1000, null, 1000], dx: [5, 1, 1, 1], dy: [0, 0, 0, 0] })).toMatchObject({ t: [0, 1000], x: [5, 6], dropped: 2 });
  });
});

describe("ReplayModel", () => {
  const ds = (() => {
    const r = parseReplay(fixture());
    if (!r.ok) throw new Error(r.error);
    return r.value;
  })();
  const m = new ReplayModel(ds, project);

  it("interpolates between recorded samples along the track, and flags measured vs interpolated", () => {
    const at = m.positionAt(0, 25_500)!;
    expect(at.progress).toBeCloseTo(0.255, 2);
    expect(at.measured).toBe(false);
    expect(m.positionAt(0, 25_000)!.measured).toBe(true);
    // Through the start/finish line forward, not backwards round the lap.
    expect(m.positionAt(0, 99_500)!.progress).toBeGreaterThan(0.99);
    expect(m.positionAt(0, 100_500)!.progress).toBeLessThan(0.01);
  });
  it("never bridges a gap in the recording: holds the last position and marks it stale", () => {
    const held = m.positionAt(1, 160_000)!;
    expect(held.stale).toBe(true);
    expect(held.progress).toBeCloseTo((150 % 110) / 110, 2);
    expect(m.positionAt(1, 175_000)!.stale).toBe(false);
  });
  it("has no position before the first or long after the last sample", () => {
    expect(m.positionAt(0, -1)).toMatchObject({ measured: false, stale: false }); // the grid position, just before the first sample
    expect(m.positionAt(0, -10_000)).toBeNull();
    expect(m.positionAt(0, 320_000)).toBeNull();
  });
  it("gives the official running order at the requested time, not the final classification", () => {
    expect([m.positionOf(1, 5000), m.positionOf(2, 5000)]).toEqual([1, 2]);
    expect([m.positionOf(1, 30_000), m.positionOf(2, 30_000)]).toEqual([2, 1]);
    expect(m.positionOf(1, 60_000)).toBe(1);
  });
  it("gives laps, completed lap times only once complete, gaps, pit and finish state at t", () => {
    expect(m.lapAt(0, 50_000)).toEqual({ lap: 1, lastS: null, bestS: null });
    expect(m.lapAt(0, 115_000)).toEqual({ lap: 2, lastS: 100, bestS: 100 });
    expect(m.intervalAt(1, 125_000)).toEqual({ gap: 10.2, interval: 10.2, lapsDown: null });
    expect(m.intervalAt(1, 200_000)).toBeNull(); // older than 30 s: not shown as current
    expect(m.inPit(1, 140_000)).toBe(true);
    expect(m.inPit(1, 151_000)).toBe(false);
    expect(m.finished(0, 309_000)).toBe(false);
    expect(m.finished(0, 311_000)).toBe(true);
  });
  it("lists official, pit and derived position events in time order, without noise messages", () => {
    const kinds = m.events.map((e) => `${e.kind}@${e.t / 1000}`);
    expect(kinds).toEqual(["official@10", "position@15", "position@15", "position@60", "position@60", "official@90", "pit@130", "official@310"]);
    expect(m.eventsUntil(60_000)).toHaveLength(5);
    expect(m.eventsUntil(0)).toEqual([]);
  });
  it("binary search finds the last element at or before x", () => {
    expect(lastAtOrBefore([1, 3, 5], 0)).toBe(-1);
    expect(lastAtOrBefore([1, 3, 5], 3)).toBe(1);
    expect(lastAtOrBefore([1, 3, 5], 9)).toBe(2);
  });
});
