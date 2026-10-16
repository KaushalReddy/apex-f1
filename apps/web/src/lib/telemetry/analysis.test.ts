import { describe, expect, it } from "vitest";
import { createTrackPath } from "@/lib/race/track";
import { alignLap, byDistance, deltaTrace, distanceAtTime, interpAt, smooth, valuesAtTime } from "./analysis";
import { parseSessionTelemetry } from "./parse";
import type { LapTelemetry } from "./types";

// A circular "circuit" of radius R in the world plane, start/finish at angle 0, travelled anticlockwise in (x, z).
const R = 500;
const N = 720;
const L = 2 * Math.PI * R;
const ring = new Float32Array(N * 3);
for (let i = 0; i < N; i++) [ring[i * 3], ring[i * 3 + 1], ring[i * 3 + 2]] = [R * Math.cos((2 * Math.PI * i) / N), 0, R * Math.sin((2 * Math.PI * i) / N)];
const path = createTrackPath(ring);
const identity = (x: number, y: number): [number, number] => [x, y];

/** Synthetic lap at constant speed v (m/s), sampled every 250 ms (car) and 270 ms (position) from -1 s to the end + 1 s. */
function lap(v: number, gearFrom = 0): LapTelemetry {
  const dur = L / v;
  const car = { t: [] as number[], speed: [] as number[], throttle: [] as number[], brake: [] as number[], rpm: [] as number[], gear: [] as number[] };
  for (let t = -1000; t <= dur * 1000 + 1000; t += 250) {
    car.t.push(t);
    car.speed.push(v * 3.6);
    car.throttle.push(100);
    car.brake.push(0);
    car.rpm.push(11000 + (car.t.length % 7) * 10); // real feeds always vary a little
    car.gear.push(t / 1000 > gearFrom ? 8 : 7);
  }
  const position = { t: [] as number[], x: [] as number[], y: [] as number[] };
  for (let t = -1000; t <= dur * 1000 + 1000; t += 270) {
    const a = (v * (t / 1000)) / R;
    position.t.push(t);
    position.x.push(R * Math.cos(a));
    position.y.push(R * Math.sin(a));
  }
  return { driverNumber: 1, acronym: "AAA", fullName: null, team: null, teamColour: null, lapNumber: 5, lapDuration: dur, sectors: [null, null, null], car, position };
}

describe("interpAt", () => {
  it("interpolates linearly, steps when asked, and never bridges nulls, gaps or the ends", () => {
    expect(interpAt([0, 10], [0, 100], 2.5)).toBe(25);
    expect(interpAt([0, 10], [7, 8], 9, true)).toBe(7);
    expect(interpAt([0, 10], [0, null], 5)).toBeNull();
    expect(interpAt([0, 10], [0, 100], 5, false, 5)).toBeNull();
    expect(interpAt([0, 10], [0, 100], -1)).toBeNull();
    expect(interpAt([0, 10], [0, 100], 10)).toBe(100);
  });
});

describe("lap alignment on the circuit", () => {
  const a = alignLap(lap(80), path, identity);
  it("measures distance from the start/finish line along the centerline, negative just before it", () => {
    expect(distanceAtTime(a, 0)!).toBeCloseTo(0, 0);
    expect(distanceAtTime(a, 10)!).toBeCloseTo(800, -1); // within ~5 m
    expect(a.distance[0]!).toBeLessThan(0);
    expect(distanceAtTime(a, a.lapDuration)!).toBeCloseTo(L, -1);
  });
  it("resamples onto a distance grid covering the lap and computes B minus A", () => {
    const ta = byDistance(a, path.length, 10);
    const tb = byDistance(alignLap(lap(75), path, identity), path.length, 10);
    expect(ta.d[0]).toBe(0);
    expect(ta.d.at(-1)!).toBeGreaterThan(path.length - 10);
    const delta = deltaTrace(ta, tb);
    const i = ta.d.findIndex((d) => d >= 1500);
    expect(delta[i]!).toBeCloseTo(ta.d[i] / 75 - ta.d[i] / 80, 1);
    expect(delta[0]!).toBeCloseTo(0, 1);
  });
  it("keeps stepped channels stepped and gives time-mode values", () => {
    const g = alignLap(lap(80, 10), path, identity);
    expect(valuesAtTime(g, 9.9).gear).toBe(7);
    expect(valuesAtTime(g, 10.3).gear).toBe(8);
    expect(valuesAtTime(g, 5).speed).toBeCloseTo(288);
  });
  it("has time but no distance without a circuit layout", () => {
    const t = alignLap(lap(80), null, null);
    expect(t.distance.every((d) => d == null)).toBe(true);
    expect(valuesAtTime(t, 3).throttle).toBe(100);
  });
});

describe("smooth", () => {
  it("averages neighbours and keeps gaps", () => {
    expect(smooth([0, 3, 0, null, 6], 1)).toEqual([1.5, 1, 1.5, null, 6]);
  });
});

describe("invalid car data", () => {
  it("drops placeholder values and frozen stretches, keeping real samples and positions", () => {
    const l = lap(80);
    const n = l.car.t.length;
    // Freeze the feed for the last 40 samples (10 s) with the feed's placeholder throttle/brake, as seen in OpenF1 2026 Suzuka data.
    for (let i = n - 40; i < n; i++) [l.car.speed[i], l.car.throttle[i], l.car.brake[i], l.car.gear[i], l.car.rpm[i]] = [189, 104, 104, 4, 11535];
    l.car.throttle[5] = 104; // one isolated placeholder
    const a = alignLap(l, path, identity);
    expect(a.channels.speed[n - 1]).toBeNull();
    expect(a.channels.throttle[5]).toBeNull();
    expect(a.channels.speed[10]).toBe(288);
    expect(a.invalidSeconds).toBeGreaterThan(8);
    expect(a.invalidRanges).toHaveLength(2); // the isolated sample and the frozen tail
    expect(a.invalidRanges[1][1]).toBeCloseTo(a.lapDuration);
    expect(a.distance[n - 10]).not.toBeNull(); // positions still place the car while its car data is frozen
    expect(alignLap(lap(80), path, identity).invalidSeconds).toBe(0);
  });
});

describe("parseSessionTelemetry", () => {
  const good = { schema: "apex-f1/lap-telemetry@1", season: 2026, meetingKey: 1, sessionKey: 2, sessionName: "Qualifying", eventName: "X", date: "2026-01-01", coordinateSystem: "openf1-location", source: {}, laps: [lap(80)], excluded: [] };
  it("accepts a valid snapshot and rejects broken ones", () => {
    expect(parseSessionTelemetry(good).ok).toBe(true);
    expect(parseSessionTelemetry({ ...good, schema: "x" }).ok).toBe(false);
    const short = lap(80);
    short.car.speed = short.car.speed.slice(1);
    expect(parseSessionTelemetry({ ...good, laps: [short] })).toMatchObject({ ok: false, error: expect.stringContaining("car.speed") });
    const unordered = lap(80);
    unordered.position.t = [...unordered.position.t].reverse();
    expect(parseSessionTelemetry({ ...good, laps: [unordered] }).ok).toBe(false);
  });
});
