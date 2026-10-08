import { TeamCard } from "@/components/data/team-card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { DEMO_TEAMS } from "@/domain/demo";
import { getNavItem } from "@/domain/navigation";

export const metadata = { title: "Teams" };

export default function TeamsPage() {
  const { phase } = getNavItem("/teams");
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Teams"
        title="Teams"
        description="Constructor profiles with line-ups, results and history arrive with the team experience. The entries below are a static preview of the layout."
        badges={<><Badge tone="info">Phase {phase}</Badge><DemoBadge /></>}
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {DEMO_TEAMS.map((t) => (
          <li key={t.slug}><TeamCard team={t} /></li>
        ))}
      </ul>
    </PageContainer>
  );
}
