import { currentDataStatus } from "@/lib/data/sync";

/** GET /api/data-status: public freshness summary of the race data (source, last successful sync, health). No errors' details, no config. */
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(await currentDataStatus(), { headers: { "cache-control": "public, max-age=30" } });
}
