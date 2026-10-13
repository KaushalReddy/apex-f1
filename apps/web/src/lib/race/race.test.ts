import { describe, expect, it } from "vitest";
import { syntheticLoop } from "@/lib/circuit/testing/syntheticLoop";
import { centerlineToWorld, createWorldTransform } from "@/lib/circuit/transform";
import { declutter, labelPriority } from "./declutter";
import { createDemoRace, paceProfile, rng, type DemoRace } from "./demo";
import { demoEntries, teamColor } from "./entries";
import { appendEvents, diffSnapshots } from "./events";
import { DemoProvider, ReplayProvider, parseReplayFrames, type ProviderUpdate, type Scheduler } from "./providers";
import { SnapshotBuffer, battles, formatGap, formatLapTime, freshness, sortByRaceOrder, stepSelection, toggleSelection } from "./session";
import { createTrackPath, forwardDelta, lerpProgress, wrap01 } from "./track";
import type { DriverState, RaceSnapshot } from "./types";

const geometry = syntheticLoop({ n: 400 });
const transform = createWorldTransform(geometry);
const world = centerlineToWorld(geometry, transform);
const path = createTrackPath(world);

function race(seed = 7, totalLaps = 6): DemoRace {
  return createDemoRace({
    entries: demoEntries(),
    profile: paceProfile(world),
    session: { id: "demo", type: "Race", circuitSlug: "test", circuitName: "Test loop" },
    totalLaps,
    seed,
    baseLapS: 60,
  });
}

/** Manual scheduler: time only moves when the test says so. */
function manualScheduler() {
  let now = 0;
  const jobs: Array<() => void> = [];
  const s: Scheduler & { advance(ms: number, every: number): void; jobs: number } = {
    now: () => now,
    every: (_ms, fn) => {
      jobs.push(fn);
      return () => jobs.splice(jobs.indexOf(fn), 1);
    },
    advance(ms, every) {
      for (let t = 0; t < ms; t += every) {
        now += every;
        jobs.forEach((j) => j());
      }
    },
    get jobs() {
      return jobs.length;
    },
  };
  return s;
}

describe("track path (circuit positioning)", () => {
  it("maps progress onto the rendered centerline: 0 is vertex 0, the path is closed and the length matches", () => {
    const out = [0, 0, 0];
    path.pointAt(0, out);
    expect(out).toEqual([world[0], world[1], world[2]]);
    path.pointAt(1, out);
    expect(out[0]).toBeCloseTo(world[0], 4);
    path.pointAt(0.25, out);
    const back = path.project(out[0], out[2]);
    expect(back).toBeCloseTo(0.25, 3);
    // The synthetic ellipse (radius 900 m x 540 m) is about 4.6 km round.
    expect(path.length).toBeGreaterThan(4300);
    expect(path.length).toBeLessThan(4700);
  });

  it("wraps progress across the start/finish line and only moves forward", () => {
    expect(wrap01(-0.1)).toBeCloseTo(0.9);
    expect(wrap01(1.25)).toBeCloseTo(0.25);
    expect(forwardDelta(0.98, 0.02)).toBeCloseTo(0.04);
    expect(lerpProgress(0.98, 0.02, 0.5)).toBeCloseTo(0.0, 6);
    expect(lerpProgress(0.4, 0.5, 0.5)).toBeCloseTo(0.45);
    expect(lerpProgress(0.5, 0.49, 0.5)).toBe(0.5); // small backwards noise holds instead of going round the lap
  });

  it("windowed projection keeps a car on its own branch", () => {
    const out = [0, 0, 0];
    path.pointAt(0.6, out);
    expect(path.project(out[0] + 3, out[2] - 2, 0.59)).toBeCloseTo(0.6, 2);
  });
});

describe("demo race simulator", () => {
  const r = race();

  it("is deterministic: the same seed gives the same race, a different seed a different one", () => {
    expect(race(7).snapshotAt(90_000)).toEqual(r.snapshotAt(90_000));
    expect(race(8).snapshotAt(90_000).drivers.map((d) => d.id)).not.toEqual(undefined);
    expect(race(8).durationMs).not.toBe(r.durationMs);
  });

  it("orders cars by race distance and keeps positions, laps and progress consistent", () => {
    for (const t of [5_000, 61_000, 150_000, 300_000]) {
      const s = r.snapshotAt(t);
      expect(s.drivers.map((d) => d.position)).toEqual(s.drivers.map((_, i) => i + 1));
      const dist = s.drivers.map((d) => r.distanceAt(d.id, t));
      for (let i = 1; i < dist.length; i++) if (!s.drivers[i].finished && !s.drivers[i - 1].finished) expect(dist[i - 1]).toBeGreaterThanOrEqual(dist[i]);
      for (const d of s.drivers) {
        expect(d.progress).toBeGreaterThanOrEqual(0);
        expect(d.progress).toBeLessThan(1);
        expect(d.lap).toBeGreaterThanOrEqual(1);
        expect(d.lap).toBeLessThanOrEqual(6);
      }
    }
  });

  it("race distance never decreases (cars only move forward, including through a pit stop)", () => {
    for (const e of demoEntries()) {
      let prev = -Infinity;
      for (let t = 0; t <= r.durationMs; t += 500) {
        const d = r.distanceAt(e.id, t);
        expect(d).toBeGreaterThanOrEqual(prev - 1e-9);
        prev = d;
      }
    }
  });

  it("gaps are exact by definition: the car ahead (or leader) was at this car's race distance exactly `gap` seconds earlier", () => {
    const t = 200_000;
    const s = r.snapshotAt(t);
    expect(s.drivers[0].gapToLeaderS).toBeNull();
    for (let i = 1; i < s.drivers.length; i++) {
      const d = s.drivers[i];
      if (d.finished) continue;
      const here = r.distanceAt(d.id, t);
      expect(r.distanceAt(s.drivers[0].id, t - d.gapToLeaderS! * 1000)).toBeCloseTo(here, 3);
      expect(r.distanceAt(s.drivers[i - 1].id, t - d.gapAheadS! * 1000)).toBeCloseTo(here, 3);
    }
  });

  it("every car pits once, the race finishes, and lap times are reported only for completed laps", () => {
    const pitted = new Set<string>();
    for (let t = 0; t <= r.durationMs; t += 250) for (const d of r.snapshotAt(t).drivers) if (d.pit === "in-pit") pitted.add(d.id);
    expect(pitted.size).toBe(demoEntries().length);
    const end = r.snapshotAt(r.durationMs);
    expect(end.session.status).toBe("finished");
    expect(end.drivers.every((d) => d.finished)).toBe(true);
    const early = r.snapshotAt(20_000);
    expect(early.drivers.every((d) => d.lastLapMs === null)).toBe(true);
    expect(r.snapshotAt(0).session.status).toBe("not-started");
  });

  it("uses the project's driver identities and team colours", () => {
    const ids = demoEntries().map((e) => e.id);
    expect(ids).toContain("norris");
    expect(teamColor("mclaren")).toBe("#ff8000");
    expect(teamColor(null)).toBe("#c9ced6");
    expect(rng(1)()).toBe(rng(1)());
  });
});

describe("race order, gaps and formatting", () => {
  const base: DriverState = {
    id: "a", code: "AAA", name: null, number: 10, teamSlug: null, position: null, lap: null, progress: 0.1, lastLapMs: null, bestLapMs: null,
    gapToLeaderS: null, gapAheadS: null, lapsDown: null, pit: null, finished: false, sampleT: 0, stale: false,
  };
  it("sorts by position, then unknown positions by car number", () => {
    const sorted = sortByRaceOrder([
      { ...base, id: "x", number: 44 },
      { ...base, id: "p2", position: 2 },
      { ...base, id: "y", number: 3 },
      { ...base, id: "p1", position: 1 },
    ]);
    expect(sorted.map((d) => d.id)).toEqual(["p1", "p2", "y", "x"]);
  });

  it("formats gaps without inventing values", () => {
    expect(formatGap({ ...base, position: 1 }, "leader")).toBe("Leader");
    expect(formatGap({ ...base, position: 3, gapToLeaderS: 4.1234 }, "leader")).toBe("+4.123");
    expect(formatGap({ ...base, position: 3, lapsDown: 1, gapToLeaderS: 70 }, "leader")).toBe("+1 lap");
    expect(formatGap({ ...base, position: 3 }, "ahead")).toBe("—");
    expect(formatLapTime(74_321)).toBe("1:14.321");
    expect(formatLapTime(null)).toBe("—");
  });
});

describe("selection (shared by circuit and leaderboard)", () => {
  it("toggles and steps through the race order", () => {
    expect(toggleSelection(null, "a")).toBe("a");
    expect(toggleSelection("a", "a")).toBeNull();
    expect(toggleSelection("a", "b")).toBe("b");
    const order = ["a", "b", "c"];
    expect(stepSelection(order, null, 1)).toBe("a");
    expect(stepSelection(order, null, -1)).toBe("c");
    expect(stepSelection(order, "b", 1)).toBe("c");
    expect(stepSelection(order, "c", 1)).toBe("c");
    expect(stepSelection([], "a", 1)).toBeNull();
  });
});

describe("events and battles", () => {
  const r = race();
  it("derives overtakes, laps, pit stops and finishes from consecutive snapshots of the same state", () => {
    const kinds = new Set<string>();
    let prev: RaceSnapshot | null = null;
    for (let t = 0; t <= r.durationMs + 250; t += 250) {
      const s: RaceSnapshot = { ...r.snapshotAt(t), mode: "DEMO", source: { name: "test", status: "ok" }, epoch: 0 };
      for (const e of diffSnapshots(prev, s)) {
        kinds.add(e.kind);
        if (e.kind === "overtake") {
          const d = s.drivers.find((x) => x.id === e.driver)!;
          expect(d.position).toBe(e.to);
        }
      }
      prev = s;
    }
    for (const k of ["lap", "pit-entry", "pit-exit", "finish", "session"]) expect(kinds).toContain(k);
  });

  it("does not report events across a reset/seek (new epoch)", () => {
    const a: RaceSnapshot = { ...r.snapshotAt(100_000), mode: "DEMO", source: { name: "t", status: "ok" }, epoch: 0 };
    const b: RaceSnapshot = { ...r.snapshotAt(5_000), mode: "DEMO", source: { name: "t", status: "ok" }, epoch: 1 };
    expect(diffSnapshots(a, b)).toEqual([]);
  });

  it("battles are adjacent cars within the threshold, and the log keeps newest first without duplicates", () => {
    const s: RaceSnapshot = { ...r.snapshotAt(150_000), mode: "DEMO", source: { name: "t", status: "ok" }, epoch: 0 };
    for (const [a, b] of battles(s, 1)) {
      const ia = s.drivers.findIndex((d) => d.id === a);
      expect(s.drivers[ia + 1].id).toBe(b);
      expect(s.drivers[ia + 1].gapAheadS!).toBeLessThanOrEqual(1);
    }
    const e1 = { id: "x", t: 1, kind: "lap" as const, lap: 2, totalLaps: 6 };
    const e2 = { id: "y", t: 2, kind: "lap" as const, lap: 3, totalLaps: 6 };
    expect(appendEvents(appendEvents([], [e1]), [e1, e2]).map((e) => e.id)).toEqual(["y", "x"]);
  });
});

describe("interpolation buffer", () => {
  const snap = (progress: number, epoch = 0): RaceSnapshot => ({
    mode: "DEMO", source: { name: "t", status: "ok" }, session: { id: "s", type: "Race", status: "running", circuitSlug: "c", circuitName: "C", lap: 1, totalLaps: 2 },
    drivers: [{ id: "a", code: "A", name: null, number: 1, teamSlug: null, position: 1, lap: 1, progress, lastLapMs: null, bestLapMs: null, gapToLeaderS: null, gapAheadS: null, lapsDown: 0, pit: "none", finished: false, sampleT: 0, stale: false }],
    ordered: true, t: 0, elapsed: 0, epoch,
  });
  it("interpolates one interval behind, through the finish line, and snaps on a new epoch", () => {
    const b = new SnapshotBuffer(250);
    const out = new Map<string, number>();
    b.push(snap(0.98), 0);
    b.push(snap(0.02), 250);
    b.sample(375, out); // render time 125: halfway
    expect(out.get("a")).toBeCloseTo(0, 6);
    b.push(snap(0.5, 1), 500); // reset: history cleared, no sweep from 0.02 to 0.5
    b.sample(500, out);
    expect(out.get("a")).toBe(0.5);
  });
});

describe("providers", () => {
  const latest = (p: { subscribe(fn: (u: ProviderUpdate) => void): () => void }) => {
    let u: ProviderUpdate | null = null;
    const off = p.subscribe((x) => (u = x));
    return { get: () => u!, off };
  };

  it("demo provider: play, pause, speed, seek and reset drive one session clock; it is labelled DEMO, never LIVE", () => {
    const s = manualScheduler();
    const p = new DemoProvider(race(), s, { intervalMs: 250, speed: 4, autoplay: false });
    const u = latest(p);
    p.start();
    expect(u.get().snapshot!.mode).toBe("DEMO");
    expect(u.get().snapshot!.t).toBe(0);
    p.play();
    s.advance(1000, 250);
    expect(u.get().snapshot!.t).toBe(4000); // 1 s of wall time at 4x
    p.pause();
    s.advance(1000, 250);
    expect(u.get().snapshot!.t).toBe(4000);
    p.setSpeed(8);
    p.play();
    s.advance(500, 250);
    expect(u.get().snapshot!.t).toBe(8000);
    const epoch = u.get().snapshot!.epoch;
    p.seek(0.5);
    expect(u.get().snapshot!.epoch).toBe(epoch + 1);
    p.reset();
    expect(u.get().snapshot!.t).toBe(0);
    expect(u.get().playback).toEqual({ playing: false, speed: 8 });
    p.setSpeed(-1);
    expect(u.get().playback!.speed).toBe(8);
    p.dispose();
    expect(s.jobs).toBe(0); // timer cleaned up
  });

  it("stops at the chequered flag and restarts from the beginning on play", () => {
    const s = manualScheduler();
    const r = race(7, 1);
    const p = new DemoProvider(r, s, { autoplay: true, speed: 16 });
    const u = latest(p);
    p.start();
    s.advance(r.durationMs / 16 + 1000, 250);
    expect(u.get().playback!.playing).toBe(false);
    expect(u.get().snapshot!.session.status).toBe("finished");
    p.play();
    expect(u.get().snapshot!.t).toBe(0);
    p.dispose();
  });

  it("replay provider: validates frames, projects cars onto the circuit, has no order or timing, and reports a dead source", async () => {
    const out = [0, 0, 0];
    path.pointAt(0.3, out);
    const src = transform.fromWorld(out[0], out[1], out[2]);
    const frames = [
      { sessionKey: 1, mode: "REPLAY", t: 1000, cars: [{ driverNumber: 44, x: src[0], y: src[1], z: src[2], sampleT: 1000 }, { driverNumber: 1, x: NaN, y: 0, z: 0, sampleT: 1000 }] },
      { sessionKey: 1, mode: "REPLAY", t: 2000, coordinateSystem: "other-frame", cars: [] },
      { sessionKey: 1, mode: "REPLAY", t: 1500, cars: [{ driverNumber: 44, x: src[0], y: src[1], z: src[2], sampleT: 1000 }] },
    ];
    const parsed = parseReplayFrames(frames, "openf1-location");
    expect(parsed.droppedCars).toBe(1);
    expect(parsed.rejectedFrames).toBe(1);
    expect(parsed.frames.map((f) => f.t)).toEqual([1000, 1500]);
    expect(() => parseReplayFrames({}, "x")).toThrow();

    const s = manualScheduler();
    const common = { coordinateSystem: "openf1-location", toWorld: transform.toWorld, path, session: { id: "r", type: "Race", circuitSlug: "c", circuitName: "C" }, sourceName: "test" };
    const p = new ReplayProvider({ ...common, load: async () => frames }, s);
    const u = latest(p);
    p.start();
    expect(u.get().source.status).toBe("connecting");
    await Promise.resolve();
    await Promise.resolve();
    const snap = u.get().snapshot!;
    expect(snap.mode).toBe("REPLAY");
    expect(snap.ordered).toBe(false);
    expect(snap.drivers[0]).toMatchObject({ code: "#44", position: null, gapToLeaderS: null, lastLapMs: null, teamSlug: null });
    expect(snap.drivers[0].progress!).toBeCloseTo(0.3, 2);
    p.dispose();

    const dead = new ReplayProvider({ ...common, load: async () => Promise.reject(new Error("API down")) }, s);
    const d = latest(dead);
    dead.start();
    await new Promise((res) => setTimeout(res, 0));
    expect(d.get().source).toEqual({ status: "error", detail: "API down" });
    expect(d.get().snapshot).toBeNull();
    dead.dispose();
  });
});

describe("freshness and mode labelling", () => {
  const s = (mode: RaceSnapshot["mode"], status: RaceSnapshot["session"]["status"] = "running") =>
    ({ mode, session: { status } }) as RaceSnapshot;
  it("distinguishes waiting, fresh, delayed, stale, paused, finished and disconnected", () => {
    expect(freshness({ snapshot: null, receivedAt: null, now: 0, playing: true, sourceStatus: "connecting" }).state).toBe("waiting");
    expect(freshness({ snapshot: null, receivedAt: null, now: 0, playing: true, sourceStatus: "error" }).state).toBe("disconnected");
    expect(freshness({ snapshot: s("LIVE"), receivedAt: 0, now: 500, playing: true, sourceStatus: "ok" }).state).toBe("fresh");
    expect(freshness({ snapshot: s("LIVE"), receivedAt: 0, now: 3000, playing: true, sourceStatus: "ok" }).state).toBe("delayed");
    expect(freshness({ snapshot: s("LIVE"), receivedAt: 0, now: 9000, playing: true, sourceStatus: "ok" }).state).toBe("stale");
    expect(freshness({ snapshot: s("DEMO"), receivedAt: 0, now: 9000, playing: false, sourceStatus: "ok" }).state).toBe("paused");
    expect(freshness({ snapshot: s("DEMO", "finished"), receivedAt: 0, now: 9000, playing: false, sourceStatus: "ok" }).state).toBe("finished");
  });
});

describe("label decluttering", () => {
  it("keeps the most important labels and hides overlapping or off-screen ones", () => {
    const vp = { w: 800, h: 600 };
    const box = (id: string, x: number, priority: number) => ({ id, x, y: 100, w: 60, h: 20, priority });
    const kept = declutter([box("a", 100, 1), box("b", 120, 5), box("c", 300, 1), box("off", -200, 99)], vp);
    expect([...kept].sort()).toEqual(["b", "c"]);
    expect(labelPriority({ selected: true, focused: false, position: 9 })).toBeGreaterThan(labelPriority({ selected: false, focused: true, position: 1 }));
    expect(labelPriority({ selected: false, focused: false, position: 1 })).toBeGreaterThan(labelPriority({ selected: false, focused: false, position: 2 }));
  });
});

describe("Monaco: framing, positioning and event consistency (real geometry)", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { PerspectiveCamera, Vector3 } = await import("three");
  const { parseCircuitGeometry, circuitExtentMeters, resolveTrackWidth } = await import("@/lib/circuit/geometry");
  const { raceFraming, MARKER_MARGIN_M } = await import("./fit");
  const { BATTLE_ENTER_S } = await import("./events");
  const parsed = parseCircuitGeometry(JSON.parse(readFileSync(join(process.cwd(), "src/data/circuits/monaco.geometry.json"), "utf8")));
  if (!parsed.ok) throw new Error(parsed.error);
  const monaco = parsed.geometry;
  const mt = createWorldTransform(monaco);
  const mw = centerlineToWorld(monaco, mt);
  const mpath = createTrackPath(mw);
  const drawn = resolveTrackWidth(monaco.widthMeters, circuitExtentMeters(monaco.points, monaco.unitMeters)).drawnMeters;

  it("fit circuit: every centerline point (plus road and marker margin) is on screen at phone to ultra-wide aspects, and fills the view", () => {
    for (const aspect of [0.55, 0.8, 1.2, 1.6, 2.2, 3]) {
      const p = raceFraming(mw, aspect, drawn);
      const cam = new PerspectiveCamera(p.fov, aspect, 1, 1e6);
      cam.position.set(...p.position);
      cam.lookAt(...p.target);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      let maxX = 0;
      let maxY = 0;
      const v = new Vector3();
      const margin = drawn / 2 + MARKER_MARGIN_M;
      for (let i = 0; i < mw.length / 3; i++)
        for (const [dx, dz] of [[margin, 0], [-margin, 0], [0, margin], [0, -margin]]) {
          v.set(mw[i * 3] + dx, mw[i * 3 + 1], mw[i * 3 + 2] + dz).project(cam);
          maxX = Math.max(maxX, Math.abs(v.x));
          maxY = Math.max(maxY, Math.abs(v.y));
        }
      expect(Math.max(maxX, maxY), `aspect ${aspect}`).toBeLessThanOrEqual(1);
      expect(Math.max(maxX, maxY), `aspect ${aspect} uses the view`).toBeGreaterThan(0.7);
    }
  });

  const monacoRace = createDemoRace({
    entries: demoEntries(), profile: paceProfile(mw), totalLaps: 4, seed: 2026, baseLapS: 74,
    session: { id: "demo", type: "Race", circuitSlug: "monaco", circuitName: "Monaco" },
  });

  it("every demo driver is placed on the Monaco centerline at its progress", () => {
    const out = [0, 0, 0];
    for (const t of [0, 30_000, 150_000, monacoRace.durationMs]) {
      const s = monacoRace.snapshotAt(t);
      expect(s.drivers).toHaveLength(demoEntries().length);
      for (const d of s.drivers) {
        expect(d.progress).not.toBeNull();
        mpath.pointAt(d.progress!, out);
        expect(mpath.project(out[0], out[2])).toBeCloseTo(d.progress!, 3);
      }
    }
  });

  const runEvents = (speed: number) => {
    const s = manualScheduler();
    const p = new DemoProvider(monacoRace, s, { autoplay: true, speed });
    const log: ProviderUpdate[] = [];
    p.subscribe((u) => log.push(u));
    p.start();
    s.advance(monacoRace.durationMs / speed + 2000, 250);
    p.dispose();
    return log.flatMap((u) => u.events);
  };

  it("events are produced once per transition, identically at 1x and 16x, with battles only after lap 1 and under the entry gap", () => {
    const fast = runEvents(16);
    const slow = runEvents(1);
    expect(fast.map((e) => e.id)).toEqual(slow.map((e) => e.id));
    expect(new Set(fast.map((e) => e.id)).size).toBe(fast.length);
    expect(fast.filter((e) => e.kind === "finish")).toHaveLength(demoEntries().length);
    expect(fast.filter((e) => e.kind === "lap").map((e) => (e as { lap: number }).lap)).toEqual([2, 3, 4]);
    for (const e of fast.filter((x) => x.kind === "battle")) {
      const s = monacoRace.snapshotAt(e.t);
      expect(s.session.lap!).toBeGreaterThan(1);
      const behind = s.drivers.find((d) => d.id === (e as { behind: string }).behind)!;
      expect(behind.gapAheadS!).toBeLessThanOrEqual(BATTLE_ENTER_S + 1e-9);
    }
  });

  it("seek and restart rebuild the history instead of duplicating it", () => {
    const full = runEvents(16);
    const s = manualScheduler();
    const p = new DemoProvider(monacoRace, s, { autoplay: false });
    let last: ProviderUpdate | null = null;
    p.subscribe((u) => (last = u));
    p.start();
    p.seek(0.5);
    const u = last as unknown as ProviderUpdate;
    expect(u.eventsReset).toBe(true);
    const half = u.snapshot!.t;
    expect(u.events.map((e) => e.id)).toEqual(full.filter((e) => e.t <= half).map((e) => e.id));
    p.reset();
    expect((last as unknown as ProviderUpdate).eventsReset).toBe(true);
    expect((last as unknown as ProviderUpdate).events).toEqual([]);
    p.dispose();
  });
});

describe("label placement (placeLabels)", async () => {
  const { placeLabels } = await import("./declutter");
  const vp = { w: 1000, h: 700 };
  const anchor = (id: string, mx: number, my: number, priority: number) => ({ id, mx, my, w: 58, wCompact: 40, h: 18, priority });
  const boxOf = (p: { x: number; y: number; compact: boolean }) => ({ x: p.x, y: p.y, w: p.compact ? 40 : 58, h: 18 });

  it("labels touch their own marker (no leader lines), never overlap, stay in view, and a tight pack labels most of its cars", () => {
    const pack = Array.from({ length: 6 }, (_, i) => anchor(`d${i}`, 500 + i * 6, 350 + (i % 2) * 8, 100 - i));
    const m = placeLabels(pack, vp, { markerR: 7, mustShow: "d5" });
    expect(m.size).toBeGreaterThanOrEqual(4);
    expect(m.has("d5")).toBe(true);
    const placed = [...m].map(([id, p]) => ({ id, ...boxOf(p) }));
    for (let i = 0; i < placed.length; i++)
      for (let j = i + 1; j < placed.length; j++) {
        const [p, q] = [placed[i], placed[j]];
        expect(p.x < q.x + q.w && p.x + p.w > q.x && p.y < q.y + q.h && p.y + p.h > q.y, `${p.id} vs ${q.id}`).toBe(false);
      }
    for (const b of placed) {
      const a = pack.find((p) => p.id === b.id)!;
      // Distance from the marker centre to the nearest point of its label: within the marker radius plus a small gap.
      const dx = Math.max(b.x - a.mx, 0, a.mx - (b.x + b.w));
      const dy = Math.max(b.y - a.my, 0, a.my - (b.y + b.h));
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(7 + 3 + 0.01);
      expect(b.x).toBeGreaterThanOrEqual(4);
      expect(b.x + b.w).toBeLessThanOrEqual(996);
    }
  });

  it("keeps last frame's side while it is still free (no hopping through corners), flips at the canvas edge, never hides the selected", () => {
    // First frame: right side. Next frame a neighbour appears where the label would go only if it switched sides; it keeps the left side
    // it had, rather than jumping back to the default right.
    const first = placeLabels([anchor("a", 500, 300, 1)], vp, { previous: new Map([["a", { x: 0, y: 0, compact: false, slot: 1 }]]) });
    expect(first.get("a")!.slot).toBe(1);
    const moved = placeLabels([anchor("a", 505, 302, 1)], vp, { previous: first });
    expect(moved.get("a")!.slot).toBe(1);
    expect(placeLabels([anchor("a", 500, 300, 1)], vp)).toEqual(placeLabels([anchor("a", 500, 300, 1)], vp)); // deterministic
    const edge = placeLabels([anchor("e", 990, 300, 1)], vp).get("e")!;
    expect(edge.x + 58).toBeLessThanOrEqual(996);
    const crowd = Array.from({ length: 40 }, (_, i) => anchor(`c${i}`, 10 + (i % 8) * 6, 10 + Math.floor(i / 8) * 5, 50 - i));
    expect(placeLabels([...crowd, anchor("sel", 12, 12, 0)], { w: 120, h: 80 }, { mustShow: "sel" }).has("sel")).toBe(true);
  });
});

describe("fit into the area left free by floating panels", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { PerspectiveCamera, Vector3 } = await import("three");
  const { parseCircuitGeometry } = await import("@/lib/circuit/geometry");
  const { fitInSafeArea } = await import("./fit");
  const parsed = parseCircuitGeometry(JSON.parse(readFileSync(join(process.cwd(), "src/data/circuits/monaco.geometry.json"), "utf8")));
  if (!parsed.ok) throw new Error(parsed.error);
  const mw = centerlineToWorld(parsed.geometry, createWorldTransform(parsed.geometry));

  it("keeps every centerline point inside the safe rectangle, centred there, at desktop and phone fullscreen sizes", () => {
    const cases = [
      { size: { width: 1440, height: 900 }, insets: { top: 80, right: 312, bottom: 88, left: 328 } },
      { size: { width: 1440, height: 900 }, insets: { top: 80, right: 16, bottom: 88, left: 16 } },
      { size: { width: 390, height: 844 }, insets: { top: 64, right: 8, bottom: 140, left: 8 } },
    ];
    for (const { size, insets } of cases) {
      const p = fitInSafeArea(mw, size, insets, 20);
      const cam = new PerspectiveCamera(p.fov, size.width / size.height, 1, 1e6);
      cam.position.set(...p.position);
      cam.lookAt(...p.target);
      cam.updateMatrixWorld();
      const v = new Vector3();
      let [minX, maxX, minY, maxY] = [Infinity, -Infinity, Infinity, -Infinity];
      for (let i = 0; i < mw.length / 3; i++) {
        v.set(mw[i * 3], mw[i * 3 + 1], mw[i * 3 + 2]).project(cam);
        const x = ((v.x + 1) / 2) * size.width;
        const y = ((1 - v.y) / 2) * size.height;
        [minX, maxX, minY, maxY] = [Math.min(minX, x), Math.max(maxX, x), Math.min(minY, y), Math.max(maxY, y)];
      }
      const tol = 2;
      expect(minX).toBeGreaterThanOrEqual(insets.left - tol);
      expect(maxX).toBeLessThanOrEqual(size.width - insets.right + tol);
      expect(minY).toBeGreaterThanOrEqual(insets.top - tol);
      expect(maxY).toBeLessThanOrEqual(size.height - insets.bottom + tol);
      // Roughly centred in the safe rectangle (perspective makes it not exact).
      const cx = (minX + maxX) / 2;
      const safeCx = (insets.left + size.width - insets.right) / 2;
      expect(Math.abs(cx - safeCx)).toBeLessThan((size.width - insets.left - insets.right) * 0.12);
    }
  });
});
