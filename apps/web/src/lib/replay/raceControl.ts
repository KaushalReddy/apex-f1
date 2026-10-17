import type { RaceControlMessage, ReplayWeather } from "./dataset";
import { lastAtOrBefore, type ReplayModel } from "./model";
import { timelineMarkers } from "./provider";

/**
 * Race control and weather for the replay (Phase 12). Source: OpenF1 /race_control and /weather, as published. Calculated here, and
 * labelled so in the UI: the message grouping (key / info / routine), the track status at a moment, the active marshal-sector flags,
 * and which weather readings are usable.
 */
export type MessageKind =
  | "start"
  | "finish"
  | "safety-car"
  | "vsc"
  | "red-flag"
  | "green"
  | "yellow"
  | "double-yellow"
  | "clear"
  | "blue"
  | "black-white"
  | "penalty"
  | "investigation"
  | "track-limits"
  | "weather"
  | "drs"
  | "pit-lane"
  | "other";

/** key: shaped the race (fans see these by default); info: useful context; routine: frequent and minor (blue flags, deleted lap times). */
export type Importance = "key" | "info" | "routine";

export interface ClassifiedMessage extends RaceControlMessage {
  kind: MessageKind;
  importance: Importance;
  /** Marshal sector for sector-scoped flags. */
  sector: number | null;
}

const SECTOR = /\bSECTOR (\d+)\b/;

export function classify(m: RaceControlMessage): ClassifiedMessage {
  const msg = m.message.toUpperCase();
  const sector = m.scope === "Sector" ? Number(SECTOR.exec(msg)?.[1] ?? NaN) : NaN;
  const out = (kind: MessageKind, importance: Importance): ClassifiedMessage => ({ ...m, kind, importance, sector: Number.isFinite(sector) ? sector : null });
  if (m.category === "SafetyCar") return out(/\bVSC\b|VIRTUAL/.test(msg) ? "vsc" : "safety-car", "key");
  // Chequered first, and "RED FLAG" as whole words: "CHEQUERED FLAG" contains the letters "RED FLAG".
  if (m.flag === "CHEQUERED" || msg.includes("CHEQUERED FLAG")) return out("finish", "key");
  if (m.flag === "RED" || /\bRED FLAG\b/.test(msg)) return out("red-flag", "key");
  if (/\bRACE (START|RESUM)|SESSION STARTED/.test(msg)) return out("start", "key");
  if (m.flag === "BLACK AND WHITE") return out("black-white", "key");
  if (m.flag === "DOUBLE YELLOW") return out("double-yellow", "info");
  if (m.flag === "YELLOW") return out("yellow", "info");
  if (m.flag === "BLUE") return out("blue", "routine");
  if (m.flag === "GREEN") return out("green", m.scope === "Track" ? "key" : "info");
  if (m.flag === "CLEAR") return out("clear", m.scope === "Track" ? "info" : "routine");
  if (/\bDELETED\b|\bREINSTATED\b/.test(msg)) return out("track-limits", "routine");
  if (/PENALTY|DRIVE THROUGH|STOP AND GO|REPRIMAND|DISQUALIF/.test(msg) && !/NO FURTHER/.test(msg)) return out("penalty", "key");
  if (/INVESTIGAT|NOTED|REVIEWED|NO FURTHER (ACTION|INVESTIGATION)/.test(msg)) return out("investigation", msg.includes("NOTED") ? "info" : "key");
  if (/RAIN|WET|SLIPPERY/.test(msg)) return out("weather", "info");
  if (/\bDRS\b|OVERTAKE (EN|DIS)ABLED/.test(msg)) return out("drs", "info");
  if (/PIT (EXIT|ENTRY|LANE)/.test(msg)) return out("pit-lane", "routine");
  return out("other", "info");
}

/**
 * Red-flag stoppages as [from, to] ms: from a red-flag message to the next start signal after it ("SESSION STARTED", "RACE START",
 * "RACE RESUMED"; e.g. Dutch GP 2026: suspended at 2 min, "SESSION STARTED" at 29.5 min), or the end of the recording if none.
 */
export function redPeriods(raceControl: readonly RaceControlMessage[], endMs: number): { from: number; to: number }[] {
  const msgs = raceControl.map(classify);
  const out: { from: number; to: number }[] = [];
  for (const m of msgs) {
    if (m.kind !== "red-flag" || out.some((r) => m.t >= r.from && m.t < r.to)) continue;
    out.push({ from: m.t, to: msgs.find((x) => x.kind === "start" && x.t > m.t)?.t ?? endMs });
  }
  return out;
}

/**
 * A race-control message for display: the source writes in capitals; sentence case reads better, keeping car codes like (VER) and the
 * abbreviations FIA, VSC and DRS as published. Used by every list that shows these messages, so they read the same everywhere.
 */
export function messageText(m: string): string {
  const low = m
    .toLowerCase()
    .replace(/\(([a-z]{3})\)/g, (_, c: string) => `(${c.toUpperCase()})`)
    .replace(/\b(fia|vsc|drs)\b/g, (w) => w.toUpperCase());
  return low.charAt(0).toUpperCase() + low.slice(1);
}

export type TrackStatus = "not-started" | "green" | "yellow" | "vsc" | "safety-car" | "red-flag" | "finished";

/** A sector flag with no update for this long is no longer shown (OpenF1 normally sends a CLEAR; this guards against a missing one). */
export const SECTOR_FLAG_EXPIRY_MS = 5 * 60_000;

export class RaceControl {
  readonly messages: ClassifiedMessage[];
  private readonly times: number[];
  /** Highest marshal-sector number seen in this race (for the approximate circuit overlay); null if none. */
  readonly sectorCount: number | null;
  private readonly periods: { kind: "vsc" | "safety-car"; from: number; to: number }[];
  private readonly reds: { from: number; to: number }[];

  constructor(private readonly m: ReplayModel) {
    this.messages = m.ds.raceControl.map(classify);
    this.times = this.messages.map((x) => x.t);
    const sectors = this.messages.map((x) => x.sector).filter((s): s is number => s != null);
    this.sectorCount = sectors.length ? Math.max(...sectors) : null;
    const markers = timelineMarkers(m.events, String);
    this.periods = markers
      .filter((x) => x.kind === "safety-car" && x.end != null)
      .map((x) => ({ kind: /virtual/i.test(x.label) ? ("vsc" as const) : ("safety-car" as const), from: x.t, to: x.end! }));
    this.reds = redPeriods(m.ds.raceControl, m.ds.durationMs);
  }

  /** Messages at or before t, oldest first. */
  until(t: number): ClassifiedMessage[] {
    return this.messages.slice(0, lastAtOrBefore(this.times, t) + 1);
  }

  /**
   * Marshal sectors under yellow (1) or double yellow (2) at t, from sector-scoped flags. A track-wide green or clear resets them, and so
   * does a red flag (the race is stopped; earlier sector flags do not carry through the restart).
   */
  sectorFlags(t: number): Map<number, 1 | 2> {
    const flags = new Map<number, { level: 1 | 2; since: number }>();
    for (const x of this.until(t)) {
      if ((x.flag && x.scope === "Track" && (x.kind === "green" || x.kind === "clear")) || x.kind === "red-flag") flags.clear();
      if (x.sector == null) continue;
      if (x.kind === "yellow" || x.kind === "double-yellow") flags.set(x.sector, { level: x.kind === "double-yellow" ? 2 : 1, since: x.t });
      else if (x.kind === "clear" || x.kind === "green") flags.delete(x.sector);
    }
    return new Map(
      [...flags]
        .filter(([, f]) => t - f.since <= SECTOR_FLAG_EXPIRY_MS)
        .sort(([a], [b]) => a - b)
        .map(([s, f]) => [s, f.level]),
    );
  }

  /** The track status at t: red flag over Safety Car over VSC over sector yellows; finished after the chequered flag. */
  statusAt(t: number): TrackStatus {
    if (t < this.m.ds.lightsOutMs) return "not-started";
    if (this.m.chequeredT != null && t >= this.m.chequeredT) return "finished";
    if (this.reds.some((r) => t >= r.from && t < r.to)) return "red-flag";
    const p = this.periods.find((x) => t >= x.from && t < x.to);
    if (p) return p.kind;
    return this.sectorFlags(t).size ? "yellow" : "green";
  }
}

export interface WeatherAt {
  t: number;
  airC: number | null;
  trackC: number | null;
  humidity: number | null;
  pressure: number | null;
  rain: boolean | null;
  windSpeed: number | null;
  windDir: number | null;
}

/** Readings older than this are not shown as current. */
export const WEATHER_STALE_MS = 5 * 60_000;

/**
 * The latest weather reading at or before t (none older than WEATHER_STALE_MS). A track temperature of exactly 0 °C is treated as missing:
 * it occurs as isolated single readings between ~45 °C ones while every other field stays normal (a sensor dropout, not a measurement).
 */
export function weatherAt(w: ReplayWeather | null, t: number): WeatherAt | null {
  if (!w) return null;
  const k = lastAtOrBefore(w.t, t);
  if (k < 0 || t - w.t[k] > WEATHER_STALE_MS) return null;
  return {
    t: w.t[k],
    airC: w.air[k],
    trackC: w.track[k] === 0 ? null : w.track[k],
    humidity: w.humidity[k],
    pressure: w.pressure[k],
    rain: w.rain[k] == null ? null : w.rain[k]! > 0,
    windSpeed: w.windSpeed[k],
    windDir: w.windDir[k],
  };
}

/** Wind direction as an 8-point compass bearing (where the wind comes from, as meteorological convention). */
export const compass = (deg: number) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round((((deg % 360) + 360) % 360) / 45) % 8];
