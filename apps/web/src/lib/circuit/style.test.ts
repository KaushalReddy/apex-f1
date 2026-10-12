import { describe, expect, it } from "vitest";
import { LEGIBLE_WIDTH_RATIO, NOMINAL_TRACK_WIDTH_M, circuitExtentMeters, describeTrackWidth, resolveTrackWidth } from "./geometry";
import { PALETTE, contrastRatio, relativeLuminance } from "./style";
import { syntheticLoop } from "./testing/syntheticLoop";

describe("palette contrast (regression guard against the 'dark on dark' scene)", () => {
  it("asphalt is clearly separated from the ground, and edge lines and the chequered line from the asphalt", () => {
    expect(contrastRatio(PALETTE.asphalt, PALETTE.ground)).toBeGreaterThan(2.2);
    expect(contrastRatio(PALETTE.edge, PALETTE.asphalt)).toBeGreaterThan(4);
    expect(contrastRatio(PALETTE.checkerLight, PALETTE.checkerDark)).toBeGreaterThan(10);
  });

  it("the grid stays quieter than the road: closer in luminance to the ground than the asphalt is", () => {
    const g = relativeLuminance(PALETTE.ground);
    expect(Math.abs(relativeLuminance(PALETTE.gridMajor) - g)).toBeLessThan(Math.abs(relativeLuminance(PALETTE.asphalt) - g) / 3);
  });
});

describe("track width policy", () => {
  it("widens a thin road for legibility but never narrows a sourced wide one, and says so", () => {
    const w = resolveTrackWidth(null, 1700);
    expect(w.sourcedMeters).toBeNull();
    expect(w.baseMeters).toBe(NOMINAL_TRACK_WIDTH_M);
    expect(w.drawnMeters).toBeCloseTo(1700 * LEGIBLE_WIDTH_RATIO, 6);
    expect(w.widenedForLegibility).toBe(true);
    expect(describeTrackWidth(w)).toMatch(/not sourced/);
    expect(describeTrackWidth(w)).toMatch(/widened for legibility/);

    const small = resolveTrackWidth(null, 300);
    expect(small.drawnMeters).toBe(NOMINAL_TRACK_WIDTH_M);
    expect(small.widenedForLegibility).toBe(false);

    const sourced = resolveTrackWidth(15, 500);
    expect(sourced.drawnMeters).toBe(15);
    expect(describeTrackWidth(sourced)).toMatch(/sourced/);
    expect(resolveTrackWidth(12, 5000).sourcedMeters).toBe(12);
  });

  it("measures the longest dimension under the stated unit", () => {
    const g = syntheticLoop({ radiusUnits: 9000, unitMeters: 0.1 });
    expect(circuitExtentMeters(g.points, g.unitMeters)).toBeCloseTo(1800, 0);
    expect(circuitExtentMeters(g.points, 0.2)).toBeCloseTo(3600, 0);
  });
});
