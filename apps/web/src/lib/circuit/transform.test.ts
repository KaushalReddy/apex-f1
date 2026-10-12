import { describe, expect, it } from "vitest";
import { centerlineToWorld, createWorldTransform, sameCoordinateSystem } from "./transform";
import { syntheticLoop } from "./testing/syntheticLoop";

const g = syntheticLoop({ z: (t) => 100 + 30 * Math.sin(t) });
const cross = (a: number[], b: number[]) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a: number[], b: number[]) => a.map((v, i) => v - b[i]);

describe("world transform", () => {
  it("recentres the centerline: bbox centre of x/y is the world origin, lowest z is height 0", () => {
    const t = createWorldTransform(g);
    const w = centerlineToWorld(g, t);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity;
    for (let i = 0; i < w.length; i += 3) {
      minX = Math.min(minX, w[i]); maxX = Math.max(maxX, w[i]);
      minY = Math.min(minY, w[i + 1]);
      minZ = Math.min(minZ, w[i + 2]); maxZ = Math.max(maxZ, w[i + 2]);
    }
    expect((minX + maxX) / 2).toBeCloseTo(0, 3);
    expect((minZ + maxZ) / 2).toBeCloseTo(0, 3);
    expect(minY).toBeCloseTo(0, 3);
  });

  it("scales by unitMeters (0.1 m/unit: 10 units = 1 m)", () => {
    const t = createWorldTransform(g);
    const a = t.toWorld(t.origin[0], t.origin[1], t.origin[2]);
    const b = t.toWorld(t.origin[0] + 10, t.origin[1], t.origin[2]);
    expect(b[0] - a[0]).toBeCloseTo(1, 6);
  });

  it("maps source +x -> world +X, +y -> world -Z, +z -> world +Y", () => {
    const t = createWorldTransform(g);
    const o = t.toWorld(...t.origin);
    expect(sub(t.toWorld(t.origin[0] + 100, t.origin[1], t.origin[2]), o)).toEqual([10, 0, -0].map((v, i) => (i === 2 ? 0 : v)));
    const dy = sub(t.toWorld(t.origin[0], t.origin[1] + 100, t.origin[2]), o);
    expect(dy[0]).toBeCloseTo(0); expect(dy[2]).toBeCloseTo(-10);
    const dz = sub(t.toWorld(t.origin[0], t.origin[1], t.origin[2] + 100), o);
    expect(dz[1]).toBeCloseTo(10);
  });

  it("is a proper rotation by default (does not mirror) and mirrors only when asked", () => {
    for (const mirror of [false, true]) {
      const t = createWorldTransform(g, { mirror });
      const o = t.toWorld(...t.origin);
      const ex = sub(t.toWorld(t.origin[0] + 1, t.origin[1], t.origin[2]), o);
      const ey = sub(t.toWorld(t.origin[0], t.origin[1] + 1, t.origin[2]), o);
      const ez = sub(t.toWorld(t.origin[0], t.origin[1], t.origin[2] + 1), o);
      const det = cross(ex, ey).reduce((s, v, i) => s + v * ez[i], 0);
      expect(Math.sign(det)).toBe(mirror ? -1 : 1);
    }
  });

  it.each([{}, { elevationScale: 2.5 }, { yawRadians: 0.7 }, { mirror: true }, { yawRadians: -1.2, elevationScale: 3, mirror: true }])("round-trips with %o", (opts) => {
    const t = createWorldTransform(g, opts);
    for (const p of [g.points[0], g.points[123], [21234.5, -4321.25, 87.5]] as const) {
      const w = t.toWorld(p[0], p[1], p[2]);
      const back = t.fromWorld(w[0], w[1], w[2]);
      expect(back[0]).toBeCloseTo(p[0], 3);
      expect(back[1]).toBeCloseTo(p[1], 3);
      expect(back[2]).toBeCloseTo(p[2], 3);
    }
  });

  it("track vertices and telemetry share one mapping (a car on a vertex lands exactly on the track)", () => {
    const t = createWorldTransform(g);
    const w = centerlineToWorld(g, t);
    const i = 217;
    const car = t.toWorld(g.points[i][0], g.points[i][1], g.points[i][2]);
    expect(car[0]).toBeCloseTo(w[i * 3], 4);
    expect(car[1]).toBeCloseTo(w[i * 3 + 1], 4);
    expect(car[2]).toBeCloseTo(w[i * 3 + 2], 4);
    const out = [0, 0, 0, 0];
    t.toWorldInto(out, 1, g.points[i][0], g.points[i][1], g.points[i][2]);
    expect(out[1]).toBeCloseTo(car[0], 6);
  });

  it("keeps source values untouched and rejects bad configuration", () => {
    const before = JSON.stringify(g.points);
    createWorldTransform(g);
    expect(JSON.stringify(g.points)).toBe(before);
    expect(() => createWorldTransform({ ...g, unitMeters: 0 })).toThrow();
    expect(() => createWorldTransform(g, { elevationScale: 0 })).toThrow();
  });

  it("only lets telemetry use the transform when coordinate systems agree", () => {
    const t = createWorldTransform(g);
    expect(sameCoordinateSystem(t, undefined)).toBe(true);
    expect(sameCoordinateSystem(t, "openf1-location")).toBe(true);
    expect(sameCoordinateSystem(t, "something-else")).toBe(false);
  });
});
