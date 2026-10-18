import { StandingsView } from "@/components/drivers/StandingsView";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { DataFreshness } from "@/components/data/DataFreshness";
import { PageHeader } from "@/components/ui/page-header";
import { loadSeasons } from "@/lib/drivers/load";
import { seasonStandings } from "@/lib/drivers/standings";

// Race data can change after the build (tools/openf1-sync writes DATA_DIR): rebuilt in the background at most every 15 minutes, and at once
// when the sync worker calls /api/revalidate.
export const revalidate = 900;

export const metadata = { title: "Standings" };

export default async function StandingsPage() {
  const { seasons } = await loadSeasons();
  const tables = seasons.map((s) => seasonStandings(s, seasons)).filter((t) => t.drivers.length);
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Standings"
        title="Championship standings"
        description="Both championships, as published after every round."
        badges={tables.length ? <Badge tone="info">Published standings · OpenF1</Badge> : <Badge tone="warning">Not available</Badge>}
        actions={
          <ButtonLink href="/drivers/compare" variant="secondary" size="sm">
            Compare drivers
          </ButtonLink>
        }
      />
      <DataFreshness className="-mt-4 mb-8" />
      {tables.length ? (
        <StandingsView seasons={tables} />
      ) : (
        <EmptyState title="No standings yet" status="Not available" statusTone="warning" headingLevel="h2">
          The championships appear here once results are published after the first race. No positions or points are guessed.
        </EmptyState>
      )}
    </PageContainer>
  );
}
