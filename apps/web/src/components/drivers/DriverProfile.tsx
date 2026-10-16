"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { SectionMarker } from "@/components/ui/section-header";
import { cn } from "@/lib/cn";
import type { Profile } from "@/lib/drivers/views";
import { Chart, SERIES_A, Stat } from "./charts";

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const one = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const signed = (v: number | null) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}`);

/** Driver profile. The season switcher drives every figure, chart and table on the page from one season's data at a time. */
export function DriverProfile({ profile }: { profile: Profile }) {
  const { ref, seasons, dataset } = profile;
  const [season, setSeason] = useState(seasons[0].meta.season);
  const p = seasons.find((s) => s.meta.season === season) ?? seasons[0];
  const st = p.stats;
  // Axis labels are event country codes: round numbers alone can mislead when a scheduled race has no published classification.
  const labels = p.rounds.map((r) => r.countryCode ?? `R${r.round}`);
  const names = p.rounds.map((r) => r.name.replace(" Grand Prix", " GP"));
  const partial = !p.meta.complete;

  return (
    <div>
      {/* Hero: identity first. */}
      <header className="relative mb-6 overflow-hidden border-b border-line pb-6 pl-5">
        <span aria-hidden="true" className="absolute bottom-6 left-0 top-0 w-1 rounded-sm" style={{ backgroundColor: p.teamColour }} />
        <p className="eyebrow flex items-center">
          <SectionMarker />
          Driver
        </p>
        <div className="mt-2 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-baseline gap-4">
              <span className="font-display text-5xl font-semibold leading-none tracking-[0.04em] sm:text-6xl">{ref.acronym}</span>
              {st.number != null && <span className="font-display text-3xl font-semibold leading-none text-muted sm:text-4xl">#{st.number}</span>}
            </div>
            <h1 className="mt-2 font-display text-3xl font-semibold leading-tight tracking-[0.01em] sm:text-4xl">{ref.name}</h1>
            <p className="mt-1 text-sm text-muted">
              {p.teamSlug ? (
                <Link href={`/teams/${p.teamSlug}`} className="underline decoration-line-strong underline-offset-4 hover:text-accent-strong">
                  {p.team}
                </Link>
              ) : (
                (p.team ?? "Team not published")
              )}
              {ref.countryCode && <span> · {ref.countryCode}</span>}
              <span>
                {" "}
                · {season} season{st.championship?.position != null ? ` · P${st.championship.position} in the championship` : ""}
                {partial && st.championship ? " so far" : ""}
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/drivers/compare?season=${season}&a=${ref.slug}`} size="sm" variant="secondary">
              Compare
            </ButtonLink>
            <ButtonLink href={`/telemetry?a=${ref.acronym}`} size="sm" variant="secondary" title="This driver's fastest lap in their latest exported session, against the fastest rival">
              Lap telemetry
            </ButtonLink>
            {p.teamSlug && (
              <ButtonLink href={`/cars/${p.teamSlug}`} size="sm" variant="secondary">
                {p.team} car
              </ButtonLink>
            )}
            {profile.inRaceDemo && (
              <ButtonLink href={`/circuits/monaco/race?driver=${ref.slug}`} size="sm" variant="secondary" title="Opens the simulated demo race with this driver selected">
                Race view (demo)
              </ButtonLink>
            )}
          </div>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Season" className="flex flex-wrap gap-1.5">
          {seasons.map((s) => (
            <button
              key={s.meta.season}
              type="button"
              role="radio"
              aria-checked={s.meta.season === season}
              onClick={() => setSeason(s.meta.season)}
              className={cn(
                "motion-interactive h-9 rounded-md border px-3 text-sm font-medium tabular-nums",
                s.meta.season === season ? "border-accent/70 bg-surface-2 text-fg" : "border-line text-muted hover:border-line-strong hover:text-fg",
              )}
            >
              {s.meta.season}
            </button>
          ))}
        </div>
        <p className="text-xs text-subtle">
          {partial ? `${season}: ${p.meta.eventsInSnapshot} races so far (${p.meta.scheduledRaces} scheduled)` : `${season} season, ${p.meta.eventsInSnapshot} races`} · {p.meta.source}{" "}
          classifications and published standings, fetched {p.meta.fetchedOn}
          {p.meta.skipped.length > 0 && ` · no classification published for ${p.meta.skipped.map((s) => `${s.name} (${s.date})`).join(" and ")}`}
        </p>
      </div>

      <section aria-labelledby="season-heading">
        <h2 id="season-heading" className="sr-only">
          {season} season
        </h2>
        <dl className="grid grid-cols-2 overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4 lg:grid-cols-8" style={{ gap: 1 }}>
          <Stat
            label="Championship"
            value={st.championship?.position != null ? `P${st.championship.position}` : "—"}
            hint={st.championship ? `${st.championship.points ?? "—"} pts · published standings` : "Not published"}
          />
          <Stat label="Wins" value={st.wins} />
          <Stat label="Podiums" value={st.podiums} />
          <Stat label="Qualifying P1" value={st.qualifyingP1} hint="Fastest in qualifying" />
          <Stat label="Starts" value={st.starts} hint={`${st.entries} of ${st.eventsInSnapshot} races entered`} />
          <Stat label="Finish rate" value={pct(st.finishRate)} hint={`${st.dnf} DNF · ${st.dsq} DSQ · ${st.nc} NC · ${st.dns} DNS`} />
          <Stat label="Avg finish" value={one(st.averageFinish)} hint="Classified finishes only" />
          <Stat label="Points / start" value={one(st.pointsPerStart)} hint={`${st.racePoints} race + ${st.sprintPoints} sprint`} />
        </dl>
      </section>

      <section aria-labelledby="trends-heading" className="mt-6">
        <h2 id="trends-heading" className="mb-3 font-display text-2xl font-semibold tracking-[0.01em]">
          Season trends
        </h2>
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          <Chart
            title="Championship points"
            summary={`Published championship points after each round of ${season}${p.progression.some((x) => x.points == null) ? "; rounds without a published standing are gaps" : ""}.`}
            xLabels={labels}
            xNames={names}
            valueLabel="points"
            series={[{ id: "pts", label: ref.acronym, color: SERIES_A, values: p.progression.map((x) => x.points) }]}
          />
          <Chart
            title="Race finishing position"
            summary="Finishing position per race (P1 at the top). Crosses in the bottom band are races without a classified finish; absent rounds are blank."
            xLabels={labels}
            xNames={names}
            valueLabel="finish"
            invert
            connect={false}
            yDomain={[1, Math.max(20, ...p.trend.map((t) => t.position ?? 0))]}
            series={[
              {
                id: "fin",
                label: ref.acronym,
                color: SERIES_A,
                values: p.trend.map((t) => t.position),
                notes: p.trend.map((t) => (t.status === "FIN" || t.status === "ABSENT" ? null : t.status)),
              },
            ]}
          />
          <div className="lg:col-span-2 2xl:col-span-1">
            <Chart
              title="Qualifying vs race finish"
              summary={`Qualifying position (hollow) and finishing position (filled) for the ${p.qualiVsRace.length} races with both. Qualifying is not the starting grid (penalties can move it) and is not a measure of race pace. Average change: ${signed(st.positionsGainedVsQualifying)} positions.`}
              xLabels={p.qualiVsRace.map((x) => x.code)}
              xNames={p.qualiVsRace.map((x) => x.name.replace(" Grand Prix", " GP"))}
              valueLabel="position"
              invert
              dumbbell
              yDomain={[1, 20]}
              series={[
                { id: "q", label: "Qualifying", color: SERIES_A, values: p.qualiVsRace.map((x) => x.qualifying) },
                { id: "r", label: "Race finish", color: SERIES_A, values: p.qualiVsRace.map((x) => x.finish) },
              ]}
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="results-heading" className="mt-6">
        <h2 id="results-heading" className="mb-3 font-display text-2xl font-semibold tracking-[0.01em]">
          {season} results
        </h2>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[34rem] text-left text-sm tabular-nums">
            <caption className="sr-only">
              {ref.name}, {season} race results
            </caption>
            <thead className="border-b border-line text-[11px] uppercase tracking-wider text-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Rd</th>
                <th scope="col" className="px-3 py-2 font-medium">Grand Prix</th>
                <th scope="col" className="px-3 py-2 font-medium">Qualifying</th>
                <th scope="col" className="px-3 py-2 font-medium">Race</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Points</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...p.rounds].reverse().map((r) => (
                <tr key={r.round} className={cn(!r.race && "text-subtle")}>
                  <td className="px-3 py-1.5 text-muted">{r.round}</td>
                  <td className="px-3 py-1.5">
                    {r.circuitSlug ? (
                      <Link href={`/circuits/${r.circuitSlug}`} className="underline decoration-line-strong underline-offset-4 hover:text-accent-strong">
                        {r.name}
                      </Link>
                    ) : (
                      r.name
                    )}
                    <span className="ml-2 text-xs text-subtle">{r.date}</span>
                  </td>
                  <td className="px-3 py-1.5">{r.qualifyingPosition != null ? `P${r.qualifyingPosition}` : "—"}</td>
                  <td className="px-3 py-1.5">
                    {!r.race ? (
                      <span>Did not take part</span>
                    ) : r.race.status === "FIN" ? (
                      <span className={cn(r.race.position === 1 && "font-semibold text-warning")}>P{r.race.position}</span>
                    ) : (
                      <Badge tone={r.race.status === "DSQ" ? "danger" : "neutral"}>{r.race.status}</Badge>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    {r.race ? (r.race.points ?? 0) + (r.sprint?.points ?? 0) : "—"}
                    {r.sprint?.points ? <span className="ml-1 text-xs text-subtle">({r.sprint.points} sprint)</span> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="dataset-heading" className="mt-6 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-line bg-surface p-4">
          <h2 id="dataset-heading" className="eyebrow">
            In this dataset · {dataset.seasons.length > 1 ? `${Math.min(...dataset.seasons)}–${Math.max(...dataset.seasons)}` : dataset.seasons[0]}
          </h2>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm tabular-nums sm:grid-cols-5">
            {[
              ["Starts", dataset.starts],
              ["Wins", dataset.wins],
              ["Podiums", dataset.podiums],
              ["Qualifying P1", dataset.qualifyingP1],
              ["Points", dataset.points],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] uppercase tracking-wider text-subtle">{k}</dt>
                <dd className="font-display text-xl font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">Teams: {dataset.teams.join(", ") || "—"}</p>
          <p className="mt-2 text-xs leading-relaxed text-subtle">
            Totals over the seasons exported into APEX F1 only. They are not career totals: championship titles, career starts, wins and fastest laps
            before these seasons are not in the dataset, so they are not shown.
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4 text-xs leading-relaxed text-muted">
          <h2 className="eyebrow">How these figures are made</h2>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>Positions, points and statuses are {p.meta.source}&apos;s published classifications; championship position and points are the published standings.</li>
            <li>Derived: a start is any race entry except DNS; average finish counts classified finishes only (a DNF is not treated as last).</li>
            <li>Qualifying P1 is the qualifying classification, not the starting grid. Sprint points count towards points, not towards wins or podiums.</li>
            <li>A round with no result is shown as not taking part, never as a zero-point finish.</li>
          </ul>
          <p className="mt-2">
            Source:{" "}
            <a href={p.meta.sourceUrl} className="underline underline-offset-4 hover:text-accent-strong">
              {p.meta.source}
            </a>
            , fetched {p.meta.fetchedOn}. No portraits are shown: their reuse rights are not established.
          </p>
        </div>
      </section>
    </div>
  );
}
