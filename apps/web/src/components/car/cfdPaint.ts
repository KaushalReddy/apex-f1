import type { DecodedField } from "@/lib/cfd/field";

/**
 * Colour scales for COMPUTED fields. Speed is sequential (one direction: slower -> faster); the pressure coefficient is diverging around
 * Cp = 0 (free-stream pressure): suction (Cp < 0) blue, overpressure (Cp > 0) orange. Shared by the 2D panel and the 3D slice so the
 * legend is the same everywhere.
 */
export type FieldName = "speed" | "cp";

const SPEED_STOPS: Array<[number, [number, number, number]]> = [
  [0, [22, 30, 46]],
  [0.5, [37, 99, 168]],
  [0.8, [92, 184, 255]],
  [1, [232, 246, 255]],
];
const CP_STOPS: Array<[number, [number, number, number]]> = [
  [0, [37, 99, 235]],
  [0.5, [75, 83, 96]],
  [1, [255, 110, 50]],
];

function ramp(stops: Array<[number, [number, number, number]]>, t: number): [number, number, number] {
  const c = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++)
    if (c <= stops[i][0]) {
      const [a, ca] = stops[i - 1];
      const [b, cb] = stops[i];
      const k = (c - a) / (b - a);
      return [0, 1, 2].map((n) => Math.round(ca[n] + (cb[n] - ca[n]) * k)) as [number, number, number];
    }
  return stops[stops.length - 1][1];
}

/**
 * Colour range from the field's own values: speed from 0 to its 99th percentile; Cp symmetric about 0 (so the neutral grey always means
 * free-stream pressure) at the larger of |2nd| and |98th| percentile. A sharp suction peak would otherwise grey out the rest of the
 * field; values beyond the range are drawn in the end colours, and the true minimum and maximum are printed with the legend.
 */
export function displayRange(name: FieldName, values: Float32Array): [number, number] {
  const v = Array.from(values).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return [0, 1];
  const q = (p: number) => v[Math.min(v.length - 1, Math.floor(p * (v.length - 1)))];
  if (name === "speed") return [0, Math.max(q(0.99), 1e-6)];
  const m = Math.max(Math.abs(q(0.02)), Math.abs(q(0.98)), 1e-6);
  return [-m, m];
}

export const legendGradient = (name: FieldName) =>
  `linear-gradient(90deg, ${(name === "speed" ? SPEED_STOPS : CP_STOPS).map(([t, c]) => `rgb(${c.join(",")}) ${t * 100}%`).join(", ")})`;

/**
 * Paints the field into a canvas of nx x ny pixels. `flipX` mirrors it for the car view (solver +x points to the car's tail).
 * Cells without flow (inside a body) are transparent. Optional streamlines are drawn in white on top.
 */
export function paintField(
  canvas: HTMLCanvasElement,
  f: DecodedField,
  name: FieldName,
  range: [number, number],
  opts: { flipX?: boolean; lines?: Array<Array<[number, number]>>; scale?: number } = {},
) {
  const s = opts.scale ?? 1;
  canvas.width = f.nx * s;
  canvas.height = f.ny * s;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const img = ctx.createImageData(f.nx, f.ny);
  const data = name === "speed" ? f.speed : f.cp;
  const stops = name === "speed" ? SPEED_STOPS : CP_STOPS;
  for (let j = 0; j < f.ny; j++)
    for (let i = 0; i < f.nx; i++) {
      const v = data[j * f.nx + i];
      const px = opts.flipX ? f.nx - 1 - i : i;
      const o = ((f.ny - 1 - j) * f.nx + px) * 4; // canvas rows run top-down; solver y runs up
      if (Number.isNaN(v)) continue;
      const [r, g, b] = ramp(stops, (v - range[0]) / (range[1] - range[0]));
      img.data[o] = r;
      img.data[o + 1] = g;
      img.data[o + 2] = b;
      img.data[o + 3] = 255;
    }
  const tmp = document.createElement("canvas");
  tmp.width = f.nx;
  tmp.height = f.ny;
  tmp.getContext("2d")?.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(tmp, 0, 0, canvas.width, canvas.height);
  if (opts.lines?.length) {
    const [x0, x1, y0, y1] = f.window;
    const X = (x: number) => ((opts.flipX ? x1 - x : x - x0) / (x1 - x0)) * canvas.width;
    const Y = (y: number) => (1 - (y - y0) / (y1 - y0)) * canvas.height;
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = Math.max(1, s * 0.6);
    for (const l of opts.lines) {
      ctx.beginPath();
      l.forEach(([x, y], k) => (k ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      ctx.stroke();
    }
  }
}
