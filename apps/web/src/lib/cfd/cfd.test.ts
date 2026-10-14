import { describe, expect, it } from "vitest";
import { buildCarGeometry } from "@/lib/car/geometry";
import { presetSetup } from "@/lib/car/lab";
import {
  DEFAULT_WING,
  ISA,
  SECTION_Z,
  canTransition,
  coefficient,
  compareResults,
  decodeField,
  downforceFromLift,
  dynamicPressure,
  force,
  incompatibilities,
  pressureCoefficient,
  rearWingSection,
  reynolds,
  richardson,
  toCar,
  toSolver,
  trustLevel,
  validateRequest,
  type CfdSummary,
  type WingRequest,
} from "./model";
import { buildCase, cacheKey } from "./server";

/** These tests use known inputs and synthetic results. None of them runs the solver; see tools/cfd/tests for that. */
const wing = (over: Partial<WingRequest> = {}): WingRequest => ({ ...DEFAULT_WING, wings: { rearMainDeg: 9, rearFlapDeg: 30 }, ...over });

describe("request validation (SI units)", () => {
  it("accepts the defaults (50 m/s, ISA sea level) and rejects invalid physics", () => {
    expect(validateRequest(wing())).toEqual([]);
    expect(validateRequest(wing({ speedMps: -5 }))).toContain("Speed must be between 5 and 100 m/s.");
    expect(validateRequest(wing({ densityKgM3: 0 }))).toHaveLength(1);
    expect(validateRequest(wing({ speedMps: Number.NaN }))).toHaveLength(1);
    expect(validateRequest(wing({ viscosityPaS: 1.8 }))).toHaveLength(1); // a unit mistake (centipoise-like) is rejected, not converted
    expect(validateRequest(wing({ speedMps: 100, temperatureK: 250 }))).toContain("Mach number above 0.3: the incompressible model does not apply.");
    expect(validateRequest(wing({ wings: { rearMainDeg: 30, rearFlapDeg: 30 } }))).toHaveLength(1);
    expect(validateRequest({ kind: "benchmark-naca0012", aoaDeg: 10, meshLevel: "225x65" })).toEqual([]);
    expect(validateRequest({ kind: "benchmark-naca0012", aoaDeg: 40, meshLevel: "225x65" })).toHaveLength(1);
  });
});

describe("wing section geometry", () => {
  it("is the drawn rear wing: at drawing resolution its points are the 3D mesh's vertices at z = 0.44 m", () => {
    const w = presetSetup("balanced");
    const s = rearWingSection(w, 12);
    const g = buildCarGeometry(w);
    // Mesh positions are float32 (z = 0.44 is stored as 0.4399999976), so stations and points are matched within float32 precision.
    const drawn = (index: number) => {
      const pos = g.assemblies.rearWing[index].geometry.getAttribute("position");
      const out: Array<[number, number]> = [];
      for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) - SECTION_Z) < 1e-6) out.push([pos.getX(i), pos.getY(i)]);
      return out;
    };
    s.elements.forEach((e, i) => {
      const mesh = drawn(i); // rearWing assembly: [main plane, flap, ...]
      const ours = e.points.map((p) => toCar(s.transform, p));
      expect(ours).toHaveLength(mesh.length);
      for (const [x, y] of ours) expect(mesh.some(([mx, my]) => Math.abs(mx - x) < 2e-6 && Math.abs(my - y) < 2e-6), `${e.name} ${x},${y}`).toBe(true);
    });
  });

  it("uses solver coordinates (flow along +x from the main-plane leading edge), counter-clockwise outlines and a 0.56 m reference chord", () => {
    const s = rearWingSection({ rearMainDeg: 9, rearFlapDeg: 30 });
    expect(s.referenceLengthM).toBeCloseTo(0.56, 12);
    const area = (pts: Array<[number, number]>) => pts.reduce((a, [x, y], i) => a + x * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * y, 0) / 2;
    for (const e of s.elements) expect(area(e.points)).toBeGreaterThan(0);
    const xs = s.elements[0].points.map((p) => p[0]);
    expect(Math.min(...xs)).toBeCloseTo(0, 3); // main-plane leading edge at the origin
    expect(Math.max(...s.elements[1].points.map((p) => p[0]))).toBeGreaterThan(Math.max(...xs)); // the flap is downstream
    expect(toCar(s.transform, toSolver(s.transform, [-2.1, 0.9]))).toEqual([-2.1, 0.9]);
  });

  it("changes with the wing angles (a steeper flap is a different case)", () => {
    const a = rearWingSection({ rearMainDeg: 9, rearFlapDeg: 30 });
    const b = rearWingSection({ rearMainDeg: 9, rearFlapDeg: 44 });
    expect(a.elements[0].points).toEqual(b.elements[0].points);
    expect(a.elements[1].points).not.toEqual(b.elements[1].points);
  });
});

describe("physical quantities with known values", () => {
  it("dynamic pressure, Reynolds number, pressure coefficient", () => {
    expect(dynamicPressure(1.225, 50)).toBeCloseTo(1531.25, 9);
    expect(reynolds(1.225, 50, 0.56, 1.7894e-5)).toBeCloseTo(1916843.63, 1); // 1.225 x 50 x 0.56 / 1.7894e-5
    expect(pressureCoefficient(101325 - 3062.5, 101325, 1.225, 50)).toBeCloseTo(-2, 12);
  });

  it("coefficients and forces invert each other; downforce is minus SU2's lift", () => {
    const lift = force(-2.6, ISA.densityKgM3, 50, 0.56); // per metre of span
    expect(lift).toBeCloseTo(-2.6 * 1531.25 * 0.56, 9);
    expect(coefficient(lift, ISA.densityKgM3, 50, 0.56)).toBeCloseTo(-2.6, 12);
    expect(downforceFromLift(lift)).toBeGreaterThan(0);
  });
});

describe("cache keys", () => {
  it("are equal for identical physics and differ when any physical input changes; labels and ids do not count", () => {
    const a = buildCase(wing({ label: "first" }));
    const b = buildCase(wing({ label: "second" }));
    expect(a.id).not.toBe(b.id);
    expect(a.cacheKey).toBe(b.cacheKey);
    for (const change of [{ speedMps: 51 }, { densityKgM3: 1.2 }, { meshLevel: "medium" as const }, { wings: { rearMainDeg: 9, rearFlapDeg: 31 } }])
      expect(buildCase(wing(change)).cacheKey, JSON.stringify(change)).not.toBe(a.cacheKey);
    const physics = Object.fromEntries(Object.entries(a).filter(([k]) => !["id", "cacheKey", "label"].includes(k)).reverse());
    expect(cacheKey(physics as Parameters<typeof cacheKey>[0])).toBe(a.cacheKey); // property order does not matter
  });

  it("refuses to build a case from an invalid request", () => {
    expect(() => buildCase(wing({ speedMps: 0 }))).toThrow(/Speed/);
  });
});

describe("job states", () => {
  it("move forward one stage at a time, can fail or be cancelled before finishing, and never leave a terminal state", () => {
    expect(canTransition("queued", "preparing-geometry")).toBe(true);
    expect(canTransition("queued", "solving")).toBe(false);
    expect(canTransition("solving", "post-processing")).toBe(true);
    expect(canTransition("solving", "completed")).toBe(false);
    expect(canTransition("meshing", "failed")).toBe(true);
    expect(canTransition("solving", "cancelled")).toBe(true);
    expect(canTransition("completed", "failed")).toBe(false);
    expect(canTransition("failed", "queued")).toBe(false);
  });
});

const summary = (over: Partial<CfdSummary> = {}): CfdSummary => ({
  caseId: "x",
  kind: "rear-wing-section",
  createdAt: "",
  conditions: { speedMps: 50, densityKgM3: 1.225, temperatureK: 288.15, viscosityPaS: 1.7894e-5 },
  derived: { reynolds: 1.9e6, mach: 0.15 },
  coefficients: { CL: -2.6, CD: 0.16 },
  forcesPerSpan: { liftNPerM: -2229.5, dragNPerM: 137.2, downforceNPerM: 2229.5 },
  status: { solverCompleted: true, converged: true, validated: false },
  meshLevel: "coarse",
  solverVersion: "8.5.0",
  geometry: {},
  ...over,
});

describe("comparisons", () => {
  it("compare only converged results with the same conditions, mesh level and solver", () => {
    const a = summary();
    const b = summary({ coefficients: { CL: -3.1, CD: 0.22 }, forcesPerSpan: { liftNPerM: -2658.3, dragNPerM: 188.7, downforceNPerM: 2658.3 } });
    const c = compareResults(a, b);
    expect(c.comparable).toBe(true);
    if (c.comparable) {
      expect(c.dCL).toBeCloseTo(-0.5, 12);
      expect(c.dDownforceNPerM).toBeCloseTo(428.8, 9);
    }
    expect(incompatibilities(a, summary({ conditions: { ...a.conditions, speedMps: 60 } }))).toEqual(["different speedMps"]);
    expect(incompatibilities(a, summary({ meshLevel: "medium" }))).toEqual(["different mesh levels"]);
    expect(incompatibilities(a, summary({ solverVersion: "8.4.0" }))).toEqual(["different solver versions"]);
    expect(incompatibilities(a, summary({ pipeline: "apexcfd-2" }))).toEqual(["different pipeline versions"]);
    expect(incompatibilities(a, summary({ status: { solverCompleted: true, converged: false, validated: false } }))).toEqual(["one result did not converge"]);
  });

  it("names what a result may claim", () => {
    expect(trustLevel({ status: { solverCompleted: true, converged: false, validated: false }, verification: null }).label).toBe("Completed, not converged");
    expect(trustLevel({ status: { solverCompleted: true, converged: true, validated: false }, verification: null }).label).toBe("Converged · not validated");
  });
});

describe("grid study and field decoding", () => {
  it("Richardson extrapolation recovers a known second-order error", () => {
    // f(h) = 1.09 + 0.4 h^2 with h = 4, 2, 1 (coarse -> fine)
    const r = richardson(1.09 + 0.4 * 16, 1.09 + 0.4 * 4, 1.09 + 0.4);
    expect(r!.order).toBeCloseTo(2, 12);
    expect(r!.extrapolated).toBeCloseTo(1.09, 12);
    expect(richardson(1, 0.9, 0.95)).toBeNull(); // oscillatory: not defined
  });

  it("decodes the runner's int16 encoding, with no-flow cells as NaN", () => {
    // [1234, -500, -32768] little-endian -> d2 04 0c fe 00 80
    const v = decodeField(Buffer.from([0xd2, 0x04, 0x0c, 0xfe, 0x00, 0x80]).toString("base64"), 1000);
    expect(v[0]).toBeCloseTo(1.234, 6);
    expect(v[1]).toBeCloseTo(-0.5, 6);
    expect(Number.isNaN(v[2])).toBe(true);
  });
});

describe("computed-field utilities", async () => {
  const { sample, streamlines } = await import("./field");
  // A synthetic uniform field (u = 1, v = 0.1) with a no-flow block: tests the tracing, not any solver output.
  const nx = 41, ny = 21;
  const u = new Float32Array(nx * ny).fill(1);
  const v = new Float32Array(nx * ny).fill(0.1);
  for (let j = 8; j <= 12; j++) for (let i = 20; i <= 24; i++) u[j * nx + i] = v[j * nx + i] = Number.NaN;
  const f = { nx, ny, window: [0, 4, -1, 1] as [number, number, number, number], u, v, speed: u, cp: u };

  it("samples bilinearly and returns NaN outside the window or in a body", () => {
    expect(sample(f, f.u, 1.05, 0.33)).toBeCloseTo(1, 6);
    expect(Number.isNaN(sample(f, f.u, 5, 0))).toBe(true);
    expect(Number.isNaN(sample(f, f.u, 2.2, 0))).toBe(true);
  });

  it("follows the flow direction and stops at a body", () => {
    const lines = streamlines(f, 10);
    const free = lines.find((l) => l[0][1] < -0.8)!;
    const [xa, ya] = free[0];
    const [xb, yb] = free[free.length - 1];
    expect((yb - ya) / (xb - xa)).toBeCloseTo(0.1, 2);
    const blocked = lines.find((l) => Math.abs(l[0][1] + 0.1) < 0.1)!;
    expect(Math.max(...blocked.map((p) => p[0]))).toBeLessThan(2.1); // stopped at the block's upstream face (x = 2)
  });
});
