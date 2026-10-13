import { CapabilityCard } from "@/components/data/capability-card";
import { CircuitCard } from "@/components/data/circuit-card";
import { DriverCard } from "@/components/data/driver-card";
import { KeyValueList } from "@/components/data/key-value-list";
import { TeamCard } from "@/components/data/team-card";
import { DemoBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { InfoTip } from "@/components/ui/info-tip";
import { PageContainer } from "@/components/ui/page-container";
import { Panel } from "@/components/ui/panel";
import { SectionHeader, SectionMarker } from "@/components/ui/section-header";
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
        {/* Abstract decorative line art (not a real circuit and not the 3D circuit engine). */}
        <svg
          aria-hidden="true"
          viewBox="0 0 680 320"
          fill="none"
          className="pointer-events-none absolute -right-24 top-6 hidden h-[26rem] w-auto text-line-strong opacity-40 md:block"
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
        <PageContainer className="relative grid gap-12 py-16 lg:grid-cols-[1.4fr_1fr] lg:py-24">
          <div>
            <p className="eyebrow flex items-center">
              <SectionMarker />
              Independent F1 intelligence platform
            </p>
            <h1 id="hero-heading" className="mt-5 font-display text-7xl font-semibold leading-[0.9] tracking-[0.04em] sm:text-8xl lg:text-9xl">
              APEX<span className="text-accent"> F1</span>
            </h1>
            <p className="mt-6 font-display text-3xl font-semibold tracking-[0.02em] text-fg sm:text-4xl">Experience every lap.</p>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">
              Race data, interactive circuits and engineer-grade analysis in one place. Circuit exploration and a replay table view are working;
              live timing, telemetry and strategy tools are still being built and are marked as such.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href="/circuits">Explore circuits</ButtonLink>
              <ButtonLink href="/analysis" variant="secondary">
                See analysis tools
              </ButtonLink>
            </div>
          </div>
          <Panel as="section" aria-labelledby="status-heading" className="self-end">
            <h2 id="status-heading" className="eyebrow flex items-center">
              <SectionMarker />
              Platform status
            </h2>
            <div className="mt-4">
              <KeyValueList
                items={[
                  { label: "Live session", value: <><StatusDot /> None</> },
                  { label: "Replay", value: <><StatusDot tone="success" /> Table view</> },
                  { label: "Championship data", value: <><StatusDot tone="warning" /> Not connected</> },
                  { label: "Other content", value: <><StatusDot tone="info" /> Static preview</> },
                ]}
              />
            </div>
          </Panel>
        </PageContainer>
      </section>

      <PageContainer className="space-y-20">
        <section aria-labelledby="season-heading">
          <SectionHeader id="season-heading" eyebrow="Season" title="Next race and championship" />
          <div className="grid gap-4 lg:grid-cols-2">
            <EmptyState title="Race calendar not connected" status="Not available" statusTone="warning">
              Session times and a countdown will appear here once a schedule provider is connected. Nothing is estimated in the meantime.
            </EmptyState>
            <EmptyState
              title="Championship standings not connected"
              status="Not available"
              statusTone="warning"
              action={
                <ButtonLink href="/standings" variant="secondary" size="sm">
                  View standings status
                </ButtonLink>
              }
            >
              Driver and constructor tables are planned. No positions or points are shown until real data exists.
            </EmptyState>
          </div>
        </section>

        <section aria-labelledby="capabilities-heading">
          <SectionHeader
            id="capabilities-heading"
            eyebrow="Platform"
            title="Platform capabilities"
            description="Every area has a place in the product. The badge shows the roadmap phase in which it becomes real."
          />
          <ul className="border-b border-line">
            {CAPABILITIES.map((c, i) => (
              <li key={c.href}>
                <CapabilityCard item={getNavItem(c.href)} title={c.title} index={i + 1} />
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="drivers-heading">
          <SectionHeader id="drivers-heading" eyebrow="Drivers" title="Featured drivers" action={<PreviewNote />} />
          <ul className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
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
            description="Circuit pages show an interactive 3D layout wherever geometry has been generated from OpenF1 data."
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
