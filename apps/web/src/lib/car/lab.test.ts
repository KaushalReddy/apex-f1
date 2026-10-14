import { describe, expect, it } from "vitest";
import { seeds } from "./airflow";
import { fitSphere } from "./camera";
import { COMPONENTS, PARTS, explodeOffsetInto, stepExplode } from "./components";
import { assembleCar, buildBodyGeometry, buildCarGeometry, buildWingGeometry } from "./geometry";
import {
  AERO_FOCUS,
  DEFAULT_SETUP,
  INITIAL_LAB,
  LAB_OUTPUTS,
  PART_GROUPS,
  SETUP_PARAMS,
  aeroIndices,
  clampSetup,
  compareSetups,
  effectiveWings,
  groupParts,
  isCompleteCar,
  keepStreamline,
  keepVortex,
  labReducer,
  matchingPreset,
  partLabel,
  partMode,
  partModes,
  presetSetup,
  type LabAction,
  type LabState,
} from "./lab";
import { SETUP_PROFILES } from "./setup";
import { specsFor } from "./specs";
import { CAR_CONFIGS } from "./teams";

const run = (...actions: LabAction[]) => actions.reduce<LabState>(labReducer, INITIAL_LAB);

describe("component hierarchy", () => {
  it("places every scene part in exactly one group, and only real parts", () => {
    const all = PART_GROUPS.flatMap(groupParts);
    expect([...all].sort()).toEqual(PARTS.map((p) => p.key).sort());
    expect(new Set(all).size).toBe(all.length);
    for (const g of PART_GROUPS) for (const c of g.components) for (const k of c.parts) expect(PARTS.find((p) => p.key === k)!.component).toBe(c.id);
  });

  it("covers every component and names every part", () => {
    expect(new Set(PART_GROUPS.flatMap((g) => g.components.map((c) => c.id)))).toEqual(new Set(COMPONENTS.map((c) => c.id)));
    expect(partLabel("wheel-rl")).toBe("Rear-left wheel");
    expect(partLabel("rear-wing")).toBe("Rear wing");
  });
});

describe("inspection state", () => {
  it("toggles selection from either the tree or the scene (one shared action)", () => {
    expect(run({ type: "toggleSelect", id: "floor" }).selected).toBe("floor");
    expect(run({ type: "toggleSelect", id: "floor" }, { type: "toggleSelect", id: "floor" }).selected).toBeNull();
    expect(run({ type: "toggleSelect", id: "floor" }, { type: "toggleSelect", id: "diffuser" }).selected).toBe("diffuser");
  });

  it("hides and shows parts, ignoring unknown keys", () => {
    const s = run({ type: "setPartsHidden", keys: ["wheel-fl", "wheel-fr", "nope"], hidden: true });
    expect(s.hidden).toEqual(["wheel-fl", "wheel-fr"]);
    expect(partMode("wheel-fl", s)).toBe("hidden");
    expect(partMode("wheel-rl", s)).toBe("solid");
    expect(labReducer(s, { type: "setPartHidden", key: "wheel-fl", hidden: false }).hidden).toEqual(["wheel-fr"]);
  });

  it("isolates the selected component (fade or hide the rest) and needs a selection to do so", () => {
    expect(run({ type: "isolate", mode: "solo" }).isolate).toBe("off");
    const ghost = run({ type: "select", id: "rear-wing" }, { type: "isolate", mode: "ghost" });
    expect(partMode("rear-wing", ghost)).toBe("solid");
    expect(partMode("floor", ghost)).toBe("ghost");
    const solo = labReducer(ghost, { type: "isolate", mode: "solo" });
    expect(partMode("floor", solo)).toBe("hidden");
    expect(Object.values(partModes(solo)).filter((m) => m === "solid")).toHaveLength(1);
  });

  it("leaves isolation when the selection is cleared, so nothing stays hidden by accident", () => {
    const s = run({ type: "select", id: "rear-wing" }, { type: "isolate", mode: "solo" }, { type: "select", id: null });
    expect(s.isolate).toBe("off");
    expect(isCompleteCar(s)).toBe(true);
    expect(run({ type: "select", id: "floor" }, { type: "isolate", mode: "ghost" }, { type: "toggleSelect", id: "floor" }).isolate).toBe("off");
  });

  it("x-ray ghosts bodywork only, never the selected component; an explicit hide wins over everything", () => {
    const s = run({ type: "xray", on: true }, { type: "select", id: "nose-chassis" });
    expect(partMode("sidepod-l", s)).toBe("ghost");
    expect(partMode("nose-chassis", s)).toBe("solid");
    expect(partMode("front-suspension-l", s)).toBe("solid");
    expect(partMode("nose-chassis", labReducer(s, { type: "setPartHidden", key: "nose-chassis", hidden: true }))).toBe("hidden");
  });

  it("restores the complete car, and reset returns the initial scene", () => {
    const messy = run(
      { type: "select", id: "floor" },
      { type: "isolate", mode: "solo" },
      { type: "xray", on: true },
      { type: "setPartsHidden", keys: ["rear-wing"], hidden: true },
      { type: "explode", amount: 0.5 },
      { type: "labels", on: true },
    );
    expect(isCompleteCar(messy)).toBe(false);
    const restored = labReducer(messy, { type: "restoreCar" });
    expect(restored).toMatchObject({ hidden: [], isolate: "off", xray: false, selected: "floor", explode: 0.5 });
    expect(PARTS.every((p) => partMode(p.key, restored) === "solid")).toBe(true);
    expect(labReducer(messy, { type: "reset" })).toEqual(INITIAL_LAB);
  });

  it("clamps the explode amount and offsets each part independently, returning exactly to assembled", () => {
    expect(run({ type: "explode", amount: 3 }).explode).toBe(1);
    expect(run({ type: "explode", amount: -1 }).explode).toBe(0);
    expect(run({ type: "explode", amount: Number.NaN }).explode).toBe(0);
    let p = 0;
    for (let i = 0; i < 200; i++) p = stepExplode(p, 0.5, 1 / 60, 0.7);
    expect(p).toBe(0.5);
    const off = { v: [0, 0, 0], set(x: number, y: number, z: number) { this.v = [x, y, z]; } };
    const wing = PARTS.find((x) => x.key === "front-wing")!;
    const wheel = PARTS.find((x) => x.key === "wheel-fl")!;
    explodeOffsetInto(off, wing.explode, 0.5);
    const a = off.v;
    explodeOffsetInto(off, wheel.explode, 0.5);
    expect(off.v).not.toEqual(a); // parts move independently, not as one translated car
    for (let i = 0; i < 200; i++) p = stepExplode(p, 0, 1 / 60, 0.7);
    explodeOffsetInto(off, wing.explode, p);
    expect(off.v).toEqual([0, 0, 0]);
  });
});

describe("setup model", () => {
  it("defaults to the balanced preset; every preset lies inside the slider ranges", () => {
    expect(matchingPreset(DEFAULT_SETUP)).toBe("balanced");
    for (const p of SETUP_PROFILES) for (const m of SETUP_PARAMS) {
      expect(p.wings[m.key]).toBeGreaterThanOrEqual(m.min);
      expect(p.wings[m.key]).toBeLessThanOrEqual(m.max);
    }
  });

  it("clamps, snaps and repairs values", () => {
    const c = clampSetup({ frontFlapDeg: 99, rearMainDeg: -5, rearFlapDeg: 20.6, lowDrag: false });
    expect(c).toEqual({ frontFlapDeg: 30, rearMainDeg: 2, rearFlapDeg: 21, lowDrag: false });
    expect(clampSetup({ ...DEFAULT_SETUP, rearMainDeg: Number.NaN }).rearMainDeg).toBe(DEFAULT_SETUP.rearMainDeg);
  });

  it("reproduces the Phase 4 preset indices exactly (balanced 1.00, high 1.30, low 0.70)", () => {
    for (const p of SETUP_PROFILES) {
      const i = aeroIndices(presetSetup(p.id));
      expect([i.downforce, i.drag]).toEqual([p.relative.downforce, p.relative.drag]);
      expect(i.balance).toBe("neutral");
    }
  });

  it("moves the indices in the documented directions", () => {
    const steeperRear = aeroIndices({ ...DEFAULT_SETUP, rearFlapDeg: 44 });
    expect(steeperRear.downforce).toBeGreaterThan(1);
    expect(steeperRear.drag).toBeGreaterThan(steeperRear.downforce); // the rear wing weighs more on drag
    expect(steeperRear.balance).toBe("rear");
    const steeperFront = aeroIndices({ ...DEFAULT_SETUP, frontFlapDeg: 26 });
    expect(steeperFront.downforce).toBeGreaterThan(steeperFront.drag);
    expect(steeperFront.balance).toBe("front");
    const lowDrag = aeroIndices({ ...DEFAULT_SETUP, lowDrag: true });
    expect(lowDrag.drag).toBeLessThan(1);
    expect(effectiveWings({ ...DEFAULT_SETUP, lowDrag: true }).rearFlapDeg).toBe(6);
  });

  it("compares two configurations parameter by parameter and index by index", () => {
    const c = compareSetups(presetSetup("balanced"), presetSetup("high-downforce"));
    expect(c.identical).toBe(false);
    expect(c.params.map((p) => p.delta)).toEqual([8, 5, 14]);
    expect(c.indices.map((i) => [i.a, i.b, i.delta])).toEqual([[1, 1.3, 0.3], [1, 1.3, 0.3]]);
    expect(compareSetups(DEFAULT_SETUP, { ...DEFAULT_SETUP }).identical).toBe(true);
    expect(compareSetups(DEFAULT_SETUP, { ...DEFAULT_SETUP, lowDrag: true }).identical).toBe(false);
  });

  it("rebuilds only the wings for a setup change; the body buffers are reused", () => {
    const body = buildBodyGeometry();
    const a = assembleCar(body, buildWingGeometry(presetSetup("balanced")));
    const b = assembleCar(body, buildWingGeometry(presetSetup("low-drag")));
    expect(a.assemblies.chassis).toBe(b.assemblies.chassis);
    expect(a.assemblies.rearWing).not.toBe(b.assemblies.rearWing);
    expect(Object.keys(buildCarGeometry(DEFAULT_SETUP).assemblies).sort()).toEqual(Object.keys(a.assemblies).sort());
  });
});

describe("aerodynamics focus and honesty", () => {
  it("each focus keeps a non-empty, distinct subset of the streamlines; overall keeps all", () => {
    const s = seeds();
    const kept = Object.fromEntries(AERO_FOCUS.map((f) => [f.id, s.filter((x) => keepStreamline(f.id, x)).length]));
    expect(kept.overall).toBe(s.length);
    for (const f of AERO_FOCUS) expect(kept[f.id], f.id).toBeGreaterThan(0);
    expect(s.filter((x) => keepStreamline("underfloor", x)).every((x) => x.region === "under")).toBe(true);
    expect([0, 1, 2, 3].filter((i) => keepVortex("front-wing", i))).toEqual([0, 2]);
    expect([0, 1, 2, 3].filter((i) => keepVortex("sidepods", i))).toEqual([]);
  });

  it("labels every output: airflow and pressure are conceptual, indices are a simplified model, only specifications are sourced", () => {
    expect(LAB_OUTPUTS.airflow).toBe("conceptual");
    expect(LAB_OUTPUTS.pressure).toBe("conceptual");
    expect(LAB_OUTPUTS.downforceIndex).toBe("simplified-model");
    expect(Object.entries(LAB_OUTPUTS).filter(([, e]) => e === "sourced").map(([k]) => k)).toEqual(["specifications"]);
  });
});

describe("camera focus", () => {
  it("fits larger parts further away, narrow screens further away, and never inside the part", () => {
    expect(fitSphere(1, 1.6)).toBeGreaterThan(fitSphere(0.5, 1.6));
    expect(fitSphere(1, 0.5)).toBeGreaterThan(fitSphere(1, 1.6));
    expect(fitSphere(0.05, 1.6)).toBeGreaterThanOrEqual(0.35);
  });
});

describe("team cars and missing data", () => {
  it("every Lab team has a livery and a spec sheet; component specs are absent rather than invented", () => {
    expect(CAR_CONFIGS).toHaveLength(11);
    for (const c of CAR_CONFIGS) {
      const s = specsFor(c.teamSlug)!;
      expect(s.geometry.provenance).toBe("generic-procedural");
      expect(Object.values(s.components).flat()).toEqual([]);
    }
    expect(specsFor("nope")).toBeUndefined();
  });
});
