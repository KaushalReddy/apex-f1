import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/ui/coming-soon";
import { DEMO_TEAMS, findTeam } from "@/domain/demo";
import { getNavItem } from "@/domain/navigation";

export const dynamicParams = false;
export const generateStaticParams = () => DEMO_TEAMS.map((t) => ({ team: t.slug }));

type Props = { params: Promise<{ team: string }> };

export async function generateMetadata({ params }: Props) {
  const team = findTeam((await params).team);
  return { title: team ? `${team.name} car` : "Car" };
}

export default async function CarPage({ params }: Props) {
  const team = findTeam((await params).team);
  if (!team) notFound();
  return (
    <ComingSoon
      eyebrow="Car Lab"
      title={`${team.name} car`}
      description="The 3D car viewer is not built yet. There is no model on this page."
      phase={getNavItem("/cars").phase}
      preview
      planned={[
        "Rotate, zoom and camera presets (front, rear, top, cockpit, technical)",
        "Hotspots: front wing, suspension, sidepods, floor, diffuser, rear wing, wheels, power unit area",
        "Exploded view with carefully sourced descriptions",
      ]}
      back={{ href: "/cars", label: "All cars" }}
    />
  );
}
