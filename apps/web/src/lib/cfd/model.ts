import { REAR_WING, rearWingElements, sectionOutline } from "@/lib/car/geometry";
import type { WingAngles } from "@/lib/car/geometry";

/**
 * CFD case and result model (client-safe). The solver is SU2, run outside the browser by tools/cfd (apexcfd); the browser only validates
 * requests and displays results. Units are SI throughout; coefficients are dimensionless.
 *
 * Sign convention: SU2 reports lift as the force component normal to the free stream along +y (up). On the inverted rear wing that force
 * points down, so downforce = -lift and the downforce coefficient C_DF = -C_L. Drag is along the free stream (rearwards on the car).
 */

/** Bump whenever tools/cfd changes how a case is meshed, solved or post-processed: it is part of every cache key. */
export const PIPELINE_VERSION = "apexcfd-3";
export const SOLVER = { name: "SU2", version: "8.5.0" } as const;

export type JobState = "queued" | "preparing-geometry" | "meshing" | "solving" | "post-processing" | "completed" | "failed" | "cancelled";
export const TERMINAL: readonly JobState[] = ["completed", "failed", "cancelled"];
export const STAGES: readonly JobState[] = ["queued", "preparing-geometry", "meshing", "solving", "post-processing", "completed"];

/** Allowed next states. A job can fail or be cancelled from any non-terminal state; completed is only reachable after post-processing. */
export function canTransition(from: JobState, to: JobState): boolean {
  if (TERMINAL.includes(from)) return false;
  if (to === "failed" || to === "cancelled") return true;
  return STAGES.indexOf(to) === STAGES.indexOf(from) + 1;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Requests and validation

export interface WingRequest {
  kind: "rear-wing-section";
  label?: string;
  speedMps: number;
  densityKgM3: number;
  temperatureK: number;
  viscosityPaS: number;
  wings: Pick<WingAngles, "rearMainDeg" | "rearFlapDeg">;
  meshLevel: "coarse" | "medium";
}

export interface BenchmarkRequest {
  kind: "benchmark-naca0012";
  label?: string;
  aoaDeg: number;
  meshLevel: "113x33" | "225x65" | "449x129";
}

export type CfdRequest = WingRequest | BenchmarkRequest;

/** ISA sea level (ICAO standard atmosphere): density, temperature and dynamic viscosity. */
export const ISA = { densityKgM3: 1.225, temperatureK: 288.15, viscosityPaS: 1.7894e-5 } as const;
export const DEFAULT_WING: Omit<WingRequest, "wings"> = { kind: "rear-wing-section", speedMps: 50, ...ISA, meshLevel: "coarse" };

const GAMMA = 1.4;
const R_AIR = 287.05;
export const speedOfSound = (temperatureK: number) => Math.sqrt(GAMMA * R_AIR * temperatureK);

const inRange = (v: unknown, lo: number, hi: number): v is number => typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi;

/** Every problem with a request; empty means valid. Ranges match tools/cfd/apexcfd/case.py. Nothing is clamped. */
export function validateRequest(r: CfdRequest): string[] {
  const e: string[] = [];
  if (r.kind === "benchmark-naca0012") {
    if (!inRange(r.aoaDeg, -5, 16)) e.push("Angle of attack must be between -5° and 16°.");
    if (!["113x33", "225x65", "449x129"].includes(r.meshLevel)) e.push("Unknown benchmark grid.");
    return e;
  }
  if (r.kind !== "rear-wing-section") return ["Unsupported case."];
  if (!inRange(r.speedMps, 5, 100)) e.push("Speed must be between 5 and 100 m/s.");
  if (!inRange(r.densityKgM3, 0.9, 1.4)) e.push("Air density must be between 0.9 and 1.4 kg/m³.");
  if (!inRange(r.temperatureK, 250, 330)) e.push("Air temperature must be between 250 and 330 K.");
  if (!inRange(r.viscosityPaS, 1.5e-5, 2.0e-5)) e.push("Dynamic viscosity must be between 1.5e-5 and 2.0e-5 Pa·s.");
  if (inRange(r.speedMps, 5, 100) && inRange(r.temperatureK, 250, 330) && r.speedMps / speedOfSound(r.temperatureK) > 0.3)
    e.push("Mach number above 0.3: the incompressible model does not apply.");
  if (!inRange(r.wings?.rearMainDeg, 2, 16)) e.push("Rear-wing main plane angle must be between 2° and 16°.");
  if (!inRange(r.wings?.rearFlapDeg, 6, 48)) e.push("Rear-wing flap angle must be between 6° and 48°.");
  if (!["coarse", "medium"].includes(r.meshLevel)) e.push("Unknown mesh level.");
  return e;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Geometry: the 2D section of the procedural rear wing

/** Spanwise station of the section: outboard of the beam wing (|z| <= 0.4 m) and the pillar, inboard of the endplate (0.5 m). */
export const SECTION_Z = 0.44;
/** Points per aerofoil surface for CFD (the drawing uses 12; the same analytic outline, sampled finer). */
export const SECTION_SAMPLES = 120;

/** Car space (X forward, Y up) <-> solver space (x along the free stream, origin at the main-plane leading edge). */
export interface SectionTransform {
  /** Car-space point that maps to the solver origin. */
  origin: [number, number];
  /** Solver x = -(car X - origin X); solver y = car Y - origin Y. The air flows from the nose to the tail, i.e. along solver +x. */
  convention: "solver = (originX - carX, carY - originY)";
  z: number;
}

export const toSolver = (t: SectionTransform, [x, y]: [number, number]): [number, number] => [t.origin[0] - x, y - t.origin[1]];
export const toCar = (t: SectionTransform, [x, y]: [number, number]): [number, number] => [t.origin[0] - x, y + t.origin[1]];

const area = (pts: ReadonlyArray<[number, number]>) => pts.reduce((a, [x1, y1], i) => a + x1 * pts[(i + 1) % pts.length][1] - pts[(i + 1) % pts.length][0] * y1, 0) / 2;
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * The rear-wing section at SECTION_Z, from the same functions that draw the 3D wing (lib/car/geometry.ts rearWingElements and
 * sectionOutline), in solver coordinates and counter-clockwise. Reference length = sum of the two element chords.
 */
export function rearWingSection(wings: Pick<WingAngles, "rearMainDeg" | "rearFlapDeg">, samples = SECTION_SAMPLES) {
  const { main, flap } = rearWingElements({ frontFlapDeg: 0, ...wings }, SECTION_Z);
  const transform: SectionTransform = { origin: [main.x, main.y], convention: "solver = (originX - carX, carY - originY)", z: SECTION_Z };
  const element = (name: string, outline: Array<[number, number]>) => {
    const pts = outline.map((p) => toSolver(transform, p).map(round6) as [number, number]);
    return { name, points: area(pts) < 0 ? pts.reverse() : pts };
  };
  return {
    elements: [
      element("wing_main", sectionOutline(main, REAR_WING.mainThickness, -0.07, samples)),
      element("wing_flap", sectionOutline(flap, REAR_WING.flapThickness, -0.07, samples)),
    ],
    referenceLengthM: main.chord + flap.chord,
    transform,
  };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Physical quantities

export const dynamicPressure = (densityKgM3: number, speedMps: number) => 0.5 * densityKgM3 * speedMps * speedMps;
export const reynolds = (densityKgM3: number, speedMps: number, lengthM: number, viscosityPaS: number) => (densityKgM3 * speedMps * lengthM) / viscosityPaS;
export const pressureCoefficient = (p: number, pInf: number, densityKgM3: number, speedMps: number) => (p - pInf) / dynamicPressure(densityKgM3, speedMps);
/** Coefficient from a force: C = F / (q A_ref). In 2D, F is per metre of span and A_ref = reference length x 1 m. */
export const coefficient = (force: number, densityKgM3: number, speedMps: number, refArea: number) => force / (dynamicPressure(densityKgM3, speedMps) * refArea);
export const force = (coeff: number, densityKgM3: number, speedMps: number, refArea: number) => coeff * dynamicPressure(densityKgM3, speedMps) * refArea;
/** Downforce from SU2's lift (positive up): downforce = -lift. */
export const downforceFromLift = (lift: number) => -lift;

// ---------------------------------------------------------------------------------------------------------------------------------
// Results

export interface Convergence {
  iterations: number;
  maxIterations?: number;
  solverExitOk: boolean;
  terminatedBy?: string;
  residualDropOrders?: Record<string, number>;
  finalResiduals?: Record<string, number>;
  forceStability?: Record<"CL" | "CD", { range: number; relativeRange: number | null; stable: boolean }>;
  rules?: { window: number; relativeRange: number; minResidualDropOrders: number };
  converged: boolean;
  reasons: string[];
}

export interface FieldGrid {
  nx: number;
  ny: number;
  window: [number, number, number, number];
  scale: number;
  fields: Record<"speed" | "u" | "v" | "cp", { unit: string; data: string; min: number; max: number }>;
}

export interface CfdResult {
  schema: "apex-f1/cfd-result@1";
  caseId: string;
  cacheKey: string;
  kind: CfdRequest["kind"];
  label?: string;
  createdAt: string;
  durationS: number;
  solver: { name: string; version: string; build?: string };
  /** apexcfd pipeline version (meshing, solver settings, post-processing). */
  pipeline?: string;
  model: { equations: string; turbulence: string; regime?: string };
  conditions: Record<string, number>;
  derived: { reynolds: number; mach: number; dynamicPressurePa?: number };
  reference: { lengthM: number; areaPerSpanM2?: number; note: string };
  geometry: Record<string, unknown>;
  mesh: Record<string, unknown> & { level: string; cells: number; nodes: number };
  convergence: Convergence;
  coefficients: { CL: number; CD: number; CMz?: number | null };
  perElement: Record<string, { CL?: number; CD?: number }> | null;
  forcesPerSpan: { liftNPerM: number; dragNPerM: number; downforceNPerM: number } | null;
  yPlus: { max: number; mean: number } | null;
  history: Array<{ iter: number; CL: number; CD: number }>;
  surface: Record<string, { x: number[]; y: number[]; cp: number[]; yPlus: number[] | null }>;
  field: FieldGrid;
  transform: SectionTransform | null;
  verification: null | {
    reference: { source: string; url: string; grid: string; code: string; values: { CL: number; CD: number } | null; alphaDeg: number; otherCodesAlpha10: Record<string, [number, number]> };
    differences: { CL: number; CD: number; CDRelative: number; CLRelative: number | null } | null;
  };
  status: { solverCompleted: boolean; converged: boolean; validated: boolean };
  limitations: string[];
  /** Set by the web app: shipped with the build, or computed on this machine. */
  origin?: "shipped" | "local";
}

/** Result list entry (no surface or field arrays). */
export type CfdSummary = Pick<CfdResult, "caseId" | "kind" | "label" | "createdAt" | "conditions" | "derived" | "coefficients" | "forcesPerSpan" | "status" | "origin"> & {
  meshLevel: string;
  solverVersion: string;
  pipeline?: string;
  geometry: Record<string, unknown>;
};

export const summarize = (r: CfdResult): CfdSummary => ({
  caseId: r.caseId,
  kind: r.kind,
  label: r.label,
  createdAt: r.createdAt,
  conditions: r.conditions,
  derived: r.derived,
  coefficients: r.coefficients,
  forcesPerSpan: r.forcesPerSpan,
  status: r.status,
  origin: r.origin,
  meshLevel: r.mesh.level,
  solverVersion: r.solver.version,
  pipeline: r.pipeline,
  geometry: r.geometry,
});

/** What a result may be called. Completed, converged, benchmark-verified and validated are different claims. */
export function trustLevel(r: Pick<CfdResult, "status" | "verification">): { label: string; tone: "success" | "info" | "warning" | "danger" } {
  if (!r.status.solverCompleted) return { label: "Solver did not complete", tone: "danger" };
  if (!r.status.converged) return { label: "Completed, not converged", tone: "warning" };
  if (r.verification) return { label: "Converged · benchmark case", tone: "info" };
  return { label: "Converged · not validated", tone: "info" };
}

/** Decodes an int16/base64 field array (NaN where there is no flow). */
export function decodeField(data: string, scale: number): Float32Array {
  const bin = typeof atob === "function" ? atob(data) : Buffer.from(data, "base64").toString("binary");
  const out = new Float32Array(bin.length / 2);
  for (let i = 0; i < out.length; i++) {
    let v = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
    if (v >= 0x8000) v -= 0x10000;
    out[i] = v === -32768 ? Number.NaN : v / scale;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Comparison

/** Inputs two results must share to be compared: everything except the geometry change being studied. */
export function incompatibilities(a: CfdResult | CfdSummary, b: CfdResult | CfdSummary): string[] {
  const out: string[] = [];
  const mesh = (x: CfdResult | CfdSummary) => ("mesh" in x ? x.mesh.level : x.meshLevel);
  const solver = (x: CfdResult | CfdSummary) => ("solver" in x ? x.solver.version : x.solverVersion);
  if (a.kind !== b.kind) out.push("different case types");
  if (mesh(a) !== mesh(b)) out.push("different mesh levels");
  if (solver(a) !== solver(b)) out.push("different solver versions");
  if ((a.pipeline ?? null) !== (b.pipeline ?? null)) out.push("different pipeline versions");
  for (const k of new Set([...Object.keys(a.conditions), ...Object.keys(b.conditions)]))
    if (!(Math.abs((a.conditions[k] ?? NaN) - (b.conditions[k] ?? NaN)) <= 1e-9)) out.push(`different ${k}`);
  if (!a.status.converged || !b.status.converged) out.push("one result did not converge");
  return out;
}

export function compareResults(a: CfdResult | CfdSummary, b: CfdResult | CfdSummary) {
  const reasons = incompatibilities(a, b);
  if (reasons.length) return { comparable: false as const, reasons };
  return {
    comparable: true as const,
    reasons,
    dCL: b.coefficients.CL - a.coefficients.CL,
    dCD: b.coefficients.CD - a.coefficients.CD,
    dDownforceNPerM: a.forcesPerSpan && b.forcesPerSpan ? b.forcesPerSpan.downforceNPerM - a.forcesPerSpan.downforceNPerM : null,
    dDragNPerM: a.forcesPerSpan && b.forcesPerSpan ? b.forcesPerSpan.dragNPerM - a.forcesPerSpan.dragNPerM : null,
  };
}

/**
 * Grid-convergence study from three systematically refined grids (refinement ratio r, coarse -> fine): observed order
 * p = ln((f3 - f2) / (f2 - f1)) / ln r and Richardson extrapolation f_ext = f1 + (f1 - f2) / (r^p - 1), with f1 the finest.
 * Returns null when the changes are not monotonic (oscillatory convergence), where the extrapolation is not defined.
 */
export function richardson(coarse: number, medium: number, fine: number, r = 2) {
  const e32 = coarse - medium;
  const e21 = medium - fine;
  if (e21 === 0 || e32 / e21 <= 0) return null;
  const p = Math.log(e32 / e21) / Math.log(r);
  return { order: p, extrapolated: fine + (fine - medium) / (r ** p - 1), gci: (1.25 * Math.abs((fine - medium) / fine)) / (r ** p - 1) };
}
