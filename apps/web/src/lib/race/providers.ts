import type { PositionFrame } from "@/lib/replay/types";
import type { DemoRace } from "./demo";
import { diffSnapshots, type RaceEvent } from "./events";
import type { TrackPath } from "./track";
import type { DriverState, RaceMode, RaceSnapshot, SessionInfo, SourceStatus } from "./types";

/**
 * Data-provider boundary. Views subscribe to updates and never know where data comes from. A future live provider implements the same
 * interface (server-side credentials, a WebSocket or SSE stream) and sets mode "LIVE"; nothing in the visualisation changes.
 */
export interface PlaybackState {
  playing: boolean;
  speed: number;
}

export interface ProviderUpdate {
  snapshot: RaceSnapshot | null;
  source: { status: SourceStatus; detail?: string };
  /** Null for live sources, which cannot be paused, rewound or sped up. */
  playback: PlaybackState | null;
  /** Wall-clock time the update was produced (ms). */
  at: number;
  /** Events since the previous update, oldest first. */
  events: RaceEvent[];
  /** True after a reset/seek/restart: `events` is then the complete history up to now and replaces any earlier log. */
  eventsReset: boolean;
}

export interface RaceProvider {
  readonly mode: RaceMode;
  /** Wall-clock interval between updates (ms); views render one interval behind to interpolate. */
  readonly updateIntervalMs: number;
  subscribe(fn: (u: ProviderUpdate) => void): () => void;
  start(): void;
  dispose(): void;
  play(): void;
  pause(): void;
  reset(): void;
  setSpeed(speed: number): void;
  /** Jump to a fraction (0..1) of the race / recording. */
  seek(fraction: number): void;
}

export interface Scheduler {
  now(): number;
  every(ms: number, fn: () => void): () => void;
}

export const realScheduler: Scheduler = {
  now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()),
  every: (ms, fn) => {
    const id = setInterval(fn, ms);
    return () => clearInterval(id);
  },
};

export const PLAYBACK_SPEEDS = [1, 2, 4, 8, 16] as const;

/** Shared playback mechanics: a session clock that advances by (wall interval x speed) while playing. */
abstract class PlaybackProvider implements RaceProvider {
  abstract readonly mode: RaceMode;
  readonly updateIntervalMs: number;
  protected t = 0;
  protected epoch = 0;
  protected playing = false;
  protected speed: number;
  protected status: SourceStatus = "connecting";
  protected detail: string | undefined;
  private listeners = new Set<(u: ProviderUpdate) => void>();
  private stopTimer: (() => void) | null = null;
  private last: ProviderUpdate | null = null;
  private disposed = false;
  private emittedT = 0;
  private pendingReset = true;

  constructor(
    protected readonly scheduler: Scheduler,
    opts: { intervalMs?: number; speed?: number },
  ) {
    this.updateIntervalMs = opts.intervalMs ?? 250;
    this.speed = opts.speed ?? 1;
  }

  /** Session length in ms, or null until known. */
  protected abstract duration(): number | null;
  protected abstract snapshotAt(t: number): RaceSnapshot | null;
  /** Events between two session times (reset = start a fresh history from t0). Sources without race order report none. */
  protected collectEvents?(t0: number, t1: number, reset: boolean): RaceEvent[];

  subscribe(fn: (u: ProviderUpdate) => void) {
    this.listeners.add(fn);
    if (this.last) fn(this.last);
    return () => {
      this.listeners.delete(fn);
    };
  }

  start() {
    if (this.stopTimer || this.disposed) return;
    this.stopTimer = this.scheduler.every(this.updateIntervalMs, () => this.tick());
    this.emit();
  }

  dispose() {
    this.disposed = true;
    this.stopTimer?.();
    this.stopTimer = null;
    this.listeners.clear();
  }

  /** Advance one update interval (called by the scheduler; public for tests). */
  tick() {
    const d = this.duration();
    if (this.playing && d != null) {
      this.t = Math.min(d, this.t + this.updateIntervalMs * this.speed);
      if (this.t >= d) this.playing = false;
    }
    this.emit();
  }

  play() {
    const d = this.duration();
    if (d == null) return;
    if (this.t >= d) this.jump(0);
    this.playing = true;
    this.emit();
  }

  pause() {
    this.playing = false;
    this.emit();
  }

  reset() {
    this.playing = false;
    this.jump(0);
    this.emit();
  }

  setSpeed(speed: number) {
    if (!(speed > 0) || !Number.isFinite(speed)) return;
    this.speed = speed;
    this.emit();
  }

  seek(fraction: number) {
    const d = this.duration();
    if (d == null || !Number.isFinite(fraction)) return;
    this.jump(Math.max(0, Math.min(1, fraction)) * d);
    this.emit();
  }

  private jump(t: number) {
    this.t = t;
    this.epoch++;
    this.pendingReset = true;
  }

  protected emit() {
    if (this.disposed) return;
    const reset = this.pendingReset;
    const events = (reset ? this.collectEvents?.(0, this.t, true) : this.t > this.emittedT ? this.collectEvents?.(this.emittedT, this.t, false) : []) ?? [];
    this.pendingReset = false;
    this.emittedT = this.t;
    const u: ProviderUpdate = {
      snapshot: this.snapshotAt(this.t),
      source: { status: this.status, detail: this.detail },
      playback: { playing: this.playing, speed: this.speed },
      at: this.scheduler.now(),
      events,
      eventsReset: reset,
    };
    this.last = u;
    for (const fn of this.listeners) fn(u);
  }
}

/** DEMO: the deterministic simulator. Always available, no network, no credentials. */
export class DemoProvider extends PlaybackProvider {
  readonly mode = "DEMO" as const;

  constructor(
    private readonly race: DemoRace,
    scheduler: Scheduler = realScheduler,
    opts: { intervalMs?: number; speed?: number; autoplay?: boolean } = {},
  ) {
    super(scheduler, { speed: 4, ...opts });
    this.status = "ok";
    this.playing = opts.autoplay ?? true;
  }

  protected duration() {
    return this.race.durationMs;
  }

  protected snapshotAt(t: number): RaceSnapshot {
    return { ...this.race.snapshotAt(t), mode: "DEMO", source: { name: "APEX F1 race simulator", status: "ok" }, epoch: this.epoch };
  }

  /** Session-time resolution of event detection: independent of playback speed, so 1x and 16x report the same race. */
  static readonly EVENT_STEP_MS = 1000;
  private evPrev: RaceSnapshot | null = null;
  private battleState = new Set<string>();

  protected override collectEvents(t0: number, t1: number, reset: boolean): RaceEvent[] {
    if (reset) {
      this.evPrev = null;
      this.battleState = new Set();
    }
    const out: RaceEvent[] = [];
    const step = DemoProvider.EVENT_STEP_MS;
    // Sample only on a fixed grid of session times (multiples of the step) in (t0, t1], plus the very end of the session, so the events
    // do not depend on playback speed or update timing.
    const times: number[] = reset ? [0] : [];
    for (let t = (Math.floor(t0 / step) + 1) * step; t <= t1; t += step) times.push(t);
    const end = this.race.durationMs;
    if (t1 >= end && times[times.length - 1] !== end) times.push(end);
    for (const t of times) {
      const s = this.snapshotAt(t);
      out.push(...diffSnapshots(this.evPrev ? { ...this.evPrev, epoch: s.epoch } : null, s, this.battleState));
      this.evPrev = s;
    }
    return out;
  }
}

/** Validates stored replay frames from the API. Malformed cars are dropped (and counted); frames in another coordinate system are rejected. */
export function parseReplayFrames(raw: unknown, coordinateSystem: string): { frames: PositionFrame[]; droppedCars: number; rejectedFrames: number } {
  if (!Array.isArray(raw)) throw new Error("Replay response is not a list of frames");
  let droppedCars = 0;
  let rejectedFrames = 0;
  const frames: PositionFrame[] = [];
  for (const f of raw as Array<Partial<PositionFrame>>) {
    if (!f || typeof f !== "object" || !Number.isFinite(f.t) || !Array.isArray(f.cars)) {
      rejectedFrames++;
      continue;
    }
    if (f.coordinateSystem !== undefined && f.coordinateSystem !== coordinateSystem) {
      rejectedFrames++;
      continue;
    }
    const cars = f.cars.filter((c) => {
      const ok = c && Number.isInteger(c.driverNumber) && [c.x, c.y, c.z, c.sampleT].every((v) => Number.isFinite(v));
      if (!ok) droppedCars++;
      return ok;
    });
    frames.push({ sessionKey: Number(f.sessionKey), mode: "REPLAY", t: f.t as number, coordinateSystem: f.coordinateSystem, cars });
  }
  frames.sort((a, b) => a.t - b.t);
  return { frames, droppedCars, rejectedFrames };
}

/**
 * REPLAY: stored OpenF1 location samples served by the APEX F1 API. The frames carry car numbers and x/y/z only, so identity is the car
 * number, there is no race order and no timing; positions are projected onto the same circuit path the track is drawn from.
 */
export class ReplayProvider extends PlaybackProvider {
  readonly mode = "REPLAY" as const;
  private frames: PositionFrame[] = [];
  private hints = new Map<number, number>();

  constructor(
    private readonly opts: {
      load: () => Promise<unknown>;
      coordinateSystem: string;
      /** Source (x, y, z) -> world, using the circuit's shared transform. */
      toWorld: (x: number, y: number, z: number) => [number, number, number];
      path: TrackPath;
      session: Omit<SessionInfo, "status" | "lap" | "totalLaps">;
      sourceName: string;
    },
    scheduler: Scheduler = realScheduler,
  ) {
    super(scheduler, { speed: 1 });
  }

  override start() {
    super.start();
    this.opts
      .load()
      .then((raw) => {
        const { frames, droppedCars, rejectedFrames } = parseReplayFrames(raw, this.opts.coordinateSystem);
        this.frames = frames;
        if (frames.length === 0) {
          this.status = "error";
          this.detail = "The replay source returned no usable frames for this window.";
        } else {
          this.status = "ok";
          const skipped = droppedCars + rejectedFrames;
          this.detail = skipped ? `${skipped} malformed sample${skipped === 1 ? "" : "s"} skipped.` : undefined;
          this.playing = true;
        }
        this.emit();
      })
      .catch((e: unknown) => {
        this.status = "error";
        this.detail = e instanceof Error ? e.message : "The replay source could not be reached.";
        this.emit();
      });
  }

  protected duration() {
    return this.frames.length > 1 ? this.frames[this.frames.length - 1].t - this.frames[0].t : this.frames.length ? 0 : null;
  }

  protected snapshotAt(t: number): RaceSnapshot | null {
    if (this.frames.length === 0) return null;
    const t0 = this.frames[0].t;
    let frame = this.frames[0];
    for (const f of this.frames) if (f.t - t0 <= t) frame = f;
    const d = this.duration() || 1;
    const drivers: DriverState[] = frame.cars
      .map((c) => {
        const [wx, , wz] = this.opts.toWorld(c.x, c.y, c.z);
        const progress = this.opts.path.project(wx, wz, this.hints.get(c.driverNumber) ?? null);
        this.hints.set(c.driverNumber, progress);
        return {
          id: `car-${c.driverNumber}`,
          code: `#${c.driverNumber}`,
          name: null,
          number: c.driverNumber,
          teamSlug: null,
          position: null,
          lap: null,
          progress,
          lastLapMs: null,
          bestLapMs: null,
          gapToLeaderS: null,
          gapAheadS: null,
          lapsDown: null,
          pit: null,
          finished: false,
          sampleT: c.sampleT,
          stale: c.stale === true || frame.t - c.sampleT > 2000,
        } satisfies DriverState;
      })
      .sort((a, b) => (a.number ?? 0) - (b.number ?? 0));
    return {
      mode: "REPLAY",
      source: { name: this.opts.sourceName, status: this.status, detail: this.detail },
      session: { ...this.opts.session, status: t >= d ? "finished" : "running", lap: null, totalLaps: null },
      drivers,
      ordered: false,
      t: frame.t,
      elapsed: t / d,
      epoch: this.epoch,
    };
  }
}
