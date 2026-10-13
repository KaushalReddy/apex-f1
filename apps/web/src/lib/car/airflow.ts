import { Color } from "three";
import type { Vec3 } from "./types";

/**
 * ILLUSTRATIVE airflow for the educational aerodynamics view. Streamlines are traced through a hand-built velocity field: textbook
 * potential flow around ellipsoids standing in for the bodywork and wheels (doublets, mirrored in the ground plane), plus labelled
 * "effects" that show what each aerodynamic device is known to do (upwash behind wings, faster flow under the floor, a slower wake).
 * It is NOT a fluid simulation: no viscosity, no real geometry, no measured values. Speeds are relative to the oncoming air (1) and
 * only drive colour and particle pace. A verified CFD export could replace `buildStreamlines` with sampled streamlines of the same shape.
 */
export type FlowRegion = "over" | "side" | "under" | "vortex";

export interface FlowSettings {
  /** Relative strength of downforce-producing effects (balanced = 1). */
  downforce: number;
  /** Relative drag: strength of the slow wake (balanced = 1). */
  drag: number;
  /** Conceptual low-drag wing mode: flattened wing flaps, weaker wing effects. */
  lowDragWings: boolean;
}

interface Body {
  c: Vec3;
  s: Vec3;
}
interface Effect {
  c: Vec3;
  r: Vec3;
  v: Vec3;
}

export interface FlowField {
  bodies: Body[];
  effects: Effect[];
}

const mirrorZ = (v: Vec3): Vec3 => [v[0], v[1], -v[2]];
const both = (b: Body): Body[] => [b, { c: mirrorZ(b.c), s: b.s }];
const bothFx = (e: Effect): Effect[] => [e, { c: mirrorZ(e.c), r: e.r, v: mirrorZ(e.v) }];

/** Ellipsoids standing in for the car (car space, metres): nose, chassis, engine cover, sidepods, wheels. */
export const FLOW_BODIES: readonly Body[] = [
  { c: [2.0, 0.29, 0], s: [0.65, 0.12, 0.14] },
  { c: [0.9, 0.45, 0], s: [0.9, 0.22, 0.29] },
  { c: [-0.7, 0.66, 0], s: [1.15, 0.34, 0.22] },
  ...both({ c: [-0.2, 0.42, 0.42], s: [0.9, 0.17, 0.2] }),
  ...both({ c: [1.7, 0.36, 0.8], s: [0.37, 0.37, 0.16] }),
  ...both({ c: [-1.7, 0.36, 0.78], s: [0.37, 0.37, 0.19] }),
];

export function flowField(f: FlowSettings): FlowField {
  const k = f.downforce;
  const wing = f.lowDragWings ? 0.4 : 1;
  return {
    bodies: [...FLOW_BODIES],
    effects: [
      // Front wing: turns air up and outwards (outwash) around the front tyres.
      ...bothFx({ c: [2.05, 0.25, 0.55], r: [0.45, 0.18, 0.35], v: [0, 0.35 * k * wing, 0.35] }),
      // Air under the front wing and the floor speeds up (lower pressure).
      { c: [2.45, 0.04, 0], r: [0.35, 0.05, 0.7], v: [-0.5 * k * wing, 0, 0] },
      { c: [-0.1, 0.03, 0], r: [1.4, 0.04, 0.6], v: [-0.7 * k, 0, 0] },
      // Diffuser expands the underfloor flow upwards; rear wing throws air up behind the car.
      { c: [-2.15, 0.25, 0], r: [0.45, 0.2, 0.5], v: [-0.2, 0.55 * k, 0] },
      { c: [-2.15, 0.95, 0], r: [0.4, 0.3, 0.5], v: [0, 0.9 * k * wing, 0] },
      { c: [-2.85, 1.0, 0], r: [0.7, 0.5, 0.7], v: [0, 0.35 * k * wing, 0] },
      // Sidepod downwash towards the floor's rear.
      ...bothFx({ c: [-1.1, 0.42, 0.38], r: [0.45, 0.15, 0.2], v: [0, -0.35, -0.1] }),
      // Slow wake behind the car: the visible cost of drag.
      { c: [-2.75, 0.5, 0], r: [1.0, 0.45, 0.7], v: [0.35 * f.drag, 0, 0] },
    ],
  };
}

/** Velocity at p (free stream (-1, 0, 0) in car space: the car drives towards +X). Written into `out`. */
export function velocityAt(field: FlowField, p: Vec3, out: number[] = [0, 0, 0]): number[] {
  let vx = -1;
  let vy = 0;
  let vz = 0;
  for (const b of field.bodies) {
    for (const mirror of [1, -1]) {
      // Doublet in the body's scaled space: uniform flow past a unit sphere. The mirror image keeps air from crossing the ground.
      const cy = b.c[1] * mirror;
      const qx = (p[0] - b.c[0]) / b.s[0];
      const qy = (p[1] - cy) / b.s[1];
      const qz = (p[2] - b.c[2]) / b.s[2];
      const r2 = qx * qx + qy * qy + qz * qz;
      if (r2 < 1e-4) continue;
      const r3 = r2 * Math.sqrt(r2);
      const ux = -1 / b.s[0];
      const dot = ux * qx;
      const kx = 0.5 * (ux / r3 - (3 * dot * qx) / (r3 * r2));
      const ky = 0.5 * ((-3 * dot * qy) / (r3 * r2));
      const kz = 0.5 * ((-3 * dot * qz) / (r3 * r2));
      vx += kx * b.s[0];
      vy += ky * b.s[1];
      vz += kz * b.s[2];
    }
  }
  for (const e of field.effects) {
    const dx = (p[0] - e.c[0]) / e.r[0];
    const dy = (p[1] - e.c[1]) / e.r[1];
    const dz = (p[2] - e.c[2]) / e.r[2];
    const w = Math.exp(-(dx * dx + dy * dy + dz * dz));
    vx += w * e.v[0];
    vy += w * e.v[1];
    vz += w * e.v[2];
  }
  out[0] = vx;
  out[1] = vy;
  out[2] = vz;
  return out;
}

export const insideBody = (p: Vec3, margin = 1) =>
  FLOW_BODIES.some((b) => ((p[0] - b.c[0]) / b.s[0]) ** 2 + ((p[1] - b.c[1]) / b.s[1]) ** 2 + ((p[2] - b.c[2]) / b.s[2]) ** 2 < margin);

export interface Streamline {
  region: FlowRegion;
  /** Flattened xyz. */
  points: Float32Array;
  /** Speed relative to the oncoming air at each point. */
  speed: Float32Array;
  /** Cumulative travel time at each point (particles move by time, so they slow down and speed up like the air). */
  time: Float32Array;
}

const X_START = 4.2;
const X_END = -4.6;
const STEP = 0.035;
const MIN_SPEED = 0.15;

/** Traces one streamline from `seed` with midpoint (RK2) steps until it leaves the scene, stalls into a body, or hits the step limit. */
export function traceStreamline(field: FlowField, seed: Vec3, region: FlowRegion, maxSteps = 420): Streamline {
  const pts: number[] = [];
  const spd: number[] = [];
  const tm: number[] = [];
  const v = [0, 0, 0];
  const p: [number, number, number] = [seed[0], seed[1], seed[2]];
  let t = 0;
  for (let i = 0; i < maxSteps && p[0] > X_END; i++) {
    velocityAt(field, p, v);
    const s = Math.hypot(v[0], v[1], v[2]);
    pts.push(...p);
    spd.push(s);
    tm.push(t);
    const inv = STEP / Math.max(s, MIN_SPEED);
    const mid: Vec3 = [p[0] + v[0] * inv * 0.5, Math.max(0.012, p[1] + v[1] * inv * 0.5), p[2] + v[2] * inv * 0.5];
    velocityAt(field, mid, v);
    const sm = Math.max(Math.hypot(v[0], v[1], v[2]), MIN_SPEED);
    p[0] += (v[0] / sm) * STEP;
    p[1] = Math.max(0.012, p[1] + (v[1] / sm) * STEP);
    p[2] += (v[2] / sm) * STEP;
    t += STEP / sm;
    if (insideBody(p, 0.92)) break;
  }
  return { region, points: Float32Array.from(pts), speed: Float32Array.from(spd), time: Float32Array.from(tm) };
}

/** Adds a deterministic wobble downstream of the car to suggest the turbulent wake ("dirty air"). Purely visual. */
function wake(line: Streamline, phase: number) {
  const n = line.points.length / 3;
  for (let i = 0; i < n; i++) {
    const x = line.points[i * 3];
    if (x > -2.3) continue;
    const a = Math.min(1, (-2.3 - x) / 1.5) * 0.05;
    line.points[i * 3 + 1] += a * Math.sin(i * 0.55 + phase);
    line.points[i * 3 + 2] += a * Math.cos(i * 0.43 + phase * 1.7);
  }
}

/** Seed rakes in front of the car: over the centreline, along the sides and under the floor. */
export function seeds(): Array<{ seed: Vec3; region: FlowRegion }> {
  const out: Array<{ seed: Vec3; region: FlowRegion }> = [];
  for (const z of [-0.2, -0.08, 0.08, 0.2]) for (const y of [0.32, 0.5, 0.7, 0.9, 1.1]) out.push({ seed: [X_START, y, z], region: "over" });
  for (const z of [0.45, 0.65, 0.95, 1.15]) for (const y of [0.15, 0.35, 0.6]) for (const s of [1, -1]) out.push({ seed: [X_START, y, z * s], region: "side" });
  for (const z of [0.1, 0.3, 0.5]) for (const s of [1, -1]) out.push({ seed: [X_START, 0.03, z * s], region: "under" });
  return out;
}

/** A helical path around a curved axis: an illustrative wing-tip vortex. */
function helix(axis: Vec3[], r0: number, r1: number, turns: number, phase: number, samples = 220): Streamline {
  const pts = new Float32Array(samples * 3);
  const speed = new Float32Array(samples).fill(1.1);
  const time = new Float32Array(samples);
  const len = axis.length - 1;
  for (let i = 0; i < samples; i++) {
    const u = i / (samples - 1);
    const f = u * len;
    const j = Math.min(Math.floor(f), len - 1);
    const t = f - j;
    const c = [0, 1, 2].map((k) => axis[j][k] * (1 - t) + axis[j + 1][k] * t);
    const r = r0 + (r1 - r0) * u;
    const a = phase + u * turns * Math.PI * 2;
    pts.set([c[0], c[1] + r * Math.cos(a), c[2] + r * Math.sin(a)], i * 3);
    time[i] = u * 7.5;
  }
  return { region: "vortex", points: pts, speed, time };
}

export function vortices(f: FlowSettings): Streamline[] {
  const k = f.downforce * (f.lowDragWings ? 0.5 : 1);
  const out: Streamline[] = [];
  for (const s of [1, -1]) {
    out.push(
      helix(
        [
          [2.05, 0.24, 0.95 * s],
          [1.6, 0.26, 1.1 * s],
          [0, 0.3, 1.12 * s],
          [-4.4, 0.35, 1.1 * s],
        ],
        0.04,
        0.13 * k,
        9,
        s,
      ),
      helix(
        [
          [-2.3, 0.99, 0.5 * s],
          [-3.4, 1.18, 0.48 * s],
          [-4.5, 1.38, 0.45 * s],
        ],
        0.03,
        0.12 * k,
        5,
        2 * s,
      ),
    );
  }
  return out;
}

export function buildStreamlines(f: FlowSettings): Streamline[] {
  const field = flowField(f);
  return seeds().map(({ seed, region }, i) => {
    const line = traceStreamline(field, seed, region);
    wake(line, i * 1.3);
    return line;
  });
}

/** Position at travel time t (wrapped to the line's duration), written into out[o..o+2]. Returns the speed there. Allocation-free. */
export function pointAtTime(line: Streamline, t: number, out: Float32Array, o: number): number {
  const n = line.time.length;
  const total = line.time[n - 1] || 1;
  const tt = ((t % total) + total) % total;
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (line.time[mid] <= tt) lo = mid;
    else hi = mid;
  }
  const span = line.time[hi] - line.time[lo] || 1;
  const w = Math.min(1, Math.max(0, (tt - line.time[lo]) / span));
  for (let k = 0; k < 3; k++) out[o + k] = line.points[lo * 3 + k] * (1 - w) + line.points[hi * 3 + k] * w;
  return line.speed[lo] * (1 - w) + line.speed[hi] * w;
}

const SLOW = new Color("#4a5a6e");
const FREE = new Color("#5cb8ff"); // viz-1
const FAST = new Color("#d9f3ff");
const VORTEX = new Color("#b78cff"); // viz-4

/** Sequential speed colour: grey-blue (slower than the oncoming air) through blue (same) to near-white (faster). */
export function speedColor(speed: number, region: FlowRegion, out = new Color()): Color {
  if (region === "vortex") return out.copy(VORTEX);
  return speed < 1 ? out.copy(SLOW).lerp(FREE, Math.max(0, (speed - 0.3) / 0.7)) : out.copy(FREE).lerp(FAST, Math.min(1, (speed - 1) / 0.6));
}
