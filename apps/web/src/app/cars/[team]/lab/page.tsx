import { notFound } from "next/navigation";
import { CarLab } from "@/components/car/CarLab";
import { CarTeamSwitch } from "@/components/car/CarTeamSwitch";
import { loadSeasons } from "@/lib/drivers/load";
import { findTeamBySlug } from "@/lib/teams/registry";
import { specsFor } from "@/lib/car/specs";
import { CAR_CONFIGS, carConfigFor, carDriversFor } from "@/lib/car/teams";

export const dynamicParams = false;
export const generateStaticParams = () => CAR_CONFIGS.map((c) => ({ team: c.teamSlug }));

type Props = { params: Promise<{ team: string }> };

export async function generateMetadata({ params }: Props) {
  const team = findTeamBySlug((await params).team);
  return {
    title: team ? `${team.name} Car Lab` : "Car Lab",
    description: team ? `APEX F1's shared procedural car in ${team.name} colours: inspect components, airflow, wing setups and 2D CFD results.` : undefined,
  };
}

/** The Car Lab is a full-window experience (see CarLab); "Exit" returns to the previous page or this car's showcase page. */
export default async function CarLabPage({ params }: Props) {
  const team = findTeamBySlug((await params).team);
  const config = team && carConfigFor(team.slug);
  const specs = team && specsFor(team.slug);
  if (!team || !config || !specs) notFound();

  return (
    <CarLab
      teamName={team.name}
      designation={specs.designation.value}
      season={specs.season}
      livery={config.livery}
      number={carDriversFor(team.slug, (await loadSeasons()).seasons).find((d) => d.number !== undefined)?.number}
      componentSpecs={specs.components}
      exitHref={`/cars/${team.slug}`}
      teamSwitch={<CarTeamSwitch lab current={team.slug} teams={CAR_CONFIGS.map((c) => ({ slug: c.teamSlug, name: findTeamBySlug(c.teamSlug)!.name }))} />}
      keySpecs={[
        { label: specs.designation.label, value: specs.designation.value ?? "Not available", status: specs.designation.status },
        { label: specs.powerUnit.label, value: specs.powerUnit.value ?? "Not available", status: specs.powerUnit.status },
        { label: specs.transmission.label, value: specs.transmission.value ?? "Not available", status: specs.transmission.status },
        { label: "Body", value: `Shared generic geometry, ${specs.season} colours` },
      ]}
    />
  );
}
