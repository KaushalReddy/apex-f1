import { loadSessionTelemetry, loadTelemetryIndex } from "@/lib/telemetry/load";

/** One session's exported fastest-lap telemetry (validated): the synced copy when there is one (tools/openf1-sync), else the bundled one. */
export const dynamic = "force-dynamic";

export async function GET(_: Request, { params }: { params: Promise<{ session: string }> }) {
  const key = (await params).session;
  const entry = (await loadTelemetryIndex()).find((s) => String(s.sessionKey) === key);
  if (!entry) return Response.json({ error: "no telemetry for this session" }, { status: 404 });
  const r = await loadSessionTelemetry(entry.season, entry.sessionKey);
  return r.ok ? Response.json(r.session, { headers: { "cache-control": "public, max-age=3600, stale-while-revalidate=604800" } }) : Response.json({ error: r.error }, { status: 500 });
}
