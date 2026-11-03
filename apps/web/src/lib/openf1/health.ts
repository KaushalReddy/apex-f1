import { CAR_STALE_MS, liveLocationState, positionFreshness, servedAgeMs, type PositionFreshness } from "@/lib/race/live";
import type { LiveSnapshot, PollRecord } from "./live";
import type { PollUpdate } from "./poller";

/**
 * Live Race Health (developer diagnostics): classifies the live pipeline from the tab's existing /api/live state. Connection health and
 * position freshness are separate: a working connection says nothing about whether the car positions are current. Position freshness is
 * the same rule the circuit toolbar and race header use (lib/race/liveFreshness). Only values the runtime actually reported are shown;
 * anything it does not report is null ("Not available"), never filled in.
 */
export type Health = "Healthy" | "Delayed" | "Stale" | "Waiting" | "Unavailable" | "Authentication Error";
export type AuthState = "Authenticated" | "Not authenticated" | "Rejected" | "Unknown";
export type Connection = "Connected" | "Authentication rejected" | "Polling delayed" | "Polling failed" | "Unavailable";

export interface StoreStatus {
  subscribers: number;
  hidden: boolean;
  receivedAt: number | null;
  dataReceivedAt: number | null;
  /** Time between this tab's consecutive successful answers (ms, newest last). */
  gapsMs?: number[];
}

export interface HealthReport {
  health: Health;
  why: string;
  connection: { state: Connection; why: string };
  session: { name: string; meeting: string | null; key: number; status: string } | null;
  auth: { state: AuthState; why: string };
  location: {
    state: PositionFreshness;
    /** OpenF1's timestamp of the newest car sample (when the car was there), not when APEX F1 received it. */
    newestSampleAt: string | null;
    /** Newest sample's age now: its age when the server sent it, plus the time since this tab received it (no cross-clock comparison). */
    sampleAgeNowS: number | null;
    /** Its age when the server sent the answer (server clock vs OpenF1's timestamps). */
    sampleAgeServedS: number | null;
    /** Cars placed with a current position (within CAR_STALE_MS of the newest sample, and only while positions are live). */
    currentCars: number | null;
    carsWithAnyPosition: number | null;
    rowsLastCycle: number | null;
    /** Of those rows, how many moved a car to a newer position, and how many of those only the overlap re-read delivered. */
    newRowsLastCycle: number | null;
    lateRowsLastCycle: number | null;
    /** Server time a location request last returned rows. */
    lastRowsAt: string | null;
  };
  polling: {
    state: string;
    /** Server: last poll attempt, last fully successful fetch, how long that fetch took. Browser: when this tab last got an answer. */
    serverLastAttemptAt: string | null;
    serverLastSuccessAt: string | null;
    serverPollS: number | null;
    browserReceivedAt: number | null;
    /** Browser receipt minus the server's send time: same-machine clocks only (development), so indicative. */
    deliveryS: number | null;
    /** Longest and latest time between this tab's successful answers (recent ones), and where the server's last poll spent its time. */
    longestGapS: number | null;
    lastGapS: number | null;
    lastPoll: PollRecord | null;
    error: { category: string; message: string } | null;
  };
}

const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) : NaN);
const s1 = (v: number | null | undefined) => (v != null && Number.isFinite(v) ? Math.round(v / 100) / 10 : null);

export function liveHealth(u: PollUpdate<LiveSnapshot> | null, store: StoreStatus, now: number): HealthReport {
  const s = u?.data ?? null;
  const d = s?.diag;
  const auth = authState(s);
  const loc = s ? liveLocationState(s) : null;
  const newest = loc?.latest ?? null;
  const served = s && newest ? servedAgeMs(s, newest) : null;
  const ageNow = served != null && store.dataReceivedAt != null ? served + Math.max(0, now - store.dataReceivedAt) : null;
  const positions = loc ? positionFreshness(loc.state, ageNow) : "unavailable";
  const placed = s?.drivers.filter((x) => x.x != null && x.y != null && x.locationAt) ?? null;
  const current = placed && positions === "live" ? placed.filter((x) => ms(newest) - ms(x.locationAt) <= CAR_STALE_MS).length : placed ? 0 : null;
  const connection = connectionState(u, s, auth.state);
  const clientError = u?.error ? { category: "request", message: `/api/live: ${u.error}` } : null;

  const report: Omit<HealthReport, "health" | "why"> = {
    connection,
    session: s?.session ? { name: s.session.name, meeting: s.session.event, key: s.session.key, status: s.status } : null,
    auth,
    location: {
      state: positions,
      newestSampleAt: newest,
      sampleAgeNowS: s1(ageNow),
      sampleAgeServedS: s1(served),
      currentCars: current,
      carsWithAnyPosition: placed?.length ?? null,
      rowsLastCycle: d ? d.lastLocationRows : null,
      newRowsLastCycle: d?.lastLocationNew ?? null,
      lateRowsLastCycle: d?.lastLocationLate ?? null,
      lastRowsAt: d?.lastLocationRowsAt ?? null,
    },
    polling: {
      state: store.subscribers === 0 ? "Stopped (nothing on this page subscribes)" : store.hidden ? "Paused: tab hidden" : u?.error ? `Failing (${u.failures} in a row), backing off` : u ? "Active" : "Starting",
      serverLastAttemptAt: d?.lastPollAt ?? null,
      serverLastSuccessAt: s?.fetchedAt ?? null,
      serverPollS: s1(d?.lastPollMs),
      browserReceivedAt: store.receivedAt,
      deliveryS: store.dataReceivedAt != null && s?.servedAt ? s1(Math.max(0, store.dataReceivedAt - ms(s.servedAt))) : null,
      longestGapS: store.gapsMs?.length ? s1(Math.max(...store.gapsMs)) : null,
      lastGapS: store.gapsMs?.length ? s1(store.gapsMs.at(-1)) : null,
      lastPoll: d?.recentPolls?.[0] ?? null,
      error: clientError ?? d?.lastError ?? (s?.errorCategory ? { category: s.errorCategory, message: s.reason ?? "Not available" } : null),
    },
  };
  return { ...report, ...overall(s, connection.state, positions, ageNow) };
}

function authState(s: LiveSnapshot | null): HealthReport["auth"] {
  if (!s) return { state: "Unknown", why: "No answer from /api/live yet." };
  if (s.status === "unavailable" || s.diag?.credentialsConfigured === false) return { state: "Not authenticated", why: "No OpenF1 credentials are configured on the server." };
  if (s.status === "error" || s.errorCategory === "auth" || s.errorCategory === "unconfigured") return { state: "Rejected", why: s.reason ?? "OpenF1 refused the login." };
  // Only a completed authenticated poll proves the login works; a session on the (public) schedule proves nothing.
  if (s.fetchedAt) return { state: "Authenticated", why: `Authenticated OpenF1 requests succeeded (last at ${s.fetchedAt}).` };
  return { state: "Unknown", why: s.status === "idle" ? "No session on track, so no authenticated request has been made yet." : "No authenticated request has completed yet." };
}

/** The path from OpenF1 to this tab: the browser's /api/live requests and the server's OpenF1 polls. Says nothing about the data's age. */
function connectionState(u: PollUpdate<LiveSnapshot> | null, s: LiveSnapshot | null, auth: AuthState): HealthReport["connection"] {
  if (!u) return { state: "Unavailable", why: "No answer from /api/live yet." };
  if (!s) return { state: "Polling failed", why: `Requests to /api/live are failing (${u.error ?? "no answer"}).` };
  if (auth === "Rejected") return { state: "Authentication rejected", why: s.reason ?? "OpenF1 refused this site's login." };
  if (auth === "Not authenticated") return { state: "Unavailable", why: "No OpenF1 credentials on the server, so live data cannot be fetched." };
  if (u.error) return { state: "Polling failed", why: `The last /api/live request failed (${u.error}); showing the previous answer.` };
  if (s.status === "live" && s.stale)
    return s.errorCategory
      ? { state: "Polling failed", why: `The server's OpenF1 requests are failing (${s.errorCategory}); showing the last data received.` }
      : { state: "Polling delayed", why: "The server has not completed an OpenF1 poll within three poll intervals." };
  if (s.status === "live" && s.errorCategory) return { state: "Polling delayed", why: `The server's last OpenF1 poll failed (${s.errorCategory}); it will retry.` };
  return { state: "Connected", why: s.status === "live" ? "/api/live answers and the server's OpenF1 polls succeed." : "/api/live answers (no session on track, so OpenF1 is not being polled)." };
}

function overall(s: LiveSnapshot | null, c: Connection, p: PositionFreshness, ageNow: number | null): { health: Health; why: string } {
  const age = ageNow == null ? "" : ` (newest ${Math.round(ageNow / 1000)} s old)`;
  if (c === "Authentication rejected") return { health: "Authentication Error", why: s?.reason ?? "OpenF1 refused this site's login." };
  if (c === "Unavailable") return { health: "Unavailable", why: s ? "No OpenF1 credentials on the server, so live positions cannot be fetched." : "No answer from /api/live yet." };
  if (s && (s.status === "idle" || !s.session))
    return { health: "Waiting", why: s.next ? `No session on track. Next: ${s.next.event ?? ""} ${s.next.name} at ${new Date(s.next.start).toISOString().slice(11, 16)} UTC.`.replace(/\s+/g, " ") : "No session on track." };
  if (c === "Polling failed") return p === "live" || p === "delayed" ? { health: "Delayed", why: `Polling is failing; positions shown are the last received${age}.` } : { health: "Unavailable", why: `Polling is failing and the positions shown are ${p}${age}.` };
  if (p === "waiting") return { health: "Waiting", why: `${s?.session?.event ?? ""} ${s?.session?.name ?? "The session"} is live, but no car locations have been received yet.`.trim() };
  if (p === "unavailable") return { health: "Unavailable", why: "Car positions are not available for this session." };
  if (p === "stale") return { health: "Stale", why: `Connected, but the newest car position is stale${age}.` };
  if (p === "delayed" || c === "Polling delayed") return { health: "Delayed", why: p === "delayed" ? `Connected, but car positions are delayed${age}.` : `Positions are current${age}, but the server's OpenF1 polling is behind.` };
  return { health: "Healthy", why: `Connected, authenticated, and car positions are live${age}.` };
}
