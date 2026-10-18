import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

/**
 * SERVER ONLY. Where race data is read from: the sync worker's directory (DATA_DIR, a persistent disk; tools/openf1-sync) first, then the
 * copy bundled with the build. New sessions appear and corrected files replace bundled ones without a redeploy; with no DATA_DIR, or a
 * damaged synced file, the bundled data is used as before.
 */
export type Origin = "synced" | "bundled";
export type DataKind = "replay" | "telemetry" | "results";

export const syncedRoot = (): string | null => (process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : null);

/** Directories holding one kind of data, synced first. */
export function roots(kind: DataKind, bundled: string): { dir: string; origin: Origin }[] {
  const synced = syncedRoot();
  return [...(synced ? [{ dir: path.join(synced, kind), origin: "synced" as const }] : []), { dir: bundled, origin: "bundled" as const }];
}

/** Season folders or files (`2026`, `2026.json`) present in any of the directories. */
export async function seasonsIn(dirs: string[], suffix = ""): Promise<number[]> {
  const out = new Set<number>();
  for (const d of dirs) {
    try {
      for (const f of await readdir(d)) {
        const m = new RegExp(`^(\\d{4})${suffix.replace(".", "\\.")}$`).exec(f);
        if (m) out.add(Number(m[1]));
      }
    } catch {
      // directory absent: nothing synced (yet) or nothing bundled
    }
  }
  return [...out].sort((a, b) => b - a);
}

/** The first of `files` that exists, with its origin and modification time (for ETags), or null. */
export async function firstFile(files: { file: string; origin: Origin }[]): Promise<{ file: string; origin: Origin; size: number; mtimeMs: number } | null> {
  for (const f of files) {
    try {
      const s = await stat(f.file);
      if (s.isFile()) return { ...f, size: s.size, mtimeMs: s.mtimeMs };
    } catch {
      // not there: try the next
    }
  }
  return null;
}

/** Parsed JSON from the first readable file that also passes `parse`; a broken synced file falls back to the bundled one. */
export async function readFirstValid<T>(files: { file: string; origin: Origin }[], parse: (raw: unknown) => T | null): Promise<{ value: T; origin: Origin } | null> {
  for (const f of files) {
    try {
      const v = parse(JSON.parse(await readFile(f.file, "utf8")));
      if (v != null) return { value: v, origin: f.origin };
    } catch {
      // missing or unreadable: next
    }
  }
  return null;
}
