import { PARTS, componentInfo } from "./components";
import type { WingAngles } from "./geometry";
import { SETUP_PROFILES, lowDragWings, setupProfile } from "./setup";
import type { ComponentId, SetupProfileId } from "./types";

/**
 * Car Lab state and calculations, separate from rendering so they can be tested on their own. Everything here works on the parts and
 * components that exist in the procedural scene graph (lib/car/components.ts); nothing is selectable or explodable unless it is a real
 * group there.
 */

// ---------------------------------------------------------------------------------------------------------------------------------
// Component hierarchy

export interface PartGroup {
  id: "front" | "cockpit" | "bodywork" | "underbody" | "rear";
  label: string;
  /** Components in the group, each with the part keys that belong to it in this group. */
  components: Array<{ id: ComponentId; parts: string[] }>;
}

/** Wheels are one component (one assembly) but four parts, so front and rear wheels sit in different groups. */
export const PART_GROUPS: readonly PartGroup[] = [
  {
    id: "front",
    label: "Front",
    components: [
      { id: "front-wing", parts: ["front-wing"] },
      { id: "nose-chassis", parts: ["nose-chassis"] },
      { id: "front-suspension", parts: ["front-suspension-l", "front-suspension-r"] },
      { id: "wheels", parts: ["wheel-fl", "wheel-fr"] },
    ],
  },
  { id: "cockpit", label: "Cockpit", components: [{ id: "halo-cockpit", parts: ["halo-cockpit"] }] },
  { id: "bodywork", label: "Sidepods and bodywork", components: [{ id: "sidepods-bodywork", parts: ["sidepod-l", "sidepod-r", "engine-cover"] }] },
  {
    id: "underbody",
    label: "Floor and underbody",
    components: [
      { id: "floor", parts: ["floor"] },
      { id: "diffuser", parts: ["diffuser"] },
    ],
  },
  {
    id: "rear",
    label: "Rear",
    components: [
      { id: "rear-suspension", parts: ["rear-suspension-l", "rear-suspension-r"] },
      { id: "wheels", parts: ["wheel-rl", "wheel-rr"] },
      { id: "rear-wing", parts: ["rear-wing"] },
    ],
  },
];

const PART_LABELS: Record<string, string> = {
  "wheel-fl": "Front-left wheel",
  "wheel-fr": "Front-right wheel",
  "wheel-rl": "Rear-left wheel",
  "wheel-rr": "Rear-right wheel",
  "front-suspension-l": "Left side",
  "front-suspension-r": "Right side",
  "rear-suspension-l": "Left side",
  "rear-suspension-r": "Right side",
  "sidepod-l": "Left sidepod",
  "sidepod-r": "Right sidepod",
  "engine-cover": "Engine cover",
};
/** Label for a part; single-part components use the component's own label. */
export const partLabel = (key: string) => PART_LABELS[key] ?? componentInfo(PARTS.find((p) => p.key === key)!.component).label;

export const groupParts = (g: PartGroup) => g.components.flatMap((c) => c.parts);
export const componentParts = (id: ComponentId) => PARTS.filter((p) => p.component === id).map((p) => p.key);

// ---------------------------------------------------------------------------------------------------------------------------------
// Inspection state

export type IsolateMode = "off" | "ghost" | "solo";
export type PartMode = "solid" | "ghost" | "hidden";

export interface LabState {
  selected: ComponentId | null;
  /** Parts the user hid explicitly. */
  hidden: readonly string[];
  /** Isolation of the selected component: others ghosted or hidden. Turns off when the selection is cleared. */
  isolate: IsolateMode;
  /** Transparent bodywork: shows the suspension, floor and internals behind it. */
  xray: boolean;
  /** Explode amount, 0 (assembled) to 1 (fully exploded). */
  explode: number;
  /** Name labels on the parts. */
  labels: boolean;
}

export const INITIAL_LAB: LabState = { selected: null, hidden: [], isolate: "off", xray: false, explode: 0, labels: false };

/** Bodywork that x-ray makes transparent. */
export const XRAY_COMPONENTS: readonly ComponentId[] = ["sidepods-bodywork", "nose-chassis", "halo-cockpit"];

export type LabAction =
  | { type: "select"; id: ComponentId | null }
  | { type: "toggleSelect"; id: ComponentId }
  | { type: "setPartHidden"; key: string; hidden: boolean }
  | { type: "setPartsHidden"; keys: readonly string[]; hidden: boolean }
  | { type: "isolate"; mode: IsolateMode }
  | { type: "xray"; on: boolean }
  | { type: "explode"; amount: number }
  | { type: "labels"; on: boolean }
  /** Show every part again and leave isolation and x-ray (selection and explode are kept). */
  | { type: "restoreCar" }
  /** Back to the clean, complete, assembled car with nothing selected. */
  | { type: "reset" };

export function labReducer(s: LabState, a: LabAction): LabState {
  switch (a.type) {
    case "select":
      return { ...s, selected: a.id, isolate: a.id ? s.isolate : "off" };
    case "toggleSelect":
      return s.selected === a.id ? { ...s, selected: null, isolate: "off" } : { ...s, selected: a.id };
    case "setPartHidden":
      return labReducer(s, { type: "setPartsHidden", keys: [a.key], hidden: a.hidden });
    case "setPartsHidden": {
      const set = new Set(s.hidden);
      for (const k of a.keys) {
        if (!PARTS.some((p) => p.key === k)) continue;
        if (a.hidden) set.add(k);
        else set.delete(k);
      }
      return { ...s, hidden: PARTS.map((p) => p.key).filter((k) => set.has(k)) };
    }
    case "isolate":
      return { ...s, isolate: s.selected ? a.mode : "off" };
    case "xray":
      return { ...s, xray: a.on };
    case "explode":
      return { ...s, explode: Math.min(1, Math.max(0, Number.isFinite(a.amount) ? a.amount : 0)) };
    case "labels":
      return { ...s, labels: a.on };
    case "restoreCar":
      return { ...s, hidden: [], isolate: "off", xray: false };
    case "reset":
      return INITIAL_LAB;
  }
}

/**
 * How a part is drawn. Precedence: an explicit hide wins; then isolation (the selected component stays solid, the rest is ghosted or
 * hidden); then x-ray (bodywork ghosted unless it is the selected component).
 */
export function partMode(key: string, s: Pick<LabState, "hidden" | "isolate" | "selected" | "xray">): PartMode {
  if (s.hidden.includes(key)) return "hidden";
  const component = PARTS.find((p) => p.key === key)?.component;
  if (!component) return "hidden";
  const isSelected = component === s.selected;
  if (s.selected && s.isolate !== "off" && !isSelected) return s.isolate === "solo" ? "hidden" : "ghost";
  if (s.xray && XRAY_COMPONENTS.includes(component) && !isSelected) return "ghost";
  return "solid";
}

export const partModes = (s: LabState): Record<string, PartMode> => Object.fromEntries(PARTS.map((p) => [p.key, partMode(p.key, s)]));

/** True when the scene shows the complete, assembled car with every part solid. */
export const isCompleteCar = (s: LabState) => s.explode === 0 && PARTS.every((p) => partMode(p.key, s) === "solid");

// ---------------------------------------------------------------------------------------------------------------------------------
// Setup model

/**
 * The adjustable setup is the wing angles, because they are the only setup quantities the procedural model actually implements: they
 * reshape the drawn wings and drive the illustrative airflow. Ride height, suspension, brake bias and differential are not modelled
 * (the body does not move on suspension and nothing simulates tyres or braking), so they are not offered as controls.
 */
export interface SetupParams extends WingAngles {
  /** Conceptual low-drag wing mode (flattened adjustable flaps, as on a straight). */
  lowDrag: boolean;
}

export type AngleKey = keyof WingAngles;

export interface ParamInfo {
  key: AngleKey;
  label: string;
  unit: "°";
  min: number;
  max: number;
  step: number;
  /** Conceptual effect, in words. */
  effect: string;
}

const hi = setupProfile("high-downforce").wings;
const mid = setupProfile("balanced").wings;
const lo = setupProfile("low-drag").wings;

/** Ranges span the educational presets with a small margin; they are drawing limits, not regulation or team limits. */
export const SETUP_PARAMS: readonly ParamInfo[] = [
  {
    key: "frontFlapDeg",
    label: "Front-wing flap angle",
    unit: "°",
    min: 6,
    max: 30,
    step: 1,
    effect: "More angle turns more air upwards, pressing the front axle down: more front grip and a shift in balance towards the front. Adds a little drag.",
  },
  {
    key: "rearMainDeg",
    label: "Rear-wing main plane angle",
    unit: "°",
    min: 2,
    max: 16,
    step: 1,
    effect: "More angle adds rear downforce and drag. The rear wing is the largest single source of drag that a setup changes.",
  },
  {
    key: "rearFlapDeg",
    label: "Rear-wing flap angle",
    unit: "°",
    min: 10,
    max: 48,
    step: 1,
    effect: "The upper flap adds rear downforce at a high drag cost; it is the element that flattens in the low-drag mode.",
  },
];

export const DEFAULT_SETUP: SetupParams = { ...mid, lowDrag: false };

export const presetSetup = (id: SetupProfileId): SetupParams => ({ ...setupProfile(id).wings, lowDrag: false });

export function clampSetup(p: SetupParams): SetupParams {
  const out = { ...p };
  for (const m of SETUP_PARAMS) {
    const v = Number.isFinite(p[m.key]) ? p[m.key] : DEFAULT_SETUP[m.key];
    out[m.key] = Math.min(m.max, Math.max(m.min, Math.round(v / m.step) * m.step));
  }
  return out;
}

/** The wing angles actually drawn: the low-drag mode flattens the flaps (lib/car/setup.ts lowDragWings). */
export const effectiveWings = (p: SetupParams): WingAngles => {
  const w = { frontFlapDeg: p.frontFlapDeg, rearMainDeg: p.rearMainDeg, rearFlapDeg: p.rearFlapDeg };
  return p.lowDrag ? lowDragWings(w) : w;
};

/** Position of an angle relative to the presets: 0 at balanced, +1 at high downforce, -1 at low drag (linear, extrapolated beyond). */
function presetPosition(key: AngleKey, v: number) {
  return v >= mid[key] ? (v - mid[key]) / (hi[key] - mid[key]) : (v - mid[key]) / (mid[key] - lo[key]);
}

/**
 * ILLUSTRATIVE indices (balanced = 1.00), the same relative numbers the Phase 4 presets use for arrow lengths: high downforce 1.30,
 * low drag 0.70. Model, stated in full:
 *  - each wing angle is placed on the preset scale (0 balanced, +1 high downforce, -1 low drag), linearly;
 *  - rear wing = mean of main plane and flap;
 *  - downforce index = 1 + 0.3 x (0.4 front + 0.6 rear); drag index = 1 + 0.3 x (0.2 front + 0.8 rear) (the rear wing dominates drag);
 *  - floor, bodywork and speed are not modelled, so they do not change the indices.
 * These are relative teaching numbers, not forces: no newtons, coefficients or lap times are implied.
 */
export function aeroIndices(p: SetupParams) {
  const w = effectiveWings(p);
  const front = presetPosition("frontFlapDeg", w.frontFlapDeg);
  const rear = (presetPosition("rearMainDeg", w.rearMainDeg) + presetPosition("rearFlapDeg", w.rearFlapDeg)) / 2;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const downforce = r2(Math.max(0.2, 1 + 0.3 * (0.4 * front + 0.6 * rear)));
  const drag = r2(Math.max(0.2, 1 + 0.3 * (0.2 * front + 0.8 * rear)));
  // Balance is described, not quantified: which wing is set further towards high downforce.
  const diff = front - rear;
  const balance: "front" | "neutral" | "rear" = diff > 0.25 ? "front" : diff < -0.25 ? "rear" : "neutral";
  return { downforce, drag, balance };
}

export const BALANCE_TEXT: Record<"front" | "neutral" | "rear", string> = {
  front: "Front wing set relatively steeper than the rear: balance shifts forward, which tends towards more front grip (oversteer tendency).",
  neutral: "Front and rear wings set to a similar point on the scale: no shift in balance between the axles.",
  rear: "Rear wing set relatively steeper than the front: balance shifts rearward, which tends towards more rear stability (understeer tendency).",
};

export interface SetupComparison {
  params: Array<{ key: AngleKey; label: string; a: number; b: number; delta: number }>;
  lowDrag: { a: boolean; b: boolean };
  indices: Array<{ key: "downforce" | "drag"; label: string; a: number; b: number; delta: number }>;
  balance: { a: "front" | "neutral" | "rear"; b: "front" | "neutral" | "rear" };
  identical: boolean;
}

/** Configuration B relative to A. Same car, same model: only the parameters and the illustrative indices differ. */
export function compareSetups(a: SetupParams, b: SetupParams): SetupComparison {
  const ia = aeroIndices(a);
  const ib = aeroIndices(b);
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const params = SETUP_PARAMS.map((m) => ({ key: m.key, label: m.label, a: a[m.key], b: b[m.key], delta: b[m.key] - a[m.key] }));
  return {
    params,
    lowDrag: { a: a.lowDrag, b: b.lowDrag },
    indices: [
      { key: "downforce", label: "Downforce index", a: ia.downforce, b: ib.downforce, delta: r2(ib.downforce - ia.downforce) },
      { key: "drag", label: "Drag index", a: ia.drag, b: ib.drag, delta: r2(ib.drag - ia.drag) },
    ],
    balance: { a: ia.balance, b: ib.balance },
    identical: params.every((p) => p.delta === 0) && a.lowDrag === b.lowDrag,
  };
}

/** The preset a setup matches exactly, if any. */
export const matchingPreset = (p: SetupParams): SetupProfileId | null =>
  p.lowDrag ? null : (SETUP_PROFILES.find((x) => SETUP_PARAMS.every((m) => x.wings[m.key] === p[m.key]))?.id ?? null);

// ---------------------------------------------------------------------------------------------------------------------------------
// Aerodynamics focus

export type AeroFocus = "overall" | "front-wing" | "sidepods" | "underfloor" | "rear-wing";

/**
 * Airflow focus modes. Each keeps the streamlines that pass the named area in the illustrative field (by their seed position, see
 * lib/car/airflow.ts seeds()) and the relevant tip vortices (vortices(): front, rear, front, rear for the two sides).
 */
export const AERO_FOCUS: ReadonlyArray<{ id: AeroFocus; label: string; components: readonly ComponentId[] }> = [
  { id: "overall", label: "Overall", components: [] },
  { id: "front-wing", label: "Front wing", components: ["front-wing"] },
  { id: "sidepods", label: "Sidepods", components: ["sidepods-bodywork"] },
  { id: "underfloor", label: "Underfloor and diffuser", components: ["floor", "diffuser"] },
  { id: "rear-wing", label: "Rear wing", components: ["rear-wing"] },
];

type Seed = { seed: readonly [number, number, number]; region: "over" | "side" | "under" | "vortex" };

export function keepStreamline(focus: AeroFocus, s: Seed): boolean {
  const [, y, z] = s.seed;
  const az = Math.abs(z);
  switch (focus) {
    case "overall":
      return true;
    case "front-wing":
      return s.region === "side" && y <= 0.35 && az <= 0.95;
    case "sidepods":
      return s.region === "side" && y >= 0.35 && az <= 0.65;
    case "underfloor":
      return s.region === "under";
    case "rear-wing":
      return s.region === "over" && y >= 0.9;
  }
}

export const keepVortex = (focus: AeroFocus, index: number) =>
  focus === "overall" || (focus === "front-wing" && index % 2 === 0) || (focus === "rear-wing" && index % 2 === 1);

// ---------------------------------------------------------------------------------------------------------------------------------
// Provenance of what the lab displays

/** Every number or picture the lab shows is one of these, and the UI labels it so. */
export type Evidence = "conceptual" | "simplified-model" | "sourced";

export const EVIDENCE_LABEL: Record<Evidence, string> = {
  conceptual: "Conceptual illustration",
  "simplified-model": "Simplified model (relative index)",
  sourced: "Sourced specification",
};

export const LAB_OUTPUTS: Readonly<Record<string, Evidence>> = {
  airflow: "conceptual",
  pressure: "conceptual",
  vortices: "conceptual",
  forceArrows: "simplified-model",
  downforceIndex: "simplified-model",
  dragIndex: "simplified-model",
  balance: "conceptual",
  specifications: "sourced",
};
