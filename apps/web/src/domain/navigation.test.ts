import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_NAV_LINKS, ANALYSIS_HUB, NAV_ITEMS, PRIMARY_NAV, PRODUCT_NAV, getNavItem, isActivePath } from "./navigation";

const appDir = path.join(process.cwd(), "src", "app");

describe("navigation structure", () => {
  it("lists the primary and secondary navigation exactly as designed", () => {
    expect(PRIMARY_NAV.map((i) => i.label)).toEqual(["Live", "Drivers", "Teams", "Cars", "Circuits", "Standings"]);
    expect([ANALYSIS_HUB, ...PRODUCT_NAV].map((i) => i.label)).toEqual(["Analysis", "Replay", "Telemetry", "Strategy", "Race Engineer"]);
  });

  it("has unique, absolute hrefs and no label that is not a destination (the old 'Analysis' bare label bug)", () => {
    const hrefs = ALL_NAV_LINKS.map((l) => l.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const h of hrefs) expect(h).toMatch(/^\/[a-z-]+$/);
    expect(ALL_NAV_LINKS.map((l) => l.label)).toContain("Analysis");
  });

  it.each(ALL_NAV_LINKS.map((l) => [l.label, l.href]))("%s -> %s has a page in the app directory (no dead links)", (_label, href) => {
    expect(existsSync(path.join(appDir, href, "page.tsx"))).toBe(true);
  });

  it("every NAV_ITEMS entry resolves through getNavItem and carries a roadmap phase", () => {
    for (const i of NAV_ITEMS) {
      expect(getNavItem(i.href)).toBe(i);
      expect(Number.isInteger(i.phase)).toBe(true);
    }
    expect(() => getNavItem("/nope")).toThrow();
  });
});

describe("active route matching", () => {
  it("matches the exact path and its nested routes, never a sibling that merely shares a prefix", () => {
    expect(isActivePath("/drivers", "/drivers")).toBe(true);
    expect(isActivePath("/drivers/norris", "/drivers")).toBe(true);
    expect(isActivePath("/driversx", "/drivers")).toBe(false);
    expect(isActivePath("/analysis", "/analysis")).toBe(true);
    expect(isActivePath("/replay", "/analysis")).toBe(false);
    expect(isActivePath("/", "/live")).toBe(false);
  });
});
