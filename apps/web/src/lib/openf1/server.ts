import { TokenManager } from "./auth";
import { createOpenF1Http } from "./http";
import { LiveFeed } from "./live";

/**
 * SERVER ONLY. One live feed per server process (shared by every visitor). Configuration from the server environment only:
 * OPENF1_USERNAME / OPENF1_PASSWORD (real-time subscription; without them live is "unavailable"), OPENF1_LIVE_POLL_MS (default 5000),
 * OPENF1_LIVE_MIN_INTERVAL_MS (spacing between authenticated requests, default 300), OPENF1_BASE_URL (default https://api.openf1.org/v1).
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
  });
  return feed;
}
