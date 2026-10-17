import { describe, expect, it } from "vitest";
import { parseReplay } from "./dataset";
import { comparable, consistency, deltaSwings, lapRows, neutralisedPeriods, sectorBreakdown } from "./laps";
import { ReplayModel } from "./model";
import { fixture, project } from "./testing/fixture";

// TEST DATA: the synthetic race of testing/fixture.ts with more laps for car 1.
function model() {
  const f = fixture();
  f.drivers[0].laps = [[1, 10_000, 100, 30, 40, 30], [2, 110_000, 98, 29, 40, 29], [3, 208_000, 120, 40, 40, 40], [4, 328_000, 97, 29, 39, 29], [5, 425_000, 99, 30, 39, 30], [6, 524_000, 96, 28, 39, 29]];
  f.durationMs = 700_000;
  f.pits = [{ t: 330_000, number: 1, lap: 4, laneS: 20, stopS: 2.4 }];
  // VSC from 90 s to 150 s covers laps 1–2.
  f.raceControl = [
    { t: 10_000, category: "Other", flag: null, message: "RACE START" },
    { t: 90_000, category: "SafetyCar", flag: null, message: "VSC DEPLOYED" },
    { t: 150_000, category: "SafetyCar", flag: null, message: "VSC ENDING" },
  ];
  const r = parseReplay(f);
  if (!r.ok) throw new Error(r.error);
  return new ReplayModel(r.value, project);
}

describe("lap rows", () => {
  const m = model();
  const rows = lapRows(m, 0);
  it("marks pit in/out laps and neutralised laps from official records", () => {
    expect(neutralisedPeriods(m)).toEqual([{ from: 90_000, to: 150_000, kind: "VSC" }]);
    expect(rows[1].neutralisedBy).toEqual(["VSC"]);
    expect(rows.map((r) => [r.lap, r.pit, r.neutralised])).toEqual([[1, false, true], [2, false, true], [3, false, false], [4, true, false], [5, true, false], [6, false, false]]);
  });
  it("uses only comparable laps for consistency, and needs at least three", () => {
    expect(rows.filter(comparable).map((r) => r.lap)).toEqual([3, 6]);
    expect(consistency(rows)).toBeNull(); // two comparable laps only
    const c = consistency([...rows, { lap: 7, start: 0, lapS: 98, sectors: [null, null, null], pit: false, neutralised: false, neutralisedBy: [] }])!;
    expect(c.laps).toBe(3);
    expect(c.meanS).toBeCloseTo((120 + 96 + 98) / 3);
  });
});

describe("sector breakdown (B minus A)", () => {
  it("gives per-sector and cumulative differences with the sign of B relative to A", () => {
    const r = sectorBreakdown([30, 40, 30], [29.5, 40.25, 29.75]);
    expect(r.delta).toEqual([-0.5, 0.25, -0.25]);
    expect(r.cumulative).toEqual([-0.5, -0.25, -0.5]);
  });
  it("stops the running total at a missing sector instead of guessing", () => {
    expect(sectorBreakdown([30, null, 30], [29, 41, 30]).cumulative).toEqual([-1, null, null]);
  });
});

describe("deltaSwings", () => {
  it("finds where B gained and lost most over a window", () => {
    const d = [0, 100, 200, 300, 400, 500, 600];
    const delta = [0, 0.1, 0.3, 0.3, 0.1, -0.2, -0.2];
    const s = deltaSwings(d, delta, 200);
    expect(s.loss).toEqual({ from: 0, to: 200, s: 0.3 });
    expect(s.gain!.from).toBe(300);
    expect(s.gain!.s).toBeCloseTo(-0.5);
  });
});
