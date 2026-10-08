import { notFound } from "next/navigation";
import { ComingSoon } from "@/components/ui/coming-soon";
import { DEMO_DRIVERS, findDriver, findTeam } from "@/domain/demo";
import { getNavItem } from "@/domain/navigation";

export const dynamicParams = false;
export const generateStaticParams = () => DEMO_DRIVERS.map((d) => ({ driver: d.slug }));

type Props = { params: Promise<{ driver: string }> };

export async function generateMetadata({ params }: Props) {
  const driver = findDriver((await params).driver);
  return { title: driver?.name ?? "Driver" };
}

export default async function DriverPage({ params }: Props) {
  const driver = findDriver((await params).driver);
  if (!driver) notFound();
  const team = findTeam(driver.teamSlug);
  return (
    <ComingSoon
      eyebrow={`Driver · ${driver.code}${team ? ` · ${team.name}` : ""}`}
      title={driver.name}
      description="The full profile is not built yet. Only the name, code and team are shown, as a static preview."
      phase={getNavItem("/drivers").phase}
      preview
      planned={[
        "Championship position, points, wins, podiums and poles",
        "Race and qualifying results, recent form",
        "Teammate comparison",
        "Follow driver in the live 3D race",
      ]}
      back={{ href: "/drivers", label: "All drivers" }}
    />
  );
}
