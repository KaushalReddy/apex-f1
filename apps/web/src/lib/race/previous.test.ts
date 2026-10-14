import { describe, expect, it } from "vitest";
import type { SeasonResults } from "@/lib/drivers/types";
import { previousRace } from "./previous";

const ev = (name: string, date: string, sessionKey: number) => ({ name, circuitShortName: name, race: { date, sessionKey, results: [] } });
const seasons = [
  { season: 2026, events: [ev("A", "2026-09-20", 3), ev("B", "2026-10-11", 4), ev("C", "2026-10-25", 5)] },
  { season: 2025, events: [ev("Z", "2025-12-07", 2)] },
] as unknown as SeasonResults[];

describe("previousRace", () => {
  it("picks the latest race held on or before today, across seasons", () => {
    expect(previousRace(seasons, "2026-10-14")?.sessionKey).toBe(4);
    expect(previousRace(seasons, "2026-10-11")?.sessionKey).toBe(4);
    expect(previousRace(seasons, "2026-01-01")?.sessionKey).toBe(2);
    expect(previousRace(seasons, "2020-01-01")).toBeNull();
  });
});
