import { describe, expect, it } from "vitest";
import type { DirectoryEntry } from "@/lib/drivers/views";
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
