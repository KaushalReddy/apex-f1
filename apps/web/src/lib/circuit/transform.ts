import type { CircuitGeometry, Vec3 } from "./types";
import { sourceBounds } from "./geometry";

/**
 * THE coordinate transform. Source (OpenF1 location) coordinates -> Three.js world coordinates.
 *
 *   1. recentre : subtract origin (x, y: centre of the centerline's XY bounding box; z: lowest centerline z)
 *   2. scale    : multiply by metersPerUnit            -> world units are METRES (provisional, see scale status)
 *   3. axes     : world.x = x', world.y = z' * elevationScale, world.z = -y'
 *                 (x,y,z) -> (x, z, -y) is a proper rotation (determinant +1): it does NOT mirror.
 *                 Seen from above (+Y looking down, -Z up the screen), the map reads like the source plane.
 *   4. yaw      : optional rotation about world Y
 *   5. mirror   : optional x flip, ONLY if the provider frame is later shown to be left-handed [VERIFY]
 *
 * Track vertices AND car telemetry must both go through the same instance. Never convert coordinates elsewhere.
 */
export interface TransformOptions {
  elevationScale?: number;
  yawRadians?: number;
  mirror?: boolean;
}

export interface WorldTransform {
  readonly coordinateSystem: string;
  readonly metersPerUnit: number;
  /** Source-space origin that maps to the world origin. */
  readonly origin: Vec3;
  readonly elevationScale: number;
  toWorld(x: number, y: number, z: number): [number, number, number];
  /** Writes into out[offset..offset+2]; allocation-free for per-frame use (Phase 4). */
  toWorldInto(out: { [i: number]: number }, offset: number, x: number, y: number, z: number): void;
  fromWorld(wx: number, wy: number, wz: number): [number, number, number];
}

export function createWorldTransform(g: Pick<CircuitGeometry, "points" | "unitMeters" | "coordinateSystem">, opts: TransformOptions = {}): WorldTransform {
  const { elevationScale = 1, yawRadians = 0, mirror = false } = opts;
  if (!(g.unitMeters > 0) || !Number.isFinite(g.unitMeters)) throw new Error("unitMeters must be positive");
  if (elevationScale === 0 || !Number.isFinite(elevationScale)) throw new Error("elevationScale must be non-zero");
  const b = sourceBounds(g.points);
  const origin: Vec3 = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, b.min[2]];
  const m = g.unitMeters;
  const cos = Math.cos(yawRadians);
  const sin = Math.sin(yawRadians);
  const sx = mirror ? -1 : 1;

  const toWorldInto: WorldTransform["toWorldInto"] = (out, o, x, y, z) => {
    const ax = (x - origin[0]) * m;
    const ay = (z - origin[2]) * m * elevationScale;
    const az = -(y - origin[1]) * m;
    const mx = ax * sx;
    out[o] = mx * cos + az * sin;
    out[o + 1] = ay;
    out[o + 2] = -mx * sin + az * cos;
  };

  return {
    coordinateSystem: g.coordinateSystem,
    metersPerUnit: m,
    origin,
    elevationScale,
    toWorld(x, y, z) {
      const out: [number, number, number] = [0, 0, 0];
      toWorldInto(out, 0, x, y, z);
      return out;
    },
    toWorldInto,
    fromWorld(wx, wy, wz) {
      const mx = wx * cos - wz * sin;
      const az = wx * sin + wz * cos;
      const ax = mx * sx;
      return [ax / m + origin[0], -az / m + origin[1], wy / (m * elevationScale) + origin[2]];
    },
  };
}

/** Telemetry must share the circuit's coordinate system before it may use its transform. */
export function sameCoordinateSystem(transform: WorldTransform, telemetrySystem: string | undefined): boolean {
  return telemetrySystem === undefined || telemetrySystem === transform.coordinateSystem;
}

/** Centerline in world coordinates (flat xyz array). */
export function centerlineToWorld(g: CircuitGeometry, t: WorldTransform): Float32Array {
  const out = new Float32Array(g.points.length * 3);
  for (let i = 0; i < g.points.length; i++) {
    const p = g.points[i];
    t.toWorldInto(out, i * 3, p[0], p[1], p[2]);
  }
  return out;
}
