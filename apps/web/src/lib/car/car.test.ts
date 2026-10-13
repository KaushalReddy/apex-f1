import { Box3, BufferGeometry, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { DEMO_DRIVERS, DEMO_TEAMS } from "@/domain/demo";
import { FLOW_BODIES, buildStreamlines, flowField, insideBody, pointAtTime, velocityAt, vortices } from "./airflow";
import { CAR_TARGET, FILL, cameraPreset, carHull, maxNdc, zoomLimits } from "./camera";
import { COMPONENTS, PARTS, easeExplode, explodeOffsetInto, partExplode, partsOf, stepExplode } from "./components";
import { PART_ASSEMBLY, airfoilPoints, buildCarGeometry, disposeCarGeometry, linkTransform, loft, signedVolume, smoothSections, sweptWing, trailingEdge, type CarGeometry } from "./geometry";
import { illustrativePressure } from "./pressure";
import { CIRCUIT_CONTEXTS, SETUP_PROFILES, lowDragWings, setupProfile } from "./setup";
import { CAR_SPECS, REGULATION_SPECS, allSpecValues, specProblems } from "./specs";
import { CAR_CONFIGS, DRIVER_NUMBERS, carConfigFor, carDriversOf } from "./teams";

const bounds = (g: BufferGeometry) => {
  g.computeBoundingBox();
  return g.boundingBox!;
};

describe("loft", () => {
  it("is closed with outward-facing faces whichever direction the sections run", () => {
    const sections = [
      { x: 1, cy: 0, w: 1, h: 1 },
      { x: 0, cy: 0, w: 1, wb: 0.4, h: 1 },
      { x: -1, cy: 0, w: 0.5, h: 0.5 },
    ];
    expect(signedVolume(loft(sections))).toBeGreaterThan(0.5);
    expect(signedVolume(loft([...sections].reverse()))).toBeGreaterThan(0.5);
  });

  it("rejects sections that are not monotonic in x", () => {
    expect(() => loft([{ x: 0, cy: 0, w: 1, h: 1 }, { x: 1, cy: 0, w: 1, h: 1 }, { x: 0.5, cy: 0, w: 1, h: 1 }])).toThrow();
  });

  it("smoothing keeps every authored section, keeps x monotonic and adds in-between sections", () => {
    const authored = [
      { x: 2, cy: 0.2, w: 0.1, h: 0.1 },
      { x: 1, cy: 0.4, w: 0.4, wb: 0.2, h: 0.3 },
      { x: 0, cy: 0.45, w: 0.5, h: 0.4, p: 3 },
      { x: -1, cy: 0.3, w: 0.2, h: 0.2 },
    ];
    const s4 = smoothSections(authored, 4);
    expect(s4).toHaveLength((authored.length - 1) * 4 + 1);
    for (let i = 1; i < s4.length; i++) expect(s4[i].x).toBeLessThan(s4[i - 1].x);
    authored.forEach((a, i) => {
      expect(s4[i * 4].x).toBeCloseTo(a.x);
      expect(s4[i * 4].cy).toBeCloseTo(a.cy);
      expect(s4[i * 4].w).toBeCloseTo(a.w);
    });
    expect(signedVolume(loft(s4))).toBeGreaterThan(0);
  });

  it("swept wings are closed solids", () => {
    const g = sweptWing([-0.5, 0, 0.5].map((z) => ({ z, x: 0, y: 0.1, chord: 0.3, aoaDeg: 10 })));
    expect(signedVolume(g)).toBeGreaterThan(0);
  });
});

describe("wing helpers", () => {
  it("airfoil is closed-ish, has thickness, and is inverted (camber below the chord)", () => {
    const pts = airfoilPoints(1, 0.12, -0.06);
    const ys = pts.map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(0.1);
    const mid = pts.filter((p) => Math.abs(p[0] - 0.4) < 0.08).map((p) => p[1]);
    expect((Math.max(...mid) + Math.min(...mid)) / 2).toBeLessThan(0);
  });

  it("a positive angle of attack raises the trailing edge (downforce orientation)", () => {
    const te = trailingEdge([0, 0, 0], 1, 20);
    expect(te[0]).toBeLessThan(0);
    expect(te[1]).toBeGreaterThan(0);
  });

  it("linkTransform spans the two points", () => {
    const t = linkTransform([0, 0, 0], [0, 3, 4]);
    expect(t.length).toBeCloseTo(5);
    expect(t.position).toEqual([0, 1.5, 2]);
  });
});

const bboxOf = (g: CarGeometry, key: keyof CarGeometry["assemblies"]) => {
  const box = new Box3();
  for (const m of g.assemblies[key]) {
    const b = bounds(m.geometry).clone();
    if (m.position) b.translate(new Vector3(...m.position));
    box.union(b);
  }
  return box;
};

describe("car geometry", () => {
  const g = buildCarGeometry(setupProfile("balanced").wings);

  it("matches the reference proportions: about 5.0 m long, at most 1.9 m wide, 18-inch-scale wheels", () => {
    const box = new Box3();
    for (const k of ["chassis", "frontWing", "rearWing", "engineCover"] as const) box.union(bboxOf(g, k));
    const len = box.max.x - box.min.x;
    expect(len).toBeGreaterThan(4.85);
    expect(len).toBeLessThan(5.15);
    expect(bboxOf(g, "frontWing").max.z * 2).toBeLessThanOrEqual(1.9);
    expect(bboxOf(g, "frontWheel").max.y).toBeCloseTo(0.36, 2);
  });

  it("floor sits on the ground plane and the diffuser rises behind it", () => {
    const floor = bounds(g.assemblies.floor[0].geometry);
    const ramp = bounds(g.assemblies.diffuser[0].geometry);
    expect(floor.min.y).toBeCloseTo(0.06, 3);
    expect(ramp.max.y).toBeGreaterThan(0.3);
    expect(ramp.max.x).toBeLessThanOrEqual(floor.min.x + 1e-6);
  });

  it("the front wing stays ahead of the front tyres and the rear wing surfaces behind the rear axle", () => {
    const tyreFront = 1.7 + 0.36;
    expect(bboxOf(g, "frontWing").min.x).toBeGreaterThan(tyreFront);
    // Wing surfaces (main plane, flap, endplates) sit behind the rear axle; only the swan-neck support reaches forward to the gearbox.
    for (const i of [0, 1, 4]) expect(bounds(g.assemblies.rearWing[i].geometry).max.x).toBeLessThan(-1.7);
  });

  it("the front wing rises towards its endplates (curved, not a flat plank)", () => {
    const main = g.assemblies.frontWing[0].geometry;
    const p = main.getAttribute("position");
    let centreY = Infinity;
    let tipY = Infinity;
    for (let i = 0; i < p.count; i++) {
      if (Math.abs(p.getZ(i)) < 0.01) centreY = Math.min(centreY, p.getY(i));
      if (Math.abs(p.getZ(i)) > 0.92) tipY = Math.min(tipY, p.getY(i));
    }
    expect(tipY).toBeGreaterThan(centreY + 0.02);
  });

  it("every part maps to an assembly and every mesh carries illustrative pressure colours", () => {
    for (const key of Object.keys(PART_ASSEMBLY)) expect(g.assemblies[PART_ASSEMBLY[key].assembly].length).toBeGreaterThan(0);
    for (const meshes of Object.values(g.assemblies)) for (const m of meshes) expect(m.geometry.getAttribute("color")).toBeDefined();
  });

  it("setup profiles and the low-drag mode really change the drawn wing angle", () => {
    const hi = buildCarGeometry(setupProfile("high-downforce").wings);
    const lo = buildCarGeometry(setupProfile("low-drag").wings);
    const open = buildCarGeometry(lowDragWings(setupProfile("high-downforce").wings));
    const flapTop = (x: CarGeometry) => bounds(x.assemblies.rearWing[1].geometry).max.y;
    expect(flapTop(hi)).toBeGreaterThan(flapTop(lo));
    expect(flapTop(hi)).toBeGreaterThan(flapTop(open));
    [hi, lo, open].forEach(disposeCarGeometry);
  });

  it("disposes every distinct buffer it created", () => {
    expect(disposeCarGeometry(buildCarGeometry(setupProfile("balanced").wings))).toBeGreaterThan(40);
  });
});

describe("illustrative surface pressure", () => {
  it("follows the textbook picture: stagnation in front, suction under wings and the floor, recovery along the diffuser", () => {
    expect(illustrativePressure("body", [1, 0, 0], [2.9, 0.2, 0])).toBeGreaterThan(0.8);
    expect(illustrativePressure("wing", [0, -1, 0], [2.8, 0.05, 0])).toBeLessThan(-0.8);
    expect(illustrativePressure("wing", [0, 1, 0], [2.8, 0.1, 0])).toBeGreaterThan(0.3);
    expect(illustrativePressure("floor", [0, -1, 0], [0, 0.03, 0])).toBeLessThan(-0.8);
    const throat = illustrativePressure("diffuser", [0.4, -0.9, 0], [-1.5, 0.05, 0]);
    const exit = illustrativePressure("diffuser", [0.4, -0.9, 0], [-2.05, 0.33, 0]);
    expect(exit).toBeGreaterThan(throat);
  });
});

describe("components and exploded view", () => {
  it("every component has at least one explodable part and unique ids", () => {
    expect(new Set(COMPONENTS.map((c) => c.id)).size).toBe(COMPONENTS.length);
    expect(new Set(PARTS.map((p) => p.key)).size).toBe(PARTS.length);
    for (const c of COMPONENTS) expect(partsOf(c.id).length).toBeGreaterThan(0);
  });

  it("no part explodes below the ground plane (it would vanish under the ground disc)", () => {
    for (const p of PARTS) expect(p.explode[1], p.key).toBeGreaterThanOrEqual(0);
  });

  it("mirrored parts explode symmetrically", () => {
    expect(partExplode("wheel-fl")[2]).toBe(-partExplode("wheel-fr")[2]);
    expect(partExplode("sidepod-l")[2]).toBe(-partExplode("sidepod-r")[2]);
  });

  it("explode progress reaches the target, clamps, and returns exactly to assembled after repeated toggles", () => {
    let p = 0;
    for (let cycle = 0; cycle < 5; cycle++) {
      for (let i = 0; i < 100; i++) p = stepExplode(p, 1, 1 / 60, 0.6);
      expect(p).toBe(1);
      for (let i = 0; i < 100; i++) p = stepExplode(p, 0, 1 / 60, 0.6);
      expect(p).toBe(0);
    }
    expect(stepExplode(0.3, 1, 0.016, 0)).toBe(1); // reduced motion jumps
    expect(stepExplode(0.5, 0, 10, 0.6)).toBe(0);
  });

  it("offsets are zero when assembled and equal to the explode vector at full progress", () => {
    const v = new Vector3();
    explodeOffsetInto(v, [1, 2, 3], 0);
    expect(v.toArray()).toEqual([0, 0, 0]);
    explodeOffsetInto(v, [1, 2, 3], 1);
    expect(v.toArray()).toEqual([1, 2, 3]);
    expect(easeExplode(0.5)).toBeCloseTo(0.5);
  });
});

describe("camera", () => {
  const views = ["threeQuarter", "front", "rear", "side", "top"] as const;

  it("every preset shows the whole car (assembled and exploded) at phone, square and wide aspects, and fills the frame", () => {
    for (const exploded of [false, true])
      for (const aspect of [0.5, 1, 1.6, 2.4])
        for (const v of views) {
          const p = cameraPreset(v, aspect, exploded);
          const dir: [number, number, number] = [p.position[0] - CAR_TARGET[0], p.position[1] - CAR_TARGET[1], p.position[2] - CAR_TARGET[2]];
          const ndc = maxNdc(carHull(exploded), dir, p.distance, aspect);
          expect(ndc, `${v} ${aspect} ${exploded}`).toBeLessThanOrEqual(FILL + 1e-6);
          expect(ndc, `${v} ${aspect} ${exploded} is not too small`).toBeGreaterThan(FILL - 0.02);
        }
  });

  it("presets look from the expected side, and zoom-out reaches the exploded car", () => {
    expect(cameraPreset("front", 1.5).position[0]).toBeGreaterThan(CAR_TARGET[0]);
    expect(cameraPreset("rear", 1.5).position[0]).toBeLessThan(CAR_TARGET[0]);
    const top = cameraPreset("top", 1.5);
    expect(top.position[1]).toBeGreaterThan(4);
    // Not exactly overhead: the orbit azimuth must be well defined so the car cannot appear rolled.
    expect((top.position[2] - CAR_TARGET[2]) / top.distance).toBeGreaterThan(0.05);
    expect(cameraPreset("threeQuarter", 1.5, true).distance).toBeGreaterThan(cameraPreset("threeQuarter", 1.5).distance);
    for (const aspect of [0.5, 2.4]) expect(zoomLimits(aspect).max).toBeGreaterThan(cameraPreset("side", aspect, true).distance);
  });
});

describe("setup profiles", () => {
  it("orders wing angles and relative arrows from low drag to high downforce", () => {
    const [hi, bal, lo] = ["high-downforce", "balanced", "low-drag"].map((id) => setupProfile(id as never));
    expect(hi.wings.rearFlapDeg).toBeGreaterThan(bal.wings.rearFlapDeg);
    expect(bal.wings.rearFlapDeg).toBeGreaterThan(lo.wings.rearFlapDeg);
    expect(bal.relative).toEqual({ downforce: 1, drag: 1 });
    expect(SETUP_PROFILES).toHaveLength(3);
  });

  it("circuit contexts only reference circuits in the domain model", () => {
    expect(CIRCUIT_CONTEXTS.map((c) => c.circuitSlug)).toEqual(["monaco", "monza", "silverstone"]);
    for (const c of CIRCUIT_CONTEXTS) expect(() => setupProfile(c.illustrates)).not.toThrow();
  });
});

describe("team configuration", () => {
  it("every domain team has a car config: shared generic geometry, a complete colour-only livery", () => {
    expect(CAR_CONFIGS.map((c) => c.teamSlug)).toEqual(DEMO_TEAMS.map((t) => t.slug));
    for (const t of DEMO_TEAMS) {
      const c = carConfigFor(t.slug)!;
      expect(c.geometry.provenance).toBe("generic-procedural");
      for (const [zone, colour] of Object.entries(c.livery)) expect(colour, `${t.slug}.${zone}`).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(carConfigFor("nope")).toBeUndefined();
  });

  it("driver numbers only reference known drivers and attach to the right team", () => {
    const slugs = DEMO_DRIVERS.map((d) => d.slug);
    for (const k of Object.keys(DRIVER_NUMBERS)) expect(slugs).toContain(k);
    expect(carDriversOf("mclaren").map((d) => d.number)).toEqual([1, 81]);
  });
});

describe("specifications schema", () => {
  it("every value is either sourced or explicitly unavailable", () => {
    const problems = [...REGULATION_SPECS, ...CAR_SPECS.flatMap(allSpecValues)].flatMap(specProblems);
    expect(problems).toEqual([]);
    for (const s of CAR_SPECS) expect(s.geometry.provenance).toBe("generic-procedural");
  });

  it("flags invented values", () => {
    expect(specProblems({ label: "Drag", value: "0.9", status: "unavailable", season: 2026 })).not.toEqual([]);
    expect(specProblems({ label: "Drag", value: "0.9", status: "reported", season: 2026 })).not.toEqual([]);
  });

  it("covers every team", () => {
    expect(CAR_SPECS.map((s) => s.teamSlug).sort()).toEqual(DEMO_TEAMS.map((t) => t.slug).sort());
  });
});

describe("illustrative airflow", () => {
  const balanced = { downforce: 1, drag: 1, lowDragWings: false };
  const lines = buildStreamlines(balanced);

  it("is the oncoming air far from the car", () => {
    const v = velocityAt(flowField(balanced), [12, 3, 4]);
    expect(v[0]).toBeCloseTo(-1, 2);
    expect(Math.abs(v[1]) + Math.abs(v[2])).toBeLessThan(0.01);
  });

  it("streamlines never pass through the bodywork or below the ground", () => {
    for (const l of lines)
      for (let i = 0; i < l.points.length; i += 3) {
        const p: [number, number, number] = [l.points[i], l.points[i + 1], l.points[i + 2]];
        expect(p[1]).toBeGreaterThanOrEqual(0.011);
        if (p[0] > -2.3) expect(insideBody(p, 0.85)).toBe(false); // the wake wobble only applies behind the car
      }
    expect(FLOW_BODIES.length).toBeGreaterThan(5);
  });

  it("air under the floor travels faster than the oncoming air; the air ahead of the nose slows", () => {
    const under = lines.filter((l) => l.region === "under");
    const fastUnder = under.some((l) => {
      for (let i = 0; i < l.speed.length; i++) if (l.points[i * 3] < 0.5 && l.points[i * 3] > -1 && l.speed[i] > 1.3) return true;
      return false;
    });
    expect(fastUnder).toBe(true);
    const v = velocityAt(flowField(balanced), [2.72, 0.18, 0]);
    expect(Math.hypot(v[0], v[1], v[2])).toBeLessThan(1);
  });

  it("more downforce throws the wake higher behind the rear wing; the low-drag wing mode reduces it", () => {
    const up = (f: typeof balanced) => velocityAt(flowField(f), [-2.15, 0.95, 0])[1];
    expect(up({ ...balanced, downforce: 1.3 })).toBeGreaterThan(up(balanced));
    expect(up({ ...balanced, lowDragWings: true })).toBeLessThan(up(balanced));
    expect(vortices(balanced)).toHaveLength(4);
  });

  it("particle lookup by travel time wraps and stays on the line", () => {
    const l = lines[0];
    const out = new Float32Array(3);
    const total = l.time[l.time.length - 1];
    pointAtTime(l, 0, out, 0);
    expect(out[0]).toBeCloseTo(l.points[0], 4);
    pointAtTime(l, total * 1.25, out, 0);
    const wrapped = Array.from(out);
    pointAtTime(l, total * 0.25, out, 0);
    Array.from(out).forEach((v, i) => expect(v).toBeCloseTo(wrapped[i], 4));
  });
});
