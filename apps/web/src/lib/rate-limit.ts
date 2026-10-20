/**
 * SERVER ONLY. Fixed-window request limits per client, for routes that spend money or CPU (the AI engineer, CFD jobs).
 * shortcut: in-memory, so limits are per server process and reset on restart; move to a shared store (Redis) if the site runs several
 * instances. The client is the first X-Forwarded-For address: set by the hosting proxy, or by Next.js from the connection when absent. A
 * client can forge it when the app is exposed without a proxy in front.
 */
export function rateLimiter(limit: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, { start: number; count: number }>();
  /** Counts one request; returns the seconds to wait when over the limit, else 0. */
  return function take(key: string): number {
    const t = now();
    if (hits.size > 10_000) {
      for (const [k, v] of hits) if (t - v.start >= windowMs) hits.delete(k);
      if (hits.size > 10_000) hits.clear(); // bounded memory even under a flood of forged addresses
    }
    const h = hits.get(key);
    if (!h || t - h.start >= windowMs) {
      hits.set(key, { start: t, count: 1 });
      return 0;
    }
    if (h.count >= limit) return Math.ceil((h.start + windowMs - t) / 1000);
    h.count++;
    return 0;
  };
}

export const clientKey = (req: Request) =>
  req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "local";

/** A 429 answer with Retry-After. */
export const tooMany = (retryS: number, error: string) =>
  Response.json({ error }, { status: 429, headers: { "retry-after": String(retryS) } });
