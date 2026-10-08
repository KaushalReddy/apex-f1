export type NavGroup = "primary" | "product";

export interface NavItem {
  href: string;
  label: string;
  group: NavGroup;
  /** Roadmap phase (docs/ROADMAP.md) in which the feature becomes real. */
  phase: number;
  summary: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/live", label: "Live", group: "primary", phase: 5, summary: "Interactive 3D circuit with real driver positions, leaderboard and gaps." },
  { href: "/drivers", label: "Drivers", group: "primary", phase: 6, summary: "Profiles, results, recent form and teammate comparison." },
  { href: "/teams", label: "Teams", group: "primary", phase: 7, summary: "Constructor identity, line-ups, results and history." },
  { href: "/cars", label: "Cars", group: "primary", phase: 8, summary: "Interactive 3D car lab with component hotspots and exploded view." },
  { href: "/circuits", label: "Circuits", group: "primary", phase: 9, summary: "Layouts, corners, DRS zones and historical results." },
  { href: "/standings", label: "Standings", group: "primary", phase: 6, summary: "Driver and constructor championship tables." },
  { href: "/replay", label: "Replay", group: "product", phase: 11, summary: "Reconstruct a past session in 3D with full playback controls." },
  { href: "/telemetry", label: "Telemetry", group: "product", phase: 10, summary: "Compare drivers on speed, throttle, brake and gear, linked to the 3D circuit." },
  { href: "/strategy", label: "Strategy", group: "product", phase: 13, summary: "Tyre stints, pit windows and clearly labelled what-if simulations." },
  { href: "/race-engineer", label: "Race Engineer", group: "product", phase: 14, summary: "Ask questions answered only from the platform's own race data." },
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
