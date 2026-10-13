import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseSeasonResults } from "./parse";
import type { SeasonResults } from "./types";

const DIR = path.join(process.cwd(), "src", "data", "results");

/**
 * SERVER ONLY (uses node:fs; imported only by server components, like lib/circuit/load.ts).
 * Reads every validated season snapshot (`src/data/results/<year>.json`) at build time, newest season first. An invalid file is skipped and
 * reported in `problems` (one bad season must not take the driver pages down); no network access happens here.
 */
export async function loadSeasons(): Promise<{ seasons: SeasonResults[]; problems: string[] }> {
  let files: string[] = [];
  try {
    files = (await readdir(DIR)).filter((f) => /^\d{4}\.json$/.test(f));
  } catch {
    return { seasons: [], problems: [] };
  }
  const seasons: SeasonResults[] = [];
  const problems: string[] = [];
  for (const f of files) {
    try {
      const parsed = parseSeasonResults(JSON.parse(await readFile(path.join(DIR, f), "utf8")));
      if (parsed.ok) seasons.push(parsed.season);
      else problems.push(`${f}: ${parsed.error}`);
    } catch (e) {
      problems.push(`${f}: ${e instanceof Error ? e.message : "unreadable"}`);
    }
  }
  return { seasons: seasons.sort((a, b) => b.season - a.season), problems };
}
