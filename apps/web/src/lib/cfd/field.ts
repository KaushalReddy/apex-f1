import { decodeField, type FieldGrid } from "./model";

/**
 * Computed flow fields on the runner's regular grid (solver coordinates). Streamlines here are integrated through the SU2 velocity
 * field (bilinear interpolation, second-order Runge-Kutta); they stop at a body, at the window edge, or after a maximum length.
 */
export interface DecodedField {
  nx: number;
  ny: number;
  window: [number, number, number, number];
  speed: Float32Array;
  u: Float32Array;
  v: Float32Array;
  cp: Float32Array;
}

export function decode(f: FieldGrid): DecodedField {
  return {
    nx: f.nx,
    ny: f.ny,
    window: f.window,
    speed: decodeField(f.fields.speed.data, f.scale),
    u: decodeField(f.fields.u.data, f.scale),
    v: decodeField(f.fields.v.data, f.scale),
    cp: decodeField(f.fields.cp.data, f.scale),
  };
}

/** Bilinear sample at solver (x, y); NaN outside the window or next to a body. */
export function sample(f: DecodedField, a: Float32Array, x: number, y: number): number {
  const [x0, x1, y0, y1] = f.window;
  const gx = ((x - x0) / (x1 - x0)) * (f.nx - 1);
  const gy = ((y - y0) / (y1 - y0)) * (f.ny - 1);
  if (!(gx >= 0 && gy >= 0 && gx <= f.nx - 1 && gy <= f.ny - 1)) return Number.NaN;
  const i = Math.min(Math.floor(gx), f.nx - 2);
  const j = Math.min(Math.floor(gy), f.ny - 2);
  const tx = gx - i;
  const ty = gy - j;
  const at = (ii: number, jj: number) => a[jj * f.nx + ii];
  return (at(i, j) * (1 - tx) + at(i + 1, j) * tx) * (1 - ty) + (at(i, j + 1) * (1 - tx) + at(i + 1, j + 1) * tx) * ty;
}

/** Streamlines from seeds along the upstream edge of the window. Each line is a list of solver-coordinate points. */
export function streamlines(f: DecodedField, seeds = 26, maxSteps = 1500): Array<Array<[number, number]>> {
  const [x0, x1, y0, y1] = f.window;
  const h = ((x1 - x0) / (f.nx - 1)) * 0.6; // step: a little over half a grid cell
  const out: Array<Array<[number, number]>> = [];
  for (let s = 0; s < seeds; s++) {
    let x = x0 + 1e-6;
    let y = y0 + ((s + 0.5) / seeds) * (y1 - y0);
    const line: Array<[number, number]> = [[x, y]];
    for (let k = 0; k < maxSteps; k++) {
      const u1 = sample(f, f.u, x, y);
      const v1 = sample(f, f.v, x, y);
      const m1 = Math.hypot(u1, v1);
      if (!(m1 > 1e-6)) break;
      const xm = x + (0.5 * h * u1) / m1;
      const ym = y + (0.5 * h * v1) / m1;
      const u2 = sample(f, f.u, xm, ym);
      const v2 = sample(f, f.v, xm, ym);
      const m2 = Math.hypot(u2, v2);
      if (!(m2 > 1e-6)) break;
      x += (h * u2) / m2;
      y += (h * v2) / m2;
      line.push([x, y]);
    }
    if (line.length > 2) out.push(line);
  }
  return out;
}
