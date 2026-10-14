/**
 * A small top-down outline of a circuit for cards and lists: the generated centerline (source x/y, north up), evenly subsampled and
 * scaled into a square box with the aspect ratio preserved. Drawn from the same data as the 3D view, so it is the real layout shape.
 */
export interface Outline {
  /** SVG path in a 0..size box, y down. */
  d: string;
  size: number;
}

export function circuitOutline(points: ReadonlyArray<readonly number[]>, closed: boolean, size = 100, maxPoints = 160, padding = 6): Outline | null {
  const finite = points.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
  if (finite.length < 3) return null;
  const step = Math.max(1, Math.ceil(finite.length / maxPoints));
  const pts = finite.filter((_, i) => i % step === 0);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const span = Math.max(x1 - x0, y1 - y0);
  if (!(span > 0)) return null;
  const k = (size - 2 * padding) / span;
  const ox = (size - (x1 - x0) * k) / 2;
  const oy = (size - (y1 - y0) * k) / 2;
  const r = (v: number) => Math.round(v * 10) / 10;
  const d = pts.map((p, i) => `${i ? "L" : "M"}${r(ox + (p[0] - x0) * k)} ${r(size - (oy + (p[1] - y0) * k))}`).join("") + (closed ? "Z" : "");
  return { d, size };
}
