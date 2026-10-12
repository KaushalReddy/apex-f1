import { PerspectiveCamera, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { dynamicClip, fitDistance, frameCircuit, presetFor, shouldApplyFraming, worldBounds, type CameraPreset } from "./camera";

function shape(kind: "ellipse" | "narrow" | "rotated" | "irregular" | "huge", n = 400): Float32Array {
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / n;
    let x = 0, z = 0;
    if (kind === "ellipse") { x = 900 * Math.cos(t); z = 600 * Math.sin(t); }
    if (kind === "narrow") { x = 1500 * Math.cos(t); z = 120 * Math.sin(t); }
    if (kind === "rotated") { const u = 1500 * Math.cos(t), v = 150 * Math.sin(t), r = (37 * Math.PI) / 180; x = u * Math.cos(r) - v * Math.sin(r); z = u * Math.sin(r) + v * Math.cos(r); }
    if (kind === "irregular") { const r = 700 + 220 * Math.sin(3 * t) + 120 * Math.cos(5 * t + 1); x = r * Math.cos(t) * 1.4 + 90 * Math.sin(2 * t); z = r * Math.sin(t) * 0.7; }
    if (kind === "huge") { x = 40000 * Math.cos(t); z = 25000 * Math.sin(t); }
    a[i * 3] = x; a[i * 3 + 1] = 20 * Math.sin(2 * t); a[i * 3 + 2] = z;
  }
  return a;
}

function camera(p: CameraPreset, aspect: number, clip: { near: number; far: number }): PerspectiveCamera {
  const c = new PerspectiveCamera(p.fov, aspect, clip.near, clip.far);
  c.position.set(...p.position);
  c.lookAt(...p.target);
  c.updateProjectionMatrix();
  c.updateMatrixWorld(true);
  return c;
}

function ndcExtent(xyz: Float32Array, c: PerspectiveCamera, margin = 0) {
  let maxX = 0, maxY = 0, minZ = Infinity, maxZ = -Infinity;
  const v = new Vector3();
  for (let i = 0; i < xyz.length; i += 3) {
    // include the road's half-width margin in the 4 horizontal directions
    for (const [mx, mz] of margin ? [[margin, 0], [-margin, 0], [0, margin], [0, -margin]] : [[0, 0]]) {
      v.set(xyz[i] + mx, xyz[i + 1], xyz[i + 2] + mz).project(c);
      maxX = Math.max(maxX, Math.abs(v.x)); maxY = Math.max(maxY, Math.abs(v.y));
      minZ = Math.min(minZ, v.z); maxZ = Math.max(maxZ, v.z);
    }
  }
  return { maxX, maxY, minZ, maxZ };
}

const SHAPES = ["ellipse", "narrow", "rotated", "irregular", "huge"] as const;
const ASPECTS = [0.5, 1, 1.6, 2.4, 3.5];

describe("framing fits the whole circuit for any shape and viewport aspect", () => {
  for (const kind of SHAPES) {
    for (const aspect of ASPECTS) {
      it(`${kind} at aspect ${aspect}: overview and top-down keep every point (plus road margin) in view and use the canvas`, () => {
        const xyz = shape(kind);
        const margin = worldBounds(xyz).extent * 0.006;
        const f = frameCircuit(xyz, aspect, { marginMeters: margin });
        for (const name of ["overview", "topDown"] as const) {
          const p = presetFor(f, name);
          const clip = dynamicClip(p.distance, f.extent);
          const e = ndcExtent(xyz, camera(p, aspect, clip), margin);
          expect(e.maxX, `${name} x`).toBeLessThanOrEqual(1);
          expect(e.maxY, `${name} y`).toBeLessThanOrEqual(1);
          // not lost in a corner: the limiting dimension fills most of the frame (padding is 8%)
          expect(Math.max(e.maxX, e.maxY), `${name} fill`).toBeGreaterThan(0.85);
          expect(e.minZ, `${name} not clipped by near`).toBeGreaterThanOrEqual(-1);
          expect(e.maxZ, `${name} not clipped by far`).toBeLessThanOrEqual(1);
        }
      });
    }
  }

  it("fits exactly: shrinking the distance slightly pushes a point out of the frame", () => {
    const xyz = shape("irregular");
    const aspect = 1.6;
    const f = frameCircuit(xyz, aspect, { padding: 0 });
    const p = f.overview;
    const closer: CameraPreset = { ...p, distance: p.distance * 0.97, position: [p.target[0], p.target[1] + (p.position[1] - p.target[1]) * 0.97, p.target[2] + (p.position[2] - p.target[2]) * 0.97] };
    const tight = ndcExtent(xyz, camera(p, aspect, dynamicClip(p.distance, f.extent)));
    const loose = ndcExtent(xyz, camera(closer, aspect, dynamicClip(closer.distance, f.extent)));
    expect(Math.max(tight.maxX, tight.maxY)).toBeCloseTo(1, 2);
    expect(Math.max(loose.maxX, loose.maxY)).toBeGreaterThan(1);
  });
});

describe("presets", () => {
  const xyz = shape("rotated");
  const f = frameCircuit(xyz, 1.6, { marginMeters: 10 });

  it("overview looks from +Z at an angle with map north up; top-down is almost vertical with a narrower lens", () => {
    const o = f.overview, t = f.topDown;
    expect(o.position[2]).toBeGreaterThan(o.target[2]);
    expect(o.position[1]).toBeGreaterThan(o.target[1]);
    const dir = new Vector3(t.target[0] - t.position[0], t.target[1] - t.position[1], t.target[2] - t.position[2]).normalize();
    expect((Math.acos(-dir.y) * 180) / Math.PI).toBeLessThan(1.5);
    expect(t.fov).toBeLessThan(o.fov);
  });

  it("Reset view is exactly the overview preset, independent of what happened to the camera afterwards", () => {
    expect(presetFor(f, "overview")).toBe(f.overview);
    expect(presetFor(f, "topDown")).toBe(f.topDown);
    const again = frameCircuit(xyz, 1.6, { marginMeters: 10 });
    expect(again.overview).toEqual(f.overview);
  });

  it("derives zoom limits from the circuit and keeps the preset between them", () => {
    expect(f.minDistance).toBeLessThan(f.overview.distance);
    expect(f.maxDistance).toBeGreaterThan(f.overview.distance);
    expect(f.maxDistance).toBeGreaterThan(f.topDown.distance);
  });

  it("is not tied to one circuit: scaling the circuit scales the camera distance proportionally", () => {
    const small = frameCircuit(shape("ellipse"), 1.6);
    const big = new Float32Array(shape("ellipse")).map((v) => v * 10);
    expect(frameCircuit(big, 1.6).overview.distance / small.overview.distance).toBeCloseTo(10, 3);
  });

  it("copes with NaN / extreme aspect and an empty circuit without throwing", () => {
    expect(() => frameCircuit(xyz, Number.NaN)).not.toThrow();
    expect(() => frameCircuit(xyz, 0)).not.toThrow();
    expect(Number.isFinite(frameCircuit(xyz, 1e9).overview.distance)).toBe(true);
    expect(Number.isFinite(fitDistance(new Float32Array(0), [0, 0, 0], 50, 40, 1.6))).toBe(true);
  });
});

describe("auto-framing policy and clip planes", () => {
  it("follows resizes until the user touches the camera; a preset choice always applies", () => {
    expect(shouldApplyFraming({ interacted: false, presetChanged: false })).toBe(true);
    expect(shouldApplyFraming({ interacted: true, presetChanged: false })).toBe(false);
    expect(shouldApplyFraming({ interacted: true, presetChanged: true })).toBe(true);
    expect(shouldApplyFraming({ interacted: false, presetChanged: true })).toBe(true);
  });

  it("keeps near/far proportional to distance (precision) but never clips close-up zoom", () => {
    expect(dynamicClip(3000, 1700).near).toBeCloseTo(30, 5);
    expect(dynamicClip(20, 1700).near).toBeCloseTo(0.2, 5);
    expect(dynamicClip(3000, 1700).far).toBeGreaterThan(3000 * 3);
    expect(dynamicClip(0, 0).near).toBeGreaterThan(0);
  });
});
