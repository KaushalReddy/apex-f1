import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/ui/coming-soon";
import { DEMO_CIRCUITS, findCircuit } from "@/domain/demo";
import { getNavItem } from "@/domain/navigation";

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
  return (
    <ComingSoon
      eyebrow={`Circuit · ${circuit.country}`}
      title={circuit.name}
      description="The circuit explorer is not built yet. No layout, length or lap record is shown because none has been sourced."
      phase={getNavItem("/circuits").phase}
      preview
      planned={[
        "Length, laps, corners, DRS zones and race distance from sourced data",
        "3D orbit and follow-the-racing-line modes",
        "Historical results",
      ]}
      back={{ href: "/circuits", label: "All circuits" }}
    />
  );
}
