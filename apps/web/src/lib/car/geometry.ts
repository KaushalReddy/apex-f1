import {
  BoxGeometry,
  Path,
  BufferGeometry,
  CatmullRomCurve3,
  CircleGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  LatheGeometry,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  RingGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
} from "three";
import { applyPressureColors, type PressureKind } from "./pressure";
import type { Vec3 } from "./types";

/**
 * Procedural, team-neutral, F1-inspired car geometry. Proportions approximate a modern open-wheel car (about 5.9 m long, 1.9 m wide,
 * 3.4 m wheelbase, 18-inch wheels): a slim nose, a V-keel monocoque, undercut sidepods with high inlets, a tall airbox, a tunnel floor
 * with fences, curved multi-element wings and covered wheels. It is NOT any team's CAD and is not aerodynamically exact.
 * Left/right parts are built for the left (+Z) side; the scene mirrors them with a negative Z scale so each buffer exists once.
 */

// ---------- Primitive builders (pure) ----------

/**
 * Cross-section of a lofted body: a superellipse centred at (x, cy, cz), `h` tall, `w` wide at the top and `wb` wide at the bottom
 * (wb < w gives the V-keel / undercut look). p: 2 = ellipse, larger = boxier.
 */
export interface Section {
  x: number;
  cy: number;
  cz?: number;
  w: number;
  wb?: number;
  h: number;
  p?: number;
}

const se = (t: number, p: number) => Math.sign(t) * Math.abs(t) ** (2 / p);

function sectionRing(s: Section, radial: number): number[] {
  const out: number[] = [];
  const wb = s.wb ?? s.w;
  for (let k = 0; k < radial; k++) {
    const a = (k / radial) * Math.PI * 2;
    const sn = Math.sin(a);
    const half = (wb + (s.w - wb) * ((sn + 1) / 2)) / 2;
    out.push(s.x, s.cy + (s.h / 2) * se(sn, s.p ?? 2.6), (s.cz ?? 0) + half * se(Math.cos(a), s.p ?? 2.6));
  }
  return out;
}

/** Signed volume of a closed indexed mesh: positive when faces wind outward. */
export function signedVolume(g: BufferGeometry): number {
  const p = g.getAttribute("position");
  const idx = g.getIndex()!;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  let v = 0;
  for (let i = 0; i < idx.count; i += 3) {
    a.fromBufferAttribute(p, idx.getX(i));
    b.fromBufferAttribute(p, idx.getX(i + 1));
    c.fromBufferAttribute(p, idx.getX(i + 2));
    v += a.dot(b.cross(c)) / 6;
  }
  return v;
}

/**
 * Lofts rings that all have the same vertex count into a smooth, capped solid. Side vertices are shared (smooth shading); caps get their
 * own vertices (crisp edges). Winding is fixed up from the signed volume, so callers can order rings in either direction.
 */
export function loftRings(rings: readonly number[][]): BufferGeometry {
  if (rings.length < 2) throw new Error("loft needs at least two sections");
  const m = rings[0].length / 3;
  if (rings.some((r) => r.length !== m * 3)) throw new Error("loft rings must have equal vertex counts");
  const pos: number[] = rings.flat();
  const idx: number[] = [];
  for (let i = 0; i < rings.length - 1; i++)
    for (let k = 0; k < m; k++) {
      const a = i * m + k;
      const b = i * m + ((k + 1) % m);
      idx.push(a, b, a + m, b, b + m, a + m);
    }
  const cap = (ring: number[], flip: boolean) => {
    const base = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let k = 0; k < m; k++) {
      cx += ring[k * 3] / m;
      cy += ring[k * 3 + 1] / m;
      cz += ring[k * 3 + 2] / m;
    }
    pos.push(...ring, cx, cy, cz);
    for (let k = 0; k < m; k++) {
      const a = base + k;
      const b = base + ((k + 1) % m);
      if (flip) idx.push(base + m, a, b);
      else idx.push(base + m, b, a);
    }
  };
  cap(rings[0], false);
  cap(rings[rings.length - 1], true);
  const g = new BufferGeometry();
  g.setAttribute("position", new Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  if (signedVolume(g) < 0) {
    const arr = g.getIndex()!.array as Uint16Array | Uint32Array;
    for (let i = 0; i < arr.length; i += 3) [arr[i + 1], arr[i + 2]] = [arr[i + 2], arr[i + 1]];
  }
  g.computeVertexNormals();
  return g;
}

/**
 * Inserts `steps - 1` sections between each pair using a Catmull-Rom spline on the shape fields, so lofted bodywork curves smoothly
 * instead of kinking at every authored section. x is interpolated linearly, which keeps it monotonic (a spline could overshoot).
 */
export function smoothSections(sections: readonly Section[], steps = 4): Section[] {
  const n = sections.length;
  const at = (i: number) => sections[Math.max(0, Math.min(n - 1, i))];
  const cr = (a: number, b: number, c: number, d: number, t: number) =>
    0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  const out: Section[] = [];
  for (let i = 0; i < n - 1; i++)
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
      const f = (key: "cy" | "w" | "h") => cr(a[key], b[key], c[key], d[key], t);
      const g = (s: Section, key: "cz" | "wb" | "p") => s[key] ?? (key === "cz" ? 0 : key === "wb" ? s.w : 2.6);
      const fo = (key: "cz" | "wb" | "p") => cr(g(a, key), g(b, key), g(c, key), g(d, key), t);
      out.push({
        x: b.x + (c.x - b.x) * t,
        cy: f("cy"),
        cz: fo("cz"),
        w: Math.max(0.01, f("w")),
        wb: Math.max(0.01, fo("wb")),
        h: Math.max(0.01, f("h")),
        p: Math.max(2, fo("p")),
      });
    }
  out.push(sections[n - 1]);
  return out;
}

/** Lofts superellipse sections (ordered along X, either direction). */
export function loft(sections: readonly Section[], radial = 40): BufferGeometry {
  for (let i = 1; i < sections.length; i++) if (sections[i].x === sections[i - 1].x) throw new Error("loft sections must have distinct x");
  const dir = Math.sign(sections[1].x - sections[0].x);
  for (let i = 1; i < sections.length; i++) if (Math.sign(sections[i].x - sections[i - 1].x) !== dir) throw new Error("loft sections must be monotonic in x");
  return loftRings(sections.map((s) => sectionRing(s, radial)));
}

/** NACA-style 4-digit section, cosine-spaced: [u, v] from the trailing edge over the top to the leading edge and back underneath. */
export function airfoilPoints(chord: number, thickness: number, camber: number, n = 12): Array<[number, number]> {
  const p = 0.4;
  const upper: Array<[number, number]> = [];
  const lower: Array<[number, number]> = [];
  for (let i = 0; i <= n; i++) {
    const x = (1 - Math.cos((i / n) * Math.PI)) / 2;
    const yt = 5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = x < p ? (camber / (p * p)) * (2 * p * x - x * x) : (camber / (1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x * x);
    upper.push([x * chord, (yc + yt) * chord]);
    lower.push([x * chord, (yc - Math.max(yt, 0.004)) * chord]);
  }
  return [...upper.reverse(), ...lower.slice(1, -1)];
}

/** Trailing-edge position for an element whose chord runs rearwards (-X) and whose positive angle raises the trailing edge. */
export function trailingEdge(le: Vec3, chord: number, aoaDeg: number): Vec3 {
  const a = (aoaDeg * Math.PI) / 180;
  return [le[0] - chord * Math.cos(a), le[1] + chord * Math.sin(a), le[2]];
}

/** One spanwise station of a swept wing element. `t` scales thickness (rounded tips use < 1). */
export interface WingStation {
  z: number;
  x: number;
  y: number;
  chord: number;
  aoaDeg: number;
  t?: number;
}

/**
 * A wing element lofted through spanwise stations, so it can curve, twist and rise towards the endplates like a real front wing.
 * Inverted camber (negative) pushes the car down.
 */
export function sweptWing(stations: readonly WingStation[], thickness = 0.1, camber = -0.07): BufferGeometry {
  return loftRings(stations.map((s) => sectionOutline(s, thickness, camber).flatMap(([x, y]) => [x, y, s.z])));
}

/** One station's aerofoil outline in car space (X, Y), as drawn. `n` points per surface: the drawing uses 12; CFD samples it finer. */
export function sectionOutline(s: WingStation, thickness = 0.1, camber = -0.07, n = 12): Array<[number, number]> {
  const a = (s.aoaDeg * Math.PI) / 180;
  return airfoilPoints(s.chord, thickness * (s.t ?? 1), camber, n).map(([u, v]) => [s.x - u * Math.cos(a) + v * Math.sin(a), s.y + u * Math.sin(a) + v * Math.cos(a)]);
}

/** Rear-wing element layout: half span, spanwise stations, and the main plane and flap station at a given z (shared with the CFD section). */
export const REAR_WING = { half: 0.5, stations: [0, 0.4, 0.7, 0.88, 0.96, 1], mainThickness: 0.12, flapThickness: 0.1 } as const;
export function rearWingElements(a: WingAngles, z: number): { main: WingStation; flap: WingStation } {
  const f = Math.abs(z) / REAR_WING.half;
  const t = f > 0.99 ? 0.4 : 1;
  const main: WingStation = { z, x: -1.82, y: 0.8 - 0.07 * f ** 4, chord: 0.33, aoaDeg: a.rearMainDeg, t };
  const te = trailingEdge([main.x, main.y, main.z], main.chord, main.aoaDeg);
  return { main, flap: { z, x: te[0] + 0.045, y: te[1] + 0.025, chord: 0.23, aoaDeg: a.rearFlapDeg, t } };
}

/** A flat plate from an outline in the X/Y plane, `thickness` thick, centred on z. */
export function plate(outline: ReadonlyArray<[number, number]>, thickness: number, z = 0): BufferGeometry {
  const g = new ExtrudeGeometry(new Shape(outline.map(([x, y]) => new Vector2(x, y))), { depth: thickness, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, z - thickness / 2);
  return g;
}

/** A horizontal plate from a plan outline [x, z], spanning y from `top - thickness` to `top`. */
export function planPlate(outline: ReadonlyArray<[number, number]>, thickness: number, top: number): BufferGeometry {
  const g = new ExtrudeGeometry(new Shape(outline.map(([x, z]) => new Vector2(x, z))), { depth: thickness, bevelEnabled: false });
  g.rotateX(Math.PI / 2); // shape y -> world z, extrusion -> world -y
  g.translate(0, top, 0);
  return g;
}

/** Rounded-rectangle opening (intakes) facing +X, centred at `at`. */
function opening(at: Vec3, w: number, h: number, r: number): BufferGeometry {
  const s = new Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  const g = new ShapeGeometry(s, 6);
  g.rotateY(Math.PI / 2); // shape x -> world -z, faces +X
  g.translate(...at);
  return g;
}

/**
 * Transform placing a unit, Y-aligned link between two points. The link's local X is aligned with the airflow (car -X projected onto
 * the link's cross-section plane), so a flattened (aerofoil-like) link presents its thin edge to the air, as real wishbones do.
 */
export function linkTransform(a: Vec3, b: Vec3) {
  const va = new Vector3(...a);
  const d = new Vector3(...b).sub(va);
  const length = d.length();
  const y = d.clone().normalize();
  let x = new Vector3(1, 0, 0).addScaledVector(y, -y.x);
  if (x.lengthSq() < 1e-6) x = new Vector3(0, 0, 1).addScaledVector(y, -y.z);
  x.normalize();
  const z = new Vector3().crossVectors(x, y);
  const quaternion = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
  const position = va.add(d.multiplyScalar(0.5));
  return { position: position.toArray() as [number, number, number], quaternion: quaternion.toArray() as [number, number, number, number], length };
}

// ---------- Car layout ----------

export const LAYOUT = {
  wheelbase: 3.4,
  frontAxleX: 1.7,
  rearAxleX: -1.7,
  wheelRadius: 0.36,
  rimRadius: 0.229, // 18 in rim
  front: { trackZ: 0.8, tyreWidth: 0.28 },
  rear: { trackZ: 0.78, tyreWidth: 0.34 },
} as const;

/** Wheel centres (left side). Right wheels mirror Z. */
export const WHEEL_CENTRES = {
  front: [LAYOUT.frontAxleX, LAYOUT.wheelRadius, LAYOUT.front.trackZ] as Vec3,
  rear: [LAYOUT.rearAxleX, LAYOUT.wheelRadius, LAYOUT.rear.trackZ] as Vec3,
};

/** Illustrative wing angles (degrees). They shape the drawing only; they are not any team's settings. */
export interface WingAngles {
  frontFlapDeg: number;
  rearMainDeg: number;
  rearFlapDeg: number;
}

// Proportions follow side-view reference renders of 2026 cars supplied by the project owner (measured at the 3.4 m wheelbase):
// about 5.0 m long, nose tip 0.94 m ahead of the front axle, rear wing 0.63 m behind the rear axle.
const CHASSIS: Section[] = [
  // The blunt tip sits on the front wing's main plane.
  { x: 2.64, cy: 0.17, w: 0.1, wb: 0.08, h: 0.1, p: 2.4 },
  { x: 2.45, cy: 0.22, w: 0.15, wb: 0.12, h: 0.15 },
  { x: 2.1, cy: 0.3, w: 0.22, wb: 0.16, h: 0.22 },
  { x: 1.75, cy: 0.37, w: 0.27, wb: 0.18, h: 0.28 },
  { x: 1.45, cy: 0.42, w: 0.33, wb: 0.2, h: 0.32, p: 3 },
  { x: 1.0, cy: 0.46, w: 0.44, wb: 0.24, h: 0.38, p: 3.2 },
  { x: 0.6, cy: 0.47, w: 0.52, wb: 0.28, h: 0.4, p: 3.4 },
  { x: 0.2, cy: 0.45, w: 0.56, wb: 0.3, h: 0.4, p: 3.4 },
  { x: -0.2, cy: 0.43, w: 0.56, wb: 0.32, h: 0.38, p: 3.4 },
  { x: -0.6, cy: 0.4, w: 0.5, wb: 0.3, h: 0.34, p: 3.2 },
  { x: -1.2, cy: 0.34, w: 0.32, wb: 0.24, h: 0.26 },
  { x: -1.75, cy: 0.3, w: 0.2, wb: 0.16, h: 0.18 },
  { x: -2.02, cy: 0.3, w: 0.1, wb: 0.08, h: 0.09 },
];

const ENGINE_COVER: Section[] = [
  // The front section's cap is the vertical airbox face that carries the intake.
  { x: -0.05, cy: 0.77, w: 0.2, wb: 0.4, h: 0.3 },
  { x: -0.32, cy: 0.81, w: 0.22, wb: 0.42, h: 0.4, p: 2.8 },
  { x: -0.58, cy: 0.78, w: 0.26, wb: 0.44, h: 0.42, p: 3 },
  { x: -0.92, cy: 0.7, w: 0.28, wb: 0.42, h: 0.36, p: 3 },
  { x: -1.3, cy: 0.6, w: 0.22, wb: 0.32, h: 0.28 },
  { x: -1.68, cy: 0.5, w: 0.13, wb: 0.18, h: 0.2 },
  { x: -1.98, cy: 0.44, w: 0.05, wb: 0.07, h: 0.06 },
];

/** Undercut sidepod (left): high, narrow inlet; wide top, narrow bottom; a downwash ramp towards the rear. */
const SIDEPOD_L: Section[] = [
  { x: 0.62, cy: 0.48, cz: 0.4, w: 0.3, wb: 0.12, h: 0.3, p: 3.6 },
  { x: 0.48, cy: 0.47, cz: 0.43, w: 0.36, wb: 0.14, h: 0.34, p: 3.4 },
  { x: 0.2, cy: 0.45, cz: 0.44, w: 0.38, wb: 0.16, h: 0.36, p: 3.2 },
  { x: -0.3, cy: 0.4, cz: 0.4, w: 0.34, wb: 0.16, h: 0.34, p: 3 },
  { x: -0.8, cy: 0.33, cz: 0.33, w: 0.26, wb: 0.14, h: 0.26 },
  { x: -1.25, cy: 0.26, cz: 0.25, w: 0.16, wb: 0.1, h: 0.16 },
  { x: -1.55, cy: 0.22, cz: 0.19, w: 0.07, wb: 0.06, h: 0.07 },
];

/** Material slots. Livery zones (paint, cover, fin, wing, accent, halo, rimRing) take their colours from the team's Livery. */
export type MaterialKey =
  | "paint"
  | "cover"
  | "fin"
  | "wing"
  | "accent"
  | "rimRing"
  | "carbon"
  | "rubber"
  | "rim"
  | "metal"
  | "halo"
  | "dark"
  | "band"
  | "plank"
  | "light"
  | "helmet"
  | "visor";

/** One mesh of an assembly: a shared geometry, a material slot and an optional local transform. */
export interface MeshSpec {
  geometry: BufferGeometry;
  material: MaterialKey;
  position?: Vec3;
  rotation?: Vec3;
  quaternion?: [number, number, number, number];
  scale?: Vec3;
}

const MIRROR: Vec3 = [1, 1, -1];

function spec(geometry: BufferGeometry, material: MaterialKey, kind: PressureKind, t: Omit<MeshSpec, "geometry" | "material"> = {}): MeshSpec {
  if (!geometry.getAttribute("color")) applyPressureColors(geometry, kind);
  return { geometry, material, ...t };
}

const span = (halfSpan: number, fractions: readonly number[]) => [...fractions.map((f) => -f * halfSpan).reverse(), ...fractions.slice(1).map((f) => f * halfSpan)];

/** Front wing: main plane plus three flaps that rise and twist towards curved endplates, mounted under the nose. */
function frontWing(a: WingAngles): MeshSpec[] {
  const half = 0.93;
  const zs = span(half, [0, 0.18, 0.32, 0.48, 0.64, 0.78, 0.9, 0.97, 1]);
  const f = (z: number) => Math.abs(z) / half;
  const tip = (z: number) => (f(z) > 0.99 ? 0.35 : 1);
  const main: WingStation[] = zs.map((z) => ({ z, x: 2.68 - 0.05 * f(z) ** 2, y: 0.07 + 0.035 * f(z) ** 3, chord: 0.26 - 0.04 * f(z), aoaDeg: 2 + 5 * f(z), t: tip(z) }));
  const out: MeshSpec[] = [spec(sweptWing(main, 0.09), "carbon", "wing")];
  const chords = [0.16, 0.13, 0.11];
  // Flaps run from the nose (|z| = 0.14) to the endplate on each side.
  const flapZ = span(half, [0.14, 0.24, 0.36, 0.5, 0.64, 0.78, 0.9, 0.97, 1]).filter((z) => Math.abs(z) >= 0.14 - 1e-9);
  for (const side of [-1, 1]) {
    const zsSide = flapZ.filter((z) => Math.sign(z) === side);
    let prev = zsSide.map((z) => {
      const m = main.find((s) => Math.abs(s.z - z) < 1e-9) ?? interpolateStation(main, z);
      return { z, te: trailingEdge([m.x, m.y, z], m.chord, m.aoaDeg) };
    });
    chords.forEach((chord, k) => {
      const st: WingStation[] = prev.map(({ z, te }) => ({
        z,
        x: te[0] + 0.03,
        y: te[1] + 0.018 + 0.015 * f(z) ** 2,
        chord: chord * (1 - 0.15 * f(z)),
        aoaDeg: a.frontFlapDeg + 7 * k + 5 * f(z) - (Math.abs(z) < 0.2 ? 6 : 0),
        t: Math.abs(z) < 0.145 || f(z) > 0.99 ? 0.4 : 1,
      }));
      out.push(spec(sweptWing(st, 0.1), k === 2 ? "paint" : "carbon", "wing"));
      prev = st.map((s) => ({ z: s.z, te: trailingEdge([s.x, s.y, s.z], s.chord, s.aoaDeg) }));
    });
    if (side > 0) {
      const tipTe = prev[prev.length - 1].te;
      const top = tipTe[1] + 0.04;
      // The endplate stops just behind the last flap, clear of the front tyre.
      const outline: Array<[number, number]> = [
        [2.7, 0.03],
        [2.72, 0.11],
        [2.56, 0.2],
        [tipTe[0] + 0.03, top],
        [tipTe[0] - 0.01, top - 0.02],
        [tipTe[0] - 0.02, 0.07],
        [2.32, 0.03],
      ];
      const endplate = plate(outline, 0.012, half + 0.006);
      out.push(spec(endplate, "wing", "body"), spec(endplate, "wing", "body", { scale: MIRROR }));
    }
  }
  return out;
}

function interpolateStation(st: readonly WingStation[], z: number): WingStation {
  const sorted = [...st].sort((p, q) => p.z - q.z);
  for (let i = 0; i < sorted.length - 1; i++) {
    const p = sorted[i];
    const q = sorted[i + 1];
    if (z >= p.z && z <= q.z) {
      const t = (z - p.z) / (q.z - p.z || 1);
      const l = (u: number, v: number) => u + (v - u) * t;
      return { z, x: l(p.x, q.x), y: l(p.y, q.y), chord: l(p.chord, q.chord), aoaDeg: l(p.aoaDeg, q.aoaDeg) };
    }
  }
  return { ...sorted[sorted.length - 1], z };
}

/** Rear wing: spoon-shaped main plane and flap whose tips droop into rounded endplates, beam wings, swan-neck pillar, rain light. */
function rearWing(a: WingAngles): MeshSpec[] {
  const half = REAR_WING.half;
  const elements = span(half, REAR_WING.stations).map((z) => rearWingElements(a, z));
  const main: WingStation[] = elements.map((e) => e.main);
  const flap: WingStation[] = elements.map((e) => e.flap);
  const flapTe = trailingEdge([flap[0].x, flap[0].y, 0], flap[0].chord, flap[0].aoaDeg);
  const top = Math.max(0.97, flapTe[1] + 0.05);
  const endplate = plate(
    [
      [-1.73, 0.4],
      [-1.73, 0.86],
      [-1.78, top - 0.03],
      [-1.86, top],
      [-2.26, top + 0.01],
      [-2.36, top - 0.07],
      [-2.36, 0.58],
      [-2.14, 0.36],
    ],
    0.014,
    half + 0.007,
  );
  const neck = new CatmullRomCurve3([new Vector3(-1.66, 0.4, 0), new Vector3(-1.72, 0.62, 0), new Vector3(-1.76, 0.84, 0), new Vector3(-1.82, 0.92, 0), new Vector3(-1.9, 0.9, 0)]);
  const beam = (y: number, x: number, chord: number, aoaDeg: number) =>
    sweptWing(span(0.4, [0, 0.6, 0.95, 1]).map((z) => ({ z, x, y, chord, aoaDeg, t: Math.abs(z) > 0.399 ? 0.4 : 1 })), 0.1);
  return [
    spec(sweptWing(main, REAR_WING.mainThickness), "wing", "wing"),
    spec(sweptWing(flap, REAR_WING.flapThickness), "carbon", "wing"),
    spec(beam(0.44, -1.8, 0.15, 8), "carbon", "wing"),
    spec(beam(0.5, -1.97, 0.12, 24), "carbon", "wing"),
    spec(endplate, "wing", "body"),
    spec(endplate, "wing", "body", { scale: MIRROR }),
    spec(new TubeGeometry(neck, 24, 0.022, 10, false), "carbon", "body"),
    spec(new BoxGeometry(0.03, 0.05, 0.09), "light", "none", { position: [-2.04, 0.3, 0] }),
  ];
}

/** Floor underside and top (m above the ground): the floor edge sits about 0.1 m up in the references. */
const FLOOR_BOTTOM = 0.06;
const FLOOR_TOP = 0.085;

function floorAssembly(): MeshSpec[] {
  const half: Array<[number, number]> = [
    [1.32, 0.2],
    [1.18, 0.42],
    [0.95, 0.7],
    [0.55, 0.76],
    [-1.05, 0.76],
    [-1.22, 0.64],
    [-1.35, 0.56],
    [-1.47, 0.54],
  ];
  const outline = [...half, ...half.slice().reverse().map(([x, z]) => [x, -z] as [number, number])];
  const fence = plate(
    [
      [1.3, FLOOR_TOP],
      [1.3, 0.15],
      [0.95, 0.16],
      [0.6, 0.11],
      [0.55, FLOOR_TOP],
    ],
    0.01,
  );
  const edge = plate(
    [
      [0.5, FLOOR_TOP],
      [0.45, 0.13],
      [-0.95, 0.13],
      [-1.0, FLOOR_TOP],
    ],
    0.01,
    0.755,
  );
  // Large carbon side panel under the sidepod inlet (prominent in every reference render).
  const sidePanel = plate(
    [
      [1.03, FLOOR_TOP],
      [1.03, 0.45],
      [0.75, 0.44],
      [0.42, 0.35],
      [0.4, FLOOR_TOP],
    ],
    0.012,
    0.64,
  );
  return [
    spec(planPlate(outline, FLOOR_TOP - FLOOR_BOTTOM, FLOOR_TOP), "carbon", "floor"),
    spec(sidePanel, "carbon", "body"),
    spec(sidePanel, "carbon", "body", { scale: MIRROR }),
    ...[0.14, 0.24, 0.34, 0.44].flatMap((z) => [spec(fence, "carbon", "body", { position: [0, 0, z] }), spec(fence, "carbon", "body", { position: [0, 0, -z] })]),
    spec(edge, "carbon", "body"),
    spec(edge, "carbon", "body", { scale: MIRROR }),
    spec(new BoxGeometry(2.0, 0.012, 0.3), "plank", "floor", { position: [-0.1, FLOOR_BOTTOM - 0.006, 0] }),
  ];
}

function diffuserAssembly(): MeshSpec[] {
  const ramp = new ExtrudeGeometry(
    new Shape(
      (
        [
          [-1.47, FLOOR_BOTTOM],
          [-1.47, FLOOR_TOP],
          [-2.06, 0.38],
          [-2.06, 0.35],
        ] as const
      ).map(([x, y]) => new Vector2(x, y)),
    ),
    { depth: 1.12, bevelEnabled: false },
  );
  ramp.translate(0, 0, -0.56);
  const fence = plate(
    [
      [-1.47, FLOOR_BOTTOM],
      [-2.06, 0.36],
      [-2.06, FLOOR_BOTTOM],
    ],
    0.01,
  );
  const wall = plate(
    [
      [-1.47, FLOOR_BOTTOM],
      [-1.47, 0.11],
      [-2.06, 0.42],
      [-2.06, FLOOR_BOTTOM],
    ],
    0.012,
    0.565,
  );
  return [
    spec(ramp, "carbon", "diffuser"),
    ...[0, 0.2, -0.2, 0.38, -0.38].map((z) => spec(fence, "carbon", "body", { position: [0, 0, z] })),
    spec(wall, "carbon", "body"),
    spec(wall, "carbon", "body", { scale: MIRROR }),
  ];
}

/** Wheel assembly for one axle, axle along Z, outer face towards +Z, centred at the origin. */
function wheelAssembly(width: number): MeshSpec[] {
  const R = LAYOUT.wheelRadius;
  const rim = LAYOUT.rimRadius;
  const h = width / 2;
  const axleZ = <T extends BufferGeometry>(g: T) => g.rotateX(Math.PI / 2);
  const profile: Array<[number, number]> = [
    [rim + 0.003, -h + 0.012],
    [0.29, -h - 0.004],
    [0.335, -h + 0.006],
    [0.352, -h + 0.025],
    [R, -h + 0.06],
    [R, h - 0.06],
    [0.352, h - 0.025],
    [0.335, h - 0.006],
    [0.29, h + 0.004],
    [rim + 0.003, h - 0.012],
  ];
  // Lathe profiles run along +Y; rotateX(+90deg) maps +Y to +Z (outer face).
  const tyre = axleZ(new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 72));
  const band = new RingGeometry(0.296, 0.31, 72);
  // Open 8-spoke wheel face (as in the references): a disc with eight windows, so the brake duct shows through.
  const face = new Shape();
  face.absarc(0, 0, rim - 0.004, 0, Math.PI * 2, false);
  for (let i = 0; i < 8; i++) {
    const a0 = (i / 8) * Math.PI * 2 + 0.13;
    const a1 = ((i + 1) / 8) * Math.PI * 2 - 0.13;
    const hole = new Path();
    hole.absarc(0, 0, 0.19, a0, a1, false);
    hole.absarc(0, 0, 0.075, a1, a0, true);
    face.holes.push(hole);
  }
  const spokes = new ExtrudeGeometry(face, { depth: 0.012, bevelEnabled: false, curveSegments: 24 });
  const rimRing = new RingGeometry(0.205, 0.226, 72);
  return [
    spec(tyre, "rubber", "tyre"),
    spec(band, "band", "none", { position: [0, 0, h + 0.006] }),
    spec(band, "band", "none", { position: [0, 0, -h - 0.006], rotation: [0, Math.PI, 0] }),
    spec(axleZ(new CylinderGeometry(rim, rim, width - 0.03, 48, 1, true)), "rim", "none"),
    spec(spokes, "rim", "body", { position: [0, 0, h - 0.032] }),
    spec(rimRing, "rimRing", "none", { position: [0, 0, h - 0.017] }),
    spec(axleZ(new CylinderGeometry(0.03, 0.03, 0.03, 12)), "metal", "none", { position: [0, 0, h - 0.004] }),
    spec(axleZ(new CylinderGeometry(0.17, 0.19, 0.1, 32)), "carbon", "body", { position: [0, 0, -h + 0.07] }),
  ];
}

/** Suspension link end points for the left side, from chassis pick-up to upright. */
export const SUSPENSION_LINKS: Record<"front" | "rear", ReadonlyArray<readonly [Vec3, Vec3]>> = {
  front: [
    [[1.98, 0.5, 0.14], [1.72, 0.54, 0.66]],
    [[1.45, 0.52, 0.16], [1.72, 0.54, 0.66]],
    [[2.02, 0.24, 0.12], [1.7, 0.19, 0.68]],
    [[1.38, 0.28, 0.13], [1.7, 0.19, 0.68]],
    [[1.68, 0.21, 0.64], [1.56, 0.58, 0.16]], // pushrod
    [[1.9, 0.4, 0.13], [1.84, 0.38, 0.67]], // track rod (steering)
  ],
  rear: [
    [[-1.42, 0.5, 0.2], [-1.68, 0.53, 0.63]],
    [[-1.96, 0.5, 0.12], [-1.68, 0.53, 0.63]],
    [[-1.38, 0.22, 0.2], [-1.7, 0.19, 0.65]],
    [[-2.0, 0.22, 0.1], [-1.7, 0.19, 0.65]],
    [[-1.7, 0.21, 0.61], [-1.52, 0.5, 0.22]], // pushrod
    [[-1.86, 0.36, 0.12], [-1.84, 0.36, 0.64]], // toe link
  ],
};

function suspensionAssembly(axle: "front" | "rear", link: BufferGeometry, upright: BufferGeometry): MeshSpec[] {
  const c = WHEEL_CENTRES[axle];
  return [
    ...SUSPENSION_LINKS[axle].map(([a, b]) => {
      const t = linkTransform(a, b);
      return spec(link, "carbon", "body", { position: t.position, quaternion: t.quaternion, scale: [1, t.length, 1] });
    }),
    spec(upright, "metal", "none", { position: [c[0], c[1], c[2] - 0.11] }),
  ];
}

function cockpitAssembly(): MeshSpec[] {
  const halo = new CatmullRomCurve3(
    (
      [
        [-0.1, 0.64, 0.24],
        [0.02, 0.82, 0.26],
        [0.3, 0.885, 0.2],
        [0.52, 0.89, 0],
        [0.3, 0.885, -0.2],
        [0.02, 0.82, -0.26],
        [-0.1, 0.64, -0.24],
      ] as Vec3[]
    ).map((p) => new Vector3(...p)),
  );
  const strut = new CatmullRomCurve3([new Vector3(0.52, 0.89, 0), new Vector3(0.66, 0.8, 0), new Vector3(0.76, 0.66, 0)]);
  const opening = new CircleGeometry(0.5, 40);
  opening.rotateX(-Math.PI / 2);
  opening.scale(0.66, 1, 0.4);
  const rim = new TorusGeometry(0.5, 0.03, 8, 48);
  rim.rotateX(Math.PI / 2);
  rim.scale(0.68, 1, 0.42);
  const pad = loft([
    { x: 0.24, cy: 0.69, cz: 0.17, w: 0.06, h: 0.06 },
    { x: 0.12, cy: 0.71, cz: 0.17, w: 0.08, h: 0.1 },
    { x: -0.02, cy: 0.71, cz: 0.16, w: 0.08, h: 0.1 },
  ]);
  const helmet = new SphereGeometry(0.115, 32, 20);
  helmet.scale(1.1, 1, 0.95);
  // Band around the front of the helmet (+X is phi = PI in three's sphere parametrisation), just above the equator.
  const visor = new SphereGeometry(0.118, 32, 6, Math.PI - Math.PI / 3.2, Math.PI / 1.6, Math.PI * 0.36, Math.PI * 0.16);
  visor.scale(1.1, 1, 0.95);
  return [
    spec(new TubeGeometry(halo, 80, 0.028, 12, false), "halo", "body"),
    spec(new TubeGeometry(strut, 20, 0.03, 12, false), "halo", "body"),
    spec(opening, "dark", "none", { position: [0.18, 0.655, 0] }),
    spec(rim, "carbon", "body", { position: [0.18, 0.66, 0] }),
    spec(pad, "carbon", "body"),
    spec(pad, "carbon", "body", { scale: MIRROR }),
    spec(helmet, "helmet", "body", { position: [0.1, 0.76, 0] }),
    spec(visor, "visor", "none", { position: [0.1, 0.76, 0] }),
    spec(new BoxGeometry(0.04, 0.1, 0.22), "carbon", "none", { position: [0.4, 0.7, 0], rotation: [0, 0, 0.5] }),
  ];
}

function engineCoverAssembly(): MeshSpec[] {
  const intake = new Shape();
  intake.moveTo(0, 0.08);
  intake.quadraticCurveTo(0.07, 0.07, 0.07, -0.02);
  intake.quadraticCurveTo(0.06, -0.07, 0, -0.07);
  intake.quadraticCurveTo(-0.06, -0.07, -0.07, -0.02);
  intake.quadraticCurveTo(-0.07, 0.07, 0, 0.08);
  const intakeGeo = new ShapeGeometry(intake, 8);
  intakeGeo.rotateY(Math.PI / 2);
  intakeGeo.translate(-0.048, 0.82, 0);
  // Spine fin: in the references the upper bodywork line stays high (about 0.99 m behind the airbox, 0.87 m at x = -1.33) and carries
  // the race number. The fin fills the band between that line and the lower engine-cover body.
  const fin = plate(
    [
      [-0.4, 1.0],
      [-0.5, 1.03],
      [-0.93, 0.96],
      [-1.13, 0.92],
      [-1.4, 0.88],
      [-1.56, 0.84],
      [-1.64, 0.6],
      [-1.3, 0.72],
      [-0.92, 0.85],
      [-0.58, 0.96],
    ],
    0.012,
  );
  // Tall, narrow airbox pod above the intake (up to about 1.1 m in the references).
  const pod = loft([
    { x: -0.04, cy: 1.0, w: 0.05, h: 0.06 },
    { x: -0.09, cy: 1.04, w: 0.09, h: 0.12 },
    { x: -0.2, cy: 1.04, w: 0.09, h: 0.12 },
    { x: -0.27, cy: 1.0, w: 0.06, h: 0.06 },
  ]);
  return [
    spec(loft(smoothSections(ENGINE_COVER)), "cover", "body"),
    spec(intakeGeo, "dark", "none"),
    spec(fin, "fin", "body"),
    spec(pod, "accent", "body"),
  ];
}

function sidepodAssembly(link: BufferGeometry): MeshSpec[] {
  const housing = loft([
    { x: 0.5, cy: 0.77, cz: 0.45, w: 0.03, h: 0.02 },
    { x: 0.46, cy: 0.77, cz: 0.45, w: 0.15, h: 0.065 },
    { x: 0.39, cy: 0.77, cz: 0.45, w: 0.15, h: 0.065 },
    { x: 0.38, cy: 0.77, cz: 0.45, w: 0.12, h: 0.05 },
  ]);
  const glass = new PlaneGeometry(0.13, 0.05);
  glass.rotateY(-Math.PI / 2);
  const stalk = linkTransform([0.43, 0.64, 0.36], [0.43, 0.75, 0.44]);
  return [
    spec(loft(smoothSections(SIDEPOD_L)), "paint", "body"),
    spec(opening([0.625, 0.52, 0.42], 0.22, 0.14, 0.04), "dark", "none"),
    spec(housing, "paint", "body"),
    spec(glass, "visor", "none", { position: [0.378, 0.77, 0.45] }),
    spec(link, "carbon", "none", { position: stalk.position, quaternion: stalk.quaternion, scale: [1, stalk.length, 1] }),
  ];
}

export type AssemblyKey =
  | "chassis"
  | "cockpit"
  | "engineCover"
  | "sidepod"
  | "frontWing"
  | "rearWing"
  | "floor"
  | "diffuser"
  | "frontWheel"
  | "rearWheel"
  | "frontSuspension"
  | "rearSuspension";

/** Which assembly each explodable part draws, where, and whether it is the mirrored (right-hand) copy. */
export const PART_ASSEMBLY: Readonly<Record<string, { assembly: AssemblyKey; position?: Vec3; mirror?: boolean }>> = {
  "nose-chassis": { assembly: "chassis" },
  "halo-cockpit": { assembly: "cockpit" },
  "engine-cover": { assembly: "engineCover" },
  "sidepod-l": { assembly: "sidepod" },
  "sidepod-r": { assembly: "sidepod", mirror: true },
  "front-wing": { assembly: "frontWing" },
  "rear-wing": { assembly: "rearWing" },
  floor: { assembly: "floor" },
  diffuser: { assembly: "diffuser" },
  "wheel-fl": { assembly: "frontWheel", position: WHEEL_CENTRES.front },
  "wheel-fr": { assembly: "frontWheel", position: [WHEEL_CENTRES.front[0], WHEEL_CENTRES.front[1], -WHEEL_CENTRES.front[2]], mirror: true },
  "wheel-rl": { assembly: "rearWheel", position: WHEEL_CENTRES.rear },
  "wheel-rr": { assembly: "rearWheel", position: [WHEEL_CENTRES.rear[0], WHEEL_CENTRES.rear[1], -WHEEL_CENTRES.rear[2]], mirror: true },
  "front-suspension-l": { assembly: "frontSuspension" },
  "front-suspension-r": { assembly: "frontSuspension", mirror: true },
  "rear-suspension-l": { assembly: "rearSuspension" },
  "rear-suspension-r": { assembly: "rearSuspension", mirror: true },
};

/** Where race-number decals sit: on the nose (readable from the front) and both sides of the spine fin, as in the references. */
export const DECALS: ReadonlyArray<{ part: string; position: Vec3; rotation: Vec3; size: [number, number]; tilt?: number }> = [
  { part: "nose-chassis", position: [2.1, 0.415, 0], rotation: [-Math.PI / 2, 0, Math.PI / 2], size: [0.15, 0.1], tilt: -0.3 },
  { part: "engine-cover", position: [-1.25, 0.82, 0.0075], rotation: [0, 0, 0], size: [0.2, 0.11] },
  { part: "engine-cover", position: [-1.25, 0.82, -0.0075], rotation: [0, Math.PI, 0], size: [0.2, 0.11] },
];

/** Every geometry buffer the car needs, grouped by assembly. Built once per wing setting; dispose with `disposeCarGeometry`. */
/** Everything except the wings: independent of the setup, so it is built once per scene. */
export function buildBodyGeometry() {
  // Flattened (aerofoil-like) link: elliptical section, thin edge to the airflow after linkTransform.
  const link = new CylinderGeometry(0.014, 0.014, 1, 10).scale(1.7, 1, 0.55);
  const upright = new CylinderGeometry(0.03, 0.03, 0.34, 10);
  const assemblies: Omit<Record<AssemblyKey, MeshSpec[]>, "frontWing" | "rearWing"> = {
    chassis: [spec(loft(smoothSections(CHASSIS)), "paint", "body")],
    cockpit: cockpitAssembly(),
    engineCover: engineCoverAssembly(),
    sidepod: sidepodAssembly(link),
    floor: floorAssembly(),
    diffuser: diffuserAssembly(),
    frontWheel: wheelAssembly(LAYOUT.front.tyreWidth),
    rearWheel: wheelAssembly(LAYOUT.rear.tyreWidth),
    frontSuspension: suspensionAssembly("front", link, upright),
    rearSuspension: suspensionAssembly("rear", link, upright),
  };
  return { assemblies, decal: new PlaneGeometry(1, 1) };
}

/** The two wing assemblies: the only geometry the setup angles change, so a setup change rebuilds just these. */
export const buildWingGeometry = (angles: WingAngles) => ({ frontWing: frontWing(angles), rearWing: rearWing(angles) });

export const assembleCar = (body: ReturnType<typeof buildBodyGeometry>, wings: ReturnType<typeof buildWingGeometry>) => ({
  assemblies: { ...body.assemblies, ...wings } as Record<AssemblyKey, MeshSpec[]>,
  decal: body.decal,
});

export function buildCarGeometry(angles: WingAngles) {
  return assembleCar(buildBodyGeometry(), buildWingGeometry(angles));
}

export type CarGeometry = ReturnType<typeof buildCarGeometry>;

/** Disposes every distinct BufferGeometry reachable from a CarGeometry. Returns how many were disposed. */
export function disposeCarGeometry(g: unknown): number {
  const seen = new Set<BufferGeometry>();
  const visit = (v: unknown) => {
    if (v instanceof BufferGeometry) seen.add(v);
    else if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object") Object.values(v).forEach(visit);
  };
  visit(g);
  seen.forEach((x) => x.dispose());
  return seen.size;
}
