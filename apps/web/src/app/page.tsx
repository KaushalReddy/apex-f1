import { CapabilityCard } from "@/components/data/capability-card";
import { CircuitCard } from "@/components/data/circuit-card";
import { DriverCard } from "@/components/data/driver-card";
import { KeyValueList } from "@/components/data/key-value-list";
import { StandingsPlaceholder } from "@/components/data/standings-placeholder";
import { TeamCard } from "@/components/data/team-card";
import { DemoBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { PageContainer } from "@/components/ui/page-container";
import { Panel } from "@/components/ui/panel";
import { SectionHeader } from "@/components/ui/section-header";
import { StatusDot } from "@/components/ui/status-dot";
import { DEMO_CIRCUITS, DEMO_DRIVERS, DEMO_TEAMS } from "@/domain/demo";
import { getNavItem } from "@/domain/navigation";

const CAPABILITIES = [
  { href: "/live", title: "Live Race" },
  { href: "/telemetry", title: "Telemetry Lab" },
  { href: "/replay", title: "Race Replay" },
  { href: "/strategy", title: "Strategy Intelligence" },
  { href: "/race-engineer", title: "AI Race Engineer" },
  { href: "/cars", title: "Car Lab" },
] as const;

function PreviewNote() {
  return (
    <span className="flex items-center gap-2">
      <DemoBadge />
      <InfoTip label="What does static preview mean?">
        Placeholder content so the layout can be reviewed. It is not live data and contains no results or statistics.
      </InfoTip>
    </span>
  );
}

export default function Home() {
  return (
    <>
      <section aria-labelledby="hero-heading" className="relative overflow-hidden border-b border-line">
        <svg
          aria-hidden="true"
          viewBox="0 0 680 320"
          fill="none"
          className="pointer-events-none absolute -right-24 top-6 hidden h-[26rem] w-auto text-line-strong opacity-60 md:block"
        >
          <path
            d="M40 220C40 120 140 60 240 90s160 100 230 30 130-80 170 0-40 140-160 130-180 50-280 20S40 300 40 220Z"
            stroke="currentColor"
            strokeWidth="14"
            strokeLinejoin="round"
          />
          <path
            d="M40 220C40 120 140 60 240 90s160 100 230 30 130-80 170 0-40 140-160 130-180 50-280 20S40 300 40 220Z"
            stroke="var(--color-bg)"
            strokeWidth="2"
            strokeDasharray="10 12"
          />
        </svg>
        <PageContainer className="relative grid gap-10 py-16 lg:grid-cols-[1.4fr_1fr] lg:py-24">
          <div>
            <p className="eyebrow">Independent F1 intelligence platform</p>
            <h1 id="hero-heading" className="mt-4 text-6xl font-semibold leading-none tracking-[0.06em] sm:text-7xl lg:text-8xl">
              APEX<span className="text-accent"> F1</span>
            </h1>
            <p className="mt-5 text-2xl font-medium tracking-tight text-fg sm:text-3xl">Experience every lap.</p>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">
              Real race data, interactive 3D circuits and race-engineer-grade analysis in one place. This is the Phase 1
              application shell: the structure and visual system are ready, and live data arrives in later phases.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/live">Open Live Race</ButtonLink>
              <ButtonLink href="/telemetry" variant="secondary">
                Explore Telemetry Lab
              </ButtonLink>
            </div>
          </div>
          <Panel as="section" aria-labelledby="status-heading" className="self-end">
            <h2 id="status-heading" className="eyebrow">
              Platform status
            </h2>
            <div className="mt-4">
              <KeyValueList
                items={[
                  { label: "Live session", value: <><StatusDot /> None</> },
                  { label: "Data connection", value: <><StatusDot tone="warning" /> Not connected</> },
                  { label: "Content", value: <><StatusDot tone="info" /> Static preview</> },
                ]}
              />
            </div>
            <p className="mt-4 text-xs leading-relaxed text-subtle">Data ingestion begins in Phase 2.</p>
          </Panel>
        </PageContainer>
      </section>

      <PageContainer className="space-y-20">
        <section aria-labelledby="season-heading">
          <SectionHeader id="season-heading" eyebrow="Season" title="Next race and championship" action={<PreviewNote />} />
          <div className="grid gap-4 lg:grid-cols-3">
            <Panel as="article" aria-labelledby="next-race-heading">
              <h3 id="next-race-heading" className="eyebrow">
                Next race
              </h3>
              <p className="mt-4 text-lg font-medium">Schedule not connected</p>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Race calendar, session times and countdown appear here once historical data ingestion is built.
              </p>
            </Panel>
            <Panel as="article" aria-labelledby="drivers-standings-heading">
              <h3 id="drivers-standings-heading" className="eyebrow">
                Drivers&apos; championship
              </h3>
              <div className="mt-2">
                <StandingsPlaceholder label="Drivers championship" />
              </div>
            </Panel>
            <Panel as="article" aria-labelledby="teams-standings-heading">
              <h3 id="teams-standings-heading" className="eyebrow">
                Constructors&apos; championship
              </h3>
              <div className="mt-2">
                <StandingsPlaceholder label="Constructors championship" />
              </div>
            </Panel>
          </div>
        </section>

        <section aria-labelledby="capabilities-heading">
          <SectionHeader
            id="capabilities-heading"
            eyebrow="Platform"
            title="Platform capabilities"
            description="Each area is planned and routed. The badge shows the roadmap phase in which it becomes real."
          />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {CAPABILITIES.map((c) => (
              <li key={c.href}>
                <CapabilityCard item={getNavItem(c.href)} title={c.title} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="drivers-heading">
          <SectionHeader
            id="drivers-heading"
            eyebrow="Drivers"
            title="Featured drivers"
            action={<PreviewNote />}
          />
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
            {DEMO_DRIVERS.map((d) => (
              <li key={d.slug}>
                <DriverCard driver={d} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="teams-heading">
          <SectionHeader id="teams-heading" eyebrow="Teams" title="Featured teams" action={<PreviewNote />} />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {DEMO_TEAMS.map((t) => (
              <li key={t.slug}>
                <TeamCard team={t} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="circuits-heading">
          <SectionHeader
            id="circuits-heading"
            eyebrow="Circuits"
            title="Circuits"
            description="The first 3D circuit is chosen after the OpenF1 spike results are reviewed."
            action={<PreviewNote />}
          />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {DEMO_CIRCUITS.map((c) => (
              <li key={c.slug}>
                <CircuitCard circuit={c} />
              </li>
            ))}
          </ul>
        </section>
      </PageContainer>
    </>
  );
}
