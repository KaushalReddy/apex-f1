import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseReplayIndex, type ReplayIndexEntry } from "./dataset";

/** Replay files live in public/ (fetched by the browser one race at a time); the server only reads the per-season indexes. */
const DIR = path.join(process.cwd(), "public", "replay");

/** URL of one race's dataset (served by this site). */
export const replayUrl = (season: number, sessionKey: number) => `/replay/${season}/${sessionKey}.json`;

/** SERVER ONLY (node:fs). Every exported race across seasons, newest first. A missing or invalid index means none for that season. */
export async function loadReplayIndex(): Promise<(ReplayIndexEntry & { season: number })[]> {
  let years: string[] = [];
  try {
    years = (await readdir(DIR)).filter((f) => /^\d{4}$/.test(f));
  } catch {
    return [];
  }
  const out: (ReplayIndexEntry & { season: number })[] = [];
  for (const y of years) {
    try {
      const r = parseReplayIndex(JSON.parse(await readFile(path.join(DIR, y, "index.json"), "utf8")));
      if (r.ok) out.push(...r.value.map((s) => ({ ...s, season: Number(y) })));
    } catch {
      // no index for this season
    }
  }
  return out.sort((a, b) => b.date.localeCompare(a.date));
}
