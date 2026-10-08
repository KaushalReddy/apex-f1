import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/ui/coming-soon";
import { DEMO_TEAMS, driversOf, findTeam } from "@/domain/demo";
import { getNavItem } from "@/domain/navigation";

export const dynamicParams = false;
export const generateStaticParams = () => DEMO_TEAMS.map((t) => ({ team: t.slug }));

type Props = { params: Promise<{ team: string }> };

export async function generateMetadata({ params }: Props) {
  const team = findTeam((await params).team);
  return { title: team?.name ?? "Team" };
}

export default async function TeamPage({ params }: Props) {
  const team = findTeam((await params).team);
  if (!team) notFound();
  return (
    <ComingSoon
      eyebrow={`Team · ${driversOf(team.slug).map((d) => d.code).join(" / ")}`}
      title={team.name}
      description="The full team profile is not built yet. Only the name and line-up are shown, as a static preview."
      phase={getNavItem("/teams").phase}
      preview
      planned={[
        "Constructor standing, points, wins and podiums",
        "Race and qualifying results",
        "Team history and sourced technical information",
      ]}
      back={{ href: "/teams", label: "All teams" }}
    />
  );
}
