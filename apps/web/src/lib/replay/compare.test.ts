import { describe, expect, it } from "vitest";
import { parseReplay } from "./dataset";
import { driverAt, gapBetween, lapDelta, lapTrace, swapsBetween } from "./compare";
import { ReplayModel } from "./model";
import { fixture, project } from "./model.test";

// TEST DATA: the synthetic two-car race of model.test.ts (circle of radius 1000; car 1 laps in 100 s, car 2 in 110 s).
function model(mut?: (f: ReturnType<typeof fixture>) => void) {
  const f = fixture();
  mut?.(f);
  const r = parseReplay(f);
  if (!r.ok) throw new Error(r.error);
  return new ReplayModel(r.value, project);
}
const L = 2 * Math.PI * 1000;

describe("driverAt", () => {
  it("gives official values and calculated lap time / progress at t", () => {
    const m = model((f) => {
      f.drivers[0].laps = [[1, 10_000, 100, 30, 40, 30], [2, 110_000, 100, 31, 39, 30], [3, 210_000, 100]];
    });
    const a = driverAt(m, 0, 125_000);
    expect(a).toMatchObject({ number: 1, code: "AAA", position: 1, lap: 2, lastS: 100, bestS: 100, lastSectors: [30, 40, 30], hasPosition: true });
    expect(a.currentLapS).toBeCloseTo(15);
    expect(a.lapProgress).toBeCloseTo(0.25, 1);
  });
  it("has no sectors when the source did not publish them, and no position inside a recording gap", () => {
    const m = model();
    expect(driverAt(m, 0, 125_000).lastSectors).toBeNull();
    expect(driverAt(m, 1, 160_000)).toMatchObject({ hasPosition: false, lapProgress: null });
  });
});

describe("leader's gap", () => {
  it("is 0 for the car that is P1 in the official order, even when its published gap is stale", () => {
    const m = model((f) => {
      f.drivers[0].intervals = { t: [20_000], gap: [0], interval: [0], lapsDown: [null] }; // published once, long before t
    });
    expect(driverAt(m, 0, 200_000)).toMatchObject({ position: 1, gapToLeaderS: 0, lapsDown: null });
    expect(driverAt(m, 1, 200_000).gapToLeaderS).toBeNull(); // not the leader: its stale gap stays unknown
  });
});

describe("gapBetween (calculated from published gaps to the leader)", () => {
  const base = { number: 1, code: "A", position: 1, lap: 1, lapProgress: 0, currentLapS: 0, lastS: null, bestS: null, lastSectors: null, hasPosition: true, inPit: false };
  it("is B minus A in seconds, positive when B is behind", () => {
    expect(gapBetween({ ...base, gapToLeaderS: 1.2, lapsDown: null }, { ...base, gapToLeaderS: 4.0, lapsDown: null }).seconds).toBeCloseTo(2.8);
    expect(gapBetween({ ...base, gapToLeaderS: 4.0, lapsDown: null }, { ...base, gapToLeaderS: 1.2, lapsDown: null }).seconds).toBeCloseTo(-2.8);
  });
  it("gives only the lap difference when a car is lapped, and nothing when a gap is unknown", () => {
    expect(gapBetween({ ...base, gapToLeaderS: 3, lapsDown: null }, { ...base, gapToLeaderS: null, lapsDown: 1 })).toEqual({ seconds: null, laps: 1 });
    expect(gapBetween({ ...base, gapToLeaderS: null, lapsDown: null }, { ...base, gapToLeaderS: 2, lapsDown: null })).toEqual({ seconds: null, laps: null });
  });
});

describe("swapsBetween (official order)", () => {
  it("records each change of who is ahead after lights out, once per timestamp", () => {
    expect(swapsBetween(model(), 1, 2)).toEqual([{ t: 15_000, ahead: 2 }, { t: 60_000, ahead: 1 }]);
  });
});

describe("lap comparison by distance", () => {
  it("aligns a lap from recorded positions and computes B minus A along the lap", () => {
    const m = model();
    const a = lapTrace(m, 0, 1, L)!;
    const b = lapTrace(m, 1, 1, L)!;
    expect(a.d[0]).toBe(0);
    expect(a.d.at(-1)).toBe(L);
    expect(a.t.at(-1)).toBe(100);
    const { d, delta } = lapDelta(a, b, L, 100);
    const half = d.findIndex((x) => x >= L / 2);
    expect(delta[half]!).toBeCloseTo((d[half] / L) * 10, 0); // car 2 loses 10 s per lap, evenly
    expect(delta.at(-1)!).toBeCloseTo((d.at(-1)! / L) * 10, 1); // last grid point (6200 m) is short of the full lap
  });
  it("refuses a lap with a recording gap over 5 s or without a lap time", () => {
    const m = model((f) => {
      f.drivers[1].laps = [[1, 10_000, 110], [2, 120_000, 110], [3, 230_000, null]];
    });
    expect(lapTrace(m, 1, 2, L)).toBeNull(); // car 2 has no positions from 150 to 170 s
    expect(lapTrace(m, 1, 3, L)).toBeNull();
    expect(lapTrace(m, 0, 99, L)).toBeNull();
  });
});
