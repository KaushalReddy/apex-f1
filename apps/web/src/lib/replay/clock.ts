/**
 * Replay clock: the single source of truth for replay time. Time is computed from a monotonic time source as
 *   anchorT + (now - anchorReal) × speed
 * and re-anchored on every control change, so it never depends on how many frames were rendered or how often a timer fired. Throttled
 * background tabs and late frames simply read a later `now`; playback keeps going while the tab is hidden (like a video, playback is
 * explicit: only pause() stops it). Seeking is exact and deterministic.
 */
export type ClockStatus = "paused" | "playing" | "ended";

export interface TimeSource {
  now(): number;
}

export const monotonic: TimeSource = { now: () => (typeof performance !== "undefined" ? performance.now() : Date.now()) };

export interface ClockState {
  status: ClockStatus;
  /** Replay time in ms, 0..duration. */
  t: number;
  speed: number;
  /** Increments on every discontinuity (seek, step, restart), so views never interpolate across a jump. */
  epoch: number;
}

export class ReplayClock {
  private anchorReal = 0;
  private anchorT = 0;
  private playing = false;
  private speedValue = 1;
  private epochValue = 0;
  private listeners = new Set<(s: ClockState) => void>();

  constructor(
    readonly duration: number,
    private readonly source: TimeSource = monotonic,
  ) {
    if (!(duration > 0) || !Number.isFinite(duration)) throw new Error("replay duration must be a positive number of ms");
  }

  /** Current replay time. Reaching the end stops playback (status "ended"). */
  time(): number {
    if (!this.playing) return this.anchorT;
    const t = this.anchorT + (this.source.now() - this.anchorReal) * this.speedValue;
    if (t >= this.duration) {
      this.anchorT = this.duration;
      this.playing = false;
      this.notify();
      return this.duration;
    }
    return t;
  }

  state(): ClockState {
    const t = this.time();
    return { status: this.playing ? "playing" : t >= this.duration ? "ended" : "paused", t, speed: this.speedValue, epoch: this.epochValue };
  }

  play() {
    if (this.playing) return;
    if (this.anchorT >= this.duration) this.jump(0);
    this.anchorReal = this.source.now();
    this.playing = true;
    this.notify();
  }

  pause() {
    if (!this.playing) return;
    this.anchorT = this.time();
    this.playing = false;
    this.notify();
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  /** Jump to replay time `t` (clamped); keeps playing if it was playing. */
  seek(t: number) {
    if (!Number.isFinite(t)) return;
    this.jump(Math.max(0, Math.min(this.duration, t)));
    this.anchorReal = this.source.now();
    if (this.anchorT >= this.duration) this.playing = false;
    this.notify();
  }

  /** Move by `deltaMs` (negative = back). */
  step(deltaMs: number) {
    this.seek(this.time() + deltaMs);
  }

  /** Back to the start and play. */
  restart() {
    this.seek(0);
    this.play();
  }

  setSpeed(speed: number) {
    if (!(speed > 0) || !Number.isFinite(speed) || speed === this.speedValue) return;
    this.anchorT = this.time(); // re-anchor so the change applies from now, not retroactively
    this.anchorReal = this.source.now();
    this.speedValue = speed;
    this.notify();
  }

  /** Called on control changes (not every frame). */
  subscribe(fn: (s: ClockState) => void): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  private jump(t: number) {
    this.anchorT = t;
    this.epochValue++;
  }

  private notify() {
    const s: ClockState = { status: this.playing ? "playing" : this.anchorT >= this.duration ? "ended" : "paused", t: this.anchorT, speed: this.speedValue, epoch: this.epochValue };
    for (const fn of this.listeners) fn(s);
  }
}
