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
        description="Every driver who started a race in the seasons APEX F1 has exported, with published championship standings and results. Open a profile for season trends and results, or compare two drivers."
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
          <EmptyState title="No results dataset in this build" status="Unavailable" headingLevel="h2" className="mb-6">
            Season results are generated with tools/openf1-results (see src/data/results/README.md). Until then only the static preview below is
            shown, with names and teams and no statistics.
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
