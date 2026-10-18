import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { dataStatus, type DataStatus, type SyncState } from "./status";
import { syncedRoot } from "./store";

/** SERVER ONLY. The sync worker's state file, or null (no DATA_DIR, not run yet, or unreadable). */
export async function readSyncState(): Promise<SyncState | null> {
  const root = syncedRoot();
  if (!root) return null;
  try {
    return JSON.parse(await readFile(path.join(root, "sync-state.json"), "utf8")) as SyncState;
  } catch {
    return null;
  }
}

export const syncIntervalMin = () => Number(process.env.OPENF1_SYNC_INTERVAL_MIN ?? 30) || 30;

export async function currentDataStatus(now = Date.now()): Promise<DataStatus> {
  return dataStatus(await readSyncState(), syncedRoot() != null, now, syncIntervalMin());
}

/**
 * SERVER ONLY. Whether a request carries the sync secret (`Authorization: Bearer <SYNC_SECRET>`), compared in constant time. With no secret
 * configured the protected routes are disabled (never open).
 */
export function hasSyncSecret(req: Request): "ok" | "unconfigured" | "denied" {
  const secret = process.env.SYNC_SECRET;
  if (!secret) return "unconfigured";
  const got = /^Bearer (.+)$/.exec(req.headers.get("authorization") ?? "")?.[1] ?? "";
  const a = Buffer.from(got);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "denied";
}
