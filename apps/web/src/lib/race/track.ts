/**
 * Circuit path for placing drivers: built from the SAME world-space centerline the track mesh is drawn from (`centerlineToWorld` with the
 * circuit's shared transform), so markers cannot drift off the rendered road. Progress is the fraction of a lap measured along the
 * centerline from vertex 0 (the start/finish line when `derivation.startFinishAtIndex0` is true) in the direction of travel.
 */
export interface TrackPath {
  /** Lap length in world metres (under the circuit's stated scale). */
  length: number;
  /** Writes the world position at `progress` (wrapped to [0, 1)) into out[o..o+2]. Allocation-free. */
  pointAt(progress: number, out: { [i: number]: number }, o?: number): void;
  /** Heading (radians about +Y, 0 = +X) of the direction of travel at `progress`. */
  headingAt(progress: number): number;
  /** Progress of the closest centerline point to (x, z). With `hint`, searches a window around it first (safe at crossovers). */
  project(x: number, z: number, hint?: number | null): number;
}

export const wrap01 = (p: number) => ((p % 1) + 1) % 1;

export function createTrackPath(xyz: Float32Array): TrackPath {
  const n = xyz.length / 3;
  if (n < 3) throw new Error("track path needs at least 3 points");
  const cum = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    cum[i + 1] = cum[i] + Math.hypot(xyz[j * 3] - xyz[i * 3], xyz[j * 3 + 1] - xyz[i * 3 + 1], xyz[j * 3 + 2] - xyz[i * 3 + 2]);
  }
  const length = cum[n];
  if (!(length > 0)) throw new Error("track path has zero length");

  const locate = (progress: number) => {
    const d = wrap01(progress) * length;
    let lo = 0;
    let hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= d) lo = mid;
      else hi = mid;
    }
    const seg = cum[lo + 1] - cum[lo] || 1;
    return { i: lo, t: (d - cum[lo]) / seg };
  };

  const projectSegment = (i: number, x: number, z: number) => {
    const j = (i + 1) % n;
    const ax = xyz[i * 3];
    const az = xyz[i * 3 + 2];
    const dx = xyz[j * 3] - ax;
    const dz = xyz[j * 3 + 2] - az;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    const px = ax + dx * t;
    const pz = az + dz * t;
    return { d2: (x - px) ** 2 + (z - pz) ** 2, progress: (cum[i] + t * (cum[i + 1] - cum[i])) / length };
  };

  return {
    length,
    pointAt(progress, out, o = 0) {
      const { i, t } = locate(progress);
      const j = (i + 1) % n;
      for (let k = 0; k < 3; k++) out[o + k] = xyz[i * 3 + k] * (1 - t) + xyz[j * 3 + k] * t;
    },
    headingAt(progress) {
      const { i } = locate(progress);
      const j = (i + 1) % n;
      return Math.atan2(-(xyz[j * 3 + 2] - xyz[i * 3 + 2]), xyz[j * 3] - xyz[i * 3]);
    },
    project(x, z, hint) {
      let best = { d2: Infinity, progress: 0 };
      if (hint != null) {
        // Windowed search (about 8% of a lap either side): avoids snapping to the other branch where the track crosses itself.
        const centre = locate(hint).i;
        const w = Math.max(4, Math.round(n * 0.08));
        for (let k = -w; k <= w; k++) {
          const r = projectSegment((((centre + k) % n) + n) % n, x, z);
          if (r.d2 < best.d2) best = r;
        }
        // Accept the windowed answer when it is genuinely on the road (within 60 m); otherwise fall back to a full search.
        if (best.d2 < 60 * 60) return wrap01(best.progress);
      }
      for (let i = 0; i < n; i++) {
        const r = projectSegment(i, x, z);
        if (r.d2 < best.d2) best = r;
      }
      return wrap01(best.progress);
    },
  };
}

/**
 * Forward distance (in laps) from progress a to progress b, assuming cars only move forward: 0..1. A tiny backwards step (noise in a
 * position feed) reads as ~1 lap forward, so callers treat deltas above `maxForward` as "no movement".
 */
export const forwardDelta = (a: number, b: number) => wrap01(b - a);

/**
 * Interpolates lap progress from a to b by t in [0, 1], moving forward through the finish line when needed (0.98 -> 0.02 passes 0).
 * A backwards jump larger than noise (forward delta > maxForward) holds at `a` instead of sending the car round the lap.
 */
export function lerpProgress(a: number, b: number, t: number, maxForward = 0.5): number {
  const d = forwardDelta(a, b);
  if (d > maxForward) return a;
  return wrap01(a + d * Math.max(0, Math.min(1, t)));
}
