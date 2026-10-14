import { driversOf, type DemoDriver } from "@/domain/demo";
import type { SeasonResults } from "@/lib/drivers/types";
import { findTeamBySlug, TEAMS } from "@/lib/teams/registry";
import { teamLineup } from "@/lib/teams/stats";
import type { GeometryProvenance, Livery } from "./types";

/**
 * Car configuration per team. Identity (name, line-up) comes from the team registry (lib/teams/registry.ts) and is not duplicated here; the livery is
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
 * Colour schemes approximated from side-view reference renders of the 2026 cars supplied by the project owner (public/teams/cars for the
 * eleven-team set). Only flat colour zones are used: no logos, sponsor names, graphics or textures are reproduced, and the colours are
 * approximations, not brand specifications. Every team keeps the shared body (provenance "generic-procedural"): the references are side
 * views of livery, not geometry, so they cannot make the model any team's car.
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
  // White nose and sidepods with royal-blue lower bodywork, dark navy engine cover and rear wing, yellow airbox.
  "racing-bulls": { primary: "#eef0f4", cover: "#1d2a6b", fin: "#141a3a", wing: "#141a3a", accent: "#f2c430", halo: "#141a3a", rim: "#2f5bd8", number: "#d4202c" },
  // Blue body, black engine cover, pink rear-wing endplates and halo.
  alpine: { primary: "#2d8fe3", cover: "#141414", fin: "#141414", wing: "#ef7ac0", accent: "#2d8fe3", halo: "#ef7ac0", rim: "#1c1c1c", number: "#f3f5f7" },
  // White body with red flashes, grey rear wing, black halo.
  haas: { primary: "#f2f2f2", cover: "#f2f2f2", fin: "#d81f26", wing: "#b9bcc0", accent: "#d81f26", halo: "#151515", rim: "#2a2a2a", number: "#151515" },
  // Silver body, red band on the engine cover, black rear wing and fin.
  audi: { primary: "#c9ccd1", cover: "#e2312b", fin: "#151515", wing: "#151515", accent: "#c9ccd1", halo: "#c9ccd1", rim: "#2a2a2a", number: "#151515" },
  // Royal-blue body, orange airbox, purple rim rings.
  williams: { primary: "#1c4fd6", cover: "#1c4fd6", fin: "#0e2a7a", wing: "#1c4fd6", accent: "#f0a020", halo: "#1c4fd6", rim: "#9b5cf0", number: "#f3f5f7" },
  // British racing green with lime accents.
  "aston-martin": { primary: "#0f6b52", cover: "#0f6b52", fin: "#0f6b52", wing: "#0f6b52", accent: "#c7e000", halo: "#0f6b52", rim: "#1a1a1a", number: "#f3f5f7" },
  // Black body, graphite engine cover, light-grey rear wing, white rim rings.
  cadillac: { primary: "#151515", cover: "#2b2b2b", fin: "#151515", wing: "#bfbfbf", accent: "#151515", halo: "#151515", rim: "#e8e8e8", number: "#f3f5f7" },
};

export function carConfigFor(teamSlug: string): TeamCarConfig | undefined {
  const team = findTeamBySlug(teamSlug);
  const livery = LIVERIES[teamSlug];
  if (!team || !livery) return undefined;
  return { teamSlug, geometry: { variant: "apex-generic-base", provenance: "generic-procedural" }, livery };
}

export const CAR_CONFIGS: readonly TeamCarConfig[] = TEAMS.map((t) => carConfigFor(t.slug)).filter((c): c is TeamCarConfig => !!c);

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

/**
 * The team's drivers for the car pages: its two most frequent starters in the latest exported season (the same line-up for every team).
 * Race numbers: the formula1.com-sourced numbers above where they exist, otherwise the number published in the OpenF1 classifications.
 * Without season data, falls back to the race-demo line-up.
 */
export function carDriversFor(teamSlug: string, seasons: readonly SeasonResults[]): CarDriver[] {
  const team = findTeamBySlug(teamSlug);
  const lineup = team && seasons.length ? teamLineup(seasons[0], team, seasons).slice(0, 2) : [];
  if (!lineup.length) return carDriversOf(teamSlug);
  return lineup.map((d) => ({
    slug: d.slug ?? d.acronym.toLowerCase(),
    name: d.name,
    code: d.acronym,
    teamSlug,
    number: (d.slug ? DRIVER_NUMBERS[d.slug] : undefined) ?? d.number ?? undefined,
  }));
}
