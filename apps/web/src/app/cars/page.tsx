import { TeamCard } from "@/components/data/team-card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { CAR_CONFIGS, carDriversFor } from "@/lib/car/teams";
import { loadSeasons } from "@/lib/drivers/load";
import { findTeamBySlug } from "@/lib/teams/registry";
import { getNavItem } from "@/domain/navigation";

export const metadata = { title: "Car Lab" };

export default async function CarsPage() {
  const { phase } = getNavItem("/cars");
  // Same line-up source as the car pages, so every team card names its drivers.
  const { seasons } = await loadSeasons();
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Cars"
        title="Car Lab"
        description="A generic, procedurally generated open-wheel car to inspect in 3D: isolate and explode components, explore conceptual airflow and compare wing setups. Each team's car is the same body in that team's colours, not the team's real car."
        badges={<><Badge tone="info">Phase {phase}</Badge><DemoBadge /></>}
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CAR_CONFIGS.map((c) => (
          <li key={c.teamSlug}>
            <TeamCard team={{ slug: c.teamSlug, name: findTeamBySlug(c.teamSlug)!.name, color: c.livery.primary }} base="/cars" drivers={carDriversFor(c.teamSlug, seasons)} />
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
