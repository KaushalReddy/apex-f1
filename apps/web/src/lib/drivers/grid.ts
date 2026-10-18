/**
 * The grid in display order (the owner's chosen line-up, team by team), with each driver's portrait. One place for the order: the drivers
 * directory sorts by it by default, and every other order is derived elsewhere. Keyed by driver code (stable across seasons); names,
 * numbers and teams always come from the season's published data, never from here.
 *
 * Portraits (public/drivers/<slug>.webp) are the owner-supplied team photos, converted losslessly (pixel-identical, transparency kept).
 */
export interface GridDriver {
  acronym: string;
  slug: string;
  portrait: string | null;
}

const d = (acronym: string, slug: string): GridDriver => ({ acronym, slug, portrait: `/drivers/${slug}.webp` });

export const DRIVER_GRID: ReadonlyArray<{ team: string; drivers: readonly [GridDriver, GridDriver] }> = [
  { team: "Mercedes", drivers: [d("RUS", "russell"), d("ANT", "antonelli")] },
  { team: "Ferrari", drivers: [d("LEC", "leclerc"), d("HAM", "hamilton")] },
  { team: "McLaren", drivers: [d("NOR", "norris"), d("PIA", "piastri")] },
  { team: "Red Bull Racing", drivers: [d("VER", "verstappen"), d("HAD", "hadjar")] },
  { team: "Racing Bulls", drivers: [d("LAW", "lawson"), d("LIN", "lindblad")] },
  { team: "Alpine", drivers: [d("GAS", "gasly"), d("COL", "colapinto")] },
  { team: "Haas F1 Team", drivers: [d("OCO", "ocon"), d("BEA", "bearman")] },
  { team: "Audi", drivers: [d("HUL", "hulkenberg"), d("BOR", "bortoleto")] },
  { team: "Williams", drivers: [d("SAI", "sainz"), d("ALB", "albon")] },
  { team: "Aston Martin", drivers: [d("ALO", "alonso"), d("STR", "stroll")] },
  { team: "Cadillac", drivers: [d("PER", "perez"), d("BOT", "bottas")] },
];

const FLAT = DRIVER_GRID.flatMap((t) => t.drivers);
const RANK = new Map(FLAT.map((x, i) => [x.acronym, i]));
const TEAM_RANK = new Map(DRIVER_GRID.map((t, i) => [t.team, i]));

/** Position of a driver in the grid order; drivers not on it (e.g. a mid-season replacement) sort after everyone who is. */
export const gridRank = (acronym: string) => RANK.get(acronym) ?? Number.POSITIVE_INFINITY;
/** Position of a team in the grid order (for drivers not on the grid: they follow, grouped by their team). */
export const teamRank = (team: string | null) => (team != null ? (TEAM_RANK.get(team) ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY);
/** Supplied photos of drivers who are not on the grid above but raced in a season shown (sorted after it). */
const OFF_GRID: Record<string, string> = {
  TSU: "/drivers/tsunoda-v2.webp", // new name, new URL: image caches keyed on the old one cannot serve the replaced photo
};

/** The supplied portrait for a driver code, or null (no photo supplied: the card shows none rather than a stand-in). */
export const portraitOf = (acronym: string): string | null => FLAT.find((x) => x.acronym === acronym)?.portrait ?? OFF_GRID[acronym] ?? null;
