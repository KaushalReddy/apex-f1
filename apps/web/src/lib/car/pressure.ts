import { BufferGeometry, Color, Float32BufferAttribute } from "three";

/**
 * ILLUSTRATIVE surface pressure for the educational aerodynamics view. Each surface gets a qualitative value in [-1, 1] from simple,
 * textbook rules (stagnation on forward-facing surfaces, suction under inverted wings and the floor, pressure recovery along the
 * diffuser). It is NOT a computed pressure coefficient and must never be shown as a number.
 */
export type PressureKind = "body" | "wing" | "floor" | "diffuser" | "tyre" | "none";

const pos = (v: number) => Math.max(0, v);
const clamp = (v: number) => Math.max(-1, Math.min(1, v));

/** n: unit surface normal (car space, +X forward); p: surface position. */
export function illustrativePressure(kind: PressureKind, n: readonly [number, number, number], p: readonly [number, number, number]): number {
  const [nx, ny] = n;
  const facing = pos(nx); // faces the oncoming air
  switch (kind) {
    case "body":
      // Stagnation at the front; flow speeds up over curved tops (mild suction); slightly low on rear-facing faces.
      return clamp(0.9 * facing * facing - 0.35 * pos(ny) * (1 - facing) - 0.2 * pos(-nx));
    case "wing":
      // Inverted wing: higher pressure on top, strong suction underneath.
      return clamp(0.8 * facing * facing + (ny >= 0 ? 0.55 * ny : 1.0 * ny));
    case "floor":
      return ny < -0.3 ? -0.95 : clamp(0.05 + 0.6 * facing * facing);
    case "diffuser": {
      // Underside: lowest at the throat, recovering towards the exit.
      if (ny < -0.1 || nx < -0.3) {
        const t = Math.max(0, Math.min(1, (-1.45 - p[0]) / 0.6));
        return -0.9 + 0.65 * t;
      }
      return 0.1;
    }
    case "tyre":
      return clamp(0.9 * facing * facing - 0.3 * pos(-nx));
    case "none":
      return 0;
  }
}

const LOW = new Color("#2f7bff");
const MID = new Color("#4b5360");
const HIGH = new Color("#ff5a2a");

/** Diverging map: cool = lower than the surrounding air, warm = higher. */
export function pressureColor(cp: number, out = new Color()): Color {
  const c = clamp(cp);
  return c < 0 ? out.copy(MID).lerp(LOW, -c) : out.copy(MID).lerp(HIGH, c);
}

/** Bakes a `color` attribute from the geometry's own normals. Only materials with vertexColors read it, so normal rendering is unaffected. */
export function applyPressureColors(g: BufferGeometry, kind: PressureKind): BufferGeometry {
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  const p = g.getAttribute("position");
  const n = g.getAttribute("normal");
  const col = new Float32Array(p.count * 3);
  const c = new Color();
  for (let i = 0; i < p.count; i++) {
    pressureColor(illustrativePressure(kind, [n.getX(i), n.getY(i), n.getZ(i)], [p.getX(i), p.getY(i), p.getZ(i)]), c);
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new Float32BufferAttribute(col, 3));
  return g;
}
