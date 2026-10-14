import { findCircuitById } from "@/lib/circuit/catalog";
import type { WingAngles } from "./geometry";
import type { SetupProfileId } from "./types";

/**
 * EDUCATIONAL presets, not team setups. Angles only change how the procedural wings are drawn; `downforce` and `drag` are relative
 * arrow lengths for the illustration (balanced = 1). They are not measured or simulated quantities and must never be shown as numbers.
 */
export interface SetupProfile {
  id: SetupProfileId;
  label: string;
  summary: string;
  wings: WingAngles;
  relative: { downforce: number; drag: number };
}

export const SETUP_PROFILES: readonly SetupProfile[] = [
  {
    id: "high-downforce",
    label: "High downforce",
    summary: "Steeper wings for more grip in slow and medium corners, accepting more drag on the straights.",
    wings: { frontFlapDeg: 26, rearMainDeg: 14, rearFlapDeg: 44 },
    relative: { downforce: 1.3, drag: 1.3 },
  },
  {
    id: "balanced",
    label: "Balanced",
    summary: "A middle setting that trades some cornering grip against some straight-line speed.",
    wings: { frontFlapDeg: 18, rearMainDeg: 9, rearFlapDeg: 30 },
    relative: { downforce: 1, drag: 1 },
  },
  {
    id: "low-drag",
    label: "Low drag",
    summary: "Flatter wings for less drag and higher straight-line speed, giving up some cornering grip.",
    wings: { frontFlapDeg: 10, rearMainDeg: 4, rearFlapDeg: 14 },
    relative: { downforce: 0.7, drag: 0.7 },
  },
];

export const DEFAULT_PROFILE: SetupProfileId = "balanced";

/**
 * CONCEPTUAL low-drag wing mode: the adjustable flaps lie flatter (as on a straight), main planes unchanged. Illustrative angles only;
 * not any team's or the regulations' actual values.
 */
export const lowDragWings = (w: WingAngles): WingAngles => ({ ...w, frontFlapDeg: w.frontFlapDeg * 0.5, rearFlapDeg: Math.min(w.rearFlapDeg, 6) });

export function setupProfile(id: SetupProfileId): SetupProfile {
  const p = SETUP_PROFILES.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown setup profile: ${id}`);
  return p;
}

/**
 * Qualitative circuit context: how each circuit is commonly described, linked to the preset that best illustrates it.
 * This is general background for learning, not a setup recommendation. Only circuits present in the domain model are listed.
 */
export interface CircuitContext {
  circuitSlug: string;
  name: string;
  character: string;
  illustrates: SetupProfileId;
}

const CONTEXT: ReadonlyArray<Omit<CircuitContext, "name">> = [
  {
    circuitSlug: "monaco",
    character: "A slow, tight street circuit with short straights. It is usually described as the season's highest-downforce venue.",
    illustrates: "high-downforce",
  },
  {
    circuitSlug: "monza",
    character: "Long straights and few slow corners. It is usually described as the lowest-drag venue of the season.",
    illustrates: "low-drag",
  },
  {
    circuitSlug: "silverstone",
    character: "Fast, flowing corners linked by straights, usually described as needing a compromise between the two.",
    illustrates: "balanced",
  },
];

export const CIRCUIT_CONTEXTS: readonly CircuitContext[] = CONTEXT.flatMap((c) => {
  const circuit = findCircuitById(c.circuitSlug);
  return circuit ? [{ ...c, name: circuit.shortName }] : [];
});
