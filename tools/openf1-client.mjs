// Shared OpenF1 (https://openf1.org) client for the export tools and the sync worker.
// - Authentication: with OPENF1_USERNAME and OPENF1_PASSWORD set, every request carries a bearer token (same flow as the website's
//   apps/web/src/lib/openf1/auth.ts). Without them requests go out unauthenticated, which works for historical data except while a live
//   session is running: OpenF1 then answers 401 to everyone without a login, even for past sessions.
// - One request at a time, at least OPENF1_MIN_INTERVAL_MS apart (default 2100 ms). OpenF1 documents that authenticated access has higher
//   limits but publishes no numbers, so the unauthenticated pace stays conservative and is configurable.
// - Each request has a timeout. 429 waits for Retry-After when given; 5xx, timeouts and network errors back off exponentially with jitter,
//   for a bounded number of attempts. 400/401/403/422 are never retried (retrying cannot fix them), except one 401 with a token: the token is
//   renewed once, in case it expired early.
// - An on-disk response cache makes an interrupted export resume without re-downloading. Completed sessions do not change, so a cached
//   answer is reused unless `fresh` is set (the sync worker sets it once per session to pick up late corrections). 404 = no data = [].
// - `get.stats` counts requests, cache hits, retries and rate limits for the sync worker's report. Nothing logged contains credentials.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const API = "https://api.openf1.org/v1";
export const TOKEN_URL = "https://api.openf1.org/token";

/** An OpenF1 failure with a sanitised category: "request" (4xx, not retried), "rate-limit", "unavailable" (5xx/network after retries). */
export class OpenF1Error extends Error {
  constructor(category, message, status = null) {
    super(message);
    this.name = "OpenF1Error";
    this.category = category;
    this.status = status;
  }
}

/** Retry-After as milliseconds (delta seconds or an HTTP date); null when absent or unreadable. */
export function retryAfterMs(header, now = Date.now()) {
  if (!header) return null;
  const s = Number(header);
  if (Number.isFinite(s)) return Math.max(0, s * 1000);
  const t = Date.parse(header);
  return Number.isFinite(t) ? Math.max(0, t - now) : null;
}

/** Exponential backoff with jitter (50-100 % of the step), capped. */
export function backoffMs(attempt, { base = 4000, max = 120_000, random = Math.random } = {}) {
  return Math.round(Math.min(max, base * 2 ** attempt) * (0.5 + random() / 2));
}

/** Writes a file atomically (temporary file, then rename), so a reader never sees half a file and a crash leaves the old one intact. */
export function writeAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, text);
  renameSync(tmp, file);
}

/**
 * OpenF1 access tokens (openf1.org/auth.html): POST TOKEN_URL with form fields username/password -> { access_token, expires_in (s) }. Tokens
 * last about an hour with no refresh token, so a new one is requested a minute before expiry. Returns null when no credentials are set
 * (unauthenticated access); throws a configuration error when only one of the two is set. Errors never contain the credentials or token.
 */
export function tokenSource({ username, password, fetch: doFetch = globalThis.fetch, now = Date.now, tokenUrl = TOKEN_URL } = {}) {
  if (!username && !password) return null;
  if (!username || !password) throw new OpenF1Error("config", "OpenF1 login needs both OPENF1_USERNAME and OPENF1_PASSWORD (only one is set)");
  let token = null;
  return {
    invalidate: () => (token = null),
    async get() {
      if (token && now() < token.expiresAt - 60_000) return token.value;
      let res;
      try {
        res = await doFetch(tokenUrl, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ username, password }).toString(),
          signal: AbortSignal.timeout(15_000),
        });
      } catch {
        throw new OpenF1Error("unavailable", "OpenF1 token endpoint unreachable");
      }
      if (res.status === 400 || res.status === 401 || res.status === 403)
        throw new OpenF1Error("auth", `OpenF1 rejected the login (HTTP ${res.status}): check OPENF1_USERNAME / OPENF1_PASSWORD`, res.status);
      if (!res.ok) throw new OpenF1Error("unavailable", `OpenF1 token endpoint answered HTTP ${res.status}`, res.status);
      const body = await res.json().catch(() => null);
      if (typeof body?.access_token !== "string" || !body.access_token) throw new OpenF1Error("unavailable", "OpenF1 token response had no access_token");
      const ttl = Number(body.expires_in);
      token = { value: body.access_token, expiresAt: now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : 3600) * 1000 };
      return token.value;
    },
  };
}

export function openf1(cacheDir, opts = {}) {
  const {
    minIntervalMs = Number(process.env.OPENF1_MIN_INTERVAL_MS ?? 2100),
    timeoutMs = 120_000,
    maxAttempts = 6,
    fresh = process.env.OPENF1_FRESH === "1",
    fetch: doFetch = globalThis.fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = Date.now,
    random = Math.random,
    log = (m) => console.error(m),
    baseUrl = API,
    auth = tokenSource({ username: process.env.OPENF1_USERNAME, password: process.env.OPENF1_PASSWORD, fetch: doFetch, now }),
  } = opts;
  mkdirSync(cacheDir, { recursive: true });
  let last = -Infinity;
  const stats = { requests: 0, cacheHits: 0, retries: 0, rateLimited: 0 };

  async function get(path, { fresh: freshOne = fresh } = {}) {
    const file = join(cacheDir, createHash("sha1").update(path).digest("hex") + ".json");
    if (!freshOne && existsSync(file)) {
      stats.cacheHits++;
      return JSON.parse(readFileSync(file, "utf8"));
    }
    const label = path.split("?")[0];
    let renewed = false;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const wait = Math.max(0, last + minIntervalMs - now());
      if (wait) await sleep(wait);
      last = now();
      stats.requests++;
      const headers = auth ? { authorization: `Bearer ${await auth.get()}` } : {};
      let res;
      try {
        res = await doFetch(`${baseUrl}/${path}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
      } catch (e) {
        if (attempt + 1 >= maxAttempts) break;
        stats.retries++;
        const ms = backoffMs(attempt, { random });
        log(`  retry ${attempt + 1} in ${Math.round(ms / 1000)} s after ${e?.name === "TimeoutError" ? "timeout" : "network error"} on /${label}`);
        await sleep(ms);
        continue;
      }
      if (res.status === 404) return [];
      if (res.ok) {
        const rows = await res.json().catch(() => null);
        // Never read a malformed answer as "no data": that would silently drop a race from the results.
        if (!Array.isArray(rows)) throw new OpenF1Error("invalid-response", `/${label}: invalid response (not a JSON list)`, res.status);
        if (rows.length) writeAtomic(file, JSON.stringify(rows)); // empty answers are re-asked next run
        return rows;
      }
      if (res.status === 401 && auth && !renewed) {
        renewed = true; // one renewal only: a second 401 with a fresh token is a real rejection
        auth.invalidate();
        stats.retries++;
        continue;
      }
      if (res.status === 401 || res.status === 403)
        throw new OpenF1Error(
          "auth",
          auth
            ? `/${label}: HTTP ${res.status} with an OpenF1 login (subscription lacks access?)`
            : `/${label}: HTTP ${res.status}: OpenF1 needs a login (OPENF1_USERNAME / OPENF1_PASSWORD), e.g. while a live session is running`,
          res.status,
        );
      if (res.status === 429) {
        stats.rateLimited++;
        if (attempt + 1 >= maxAttempts) throw new OpenF1Error("rate-limit", `/${label}: rate limited (HTTP 429) after ${maxAttempts} attempts`, 429);
        stats.retries++;
        const ms = retryAfterMs(res.headers.get("retry-after"), now()) ?? backoffMs(attempt, { random });
        log(`  rate limited on /${label}: waiting ${Math.round(ms / 1000)} s`);
        await sleep(ms);
        continue;
      }
      if (res.status >= 500) {
        if (attempt + 1 >= maxAttempts) break;
        stats.retries++;
        const ms = backoffMs(attempt, { random });
        log(`  retry ${attempt + 1} in ${Math.round(ms / 1000)} s after HTTP ${res.status} on /${label}`);
        await sleep(ms);
        continue;
      }
      throw new OpenF1Error("request", `/${label}: HTTP ${res.status}`, res.status);
    }
    throw new OpenF1Error("unavailable", `/${label}: no answer after ${maxAttempts} attempts`);
  }
  get.stats = stats;
  return get;
}

/** Milliseconds since the epoch. Numeric, never string order: OpenF1 omits the fraction on whole seconds ("…:41+00:00"). */
export const ms = (iso) => Date.parse(iso);
