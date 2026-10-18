export type NavGroup = "primary" | "product";

export interface NavItem {
  href: string;
  label: string;
  group: NavGroup;
  summary: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/live", label: "Live", group: "primary", summary: "Live timing when a session is running; between sessions, the latest Grand Prix replayed in 3D." },
  { href: "/drivers", label: "Drivers", group: "primary", summary: "Every driver on the grid: season results, form and head-to-heads." },
  { href: "/teams", label: "Teams", group: "primary", summary: "The constructors, their line-ups and their season, race by race." },
  { href: "/cars", label: "Cars", group: "primary", summary: "Take a car apart in 3D: components, airflow and wing setups." },
  { href: "/circuits", label: "Circuits", group: "primary", summary: "Every Grand Prix venue since 2023, rebuilt in 3D from real car positions where the data allows." },
  { href: "/standings", label: "Standings", group: "primary", summary: "The drivers' and constructors' championships, after every round." },
  { href: "/replay", label: "Replay", group: "product", summary: "A whole Grand Prix on its 3D circuit, every car where it really was. Scrub, compare two drivers, rewind a battle." },
  { href: "/telemetry", label: "Telemetry", group: "product", summary: "Two fastest laps, trace against trace: speed, throttle, brake, gear and RPM, with both cars on the circuit." },
  { href: "/strategy", label: "Strategy", group: "product", summary: "Tyre stints, pit stops and degradation for the whole field, with a clearly labelled what‑if." },
  { href: "/race-engineer", label: "Race Engineer", group: "product", summary: "Ask about a race in plain English. Answers come from the race data, with every look‑up shown." },
];

export const PRIMARY_NAV = NAV_ITEMS.filter((i) => i.group === "primary");
export const PRODUCT_NAV = NAV_ITEMS.filter((i) => i.group === "product");

export function getNavItem(href: string): NavItem {
  const item = NAV_ITEMS.find((i) => i.href === href);
  if (!item) throw new Error(`Unknown nav item: ${href}`);
  return item;
}

export function isActivePath(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * "Analysis" heads the secondary navigation. It is a real destination (an index of the analysis tools), so it is a link like its
 * siblings and never a bare label that looks clickable but is not.
 */
export const ANALYSIS_HUB = {
  href: "/analysis",
  label: "Analysis",
  summary: "The tools for reading a race: replay it, compare the laps, follow the strategy, ask the engineer.",
} as const;

/** Every top-level destination once, in display order: primary, then the Analysis hub, then the four tools. */
export const ALL_NAV_LINKS: ReadonlyArray<{ href: string; label: string }> = [...PRIMARY_NAV, ANALYSIS_HUB, ...PRODUCT_NAV];
