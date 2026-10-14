import { notFound } from "next/navigation";
import { CarViewer, type KeySpec } from "@/components/car/CarViewer";
import { CarTeamSwitch } from "@/components/car/CarTeamSwitch";
import { KeyValueList } from "@/components/data/key-value-list";
import { Badge, type Tone } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { loadSeasons } from "@/lib/drivers/load";
import { findTeamBySlug } from "@/lib/teams/registry";
import { REGULATION_SPECS, allSpecValues, specsFor, type SpecStatus, type SpecValue } from "@/lib/car/specs";
import { CAR_CONFIGS, carConfigFor, carDriversFor, DRIVER_NUMBERS_SOURCE } from "@/lib/car/teams";

export const dynamicParams = false;
export const generateStaticParams = () => CAR_CONFIGS.map((c) => ({ team: c.teamSlug }));

type Props = { params: Promise<{ team: string }> };

export async function generateMetadata({ params }: Props) {
  const team = findTeamBySlug((await params).team);
  return { title: team ? `${team.name} car` : "Car" };
}

const STATUS: Record<SpecStatus, { tone: Tone; label: string }> = {
  verified: { tone: "success", label: "Verified" },
  reported: { tone: "info", label: "Reported" },
  conflicting: { tone: "warning", label: "Sources differ" },
  unavailable: { tone: "neutral", label: "Not sourced" },
};

function SpecCell({ v }: { v: SpecValue }) {
  const s = STATUS[v.status];
  return (
    <span className="flex flex-wrap items-center gap-2 sm:justify-end">
      {v.value !== null ? (
        v.source ? (
          <a href={v.source.url} className="underline decoration-line-strong underline-offset-4 hover:text-accent-strong" title={v.note}>
            {v.value}
            {v.unit ? ` ${v.unit}` : ""}
          </a>
        ) : (
          <span>{v.value}</span>
        )
      ) : (
        <span className="text-subtle">Not available</span>
      )}
      <Badge tone={s.tone}>{s.label}</Badge>
    </span>
  );
}

export default async function CarPage({ params }: Props) {
  const team = findTeamBySlug((await params).team);
  const config = team && carConfigFor(team.slug);
  const specs = team && specsFor(team.slug);
  if (!team || !config || !specs) notFound();

  const notes = [...allSpecValues(specs), ...REGULATION_SPECS].filter((v) => v.note);
  const keySpecs: KeySpec[] = [
    { label: "Season", value: String(specs.season) },
    { label: specs.designation.label, value: specs.designation.value ?? "Not available", status: specs.designation.status },
    { label: specs.powerUnit.label, value: specs.powerUnit.value ?? "Not available", status: specs.powerUnit.status },
    { label: "Body", value: "Shared generic geometry" },
    { label: "Livery", value: "Team colours, approximated" },
  ];
  return (
    <PageContainer>
      <PageHeader
        eyebrow="Car · Showcase"
        title={`${team.name} car`}
        description={`APEX F1's shared procedural car in ${team.name} colours. The body is the same for every team; it is not ${team.name}'s ${specs.designation.value ?? "car"} and does not reproduce its real geometry.`}
        badges={
          <>
            <Badge tone="warning">Shared geometry, team colours</Badge>
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/cars/${team.slug}/lab`} size="sm" className="h-9">
              Open Car Lab
            </ButtonLink>
            <CarTeamSwitch current={team.slug} teams={CAR_CONFIGS.map((c) => ({ slug: c.teamSlug, name: findTeamBySlug(c.teamSlug)!.name }))} />
          </div>
        }
      />
      <CarViewer teamName={team.name} livery={config.livery} drivers={carDriversFor(team.slug, (await loadSeasons()).seasons)} keySpecs={keySpecs} />

      <section aria-labelledby="specs-heading" className="mt-8">
        <h2 id="specs-heading" className="mb-3 font-display text-2xl font-semibold tracking-[0.01em]">
          Specifications
        </h2>
        <div className="grid items-start gap-4 lg:grid-cols-2">
          <details open className="group rounded-lg border border-line bg-surface">
            <summary className="motion-interactive flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 hover:bg-surface-2">
              <h3 className="eyebrow">{specs.season} car specifications</h3>
              <span aria-hidden="true" className="text-subtle transition-transform group-open:rotate-180">⌄</span>
            </summary>
            <div className="border-t border-line px-5 py-4">
              <KeyValueList items={[specs.designation, specs.powerUnit, specs.transmission, specs.chassis, ...specs.dimensions].map((v) => ({ label: v.label, value: <SpecCell v={v} /> }))} />
              <p className="mt-4 text-xs leading-relaxed text-subtle">
                Only values with a named source are shown; everything else is marked not sourced rather than estimated. {specs.geometry.note}
              </p>
            </div>
          </details>
          <details open className="group rounded-lg border border-line bg-surface">
            <summary className="motion-interactive flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-4 hover:bg-surface-2">
              <h3 className="eyebrow">{REGULATION_SPECS[0].season} regulation limits (all teams)</h3>
              <span aria-hidden="true" className="text-subtle transition-transform group-open:rotate-180">⌄</span>
            </summary>
            <div className="border-t border-line px-5 py-4">
              <KeyValueList items={REGULATION_SPECS.map((v) => ({ label: v.label, value: <SpecCell v={v} /> }))} />
              <ul className="mt-4 flex flex-col gap-1 text-xs leading-relaxed text-subtle">
                {[...new Set(notes.map((v) => `${v.label}: ${v.note}`))].map((n) => (
                  <li key={n}>{n}</li>
                ))}
                <li>
                  Race numbers: <a className="underline underline-offset-4 hover:text-accent-strong" href={DRIVER_NUMBERS_SOURCE.url}>{DRIVER_NUMBERS_SOURCE.title}</a>.
                </li>
              </ul>
            </div>
          </details>
        </div>
      </section>
    </PageContainer>
  );
}
