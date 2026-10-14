import { DEMO_TEAMS, type DemoTeam } from "@/domain/demo";
import { circuitByShortName } from "@/lib/circuit/catalog";
import type { DriverIdentity, SeasonResults } from "./types";

/**
 * Stable driver identity. A driver's key is the official three-letter acronym (stable across seasons; race numbers change, e.g. 4 -> 1),
 * and the URL slug is derived from the published last name (lowercase ASCII), so the project's existing slugs (norris, piastri, ...) stay
 * valid. A slug collision across drivers falls back to "<lastname>-<acronym>".
 */
/** Letters that Unicode decomposition does not split into a base letter plus accent. */
const LIGATURES: Record<string, string> = { æ: "ae", ø: "o", ß: "ss", đ: "d", ł: "l", þ: "th", œ: "oe" };

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[æøßđłþœ]/g, (c) => LIGATURES[c])
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

export interface DriverRef {
  slug: string;
  acronym: string;
  name: string;
  countryCode: string | null;
}

/** Merges identities from every season (latest season wins for names) and assigns collision-free slugs. */
export function driverRegistry(seasons: readonly SeasonResults[]): DriverRef[] {
  const byAcronym = new Map<string, DriverIdentity>();
  for (const s of [...seasons].sort((a, b) => a.season - b.season)) for (const d of s.drivers) if (!d.acronym.startsWith("#")) byAcronym.set(d.acronym, d);
  const base = [...byAcronym.values()].map((d) => ({ d, slug: slugify(d.lastName ?? d.fullName ?? d.acronym) || slugify(d.acronym) }));
  const count = new Map<string, number>();
  for (const b of base) count.set(b.slug, (count.get(b.slug) ?? 0) + 1);
  return base
    .map(({ d, slug }) => ({
      slug: (count.get(slug) ?? 0) > 1 ? `${slug}-${d.acronym.toLowerCase()}` : slug,
      acronym: d.acronym,
      name: d.fullName ? titleCase(d.fullName) : d.acronym,
      countryCode: d.countryCode,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** OpenF1 writes last names in capitals ("Lando NORRIS"); display them in title case. */
export const titleCase = (name: string) => name.replace(/\p{L}+/gu, (w) => (w === w.toUpperCase() && w.length > 1 ? w[0] + w.slice(1).toLowerCase() : w));

/** The project's team record for a published team name, when one exists (only those teams have pages). */
export const domainTeam = (teamName: string | null): DemoTeam | undefined =>
  teamName ? DEMO_TEAMS.find((t) => t.name.toLowerCase() === teamName.toLowerCase()) : undefined;

/** Team colour: the project's own team colour when the team exists there (one source of truth), else the colour the source publishes. */
export function teamColour(season: SeasonResults, teamName: string | null): string {
  const t = domainTeam(teamName);
  if (t) return t.color;
  for (const d of season.drivers) for (const team of d.teams) if (team.name === teamName && team.colour) return team.colour;
  return "#8a94a2";
}

/** The circuit page for a circuit short name as published by OpenF1 (results snapshots), via the circuit catalog. */
export const circuitPage = (circuitShortName: string | null) => circuitByShortName(circuitShortName)?.id;
