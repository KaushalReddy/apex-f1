import { notFound } from "next/navigation";
import { RaceExperience } from "@/components/race/RaceExperience";
import { circuitByShortName } from "@/lib/circuit/catalog";
import { loadCircuitGeometry } from "@/lib/circuit/load";
import { loadReplayIndex, replayUrl } from "@/lib/replay/load";
import { loadTelemetryIndex } from "@/lib/telemetry/load";

// Race data can change after the build (tools/openf1-sync writes DATA_DIR): rebuilt in the background at most every 15 minutes, and at once
// when the sync worker calls /api/revalidate.
export const revalidate = 900;

// Races and drivers synced after the build render on demand; unknown ones still 404 (notFound below).
export const dynamicParams = true;

/** One page per exported race whose circuit has a generated layout (the rest are listed, as unavailable, on /replay). */
export async function generateStaticParams() {
  const index = await loadReplayIndex();
  const ok = await Promise.all(
    index.map(async (r) => {
      const c = r.circuitShortName ? circuitByShortName(r.circuitShortName) : undefined;
      return c && (await loadCircuitGeometry(c.id)).status === "ok" ? String(r.sessionKey) : null;
    }),
  );
  return ok.filter((s): s is string => s !== null).map((session) => ({ session }));
}

type Props = { params: Promise<{ session: string }> };

async function find(session: string) {
  const r = (await loadReplayIndex()).find((x) => String(x.sessionKey) === session);
  const circuit = r?.circuitShortName ? circuitByShortName(r.circuitShortName) : undefined;
  return r && circuit ? { r, circuit } : null;
}

export async function generateMetadata({ params }: Props) {
  const f = await find((await params).session);
  // An unknown race is a 404 before anything is sent (metadata resolves first: next.config htmlLimitedBots), so the HTML is the not-found page.
  if (!f) notFound();
  return { title: `${f.r.eventName} ${f.r.season} · Replay` };
}

/** `/replay/<sessionKey>`: full-window replay of one recorded race on its 3D circuit. */
export default async function Page({ params }: Props) {
  const f = await find((await params).session);
  if (!f) notFound();
  const [geometry, telemetry] = await Promise.all([loadCircuitGeometry(f.circuit.id), loadTelemetryIndex()]);
  if (geometry.status !== "ok") notFound();
  return (
    <RaceExperience
      geometry={geometry.geometry}
      circuit={{ slug: f.circuit.id, name: f.circuit.shortName }}
      source={{ kind: "history", sessionKey: f.r.sessionKey, url: replayUrl(f.r.season, f.r.sessionKey), label: `${f.r.eventName} ${f.r.season} · Race · OpenF1 session ${f.r.sessionKey}` }}
      exitHref="/replay"
      telemetrySessionKey={telemetry.some((s) => s.sessionKey === f.r.sessionKey) ? f.r.sessionKey : null}
      notice={
        (f.r.positionCoverage ?? 1) < 0.9 ? (
          <span className="text-warning">
            OpenF1 published car positions for only {Math.round((f.r.positionCoverage ?? 0) * 100)}% of this race. Cars are drawn only where recorded; the running order, gaps,
            laps, pit stops and race control continue throughout.
          </span>
        ) : undefined
      }
    />
  );
}
