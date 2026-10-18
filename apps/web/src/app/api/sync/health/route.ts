import { currentDataStatus, hasSyncSecret, readSyncState } from "@/lib/data/sync";

/**
 * GET /api/sync/health (Authorization: Bearer SYNC_SECRET): the sync worker's full record for operators: per-session sync times, the last
 * run's counts, retries and rate-limit events, and the latest failure category. Contains no credentials (the state file never holds any).
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const auth = hasSyncSecret(req);
  if (auth !== "ok") return Response.json({ error: auth === "unconfigured" ? "diagnostics disabled: SYNC_SECRET is not set" : "unauthorized" }, { status: auth === "unconfigured" ? 503 : 401 });
  return Response.json({ status: await currentDataStatus(), state: await readSyncState() }, { headers: { "cache-control": "no-store" } });
}
