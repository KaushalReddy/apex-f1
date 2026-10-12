import type { CircuitGeometry, Vec3 } from "../types";

/** TEST FIXTURES ONLY. Synthetic shapes used to test the engine; they are not any real circuit and must never be shipped as one. */
export function syntheticLoop(opts: { n?: number; radiusUnits?: number; unitMeters?: number; z?: (t: number) => number; figureEight?: boolean } = {}): CircuitGeometry {
  const { n = 400, radiusUnits = 9000, unitMeters = 0.1, z = () => 100, figureEight = false } = opts;
  const points: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    const x = 20000 + radiusUnits * (figureEight ? Math.sin(t) : Math.cos(t));
    const y = -5000 + radiusUnits * (figureEight ? Math.sin(t) * Math.cos(t) : 0.6 * Math.sin(t));
    points.push([x, y, z(t)]);
  }
  return {
    circuitKey: "SYNTHETIC-TEST-LOOP",
    coordinateSystem: "openf1-location",
    unitMeters,
    closed: true,
    points,
    widthMeters: null,
    derivation: { sessionKeys: [0], lapsUsed: 1, sigmaMeters: 6, stepMeters: 2, startFinishAtIndex0: true },
  };
}
