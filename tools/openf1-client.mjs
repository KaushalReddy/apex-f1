// Shared OpenF1 (https://openf1.org) client for the export tools: one request every 2.1 s (free-tier rate limit), retries with backoff on
// 429/5xx and network errors, and an on-disk response cache so an interrupted export resumes. 404 means "no data" and returns [].
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const API = "https://api.openf1.org/v1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function openf1(cacheDir) {
  mkdirSync(cacheDir, { recursive: true });
  let last = 0;
  return async function get(path) {
    const file = join(cacheDir, createHash("sha1").update(path).digest("hex") + ".json");
    if (existsSync(file)) return JSON.parse(readFileSync(file, "utf8"));
    for (let attempt = 0; attempt < 8; attempt++) {
      const wait = Math.max(0, last + 2100 - Date.now());
      if (wait) await sleep(wait);
      last = Date.now();
      let res;
      try {
        res = await fetch(`${API}/${path}`, { signal: AbortSignal.timeout(120_000) });
      } catch (e) {
        // Dropped connection or timeout (large /location windows): back off and retry like a 5xx.
        console.error(`  retry ${attempt + 1} after network error on ${path.slice(0, 60)}: ${e.cause?.code ?? e.name}`);
        await sleep(8000 * (attempt + 1));
        continue;
      }
      if (res.status === 404) return [];
      if (res.ok) {
        const body = await res.json();
        const rows = Array.isArray(body) ? body : [];
        if (rows.length) writeFileSync(file, JSON.stringify(rows)); // completed sessions do not change; empty answers are re-asked next run
        return rows;
      }
      if (res.status === 429 || res.status >= 500) {
        await sleep(8000 * (attempt + 1));
        continue;
      }
      throw new Error(`${path}: HTTP ${res.status}`);
    }
    throw new Error(`${path}: gave up after retries`);
  };
}

/** Milliseconds since the epoch. Numeric, never string order: OpenF1 omits the fraction on whole seconds ("…:41+00:00"). */
export const ms = (iso) => Date.parse(iso);
