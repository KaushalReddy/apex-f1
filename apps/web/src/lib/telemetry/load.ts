import { readFile } from "node:fs/promises";
import { readFirstValid, roots, seasonsIn } from "@/lib/data/store";
import path from "node:path";
import { parseSessionIndex, parseSessionTelemetry } from "./parse";
import type { SessionIndexEntry, SessionTelemetry } from "./types";

/** Telemetry: synced copies (DATA_DIR/telemetry) first, then the ones bundled with the build. */
const BUNDLED = path.join(process.cwd(), "src", "data", "telemetry");

/** SERVER ONLY (node:fs). Every exported session across seasons and both sources (synced replaces bundled), newest first. */
export async function loadTelemetryIndex(): Promise<(SessionIndexEntry & { season: number })[]> {
  const dirs = roots("telemetry", BUNDLED);
  const bySession = new Map<number, SessionIndexEntry & { season: number }>();
  for (const year of await seasonsIn(dirs.map((d) => d.dir))) {
    for (const { dir } of [...dirs].reverse()) {
      try {
        const r = parseSessionIndex(JSON.parse(await readFile(path.join(dir, String(year), "index.json"), "utf8")));
        if (r.ok) for (const s of r.value) bySession.set(s.sessionKey, { ...s, season: year });
      } catch {
        // no index for this season in this source
      }
    }
  }
  return [...bySession.values()].sort((a, b) => b.date.localeCompare(a.date) || a.sessionName.localeCompare(b.sessionName));
}

/** SERVER ONLY. One session's laps, or an error string (missing or invalid file). A broken synced file falls back to the bundled one. */
export async function loadSessionTelemetry(season: number, sessionKey: number): Promise<{ ok: true; session: SessionTelemetry } | { ok: false; error: string }> {
  let error = "no telemetry for this session";
  const r = await readFirstValid(
    roots("telemetry", BUNDLED).map((x) => ({ file: path.join(x.dir, String(season), `${sessionKey}.json`), origin: x.origin })),
    (raw) => {
      const p = parseSessionTelemetry(raw);
      if (!p.ok) error = p.error;
      return p.ok ? p.value : null;
    },
  );
  return r ? { ok: true, session: r.value } : { ok: false, error };
}
