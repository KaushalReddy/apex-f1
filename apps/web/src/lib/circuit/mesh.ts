/**
 * Pure geometry builders (no three.js import: unit-testable and SSR-safe). Inputs and outputs are WORLD coordinates.
 *
 * A road is described once by RoadFrames (per-vertex tangent, left normal, slope-aware surface normal and the lateral room
 * available on each side). Road, edge lines and the start/finish line are all built from the same frames, so they cannot disagree.
 */

export interface RoadFrames {
  n: number;
  closed: boolean;
  /** xyz per vertex (the centerline). */
  pos: Float32Array;
  /** Horizontal unit tangent (x, z) per vertex, in the direction of increasing index. */
  tangent: Float32Array;
  /** Horizontal unit LEFT normal (x, z) per vertex: (-tz, tx). */
  side: Float32Array;
  /** Metres of road available to the left / right of the centerline. Narrowed on the INSIDE of tight corners so the ribbon cannot fold. */
  leftMax: Float32Array;
  rightMax: Float32Array;
  /** Unit surface normal (xyz) per vertex, following the slope so lighting reveals elevation changes. */
  normals: Float32Array;
}

/** Inner-side offsets are limited to this fraction of the local corner radius. */
const INNER_RADIUS_FRACTION = 0.9;

export function computeFrames(xyz: Float32Array, closed: boolean, width: number): RoadFrames {
  const n = xyz.length / 3;
  if (!Number.isInteger(n) || n < 2) throw new Error("road needs at least 2 points");
  if (!(width > 0)) throw new Error("road width must be positive");
  const half = width / 2;
  const tangent = new Float32Array(n * 2);
  const side = new Float32Array(n * 2);
  const leftMax = new Float32Array(n).fill(half);
  const rightMax = new Float32Array(n).fill(half);
  const normals = new Float32Array(n * 3);
  const px = (i: number) => xyz[i * 3];
  const py = (i: number) => xyz[i * 3 + 1];
  const pz = (i: number) => xyz[i * 3 + 2];
  const wrap = (i: number) => (closed ? ((i % n) + n) % n : Math.min(Math.max(i, 0), n - 1));

  for (let i = 0; i < n; i++) {
    // tangent over a stencil that widens across duplicate points
    let dx = 0, dz = 0, dy = 0;
    for (let k = 1; k < n; k++) {
      const a = wrap(i - k), b = wrap(i + k);
      dx = px(b) - px(a);
      dz = pz(b) - pz(a);
      dy = py(b) - py(a);
      if (Math.hypot(dx, dz) > 1e-9) break;
    }
    const len = Math.hypot(dx, dz);
    const tx = len < 1e-9 ? 1 : dx / len;
    const tz = len < 1e-9 ? 0 : dz / len;
    const slope = len < 1e-9 ? 0 : dy / len; // rise per metre travelled horizontally
    tangent[i * 2] = tx;
    tangent[i * 2 + 1] = tz;
    side[i * 2] = -tz;
    side[i * 2 + 1] = tx;
    // normal = normalize(L x T) with L = (-tz, 0, tx), T = (tx, slope, tz)  ->  (-tx*slope, 1, -tz*slope)
    const nl = Math.hypot(tx * slope, 1, tz * slope);
    normals[i * 3] = (-tx * slope) / nl;
    normals[i * 3 + 1] = 1 / nl;
    normals[i * 3 + 2] = (-tz * slope) / nl;

    // signed corner radius from the turn between the incoming and outgoing segments
    const a = wrap(i - 1), b = wrap(i + 1);
    const ax = px(i) - px(a), az = pz(i) - pz(a);
    const bx = px(b) - px(i), bz = pz(b) - pz(i);
    const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
    if (la > 1e-9 && lb > 1e-9) {
      const theta = Math.atan2((ax * bz - az * bx) / (la * lb), (ax * bx + az * bz) / (la * lb));
      const ds = (la + lb) / 2;
      if (Math.abs(theta) > 1e-6) {
        const limit = INNER_RADIUS_FRACTION * (ds / Math.abs(theta));
        if (theta > 0) leftMax[i] = Math.min(half, limit); // turning towards the left normal: left is the inside
        else rightMax[i] = Math.min(half, limit);
      }
    }
  }
  return { n, closed, pos: xyz, tangent, side, leftMax, rightMax, normals };
}

export interface BandBuffers {
  positions: Float32Array;
  indices: Uint32Array;
}

/** Quad strip across the road between lateral fractions f0 < f1 in [-1, 1] (+1 = left edge). Triangles face +Y; closed strips include the seam. */
function buildBand(frames: RoadFrames, f0: number, f1: number): BandBuffers {
  const { n, closed, pos, side, leftMax, rightMax } = frames;
  if (!(f0 < f1)) throw new Error("band needs f0 < f1");
  const segs = closed ? n : n - 1;
  const positions = new Float32Array(n * 2 * 3);
  const indices = new Uint32Array(segs * 6);
  const lat = (i: number, f: number) => (f >= 0 ? f * leftMax[i] : f * rightMax[i]);
  for (let i = 0; i < n; i++) {
    const o = i * 6;
    const l1 = lat(i, f1), l0 = lat(i, f0);
    positions[o] = pos[i * 3] + side[i * 2] * l1;
    positions[o + 1] = pos[i * 3 + 1];
    positions[o + 2] = pos[i * 3 + 2] + side[i * 2 + 1] * l1;
    positions[o + 3] = pos[i * 3] + side[i * 2] * l0;
    positions[o + 4] = pos[i * 3 + 1];
    positions[o + 5] = pos[i * 3 + 2] + side[i * 2 + 1] * l0;
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 2;
    const b = ((i + 1) % n) * 2;
    indices.set([a, b, a + 1, b, b + 1, a + 1], i * 6);
  }
  return { positions, indices };
}

export interface EdgeLineBuffers {
  /** Left edge vertices (0..n-1) then right edge vertices (n..2n-1), xyz. */
  positions: Float32Array;
  /** Index pairs for LineSegments; loops close when the road is closed. */
  indices: Uint32Array;
}

/**
 * The road's two edges as line segments. GL lines are always about one pixel wide, so the edges stay crisp at any zoom, whereas a
 * metre-wide strip is sub-pixel (invisible) when the whole circuit is in view. Lifted by `lift` metres to stay clear of the road.
 */
export function buildEdgeLines(frames: RoadFrames, lift = 0.15): EdgeLineBuffers {
  const { n, closed, pos, side, leftMax, rightMax } = frames;
  const positions = new Float32Array(n * 2 * 3);
  for (let i = 0; i < n; i++) {
    positions[i * 3] = pos[i * 3] + side[i * 2] * leftMax[i];
    positions[i * 3 + 1] = pos[i * 3 + 1] + lift;
    positions[i * 3 + 2] = pos[i * 3 + 2] + side[i * 2 + 1] * leftMax[i];
    const r = (n + i) * 3;
    positions[r] = pos[i * 3] - side[i * 2] * rightMax[i];
    positions[r + 1] = pos[i * 3 + 1] + lift;
    positions[r + 2] = pos[i * 3 + 2] - side[i * 2 + 1] * rightMax[i];
  }
  const segs = closed ? n : n - 1;
  const indices = new Uint32Array(segs * 4);
  for (let i = 0; i < segs; i++) {
    const j = (i + 1) % n;
    indices.set([i, j, n + i, n + j], i * 4);
  }
  return { positions, indices };
}

export interface RoadBuffers extends BandBuffers {
  normals: Float32Array;
  frames: RoadFrames;
}

/** The racing surface: one indexed ribbon with slope-following normals. */
export function buildRoad(xyz: Float32Array, closed: boolean, width: number): RoadBuffers {
  const frames = computeFrames(xyz, closed, width);
  const { positions, indices } = buildBand(frames, -1, 1);
  const normals = new Float32Array(frames.n * 2 * 3);
  for (let i = 0; i < frames.n; i++) {
    for (let k = 0; k < 2; k++) normals.set(frames.normals.subarray(i * 3, i * 3 + 3), (i * 2 + k) * 3);
  }
  return { positions, indices, normals, frames };
}

export interface CheckerBuffers {
  positions: Float32Array;
  /** 0 = dark square, 1 = light square, per vertex. */
  shade: Float32Array;
  indices: Uint32Array;
}

/**
 * Chequered start/finish line across the road at vertex `index`: `rows` along the direction of travel (total `depthMeters`) and `cols`
 * across, centred on the vertex. Spans the road's own lateral room at that vertex, so it always matches the road.
 */
export function buildChecker(frames: RoadFrames, index: number, rows = 2, cols = 6, lift = 0, depthMeters?: number): CheckerBuffers {
  if (!Number.isInteger(index) || index < 0 || index >= frames.n) throw new Error("index out of range");
  const i = index;
  const left = frames.leftMax[i], right = frames.rightMax[i];
  const w = (left + right) / cols;
  const rowDepth = (depthMeters ?? rows * w) / rows;
  const quads = rows * cols;
  const positions = new Float32Array(quads * 4 * 3);
  const shade = new Float32Array(quads * 4);
  const indices = new Uint32Array(quads * 6);
  const [tx, tz] = [frames.tangent[i * 2], frames.tangent[i * 2 + 1]];
  const [sx, sz] = [frames.side[i * 2], frames.side[i * 2 + 1]];
  const [cx, cy, cz] = [frames.pos[i * 3], frames.pos[i * 3 + 1] + lift, frames.pos[i * 3 + 2]];
  let q = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const l0 = -right + c * w, l1 = l0 + w;
      const a0 = -(rows * rowDepth) / 2 + r * rowDepth, a1 = a0 + rowDepth;
      const corner = (l: number, a: number, slot: number) => {
        const o = (q * 4 + slot) * 3;
        positions[o] = cx + sx * l + tx * a;
        positions[o + 1] = cy;
        positions[o + 2] = cz + sz * l + tz * a;
      };
      corner(l0, a0, 0); // P00: right edge, behind
      corner(l1, a0, 1); // P10: left edge, behind
      corner(l0, a1, 2); // P01: right edge, ahead
      corner(l1, a1, 3); // P11: left edge, ahead
      shade.fill((r + c) % 2, q * 4, q * 4 + 4);
      const v = q * 4;
      indices.set([v + 1, v + 3, v + 0, v + 3, v + 2, v + 0], q * 6); // (P10,P11,P00) and (P11,P01,P00): +Y
      q++;
    }
  }
  return { positions, shade, indices };
}
