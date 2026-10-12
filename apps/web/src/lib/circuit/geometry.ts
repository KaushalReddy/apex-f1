import type { CircuitGeometry, ParseResult, Vec3 } from "./types";

/** Rendering default when the geometry carries no sourced width. Deliberately labelled "nominal" in the UI. */
export const NOMINAL_TRACK_WIDTH_M = 10;
/** Minimum DRAWN width as a fraction of the circuit's longest dimension, so the road stays legible when the whole circuit is in view. */
export const LEGIBLE_WIDTH_RATIO = 0.012;
export const MAX_POINTS = 20_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isFiniteNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Validates untrusted JSON against the circuit-geometry contract. Never throws. */
export function parseCircuitGeometry(raw: unknown): ParseResult {
  if (!isObj(raw)) return { ok: false, error: "geometry is not an object" };
  if (typeof raw.circuitKey !== "string" || raw.circuitKey.trim() === "") return { ok: false, error: "circuitKey must be a non-empty string" };
  if (typeof raw.coordinateSystem !== "string" || raw.coordinateSystem.trim() === "") return { ok: false, error: "coordinateSystem must be a non-empty string" };
  if (!isFiniteNum(raw.unitMeters) || raw.unitMeters <= 0) return { ok: false, error: "unitMeters must be a positive number" };
  if (typeof raw.closed !== "boolean") return { ok: false, error: "closed must be a boolean" };
  if (!Array.isArray(raw.points)) return { ok: false, error: "points must be an array" };
  if (raw.points.length < 3) return { ok: false, error: "points needs at least 3 entries" };
  if (raw.points.length > MAX_POINTS) return { ok: false, error: `points exceeds the limit of ${MAX_POINTS}` };
  for (let i = 0; i < raw.points.length; i++) {
    const p: unknown = raw.points[i];
    if (!Array.isArray(p) || p.length !== 3 || !p.every(isFiniteNum)) return { ok: false, error: `points[${i}] is not a finite [x, y, z]` };
  }
  const w = raw.widthMeters;
  if (w !== undefined && w !== null && (!isFiniteNum(w) || w <= 0)) return { ok: false, error: "widthMeters must be null or a positive number" };
  const d = raw.derivation;
  if (!isObj(d)) return { ok: false, error: "derivation is required" };
  if (!Array.isArray(d.sessionKeys) || !d.sessionKeys.every((k) => Number.isInteger(k))) return { ok: false, error: "derivation.sessionKeys must be integers" };
  if (!Number.isInteger(d.lapsUsed) || !isFiniteNum(d.sigmaMeters) || !isFiniteNum(d.stepMeters)) return { ok: false, error: "derivation needs lapsUsed, sigmaMeters, stepMeters" };

  const geometry = raw as unknown as CircuitGeometry;
  const b = sourceBounds(geometry.points);
  if (b.max[0] - b.min[0] === 0 && b.max[1] - b.min[1] === 0) return { ok: false, error: "centerline is degenerate (zero extent)" };
  return { ok: true, geometry };
}

export interface Bounds {
  min: Vec3;
  max: Vec3;
}

export function sourceBounds(points: readonly Vec3[]): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const p of points) {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  }
  return { min, max };
}

/** Centerline length in source units (XY plane; elevation excluded, as in the spike). */
export function centerlineLengthUnits(points: readonly Vec3[], closed: boolean): number {
  let len = 0;
  const n = points.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    len += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  return len;
}

/** Human-readable scale status for the UI. Never claims calibration the spike did not establish. */
export function describeScale(g: CircuitGeometry): { label: string; calibrated: boolean } {
  const s = g.derivation.scale;
  const unit = `${g.unitMeters} m per unit`;
  if (!s) return { label: `${unit}: unverified`, calibrated: false };
  if (s.status === "within-tolerance") return { label: `${unit}: length within tolerance of the official lap length`, calibrated: true };
  if (s.status === "caveat") return { label: `${unit}: CAVEAT, measured length differs from the official length (${s.lengthErrorPct ?? "?"}%)`, calibrated: false };
  return { label: `${unit}: assumed, not calibrated`, calibrated: false };
}


/** Longest horizontal dimension of the centerline in metres (under the stated, possibly provisional, unit). */
export function circuitExtentMeters(points: readonly Vec3[], unitMeters: number): number {
  const b = sourceBounds(points);
  return Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1]) * unitMeters;
}

export interface TrackWidth {
  /** Width actually drawn, in metres. One parameter shared by the road, edge lines and start/finish line. */
  drawnMeters: number;
  /** The sourced width, or null when the geometry has none (the usual case). */
  sourcedMeters: number | null;
  /** The base width used before legibility widening: sourced, else the nominal default. */
  baseMeters: number;
  /** True when the drawn road is wider than the base so that it stays visible; it is then NOT the real width. */
  widenedForLegibility: boolean;
}

export function resolveTrackWidth(widthMeters: number | null | undefined, extentMeters: number): TrackWidth {
  const sourced = widthMeters ?? null;
  const base = sourced ?? NOMINAL_TRACK_WIDTH_M;
  const legible = Math.max(0, extentMeters) * LEGIBLE_WIDTH_RATIO;
  const drawn = Math.max(base, legible);
  return { drawnMeters: drawn, sourcedMeters: sourced, baseMeters: base, widenedForLegibility: drawn > base + 1e-9 };
}

export function describeTrackWidth(w: TrackWidth): string {
  const drawn = `${Math.round(w.drawnMeters)} m`;
  if (w.sourcedMeters !== null) return w.widenedForLegibility ? `${drawn} drawn (widened for legibility; sourced width ${w.sourcedMeters} m)` : `${drawn} (sourced)`;
  return `${drawn} drawn, widened for legibility; real width not sourced (${NOMINAL_TRACK_WIDTH_M} m nominal)`;
}
