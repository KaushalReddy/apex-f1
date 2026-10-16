import type { LapTelemetry, SessionIndexEntry, SessionTelemetry } from "./types";

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const numOrNull = (v: unknown) => v === null || num(v);
const str = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function parseLap(raw: unknown, i: number): Result<LapTelemetry> {
  const at = `laps[${i}]`;
  if (!isObj(raw)) return { ok: false, error: `${at} is not an object` };
  if (!Number.isInteger(raw.driverNumber) || !Number.isInteger(raw.lapNumber)) return { ok: false, error: `${at} needs integer driverNumber and lapNumber` };
  if (!num(raw.lapDuration) || raw.lapDuration <= 0) return { ok: false, error: `${at}.lapDuration must be a positive number` };
  if (!Array.isArray(raw.sectors) || raw.sectors.length !== 3 || !raw.sectors.every(numOrNull)) return { ok: false, error: `${at}.sectors must be 3 numbers or nulls` };
  const car = raw.car;
  if (!isObj(car) || !Array.isArray(car.t) || !car.t.every(num)) return { ok: false, error: `${at}.car.t must be numbers` };
  const n = car.t.length;
  for (const k of ["speed", "throttle", "brake", "rpm", "gear"] as const) {
    const ch = car[k];
    if (!Array.isArray(ch) || ch.length !== n || !ch.every(numOrNull)) return { ok: false, error: `${at}.car.${k} must have ${n} numbers or nulls` };
  }
  const pos = raw.position;
  if (!isObj(pos) || !Array.isArray(pos.t) || !pos.t.every(num)) return { ok: false, error: `${at}.position.t must be numbers` };
  for (const k of ["x", "y"] as const) {
    const ch = pos[k];
    if (!Array.isArray(ch) || ch.length !== pos.t.length || !ch.every(num)) return { ok: false, error: `${at}.position.${k} must have ${pos.t.length} numbers` };
  }
  for (const ts of [car.t as number[], pos.t as number[]])
    for (let k = 1; k < ts.length; k++) if (ts[k] < ts[k - 1]) return { ok: false, error: `${at}: sample times must be in order` };
  return { ok: true, value: raw as unknown as LapTelemetry };
}

/** Validates a session snapshot (a trust boundary: the file is generated outside the app). */
export function parseSessionTelemetry(raw: unknown): Result<SessionTelemetry> {
  if (!isObj(raw)) return { ok: false, error: "not an object" };
  if (raw.schema !== "apex-f1/lap-telemetry@1") return { ok: false, error: `unsupported schema ${String(raw.schema)}` };
  if (!Number.isInteger(raw.sessionKey) || !Number.isInteger(raw.meetingKey) || !Number.isInteger(raw.season)) return { ok: false, error: "needs integer season, meetingKey, sessionKey" };
  if (!str(raw.sessionName) || !str(raw.eventName) || !str(raw.date) || !str(raw.coordinateSystem)) return { ok: false, error: "needs sessionName, eventName, date, coordinateSystem" };
  if (!isObj(raw.source) || !Array.isArray(raw.laps) || !Array.isArray(raw.excluded)) return { ok: false, error: "needs source, laps, excluded" };
  for (const [i, l] of raw.laps.entries()) {
    const r = parseLap(l, i);
    if (!r.ok) return r;
  }
  return { ok: true, value: raw as unknown as SessionTelemetry };
}

export function parseSessionIndex(raw: unknown): Result<SessionIndexEntry[]> {
  if (!isObj(raw) || raw.schema !== "apex-f1/lap-telemetry-index@1" || !Array.isArray(raw.sessions)) return { ok: false, error: "not a lap-telemetry index" };
  for (const s of raw.sessions)
    if (!isObj(s) || !Number.isInteger(s.sessionKey) || !str(s.sessionName) || !str(s.eventName) || !str(s.date)) return { ok: false, error: "invalid index entry" };
  return { ok: true, value: raw.sessions as SessionIndexEntry[] };
}
