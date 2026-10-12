import { notFound } from "next/navigation";
import { CircuitViewer } from "@/components/circuit/CircuitViewer";
import { KeyValueList } from "@/components/data/key-value-list";
import { Badge } from "@/components/ui/badge";
import { ComingSoon } from "@/components/ui/coming-soon";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { Panel } from "@/components/ui/panel";
import { DEMO_CIRCUITS, findCircuit } from "@/domain/demo";
import { getNavItem } from "@/domain/navigation";
import { centerlineLengthUnits, circuitExtentMeters, describeScale, describeTrackWidth, resolveTrackWidth } from "@/lib/circuit/geometry";
import { loadCircuitGeometry } from "@/lib/circuit/load";

export const dynamicParams = false;
export const generateStaticParams = () => DEMO_CIRCUITS.map((c) => ({ circuit: c.slug }));

type Props = { params: Promise<{ circuit: string }> };

export async function generateMetadata({ params }: Props) {
  const circuit = findCircuit((await params).circuit);
  return { title: circuit?.name ?? "Circuit" };
}

export default async function CircuitPage({ params }: Props) {
  const circuit = findCircuit((await params).circuit);
  if (!circuit) notFound();

  const result = await loadCircuitGeometry(circuit.slug);
  if (result.status !== "ok") {
    return (
      <ComingSoon
        eyebrow={`Circuit · ${circuit.country}`}
        title={circuit.name}
        description={
          result.status === "invalid"
            ? `The geometry file for this circuit is invalid (${result.error}), so no 3D view is shown.`
            : "No circuit geometry has been generated for this circuit yet, so there is no 3D view. Nothing is drawn rather than guessing a layout."
        }
        phase={getNavItem("/circuits").phase}
        preview
        planned={[
          "Generate geometry from OpenF1 location data with tools/openf1-spike (see src/data/circuits/README.md)",
          "Length, laps, corners, DRS zones and results from sourced data (later phases)",
        ]}
        back={{ href: "/circuits", label: "All circuits" }}
      />
    );
  }

  const g = result.geometry;
  const scale = describeScale(g);
  const lengthM = Math.round(centerlineLengthUnits(g.points, g.closed) * g.unitMeters);
  return (
    <PageContainer>
      <PageHeader
        eyebrow={`Circuit · ${circuit.country}`}
        title={circuit.name}
        description="Interactive 3D layout reconstructed from OpenF1 car-location data. This is a centerline foundation, not a surveyed circuit model."
        badges={
          <>
            <Badge tone="info">Derived from OpenF1 location data</Badge>
            <Badge tone={scale.calibrated ? "success" : "warning"}>{scale.calibrated ? "Scale checked" : "Scale not calibrated"}</Badge>
          </>
        }
      />
      <CircuitViewer geometry={g} label={circuit.name} />
      <Panel as="section" aria-labelledby="geometry-heading" className="mt-6">
        <h2 id="geometry-heading" className="eyebrow">
          About this geometry
        </h2>
        <div className="mt-4">
          <KeyValueList
            items={[
              { label: "Source", value: `OpenF1 /location, session ${g.derivation.sessionKeys.join(", ")}` },
              { label: "Coordinate system", value: g.coordinateSystem },
              { label: "Centerline", value: `${g.points.length} points, ${g.closed ? "closed loop" : "open"}, ${g.derivation.lapsUsed} laps averaged` },
              { label: "Measured length", value: `about ${lengthM.toLocaleString("en-GB")} m under the stated scale (not the official length)` },
              { label: "Scale", value: scale.label },
              { label: "Track width", value: describeTrackWidth(resolveTrackWidth(g.widthMeters, circuitExtentMeters(g.points, g.unitMeters))) },
            ]}
          />
        </div>
        <p className="mt-4 text-xs leading-relaxed text-subtle">
          Known limits: flat road surface, no kerbs, pit lane, runoff or scenery. The line is an average racing line, not the track edge.
          {g.derivation.spikeVerdict ? ` Spike verdict: ${g.derivation.spikeVerdict}.` : ""}
        </p>
      </Panel>
    </PageContainer>
  );
}
