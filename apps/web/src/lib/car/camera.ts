import { Euler, Matrix4, Quaternion, Vector3 } from "three";
import { PARTS, partExplode } from "./components";
import { PART_ASSEMBLY, buildCarGeometry, disposeCarGeometry } from "./geometry";
import type { Vec3, ViewName } from "./types";

/** Point the camera orbits around: roughly the car's visual centre (car space, metres). */
export const CAR_TARGET: Vec3 = [0.15, 0.42, 0];
export const CAR_FOV = 35;
/** Fraction of the frame the car may fill (leaves a small border). */
export const FILL = 0.9;

/** Unit view directions (camera position relative to the target). */
const DIRECTIONS: Record<ViewName, Vec3> = {
  threeQuarter: [0.62, 0.3, 0.72],
  front: [1, 0.12, 0],
  rear: [-1, 0.16, 0],
  side: [0, 0.1, 1],
  // Exactly overhead is degenerate for orbit controls: the azimuth is undefined, so a millimetre of residual camera offset turns into
  // an arbitrary roll. A 4-degree tilt towards +Z pins the azimuth and lays the car's length across the (usually wide) screen.
  top: [0, 1, 0.07],
};

export const VIEW_LABELS: Record<ViewName, string> = {
  threeQuarter: "Three-quarter",
  front: "Front",
  rear: "Rear",
  side: "Side",
  top: "Top",
};

let hullCache: { assembled: Float32Array; exploded: Float32Array } | null = null;

/**
 * A sample of the car's real vertices (every part, mirrored copies included), assembled and fully exploded. Built once from the procedural
 * geometry, so framing always matches what is drawn.
 */
export function carHull(exploded: boolean): Float32Array {
  if (!hullCache) {
    const g = buildCarGeometry({ frontFlapDeg: 26, rearMainDeg: 14, rearFlapDeg: 44 }); // steepest preset: tallest wings
    const a: number[] = [];
    const e: number[] = [];
    const m = new Matrix4();
    const part = new Matrix4();
    const v = new Vector3();
    for (const p of PARTS) {
      const layout = PART_ASSEMBLY[p.key];
      part.compose(new Vector3(...(layout.position ?? [0, 0, 0])), new Quaternion(), new Vector3(1, 1, layout.mirror ? -1 : 1));
      const off = partExplode(p.key);
      for (const s of g.assemblies[layout.assembly]) {
        const q = s.quaternion ? new Quaternion(...s.quaternion) : new Quaternion().setFromEuler(new Euler(...(s.rotation ?? [0, 0, 0])));
        m.compose(new Vector3(...(s.position ?? [0, 0, 0])), q, new Vector3(...(s.scale ?? [1, 1, 1]))).premultiply(part);
        const pos = s.geometry.getAttribute("position");
        const stride = Math.max(1, Math.floor(pos.count / 160));
        for (let i = 0; i < pos.count; i += stride) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          a.push(v.x, v.y, v.z);
          e.push(v.x + off[0], v.y + off[1], v.z + off[2]);
        }
      }
    }
    disposeCarGeometry(g);
    hullCache = { assembled: Float32Array.from(a), exploded: Float32Array.from(e) };
  }
  return exploded ? hullCache.exploded : hullCache.assembled;
}

/** Largest |NDC| any point reaches when viewed from `target + dir * distance` (Y up). Values <= 1 are on screen. */
export function maxNdc(points: Float32Array, dir: Vec3, distance: number, aspect: number, fovDeg = CAR_FOV, target: Vec3 = CAR_TARGET): number {
  const len = Math.hypot(...dir);
  const f = new Vector3(-dir[0] / len, -dir[1] / len, -dir[2] / len);
  const r = new Vector3().crossVectors(f, new Vector3(0, 1, 0)).normalize();
  const u = new Vector3().crossVectors(r, f);
  const cam = new Vector3(...target).addScaledVector(f, -distance);
  const tv = Math.tan((fovDeg * Math.PI) / 360);
  const th = tv * aspect;
  let worst = 0;
  const p = new Vector3();
  for (let i = 0; i < points.length; i += 3) {
    p.set(points[i], points[i + 1], points[i + 2]).sub(cam);
    const z = p.dot(f);
    if (z <= 0.05) return Infinity;
    worst = Math.max(worst, Math.abs(p.dot(r)) / (z * th), Math.abs(p.dot(u)) / (z * tv));
  }
  return worst;
}

/** Closest distance along `dir` at which every hull point fits within FILL of the frame (bisection). */
export function fitAlong(points: Float32Array, dir: Vec3, aspect: number): number {
  let lo = 0.5;
  let hi = 60;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (maxNdc(points, dir, mid, aspect) <= FILL) hi = mid;
    else lo = mid;
  }
  return hi;
}

const fitCache = new Map<string, number>();

export function cameraPreset(view: ViewName, aspect: number, exploded = false): { position: Vec3; target: Vec3; distance: number } {
  const d = DIRECTIONS[view];
  const len = Math.hypot(...d);
  const a = Math.max(Math.round(aspect * 100) / 100, 0.2);
  const key = `${view}:${a}:${exploded}`;
  let distance = fitCache.get(key);
  if (distance === undefined) {
    distance = fitAlong(carHull(exploded), d, a);
    fitCache.set(key, distance);
  }
  return {
    position: [CAR_TARGET[0] + (d[0] / len) * distance, CAR_TARGET[1] + (d[1] / len) * distance, CAR_TARGET[2] + (d[2] / len) * distance],
    target: CAR_TARGET,
    distance,
  };
}

/** Zoom limits: close enough to inspect a wishbone, far enough to see the exploded car from any side on a portrait phone. */
export function zoomLimits(aspect: number) {
  const far = Math.max(...(Object.keys(DIRECTIONS) as ViewName[]).map((v) => cameraPreset(v, aspect, true).distance));
  return { min: 1.4, max: far * 1.5 };
}

/**
 * Distance at which a bounding sphere fits the frame on both axes (with the FILL border), never closer than the sphere itself plus a
 * margin (so the camera cannot end up inside the part). Used to focus the camera on one component.
 */
export function fitSphere(radius: number, aspect: number, fovDeg = CAR_FOV): number {
  const v = (fovDeg * Math.PI) / 360;
  const h = Math.atan(Math.tan(v) * Math.max(aspect, 0.2));
  return Math.max(radius / Math.sin(Math.min(v, h)) / FILL, radius + 0.3);
}
