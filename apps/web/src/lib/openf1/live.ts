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
  drivers: LiveDriver[];
  raceControl: { date: string; category: string | null; flag: string | null; message: string }[];
  /** Newest record timestamp from OpenF1 (when the source recorded it). */
  sourceTime: string | null;
  /** When APEX F1 last retrieved live data successfully. */
  fetchedAt: string | null;
  /** True when the last poll failed or the data is older than three poll intervals: shown, but not as current. */
  stale: boolean;
  pollMs: number;
}

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
}

export class LiveFeed {
  private readonly now: () => number;
  private readonly pollMs: number;
  private readonly scheduleMs: number;
  private session: SessionRow | null = null;
  private next: LiveSnapshot["next"] = null;
  private scheduleAt = -Infinity;
  private lastPoll = -Infinity;
  private fetchedAt: number | null = null;
  private failure: OpenF1RequestError | null = null;
  private drivers = new Map<number, LiveDriver>();
  private rc: LiveSnapshot["raceControl"] = [];
  private rcSeen = new Set<string>();
  private cursors: Record<string, string> = {};
  private pending: Promise<void> | null = null;

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
    if (now - this.scheduleAt >= this.scheduleMs) await this.loadSchedule(now);
    if (!this.o.authed || !this.session || !this.isLive(this.session, now)) return;
    if (now - this.lastPoll < this.pollMs) return;
    this.lastPoll = now;
    try {
      await this.poll(this.session.key);
      this.fetchedAt = this.now();
      this.failure = null;
    } catch (e) {
      this.failure = e instanceof OpenF1RequestError ? e : new OpenF1RequestError("unavailable", "live poll failed");
    }
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
      const rows = (await this.o.open.get(`sessions?date_start>=${since}`)) as Row[];
      const sessions = rows.map(toSession).filter((s): s is SessionRow => !!s).sort((a, b) => ms(a.start) - ms(b.start));
      const current = sessions.find((s) => this.isLive(s, now)) ?? null;
      const upcoming = sessions.find((s) => ms(s.start) > now) ?? null;
      this.next = upcoming ? { name: upcoming.name, event: upcoming.event, start: upcoming.start } : null;
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
    this.lastPoll = -Infinity;
    this.fetchedAt = null;
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
      d = { number: n, code: null, name: null, team: null, colour: null, position: null, positionAt: null, gapToLeader: null, lapsDown: null, interval: null, x: null, y: null, locationAt: null };
      this.drivers.set(n, d);
    }
    return d;
  }

  private async poll(key: number) {
    const http = this.o.authed!;
    if (![...this.drivers.values()].some((d) => d.code)) {
      for (const r of (await http.get(`drivers?session_key=${key}`)) as Row[]) {
        if (!Number.isInteger(r.driver_number)) continue;
        const d = this.driver(r.driver_number as number);
        d.code = str(r.name_acronym);
        d.name = str(r.full_name);
        d.team = str(r.team_name);
        d.colour = str(r.team_colour) ? `#${r.team_colour}` : null;
      }
    }
    // Each record replaces the driver's value only when newer (late or repeated rows are ignored).
    const position = (await http.get(`position?session_key=${key}${this.since("position")}`)) as Row[];
    for (const r of position) {
      const d = str(r.date);
      if (!Number.isInteger(r.driver_number) || !d) continue;
      const x = this.driver(r.driver_number as number);
      if (!x.positionAt || ms(d) > ms(x.positionAt)) Object.assign(x, { position: num(r.position), positionAt: d });
    }
    this.advance("position", position);
    const intervals = (await http.get(`intervals?session_key=${key}${this.since("intervals")}`)) as Row[];
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
    const rc = (await http.get(`race_control?session_key=${key}${this.since("race_control")}`)) as Row[];
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
    const loc = (await http.get(`location?session_key=${key}${this.since("location")}`)) as Row[];
    for (const r of loc) {
      const d = str(r.date);
      if (!Number.isInteger(r.driver_number) || !d) continue;
      const x = this.driver(r.driver_number as number);
      if (!x.locationAt || ms(d) > ms(x.locationAt)) Object.assign(x, { x: num(r.x), y: num(r.y), locationAt: d });
    }
    this.advance("location", loc);
  }

  private view(): LiveSnapshot {
    const now = this.now();
    const base = { next: this.next, pollMs: this.pollMs };
    if (!this.o.authed)
      return { ...base, status: "unavailable", reason: "Live timing needs an OpenF1 real-time subscription, which this site has not configured.", errorCategory: null, session: this.session, drivers: [], raceControl: [], sourceTime: null, fetchedAt: null, stale: false };
    if (!this.session) return { ...base, status: "idle", reason: "No session is running.", errorCategory: this.failure?.category ?? null, session: null, drivers: [], raceControl: [], sourceTime: null, fetchedAt: null, stale: false };
    const drivers = [...this.drivers.values()].sort((a, b) => (a.position ?? 99) - (b.position ?? 99) || a.number - b.number);
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
