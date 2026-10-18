// Shared OpenF1 (https://openf1.org) client for the export tools and the sync worker (historical data: no authentication).
// - One request at a time, at least OPENF1_MIN_INTERVAL_MS apart (default 2100 ms). OpenF1 documents that authenticated access has higher
//   limits but publishes no numbers, so the unauthenticated pace stays conservative and is configurable.
// - Each request has a timeout. 429 waits for Retry-After when given; 5xx, timeouts and network errors back off exponentially with jitter,
//   for a bounded number of attempts. 400/401/403/422 are never retried (retrying cannot fix them).
// - An on-disk response cache makes an interrupted export resume without re-downloading. Completed sessions do not change, so a cached
//   answer is reused unless `fresh` is set (the sync worker sets it once per session to pick up late corrections). 404 = no data = [].
// - `get.stats` counts requests, cache hits, retries and rate limits for the sync worker's report. Nothing logged contains credentials.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const API = "https://api.openf1.org/v1";

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
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const wait = Math.max(0, last + minIntervalMs - now());
      if (wait) await sleep(wait);
      last = now();
      stats.requests++;
      let res;
      try {
        res = await doFetch(`${baseUrl}/${path}`, { signal: AbortSignal.timeout(timeoutMs) });
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
        const body = await res.json();
        const rows = Array.isArray(body) ? body : [];
        if (rows.length) writeAtomic(file, JSON.stringify(rows)); // empty answers are re-asked next run
        return rows;
      }
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
