import Link from "next/link";
import { LiveTimingStatus } from "@/components/live/LiveTimingStatus";
import { RaceExperience } from "@/components/race/RaceExperience";
import { ComingSoon } from "@/components/ui/coming-soon";
import { circuitByShortName, findCircuitById } from "@/lib/circuit/catalog";
import { loadCircuitGeometry } from "@/lib/circuit/load";
import { loadSeasons } from "@/lib/drivers/load";
import { previousRace } from "@/lib/race/previous";
import { loadReplayIndex, replayUrl } from "@/lib/replay/load";
import { loadTelemetryIndex } from "@/lib/telemetry/load";

export const metadata = { title: "Live Race" };

const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8080";
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

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

type Props = { searchParams: Promise<{ replay?: string }> };

/**
 * `/live`: real data only. No live timing provider is connected, so there is never a live race here yet: the page says so and shows the
 * previous race (latest in the results snapshots): the full recorded race when Race Replay has it, else a window the APEX F1 API has
 * ingested; otherwise, or with `?replay=sample`, the stored Monaco sample.
 */
export default async function Page({ searchParams }: Props) {
  const wantSample = (await searchParams).replay === "sample";
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

  const link = "font-medium text-fg underline decoration-line underline-offset-2 hover:decoration-fg";
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
      telemetrySessionKey={recorded && (await loadTelemetryIndex()).some((s) => s.sessionKey === recorded.sessionKey) ? recorded.sessionKey : null}
    />
  );
}
