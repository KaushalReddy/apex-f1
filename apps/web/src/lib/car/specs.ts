import type { ComponentId } from "./types";

/**
 * Car specification schema. Independent of geometry, livery, driver identity and telemetry, so the Team (Phase 7) and Car Lab (Phase 8)
 * pages can consume it directly. Values keep their source's units and wording. Nothing is filled in without a source: a missing value is
 * `status: "unavailable"` with `value: null`, never a guess.
 */
export type SpecStatus =
  /** Checked against the primary source document (e.g. the published regulation text). */
  | "verified"
  /** Published by an announcement or secondary source; not checked against the primary document. */
  | "reported"
  /** Sources disagree; the value shown is one of them and the note says how they differ. */
  | "conflicting"
  /** No source has been gathered. */
  | "unavailable";

export interface SpecSource {
  title: string;
  url: string;
  /** Date the source was consulted (ISO). */
  accessed: string;
}

export interface SpecValue {
  label: string;
  value: string | null;
  unit?: string;
  status: SpecStatus;
  season: number;
  source?: SpecSource;
  note?: string;
}

/** Fields shared by every car sheet; component-level entries link to the selectable assemblies. */
export interface CarSpecSheet {
  teamSlug: string;
  season: number;
  designation: SpecValue;
  powerUnit: SpecValue;
  transmission: SpecValue;
  chassis: SpecValue;
  /** Team-published dimensions and mass. Regulation limits apply to all teams and live in REGULATION_SPECS instead. */
  dimensions: SpecValue[];
  components: Partial<Record<ComponentId, SpecValue[]>>;
  /** Whether the 3D model reflects this team's real geometry. Currently always generic. */
  geometry: { provenance: "generic-procedural"; note: string };
}

const ACCESSED = "2026-10-13";
const FIA_2026: SpecSource = {
  title: "FIA: A New Era of Competition, Formula 1 regulations for 2026 and beyond (June 2024 announcement)",
  url: "https://fia.com/node/51855",
  accessed: ACCESSED,
};
const WIKI_2026: SpecSource = {
  title: "Wikipedia: 2026 Formula One World Championship (entries table)",
  url: "https://en.wikipedia.org/wiki/2026_Formula_One_World_Championship",
  accessed: ACCESSED,
};
const PLANETF1_NAMES: SpecSource = {
  title: "PlanetF1: What name has each team given its chassis for the 2026 season?",
  url: "https://www.planetf1.com/news/f1-2026-cars-chassis-names",
  accessed: ACCESSED,
};

const NOT_CHECKED = "From the FIA announcement; not yet checked against the current published Technical Regulations text.";

/** Regulation limits that apply to every 2026 car. They are limits, not any team's measured values. */
export const REGULATION_SPECS: readonly SpecValue[] = [
  { label: "Maximum car width", value: "1900", unit: "mm", status: "reported", season: 2026, source: FIA_2026, note: NOT_CHECKED },
  { label: "Maximum wheelbase", value: "3400", unit: "mm", status: "reported", season: 2026, source: FIA_2026, note: NOT_CHECKED },
  { label: "Minimum mass", value: "768", unit: "kg", status: "reported", season: 2026, source: FIA_2026, note: NOT_CHECKED },
  { label: "Wheel rim diameter", value: "18", unit: "in", status: "reported", season: 2026, source: FIA_2026, note: "Unchanged from 2022-2025 per the announcement." },
];

const unavailable = (label: string): SpecValue => ({ label, value: null, status: "unavailable", season: 2026 });
const reported = (label: string, value: string, source: SpecSource, note?: string): SpecValue => ({ label, value, status: "reported", season: 2026, source, note });

const GENERIC_NOTE = "The 3D model is APEX F1's generic procedural car in this team's colours. It is not this team's car geometry.";

function sheet(teamSlug: string, designation: SpecValue, powerUnit: SpecValue): CarSpecSheet {
  return {
    teamSlug,
    season: 2026,
    designation,
    powerUnit,
    transmission: unavailable("Transmission"),
    chassis: unavailable("Chassis construction"),
    dimensions: [unavailable("Overall length"), unavailable("Wheelbase (team-published)")],
    components: {},
    geometry: { provenance: "generic-procedural", note: GENERIC_NOTE },
  };
}

export const CAR_SPECS: readonly CarSpecSheet[] = [
  sheet("mclaren", reported("Car", "MCL40", PLANETF1_NAMES), reported("Power unit", "Mercedes-AMG F1 M17", WIKI_2026)),
  sheet("ferrari", reported("Car", "SF-26", PLANETF1_NAMES), reported("Power unit", "Ferrari 067/6", WIKI_2026)),
  sheet("mercedes", reported("Car", "F1 W17", PLANETF1_NAMES), reported("Power unit", "Mercedes-AMG F1 M17", WIKI_2026)),
  sheet("red-bull-racing", reported("Car", "RB22", PLANETF1_NAMES), {
    ...reported("Power unit", "Red Bull Ford DM01", WIKI_2026),
    status: "conflicting",
    note: "Some sources name the supplier Red Bull Powertrains rather than Red Bull Ford.",
  }),
];

export const specsFor = (teamSlug: string) => CAR_SPECS.find((s) => s.teamSlug === teamSlug);

/** Every SpecValue in a sheet, for display and validation. */
export const allSpecValues = (s: CarSpecSheet): SpecValue[] => [
  s.designation,
  s.powerUnit,
  s.transmission,
  s.chassis,
  ...s.dimensions,
  ...Object.values(s.components).flat(),
];

/** Schema rule: a value is present exactly when the status says it is sourced, and a sourced value always names its source. */
export function specProblems(v: SpecValue): string[] {
  const out: string[] = [];
  if (v.status === "unavailable" && v.value !== null) out.push(`${v.label}: unavailable but has a value`);
  if (v.status !== "unavailable" && (v.value === null || v.value === "")) out.push(`${v.label}: no value for status ${v.status}`);
  if (v.status !== "unavailable" && !v.source) out.push(`${v.label}: ${v.status} value without a source`);
  if (v.status === "conflicting" && !v.note) out.push(`${v.label}: conflicting value without a note`);
  if (v.source && !/^https:\/\//.test(v.source.url)) out.push(`${v.label}: source url is not https`);
  return out;
}
