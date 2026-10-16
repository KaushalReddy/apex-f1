import type { LapTelemetry, SessionIndexEntry } from "./types";

export interface TelemetryQuery {
  session?: string;
  circuit?: string;
  a?: string;
  b?: string;
}
type Entry = SessionIndexEntry & { season: number };

/**
 * Which session `/telemetry` shows. `index` is newest first. An explicit, known `session` wins; otherwise the latest qualifying (else
 * any) session at `circuit` and/or containing driver `a` (by acronym; car numbers change between seasons, so they do not filter);
 * otherwise the latest qualifying session. `circuitIdOf` maps OpenF1 circuit short names to catalog ids.
 */
export function chooseSession(index: readonly Entry[], q: TelemetryQuery, circuitIdOf: (shortName: string) => string | undefined) {
  const wantA = q.a?.toUpperCase();
  const candidates = index
    .filter((s) => !q.circuit || (s.circuitShortName != null && circuitIdOf(s.circuitShortName) === q.circuit))
    .filter((s) => !wantA || /^\d+$/.test(wantA) || !s.acronyms || s.acronyms.includes(wantA));
  const chosen =
    index.find((s) => String(s.sessionKey) === q.session) ??
    candidates.find((s) => s.sessionName === "Qualifying") ??
    candidates[0] ??
    index.find((s) => s.sessionName === "Qualifying") ??
    index[0];
  return { chosen, candidates };
}

/** Drivers A and B (by car number or acronym), defaulting to the session's fastest two; B is never the same lap as A. */
export function chooseDrivers(laps: readonly LapTelemetry[], q: TelemetryQuery) {
  const find = (v: string | undefined) => (v ? laps.find((l) => String(l.driverNumber) === v || l.acronym === v.toUpperCase()) : undefined);
  const a = find(q.a) ?? laps[0];
  const wanted = find(q.b);
  const b = wanted && wanted !== a ? wanted : laps.find((l) => l !== a);
  return { a, b };
}

/** What could not be honoured, said rather than silently swapped for defaults. */
export function selectionNotes(q: TelemetryQuery, shown: Entry, candidates: readonly Entry[], a: LapTelemetry | undefined): string[] {
  const what = `${shown.eventName} ${shown.sessionName}`;
  return [
    q.session && String(shown.sessionKey) !== q.session && `Session ${q.session} is not in the exported data; showing ${what}.`,
    q.circuit && !q.session && !candidates.some((c) => c.sessionKey === shown.sessionKey) && `No exported session at that circuit${q.a ? " with that driver" : ""}; showing ${what}.`,
    q.a && a && String(a.driverNumber) !== q.a && a.acronym !== q.a.toUpperCase() && `${q.a.toUpperCase()} has no valid timed lap in this session; showing the fastest driver instead.`,
  ].filter((n): n is string => typeof n === "string");
}
