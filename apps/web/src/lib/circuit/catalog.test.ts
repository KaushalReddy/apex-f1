import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filterCircuits } from "@/components/circuits/CircuitDirectory";
import { parseSeasonResults } from "@/lib/drivers/parse";
import { CATALOG, CIRCUITS, circuitByShortName, findCircuitById } from "./catalog";
import { centerlineLengthUnits, parseCircuitGeometry } from "./geometry";
import { circuitOutline } from "./outline";
import type { CircuitGeometry } from "./types";

/** These tests run on the real generated catalog and geometry artifacts in src/data/circuits. */
const DATA = path.join(process.cwd(), "src", "data", "circuits");
const geometry = (id: string): CircuitGeometry => {
  const r = parseCircuitGeometry(JSON.parse(readFileSync(path.join(DATA, `${id}.geometry.json`), "utf8")));
  if (!r.ok) throw new Error(`${id}: ${r.error}`);
  return r.geometry;
};
/** Shoelace area of the centerline in the source x/y plane (sign gives the direction of travel). */
const signedArea = (g: CircuitGeometry) => g.points.reduce((a, p, i) => a + p[0] * g.points[(i + 1) % g.points.length][1] - g.points[(i + 1) % g.points.length][0] * p[1], 0) / 2;

describe("circuit catalog", () => {
  it("has 26 circuits with unique ids and OpenF1 keys, and sourced facts in plausible ranges", () => {
    expect(CIRCUITS).toHaveLength(26);
    expect(new Set(CIRCUITS.map((c) => c.id)).size).toBe(26);
    expect(new Set(CIRCUITS.map((c) => c.openf1.circuitKey)).size).toBe(26);
    for (const c of CIRCUITS) {
      expect(c.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.lengthKm!, c.id).toBeGreaterThan(3);
      expect(c.lengthKm!, c.id).toBeLessThan(8);
      expect(c.turns!, c.id).toBeGreaterThanOrEqual(10);
      expect(c.turns!, c.id).toBeLessThanOrEqual(30);
      expect(c.lapRecord?.time, c.id).toMatch(/^\d:\d{2}\.\d{3}$/);
      expect(c.lapRecord!.year!, c.id).toBeLessThanOrEqual(2026);
      expect(Math.abs(c.lapRecord!.layoutLengthKm - c.lengthKm!), c.id).toBeLessThanOrEqual(0.01); // record is for the GP layout
      expect(c.grandsPrix.length, c.id).toBeGreaterThan(0);
    }
    expect(CATALOG.sources.map((s) => s.name)).toContain("OpenF1 /meetings");
  });

  it("keeps the circuit's own country apart from the event's (the 2026 Bahrain Grand Prix was held at Sepang)", () => {
    const sepang = findCircuitById("sepang")!;
    expect(sepang.country).toBe("Malaysia");
    expect(sepang.grandsPrix.find((g) => g.year === 2026)?.name).toBe("Bahrain Grand Prix");
    expect(findCircuitById("bahrain")!.season2026).toBe("not-held");
    expect(findCircuitById("imola")!.calendar).toBe("previous");
  });

  it("resolves every circuit in the results snapshots, so every result can link to its circuit", () => {
    for (const year of [2024, 2025, 2026]) {
      const r = parseSeasonResults(JSON.parse(readFileSync(path.join(process.cwd(), "src", "data", "results", `${year}.json`), "utf8")));
      if (!r.ok) throw new Error(r.error);
      for (const e of r.season.events) expect(circuitByShortName(e.circuitShortName), `${year} ${e.name}`).toBeDefined();
    }
  });
});

/**
 * Circuits deliberately shipped WITHOUT a layout. Sepang (2026): OpenF1 has its race and qualifying, but the reconstruction failed the
 * checks (race: no usable centerline; qualifying: drivers' lines up to 290 m apart, length 13 % short), so no layout is drawn.
 */
const NO_LAYOUT = ["sepang"];

describe("circuit geometry (real artifacts)", () => {
  const all = CIRCUITS.filter((c) => !NO_LAYOUT.includes(c.id)).map((c) => ({ c, g: geometry(c.id) }));

  it("every circuit except the documented gap has a layout file, and the gap has none", () => {
    expect(all).toHaveLength(25);
    expect(() => geometry("sepang")).toThrow();
  });

  it("every circuit has a valid, closed, finite layout of reasonable density", () => {
    for (const { c, g } of all) {
      expect(g.closed, c.id).toBe(true);
      expect(g.points.length, c.id).toBeGreaterThan(300);
      for (const p of g.points) expect(p.every(Number.isFinite), c.id).toBe(true);
    }
  });

  it("measured lengths are within 5 % of the published lengths (under each artifact's scale)", () => {
    const off = all.map(({ c, g }) => ({ id: c.id, pct: ((centerlineLengthUnits(g.points, g.closed) * g.unitMeters) / (c.lengthKm! * 1000) - 1) * 100 }));
    for (const o of off) expect(Math.abs(o.pct), `${o.id} ${o.pct.toFixed(1)} %`).toBeLessThan(5);
  });

  it("layouts are distinct (no two circuits share an outline)", () => {
    const outlines = all.map(({ g }) => circuitOutline(g.points, g.closed)!.d);
    expect(new Set(outlines).size).toBe(all.length);
  });

  it("the direction of travel in the car data agrees with the published direction for every circuit", () => {
    // Two independent sources: OpenF1 sample order vs Wikipedia's "Direction" column. Monaco (clockwise) fixes the sign convention.
    const cw = Math.sign(signedArea(all.find((x) => x.c.id === "monaco")!.g));
    for (const { c, g } of all) {
      if (c.direction === "clockwise") expect(Math.sign(signedArea(g)), c.id).toBe(cw);
      if (c.direction === "anticlockwise") expect(Math.sign(signedArea(g)), c.id).toBe(-cw);
    }
  });
});

describe("directory search and filters", () => {
  const base = { query: "", calendar: "all" as const, type: "all" as const, sort: "name" as const };
  it("searches name, city and country without accents or case", () => {
    expect(filterCircuits(CIRCUITS, { ...base, query: "sao paulo" }).map((c) => c.id)).toEqual(["interlagos"]);
    expect(filterCircuits(CIRCUITS, { ...base, query: "JAPAN" }).map((c) => c.id)).toEqual(["suzuka"]);
    expect(filterCircuits(CIRCUITS, { ...base, query: "zzz" })).toEqual([]);
  });
  it("filters by calendar and type, and sorts by length with the longest first", () => {
    expect(filterCircuits(CIRCUITS, { ...base, calendar: "previous" }).map((c) => c.id)).toEqual(["imola"]);
    expect(filterCircuits(CIRCUITS, { ...base, type: "street" }).every((c) => c.type === "street")).toBe(true);
    expect(filterCircuits(CIRCUITS, { ...base, sort: "length" })[0].id).toBe("spa-francorchamps");
  });
});
