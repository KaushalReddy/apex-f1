import { DEMO_DRIVERS, findTeam } from "@/domain/demo";
import { DRIVER_NUMBERS } from "@/lib/car/teams";
import type { DemoEntry } from "./demo";

/**
 * Demo grid built from the project's existing driver identities (domain/demo.ts, with sourced 2026 race numbers from the car system).
 * In DEMO mode these identities drive simulated cars: the names are real, the positions, gaps and lap times are not.
 */
export function demoEntries(): DemoEntry[] {
  return DEMO_DRIVERS.map((d) => ({ id: d.slug, code: d.code, name: d.name, number: DRIVER_NUMBERS[d.slug] ?? null, teamSlug: d.teamSlug }));
}

/** Marker colour for a driver: the team's established UI colour (the same one used by team cards and markers); neutral when unknown. */
export const NEUTRAL_MARKER = "#c9ced6";
export const teamColor = (teamSlug: string | null) => (teamSlug ? findTeam(teamSlug)?.color ?? NEUTRAL_MARKER : NEUTRAL_MARKER);

/** A driver's marker colour: the source's published team colour when it has one, else the team's UI colour. */
export const driverColor = (d: { teamSlug: string | null; teamColour?: string | null }) => d.teamColour ?? teamColor(d.teamSlug);
