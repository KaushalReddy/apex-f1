import { describe, expect, it } from "vitest";
import type { TeamCardData } from "@/lib/teams/views";
import { filterTeams } from "./TeamDirectory";

const card = (slug: string, order: number, name: string, code: string, position: number | null, wins: number, drivers: string[], racedAs: string | null = null): TeamCardData => ({
  slug, order, name, racedAs, code, colour: "#fff", shade: "#333", image: null, otherDrivers: 0, points: null, wins, position,
  drivers: drivers.map((n) => ({ acronym: n.slice(0, 3).toUpperCase(), name: n })),
});
const teams = [
  card("mercedes", 0, "Mercedes", "MER", 1, 11, ["Antonelli", "Russell"]),
  card("ferrari", 1, "Ferrari", "FER", 2, 2, ["Hamilton", "Leclerc"]),
  card("audi", 7, "Audi", "AUD", 8, 0, ["Hülkenberg", "Bortoleto"], "Kick Sauber"),
  card("aston-martin", 9, "Aston Martin", "AMR", null, 0, ["Alonso", "Stroll"]),
];
const all = { query: "", show: "all" as const, sort: "default" as const };

describe("filterTeams", () => {
  it("keeps the canonical order by default and only reorders when asked", () => {
    expect(filterTeams([...teams].reverse(), all).map((t) => t.slug)).toEqual(["mercedes", "ferrari", "audi", "aston-martin"]);
    expect(filterTeams(teams, { ...all, sort: "name" }).map((t) => t.slug)).toEqual(["aston-martin", "audi", "ferrari", "mercedes"]);
    expect(filterTeams(teams, { ...all, sort: "championship" }).map((t) => t.slug)).toEqual(["mercedes", "ferrari", "audi", "aston-martin"]); // no position last
  });

  it("searches name, season name, code and drivers, ignoring case and accents", () => {
    expect(filterTeams(teams, { ...all, query: "amr" }).map((t) => t.slug)).toEqual(["aston-martin"]);
    expect(filterTeams(teams, { ...all, query: "sauber" }).map((t) => t.slug)).toEqual(["audi"]);
    expect(filterTeams(teams, { ...all, query: "hulkenberg" }).map((t) => t.slug)).toEqual(["audi"]);
    expect(filterTeams(teams, { ...all, query: "zzz" })).toEqual([]);
  });

  it("filters to race winners", () => {
    expect(filterTeams(teams, { ...all, show: "winners" }).map((t) => t.slug)).toEqual(["mercedes", "ferrari"]);
  });
});
