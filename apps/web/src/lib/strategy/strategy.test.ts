import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseReplay } from "@/lib/replay/dataset";
import { ReplayModel } from "@/lib/replay/model";
import { fixture, project } from "@/lib/replay/testing/fixture";
import { finalGaps, linearFit, positionAfter, stintsOf, whatIf, type StintView } from "./strategy";

describe("linearFit", () => {
  it("recovers a known line and refuses too few or degenerate points", () => {
    const xs = [0, 1, 2, 3, 4, 5];
    const f = linearFit(xs, xs.map((x) => 90 + 0.05 * x))!;
    expect(f.slope).toBeCloseTo(0.05);
    expect(f.intercept).toBeCloseTo(90);
    expect(f.sd).toBeCloseTo(0);
    expect(linearFit([1, 2, 3, 4], [1, 2, 3, 4])).toBeNull();
    expect(linearFit([2, 2, 2, 2, 2], [1, 2, 3, 4, 5])).toBeNull();
  });
});

// TEST DATA: the synthetic race (testing/fixture.ts) with a one-stop strategy for car 1.
function model() {
  const f = fixture();
  const laps: [number, number, number][] = [];
  let t = 10_000;
  for (let lap = 1; lap <= 20; lap++) {
    // Stint 1 (laps 1-10) degrades 0.10 s/lap from 100 s; stint 2 (laps 11-20) starts at 99 s and degrades 0.05 s/lap.
    const s = lap <= 10 ? 100 + 0.1 * (lap - 1) : 99 + 0.05 * (lap - 11);
    laps.push([lap, t, lap === 10 || lap === 11 ? s + 20 : s]); // in- and out-lap slow
    t += s * 1000;
  }
  f.drivers[0].laps = laps;
  (f.drivers[0] as Record<string, unknown>).stints = [
    [1, "MEDIUM", 1, 10, 0],
    [2, "HARD", 11, 20, 0],
  ];
  (f.drivers[1] as Record<string, unknown>).stints = [
    [1, "SOFT", 1, 1, 0],
    [2, "MEDIUM", 2, 20, 0],
  ];
  f.pits = [{ t: 0, number: 1, lap: 10, laneS: 20, stopS: 2.4 }];
  f.raceControl = [{ t: 10_000, category: "Other", flag: null, scope: null, message: "RACE START" }] as never;
  f.durationMs = t + 30_000;
  const r = parseReplay(f);
  if (!r.ok) throw new Error(r.error);
  return new ReplayModel(r.value, project);
}

describe("stintsOf", () => {
  const m = model();
  const st = stintsOf(m, 0);
  it("lists stints with their laps, matches pit stops and fits degradation on comparable laps only", () => {
    expect(st.map((s) => [s.compound, s.lapStart, s.lapEnd, s.laps])).toEqual([["MEDIUM", 1, 10, 10], ["HARD", 11, 20, 10]]);
    expect(st[1].pitMatched).toBe(true);
    // Stint 1: lap 1 (standing start) and lap 10 (in-lap) excluded; stint 2: its first lap (out-lap) excluded.
    expect(st[0].points.map((p) => p[0])).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(st[0].fit!.slope).toBeCloseTo(0.1);
    expect(st[1].fit!.slope).toBeCloseTo(0.05);
  });
  it("flags a compound change with no published pit stop", () => {
    expect(stintsOf(m, 1)[1].pitMatched).toBe(false);
  });
});

describe("whatIf (SIMULATION)", () => {
  const st = stintsOf(model(), 0);
  it("stopping later on worn tyres costs time when the old tyres are slower than new ones", () => {
    const r = whatIf(st, 0, 14)!;
    // Laps 11-13 move from fresh hards (~99.0-99.1 s) to old mediums (~101.0-101.2 s); the hard stint then starts 3 laps later (younger).
    expect(r.lapsMoved).toBe(3);
    expect(r.delta).toBeGreaterThan(5);
    expect(r.low).toBeLessThanOrEqual(r.delta);
    expect(r.high).toBeGreaterThanOrEqual(r.delta);
  });
  it("is unavailable without fits on both stints or outside the two stints", () => {
    const noFit = st.map((s, k) => (k === 1 ? { ...s, fit: null } : s)) as StintView[];
    expect(whatIf(noFit, 0, 12)).toBeNull();
    expect(whatIf(st, 0, 11)).toBeNull(); // the real lap
    expect(whatIf(st, 0, 1)).toBeNull();
    expect(whatIf(st, 1, 15)).toBeNull(); // no stint after the last
  });
});

describe("real data: Singapore 2026", () => {
  it("builds every driver's stints with degradation fits where there are enough laps, and finishing positions", () => {
    const r = parseReplay(JSON.parse(readFileSync("public/replay/2026/11388.json", "utf8")));
    if (!r.ok) throw new Error(r.error);
    const m = new ReplayModel(r.value, null);
    const all = m.ds.drivers.map((_, i) => stintsOf(m, i));
    expect(all.every((s) => s.length >= 1)).toBe(true);
    expect(all.flat().filter((s) => s.fit).length).toBeGreaterThan(15);
    // The three lap-1 compound changes without a pit record are flagged, not hidden.
    expect(all.flat().filter((s) => s.pitMatched === false).length).toBe(3);
    const ver = m.ds.drivers.findIndex((d) => d.acronym === "VER");
    const finals = finalGaps(m);
    expect(finals.filter((f) => f.position <= 10).every((f) => f.gap != null)).toBe(true); // the last published gaps, not "stale"
    expect(finals[0].number).toBe(m.ds.drivers[ver].number);
    expect(positionAfter(finals, m.ds.drivers[ver].number, 0)).toEqual({ from: 1, to: 1 });
    // Losing 60 s would have dropped the winner behind everyone within 60 s of him.
    const within = finals.filter((f) => f.gap != null && !f.lapsDown && (f.gap as number) < 60).length;
    expect(positionAfter(finals, m.ds.drivers[ver].number, 60)!.to).toBe(within);
  });
});
