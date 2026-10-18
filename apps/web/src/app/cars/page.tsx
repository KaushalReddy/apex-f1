import { TeamCard } from "@/components/data/team-card";
import { Badge } from "@/components/ui/badge";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { CAR_CONFIGS, carDriversFor } from "@/lib/car/teams";
import { loadSeasons } from "@/lib/drivers/load";
import { findTeamBySlug } from "@/lib/teams/registry";

// Race data can change after the build (tools/openf1-sync writes DATA_DIR): rebuilt in the background at most every 15 minutes, and at once
// when the sync worker calls /api/revalidate.
export const revalidate = 900;

export const metadata = { title: "Car Lab" };

export default async function CarsPage() {
  // Same line-up source as the car pages, so every team card names its drivers.
  const { seasons } = await loadSeasons();
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Cars"
        title="Car Lab"
        description="Take a Formula 1-style car apart in 3D: isolate and explode components, trace the airflow and compare wing setups. Every team shares one generic body in its own colours; it is not any team's real car."
        badges={<Badge tone="warning">One generic car · team colours</Badge>}
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
