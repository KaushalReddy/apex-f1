import { describe, expect, it } from "vitest";
import { ReplayClock } from "./clock";

/** Test time source: advances only when told to (deterministic). */
function fakeTime() {
  let t = 1000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("ReplayClock", () => {
  it("advances with elapsed real time × speed, not with calls", () => {
    const ft = fakeTime();
    const c = new ReplayClock(60_000, ft);
    expect(c.state()).toMatchObject({ status: "paused", t: 0 });
    c.play();
    ft.advance(2000);
    expect(c.time()).toBe(2000);
    expect(c.time()).toBe(2000); // reading does not advance it
    c.setSpeed(5);
    ft.advance(1000);
    expect(c.time()).toBe(7000); // the speed change applies from the moment it was made
  });

  it("pauses and resumes without losing or gaining time", () => {
    const ft = fakeTime();
    const c = new ReplayClock(60_000, ft);
    c.play();
    ft.advance(3000);
    c.pause();
    ft.advance(10_000); // paused: wall time passes, replay time does not
    expect(c.state()).toMatchObject({ status: "paused", t: 3000 });
    c.play();
    ft.advance(500);
    expect(c.time()).toBe(3500);
  });

  it("seeks deterministically to the start, middle and end, and steps", () => {
    const ft = fakeTime();
    const c = new ReplayClock(60_000, ft);
    const e0 = c.state().epoch;
    c.seek(30_000);
    expect(c.time()).toBe(30_000);
    expect(c.state().epoch).toBe(e0 + 1);
    c.step(-10_000);
    expect(c.time()).toBe(20_000);
    c.seek(-5);
    expect(c.time()).toBe(0);
    c.seek(1e9);
    expect(c.state()).toMatchObject({ status: "ended", t: 60_000 });
    c.seek(Number.NaN);
    expect(c.time()).toBe(60_000);
  });

  it("stops at the end, then plays again from the start; restart plays from 0", () => {
    const ft = fakeTime();
    const c = new ReplayClock(10_000, ft);
    c.play();
    ft.advance(15_000);
    expect(c.state()).toMatchObject({ status: "ended", t: 10_000 });
    c.play();
    expect(c.time()).toBe(0);
    ft.advance(1000);
    c.restart();
    expect(c.state()).toMatchObject({ status: "playing", t: 0 });
  });

  it("notifies on control changes only and stops notifying after unsubscribe", () => {
    const ft = fakeTime();
    const c = new ReplayClock(10_000, ft);
    const seen: string[] = [];
    const off = c.subscribe((s) => seen.push(s.status));
    c.play();
    ft.advance(100);
    c.time();
    c.pause();
    off();
    c.play();
    expect(seen).toEqual(["playing", "paused"]);
  });

  it("rejects an invalid duration", () => {
    expect(() => new ReplayClock(0)).toThrow();
  });
});
