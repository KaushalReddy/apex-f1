import { RaceExperience } from "@/components/race/RaceExperience";
import { ComingSoon } from "@/components/ui/coming-soon";
import { PageContainer } from "@/components/ui/page-container";
import { findCircuit } from "@/domain/demo";
import { getNavItem } from "@/domain/navigation";
import { loadCircuitGeometry } from "@/lib/circuit/load";

export const metadata = { title: "Live Race" };

/** The only circuit with generated geometry so far (Phase 9 adds more). The stored replay window matches the Replay page. */
const CIRCUIT = "monaco";
const REPLAY = { sessionKey: 9523, from: 1716728400000, to: 1716728410000, label: "Monaco 2024 · Race · OpenF1 session 9523 (10 s window)" };
/** Simulated race length: short enough to watch end to end, long enough for pit stops and battles. Not the real race distance. */
const DEMO_LAPS = 12;

export default async function Page() {
  const circuit = findCircuit(CIRCUIT);
  const result = await loadCircuitGeometry(CIRCUIT);
  if (!circuit || result.status !== "ok") {
    return (
      <ComingSoon
        eyebrow="Live"
        title="Live Race"
        description="The race view needs generated circuit geometry, and none is available in this build, so nothing is drawn rather than guessing a layout."
        phase={getNavItem("/live").phase}
        planned={["Generate geometry with tools/openf1-spike (see src/data/circuits/README.md)"]}
      />
    );
  }
  return (
    <PageContainer className="lg:py-8">
      <RaceExperience geometry={result.geometry} circuit={{ slug: circuit.slug, name: circuit.name }} replay={REPLAY} totalLaps={DEMO_LAPS} />
    </PageContainer>
  );
}
