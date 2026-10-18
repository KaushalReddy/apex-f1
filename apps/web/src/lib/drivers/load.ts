import path from "node:path";
import { readFirstValid, roots, seasonsIn } from "@/lib/data/store";
import { parseSeasonResults } from "./parse";
import type { SeasonResults } from "./types";

/** Season results: synced copies (DATA_DIR/results/<year>.json) first, then the ones bundled with the build. */
const BUNDLED = path.join(process.cwd(), "src", "data", "results");

/**
 * SERVER ONLY (uses node:fs; imported only by server components, like lib/circuit/load.ts).
 * Every validated season snapshot, newest first: the synced copy when it is valid, else the bundled one. A season with no valid copy is
 * skipped and reported in `problems` (one bad season must not take the driver pages down); no network access happens here.
 */
export async function loadSeasons(): Promise<{ seasons: SeasonResults[]; problems: string[] }> {
  const dirs = roots("results", BUNDLED);
  const seasons: SeasonResults[] = [];
  const problems: string[] = [];
  for (const year of await seasonsIn(dirs.map((d) => d.dir), ".json")) {
    let error = "unreadable";
    const r = await readFirstValid(
      dirs.map((d) => ({ file: path.join(d.dir, `${year}.json`), origin: d.origin })),
      (raw) => {
        const parsed = parseSeasonResults(raw);
        if (!parsed.ok) error = parsed.error;
        return parsed.ok ? parsed.season : null;
      },
    );
    if (r) seasons.push(r.value);
    else problems.push(`${year}.json: ${error}`);
  }
  return { seasons: seasons.sort((a, b) => b.season - a.season), problems };
}
