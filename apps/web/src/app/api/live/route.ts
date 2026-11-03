import { withDiagnostics } from "@/lib/openf1/diagnostics";
import { liveFeed } from "@/lib/openf1/server";

/**
 * GET /api/live: the current live-timing state (status, session, order, gaps, car positions, race control, freshness). Polling OpenF1
 * happens here, at most once per interval for all visitors (lib/openf1/live.ts). Credentials never leave the server.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const feed = liveFeed();
  return Response.json(withDiagnostics(await feed.snapshot(), feed, process.env.NODE_ENV), { headers: { "cache-control": "no-store" } });
}
