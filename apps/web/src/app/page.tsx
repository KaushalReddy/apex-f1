import Link from "next/link";
import { CapabilityCard } from "@/components/data/capability-card";
import { CARD_LINK, CardArrow } from "@/components/ui/card-arrow";
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
import { DEMO_DRIVERS, DEMO_TEAMS } from "@/domain/demo";
import { CIRCUITS } from "@/lib/circuit/catalog";
import { loadCircuitGeometry } from "@/lib/circuit/load";
import { circuitOutline } from "@/lib/circuit/outline";
import { getNavItem } from "@/domain/navigation";
import { loadSeasons } from "@/lib/drivers/load";
import { seasonStandings } from "@/lib/drivers/standings";

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

export default async function Home() {
  // Latest exported season's published standings (build time); null when no snapshot is present.
  const { seasons } = await loadSeasons();
  const top = seasons.length ? seasonStandings(seasons[0], seasons) : null;
  // The next 2026 races (by date), then the most recent ones, with their real layout outlines.
  const date26 = (c: (typeof CIRCUITS)[number]) => c.grandsPrix.find((g) => g.year === 2026)?.date ?? "";
  const upcoming = CIRCUITS.filter((c) => c.season2026 === "upcoming").sort((a, b) => date26(a).localeCompare(date26(b)));
  const recent = CIRCUITS.filter((c) => c.season2026 === "held").sort((a, b) => date26(b).localeCompare(date26(a)));
  const featured = await Promise.all(
    [...upcoming, ...recent].slice(0, 4).map(async (circuit) => {
      const g = await loadCircuitGeometry(circuit.id);
      return { circuit, outline: g.status === "ok" ? circuitOutline(g.geometry.points, g.geometry.closed) : null };
    }),
  );
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
                  {
                    label: "Championship data",
                    value: top ? <><StatusDot tone="success" /> Published standings · {top.season}</> : <><StatusDot tone="warning" /> Not available</>,
                  },
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
            {top ? (
              <Panel>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="eyebrow">Drivers&apos; championship {top.season}</h3>
                  <span className="text-xs text-subtle">{top.complete ? "Final" : `After round ${top.afterRound}`}</span>
                </div>
                <ol className="mt-3 divide-y divide-line text-sm tabular-nums">
                  {top.drivers.slice(0, 5).map((d) => (
                    <li key={d.acronym} className="flex items-center gap-3 py-2">
                      <span className="w-5 font-semibold text-muted">{d.position}</span>
                      <span aria-hidden="true" className="h-4 w-1 rounded-sm" style={{ backgroundColor: d.teamColour }} />
                      <span className="flex-1">
                        <span className="font-semibold">{d.acronym}</span> <span className="text-muted">{d.name}</span>
                      </span>
                      <span className="font-semibold">{d.points}</span>
                    </li>
                  ))}
                </ol>
                <div className="mt-4">
                  <ButtonLink href="/standings" variant="secondary" size="sm">
                    Full standings
                  </ButtonLink>
                </div>
              </Panel>
            ) : (
              <EmptyState
                title="Championship standings not available"
                status="Not available"
                statusTone="warning"
                action={
                  <ButtonLink href="/standings" variant="secondary" size="sm">
                    View standings status
                  </ButtonLink>
                }
              >
                No season results are in this build, so no positions or points are shown.
              </EmptyState>
            )}
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
          <SectionHeader
            id="drivers-heading"
            eyebrow="Drivers"
            title={top ? `Championship leaders · ${top.season}` : "Featured drivers"}
            action={top ? <ButtonLink href="/drivers" variant="secondary" size="sm">All drivers</ButtonLink> : <PreviewNote />}
          />
          <ul className="grid grid-cols-1 gap-4 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
            {top
              ? top.drivers.slice(0, 6).map((d) => (
                  <li key={d.acronym}>
                    <Link href={d.slug ? `/drivers/${d.slug}` : "/standings"} className={`${CARD_LINK} relative overflow-hidden pl-6`}>
                      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: d.teamColour }} />
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-display text-4xl font-semibold leading-none tracking-[0.04em] text-fg">{d.acronym}</p>
                        <CardArrow />
                      </div>
                      <p className="mt-4 text-base font-medium">{d.name}</p>
                      <p className="mt-1 text-sm text-muted">{d.team ?? "—"}</p>
                      <p className="mt-2 text-sm font-medium tabular-nums">
                        P{d.position} · {d.points} pts
                      </p>
                    </Link>
                  </li>
                ))
              : DEMO_DRIVERS.map((d) => (
                  <li key={d.slug}>
                    <DriverCard driver={d} />
                  </li>
                ))}
          </ul>
        </section>

        <section aria-labelledby="teams-heading">
          <SectionHeader
            id="teams-heading"
            eyebrow="Teams"
            title={top?.teams ? `Constructors' leaders · ${top.season}` : "Featured teams"}
            action={top?.teams ? <ButtonLink href="/teams" variant="secondary" size="sm">All teams</ButtonLink> : <PreviewNote />}
          />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {top?.teams
              ? top.teams.slice(0, 4).map((t) => (
                  <li key={t.team}>
                    <Link href={t.teamSlug ? `/teams/${t.teamSlug}` : "/standings"} className={`${CARD_LINK} relative overflow-hidden pl-6`}>
                      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: t.teamColour }} />
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-base font-medium">{t.team}</p>
                        <CardArrow />
                      </div>
                      <p className="mt-2 text-sm font-medium tabular-nums">
                        P{t.position} · {t.points} pts{t.wins ? ` · ${t.wins} win${t.wins === 1 ? "" : "s"}` : ""}
                      </p>
                    </Link>
                  </li>
                ))
              : DEMO_TEAMS.map((t) => (
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
            description="Next on the 2026 calendar, each with an interactive 3D layout reconstructed from real car-position data."
            action={
              <ButtonLink href="/circuits" variant="secondary" size="sm">
                All {CIRCUITS.length} circuits
              </ButtonLink>
            }
          />
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map(({ circuit, outline }) => (
              <li key={circuit.id}>
                <CircuitCard circuit={circuit} outline={outline} />
              </li>
            ))}
          </ul>
        </section>
      </PageContainer>
    </>
  );
}
