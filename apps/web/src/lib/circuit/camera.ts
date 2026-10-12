/** Pure camera framing. All numbers come from the circuit's own world-space points and the viewport aspect; nothing is circuit-specific. */

export type Vec3 = readonly [number, number, number];
export type ViewName = "overview" | "topDown";

export interface WorldBounds {
  /** Largest horizontal distance from the bounds centre to the centerline. */
  radius: number;
  height: number;
  /** Longest horizontal dimension of the centerline's bounding box. */
  extent: number;
  center: Vec3;
}

export interface CameraPreset {
  position: Vec3;
  target: Vec3;
  /** Vertical field of view in degrees. */
  fov: number;
  /** Distance from camera to target. */
  distance: number;
}

export interface CameraFraming {
  overview: CameraPreset;
  topDown: CameraPreset;
  minDistance: number;
  maxDistance: number;
  extent: number;
}

export interface FramingOptions {
  /** Extra metres around the centerline that must stay visible (half the drawn road width). */
  marginMeters?: number;
  /** Fraction of extra room around the circuit in the limiting dimension. */
  padding?: number;
  overviewElevationDeg?: number;
  overviewFovDeg?: number;
  topDownFovDeg?: number;
}

const rad = (d: number) => (d * Math.PI) / 180;
const clampAspect = (a: number) => (Number.isFinite(a) ? Math.min(Math.max(a, 0.3), 4) : 1.6);

export function worldBounds(xyz: Float32Array): WorldBounds {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < xyz.length; i += 3) {
    minX = Math.min(minX, xyz[i]); maxX = Math.max(maxX, xyz[i]);
    minY = Math.min(minY, xyz[i + 1]); maxY = Math.max(maxY, xyz[i + 1]);
    minZ = Math.min(minZ, xyz[i + 2]); maxZ = Math.max(maxZ, xyz[i + 2]);
  }
  if (!Number.isFinite(minX)) return { radius: 0, height: 0, extent: 0, center: [0, 0, 0] };
  const center: Vec3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  let radius = 0;
  for (let i = 0; i < xyz.length; i += 3) radius = Math.max(radius, Math.hypot(xyz[i] - center[0], xyz[i + 2] - center[2]));
  return { radius, height: maxY - minY, extent: Math.max(maxX - minX, maxZ - minZ), center };
}

/**
 * Smallest camera distance at which every point (grown by margin and padding) is inside the frustum, for a camera looking at
 * `target` from `elevationDeg` above the horizon on the +Z side (so map north, -Z, is up the screen).
 * Solved exactly per point: |x'|(1+pad)/tanH - depthOffset and |y'|(1+pad)/tanV - depthOffset, take the max.
 */
export function fitDistance(xyz: Float32Array, target: Vec3, elevationDeg: number, fovDeg: number, aspect: number, marginMeters = 0, padding = 0.08): number {
  const el = rad(elevationDeg);
  const s = Math.sin(el), c = Math.cos(el);
  // view direction f = (0, -s, -c); right = (1, 0, 0); up = (0, c, -s)
  const tanV = Math.tan(rad(fovDeg) / 2);
  const tanH = tanV * clampAspect(aspect);
  const grow = 1 + padding;
  let d = 0;
  for (let i = 0; i < xyz.length; i += 3) {
    const px = xyz[i] - target[0], py = xyz[i + 1] - target[1], pz = xyz[i + 2] - target[2];
    const x = Math.abs(px) + marginMeters;
    const y = Math.abs(py * c - pz * s) + marginMeters;
    const g = -py * s - pz * c; // p . f
    d = Math.max(d, (x * grow) / tanH - g, (y * grow) / tanV - g);
  }
  return Math.max(d, 1);
}

function preset(xyz: Float32Array, target: Vec3, elevationDeg: number, fov: number, aspect: number, margin: number, padding: number): CameraPreset {
  const d = fitDistance(xyz, target, elevationDeg, fov, aspect, margin, padding);
  const el = rad(elevationDeg);
  return { position: [target[0], target[1] + Math.sin(el) * d, target[2] + Math.cos(el) * d], target, fov, distance: d };
}

/**
 * Overview (angled, wide-ish lens) and top-down (almost vertical, narrow lens so perspective distortion is small, "orthographic-like").
 * Both fit the whole circuit for the given viewport aspect.
 */
export function frameCircuit(xyz: Float32Array, aspect: number, opts: FramingOptions = {}): CameraFraming {
  const { marginMeters = 0, padding = 0.08, overviewElevationDeg = 50, overviewFovDeg = 40, topDownFovDeg = 20 } = opts;
  const b = worldBounds(xyz);
  const target: Vec3 = b.center;
  const overview = preset(xyz, target, overviewElevationDeg, overviewFovDeg, aspect, marginMeters, padding);
  const topDown = preset(xyz, target, 89, topDownFovDeg, aspect, marginMeters, padding);
  const reach = Math.max(overview.distance, topDown.distance);
  return {
    overview,
    topDown,
    minDistance: Math.max(b.extent * 0.01, 5),
    maxDistance: reach * 3,
    extent: b.extent,
  };
}

export const presetFor = (f: CameraFraming, name: ViewName): CameraPreset => (name === "topDown" ? f.topDown : f.overview);

/**
 * Clip planes from the CURRENT camera distance, so depth precision stays high when the whole circuit is in view
 * (overlays only a few cm above the road would otherwise z-fight) while close-up zoom is never clipped.
 */
export function dynamicClip(distanceToTarget: number, extent: number): { near: number; far: number } {
  return { near: Math.max(distanceToTarget * 0.01, 0.2), far: Math.max(distanceToTarget * 3 + extent * 3, 100) };
}

/** Auto-framing may follow viewport resizes only until the user touches the camera; an explicit preset always applies. */
export function shouldApplyFraming(state: { interacted: boolean; presetChanged: boolean }): boolean {
  return state.presetChanged || !state.interacted;
}
