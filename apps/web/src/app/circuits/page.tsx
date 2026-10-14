import { CircuitDirectory } from "@/components/circuits/CircuitDirectory";
import { Badge } from "@/components/ui/badge";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { CATALOG, CIRCUITS } from "@/lib/circuit/catalog";
import { loadCircuitGeometry } from "@/lib/circuit/load";
import { circuitOutline, type Outline } from "@/lib/circuit/outline";

export const metadata = { title: "Circuits" };

export default async function CircuitsPage() {
  const outlines: Record<string, Outline | null> = {};
  for (const c of CIRCUITS) {
    const g = await loadCircuitGeometry(c.id);
    outlines[c.id] = g.status === "ok" ? circuitOutline(g.geometry.points, g.geometry.closed) : null;
  }
  const withLayout = Object.values(outlines).filter(Boolean).length;
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Circuits"
        title="Circuits"
        description={`Every circuit that has hosted a Grand Prix since 2023 (${CIRCUITS.length}). ${withLayout} have a 3D layout reconstructed from real car-position data; lengths, turns and lap records are as published (sources on each circuit).`}
        badges={
          <>
            <Badge tone="info">{withLayout} layouts from OpenF1 car positions</Badge>
            <Badge tone="neutral">Facts: Wikipedia, accessed {CATALOG.generatedOn}</Badge>
          </>
        }
      />
      <CircuitDirectory circuits={CIRCUITS} outlines={outlines} />
    </PageContainer>
  );
}
