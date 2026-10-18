import { DriverDirectory } from "@/components/drivers/DriverDirectory";
import { DriverCard } from "@/components/data/driver-card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { DEMO_DRIVERS } from "@/domain/demo";
import { loadSeasons } from "@/lib/drivers/load";
import { directory } from "@/lib/drivers/views";

// Race data can change after the build (tools/openf1-sync writes DATA_DIR): rebuilt in the background at most every 15 minutes, and at once
// when the sync worker calls /api/revalidate.
export const revalidate = 900;

export const metadata = { title: "Drivers" };

export default async function DriversPage() {
  const { seasons } = await loadSeasons();
  const data = directory(seasons);
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Drivers"
        title="Drivers"
        description="Every driver who has started a race since 2024: results, form and championship position. Open a profile, or put two drivers side by side."
        badges={
          data.length ? (
            <>
              <Badge tone="info">Official classifications · OpenF1</Badge>
              <Badge>{data.map((d) => d.meta.season).join(", ")}</Badge>
            </>
          ) : (
            <DemoBadge />
          )
        }
        actions={
          data.length ? (
            <ButtonLink href="/drivers/compare" variant="secondary" size="sm">
              Compare drivers
            </ButtonLink>
          ) : undefined
        }
      />
      {data.length ? (
        <DriverDirectory seasons={data} />
      ) : (
        <>
          <EmptyState title="No race results yet" status="Unavailable" headingLevel="h2" className="mb-6">
            Results appear after the first classified race. Until then the grid below shows names and teams only, with no statistics.
          </EmptyState>
          <ul className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            {DEMO_DRIVERS.map((d) => (
              <li key={d.slug}>
                <DriverCard driver={d} />
              </li>
            ))}
          </ul>
        </>
      )}
    </PageContainer>
  );
}
