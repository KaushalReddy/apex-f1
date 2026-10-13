import { TeamCard } from "@/components/data/team-card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { DEMO_TEAMS } from "@/domain/demo";
import { getNavItem } from "@/domain/navigation";

export const metadata = { title: "Car Lab" };

export default function CarsPage() {
  const { phase } = getNavItem("/cars");
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Cars"
        title="Car Lab"
        description="An interactive 3D viewer for a generic, procedurally generated open-wheel car: camera presets, component inspection, an exploded view and an illustrative aerodynamics mode. Each team's page shows the same car in that team's colours, not the team's real car."
        badges={<><Badge tone="info">Phase 4 foundation · full lab Phase {phase}</Badge><DemoBadge /></>}
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {DEMO_TEAMS.map((t) => (
          <li key={t.slug}><TeamCard team={t} base="/cars" /></li>
        ))}
      </ul>
    </PageContainer>
  );
}
