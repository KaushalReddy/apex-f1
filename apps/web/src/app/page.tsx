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
import { DEMO_DRIVERS, DEMO_TEAMS } from "@/domain/demo";
import { CIRCUITS } from "@/lib/circuit/catalog";
import { availableGeometrySlugs, loadCircuitGeometry } from "@/lib/circuit/load";
import { circuitByShortName } from "@/lib/circuit/catalog";
import { loadReplayIndex } from "@/lib/replay/load";
import { NextSessionCountdown } from "@/components/live/NextSession";
import { circuitOutline } from "@/lib/circuit/outline";
import { getNavItem } from "@/domain/navigation";
import { loadSeasons } from "@/lib/drivers/load";
import { seasonStandings } from "@/lib/drivers/standings";

// Race data can change after the build (tools/openf1-sync writes DATA_DIR): rebuilt in the background at most every 15 minutes, and at once
// when the sync worker calls /api/revalidate.
export const revalidate = 900;

const TOOLS = ["/replay", "/telemetry", "/strategy", "/race-engineer", "/cars"] as const;

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

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** The hero's cards: the panel look, translucent so the circuit behind them stays visible. */
const GLASS = "rounded-lg border border-white/10 bg-surface/65 p-5 shadow-2 backdrop-blur-md sm:p-6";

export default async function Home() {
  // Latest season's published results and standings (synced or bundled); null when no snapshot is present.
  const { seasons } = await loadSeasons();
  const top = seasons.length ? seasonStandings(seasons[0], seasons) : null;
  // The latest classified race of that season, its podium as published, and whether it can be replayed in 3D.
  const latest = seasons.length ? [...seasons[0].events].filter((e) => e.race.results.length).sort((x, y) => y.date.localeCompare(x.date))[0] : undefined;
  const podium = latest ? latest.race.results.filter((r) => r.position != null && r.position <= 3).sort((x, y) => x.position! - y.position!) : [];
  const colourOf = new Map(top?.drivers.map((d) => [d.acronym, d.teamColour]) ?? []);
  const layouts = await availableGeometrySlugs();
  const replays = await loadReplayIndex();
  const playable = (r: (typeof replays)[number]) => {
    const c = r.circuitShortName ? circuitByShortName(r.circuitShortName) : undefined;
    return !!c && layouts.has(c.id);
  };
  const latestReplay = replays.find(playable);
  const latestRaceReplay = latest ? replays.find((r) => r.sessionKey === latest.race.sessionKey && playable(r)) : undefined;
  // The next 2026 races by today's date (race day included; the page refreshes every 15 min, so it moves on by itself after each race),
  // then the most recent ones, with their real layout outlines. Races called off are left out.
  const today = new Date().toISOString().slice(0, 10);
  const date26 = (c: (typeof CIRCUITS)[number]) => c.grandsPrix.find((g) => g.year === 2026)?.date ?? "";
  const on26 = CIRCUITS.filter((c) => date26(c) && c.season2026 !== "not-held");
  const upcoming = on26.filter((c) => date26(c) >= today).sort((a, b) => date26(a).localeCompare(date26(b)));
  const recent = on26.filter((c) => date26(c) < today).sort((a, b) => date26(b).localeCompare(date26(a)));
  const featured = await Promise.all(
    [...upcoming, ...recent].slice(0, 4).map(async (circuit) => {
      const g = await loadCircuitGeometry(circuit.id);
      return { circuit, outline: g.status === "ok" ? circuitOutline(g.geometry.points, g.geometry.closed) : null };
    }),
  );
  const nextGeometry = upcoming[0] ? await loadCircuitGeometry(upcoming[0].id) : null;
  const nextOutline = nextGeometry?.status === "ok" ? circuitOutline(nextGeometry.geometry.points, nextGeometry.geometry.closed, 1000, 400, 40) : null;
  const hero = nextOutline
    ? { d: nextOutline.d, viewBox: `0 0 ${nextOutline.size} ${nextOutline.size}`, width: 14 }
    : { d: "M40 220C40 120 140 60 240 90s160 100 230 30 130-80 170 0-40 140-160 130-180 50-280 20S40 300 40 220Z", viewBox: "0 0 680 320", width: 8 };
  return (
    <>
      <section aria-labelledby="hero-heading" className="relative overflow-hidden border-b border-line">
        {/* The next race's real layout (same centerline data as the 3D view; the abstract line art when none is scheduled), with a
            marker lapping it. Decorative: the countdown card names the race. */}
        <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 hidden w-[58%] md:block">
          <div className="absolute inset-0 bg-[radial-gradient(closest-side,rgb(240_68_68/0.14),transparent)]" />
          <svg viewBox={hero.viewBox} fill="none" className="absolute left-[46%] top-1/2 h-[112%] w-auto max-w-none -translate-x-1/2 -translate-y-1/2">
            <path d={hero.d} stroke="rgb(255 255 255 / 0.13)" strokeWidth={hero.width * 3} strokeLinejoin="round" strokeLinecap="round" />
            <path d={hero.d} stroke="rgb(255 255 255 / 0.4)" strokeWidth={hero.width * 0.25} strokeDasharray={`${hero.width} ${hero.width * 1.4}`} strokeLinejoin="round" />
            <path
              d={hero.d}
              pathLength={100}
              stroke="var(--color-accent)"
              strokeWidth={hero.width * 0.7}
              strokeLinecap="round"
              strokeDasharray="5 95"
              className="drop-shadow-[0_0_10px_rgb(240_68_68/0.8)] motion-safe:animate-lap"
            />
          </svg>
        </div>
        <PageContainer className="relative grid gap-12 py-16 lg:grid-cols-[1.4fr_1fr] lg:py-24">
          <div>
            <p className="eyebrow flex items-center">
              <SectionMarker />
              Independent Formula 1 race intelligence
            </p>
            <h1 id="hero-heading" className="mt-5 font-display text-7xl font-semibold leading-[0.9] tracking-[0.04em] sm:text-8xl lg:text-9xl">
              APEX<span className="text-accent"> F1</span>
            </h1>
            <p className="mt-6 font-display text-3xl font-semibold tracking-[0.02em] text-fg sm:text-4xl">Experience every lap.</p>
            <p className="mt-5 max-w-xl text-base leading-relaxed text-muted">
              Every car, every lap, on the real circuit. Replay a Grand Prix in 3D, lay two drivers&apos; laps over each other, follow the tyre
              strategy, and ask the race engineer why the order changed. Built on OpenF1 timing data.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <ButtonLink href={latestReplay ? `/replay/${latestReplay.sessionKey}` : "/replay"}>{latestReplay ? "Watch the latest race" : "Race replays"}</ButtonLink>
              <ButtonLink href="/circuits" variant="secondary">
                Explore the circuits
              </ButtonLink>
            </div>
          </div>
          <div className="flex flex-col gap-4 self-end">
          <section aria-labelledby="status-heading" className={GLASS}>
            <h2 id="status-heading" className="eyebrow flex items-center">
              <SectionMarker />
              Race desk
            </h2>
            <div className="mt-4">
              <KeyValueList
                items={[
                  {
                    label: "Latest race",
                    value: latest ? (
                      <>
                        {latest.name} · {day(latest.date)}
                      </>
                    ) : (
                      <span className="text-muted">No results yet</span>
                    ),
                  },
                  {
                    label: "Championship leader",
                    value: top?.drivers[0] ? (
                      <span className="inline-flex items-center gap-2">
                        <span aria-hidden="true" className="h-4 w-1 rounded-sm" style={{ backgroundColor: top.drivers[0].teamColour }} />
                        <Link href={`/drivers/${top.drivers[0].slug}`} className="font-semibold hover:text-accent-strong">
                          {top.drivers[0].name}
                        </Link>
                        <span className="text-muted tabular-nums">{top.drivers[0].points} pts</span>
                      </span>
                    ) : (
                      <span className="text-muted">Not available</span>
                    ),
                  },
                  {
                    label: "Championship",
                    value: top ? <>{top.complete ? `${top.season} · final` : `${top.season} · after round ${top.afterRound}`}</> : <span className="text-muted">Not available</span>,
                  },
                ]}
              />
            </div>
          </section>
          </div>
        </PageContainer>
      </section>

      <PageContainer className="space-y-20">
        <section aria-labelledby="season-heading">
          <SectionHeader id="season-heading" eyebrow={top ? `Season ${top.season}` : "Season"} title="The season so far" />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <section aria-labelledby="countdown-heading" className="relative rounded-lg border border-line bg-surface p-5 md:col-span-2 sm:p-6 xl:col-span-1">
              {nextOutline && (
                // The next race's layout, so the card shows where the countdown leads (decorative: the card names the event).
                <svg aria-hidden="true" viewBox={`0 0 ${nextOutline.size} ${nextOutline.size}`} fill="none" className="absolute right-4 top-4 size-24 sm:right-5 sm:top-5 sm:size-28">
                  <path d={nextOutline.d} stroke="rgb(255 255 255 / 0.55)" strokeWidth="34" strokeLinejoin="round" />
                  <path
                    d={nextOutline.d}
                    pathLength={100}
                    stroke="var(--color-accent)"
                    strokeWidth="44"
                    strokeLinecap="round"
                    strokeDasharray="6 94"
                    className="drop-shadow-[0_0_6px_rgb(240_68_68/0.9)] motion-safe:animate-lap"
                  />
                </svg>
              )}
              <h3 id="countdown-heading" className="eyebrow">
                Next race
              </h3>
              <NextSessionCountdown />
            </section>
            {latest && podium.length ? (
              <Panel>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="eyebrow">Latest race · round {latest.round}</h3>
                  <span className="text-xs text-subtle">{day(latest.date)}</span>
                </div>
                <p className="mt-2 font-display text-2xl font-semibold tracking-[0.01em]">{latest.name}</p>
                <ol className="mt-3 divide-y divide-line text-sm tabular-nums" aria-label="Podium">
                  {podium.map((r) => (
                    <li key={r.acronym} className="flex items-center gap-3 py-2">
                      <span className="w-5 font-semibold text-muted">{r.position}</span>
                      <span aria-hidden="true" className="h-4 w-1 rounded-sm" style={{ backgroundColor: colourOf.get(r.acronym) ?? "var(--color-line-strong)" }} />
                      <span className="flex-1">
                        <span className="font-semibold">{r.acronym}</span> <span className="text-muted">{r.team ?? ""}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="mt-4 flex flex-wrap gap-2">
                  {latestRaceReplay && (
                    <ButtonLink href={`/replay/${latestRaceReplay.sessionKey}`} size="sm">
                      Replay the race
                    </ButtonLink>
                  )}
                  {latestRaceReplay && (
                    <ButtonLink href={`/strategy?session=${latestRaceReplay.sessionKey}`} variant="secondary" size="sm">
                      Tyre strategy
                    </ButtonLink>
                  )}
                </div>
              </Panel>
            ) : (
              <EmptyState title="No race results yet" status="Not available" statusTone="warning">
                The latest race appears here once its official classification is published.
              </EmptyState>
            )}
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
                    Standings
                  </ButtonLink>
                }
              >
                No season results are available yet, so no positions or points are shown.
              </EmptyState>
            )}
          </div>
        </section>

        <section aria-labelledby="tools-heading">
          <SectionHeader id="tools-heading" eyebrow="Tools" title="Inside APEX F1" />
          <ul className="border-b border-line">
            {TOOLS.map((href) => (
              <li key={href}>
                <CapabilityCard item={getNavItem(href)} title={href === "/cars" ? "Car Lab" : href === "/race-engineer" ? "AI Race Engineer" : undefined} />
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
            title="Next on the calendar"
            description="Each layout rebuilt in 3D from real car-position data: explore it, or watch a simulated race on it."
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
