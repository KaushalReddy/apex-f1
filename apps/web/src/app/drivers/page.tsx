import { DriverCard } from "@/components/data/driver-card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { DEMO_DRIVERS } from "@/domain/demo";
import { getNavItem } from "@/domain/navigation";

export const metadata = { title: "Drivers" };

export default function DriversPage() {
  const { phase } = getNavItem("/drivers");
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Drivers"
        title="Drivers"
        description="Full profiles with results, form and teammate comparison arrive with the driver experience. The names below are a static preview of the layout."
        badges={<><Badge tone="info">Phase {phase}</Badge><DemoBadge /></>}
      />
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        {DEMO_DRIVERS.map((d) => (
          <li key={d.slug}><DriverCard driver={d} /></li>
        ))}
      </ul>
    </PageContainer>
  );
}
