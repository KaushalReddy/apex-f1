import { TeamDirectory } from "@/components/teams/TeamDirectory";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { loadSeasons } from "@/lib/drivers/load";
import { teamDirectory } from "@/lib/teams/views";

// Race data can change after the build (tools/openf1-sync writes DATA_DIR): rebuilt in the background at most every 15 minutes, and at once
// when the sync worker calls /api/revalidate.
export const revalidate = 900;

export const metadata = { title: "Teams" };

export default async function TeamsPage() {
  const { seasons } = await loadSeasons();
  const data = teamDirectory(seasons).filter((s) => s.teams.length);
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Teams"
        title="Teams"
        description="The constructors, their line-ups and their season, race by race."
        badges={data.length ? <Badge tone="info">Official classifications · OpenF1</Badge> : <Badge tone="warning">Not available</Badge>}
        actions={
          <ButtonLink href="/teams/compare" variant="secondary" size="sm">
            Compare teams
          </ButtonLink>
        }
      />
      {data.length ? (
        <TeamDirectory seasons={data} />
      ) : (
        <EmptyState title="No race results yet" status="Not available" statusTone="warning" headingLevel="h2">
          Teams, line-ups and standings appear here once results are published after the first race.
        </EmptyState>
      )}
    </PageContainer>
  );
}
