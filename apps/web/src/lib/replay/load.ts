import { readFile } from "node:fs/promises";
import { firstFile, readFirstValid, roots, seasonsIn } from "@/lib/data/store";
import path from "node:path";
import { circuitByShortName } from "@/lib/circuit/catalog";
import { parseReplay, parseReplayIndex, type ReplayDataset, type ReplayIndexEntry } from "./dataset";

/** Race datasets: synced copies (DATA_DIR/replay, tools/openf1-sync) first, then the ones bundled in public/ with the build. */
const BUNDLED = path.join(process.cwd(), "public", "replay");

/** URL of one race's dataset (served by /api/replay from whichever copy is current). */
export const replayUrl = (_season: number, sessionKey: number) => `/api/replay/${sessionKey}`;

/** SERVER ONLY. The most recent recorded race at a circuit (it exists once that race has finished and been synced), or undefined. */
export async function latestRaceAt(circuitId: string) {
  return (await loadReplayIndex()).find((r) => circuitByShortName(r.circuitShortName)?.id === circuitId);
}

/** SERVER ONLY (node:fs). Every race across seasons and both sources (a synced entry replaces the bundled one), newest first. */
export async function loadReplayIndex(): Promise<(ReplayIndexEntry & { season: number })[]> {
  const dirs = roots("replay", BUNDLED);
  const bySession = new Map<number, ReplayIndexEntry & { season: number }>();
  for (const year of await seasonsIn(dirs.map((d) => d.dir))) {
    for (const { dir } of [...dirs].reverse()) {
      try {
        const r = parseReplayIndex(JSON.parse(await readFile(path.join(dir, String(year), "index.json"), "utf8")));
        if (r.ok) for (const s of r.value) bySession.set(s.sessionKey, { ...s, season: year });
      } catch {
        // no index for this season in this source
      }
    }
  }
  return [...bySession.values()].sort((a, b) => b.date.localeCompare(a.date));
}

/** SERVER ONLY. The current file for one race (synced first), for streaming to the browser. */
export const replayFile = (season: number, sessionKey: number) => firstFile(roots("replay", BUNDLED).map((r) => ({ file: path.join(r.dir, String(season), `${sessionKey}.json`), origin: r.origin })));

/** SERVER ONLY. One race's dataset, validated (for server-side analysis: Strategy, the Race Engineer). A broken synced file falls back. */
export async function loadReplayDataset(season: number, sessionKey: number): Promise<{ ok: true; value: ReplayDataset } | { ok: false; error: string }> {
  let error = "no dataset for this race";
  const r = await readFirstValid(
    roots("replay", BUNDLED).map((x) => ({ file: path.join(x.dir, String(season), `${sessionKey}.json`), origin: x.origin })),
    (raw) => {
      const p = parseReplay(raw);
      if (!p.ok) error = p.error;
      return p.ok ? p.value : null;
    },
  );
  return r ? { ok: true, value: r.value } : { ok: false, error };
}
