import Link from "next/link";
import { LiveSessionWatch } from "@/components/live/LiveSessionWatch";
import { LiveTimingStatus } from "@/components/live/LiveTimingStatus";
import { NextRaceTab } from "@/components/live/NextSession";
import { RaceExperience } from "@/components/race/RaceExperience";
import { ComingSoon } from "@/components/ui/coming-soon";
import { circuitByShortName, findCircuitById } from "@/lib/circuit/catalog";
import { loadCircuitGeometry } from "@/lib/circuit/load";
import { loadSeasons } from "@/lib/drivers/load";
import { liveFeed } from "@/lib/openf1/server";
import { previousRace } from "@/lib/race/previous";
import { loadReplayIndex, replayUrl } from "@/lib/replay/load";
import { loadTelemetryIndex } from "@/lib/telemetry/load";

export const metadata = { title: "Live Race" };

// Server-side calls to the replay API: its internal address when deployed (API_INTERNAL_URL, e.g. http://api:8080 on the compose network),
// else the public one the browser uses.
const API_BASE_URL = process.env.API_INTERNAL_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";
/** The stored sample replay (it matches the Replay page). Live is real data only; simulated races are under each circuit. */
const SAMPLE = { circuit: "monaco", sessionKey: 9523, from: 1716728400000, to: 1716728410000, label: "Monaco 2024 · Race · OpenF1 session 9523 (10 s window)" };
/** Length of the previous-race window replayed from its first ingested sample. */
const PREVIOUS_WINDOW_MS = 60_000;

/** Window searched for ingested positions, from the session start (formation lap and lights-out fall well inside it). */
const SEARCH_MS = 30 * 60_000;
const PROBE_MS = 5 * 60_000;

/**
 * Time of the first ingested position sample of a session in the APEX F1 API, or null (not ingested, or the API is not reachable).
 * The replay starts there, so it begins wherever the ingested window begins (e.g. lights-out), not at the scheduled session start.
 * shortcut: probes the first 30 min in 5-min windows (the API has no "data range" endpoint); add one if longer searches are needed.
 */
async function firstIngestedSample(sessionKey: number): Promise<number | null> {
  try {
    const s = await fetch(`${API_BASE_URL}/api/sessions/${sessionKey}`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
    if (!s.ok) return null;
    const start = Date.parse((await s.json()).dateStart);
    if (!Number.isFinite(start)) return null;
    for (let from = start; from < start + SEARCH_MS; from += PROBE_MS) {
      const t = await fetch(`${API_BASE_URL}/api/sessions/${sessionKey}/replay/timeline?from=${from}&to=${from + PROBE_MS}`, { cache: "no-store", signal: AbortSignal.timeout(4000) });
      if (!t.ok) return null;
      // Every frame lists each car's NEAREST sample (even minutes away), with that sample's own time: the earliest of those is where data begins.
      const first = ((await t.json()) as { cars: { sampleT: number }[] }[]).find((f) => f.cars.length > 0);
      if (first) return Math.min(...first.cars.map((c) => c.sampleT));
    }
    return null;
  } catch {
    return null;
  }
}

/** The session on track now (shared server feed, so no extra OpenF1 requests), or null. Capped so a slow provider never holds the page. */
async function liveSession() {
  try {
    // A full poll can take longer than 3 s; then use the session the feed already knows rather than wrongly showing a recorded race.
    const feed = liveFeed();
    const s = await Promise.race([feed.snapshot(), new Promise<ReturnType<typeof feed.cached>>((r) => setTimeout(() => r(feed.cached()), 3000))]);
    return s?.status === "live" ? s.session : null;
  } catch {
    return null;
  }
}

/**
 * Live Race Health panel: `next dev` only. Imported dynamically inside a literal NODE_ENV check, so a production build drops the branch,
 * the import and the panel's code (a static import would still ship it in the page's client bundle, unrendered).
 */
async function devHealthPanel() {
  if (process.env.NODE_ENV !== "development") return null;
  const { LiveHealthPanel } = await import("@/components/live/LiveHealthPanel");
  return <LiveHealthPanel />;
}

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

type Props = { searchParams: Promise<{ replay?: string }> };

/**
 * `/live`: real data only. While a session is on track (and its circuit has a layout) the 3D view follows it live; otherwise the page
 * says so and shows the previous race (latest in the results snapshots): the full recorded race when Race Replay has it, else a window the APEX F1 API has
 * ingested; otherwise, or with `?replay=sample`, the stored Monaco sample.
 */
export default async function Page({ searchParams }: Props) {
  const wantSample = (await searchParams).replay === "sample";
  const link = "font-medium text-fg underline decoration-line underline-offset-2 hover:decoration-fg";

  // A session on track whose circuit has a generated layout: the 3D view follows it with genuine live positions (lib/race/live).
  const live = wantSample ? null : await liveSession();
  const liveCircuit = live ? circuitByShortName(live.circuit) : undefined;
  const liveGeometry = liveCircuit ? await loadCircuitGeometry(liveCircuit.id) : null;
  if (live && liveCircuit && liveGeometry?.status === "ok") {
    const title = `${live.event ?? liveCircuit.shortName} · ${live.name}`;
    // Keyed by circuit, not session: when the next session at the same track starts, the view (camera, selection) stays and only its data
    // source changes.
    return (
      <>
        <RaceExperience
          key={`live-${liveCircuit.id}`}
          geometry={liveGeometry.geometry}
          circuit={{ slug: liveCircuit.id, name: liveCircuit.shortName }}
          source={{ kind: "live", sessionKey: live.key, label: `${title} · OpenF1 session ${live.key}` }}
          exitHref="/"
          notice={
            <>
              <span className="mb-2 block">
                <LiveTimingStatus />
              </span>
              <span className="font-medium text-fg">The 3D view follows {title} live.</span> Car positions come from OpenF1 as it publishes them; none are shown until it does.{" "}
              <Link href="/replay" className={link}>
                Recorded race replays
              </Link>
            </>
          }
          banner={<NextRaceTab />}
        />
        <LiveSessionWatch following={live.key} />
        {await devHealthPanel()}
      </>
    );
  }

  const prev = previousRace((await loadSeasons()).seasons, new Date().toISOString().slice(0, 10));
  const prevCircuit = prev?.circuitShortName ? circuitByShortName(prev.circuitShortName) : undefined;
  const prevGeometry = prevCircuit ? await loadCircuitGeometry(prevCircuit.id) : null;
  // Preferred: the full recorded race from the Race Replay datasets; otherwise a window ingested into the APEX F1 API.
  const recorded = prev && prevGeometry?.status === "ok" ? (await loadReplayIndex()).find((r) => r.sessionKey === prev.sessionKey) : undefined;
  const prevStart = prev && prevGeometry?.status === "ok" && !recorded ? await firstIngestedSample(prev.sessionKey) : null;
  const prevTitle = prev ? `${prev.name} ${prev.season} (${day(prev.date)})` : null;
  const showPrevious = !wantSample && prev && prevCircuit && prevGeometry?.status === "ok" && (recorded || prevStart !== null);

  const circuit = showPrevious ? prevCircuit : findCircuitById(SAMPLE.circuit);
  const result = showPrevious ? prevGeometry : circuit ? await loadCircuitGeometry(circuit.id) : null;
  if (!circuit || !result || result.status !== "ok") {
    return (
      <ComingSoon
        eyebrow="Live"
        title="Live Race"
        description="The latest Grand Prix, replayed on its circuit."
        reason="This circuit's 3D layout isn't available, so the race can't be drawn. We don't guess a layout."
        back={{ href: "/circuits", label: "All circuits" }}
      />
    );
  }

  const notice = (
    <>
      {/* Real-time status from /api/live (OpenF1 subscription, server-side): unavailable, next session, or live order and freshness. */}
      <span className="mb-2 block">
        <LiveTimingStatus />
      </span>
      <span className="font-medium text-fg">The 3D view shows a recorded race.</span>{" "}
      {showPrevious ? (
        <>
          Showing the previous race, {prevTitle}{recorded ? ", recorded in full" : ""}.{" "}
          <Link href="/replay" className={link}>
            All race replays
          </Link>
        </>
      ) : !prevTitle ? null : recorded || prevStart !== null ? (
        <Link href="/live" className={link}>
          Watch the previous race: {prevTitle}
        </Link>
      ) : (
        <>
          Previous race: {prevTitle}. Its replay is not available: {prevGeometry?.status !== "ok" ? "the circuit has no generated layout" : "its car positions are not available"}.
          {" Showing the stored Monaco sample instead."}
        </>
      )}
    </>
  );

  return (
    <>
      <RaceExperience
        key={showPrevious ? "previous" : "sample"}
        geometry={result.geometry}
        circuit={{ slug: circuit.id, name: circuit.shortName }}
        source={
          showPrevious && recorded
            ? { kind: "history", sessionKey: recorded.sessionKey, url: replayUrl(recorded.season, recorded.sessionKey), label: `${prevTitle} · Race · OpenF1 session ${recorded.sessionKey}` }
            : showPrevious && prevStart !== null
            ? { kind: "replay", sessionKey: prev.sessionKey, from: prevStart, to: prevStart + PREVIOUS_WINDOW_MS, label: `${prevTitle} · Race · OpenF1 session ${prev.sessionKey} (${PREVIOUS_WINDOW_MS / 1000} s from ${new Date(prevStart).toISOString().slice(11, 19)} UTC)` }
            : { kind: "replay", ...SAMPLE }
        }
        exitHref="/"
        notice={notice}
        banner={<NextRaceTab />}
        telemetrySessionKey={recorded && (await loadTelemetryIndex()).some((s) => s.sessionKey === recorded.sessionKey) ? recorded.sessionKey : null}
      />
      {/* The sample is asked for explicitly: it never switches to a live session on its own. */}
      {!wantSample && <LiveSessionWatch following={null} />}
      {await devHealthPanel()}
    </>
  );
}
