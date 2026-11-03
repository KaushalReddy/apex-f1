/** The live freshness rule, shared by the race view (lib/race/session, lib/race/live) and the health panel (lib/openf1/health). */

/** Whether car positions can be shown as live, and why not. */
export type LiveLocationState = "live" | "waiting" | "delayed" | "unavailable";

/** How often the live view asks /api/live (the server polls OpenF1 at most this often too: OPENF1_LIVE_POLL_MS). */
export const LIVE_POLL_MS = 5000;
/** A car's location older than this (vs the newest one) is shown as stale. */
export const CAR_STALE_MS = 10_000;
/** The newest location this much older than the server's last successful fetch: OpenF1's location feed is behind. Shown positions
 * older than this are stale. */
export const DELAYED_MS = 30_000;
/**
 * Shown positions count as live while the newest is at most this old: OpenF1's publication lag (measured 2.6-4.4 s in the Mexico race)
 * plus one poll cycle, with room for one slow cycle. Beyond it they are delayed, beyond DELAYED_MS stale.
 */
export const POSITIONS_LIVE_MS = 3 * LIVE_POLL_MS;

/** How current the car positions on screen are. One rule for the circuit toolbar, the race header and the developer health panel. */
export type PositionFreshness = "live" | "delayed" | "stale" | "waiting" | "unavailable";

/** `ageMs`: age of the newest shown car sample (see servedAgeMs), plus the time since this browser received it. */
export function positionFreshness(loc: LiveLocationState, ageMs: number | null): PositionFreshness {
  if (loc === "unavailable" || loc === "waiting") return loc;
  if (ageMs == null || !Number.isFinite(ageMs)) return "waiting";
  return ageMs <= POSITIONS_LIVE_MS ? "live" : ageMs <= DELAYED_MS ? "delayed" : "stale";
}
