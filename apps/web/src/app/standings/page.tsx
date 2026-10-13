import Link from "next/link";
import { StandingsView } from "@/components/drivers/StandingsView";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { loadSeasons } from "@/lib/drivers/load";
import { seasonStandings } from "@/lib/drivers/standings";

export const metadata = { title: "Standings" };

export default async function StandingsPage() {
  const { seasons } = await loadSeasons();
  const tables = seasons.map((s) => seasonStandings(s, seasons)).filter((t) => t.drivers.length);
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Standings"
        title="Championship standings"
        description="Drivers' and constructors' championships as published after each race, for the seasons APEX F1 has exported."
        badges={tables.length ? <Badge tone="info">Published standings · OpenF1</Badge> : <Badge tone="warning">Not available</Badge>}
        actions={
          <ButtonLink href="/drivers/compare" variant="secondary" size="sm">
            Compare drivers
          </ButtonLink>
        }
      />
      {tables.length ? (
        <StandingsView seasons={tables} />
      ) : (
        <EmptyState title="No results dataset in this build" status="Not available" statusTone="warning" headingLevel="h2">
          Standings come from exported season snapshots (tools/openf1-results; see src/data/results/README.md). None are present, so no positions
          or points are shown. See{" "}
          <Link href="/drivers" className="text-fg underline underline-offset-4">
            drivers
          </Link>
          .
        </EmptyState>
      )}
    </PageContainer>
  );
}
