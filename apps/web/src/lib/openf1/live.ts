import type { OpenF1Http } from "./http";
import { OpenF1RequestError } from "./http";

/**
 * SERVER ONLY. Live timing from OpenF1 (real-time data needs a paid OpenF1 subscription: OPENF1_USERNAME / OPENF1_PASSWORD).
 *
 * Delivery: REST polling on demand. A poll happens only when someone asks for the live state and the last poll is older than `pollMs`;
 * every visitor shares it (one OpenF1 request set per interval, whatever the audience) and nothing runs when nobody is watching. This works
 * on any host, including ones that cannot keep a process or socket open. OpenF1 also offers MQTT/WebSocket push (mqtt.openf1.org); a
 * persistent worker could feed this same state from it later (docs/DATA_PIPELINE.md).
 *
 * Data: each endpoint is polled incrementally (`date>` the newest record seen), deduplicated, and kept bounded (latest value per driver,
 * the last RC_LIMIT race-control messages). Source timestamps are kept as published; `fetchedAt` is when APEX F1 retrieved them. When a
 * poll fails the last data is kept and marked stale; it is never presented as current.
 */
export const RC_LIMIT = 50;
/** A session counts as live from shortly before its scheduled start to shortly after its scheduled end. */
const LIVE_BEFORE_MS = 15 * 60_000;
const LIVE_AFTER_MS = 30 * 60_000;
/** Defaults for how far back the first location request of a session reaches, and how much each later one re-reads (see poll). */
export const LOCATION_BACKFILL_MS = 60_000;
export const LOCATION_OVERLAP_MS = 10_000;
/** Failures that affect every endpoint alike (see poll). */
const GLOBAL_FAILURES = new Set(["auth", "unconfigured", "rate-limit", "suppressed"]);
/** Laps are read every this many polls (~14 s): a lap time changes once a lap per car, and each request counts against OpenF1's limits. */
const LAPS_EVERY_POLLS = 2;

export type LiveStatus = "unavailable" | "idle" | "live" | "error";

export interface LiveDriver {
  number: number;
  code: string | null;
  name: string | null;
  team: string | null;
  colour: string | null;
  position: number | null;
  positionAt: string | null;
  gapToLeader: number | null;
  lapsDown: number | null;
  interval: number | null;
  /** Lap the car is on (OpenF1 creates a lap's row when it starts), its last completed lap and its best lap (ms); null until known. */
  lap: number | null;
  lastLapMs: number | null;
  bestLapMs: number | null;
  /** OpenF1 location (source coordinates) and its timestamp; null until received. */
  x: number | null;
  y: number | null;
  locationAt: string | null;
}

export interface LiveSnapshot {
  status: LiveStatus;
  /** Plain-language reason for unavailable / idle / error states (never credentials or raw errors). */
  reason: string | null;
  errorCategory: string | null;
  session: { key: number; name: string; event: string | null; circuit: string | null; start: string; end: string } | null;
  next: { name: string; event: string | null; start: string } | null;
  /** The next session named "Race" on the public schedule (null when OpenF1 does not list one yet). */
  nextRace: { name: string; event: string | null; start: string } | null;
  drivers: LiveDriver[];
  raceControl: { date: string; category: string | null; flag: string | null; message: string }[];
  /** Newest record timestamp from OpenF1 (when the source recorded it). */
  sourceTime: string | null;
  /** When APEX F1 last retrieved live data successfully. */
  fetchedAt: string | null;
  /** When the server produced this answer (its clock, like fetchedAt): the data's age when sent, even if served from the last poll. */
  servedAt?: string;
  /** True when the last poll failed or the data is older than three poll intervals: shown, but not as current. */
  stale: boolean;
  pollMs: number;
  /** Development only (app/api/live/route.ts): read-only pipeline metadata for the Live Race Health panel. */
  diag?: LiveDiagnostics;
}

/** Safe, read-only feed metadata for developer diagnostics: no credentials, tokens or response bodies. Times are server ISO times. */
export interface LiveDiagnostics {
  /** OPENF1_USERNAME and OPENF1_PASSWORD are both set on the server (says nothing about whether OpenF1 accepts them). */
  credentialsConfigured: boolean;
  /** Last poll attempt (whether or not it succeeded). */
  lastPollAt: string | null;
  /** Rows the last location request returned (null: not requested in the last poll, or it failed). */
  lastLocationRows: number | null;
  /** When a location request last returned at least one row (an empty answer is not a location update). */
  lastLocationRowsAt: string | null;
  /** Of the last location rows: how many moved a car to a newer position (the rest were already seen, e.g. the overlap re-read). */
  lastLocationNew: number | null;
  /** Of those, how many were dated at or before the previous cursor: late rows only the overlap re-read could deliver. */
  lastLocationLate: number | null;
  /** The last polls (newest first, at most RECENT_POLLS): where each poll's time went, for finding slow or failing ones. */
  recentPolls: PollRecord[];
  /** Duration of the last successful refresh, ms: all endpoints, plus the schedule when it was due (OPENF1 request time + spacing). */
  lastPollMs: number | null;
  /** The last poll's failure, as already sanitised by the HTTP client (category and a message with no credentials). */
  lastError: { category: string; message: string } | null;
}

/** One poll of OpenF1 (developer diagnostics): times in ms; request counts from the HTTP client's own counters. No URLs or bodies. */
export interface PollRecord {
  at: string;
  ms: number;
  /** Schedule reload before the poll (when one was due), else null. */
  scheduleMs: number | null;
  /** Time spent on each endpoint, in poll order (0: skipped, e.g. driver list already loaded or laps not due). */
  steps: Record<string, number>;
  requests: number;
  retries: number;
  rateLimited: number;
  error: string | null;
}
/** Polls kept for diagnostics, and the duration from which one is reported as slow (onSlowPoll). */
const RECENT_POLLS = 20;
export const SLOW_POLL_MS = 5000;

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const lapsDown = (v: unknown) => (typeof v === "string" && /^\+(\d+) LAPS?$/i.test(v) ? Number(/\d+/.exec(v)![0]) : null);
const ms = (iso: string | null) => (iso ? Date.parse(iso) : NaN);

interface SessionRow {
  key: number;
  name: string;
  event: string | null;
  circuit: string | null;
  start: string;
  end: string;
}
const toSession = (r: Row | undefined): SessionRow | null => {
  if (!r || !Number.isInteger(r.session_key) || !str(r.date_start) || !str(r.date_end)) return null;
  return { key: r.session_key as number, name: str(r.session_name) ?? "Session", event: str(r.country_name) ?? str(r.location), circuit: str(r.circuit_short_name), start: r.date_start as string, end: r.date_end as string };
};

export interface LiveFeedOptions {
  /** Authenticated client (null: no subscription configured). */
  authed: OpenF1Http | null;
  /** Unauthenticated client, for the public schedule only. */
  open: OpenF1Http;
  now?: () => number;
  pollMs?: number;
  scheduleMs?: number;
  /** First location request of a session: this far back (OPENF1_LIVE_LOCATION_BACKFILL_MS). */
  locationBackfillMs?: number;
  /** Later location requests re-read this much before the newest record seen (OPENF1_LIVE_LOCATION_OVERLAP_MS). */
  locationOverlapMs?: number;
  /** Called after a poll that took at least SLOW_POLL_MS (development logging: lib/openf1/server.ts). */
  onSlowPoll?: (r: PollRecord) => void;
}

export class LiveFeed {
  private readonly now: () => number;
  private readonly pollMs: number;
  private readonly scheduleMs: number;
  private session: SessionRow | null = null;
  private next: LiveSnapshot["next"] = null;
  private nextRace: LiveSnapshot["nextRace"] = null;
  private scheduleAt = -Infinity;
  private lastPoll = -Infinity;
  private fetchedAt: number | null = null;
  private failure: OpenF1RequestError | null = null;
  private drivers = new Map<number, LiveDriver>();
  private rc: LiveSnapshot["raceControl"] = [];
  private rcSeen = new Set<string>();
  private polls = 0;
  private recent: PollRecord[] = [];
  /** Car numbers in the session's OpenF1 driver list (empty until loaded). */
  private listed = new Set<number>();
  /** Per car: the lap number of its last completed lap (so an older row never replaces a newer lap time). */
  private lastLapNo = new Map<number, number>();
  private cursors: Record<string, string> = {};
  private pending: Promise<void> | null = null;
  // Diagnostics only (diagnostics()): nothing reads these to decide anything.
  private locationRows: number | null = null;
  private locationRowsAt: number | null = null;
  private locationNew: number | null = null;
  private locationLate: number | null = null;
  private pollDuration: number | null = null;

  constructor(private readonly o: LiveFeedOptions) {
    this.now = o.now ?? Date.now;
    this.pollMs = o.pollMs ?? 5000;
    this.scheduleMs = o.scheduleMs ?? 60_000;
  }

  /** The current live state, refreshing first when due (shared by all callers). */
  async snapshot(): Promise<LiveSnapshot> {
    this.pending ??= this.refresh().finally(() => (this.pending = null));
    await this.pending;
    return this.view();
  }

  private async refresh() {
    const now = this.now();
    const stats = this.o.authed ? { ...this.o.authed.stats } : null;
    let scheduleMs: number | null = null;
    if (now - this.scheduleAt >= this.scheduleMs) {
      await this.loadSchedule(now);
      scheduleMs = this.now() - now;
    }
    if (!this.o.authed || !this.session || !this.isLive(this.session, now)) return;
    if (now - this.lastPoll < this.pollMs) return;
    this.lastPoll = now;
    const steps: Record<string, number> = {};
    try {
      await this.poll(this.session.key, steps);
      this.fetchedAt = this.now();
      this.pollDuration = this.fetchedAt - now;
      this.failure = null;
    } catch (e) {
      this.failure = e instanceof OpenF1RequestError ? e : new OpenF1RequestError("unavailable", "live poll failed");
    }
    const after = this.o.authed.stats;
    const record: PollRecord = {
      at: new Date(now).toISOString(),
      ms: this.now() - now,
      scheduleMs,
      steps,
      requests: (after?.requests ?? 0) - (stats?.requests ?? 0),
      retries: (after?.retries ?? 0) - (stats?.retries ?? 0),
      rateLimited: (after?.rateLimited ?? 0) - (stats?.rateLimited ?? 0),
      error: this.failure?.category ?? null,
    };
    this.recent = [record, ...this.recent].slice(0, RECENT_POLLS);
    if (record.ms >= SLOW_POLL_MS) this.o.onSlowPoll?.(record);
  }

  private isLive(s: SessionRow, now: number) {
    return now >= ms(s.start) - LIVE_BEFORE_MS && now <= ms(s.end) + LIVE_AFTER_MS;
  }

  /** The schedule: the latest session (authenticated when possible) and the next one from the public calendar. */
  private async loadSchedule(now: number) {
    this.scheduleAt = now;
    try {
      // The public schedule (unauthenticated): sessions starting from three hours ago, so a session in progress is included.
      const since = new Date(now - 3 * 3_600_000).toISOString().slice(0, 19);
      const path = `sessions?date_start>=${since}`;
      // During a live session OpenF1 refuses anonymous requests (401), so retry with the login when there is one.
      const rows = (await this.o.open.get(path).catch((e) => (this.o.authed ? this.o.authed.get(path) : Promise.reject(e)))) as Row[];
      const sessions = rows.map(toSession).filter((s): s is SessionRow => !!s).sort((a, b) => ms(a.start) - ms(b.start));
      const current = sessions.find((s) => this.isLive(s, now)) ?? null;
      const upcoming = sessions.find((s) => ms(s.start) > now) ?? null;
      this.next = upcoming ? { name: upcoming.name, event: upcoming.event, start: upcoming.start } : null;
      const race = sessions.find((s) => ms(s.start) > now && s.name === "Race");
      this.nextRace = race ? { name: race.name, event: race.event, start: race.start } : null;
      if (current?.key !== this.session?.key) this.resetSession(current);
    } catch (e) {
      // Schedule unavailable: keep what we had; a live poll still reports its own failures.
      if (!this.session) this.failure = e instanceof OpenF1RequestError ? e : null;
    }
  }

  private resetSession(s: SessionRow | null) {
    this.session = s;
    this.drivers.clear();
    this.rc = [];
    this.rcSeen.clear();
    this.cursors = {};
    this.polls = 0;
    this.recent = [];
    this.lastLapNo.clear();
    this.listed.clear();
    this.lastPoll = -Infinity;
    this.fetchedAt = null;
    this.locationRows = null;
    this.locationRowsAt = null;
    this.locationNew = null;
    this.locationLate = null;
    this.pollDuration = null;
  }

  private since(endpoint: string) {
    return this.cursors[endpoint] ? `&date>${encodeURIComponent(this.cursors[endpoint])}` : "";
  }

  private advance(endpoint: string, rows: Row[]) {
    for (const r of rows) {
      const d = str(r.date);
      if (d && (!this.cursors[endpoint] || ms(d) > ms(this.cursors[endpoint]))) this.cursors[endpoint] = d;
    }
  }

  private driver(n: number): LiveDriver {
    let d = this.drivers.get(n);
    if (!d) {
      d = { number: n, code: null, name: null, team: null, colour: null, position: null, positionAt: null, gapToLeader: null, lapsDown: null, interval: null, lap: null, lastLapMs: null, bestLapMs: null, x: null, y: null, locationAt: null };
      this.drivers.set(n, d);
    }
    return d;
  }

  private async poll(key: number, steps: Record<string, number> = {}) {
    const http = this.o.authed!;
    const get = (path: string) => http.get(path) as Promise<Row[]>;
    this.locationRows = null;
    this.locationNew = null;
    this.locationLate = null;
    // Each endpoint on its own: one that is empty (404: e.g. no intervals in practice) or failing never keeps the others from updating.
    // Provider-wide failures (login, rate limit, client paused) stop the poll at once: every later request would fail the same way.
    let failure: unknown = null;
    const step = async (name: string, fn: () => Promise<void>) => {
      if (failure instanceof OpenF1RequestError && GLOBAL_FAILURES.has(failure.category)) return;
      const t0 = this.now();
      try {
        await fn();
      } catch (e) {
        failure ??= e;
      } finally {
        steps[name] = this.now() - t0;
      }
    };
    await step("drivers", async () => {
      if (this.listed.size) return;
      for (const r of await get(`drivers?session_key=${key}`)) {
        if (!Number.isInteger(r.driver_number)) continue;
        this.listed.add(r.driver_number as number);
        const d = this.driver(r.driver_number as number);
        d.code = str(r.name_acronym);
        d.name = str(r.full_name);
        d.team = str(r.team_name);
        d.colour = str(r.team_colour) ? `#${r.team_colour}` : null;
      }
    });
    // Each record replaces the driver's value only when newer (late or repeated rows are ignored).
    await step("position", async () => {
      const position = await get(`position?session_key=${key}${this.since("position")}`);
      for (const r of position) {
        const d = str(r.date);
        if (!Number.isInteger(r.driver_number) || !d) continue;
        const x = this.driver(r.driver_number as number);
        if (!x.positionAt || ms(d) > ms(x.positionAt)) Object.assign(x, { position: num(r.position), positionAt: d });
      }
      this.advance("position", position);
    });
    await step("intervals", async () => {
      const intervals = await get(`intervals?session_key=${key}${this.since("intervals")}`);
      const ivAt = new Map<number, number>();
      for (const r of intervals) {
        const d = str(r.date);
        if (!Number.isInteger(r.driver_number) || !d) continue;
        const n = r.driver_number as number;
        if ((ivAt.get(n) ?? -Infinity) >= ms(d)) continue;
        ivAt.set(n, ms(d));
        Object.assign(this.driver(n), { gapToLeader: num(r.gap_to_leader), lapsDown: lapsDown(r.gap_to_leader), interval: num(r.interval) });
      }
      this.advance("intervals", intervals);
    });
    await step("race_control", async () => {
      const rc = await get(`race_control?session_key=${key}${this.since("race_control")}`);
      for (const r of rc) {
        const d = str(r.date);
        const m = str(r.message);
        if (!d || !m || this.rcSeen.has(`${d}|${m}`)) continue;
        this.rcSeen.add(`${d}|${m}`);
        this.rc.push({ date: d, category: str(r.category), flag: str(r.flag), message: m });
      }
      this.rc.sort((a, b) => ms(b.date) - ms(a.date));
      if (this.rc.length > RC_LIMIT) {
        for (const x of this.rc.splice(RC_LIMIT)) this.rcSeen.delete(`${x.date}|${x.message}`);
      }
      this.advance("race_control", rc);
    });
    const lapsDue = this.polls++ % LAPS_EVERY_POLLS === 0;
    await step("laps", async () => {
      if (!lapsDue) return;
      // OpenF1 creates a lap's row when the lap starts and fills lap_duration when it ends, so re-read the last three lap numbers (the
      // leader's open lap plus cars up to two laps down) rather than only rows newer than a date. The first request reads every lap.
      // shortcut: a car more than two laps down gets its lap times only from the first request; widen the window if that matters.
      const top = Math.max(0, ...[...this.drivers.values()].map((d) => d.lap ?? 0));
      const laps = await get(`laps?session_key=${key}${top ? `&lap_number>=${Math.max(1, top - 2)}` : ""}`);
      for (const r of laps) {
        const n = r.driver_number;
        const no = num(r.lap_number);
        if (!Number.isInteger(n) || no == null) continue;
        const d = this.driver(n as number);
        d.lap = Math.max(d.lap ?? 0, no);
        const dur = num(r.lap_duration);
        if (dur == null || dur <= 0) continue; // the lap in progress (or no time recorded)
        const ms = Math.round(dur * 1000);
        if (no >= (this.lastLapNo.get(n as number) ?? 0)) {
          this.lastLapNo.set(n as number, no);
          d.lastLapMs = ms;
        }
        // shortcut: OpenF1's lap_duration includes laps later deleted for track limits, so this can be faster than the official best.
        if (d.bestLapMs == null || ms < d.bestLapMs) d.bestLapMs = ms;
      }
    });
    await step("location", async () => {
      // Only the newest location per car is kept, so the first request reaches back a minute, not the whole session (~4 rows/s/car).
      // Later requests re-read a few seconds before the newest record seen: the cursor is the newest across ALL cars, so without the
      // overlap a car whose samples reach OpenF1 later than the others' would always be "older than the cursor" and never move. Rows read
      // twice or out of order change nothing (each car keeps only its newest).
      // shortcut: if OpenF1's location lags more than the backfill, the first request is empty until it catches up; raise the env value then.
      const cursor = this.cursors.location;
      // Never further back than the backfill: after a gap with no viewer the old cursor read every row since (5170 rows measured in the
      // Mexico race), though only each car's newest is kept and anything older than the backfill would be superseded anyway.
      const backfillFrom = this.now() - (this.o.locationBackfillMs ?? LOCATION_BACKFILL_MS);
      const from = cursor ? Math.max(ms(cursor) - (this.o.locationOverlapMs ?? LOCATION_OVERLAP_MS), backfillFrom) : backfillFrom;
      const loc = await get(`location?session_key=${key}&date>${encodeURIComponent(new Date(from).toISOString())}`);
      this.locationRows = loc.length;
      if (loc.length) this.locationRowsAt = this.now();
      const before = cursor ? ms(cursor) : -Infinity;
      let fresh = 0;
      let late = 0;
      for (const r of loc) {
        const d = str(r.date);
        if (!Number.isInteger(r.driver_number) || !d) continue;
        const x = this.driver(r.driver_number as number);
        const t = ms(d);
        if (!x.locationAt || t > ms(x.locationAt)) {
          Object.assign(x, { x: num(r.x), y: num(r.y), locationAt: d });
          fresh++;
          if (t <= before) late++;
        }
      }
      this.locationNew = fresh;
      this.locationLate = late;
      this.advance("location", loc);
    });
    if (failure) throw failure;
  }

  /** The last known state without waiting for a poll (no request): for callers that cannot wait for a slow OpenF1. */
  cached(): LiveSnapshot {
    return this.view();
  }

  /** Developer diagnostics (see LiveDiagnostics). Reads state only; never triggers a request. */
  diagnostics(): LiveDiagnostics {
    const iso = (t: number | null) => (t != null && Number.isFinite(t) ? new Date(t).toISOString() : null);
    return {
      credentialsConfigured: !!this.o.authed,
      lastPollAt: iso(this.lastPoll),
      lastLocationRows: this.locationRows,
      lastLocationRowsAt: iso(this.locationRowsAt),
      lastLocationNew: this.locationNew,
      lastLocationLate: this.locationLate,
      lastPollMs: this.pollDuration,
      recentPolls: this.recent,
      lastError: this.failure ? { category: this.failure.category, message: this.failure.message } : null,
    };
  }

  private view(): LiveSnapshot {
    const now = this.now();
    const base = { next: this.next, nextRace: this.nextRace, pollMs: this.pollMs, servedAt: new Date(now).toISOString() };
    if (!this.o.authed)
      return { ...base, status: "unavailable", reason: "Live timing needs an OpenF1 real-time subscription, which this site has not configured.", errorCategory: null, session: this.session, drivers: [], raceControl: [], sourceTime: null, fetchedAt: null, stale: false };
    if (!this.session) return { ...base, status: "idle", reason: "No session is running.", errorCategory: this.failure?.category ?? null, session: null, drivers: [], raceControl: [], sourceTime: null, fetchedAt: null, stale: false };
    // Once the session's driver list is known, only its cars: OpenF1's location feed also carries other vehicles (numbers 241-243 appeared
    // in the Mexico race after the red flag), which are not drivers and have no code, order or timing.
    const drivers = [...this.drivers.values()].filter((d) => !this.listed.size || this.listed.has(d.number)).sort((a, b) => (a.position ?? 99) - (b.position ?? 99) || a.number - b.number);
    const times = [...drivers.flatMap((d) => [d.positionAt, d.locationAt]), this.rc[0]?.date ?? null].filter((t): t is string => !!t);
    const sourceTime = times.length ? times.reduce((a, b) => (ms(a) >= ms(b) ? a : b)) : null;
    const auth = this.failure?.category === "auth" || this.failure?.category === "unconfigured";
    return {
      ...base,
      status: auth ? "error" : "live",
      reason: auth ? "OpenF1 did not accept this site's credentials, so live timing is unavailable." : this.failure ? "Reconnecting to OpenF1: showing the last data received." : null,
      errorCategory: this.failure?.category ?? null,
      session: this.session,
      drivers,
      raceControl: this.rc,
      sourceTime,
      fetchedAt: this.fetchedAt ? new Date(this.fetchedAt).toISOString() : null,
      stale: !!this.failure || !this.fetchedAt || now - this.fetchedAt > 3 * this.pollMs,
    };
  }
}
