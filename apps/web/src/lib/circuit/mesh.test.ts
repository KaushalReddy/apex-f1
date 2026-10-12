import { describe, expect, it } from "vitest";
import { buildChecker, buildEdgeLines, buildRoad, computeFrames } from "./mesh";
import { centerlineToWorld, createWorldTransform } from "./transform";
import { syntheticLoop } from "./testing/syntheticLoop";

function circle(n: number, r: number, y = 0): Float32Array {
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = r * Math.cos((2 * Math.PI * i) / n); a[i * 3 + 1] = y; a[i * 3 + 2] = r * Math.sin((2 * Math.PI * i) / n); }
  return a;
}

/** Signed XZ area*2 of triangle (positive = counter-clockwise seen from +Y... we assert the 3D normal's y instead). */
function triangleNormalY(p: Float32Array, i0: number, i1: number, i2: number): number {
  const e1 = [p[i1 * 3] - p[i0 * 3], p[i1 * 3 + 2] - p[i0 * 3 + 2]];
  const e2 = [p[i2 * 3] - p[i0 * 3], p[i2 * 3 + 2] - p[i0 * 3 + 2]];
  return e1[1] * e2[0] - e1[0] * e2[1];
}

const allUp = (positions: Float32Array, indices: Uint32Array) => {
  for (let t = 0; t < indices.length; t += 3) if (!(triangleNormalY(positions, indices[t], indices[t + 1], indices[t + 2]) > 0)) return false;
  return true;
};

describe("road frames", () => {
  it("has unit tangents and left normals perpendicular to them", () => {
    const f = computeFrames(circle(120, 400), true, 20);
    for (let i = 0; i < f.n; i++) {
      expect(Math.hypot(f.tangent[i * 2], f.tangent[i * 2 + 1])).toBeCloseTo(1, 5);
      expect(f.tangent[i * 2] * f.side[i * 2] + f.tangent[i * 2 + 1] * f.side[i * 2 + 1]).toBeCloseTo(0, 5);
    }
  });

  it("gives +Y normals on flat ground and slope-following normals on a gradient", () => {
    const flat = computeFrames(circle(60, 300), true, 20);
    for (let i = 0; i < 60; i++) expect(flat.normals[i * 3 + 1]).toBeCloseTo(1, 5);
    // straight road climbing 10% along +X: normal must tilt back towards -X
    const ramp = new Float32Array(40 * 3);
    for (let i = 0; i < 40; i++) { ramp[i * 3] = i * 2; ramp[i * 3 + 1] = i * 0.2; }
    const f = computeFrames(ramp, false, 12);
    expect(f.normals[20 * 3]).toBeLessThan(-0.05);
    expect(f.normals[20 * 3 + 1]).toBeGreaterThan(0.9);
    expect(Math.hypot(f.normals[60], f.normals[61], f.normals[62])).toBeCloseTo(1, 5);
  });

  it("rejects degenerate input", () => {
    expect(() => computeFrames(new Float32Array(3), true, 10)).toThrow();
    expect(() => computeFrames(circle(10, 100), true, 0)).toThrow();
  });
});

describe("road mesh: width and continuity", () => {
  it("is exactly the requested width across a gentle curve and spans radius +/- width/2", () => {
    const R = 500, W = 18;
    const r = buildRoad(circle(240, R), true, W);
    for (let i = 0; i < 240; i++) {
      const o = i * 6;
      expect(Math.hypot(r.positions[o] - r.positions[o + 3], r.positions[o + 2] - r.positions[o + 5])).toBeCloseTo(W, 3);
      const radii = [Math.hypot(r.positions[o], r.positions[o + 2]), Math.hypot(r.positions[o + 3], r.positions[o + 5])].sort((a, b) => a - b);
      expect(radii[0]).toBeCloseTo(R - W / 2, 1);
      expect(radii[1]).toBeCloseTo(R + W / 2, 1);
    }
  });

  it("is a continuous strip: n*6 indices when closed (seam included), (n-1)*6 when open, every vertex used, all in range", () => {
    const closed = buildRoad(circle(100, 300), true, 12);
    const open = buildRoad(circle(100, 300), false, 12);
    expect(closed.indices.length).toBe(100 * 6);
    expect(open.indices.length).toBe(99 * 6);
    expect(Math.max(...closed.indices)).toBe(199);
    expect(new Set(closed.indices).size).toBe(200);
    // seam: last quad connects vertex pair 99 to pair 0
    const lastQuad = [...closed.indices.slice(99 * 6, 100 * 6)];
    expect(lastQuad).toContain(0);
    expect(lastQuad).toContain(198);
    // neighbouring quads share their joining vertex pair (no gaps)
    for (let i = 0; i < 99; i++) {
      const a = new Set(closed.indices.slice(i * 6, i * 6 + 6));
      const b = new Set(closed.indices.slice((i + 1) * 6, (i + 1) * 6 + 6));
      expect([...a].filter((v) => b.has(v)).length).toBe(2);
    }
  });

  it("winds every road triangle so its normal points up", () => {
    const r = buildRoad(circle(90, 400), true, 14);
    expect(allUp(r.positions, r.indices)).toBe(true);
  });

  it("does not fold on a tight hairpin: the inside edge is narrowed instead of crossing itself", () => {
    const r = buildRoad(circle(240, 6), true, 20); // 20 m wide road around a 6 m radius corner
    expect(allUp(r.positions, r.indices)).toBe(true);
    let minInner = Infinity, maxOuter = 0;
    for (let i = 0; i < 240; i++) {
      const a = Math.hypot(r.positions[i * 6], r.positions[i * 6 + 2]);
      const b = Math.hypot(r.positions[i * 6 + 3], r.positions[i * 6 + 5]);
      minInner = Math.min(minInner, a, b);
      maxOuter = Math.max(maxOuter, a, b);
    }
    expect(minInner).toBeGreaterThan(0.3); // inside stays on the near side of the corner centre
    expect(maxOuter).toBeCloseTo(16, 1);   // outside keeps the full half-width
  });

  it("survives duplicate points and a self-crossing (figure-eight) centerline", () => {
    const dup = circle(40, 100);
    dup.set(dup.slice(0, 3), 3);
    expect([...buildRoad(dup, true, 8).positions].every(Number.isFinite)).toBe(true);
    const g = syntheticLoop({ figureEight: true, n: 300 });
    const w = centerlineToWorld(g, createWorldTransform(g));
    const r = buildRoad(w, true, 14);
    expect([...r.positions, ...r.normals].every(Number.isFinite)).toBe(true);
  });
});

describe("edge lines", () => {
  it("run along both road edges at the available lateral room, lifted clear of the road, in one indexed set", () => {
    const r = buildRoad(circle(100, 500), true, 20);
    const e = buildEdgeLines(r.frames, 0.5);
    expect(e.positions.length).toBe(2 * 100 * 3);
    expect(e.indices.length).toBe(100 * 4);                 // 100 left + 100 right segments, seam included
    for (let i = 0; i < 100; i++) {
      expect(Math.hypot(e.positions[i * 3], e.positions[i * 3 + 2])).toBeCloseTo(490, 1);              // left edge (outside of a CCW circle... one side)
      expect(Math.hypot(e.positions[(100 + i) * 3], e.positions[(100 + i) * 3 + 2])).toBeCloseTo(510, 1); // right edge
      expect(e.positions[i * 3 + 1]).toBeCloseTo(0.5, 6);
    }
    expect(Math.max(...e.indices)).toBe(199);
    expect(buildEdgeLines(buildRoad(circle(50, 300), false, 10).frames).indices.length).toBe(49 * 4);
  });

  it("follow the narrowed inside edge at a tight corner instead of crossing the road", () => {
    const r = buildRoad(circle(240, 6), true, 20);
    const e = buildEdgeLines(r.frames);
    const inner = Math.min(...Array.from({ length: 240 }, (_, i) => Math.hypot(e.positions[i * 3], e.positions[i * 3 + 2])));
    expect(inner).toBeGreaterThan(0.3);
  });
});

describe("chequered start/finish line", () => {
  const frames = computeFrames(circle(200, 600), true, 20);

  it("has rows*cols squares, alternating shades, all facing up", () => {
    const c = buildChecker(frames, 0, 2, 6);
    expect(c.indices.length).toBe(12 * 6);
    expect(c.positions.length).toBe(12 * 4 * 3);
    expect(allUp(c.positions, c.indices)).toBe(true);
    const quadShade = Array.from({ length: 12 }, (_, q) => c.shade[q * 4]);
    expect(new Set(quadShade)).toEqual(new Set([0, 1]));
    expect(quadShade.filter((s) => s === 1).length).toBe(6);
  });

  it("is centred on the vertex, spans exactly the road width there, and runs along the direction of travel", () => {
    const i = 37;
    const depth = 10;
    const c = buildChecker(frames, i, 2, 6, 0, depth);
    let cx = 0, cz = 0, minAcross = Infinity, maxAcross = -Infinity, minAlong = Infinity, maxAlong = -Infinity;
    const n = c.positions.length / 3;
    for (let v = 0; v < n; v++) {
      const dx = c.positions[v * 3] - frames.pos[i * 3], dz = c.positions[v * 3 + 2] - frames.pos[i * 3 + 2];
      cx += c.positions[v * 3] / n; cz += c.positions[v * 3 + 2] / n;
      const across = dx * frames.side[i * 2] + dz * frames.side[i * 2 + 1];
      const along = dx * frames.tangent[i * 2] + dz * frames.tangent[i * 2 + 1];
      minAcross = Math.min(minAcross, across); maxAcross = Math.max(maxAcross, across);
      minAlong = Math.min(minAlong, along); maxAlong = Math.max(maxAlong, along);
    }
    expect(Math.hypot(cx - frames.pos[i * 3], cz - frames.pos[i * 3 + 2])).toBeLessThan(0.05);
    expect(maxAcross - minAcross).toBeCloseTo(frames.leftMax[i] + frames.rightMax[i], 3);
    expect(maxAlong).toBeCloseTo(-minAlong, 3);
    expect(maxAlong - minAlong).toBeCloseTo(depth, 3);
  });

  it("is placed with the SAME transform as the track (consistency for Phase 4)", () => {
    const g = syntheticLoop({ n: 300 });
    const t = createWorldTransform(g);
    const w = centerlineToWorld(g, t);
    const f = computeFrames(w, true, 20);
    const c = buildChecker(f, 0, 2, 6);
    const expected = t.toWorld(g.points[0][0], g.points[0][1], g.points[0][2]);
    let cx = 0, cz = 0;
    const n = c.positions.length / 3;
    for (let v = 0; v < n; v++) { cx += c.positions[v * 3] / n; cz += c.positions[v * 3 + 2] / n; }
    expect(cx).toBeCloseTo(expected[0], 1);
    expect(cz).toBeCloseTo(expected[2], 1);
  });

  it("rejects an out-of-range vertex", () => {
    expect(() => buildChecker(frames, 200)).toThrow();
    expect(() => buildChecker(frames, -1)).toThrow();
  });
});
