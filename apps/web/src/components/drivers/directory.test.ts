import { describe, expect, it } from "vitest";
import type { DirectoryEntry } from "@/lib/drivers/views";
import { existsSync } from "node:fs";
import { DRIVER_GRID, portraitOf } from "@/lib/drivers/grid";
import { loadSeasons } from "@/lib/drivers/load";
import { directory } from "@/lib/drivers/views";
import { filterDrivers } from "./DriverDirectory";

const d = (acronym: string, name: string, team: string, pos: number | null, wins: number, number: number): DirectoryEntry => ({
  slug: name.split(" ")[1].toLowerCase(), acronym, name, countryCode: null, team, teamColour: "#fff", number,
  championshipPosition: pos, championshipPoints: null, wins, podiums: 0, starts: 10,
});
const list = [
  d("NOR", "Lando Norris", "McLaren", 2, 5, 1),
  d("PIA", "Oscar Piastri", "McLaren", 3, 6, 81),
  d("HUL", "Nico Hülkenberg", "Sauber", null, 0, 27),
  d("VER", "Max Verstappen", "Red Bull Racing", 1, 7, 3),
];
const ids = (xs: DirectoryEntry[]) => xs.map((x) => x.acronym);

describe("driver directory filtering", () => {
  it("searches names (accent- and case-insensitive) and acronyms", () => {
    expect(ids(filterDrivers(list, { query: "hulk", team: "", sort: "name" }))).toEqual(["HUL"]);
    expect(ids(filterDrivers(list, { query: "PIA", team: "", sort: "name" }))).toEqual(["PIA"]);
    expect(ids(filterDrivers(list, { query: "zzz", team: "", sort: "name" }))).toEqual([]);
  });

  it("filters by team and sorts, with unknown championship positions last", () => {
    expect(ids(filterDrivers(list, { query: "", team: "McLaren", sort: "championship" }))).toEqual(["NOR", "PIA"]);
    expect(ids(filterDrivers(list, { query: "", team: "", sort: "championship" }))).toEqual(["VER", "NOR", "PIA", "HUL"]);
    expect(ids(filterDrivers(list, { query: "", team: "", sort: "wins" }))).toEqual(["VER", "PIA", "NOR", "HUL"]);
    expect(ids(filterDrivers(list, { query: "", team: "", sort: "number" }))).toEqual(["NOR", "VER", "HUL", "PIA"]);
  });
});

// REAL DATA: the bundled 2026 season results.
const d2026 = directory((await loadSeasons()).seasons).find((s) => s.meta.season === 2026)!;

describe("grid order (lib/drivers/grid.ts) on the real 2026 data", () => {
  // The owner's order, team by team (as specified).
  const ORDER = ["RUS", "ANT", "LEC", "HAM", "NOR", "PIA", "VER", "HAD", "LAW", "LIN", "GAS", "COL", "OCO", "BEA", "HUL", "BOR", "SAI", "ALB", "ALO", "STR", "PER", "BOT"];

  it("is the default and renders exactly that order, with any other 2026 driver after it", () => {
    const list = filterDrivers(d2026.drivers, { query: "", team: "", sort: "grid" }).map((d) => d.acronym);
    expect(list.slice(0, 22)).toEqual(ORDER);
    expect(list.slice(22)).toEqual(d2026.drivers.filter((d) => !ORDER.includes(d.acronym)).map((d) => d.acronym));
  });

  it("keeps the grid order inside a team filter, and pairs each team's drivers with that team's data", () => {
    expect(filterDrivers(d2026.drivers, { query: "", team: "Red Bull Racing", sort: "grid" }).map((d) => d.acronym)).toEqual(["VER", "HAD"]);
    for (const t of DRIVER_GRID) for (const g of t.drivers) expect(d2026.drivers.find((d) => d.acronym === g.acronym)?.team, g.acronym).toBe(t.team);
  });

  it("has a supplied portrait on disk for every grid driver and for Tsunoda, and none otherwise", () => {
    for (const code of ORDER) expect(existsSync(`public${portraitOf(code)}`), code).toBe(true);
    expect(portraitOf("TSU")).toBe("/drivers/tsunoda-v2.webp");
    expect(existsSync("public/drivers/tsunoda-v2.webp")).toBe(true);
    expect(portraitOf("DOO")).toBeNull();
  });
});
