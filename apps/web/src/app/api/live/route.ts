import { liveFeed } from "@/lib/openf1/server";

/**
 * GET /api/live: the current live-timing state (status, session, order, gaps, car positions, race control, freshness). Polling OpenF1
 * happens here, at most once per interval for all visitors (lib/openf1/live.ts). Credentials never leave the server.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return Response.json(await liveFeed().snapshot(), { headers: { "cache-control": "no-store" } });
}
