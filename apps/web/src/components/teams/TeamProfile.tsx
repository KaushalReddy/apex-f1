"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useSyncExternalStore } from "react";
import { Chart, SERIES_A, SERIES_B, Stat } from "@/components/drivers/charts";
import { Badge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { TeamCar } from "@/lib/teams/stats";
import type { TeamProfile as Profile } from "@/lib/teams/views";

const pct = (v: number | null) => (v == null ? "—" : `${Math.round(v * 100)}%`);
const one = (v: number | null) => (v == null ? "—" : v.toFixed(1));
const short = (name: string) => name.replace(" Grand Prix", " GP");

function CarResult({ c }: { c: TeamCar }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      <span className="text-xs font-semibold tracking-[0.04em] text-muted">{c.acronym}</span>
      {c.status === "FIN" ? (
        <span className={cn(c.position === 1 && "font-semibold text-warning")}>P{c.position}</span>
      ) : (
        <Badge tone={c.status === "DSQ" ? "danger" : "neutral"}>{c.status}</Badge>
      )}
    </span>
  );
}

/** Team profile. The season switcher drives every figure, line-up, chart and table from one season's data at a time. */
// `?season=` is read on the client so the page stays static (the server render uses the latest season; no hydration mismatch).
const noop = () => () => {};
const urlSeason = () => Number(new URLSearchParams(location.search).get("season")) || null;

export function TeamProfile({ profile }: { profile: Profile }) {
  const { team, seasons, dataset } = profile;
  const fromUrl = useSyncExternalStore(noop, urlSeason, () => null);
  const [picked, setPicked] = useState<number | null>(null);
  const season = picked ?? (seasons.some((s) => s.meta.season === fromUrl) ? fromUrl! : seasons[0].meta.season);
  const p = seasons.find((s) => s.meta.season === season) ?? seasons[0];
  const st = p.stats;
  const partial = !p.meta.complete;
  const labels = p.rounds.map((r) => r.code);
  const names = p.rounds.map((r) => short(r.name));
  const [d1, d2] = p.lineup;
  const choose = (s: number) => {
    setPicked(s);
    // Keep the URL shareable without a navigation.
    history.replaceState(null, "", `?season=${s}`);
  };

  return (
    <div>
      <header className="relative isolate mb-6 overflow-hidden rounded-xl text-white" style={{ backgroundColor: profile.shade }}>
        <span
          aria-hidden="true"
          className="absolute inset-0 -z-10"
          style={{
            backgroundImage: "radial-gradient(rgb(255 255 255 / 0.2) 1px, transparent 1.6px)",
            backgroundSize: "9px 9px",
            maskImage: "linear-gradient(to left, black 10%, transparent 70%)",
            WebkitMaskImage: "linear-gradient(to left, black 10%, transparent 70%)",
          }}
        />
        <span aria-hidden="true" className="absolute inset-0 -z-10 bg-[linear-gradient(140deg,rgb(255_255_255/0.10),transparent_45%,rgb(0_0_0/0.3))]" />
        <div className="grid items-center gap-4 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/75">Team · {season}</p>
            <h1 className="mt-2 font-display text-4xl font-semibold leading-none tracking-[0.01em] sm:text-5xl">{team.name}</h1>
            <p className="mt-2 text-sm text-white/85">
              {p.name !== team.name && <span>Raced as {p.name} in {season} · </span>}
              {st.championship?.position != null
                ? `P${st.championship.position} in the constructors' championship${partial ? " so far" : ""} · ${st.championship.points ?? "—"} pts`
                : "No published constructors' standing"}
            </p>
            <p className="mt-1 text-sm text-white/85">
              {p.lineup.slice(0, 2).map((d, i) => (
                <span key={d.acronym}>
                  {i > 0 && " · "}
                  {d.slug ? (
                    <Link href={`/drivers/${d.slug}`} className="underline decoration-white/40 underline-offset-4 hover:decoration-white">
                      {d.name}
                    </Link>
                  ) : (
                    d.name
                  )}
                </span>
              ))}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <ButtonLink href={`/teams/compare?season=${season}&a=${team.slug}`} size="sm" variant="secondary">
                Compare
              </ButtonLink>
              {team.carViewer && (
                <ButtonLink href={`/cars/${team.slug}`} size="sm" variant="secondary">
                  Explore the 3D car
                </ButtonLink>
              )}
              <ButtonLink href="/standings" size="sm" variant="secondary">
                Standings
              </ButtonLink>
            </div>
          </div>
          {team.image && (
            <Image
              src={team.image.src}
              width={team.image.width}
              height={team.image.height}
              alt={`${team.name} car, side view`}
              priority
              sizes="(min-width: 1024px) 640px, 92vw"
              className="h-auto w-full object-contain drop-shadow-[0_12px_16px_rgb(0_0_0/0.45)]"
            />
          )}
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
              onClick={() => choose(s.meta.season)}
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
            hint={st.championship ? `${st.championship.points ?? "—"} pts · published` : "Not published"}
          />
          <Stat label="Wins" value={st.wins} />
          <Stat label="Podiums" value={st.podiums} hint="Per car" />
          <Stat label="Qualifying P1" value={st.qualifyingP1} hint="Fastest in qualifying" />
          <Stat label="Points / event" value={one(st.pointsPerEvent)} hint={`${st.points} pts in ${st.entries} events`} />
          <Stat label="Finish rate" value={pct(st.finishRate)} hint={`${st.classified} of ${st.starts} car starts`} />
          <Stat label="Scoring rate" value={pct(st.scoringRate)} hint={`${st.scoringEvents} of ${st.entries} events`} />
          <Stat label="Best finish" value={st.bestFinish != null ? `P${st.bestFinish}` : "—"} />
        </dl>
      </section>

      <section aria-labelledby="drivers-heading" className="mt-6">
        <h2 id="drivers-heading" className="mb-3 font-display text-2xl font-semibold tracking-[0.01em]">
          {season} drivers
        </h2>
        <ul className="grid gap-3 md:grid-cols-2">
          {p.lineup.map((d) => (
            <li key={d.acronym} className="relative overflow-hidden rounded-lg border border-line bg-surface p-4 pl-5">
              <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: p.colour }} />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex items-baseline gap-3">
                    <span className="font-display text-3xl font-semibold leading-none tracking-[0.04em]">{d.acronym}</span>
                    {d.number != null && <span className="font-display text-xl text-muted">#{d.number}</span>}
                  </p>
                  <h3 className="mt-1 font-medium">
                    {d.slug ? (
                      <Link href={`/drivers/${d.slug}`} className="hover:text-accent-strong">
                        {d.name}
                      </Link>
                    ) : (
                      d.name
                    )}
                  </h3>
                  <p className="text-xs text-muted">
                    {d.rounds.length} of {p.meta.eventsInSnapshot} races for {p.name}
                    {d.championshipPosition != null && ` · P${d.championshipPosition} in the drivers' championship`}
                  </p>
                </div>
                <div className="flex gap-2">
                  {d.slug && (
                    <ButtonLink href={`/drivers/${d.slug}`} size="sm" variant="secondary" aria-label={`${d.name} profile`}>
                      Profile
                    </ButtonLink>
                  )}
                  {d.inRaceDemo && (
                    <ButtonLink href={`/live?driver=${d.slug}`} size="sm" variant="secondary" title="Opens the simulated demo race with this driver selected">
                      Race view (demo)
                    </ButtonLink>
                  )}
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-5 gap-2 border-t border-line pt-3 text-sm tabular-nums">
                {[
                  ["Points", d.points],
                  ["Wins", d.wins],
                  ["Podiums", d.podiums],
                  ["Best", d.bestFinish != null ? `P${d.bestFinish}` : "—"],
                  ["Avg fin.", one(d.averageFinish)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11px] uppercase tracking-wider text-subtle">{k}</dt>
                    <dd className="font-medium">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-2 text-xs text-muted">
                <span className="text-subtle">Recent: </span>
                {d.recent.join(" · ") || "—"}
              </p>
            </li>
          ))}
        </ul>
        {p.teammates && (
          <p className="mt-3 rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">
            <span className="font-medium text-fg">Teammate head-to-head</span> over the {p.teammates.race.events} races both started for {p.name}: race{" "}
            <span className="font-semibold tabular-nums text-fg">
              {p.teammates.a} {p.teammates.race.a} – {p.teammates.race.b} {p.teammates.b}
            </span>
            {p.teammates.race.undecided > 0 && ` (${p.teammates.race.undecided} with neither classified, not scored)`}, qualifying{" "}
            <span className="font-semibold tabular-nums text-fg">
              {p.teammates.quali.a} – {p.teammates.quali.b}
            </span>
            .{" "}
            {d1?.slug && d2?.slug && (
              <Link href={`/drivers/compare?season=${season}&a=${d1.slug}&b=${d2.slug}`} className="underline decoration-line-strong underline-offset-4 hover:text-accent-strong">
                Full driver comparison
              </Link>
            )}
          </p>
        )}
      </section>

      <section aria-labelledby="trends-heading" className="mt-6">
        <h2 id="trends-heading" className="mb-3 font-display text-2xl font-semibold tracking-[0.01em]">
          Season trends
        </h2>
        <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          <Chart
            title="Constructors' points"
            summary={`Published constructors' points after each round of ${season}${p.progression.some((x) => x.points == null) ? "; rounds without a published standing are gaps" : ""}.`}
            xLabels={labels}
            xNames={names}
            valueLabel="points"
            series={[{ id: "pts", label: team.code, color: SERIES_A, values: p.progression.map((x) => x.points) }]}
          />
          <Chart
            title="Points per race"
            summary="Team points scored at each event (race + sprint, both cars). Blank where the team did not enter."
            xLabels={labels}
            xNames={names}
            valueLabel="points"
            connect={false}
            series={[{ id: "per", label: team.code, color: SERIES_A, values: p.rounds.map((r) => r.points) }]}
          />
          {d1 && (
            <div className="lg:col-span-2 2xl:col-span-1">
              <Chart
                title="Drivers' finishing positions"
                summary={`Race finishing position for ${d1.acronym}${d2 ? ` and ${d2.acronym}` : ""} in races driven for ${p.name} (P1 at the top). Crosses in the bottom band are races without a classified finish.`}
                xLabels={labels}
                xNames={names}
                valueLabel="finish"
                invert
                connect={false}
                yDomain={[1, 22]}
                series={[d1, d2].filter(Boolean).map((d, i) => {
                  const car = p.rounds.map((r) => r.cars.find((c) => c.acronym === d!.acronym) ?? null);
                  return {
                    id: d!.acronym,
                    label: d!.acronym,
                    color: i ? SERIES_B : SERIES_A,
                    values: car.map((c) => (c?.status === "FIN" ? c.position : null)),
                    notes: car.map((c) => (c && c.status !== "FIN" ? c.status : null)),
                  };
                })}
              />
            </div>
          )}
        </div>
      </section>

      <section aria-labelledby="results-heading" className="mt-6">
        <h2 id="results-heading" className="mb-3 font-display text-2xl font-semibold tracking-[0.01em]">
          {season} results
        </h2>
        <div className="overflow-x-auto rounded-lg border border-line bg-surface">
          <table className="w-full min-w-[36rem] text-left text-sm tabular-nums">
            <caption className="sr-only">
              {p.name}, {season} race results by event
            </caption>
            <thead className="border-b border-line text-[11px] uppercase tracking-wider text-subtle">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Rd</th>
                <th scope="col" className="px-3 py-2 font-medium">Grand Prix</th>
                <th scope="col" className="px-3 py-2 font-medium">Cars</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Team points</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Standing after</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {[...p.rounds].reverse().map((r) => {
                const sprint = r.cars.reduce((a, c) => a + c.sprintPoints, 0);
                return (
                  <tr key={r.round} className={cn(!r.entered && "text-subtle")}>
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
                    <td className="px-3 py-1.5">
                      {r.entered ? (
                        <span className="flex flex-wrap gap-x-4 gap-y-1">
                          {r.cars.map((c) => (
                            <CarResult key={c.acronym} c={c} />
                          ))}
                        </span>
                      ) : (
                        "No entry"
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {r.points ?? "—"}
                      {sprint > 0 && <span className="ml-1 text-xs text-subtle">({sprint} sprint)</span>}
                    </td>
                    <td className="px-3 py-1.5 text-right text-muted">{r.standing?.position != null ? `P${r.standing.position} · ${r.standing.points}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="dataset-heading" className="mt-6 grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-line bg-surface p-4">
          <h2 id="dataset-heading" className="eyebrow">
            In this dataset · {dataset.seasons.length > 1 ? `${Math.min(...dataset.seasons)}–${Math.max(...dataset.seasons)}` : dataset.seasons[0]}
          </h2>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm tabular-nums">
            {[
              ["Wins", dataset.wins],
              ["Podiums", dataset.podiums],
              ["Points", dataset.points],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[11px] uppercase tracking-wider text-subtle">{k}</dt>
                <dd className="font-display text-xl font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">Entered as: {dataset.names.join(", ")}</p>
          <p className="mt-2 text-xs leading-relaxed text-subtle">
            Totals over the exported seasons only, summed from classifications. Not all-time totals: titles and earlier history are not in the dataset.
          </p>
        </div>
        <div className="rounded-lg border border-line bg-surface p-4 text-xs leading-relaxed text-muted">
          <h2 className="eyebrow">Car</h2>
          {team.carViewer ? (
            <p className="mt-2">
              <Link href={`/cars/${team.slug}`} className="font-medium text-fg underline decoration-line-strong underline-offset-4 hover:text-accent-strong">
                Open the 3D car viewer
              </Link>{" "}
              to explore components, camera views and airflow. It is a procedural visual model in this team&apos;s colours, not an engineering
              representation of the actual car; technical figures there are marked with their sources.
            </p>
          ) : (
            <p className="mt-2">No 3D model of this team&apos;s car yet; the procedural car viewer covers McLaren, Ferrari, Mercedes and Red Bull Racing.</p>
          )}
          {team.image && <p className="mt-2 text-subtle">The side view above is a livery image, shown for identification.</p>}
        </div>
        <div className="rounded-lg border border-line bg-surface p-4 text-xs leading-relaxed text-muted">
          <h2 className="eyebrow">How these figures are made</h2>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>Championship position and points are {p.meta.source}&apos;s published constructors&apos; standings.</li>
            <li>Derived from classifications: team points per event (race + sprint, both cars), wins and podiums per car, finish rate per car start, scoring rate per event entered.</li>
            <li>A driver counts for this team only in races they drove for it. An event the team did not enter is “No entry”, never zero points.</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
