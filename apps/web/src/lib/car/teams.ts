import { DEMO_TEAMS, driversOf, findTeam, type DemoDriver } from "@/domain/demo";
import type { GeometryProvenance, Livery } from "./types";

/**
 * Car configuration per team. Identity (name, marker colour, line-up) comes from domain/demo.ts and is not duplicated here; the livery is
 * the car's paint, which can differ from the UI marker colour.
 * Every team currently uses the same generic procedural geometry: a different livery does NOT make it that team's car.
 */
export interface TeamCarConfig {
  teamSlug: string;
  geometry: { variant: "apex-generic-base"; provenance: GeometryProvenance };
  livery: Livery;
}

/** Team-neutral livery for the unbranded base car. */
export const NEUTRAL_LIVERY: Livery = {
  primary: "#c9ced6",
  cover: "#c9ced6",
  fin: "#252b34",
  wing: "#252b34",
  accent: "#252b34",
  halo: "#2f343c",
  rim: "#8a94a2",
  number: "#090b0e",
};

/**
 * Colour schemes approximated from side-view reference renders of the 2026 cars supplied by the project owner. Only flat colour zones are
 * used: no logos, sponsor names, graphics or textures are reproduced, and the colours are approximations, not brand specifications.
 * The references show one common silhouette for all four teams, so every team keeps the shared body (provenance "generic-procedural").
 */
const LIVERIES: Record<string, Livery> = {
  // Dark navy body and wings, yellow airbox, blue rim rings.
  "red-bull-racing": { primary: "#1c2652", cover: "#1c2652", fin: "#11152e", wing: "#1c2652", accent: "#f2c430", halo: "#1c2652", rim: "#3b6cf0", number: "#f3f5f7" },
  // Papaya body with a black upper engine cover, teal airbox top.
  mclaren: { primary: "#ff8000", cover: "#151515", fin: "#ff8000", wing: "#ff8000", accent: "#1f9fb5", halo: "#ff8000", rim: "#ff8000", number: "#151515" },
  // Red body with a white upper engine cover and airbox, black rear wing and halo.
  ferrari: { primary: "#d40f1e", cover: "#f2f2f2", fin: "#d40f1e", wing: "#151515", accent: "#f2f2f2", halo: "#151515", rim: "#2a2a2a", number: "#f3f5f7" },
  // Black throughout with a teal race number.
  mercedes: { primary: "#0d0e10", cover: "#0d0e10", fin: "#0d0e10", wing: "#0d0e10", accent: "#0d0e10", halo: "#0d0e10", rim: "#3a3f47", number: "#00d2be" },
};

export function carConfigFor(teamSlug: string): TeamCarConfig | undefined {
  const team = findTeam(teamSlug);
  const livery = LIVERIES[teamSlug];
  if (!team || !livery) return undefined;
  return { teamSlug, geometry: { variant: "apex-generic-base", provenance: "generic-procedural" }, livery };
}

export const CAR_CONFIGS: readonly TeamCarConfig[] = DEMO_TEAMS.map((t) => carConfigFor(t.slug)).filter((c): c is TeamCarConfig => !!c);

/** Race numbers for the 2026 season, keyed by domain driver slug. Source: formula1.com, "All the 2026 F1 driver numbers confirmed in full". */
export const DRIVER_NUMBERS_SOURCE = {
  title: "Formula 1: All the 2026 F1 driver numbers confirmed in full",
  url: "https://www.formula1.com/en/latest/article/all-the-2026-f1-driver-numbers-confirmed-in-full.5rh7o9mPntG7NerzVk9onc",
  season: 2026,
} as const;

export const DRIVER_NUMBERS: Readonly<Record<string, number>> = {
  norris: 1,
  piastri: 81,
  verstappen: 3,
  leclerc: 16,
  hamilton: 44,
  russell: 63,
};

export interface CarDriver extends DemoDriver {
  /** Undefined when no sourced number exists: the car then shows no number rather than an invented one. */
  number?: number;
}

export const carDriversOf = (teamSlug: string): CarDriver[] => driversOf(teamSlug).map((d) => ({ ...d, number: DRIVER_NUMBERS[d.slug] }));
