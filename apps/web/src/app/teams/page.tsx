import { TeamDirectory } from "@/components/teams/TeamDirectory";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { loadSeasons } from "@/lib/drivers/load";
import { teamDirectory } from "@/lib/teams/views";

export const metadata = { title: "Teams" };

export default async function TeamsPage() {
  const { seasons } = await loadSeasons();
  const data = teamDirectory(seasons).filter((s) => s.teams.length);
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Teams"
        title="Teams"
        description="The constructors, their line-ups and their season, from official classifications and published standings."
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
        <EmptyState title="No results dataset in this build" status="Not available" statusTone="warning" headingLevel="h2">
          Teams are listed from exported season snapshots (tools/openf1-results; see src/data/results/README.md). None are present, so no teams,
          line-ups or standings are shown.
        </EmptyState>
      )}
    </PageContainer>
  );
}
