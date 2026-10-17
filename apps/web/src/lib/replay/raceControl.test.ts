import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseReplay } from "./dataset";
import { ReplayModel } from "./model";
import { fixture, project } from "./testing/fixture";
import { classify, compass, messageText, RaceControl, SECTOR_FLAG_EXPIRY_MS, weatherAt } from "./raceControl";

const msg = (message: string, extra: Partial<{ category: string; flag: string; scope: string }> = {}) => ({ t: 0, category: extra.category ?? "Other", flag: extra.flag ?? null, scope: extra.scope ?? null, message, lap: null, number: null });

describe("classify", () => {
  it("groups messages by what they mean for the race", () => {
    expect(classify(msg("SAFETY CAR DEPLOYED", { category: "SafetyCar" }))).toMatchObject({ kind: "safety-car", importance: "key" });
    expect(classify(msg("VSC DEPLOYED", { category: "SafetyCar" }))).toMatchObject({ kind: "vsc", importance: "key" }); // not called a Safety Car
    expect(classify(msg("RED FLAG", { category: "Flag", flag: "RED", scope: "Track" })).kind).toBe("red-flag");
    expect(classify(msg("YELLOW IN TRACK SECTOR 7", { category: "Flag", flag: "YELLOW", scope: "Sector" }))).toMatchObject({ kind: "yellow", sector: 7 });
    expect(classify(msg("WAVED BLUE FLAG FOR CAR 18 (STR)", { category: "Flag", flag: "BLUE", scope: "Driver" })).importance).toBe("routine");
    expect(classify(msg("FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 87 (BEA) - CAUSING A COLLISION")).kind).toBe("penalty");
    expect(classify(msg("FIA STEWARDS: TURN 16 INCIDENT INVOLVING CAR 87 (BEA) REVIEWED NO FURTHER INVESTIGATION")).kind).toBe("investigation");
    expect(classify(msg("CAR 87 (BEA) TIME 1:40.294 DELETED - TRACK LIMITS AT TURN 2 LAP 3")).kind).toBe("track-limits");
    expect(classify(msg("RISK OF RAIN FOR THE F1 RACE IS 5%")).kind).toBe("weather");
  });
});

// TEST DATA: the synthetic race of testing/fixture.ts with flags added.
function control() {
  const f = fixture();
  f.raceControl = [
    { t: 10_000, category: "Other", flag: null, scope: null, message: "RACE START" },
    { t: 40_000, category: "Flag", flag: "YELLOW", scope: "Sector", message: "YELLOW IN TRACK SECTOR 3" },
    { t: 45_000, category: "Flag", flag: "DOUBLE YELLOW", scope: "Sector", message: "DOUBLE YELLOW IN TRACK SECTOR 4" },
    { t: 60_000, category: "Flag", flag: "CLEAR", scope: "Sector", message: "CLEAR IN TRACK SECTOR 3" },
    { t: 90_000, category: "SafetyCar", flag: null, scope: null, message: "VSC DEPLOYED" },
    { t: 120_000, category: "SafetyCar", flag: null, scope: null, message: "VSC ENDING" },
    { t: 130_000, category: "Flag", flag: "RED", scope: "Track", message: "RED FLAG" },
    { t: 200_000, category: "Other", flag: null, scope: null, message: "RACE RESUMED" },
    { t: 310_000, category: "Flag", flag: "CHEQUERED", scope: "Track", message: "CHEQUERED FLAG" },
  ] as never;
  (f as Record<string, unknown>).weather = { t: [0, 60_000, 120_000], air: [30, 30.5, 31], track: [44, 0, 45], humidity: [70, 70, 71], pressure: [1009, 1009, 1009], rain: [0, 0, 1], windSpeed: [1.5, 1.2, 2], windDir: [147, 150, 10] } as never;
  const r = parseReplay(f);
  if (!r.ok) throw new Error(r.error);
  return { rc: new RaceControl(new ReplayModel(r.value, project)), ds: r.value };
}

describe("messageText", () => {
  it("reads the same in every list: sentence case, codes and abbreviations kept", () => {
    expect(messageText("VSC DEPLOYED")).toBe("VSC deployed");
    expect(messageText("FIA STEWARDS: 5 SECOND TIME PENALTY FOR CAR 87 (BEA)")).toBe("FIA stewards: 5 second time penalty for car 87 (BEA)");
  });
});

describe("track status and sector flags", () => {
  const { rc } = control();
  it("follows the messages in order of precedence", () => {
    expect(rc.statusAt(5_000)).toBe("not-started");
    expect(rc.statusAt(20_000)).toBe("green");
    expect(rc.statusAt(50_000)).toBe("yellow");
    expect([...rc.sectorFlags(50_000)]).toEqual([[3, 1], [4, 2]]);
    expect([...rc.sectorFlags(65_000)]).toEqual([[4, 2]]); // sector 3 cleared
    expect(rc.statusAt(100_000)).toBe("vsc");
    expect(rc.statusAt(150_000)).toBe("red-flag");
    expect(rc.statusAt(250_000)).toBe("green"); // resumed; the old sector-4 flag has expired
    expect(rc.statusAt(320_000)).toBe("finished");
    expect(rc.sectorCount).toBe(4);
  });
  it("drops a sector flag that was never cleared after the expiry", () => {
    expect(rc.sectorFlags(45_000 + SECTOR_FLAG_EXPIRY_MS + 1).has(4)).toBe(false);
  });
});

describe("weather", () => {
  const { ds } = control();
  it("gives the latest reading, treats a 0 °C track reading as missing, and nothing stale", () => {
    expect(weatherAt(ds.weather, 30_000)).toMatchObject({ airC: 30, trackC: 44, rain: false });
    expect(weatherAt(ds.weather, 61_000)).toMatchObject({ airC: 30.5, trackC: null });
    expect(weatherAt(ds.weather, 125_000)).toMatchObject({ rain: true, windDir: 10 });
    expect(weatherAt(ds.weather, 120_000 + 6 * 60_000)).toBeNull();
    expect(weatherAt(null, 0)).toBeNull();
    expect([compass(147), compass(10), compass(350), compass(-10)]).toEqual(["SE", "N", "N", "N"]);
  });
});

describe("real data: Singapore 2026 (exported OpenF1 replay)", () => {
  it("classifies every message and finds the two VSC periods", () => {
    const r = parseReplay(JSON.parse(readFileSync("public/replay/2026/11388.json", "utf8")));
    if (!r.ok) throw new Error(r.error);
    const rc = new RaceControl(new ReplayModel(r.value, null));
    expect(rc.messages.length).toBe(r.value.raceControl.length);
    expect(rc.messages.filter((m) => m.kind === "vsc").length).toBeGreaterThanOrEqual(4); // Singapore had VSCs, no Safety Car
    const vscTimes = rc.messages.filter((m) => m.message === "VSC DEPLOYED").map((m) => m.t + 30_000);
    expect(vscTimes.map((t) => rc.statusAt(t))).toEqual(vscTimes.map(() => "vsc"));
    expect(r.value.weather!.t.length).toBeGreaterThan(100);
  });
});

describe("real data: Dutch GP 2026 red flag (exported OpenF1 replay)", () => {
  it("ends the stoppage at the restart, so the rest of the race is not shown as red", async () => {
    const { lapRows } = await import("./laps");
    const r = parseReplay(JSON.parse(readFileSync("public/replay/2026/11353.json", "utf8")));
    if (!r.ok) throw new Error(r.error);
    const m = new ReplayModel(r.value, null);
    const rc = new RaceControl(m);
    const at = (min: number) => rc.statusAt(r.value.lightsOutMs + min * 60_000);
    expect(at(15)).toBe("red-flag");
    expect(at(45)).not.toBe("red-flag");
    expect(at(90)).not.toBe("red-flag");
    // Laps after the restart are not marked neutralised by the stoppage.
    const late = lapRows(m, 0).filter((l) => l.lap >= 10 && l.lap <= 20);
    expect(late.some((l) => !l.neutralised)).toBe(true);
  });
});
