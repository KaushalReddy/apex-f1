import type { LiveSnapshot } from "@/lib/openf1/live";
import { liveStore } from "@/lib/openf1/liveStore";
import type { PollUpdate } from "@/lib/openf1/poller";
import { teamFor } from "@/lib/teams/registry";
import { diffSnapshots } from "./events";
import type { ProviderUpdate, RaceProvider, Scheduler } from "./providers";
import { realScheduler } from "./providers";
import type { TrackPath } from "./track";
import type { DriverState, RaceSnapshot, SessionInfo } from "./types";

/**
 * LIVE: car positions from this site's /api/live (OpenF1 real-time data, fetched server-side). Only genuine live data reaches it: when the
 * feed has no current car locations the view says so (waiting / delayed / unavailable) and draws no cars, never recorded or guessed ones.
 */

export { CAR_STALE_MS, DELAYED_MS, LIVE_POLL_MS, POSITIONS_LIVE_MS, positionFreshness, type LiveLocationState, type PositionFreshness } from "./liveFreshness";
import { DELAYED_MS, LIVE_POLL_MS, CAR_STALE_MS, type LiveLocationState } from "./liveFreshness";
const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);

/** Age of the newest car sample when the server sent this answer: server clock vs OpenF1's timestamps, never the browser's clock. */
export function servedAgeMs(s: LiveSnapshot, latest: string | null): number | null {
  const age = ms(s.servedAt ?? s.fetchedAt) - ms(latest);
  return Number.isFinite(age) ? Math.max(0, age) : null;
}

export function liveLocationState(s: LiveSnapshot): { state: LiveLocationState; latest: string | null; reason: string } {
  if (s.status !== "live" || !s.session) return { state: "unavailable", latest: null, reason: s.reason ?? "No session is running." };
  const times = s.drivers.filter((d) => d.x != null && d.y != null && d.locationAt).map((d) => d.locationAt!);
  const latest = times.length ? times.reduce((a, b) => (ms(a) >= ms(b) ? a : b)) : null;
  if (!latest) return { state: "waiting", latest, reason: "Waiting for car positions from OpenF1." };
  const fetched = ms(s.fetchedAt);
  if (s.stale || !Number.isFinite(fetched) || fetched - ms(latest) > DELAYED_MS)
    return { state: "delayed", latest, reason: s.reason ?? "OpenF1's car positions are delayed: showing the last ones received." };
  return { state: "live", latest, reason: "Live car positions from OpenF1." };
}

/** One live snapshot as the race view's model. Cars without a received location are listed (order, gaps) but have no track position. */
export function toRaceSnapshot(
  s: LiveSnapshot,
  o: { toWorld: (x: number, y: number, z: number) => [number, number, number]; z: number; path: TrackPath; hints: Map<number, number>; circuit: Pick<SessionInfo, "circuitSlug" | "circuitName">; epoch: number },
): RaceSnapshot | null {
  if (!s.session) return null;
  const loc = liveLocationState(s);
  const newest = ms(loc.latest);
  const drivers: DriverState[] = s.drivers.map((d) => {
    let progress: number | null = null;
    if (d.x != null && d.y != null) {
      const [wx, , wz] = o.toWorld(d.x, d.y, o.z);
      progress = o.path.project(wx, wz, o.hints.get(d.number) ?? null);
      o.hints.set(d.number, progress);
    }
    const at = ms(d.locationAt);
    return {
      id: `car-${d.number}`,
      code: d.code ?? `#${d.number}`,
      name: d.name,
      number: d.number,
      teamSlug: teamFor(d.team)?.slug ?? null,
      teamColour: d.colour,
      position: d.position,
      lap: d.lap,
      progress,
      lastLapMs: d.lastLapMs,
      bestLapMs: d.bestLapMs,
      gapToLeaderS: d.gapToLeader,
      gapAheadS: d.interval,
      lapsDown: d.lapsDown,
      pit: null,
      finished: false,
      sampleT: Number.isFinite(at) ? at : 0,
      stale: loc.state !== "live" || !Number.isFinite(at) || newest - at > CAR_STALE_MS,
    } satisfies DriverState;
  });
  return {
    mode: "LIVE",
    source: { name: `OpenF1 live · ${s.session.event ?? ""} ${s.session.name}`.replace(/\s+/g, " "), status: loc.state === "unavailable" ? "error" : "ok", detail: loc.reason },
    // The race's lap is the leader's (OpenF1 does not publish the scheduled lap count, so there is no total).
    session: { id: `openf1-${s.session.key}`, type: s.session.name, status: "running", lap: s.drivers.find((d) => d.position === 1)?.lap ?? null, totalLaps: null, ...o.circuit },
    drivers,
    ordered: drivers.some((d) => d.position != null),
    t: Number.isFinite(newest) ? newest : ms(s.fetchedAt) || 0,
    elapsed: null,
    epoch: o.epoch,
  };
}

/** Detail while the page moves to a session that started after it was opened (components/live/LiveSessionWatch). */
export const SWITCHING = "Switching to the session now on track.";

/**
 * Feeds the race view from the tab's shared /api/live poll (lib/openf1/liveStore: one request at a time, backoff after failures, paused
 * while the tab is hidden). Data for any session other than the one the page opened is never shown.
 */
export class LiveProvider implements RaceProvider {
  readonly mode = "LIVE" as const;
  readonly updateIntervalMs: number;
  /**
   * Snapshots are stamped with when OpenF1 recorded them (on this browser's clock) and drawn this far behind, so markers glide between
   * genuine samples: it must cover arrival lag plus one poll cycle (Mexico race: 2.6-4.4 s + 5.6-8.5 s, at most 12.9 s). Shorter, markers
   * stop at the newest sample and jump when the next arrives.
   */
  readonly renderDelayMs: number;
  private listeners = new Set<(u: ProviderUpdate) => void>();
  private last: ProviderUpdate | null = null;
  private prev: RaceSnapshot | null = null;
  private battleState = new Set<string>();
  private hints = new Map<number, number>();
  private off: (() => void) | null = null;
  private first = true;
  private dataAt: number | null = null;
  private latest: string | null = null;

  constructor(
    private readonly o: {
      toWorld: (x: number, y: number, z: number) => [number, number, number];
      z: number;
      path: TrackPath;
      circuit: Pick<SessionInfo, "circuitSlug" | "circuitName">;
      /** The session the page was opened for: data from any other session is not shown. */
      sessionKey: number;
      /** The live state source (default: the tab's shared store, at the live interval). */
      source?: (fn: (u: PollUpdate<LiveSnapshot>) => void) => () => void;
      intervalMs?: number;
    },
    private readonly scheduler: Scheduler = realScheduler,
  ) {
    this.updateIntervalMs = o.intervalMs ?? LIVE_POLL_MS;
    this.renderDelayMs = 3 * this.updateIntervalMs;
  }

  subscribe(fn: (u: ProviderUpdate) => void) {
    this.listeners.add(fn);
    if (this.last) fn(this.last);
    return () => void this.listeners.delete(fn);
  }

  start() {
    if (this.off) return;
    this.off = (this.o.source ?? ((fn) => liveStore().subscribe(fn, { fast: true })))((u) => this.onUpdate(u));
  }

  dispose() {
    this.off?.();
    this.off = null;
    this.listeners.clear();
  }

  // A live source cannot be paused, rewound or sped up.
  play() {}
  pause() {}
  reset() {}
  setSpeed() {}
  seek() {}

  private onUpdate(u: PollUpdate<LiveSnapshot>) {
    if (!u.error && u.data) return this.apply(u.data);
    // The request failed: keep the last positions on screen, all marked stale, and say why.
    const detail = `Live data could not be reached (${u.error ?? "no answer"}); retrying.`;
    const snapshot = this.prev ? { ...this.prev, drivers: this.prev.drivers.map((d) => ({ ...d, stale: true })), source: { ...this.prev.source, status: "error" as const, detail } } : null;
    this.emit({ snapshot, source: { status: "error", detail }, playback: null, at: this.dataAt ?? this.scheduler.now(), events: [], eventsReset: false });
  }

  private apply(live: LiveSnapshot) {
    // Another session on track (it started after the page opened): show nothing from it until the page follows it.
    const other = live.status === "live" && live.session && live.session.key !== this.o.sessionKey;
    const snapshot = other || live.session?.key !== this.o.sessionKey ? null : toRaceSnapshot(live, { ...this.o, hints: this.hints, epoch: 0 });
    const loc = other ? { state: "waiting" as const, latest: null, reason: SWITCHING } : snapshot ? liveLocationState(live) : { state: "unavailable" as const, latest: null, reason: live.reason ?? "This session is no longer on track." };
    // `at` moves only when OpenF1 sent newer positions, and is when the newest was recorded (receipt minus its age when the server sent
    // it), so freshness is the data's real age, not the polling's.
    if (loc.latest && loc.latest !== this.latest) {
      this.latest = loc.latest;
      this.dataAt = this.scheduler.now() - (servedAgeMs(live, loc.latest) ?? 0);
    }
    const events = snapshot && this.prev && loc.state === "live" ? diffSnapshots(this.prev, snapshot, this.battleState) : [];
    if (snapshot) this.prev = snapshot;
    this.emit({
      snapshot: loc.state === "unavailable" || other ? null : snapshot,
      source: { status: loc.state === "unavailable" ? "error" : loc.state === "waiting" ? "connecting" : "ok", detail: loc.reason },
      playback: null,
      at: this.dataAt ?? this.scheduler.now(),
      events,
      // The first update starts this session's event log (none carried over from a previous session).
      eventsReset: this.first,
    });
    this.first = false;
  }

  private emit(u: ProviderUpdate) {
    this.last = u;
    for (const fn of this.listeners) fn(u);
  }
}
