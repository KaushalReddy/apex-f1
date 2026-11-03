import { TokenManager } from "./auth";
import { createOpenF1Http } from "./http";
import { devDiagnosticsEnabled } from "./diagnostics";
import { LiveFeed, LOCATION_BACKFILL_MS, LOCATION_OVERLAP_MS, type PollRecord } from "./live";

/** Development only: one line per slow OpenF1 poll in the server log (timings and counts only: no URLs, headers or bodies). */
const logSlowPoll = (r: PollRecord) =>
  console.warn(
    `[live] slow OpenF1 poll ${(r.ms / 1000).toFixed(1)} s at ${r.at}: ${Object.entries(r.steps).map(([k, v]) => `${k} ${v} ms`).join(", ")}` +
      `${r.scheduleMs != null ? `, schedule ${r.scheduleMs} ms` : ""}; ${r.requests} requests, ${r.retries} retries, ${r.rateLimited} rate-limited${r.error ? `; error ${r.error}` : ""}`,
  );

/**
 * SERVER ONLY. One live feed per server process (shared by every visitor). Configuration from the server environment only:
 * OPENF1_USERNAME / OPENF1_PASSWORD (real-time subscription; without them live is "unavailable"), OPENF1_LIVE_POLL_MS (default 5000),
 * OPENF1_LIVE_MIN_INTERVAL_MS (spacing between authenticated requests, default 300), OPENF1_BASE_URL (default https://api.openf1.org/v1),
 * OPENF1_LIVE_LOCATION_BACKFILL_MS / OPENF1_LIVE_LOCATION_OVERLAP_MS (car-location lookback, defaults 60000 / 10000; lib/openf1/live.ts).
 */
let feed: LiveFeed | null = null;

export function liveFeed(): LiveFeed {
  if (feed) return feed;
  const env = process.env;
  const baseUrl = env.OPENF1_BASE_URL || undefined;
  const tokens = new TokenManager({ username: env.OPENF1_USERNAME, password: env.OPENF1_PASSWORD });
  feed = new LiveFeed({
    authed: tokens.configured ? createOpenF1Http({ baseUrl, auth: tokens, minIntervalMs: Number(env.OPENF1_LIVE_MIN_INTERVAL_MS ?? 300) }) : null,
    // The public schedule only: spaced like the export tools (unauthenticated limits are lower), at most one call a minute.
    open: createOpenF1Http({ baseUrl, minIntervalMs: 2100 }),
    pollMs: Number(env.OPENF1_LIVE_POLL_MS ?? 5000),
    locationBackfillMs: Number(env.OPENF1_LIVE_LOCATION_BACKFILL_MS ?? LOCATION_BACKFILL_MS) || LOCATION_BACKFILL_MS,
    locationOverlapMs: Number(env.OPENF1_LIVE_LOCATION_OVERLAP_MS ?? LOCATION_OVERLAP_MS) || LOCATION_OVERLAP_MS,
    onSlowPoll: devDiagnosticsEnabled() ? logSlowPoll : undefined,
  });
  return feed;
}
