import { loadSessionTelemetry, loadTelemetryIndex } from "@/lib/telemetry/load";

/** One session's exported fastest-lap telemetry (validated), generated at build time: the data are static snapshots. */
export const dynamic = "force-static";
export const dynamicParams = false;

export async function generateStaticParams() {
  return (await loadTelemetryIndex()).map((s) => ({ session: String(s.sessionKey) }));
}

export async function GET(_: Request, { params }: { params: Promise<{ session: string }> }) {
  const key = (await params).session;
  const entry = (await loadTelemetryIndex()).find((s) => String(s.sessionKey) === key);
  if (!entry) return Response.json({ error: "no telemetry for this session" }, { status: 404 });
  const r = await loadSessionTelemetry(entry.season, entry.sessionKey);
  return r.ok ? Response.json(r.session) : Response.json({ error: r.error }, { status: 500 });
}
