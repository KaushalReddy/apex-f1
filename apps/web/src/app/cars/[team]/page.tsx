import { notFound } from "next/navigation";
import Link from "next/link";
import { CarViewer, type KeySpec } from "@/components/car/CarViewer";
import { TeamMarker } from "@/components/data/team-marker";
import { KeyValueList } from "@/components/data/key-value-list";
import { Badge, type Tone } from "@/components/ui/badge";
import { PageContainer } from "@/components/ui/page-container";
import { PageHeader } from "@/components/ui/page-header";
import { DEMO_TEAMS, findTeam } from "@/domain/demo";
import { cn } from "@/lib/cn";
import { REGULATION_SPECS, allSpecValues, specsFor, type SpecStatus, type SpecValue } from "@/lib/car/specs";
import { carConfigFor, carDriversOf, DRIVER_NUMBERS_SOURCE } from "@/lib/car/teams";

export const dynamicParams = false;
export const generateStaticParams = () => DEMO_TEAMS.map((t) => ({ team: t.slug }));

type Props = { params: Promise<{ team: string }> };

export async function generateMetadata({ params }: Props) {
  const team = findTeam((await params).team);
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
  const team = findTeam((await params).team);
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
        eyebrow="Car Lab · Foundation viewer"
        title={`${team.name} car`}
        description={`APEX F1's shared procedural car in ${team.name} colours. The body is the same for every team; it is not ${team.name}'s ${specs.designation.value ?? "car"} and does not reproduce its real geometry.`}
        badges={
          <>
            <Badge tone="info">Phase 4 foundation</Badge>
            <Badge tone="warning">Shared geometry, team colours</Badge>
          </>
        }
        actions={
          <nav aria-label="Team cars" className="flex flex-wrap gap-2">
            {DEMO_TEAMS.map((t) => (
              <Link
                key={t.slug}
                href={`/cars/${t.slug}`}
                aria-current={t.slug === team.slug ? "page" : undefined}
                className={cn(
                  "motion-interactive inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm font-medium",
                  t.slug === team.slug ? "border-accent/70 bg-surface-2 text-fg" : "border-line text-muted hover:border-line-strong hover:text-fg",
                )}
              >
                <TeamMarker color={t.color} />
                {t.name}
              </Link>
            ))}
          </nav>
        }
      />
      <CarViewer teamName={team.name} livery={config.livery} drivers={carDriversOf(team.slug)} keySpecs={keySpecs} />

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
