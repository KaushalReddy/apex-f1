/**
 * Freshness of the synced data (tools/openf1-sync writes DATA_DIR/sync-state.json). Pure, so the rules are tested directly.
 * - "bundled": no sync configured; the site shows the data shipped with its build (a fixed snapshot, labelled as such).
 * - "fresh": the last run succeeded within three sync intervals.
 * - "stale": the last success is older than that (worker stopped or slow): data is shown, marked stale, never as current.
 * - "failing": the latest attempt failed after an earlier success or none; the category says why (never the raw error).
 */
export type SyncHealth = "bundled" | "fresh" | "stale" | "failing";

export interface SyncState {
  replay?: Record<string, { year: number; syncedAt: string; final?: boolean; sourceEnd?: string | null; records?: { noData?: boolean } }>;
  telemetry?: Record<string, { syncedAt: string }>;
  results?: Record<string, { syncedAt: string }>;
  run?: { lastAttempt?: string; lastSuccess?: string | null; lastError?: { category: string; at: string; kind?: string } | null; consecutiveFailures?: number };
}

export interface DataStatus {
  health: SyncHealth;
  source: "OpenF1";
  /** When APEX F1 last retrieved data successfully (not when the source recorded it). */
  lastSuccessfulSync: string | null;
  lastAttempt: string | null;
  /** Sanitised failure category of the latest failed attempt (e.g. "rate-limit", "unavailable"), when failing. */
  failure: string | null;
  /** Expected time between runs (minutes), from OPENF1_SYNC_INTERVAL_MIN. */
  intervalMin: number;
  syncedRaces: number;
}

export function dataStatus(state: SyncState | null, configured: boolean, now: number, intervalMin: number): DataStatus {
  // Races stored with data (a race OpenF1 lists without any, e.g. a cancelled one, is recorded but not counted).
  const base = { source: "OpenF1" as const, intervalMin, syncedRaces: Object.values(state?.replay ?? {}).filter((r) => !r.records?.noData).length };
  if (!configured) return { ...base, health: "bundled", lastSuccessfulSync: null, lastAttempt: null, failure: null };
  const run = state?.run ?? {};
  const lastSuccess = run.lastSuccess ?? null;
  const lastAttempt = run.lastAttempt ?? null;
  const failingNow = !!run.consecutiveFailures && !!lastAttempt && (!lastSuccess || lastAttempt > lastSuccess);
  const staleAfter = 3 * intervalMin * 60_000;
  const health: SyncHealth = failingNow ? "failing" : lastSuccess && now - Date.parse(lastSuccess) <= staleAfter ? "fresh" : "stale";
  return { ...base, health, lastSuccessfulSync: lastSuccess, lastAttempt, failure: failingNow ? (run.lastError?.category ?? "unknown") : null };
}
