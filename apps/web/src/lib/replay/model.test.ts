import { describe, expect, it } from "vitest";
import { decodePositions, parseReplay } from "./dataset";
import { lastAtOrBefore, ReplayModel } from "./model";
import { fixture, project, R } from "./testing/fixture";

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
