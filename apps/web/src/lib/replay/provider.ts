import type { RaceEvent } from "@/lib/race/events";
import { realScheduler, type ProviderUpdate, type RaceProvider, type Scheduler } from "@/lib/race/providers";
import type { DriverState, RaceSnapshot } from "@/lib/race/types";
import { teamFor } from "@/lib/teams/registry";
import { ReplayClock, type TimeSource } from "./clock";
import { ReplayModel, type ReplayEvent } from "./model";

type Marker = NonNullable<RaceProvider["timeline"]>["markers"][number];

/**
 * Timeline markers from the dataset's events: official moments as ticks, each Safety Car / VSC as a period from its "DEPLOYED" message to
 * the next ending message of the same kind ("ENDING", "IN THIS LAP"; open until the flag if none), and published pit stops.
 */
export function timelineMarkers(events: readonly ReplayEvent[], code: (n: number) => string): Marker[] {
  const out: Marker[] = [];
  const open = new Map<string, Marker>();
  for (const e of events) {
    if (e.kind === "pit") out.push({ t: e.t, kind: "pit", label: `${code(e.number)} pit stop${e.lap ? `, lap ${e.lap}` : ""}` });
    if (e.kind !== "official") continue;
    if (e.tone !== "safety-car") {
      out.push({ t: e.t, kind: e.tone, label: e.text });
      continue;
    }
    const type = /\bVSC\b|VIRTUAL/i.test(e.text) ? "VSC" : "SC";
    if (/DEPLOYED/i.test(e.text) && !open.has(type)) {
      const m: Marker = { t: e.t, end: e.t, kind: "safety-car", label: type === "VSC" ? "Virtual Safety Car" : "Safety Car" };
      open.set(type, m);
      out.push(m);
    } else if (/ENDING|IN THIS LAP/i.test(e.text) && open.has(type)) {
      open.get(type)!.end = e.t;
      open.delete(type);
    }
  }
  const finish = out.find((m) => m.kind === "finish")?.t;
  for (const m of open.values()) m.end = finish ?? m.t;
  return out.sort((a, b) => a.t - b.t);
}

/** Speeds offered for a full race (about 1.5–2 hours): real time up to a lap in a few seconds. */
export const REPLAY_SPEEDS = [0.5, 1, 2, 5, 10, 30] as const;

/**
 * REPLAY of a recorded race (lib/replay/dataset). Replay time comes only from the ReplayClock; the update timer just samples it, so a late
 * or throttled timer never changes what is shown, only how often. Each update is the complete state at the clock's time (positions,
 * official order, published gaps, laps, pit state), so seeking anywhere is exact. Events are the dataset's (see ReplayModel).
 */
export class HistoricalReplayProvider implements RaceProvider {
  readonly mode = "REPLAY" as const;
  readonly updateIntervalMs = 250;
  readonly speeds = REPLAY_SPEEDS;
  readonly clock: ReplayClock;
  readonly timeline: NonNullable<RaceProvider["timeline"]>;
  private listeners = new Set<(u: ProviderUpdate) => void>();
  private stop: (() => void) | null = null;
  private disposed = false;
  private last: ProviderUpdate | null = null;
  private emittedT = -1;
  private emittedEpoch = -1;
  private readonly idOf: (n: number) => string;

  constructor(
    readonly model: ReplayModel,
    private readonly session: { circuitSlug: string; circuitName: string },
    private readonly scheduler: Scheduler = realScheduler,
    timeSource?: TimeSource,
  ) {
    const ds = model.ds;
    this.clock = new ReplayClock(ds.durationMs, timeSource ?? { now: () => scheduler.now() });
    this.idOf = (n) => `car-${n}`;
    const code = new Map(ds.drivers.map((d) => [d.number, d.acronym ?? `#${d.number}`]));
    this.timeline = {
      durationMs: ds.durationMs,
      startUtc: ds.startUtc,
      lightsOutMs: ds.lightsOutMs,
      markers: timelineMarkers(model.events, (n) => code.get(n) ?? `#${n}`),
    };
    this.clock.subscribe(() => this.emit());
  }

  subscribe(fn: (u: ProviderUpdate) => void) {
    this.listeners.add(fn);
    if (this.last) fn(this.last);
    return () => {
      this.listeners.delete(fn);
    };
  }

  start() {
    if (this.stop || this.disposed) return;
    this.stop = this.scheduler.every(this.updateIntervalMs, () => this.emit());
    this.emit();
  }

  dispose() {
    this.disposed = true;
    this.stop?.();
    this.stop = null;
    this.listeners.clear();
  }

  play() {
    this.clock.play();
  }
  pause() {
    this.clock.pause();
  }
  reset() {
    this.clock.pause();
    this.clock.seek(0);
  }
  setSpeed(speed: number) {
    this.clock.setSpeed(speed);
  }
  seek(fraction: number) {
    if (Number.isFinite(fraction)) this.clock.seek(Math.max(0, Math.min(1, fraction)) * this.model.ds.durationMs);
  }
  seekTime(t: number) {
    this.clock.seek(t);
  }
  step(deltaMs: number) {
    this.clock.step(deltaMs);
  }

  /** The complete replay state at time t (public for tests). */
  snapshotAt(t: number, epoch: number): RaceSnapshot {
    const m = this.model;
    const ds = m.ds;
    const drivers: DriverState[] = ds.drivers.map((d, i) => {
      const pos = m.positionAt(i, t);
      const lap = m.lapAt(i, t);
      const iv = m.intervalAt(i, t);
      const finished = m.finished(i, t);
      return {
        id: this.idOf(d.number),
        code: d.acronym ?? `#${d.number}`,
        name: d.fullName,
        number: d.number,
        teamSlug: teamFor(d.team)?.slug ?? null,
        teamColour: d.teamColour,
        position: m.positionOf(d.number, t),
        lap: lap.lap,
        progress: pos?.progress ?? null,
        lastLapMs: lap.lastS == null ? null : lap.lastS * 1000,
        bestLapMs: lap.bestS == null ? null : lap.bestS * 1000,
        gapToLeaderS: iv?.gap ?? null,
        gapAheadS: iv?.interval ?? null,
        lapsDown: iv?.lapsDown ?? null,
        pit: m.inPit(i, t) ? "in-pit" : "none",
        finished,
        sampleT: t,
        stale: pos?.stale ?? false,
      };
    });
    const leader = drivers.find((d) => d.position === 1);
    const totalLaps = Math.max(0, ...ds.drivers.map((d) => d.laps[d.laps.length - 1]?.[0] ?? 0)) || null;
    const st = this.clock.state();
    return {
      mode: "REPLAY",
      source: { name: `OpenF1 · ${ds.eventName} ${ds.season} race`, status: "ok" },
      session: {
        id: `openf1-${ds.sessionKey}`,
        type: "Race",
        // The race's own state at t; whether playback is paused is reported separately (ProviderUpdate.playback).
        status: t < ds.lightsOutMs ? "not-started" : st.status === "ended" || (m.chequeredT != null && t >= m.chequeredT && drivers.every((d) => d.finished || d.progress == null)) ? "finished" : "running",
        circuitSlug: this.session.circuitSlug,
        circuitName: this.session.circuitName,
        lap: leader?.lap ?? null,
        totalLaps,
      },
      drivers,
      ordered: drivers.some((d) => d.position != null),
      t,
      elapsed: t / ds.durationMs,
      epoch,
    };
  }

  toRaceEvent(e: ReplayEvent): RaceEvent {
    if (e.kind === "official") return { id: e.id, t: e.t, kind: "official", text: e.text, tone: e.tone };
    if (e.kind === "pit") return { id: e.id, t: e.t, kind: "pit-stop", driver: this.idOf(e.number), lap: e.lap, laneS: e.laneS };
    return { id: e.id, t: e.t, kind: "position", driver: this.idOf(e.number), from: e.from, to: e.to };
  }

  private emit() {
    if (this.disposed) return;
    const st = this.clock.state();
    const t = st.t;
    // A jump (new epoch) or moving backwards rebuilds the whole event history up to t; otherwise only the new events are sent.
    const reset = st.epoch !== this.emittedEpoch || t < this.emittedT;
    const all = this.model.eventsUntil(t);
    const fresh = reset ? all : all.filter((e) => e.t > this.emittedT);
    this.emittedT = t;
    this.emittedEpoch = st.epoch;
    const u: ProviderUpdate = {
      snapshot: this.snapshotAt(t, st.epoch),
      source: { status: "ok" },
      playback: { playing: st.status === "playing", speed: st.speed },
      at: this.scheduler.now(),
      // Oldest first, as every provider sends them (the view's log keeps the newest 40).
      events: fresh.slice(-40).map((e) => this.toRaceEvent(e)),
      eventsReset: reset,
    };
    this.last = u;
    for (const fn of this.listeners) fn(u);
  }
}
