import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseSessionIndex, parseSessionTelemetry } from "./parse";
import type { SessionIndexEntry, SessionTelemetry } from "./types";

const DIR = path.join(process.cwd(), "src", "data", "telemetry");

/** SERVER ONLY (node:fs). Every exported session across seasons, newest first. A missing or invalid index means no sessions. */
export async function loadTelemetryIndex(): Promise<(SessionIndexEntry & { season: number })[]> {
  let years: string[] = [];
  try {
    years = (await readdir(DIR)).filter((f) => /^\d{4}$/.test(f));
  } catch {
    return [];
  }
  const out: (SessionIndexEntry & { season: number })[] = [];
  for (const y of years) {
    try {
      const r = parseSessionIndex(JSON.parse(await readFile(path.join(DIR, y, "index.json"), "utf8")));
      if (r.ok) out.push(...r.value.map((s) => ({ ...s, season: Number(y) })));
    } catch {
      // no index for this season
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date) || a.sessionName.localeCompare(b.sessionName));
}

/** SERVER ONLY. One session's laps, or an error string (missing or invalid file). */
export async function loadSessionTelemetry(season: number, sessionKey: number): Promise<{ ok: true; session: SessionTelemetry } | { ok: false; error: string }> {
  try {
    const r = parseSessionTelemetry(JSON.parse(await readFile(path.join(DIR, String(season), `${sessionKey}.json`), "utf8")));
    return r.ok ? { ok: true, session: r.value } : { ok: false, error: r.error };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "unreadable" };
  }
}
