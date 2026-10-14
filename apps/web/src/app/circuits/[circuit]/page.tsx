import { notFound } from "next/navigation";
import { CircuitExplorer } from "@/components/circuits/CircuitExplorer";
import { CIRCUITS, findCircuitById } from "@/lib/circuit/catalog";
import { centerlineLengthUnits, circuitExtentMeters, describeScale, describeTrackWidth, resolveTrackWidth } from "@/lib/circuit/geometry";
import { circuitHistory } from "@/lib/circuit/history";
import { availableGeometrySlugs, loadCircuitGeometry } from "@/lib/circuit/load";
import { loadSeasons } from "@/lib/drivers/load";

export const dynamicParams = false;
export const generateStaticParams = () => CIRCUITS.map((c) => ({ circuit: c.id }));

type Props = { params: Promise<{ circuit: string }> };

export async function generateMetadata({ params }: Props) {
  const c = findCircuitById((await params).circuit);
  return { title: c ? `${c.shortName} circuit` : "Circuit", description: c ? `${c.name}, ${c.locality}: interactive 3D layout from OpenF1 car-position data.` : undefined };
}

/** Circuit explorer (full-window). The layout comes from the circuit's geometry artifact; everything else from the catalog and results. */
export default async function CircuitPage({ params }: Props) {
  const circuit = findCircuitById((await params).circuit);
  if (!circuit) notFound();
  const [result, { seasons }, withLayout] = await Promise.all([loadCircuitGeometry(circuit.id), loadSeasons(), availableGeometrySlugs()]);
  const g = result.status === "ok" ? result.geometry : null;
  const provenance = g
    ? {
        sessionKeys: g.derivation.sessionKeys,
        lapsUsed: g.derivation.lapsUsed,
        points: g.points.length,
        measuredLengthM: Math.round(centerlineLengthUnits(g.points, g.closed) * g.unitMeters),
        scaleLabel: describeScale(g).label,
        calibrated: describeScale(g).calibrated,
        widthLabel: describeTrackWidth(resolveTrackWidth(g.widthMeters, circuitExtentMeters(g.points, g.unitMeters))),
        verdict: g.derivation.spikeVerdict ?? null,
      }
    : null;
  return (
    <CircuitExplorer
      circuit={circuit}
      geometry={g}
      provenance={provenance}
      events={circuitHistory(circuit, seasons)}
      all={[...CIRCUITS].sort((a, b) => a.shortName.localeCompare(b.shortName)).map((c) => ({ id: c.id, shortName: c.shortName, hasLayout: withLayout.has(c.id) }))}
    />
  );
}
