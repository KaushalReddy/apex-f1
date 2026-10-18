import { EngineerPage } from "@/components/engineer/EngineerPage";
import { PickerForm } from "@/components/telemetry/PickerForm";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { circuitByShortName } from "@/lib/circuit/catalog";
import { availableGeometrySlugs } from "@/lib/circuit/load";
import { configured } from "@/lib/engineer/engineer";
import { loadReplayIndex } from "@/lib/replay/load";

export const metadata = { title: "AI Race Engineer" };
// The API key is read at request time (it is not baked into the build).
export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ session?: string }> };

/** `/race-engineer?session=<key>`: ask about one recorded race (Phase 14). Answers come only from that race's exported OpenF1 data. */
export default async function Page({ searchParams }: Props) {
  const q = await searchParams;
  const [index, layouts] = await Promise.all([loadReplayIndex(), availableGeometrySlugs()]);
  const header = (
    <PageHeader
      eyebrow="Analysis"
      title="AI Race Engineer"
      description="Ask about a race in plain English. The engineer answers from the race data (results, laps, pit stops, tyres, race control, weather), shows every look-up, and says so when the data doesn't cover it."
      badges={
        <>
          <Badge tone="info">Answers from OpenF1 race data</Badge>
          <Badge tone="warning">AI: can be wrong</Badge>
        </>
      }
    />
  );
  if (!configured()) {
    return (
      <PageContainer>
        {header}
        <EmptyState title="The race engineer is offline" status="Unavailable" headingLevel="h2">
          This server has no AI key configured, so the engineer cannot answer questions here. Replay, Strategy and Rewind work without it.
        </EmptyState>
      </PageContainer>
    );
  }
  if (index.length === 0) {
    return (
      <PageContainer>
        {header}
        <EmptyState title="No races to ask about yet" status="Unavailable" headingLevel="h2">
          The engineer answers from recorded races, and none are available yet.
        </EmptyState>
      </PageContainer>
    );
  }
  const chosen = index.find((r) => String(r.sessionKey) === q.session) ?? index[0];
  const circuit = chosen.circuitShortName ? circuitByShortName(chosen.circuitShortName) : undefined;
  const hasReplay = !!circuit && layouts.has(circuit.id);
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
      {q.session && String(chosen.sessionKey) !== q.session && <p className="mb-3 text-sm text-warning">Race {q.session} is not available; showing {chosen.eventName}.</p>}
      <EngineerPage key={chosen.sessionKey} sessionKey={chosen.sessionKey} raceName={`${chosen.eventName} ${chosen.season}`} hasReplay={hasReplay} />
    </PageContainer>
  );
}
