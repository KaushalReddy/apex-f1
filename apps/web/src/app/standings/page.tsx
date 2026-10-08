import { StandingsPlaceholder } from "@/components/data/standings-placeholder";
import { Badge } from "@/components/ui/badge";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { getNavItem } from "@/domain/navigation";

export const metadata = { title: "Standings" };

export default function StandingsPage() {
  const { phase } = getNavItem("/standings");
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Standings"
        title="Championship standings"
        description="Driver and constructor tables. No data source is connected yet, so these tables are empty by design."
        badges={<Badge tone="info">Phase {phase}</Badge>}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel as="section" aria-labelledby="ds">
          <h2 id="ds" className="eyebrow">Drivers</h2>
          <div className="mt-2"><StandingsPlaceholder label="Drivers standings" rows={10} /></div>
        </Panel>
        <Panel as="section" aria-labelledby="cs">
          <h2 id="cs" className="eyebrow">Constructors</h2>
          <div className="mt-2"><StandingsPlaceholder label="Constructors standings" rows={10} /></div>
        </Panel>
      </div>
    </PageContainer>
  );
}
