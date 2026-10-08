/**
 * STATIC PREVIEW CONTENT. Not live, not sourced from a data provider.
 * Names and colours only: no results, points, ratings or statistics are included on purpose.
 * Line-ups and colours are placeholders [VERIFY]; replaced by normalized API data in Phase 2+.
 * Team colours are plain hex markers, not official brand assets.
 */
export interface DemoTeam {
  slug: string;
  name: string;
  color: string;
}
export interface DemoDriver {
  slug: string;
  name: string;
  code: string;
  teamSlug: string;
}
export interface DemoCircuit {
  slug: string;
  name: string;
  country: string;
}

export const DEMO_TEAMS: readonly DemoTeam[] = [
  { slug: "mclaren", name: "McLaren", color: "#ff8000" },
  { slug: "ferrari", name: "Ferrari", color: "#dc0000" },
  { slug: "mercedes", name: "Mercedes", color: "#27f4d2" },
  { slug: "red-bull-racing", name: "Red Bull Racing", color: "#3671c6" },
];

export const DEMO_DRIVERS: readonly DemoDriver[] = [
  { slug: "norris", name: "Lando Norris", code: "NOR", teamSlug: "mclaren" },
  { slug: "piastri", name: "Oscar Piastri", code: "PIA", teamSlug: "mclaren" },
  { slug: "verstappen", name: "Max Verstappen", code: "VER", teamSlug: "red-bull-racing" },
  { slug: "leclerc", name: "Charles Leclerc", code: "LEC", teamSlug: "ferrari" },
  { slug: "hamilton", name: "Lewis Hamilton", code: "HAM", teamSlug: "ferrari" },
  { slug: "russell", name: "George Russell", code: "RUS", teamSlug: "mercedes" },
];

/** Same circuits as the OpenF1 spike matrix (tools/openf1-spike/run_matrix.sh). */
export const DEMO_CIRCUITS: readonly DemoCircuit[] = [
  { slug: "monza", name: "Monza", country: "Italy" },
  { slug: "spa-francorchamps", name: "Spa-Francorchamps", country: "Belgium" },
  { slug: "suzuka", name: "Suzuka", country: "Japan" },
  { slug: "silverstone", name: "Silverstone", country: "United Kingdom" },
  { slug: "monaco", name: "Monaco", country: "Monaco" },
];

export const findDriver = (slug: string) => DEMO_DRIVERS.find((d) => d.slug === slug);
export const findTeam = (slug: string) => DEMO_TEAMS.find((t) => t.slug === slug);
export const findCircuit = (slug: string) => DEMO_CIRCUITS.find((c) => c.slug === slug);
export const driversOf = (teamSlug: string) => DEMO_DRIVERS.filter((d) => d.teamSlug === teamSlug);
