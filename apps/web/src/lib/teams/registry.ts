/**
 * The eleven constructors in their canonical directory order (the order of the supplied reference page; not alphabetical, not by
 * standings). A team's identity is its slug; `aliases` are the names the results source publishes for the same entry in earlier
 * seasons (Racing Bulls raced as "RB" in 2024; Audi took over the Sauber entry, which raced as "Kick Sauber" in 2024-2025). Pages show
 * the season's published name, so a historical season is never relabelled.
 *
 * Car images: side-view livery renders supplied by the project owner (public/teams/cars). Their origin and reuse rights are NOT verified;
 * they are team and sponsor artwork, so confirm the rights before any public deployment. `image: null` falls back to a colour panel.
 * Every team has a procedural 3D car (/cars/<slug>, lib/car/teams.ts); tested.
 */
export interface Team {
  slug: string;
  name: string;
  /** Short code for search and the identity mark. */
  code: string;
  aliases: readonly string[];
  image: { src: string; width: number; height: number } | null;
}

const img = (slug: string, width = 1018, height = 224) => ({ src: `/teams/cars/${slug}.png`, width, height });
const team = (slug: string, name: string, code: string, aliases: string[] = [], image = img(slug)): Team => ({
  slug, name, code, aliases: [name, ...aliases], image,
});

export const TEAMS: readonly Team[] = [
  team("mercedes", "Mercedes", "MER", [], img("mercedes", 1200, 264)),
  team("ferrari", "Ferrari", "FER"),
  team("mclaren", "McLaren", "MCL"),
  team("red-bull-racing", "Red Bull Racing", "RBR"),
  team("racing-bulls", "Racing Bulls", "RB", ["RB", "Visa Cash App RB"], img("racing-bulls", 1017)),
  team("alpine", "Alpine", "ALP"),
  team("haas", "Haas F1 Team", "HAA", ["Haas"], img("haas", 971, 224)),
  team("audi", "Audi", "AUD", ["Kick Sauber", "Sauber"]),
  team("williams", "Williams", "WIL", [], img("williams", 1017)),
  team("aston-martin", "Aston Martin", "AMR"),
  team("cadillac", "Cadillac", "CAD"),
];

export const findTeamBySlug = (slug: string) => TEAMS.find((t) => t.slug === slug);

/** The team entry for a name the results source published (any season), or undefined. */
export const teamFor = (published: string | null | undefined) =>
  published ? TEAMS.find((t) => t.aliases.some((a) => a.toLowerCase() === published.toLowerCase())) : undefined;

const luminance = (rgb: number[]) =>
  rgb.map((c) => c / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)).reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);

/**
 * The team colour darkened just enough for white text to reach 4.5:1 (relative luminance <= 0.183); already-dark colours are unchanged.
 * Keeps the hue recognisable while every card uses the same white type.
 */
export function cardShade(hex: string): string {
  let rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  while (luminance(rgb) > 0.183) rgb = rgb.map((c) => Math.floor(c * 0.97));
  return `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}
