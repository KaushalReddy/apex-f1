import { describe, expect, it } from "vitest";
import { centerlineLengthUnits, describeScale, MAX_POINTS, parseCircuitGeometry, sourceBounds } from "./geometry";
import { syntheticLoop } from "./testing/syntheticLoop";

const good = () => JSON.parse(JSON.stringify(syntheticLoop({ n: 50 })));

describe("parseCircuitGeometry", () => {
  it("accepts a valid contract-shaped document and keeps extra derivation fields", () => {
    const raw = good();
    raw.derivation.spikeVerdict = "PASS";
    const r = parseCircuitGeometry(raw);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.geometry.derivation.spikeVerdict).toBe("PASS");
  });

  it.each([
    ["not an object", () => 42],
    ["empty circuitKey", () => ({ ...good(), circuitKey: " " })],
    ["missing coordinateSystem", () => ({ ...good(), coordinateSystem: undefined })],
    ["zero unit", () => ({ ...good(), unitMeters: 0 })],
    ["negative unit", () => ({ ...good(), unitMeters: -0.1 })],
    ["string unit", () => ({ ...good(), unitMeters: "0.1" })],
    ["closed not boolean", () => ({ ...good(), closed: "yes" })],
    ["too few points", () => ({ ...good(), points: [[0, 0, 0], [1, 1, 1]] })],
    ["2-tuple point", () => ({ ...good(), points: [[0, 0], [1, 1], [2, 2]] })],
    ["NaN coordinate", () => ({ ...good(), points: [[0, 0, 0], [1, NaN, 1], [2, 2, 2]] })],
    ["string coordinate", () => ({ ...good(), points: [[0, 0, 0], [1, "1", 1], [2, 2, 2]] })],
    ["negative width", () => ({ ...good(), widthMeters: -3 })],
    ["missing derivation", () => ({ ...good(), derivation: undefined })],
    ["non-integer session key", () => ({ ...good(), derivation: { ...good().derivation, sessionKeys: [1.5] } })],
    ["degenerate (all points equal)", () => ({ ...good(), points: [[5, 5, 0], [5, 5, 0], [5, 5, 0]] })],
  ])("rejects: %s", (_name, make) => {
    const r = parseCircuitGeometry(make());
    expect(r.ok).toBe(false);
  });

  it("accepts null width and rejects oversized point sets", () => {
    expect(parseCircuitGeometry({ ...good(), widthMeters: null }).ok).toBe(true);
    const big = { ...good(), points: Array.from({ length: MAX_POINTS + 1 }, (_, i) => [i, i % 7, 0]) };
    expect(parseCircuitGeometry(big).ok).toBe(false);
  });
});

describe("helpers", () => {
  it("computes bounds and a closed length", () => {
    const sq = [[0, 0, 0], [10, 0, 5], [10, 10, 2], [0, 10, 1]] as const;
    expect(sourceBounds(sq)).toEqual({ min: [0, 0, 0], max: [10, 10, 5] });
    expect(centerlineLengthUnits(sq, true)).toBeCloseTo(40);
    expect(centerlineLengthUnits(sq, false)).toBeCloseTo(30);
  });

  it("never claims calibration the spike did not establish", () => {
    const g = syntheticLoop();
    expect(describeScale(g).calibrated).toBe(false);
    g.derivation.scale = { status: "caveat", lengthErrorPct: 3.4 };
    expect(describeScale(g).label).toContain("CAVEAT");
    expect(describeScale(g).calibrated).toBe(false);
    g.derivation.scale = { status: "within-tolerance" };
    expect(describeScale(g).calibrated).toBe(true);
  });
});
