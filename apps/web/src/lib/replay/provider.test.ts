import { describe, expect, it } from "vitest";
import type { ProviderUpdate, Scheduler } from "@/lib/race/providers";
import { parseReplay } from "./dataset";
import { ReplayModel } from "./model";
import { fixture, project } from "./model.test";
import { HistoricalReplayProvider } from "./provider";

/** Deterministic scheduler: time moves and timers fire only when the test says so. */
function fakeScheduler() {
  let now = 0;
  const timers = new Set<() => void>();
  const s: Scheduler & { advance(ms: number): void; count(): number } = {
    now: () => now,
    every: (_ms, fn) => {
      timers.add(fn);
      return () => timers.delete(fn);
    },
    advance(ms) {
      now += ms;
      timers.forEach((f) => f());
    },
    count: () => timers.size,
  };
  return s;
}
function setup() {
  const r = parseReplay(fixture());
  if (!r.ok) throw new Error(r.error);
  const sch = fakeScheduler();
  const p = new HistoricalReplayProvider(new ReplayModel(r.value, project), { circuitSlug: "test", circuitName: "Test" }, sch);
  const updates: ProviderUpdate[] = [];
  p.subscribe((u) => updates.push(u));
  p.start();
  return { p, sch, updates, last: () => updates[updates.length - 1] };
}

describe("HistoricalReplayProvider", () => {
  it("starts paused at 0 and plays by elapsed time × speed, even if the timer fires late", () => {
    const { p, sch, last } = setup();
    expect(last().snapshot!.t).toBe(0);
    expect(last().playback).toEqual({ playing: false, speed: 1 });
    p.setSpeed(5);
    p.play();
    sch.advance(4000); // one late timer tick covering 4 s
    expect(last().snapshot!.t).toBe(20_000);
  });
  it("seeking gives the exact state at that time: order, lap, gaps, pit, and the event history up to it", () => {
    const { p, last } = setup();
    p.seekTime(130_000 + 5_000);
    const s = last().snapshot!;
    const car2 = s.drivers.find((d) => d.number === 2)!;
    expect(car2).toMatchObject({ code: "BBB", position: 2, lap: 2, pit: "in-pit", gapToLeaderS: 10.2 });
    expect(s.session.lap).toBe(2);
    expect(last().eventsReset).toBe(true);
    expect(last().events.map((e) => e.kind)).toEqual(["official", "position", "position", "position", "position", "official", "pit-stop"]);
    p.seek(0.5);
    expect(last().snapshot!.t).toBe(200_000);
    p.step!(-10_000);
    expect(last().snapshot!.t).toBe(190_000);
  });
  it("sends only new events while playing forward", () => {
    const { p, sch, last } = setup();
    p.seekTime(85_000);
    p.play();
    sch.advance(10_000);
    expect(last().eventsReset).toBe(false);
    expect(last().events.map((e) => e.kind)).toEqual(["official"]); // the VSC at 90 s
  });
  it("is not started before lights out, finished after the flag, and stops its timer on dispose", () => {
    const { p, sch, last } = setup();
    expect(last().snapshot!.session.status).toBe("not-started");
    p.seekTime(400_000);
    expect(last().snapshot!.session.status).toBe("finished");
    p.dispose();
    expect(sch.count()).toBe(0);
  });
  it("exposes timeline markers for official events and pit stops only", () => {
    const { p } = setup();
    expect(p.timeline.markers.map((m) => m.kind)).toEqual(["start", "safety-car", "pit", "finish"]);
  });
});

describe("timelineMarkers", () => {
  it("pairs Safety Car and VSC messages into periods and keeps other moments as ticks", async () => {
    const { timelineMarkers } = await import("./provider");
    const off = (t: number, text: string, tone: "start" | "finish" | "safety-car" | "red-flag") => ({ id: `${t}`, t, kind: "official" as const, text, tone });
    const m = timelineMarkers(
      [off(0, "RACE START", "start"), off(100, "VSC DEPLOYED", "safety-car"), off(160, "VSC ENDING", "safety-car"), off(300, "SAFETY CAR DEPLOYED", "safety-car"), { id: "p", t: 350, kind: "pit", number: 4, lap: 9, laneS: 21 }, off(400, "SAFETY CAR IN THIS LAP", "safety-car"), off(900, "CHEQUERED FLAG", "finish")],
      (n) => `#${n}`,
    );
    expect(m.map((x) => [x.kind, x.t, x.end])).toEqual([["start", 0, undefined], ["safety-car", 100, 160], ["safety-car", 300, 400], ["pit", 350, undefined], ["finish", 900, undefined]]);
    expect(m[1].label).toBe("Virtual Safety Car");
  });
});
