import { describe, expect, it } from "vitest";
import { chooseDrivers, chooseSession, selectionNotes } from "./select";
import type { LapTelemetry } from "./types";

const entry = (sessionKey: number, sessionName: string, circuitShortName: string, date: string, acronyms: string[]) => ({
  sessionKey, meetingKey: sessionKey, sessionName, eventName: `${circuitShortName} GP`, circuitShortName, date, drivers: acronyms.length, acronyms, season: 2026,
});
// Newest first, as loadTelemetryIndex returns it.
const index = [
  entry(4, "Race", "Monza", "2026-09-06", ["LEC", "NOR"]),
  entry(3, "Qualifying", "Monza", "2026-09-05", ["NOR", "PIA"]),
  entry(2, "Race", "Suzuka", "2026-03-29", ["VER", "LEC"]),
  entry(1, "Qualifying", "Suzuka", "2026-03-28", ["VER", "NOR"]),
];
const ids: Record<string, string> = { Monza: "monza", Suzuka: "suzuka" };
const idOf = (s: string) => ids[s];

describe("chooseSession", () => {
  it("defaults to the latest qualifying, honours a known session, and filters by circuit and driver", () => {
    expect(chooseSession(index, {}, idOf).chosen.sessionKey).toBe(3);
    expect(chooseSession(index, { session: "2" }, idOf).chosen.sessionKey).toBe(2);
    expect(chooseSession(index, { circuit: "suzuka" }, idOf).chosen.sessionKey).toBe(1);
    expect(chooseSession(index, { a: "lec" }, idOf).chosen.sessionKey).toBe(4); // no qualifying lap for LEC: his latest race
    expect(chooseSession(index, { circuit: "suzuka", a: "LEC" }, idOf).chosen.sessionKey).toBe(2);
  });
  it("falls back, and says so, when a request cannot be met", () => {
    const q = { circuit: "spa" };
    const { chosen, candidates } = chooseSession(index, q, idOf);
    expect(chosen.sessionKey).toBe(3);
    expect(selectionNotes(q, chosen, candidates, undefined)).toEqual(["No exported session at that circuit; showing Monza GP Qualifying."]);
    const r = chooseSession(index, { session: "999" }, idOf);
    expect(selectionNotes({ session: "999" }, r.chosen, r.candidates, undefined)[0]).toMatch(/not in the exported data/);
  });
});

describe("chooseDrivers", () => {
  const lap = (driverNumber: number, acronym: string) => ({ driverNumber, acronym }) as LapTelemetry;
  const laps = [lap(16, "LEC"), lap(4, "NOR"), lap(1, "VER")];
  it("defaults to the fastest two, accepts numbers or acronyms, and never pairs a lap with itself", () => {
    expect(chooseDrivers(laps, {})).toEqual({ a: laps[0], b: laps[1] });
    expect(chooseDrivers(laps, { a: "ver", b: "16" })).toEqual({ a: laps[2], b: laps[0] });
    expect(chooseDrivers(laps, { a: "NOR", b: "NOR" }).b).toBe(laps[0]);
    const unknown = chooseDrivers(laps, { a: "ZZZ" });
    expect(unknown.a).toBe(laps[0]);
    expect(selectionNotes({ a: "ZZZ" }, index[1], [], unknown.a)).toEqual(["ZZZ has no valid timed lap in this session; showing the fastest driver instead."]);
  });
});
