import { OpenF1AuthError, type TokenManager } from "./auth";

/**
 * SERVER ONLY. OpenF1 REST client for the live feed. Hard limits, since OpenF1 publishes no numbers for its rate limits:
 * - requests spaced at least `minIntervalMs` apart; identical concurrent requests share one fetch;
 * - a timeout per request; 5xx / network / timeout retried with exponential backoff and jitter, at most `maxAttempts` times;
 * - 429: nothing more is sent until Retry-After (or a default pause) has passed, and the caller gets a "rate-limit" error at once
 *   instead of waiting inside a page request;
 * - 401 with a token: the token is renewed once; a second 401 is an "auth" error (never retried in a loop);
 * - after `breakerThreshold` consecutive failures, requests are refused for `breakerCooldownMs` ("suppressed"), then tried again.
 */
export class OpenF1RequestError extends Error {
  constructor(
    readonly category: "request" | "auth" | "rate-limit" | "unavailable" | "suppressed" | "unconfigured",
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = "OpenF1RequestError";
  }
}

export interface HttpOptions {
  baseUrl?: string;
  auth?: TokenManager | null;
  fetch?: typeof fetch;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  minIntervalMs?: number;
  timeoutMs?: number;
  maxAttempts?: number;
  defaultRetryAfterMs?: number;
  breakerThreshold?: number;
  breakerCooldownMs?: number;
}

export interface HttpStats {
  requests: number;
  retries: number;
  rateLimited: number;
  failures: number;
  lastErrorCategory: string | null;
}

export function retryAfterMs(header: string | null, now: number): number | null {
  if (!header) return null;
  const s = Number(header);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(header);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

export function createOpenF1Http(opts: HttpOptions = {}) {
  const o = {
    baseUrl: opts.baseUrl ?? "https://api.openf1.org/v1",
    auth: opts.auth ?? null,
    fetch: opts.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a)),
    now: opts.now ?? Date.now,
    sleep: opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms))),
    random: opts.random ?? Math.random,
    minIntervalMs: opts.minIntervalMs ?? 300,
    timeoutMs: opts.timeoutMs ?? 10_000,
    maxAttempts: opts.maxAttempts ?? 3,
    defaultRetryAfterMs: opts.defaultRetryAfterMs ?? 30_000,
    breakerThreshold: opts.breakerThreshold ?? 3,
    breakerCooldownMs: opts.breakerCooldownMs ?? 60_000,
  };
  const stats: HttpStats = { requests: 0, retries: 0, rateLimited: 0, failures: 0, lastErrorCategory: null };
  const inflight = new Map<string, Promise<unknown[]>>();
  let last = -Infinity;
  let pausedUntil = 0;
  let consecutiveFailures = 0;
  let openUntil = 0;
  // One request at a time: a chain so concurrent different paths still respect the spacing.
  let queue: Promise<unknown> = Promise.resolve();

  const fail = (e: OpenF1RequestError) => {
    stats.failures++;
    stats.lastErrorCategory = e.category;
    if (e.category !== "suppressed" && e.category !== "unconfigured") {
      consecutiveFailures++;
      if (consecutiveFailures >= o.breakerThreshold) openUntil = o.now() + o.breakerCooldownMs;
    }
    return e;
  };

  async function once(path: string): Promise<unknown[]> {
    const label = "/" + path.split("?")[0];
    if (o.now() < pausedUntil) throw fail(new OpenF1RequestError("rate-limit", `${label}: paused after a rate limit`));
    if (o.now() < openUntil) throw fail(new OpenF1RequestError("suppressed", `${label}: paused after repeated failures`));
    let renewed = false;
    for (let attempt = 0; attempt < o.maxAttempts; attempt++) {
      const wait = Math.max(0, last + o.minIntervalMs - o.now());
      if (wait) await o.sleep(wait);
      last = o.now();
      let token: string | null = null;
      if (o.auth) {
        try {
          token = await o.auth.get();
        } catch (e) {
          const cat = e instanceof OpenF1AuthError ? e.category : "unavailable";
          throw fail(new OpenF1RequestError(cat === "unconfigured" ? "unconfigured" : cat === "auth" ? "auth" : "unavailable", `${label}: ${e instanceof Error ? e.message : "token unavailable"}`));
        }
      }
      stats.requests++;
      let res: Response;
      try {
        res = await o.fetch(`${o.baseUrl}/${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {}, signal: AbortSignal.timeout(o.timeoutMs) });
      } catch {
        if (attempt + 1 < o.maxAttempts) {
          stats.retries++;
          await o.sleep(Math.round(Math.min(30_000, 1000 * 2 ** attempt) * (0.5 + o.random() / 2)));
          continue;
        }
        throw fail(new OpenF1RequestError("unavailable", `${label}: no answer (network or timeout)`));
      }
      if (res.status === 404) {
        consecutiveFailures = 0;
        return [];
      }
      if (res.ok) {
        consecutiveFailures = 0;
        const body = await res.json().catch(() => null);
        return Array.isArray(body) ? body : [];
      }
      if (res.status === 401 && o.auth && !renewed) {
        renewed = true;
        o.auth.invalidate();
        continue;
      }
      if (res.status === 429) {
        stats.rateLimited++;
        pausedUntil = o.now() + (retryAfterMs(res.headers.get("retry-after"), o.now()) ?? o.defaultRetryAfterMs);
        throw fail(new OpenF1RequestError("rate-limit", `${label}: rate limited (HTTP 429)`, 429));
      }
      if (res.status >= 500 && attempt + 1 < o.maxAttempts) {
        stats.retries++;
        await o.sleep(Math.round(Math.min(30_000, 1000 * 2 ** attempt) * (0.5 + o.random() / 2)));
        continue;
      }
      throw fail(new OpenF1RequestError(res.status === 401 || res.status === 403 ? "auth" : res.status >= 500 ? "unavailable" : "request", `${label}: HTTP ${res.status}`, res.status));
    }
    throw fail(new OpenF1RequestError("unavailable", `${label}: no answer after ${o.maxAttempts} attempts`));
  }

  /** Rows for one OpenF1 path (e.g. "position?session_key=9161&date>2023-..."), [] for 404. Identical concurrent calls share a fetch. */
  function get(path: string): Promise<unknown[]> {
    const hit = inflight.get(path);
    if (hit) return hit;
    const p = (queue = queue.catch(() => {}).then(() => once(path))) as Promise<unknown[]>;
    const shared = p.finally(() => inflight.delete(path));
    inflight.set(path, shared);
    return shared;
  }
  return { get, stats, state: () => ({ pausedUntil, openUntil, consecutiveFailures }) };
}

export type OpenF1Http = ReturnType<typeof createOpenF1Http>;
