import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CardArrow } from "@/components/ui/card-arrow";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { DataFreshness } from "@/components/data/DataFreshness";
import { circuitByShortName } from "@/lib/circuit/catalog";
import { availableGeometrySlugs } from "@/lib/circuit/load";
import { loadReplayIndex } from "@/lib/replay/load";

// Race data can change after the build (tools/openf1-sync writes DATA_DIR): rebuilt in the background at most every 15 minutes, and at once
// when the sync worker calls /api/revalidate.
export const revalidate = 900;

export const metadata = { title: "Race Replay" };

const clock = (ms: number) => `${Math.floor(ms / 3_600_000)}:${String(Math.floor((ms % 3_600_000) / 60_000)).padStart(2, "0")}`;

/**
 * Race Replay picker. Lists every exported race (tools/openf1-replay) and says plainly which can be replayed: a race needs its dataset and
 * a generated circuit layout to be placed in 3D.
 */
export default async function Page() {
  const [index, layouts] = await Promise.all([loadReplayIndex(), availableGeometrySlugs()]);
  const rows = index.map((r) => {
    const circuit = r.circuitShortName ? circuitByShortName(r.circuitShortName) : undefined;
    const ready = !!circuit && layouts.has(circuit.id);
    return { ...r, circuit, ready };
  });
  const seasons = [...new Set(rows.map((r) => r.season))];

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Analysis"
        title="Race Replay"
        description="Play back a recorded Grand Prix on its 3D circuit: every car's recorded position, the official running order, gaps, laps, pit stops and race-control messages at any moment, with seeking and speed control."
        badges={<Badge tone="info">Recorded data · OpenF1</Badge>}
      />
      <DataFreshness className="-mt-4 mb-8" />
      {rows.length === 0 ? (
        <EmptyState title="No race replays in this build" status="Unavailable" headingLevel="h2">
          Replays are exported from OpenF1 with tools/openf1-replay (see tools/openf1-replay/README.md). Nothing is shown rather than invented.
        </EmptyState>
      ) : (
        seasons.map((season) => (
          <section key={season} aria-labelledby={`season-${season}`} className="mb-10">
            <h2 id={`season-${season}`} className="mb-3 font-display text-2xl font-semibold">
              {season} season
            </h2>
            <ul className="border-b border-line">
              {rows
                .filter((r) => r.season === season)
                .map((r) => {
                  const body = (
                    <>
                      <span className="tabular-nums text-sm text-subtle">{r.date}</span>
                      <span className="min-w-0">
                        <span className="block font-medium">{r.eventName}</span>
                        <span className="block truncate text-sm text-muted">
                          {r.circuit?.name ?? r.circuitShortName ?? "Unknown circuit"} · {r.laps} laps · {r.drivers} cars · {clock(r.durationMs)} recorded
                          {(r.positionCoverage ?? 1) < 0.9 && ` · car positions for ${Math.round((r.positionCoverage ?? 0) * 100)}% of it`}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        {!r.ready ? (
                          <Badge tone="warning">No circuit layout</Badge>
                        ) : (r.positionCoverage ?? 1) < 0.9 ? (
                          <Badge tone="warning">Partial positions</Badge>
                        ) : (
                          <Badge tone="success">Replay ready</Badge>
                        )}
                        {r.ready && <CardArrow />}
                      </span>
                    </>
                  );
                  const grid = "grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-center gap-x-4 border-t border-line px-1 py-3.5 max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:[&>span:first-child]:col-span-2";
                  return (
                    <li key={r.sessionKey}>
                      {r.ready ? (
                        <Link href={`/replay/${r.sessionKey}`} className={`group motion-interactive ${grid} hover:bg-surface/60`}>
                          {body}
                        </Link>
                      ) : (
                        <div className={grid} title="This circuit has no generated layout, so the cars cannot be placed in 3D.">
                          {body}
                        </div>
                      )}
                    </li>
                  );
                })}
            </ul>
          </section>
        ))
      )}
      <p className="max-w-prose text-sm leading-relaxed text-muted">
        Positions are OpenF1&apos;s recorded car locations, kept at least one second apart; between samples, cars move along the track in proportion to time and nothing is bridged across gaps longer
        than five seconds. The running order, gaps, lap times, pit stops and race-control messages are shown as published at each moment.
      </p>
    </PageContainer>
  );
}
