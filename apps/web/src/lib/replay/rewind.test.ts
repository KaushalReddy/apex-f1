import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseReplay } from "./dataset";
import { ReplayModel } from "./model";
import { rewindSteps, rewindSummary } from "./rewind";
import { fixture, project } from "./testing/fixture";

// TEST DATA: the synthetic two-car race (testing/fixture.ts) with a scripted order: a published pass, an unexplained swap, a pit stop.
function model() {
  const f = fixture();
  f.order = [
    [0, 1, 1], [0, 2, 2],
    [15_000, 2, 1], [15_000, 1, 2], // BBB passes AAA (published below)
    [60_000, 1, 1], [60_000, 2, 2], // AAA back ahead: no pass or pit recorded
    [150_000, 2, 1], [150_000, 1, 2], // AAA pits (record at 140 s) and drops behind
  ];
  (f as Record<string, unknown>).overtakes = [[14_000, 2, 1, 1]];
  f.pits = [{ t: 140_000, number: 1, lap: 2, laneS: 21.5, stopS: 2.4 }];
  const r = parseReplay(f);
  if (!r.ok) throw new Error(r.error);
  return new ReplayModel(r.value, project);
}

describe("rewindSteps", () => {
  const m = model();
  it("explains each change of the first car: passed on track, unexplained gain, lost in its own pit stop", () => {
    const s = rewindSteps(m, 0);
    expect(s.map((x) => [x.from, x.to, x.swaps.map((w) => `${w.other}:${w.cause}`)])).toEqual([
      [1, 2, ["2:on-track"]],
      [2, 1, ["2:unexplained"]],
      [1, 2, ["2:own-pit"]],
    ]);
    expect(s[2].pit).toEqual({ lap: 2, laneS: 21.5, stopS: 2.4 });
    expect(rewindSummary(m, 0, s)).toEqual({ start: 1, now: 2, byCause: { "on-track": -1, unexplained: 1, "own-pit": -1, "rival-pit": 0, "rival-stopped": 0 } });
  });
  it("credits the other car with the same swaps from its side", () => {
    const s = rewindSteps(m, 1);
    expect(s.map((x) => [x.from, x.to, x.swaps.map((w) => w.cause)])).toEqual([
      [2, 1, ["on-track"]],
      [1, 2, ["unexplained"]],
      [2, 1, ["rival-pit"]],
    ]);
  });
});

describe("real data: Singapore 2026", () => {
  const r = parseReplay(JSON.parse(readFileSync("public/replay/2026/11388.json", "utf8")));
  if (!r.ok) throw new Error(r.error);
  const m = new ReplayModel(r.value, null);
  const nor = m.ds.drivers.findIndex((d) => d.acronym === "NOR");
  it("has the published on-track passes", () => {
    expect(m.ds.overtakes.length).toBeGreaterThan(100);
  });
  it("explains NOR's race: the pit stop that dropped him, and the summary adds up to the net result", () => {
    const s = rewindSteps(m, nor);
    const pit = s.find((x) => x.swaps.some((w) => w.cause === "own-pit"))!;
    expect(pit.pit?.lap).toBe(32);
    expect(pit.to - pit.from).toBeGreaterThanOrEqual(3);
    const sum = rewindSummary(m, nor, s);
    expect([sum.start, sum.now]).toEqual([5, 4]);
    // The causes add up to the net change.
    expect(Object.values(sum.byCause).reduce((a, b) => a + b, 0)).toBe(sum.start! - sum.now!);
  });
  it("explains most changes across the field (few unexplained)", () => {
    let swaps = 0;
    let unexplained = 0;
    for (let i = 0; i < m.ds.drivers.length; i++)
      for (const x of rewindSteps(m, i)) {
        swaps += x.swaps.length;
        unexplained += x.swaps.filter((w) => w.cause === "unexplained").length;
      }
    console.log(`Singapore 2026: ${swaps} swaps, ${unexplained} unexplained (${((100 * unexplained) / swaps).toFixed(0)}%)`);
    expect(unexplained / swaps).toBeLessThan(0.1);
    // For every driver, the summary's causes add up to start minus finish, even where cars dropped out of the order.
    for (let i = 0; i < m.ds.drivers.length; i++) {
      const sum = rewindSummary(m, i, rewindSteps(m, i));
      if (sum.start != null && sum.now != null) expect(Object.values(sum.byCause).reduce((a, b) => a + b, 0)).toBe(sum.start - sum.now);
    }
  });
});
