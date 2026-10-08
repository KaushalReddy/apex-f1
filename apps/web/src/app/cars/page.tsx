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
        description="An interactive 3D car viewer with component hotspots and an exploded view. Cars will be generic open-wheel models in team colours, not official assets."
        badges={<><Badge tone="info">Phase {phase}</Badge><DemoBadge /></>}
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {DEMO_TEAMS.map((t) => (
          <li key={t.slug}><TeamCard team={t} base="/cars" /></li>
        ))}
      </ul>
    </PageContainer>
  );
}
