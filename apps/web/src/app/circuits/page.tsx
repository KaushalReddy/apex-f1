import { CircuitCard } from "@/components/data/circuit-card";
import { Badge, DemoBadge } from "@/components/ui/badge";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { DEMO_CIRCUITS } from "@/domain/demo";
import { getNavItem } from "@/domain/navigation";

export const metadata = { title: "Circuits" };

export default function CircuitsPage() {
  const { phase } = getNavItem("/circuits");
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Circuits"
        title="Circuits"
        description="Layouts, corners, DRS zones and results, with a 3D explorer. The entries below are a static preview of the layout."
        badges={<><Badge tone="info">Phase {phase}</Badge><DemoBadge /></>}
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {DEMO_CIRCUITS.map((c) => (
          <li key={c.slug}><CircuitCard circuit={c} /></li>
        ))}
      </ul>
    </PageContainer>
  );
}
