import { StrategyView } from "@/components/strategy/StrategyView";
import { PickerForm } from "@/components/telemetry/PickerForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { circuitByShortName } from "@/lib/circuit/catalog";
import { availableGeometrySlugs } from "@/lib/circuit/load";
import { loadReplayIndex } from "@/lib/replay/load";
import { loadStrategy } from "@/lib/strategy/load";

export const metadata = { title: "Strategy" };

type Props = { searchParams: Promise<{ session?: string; driver?: string }> };

/**
 * `/strategy?session=<key>&driver=<code>`: tyre strategy of a recorded race (Phase 13), from the Race Replay datasets (OpenF1 stints,
 * pit stops and lap times). Degradation is calculated; the what-if is a labelled simulation.
 */
export default async function Page({ searchParams }: Props) {
  const q = await searchParams;
  const [index, layouts] = await Promise.all([loadReplayIndex(), availableGeometrySlugs()]);
  const header = (
    <PageHeader
      eyebrow="Analysis"
      title="Strategy"
      description="How each driver's race unfolded on tyres: stints and stops as published, pace on each set with a fitted degradation trend, and a clearly labelled what-if for moving a stop."
      badges={
        <>
          <Badge tone="info">Stints & pit stops · OpenF1</Badge>
          <Badge tone="warning">What-if = simulation</Badge>
        </>
      }
    />
  );
  if (index.length === 0) {
    return (
      <PageContainer>
        {header}
        <EmptyState title="No races exported in this build" status="Unavailable" headingLevel="h2">
          Strategy reads the Race Replay datasets (tools/openf1-replay). Nothing is shown rather than invented.
        </EmptyState>
      </PageContainer>
    );
  }
  const chosen = index.find((r) => String(r.sessionKey) === q.session) ?? index[0];
  const loaded = await loadStrategy(chosen.season, chosen.sessionKey);
  const circuit = chosen.circuitShortName ? circuitByShortName(chosen.circuitShortName) : undefined;
  const replayHref = circuit && layouts.has(circuit.id) ? `/replay/${chosen.sessionKey}` : null;
  const noStints = loaded.ok && loaded.data.drivers.every((d) => d.stints.length === 0);

  return (
    <PageContainer>
      {header}
      <PickerForm className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-surface p-4">
        <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
          <span className="text-muted">Race</span>
          <select name="session" defaultValue={chosen.sessionKey} className="h-10 w-full rounded-md border border-line-strong bg-surface-2 px-2 text-sm text-fg">
            {index.map((r) => (
              <option key={r.sessionKey} value={r.sessionKey}>
                {r.eventName} {r.season} · {r.date}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit">Show</Button>
      </PickerForm>
      {q.session && String(chosen.sessionKey) !== q.session && <p className="mb-3 text-sm text-warning">Race {q.session} is not in the exported data; showing {chosen.eventName}.</p>}
      {!loaded.ok ? (
        <EmptyState title="This race could not be read" status="Error" statusTone="danger" headingLevel="h2">
          {chosen.eventName}: {loaded.error}. Re-export it with tools/openf1-replay.
        </EmptyState>
      ) : noStints ? (
        <EmptyState title="No tyre stints published for this race" status="Unavailable" headingLevel="h2">
          OpenF1 has no stint records for {chosen.eventName} in this export (re-export with tools/openf1-replay to include them).
        </EmptyState>
      ) : (
        <StrategyView key={chosen.sessionKey} data={loaded.data} initialDriver={q.driver ?? null} replayHref={replayHref} />
      )}
    </PageContainer>
  );
}
