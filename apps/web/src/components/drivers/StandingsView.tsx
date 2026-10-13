"use client";

import Link from "next/link";
import { useState } from "react";
import { cn } from "@/lib/cn";
import type { SeasonStandings } from "@/lib/drivers/standings";

const Change = ({ v }: { v: number | null }) =>
  v == null || v === 0 ? (
    <span className="text-subtle" aria-label="No change">
      –
    </span>
  ) : (
    <span className={v > 0 ? "text-success" : "text-danger"} aria-label={`${v > 0 ? "Up" : "Down"} ${Math.abs(v)}`}>
      {v > 0 ? "▲" : "▼"}
      {Math.abs(v)}
    </span>
  );

const th = "px-3 py-2 font-medium";
const td = "px-3 py-1.5";

/** Drivers' and constructors' tables for one season at a time; positions and points are the published standings. */
export function StandingsView({ seasons }: { seasons: SeasonStandings[] }) {
  const [season, setSeason] = useState(seasons[0].season);
  const s = seasons.find((x) => x.season === season) ?? seasons[0];
  const scope = s.complete ? `Final ${s.season} standings` : `After round ${s.afterRound}${s.afterEvent ? `, ${s.afterEvent}` : ""} (${s.racesCounted} races so far)`;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Season" className="flex flex-wrap gap-1.5">
          {seasons.map((x) => (
            <button
              key={x.season}
              type="button"
              role="radio"
              aria-checked={x.season === season}
              onClick={() => setSeason(x.season)}
              className={cn(
                "motion-interactive h-9 rounded-md border px-3 text-sm font-medium tabular-nums",
                x.season === season ? "border-accent/70 bg-surface-2 text-fg" : "border-line text-muted hover:border-line-strong hover:text-fg",
              )}
            >
              {x.season}
            </button>
          ))}
        </div>
        <p className="text-xs text-subtle" aria-live="polite">
          {scope}
        </p>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="drivers-standings" className="overflow-hidden rounded-lg border border-line bg-surface">
          <h2 id="drivers-standings" className="border-b border-line px-3 py-2.5 eyebrow">
            Drivers&apos; championship
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-left text-sm tabular-nums">
              <caption className="sr-only">
                Drivers&apos; championship, {scope}. Change is places gained or lost since the previous round.
              </caption>
              <thead className="border-b border-line text-[11px] uppercase tracking-wider text-subtle">
                <tr>
                  <th scope="col" className={th}>Pos</th>
                  <th scope="col" className={th}><span className="sr-only">Change</span></th>
                  <th scope="col" className={th}>Driver</th>
                  <th scope="col" className={`${th} hidden sm:table-cell`}>Team</th>
                  <th scope="col" className={`${th} text-right`}>Wins</th>
                  <th scope="col" className={`${th} text-right`}>Gap</th>
                  <th scope="col" className={`${th} text-right`}>Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {s.drivers.map((d) => (
                  <tr key={d.acronym} className="hover:bg-surface-2">
                    <td className={cn(td, "font-semibold", d.position === 1 ? "text-warning" : "text-muted")}>{d.position ?? "—"}</td>
                    <td className={`${td} text-xs`}>
                      <Change v={d.change} />
                    </td>
                    <th scope="row" className={`${td} font-normal`}>
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-sm" style={{ backgroundColor: d.teamColour }} />
                        {d.slug ? (
                          <Link href={`/drivers/${d.slug}`} className="hover:text-accent-strong">
                            <span className="font-semibold">{d.acronym}</span> <span className="text-muted">{d.name}</span>
                          </Link>
                        ) : (
                          <span>
                            <span className="font-semibold">{d.acronym}</span> <span className="text-muted">{d.name}</span>
                          </span>
                        )}
                      </span>
                    </th>
                    <td className={`${td} hidden text-muted sm:table-cell`}>{d.team ?? "—"}</td>
                    <td className={`${td} text-right text-muted`}>{d.wins}</td>
                    <td className={`${td} text-right text-muted`}>{d.position === 1 ? "—" : d.gapToLeader != null ? `−${d.gapToLeader}` : "—"}</td>
                    <td className={`${td} text-right font-semibold`}>{d.points ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section aria-labelledby="teams-standings" className="overflow-hidden rounded-lg border border-line bg-surface">
          <h2 id="teams-standings" className="border-b border-line px-3 py-2.5 eyebrow">
            Constructors&apos; championship
          </h2>
          {s.teams ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[22rem] text-left text-sm tabular-nums">
                <caption className="sr-only">Constructors&apos; championship, {scope}.</caption>
                <thead className="border-b border-line text-[11px] uppercase tracking-wider text-subtle">
                  <tr>
                    <th scope="col" className={th}>Pos</th>
                    <th scope="col" className={th}><span className="sr-only">Change</span></th>
                    <th scope="col" className={th}>Team</th>
                    <th scope="col" className={`${th} text-right`}>Wins</th>
                    <th scope="col" className={`${th} text-right`}>Gap</th>
                    <th scope="col" className={`${th} text-right`}>Points</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {s.teams.map((t) => (
                    <tr key={t.team} className="hover:bg-surface-2">
                      <td className={cn(td, "font-semibold", t.position === 1 ? "text-warning" : "text-muted")}>{t.position ?? "—"}</td>
                      <td className={`${td} text-xs`}>
                        <Change v={t.change} />
                      </td>
                      <th scope="row" className={`${td} font-normal`}>
                        <span className="flex items-center gap-2">
                          <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-sm" style={{ backgroundColor: t.teamColour }} />
                          {t.teamSlug ? (
                            <Link href={`/teams/${t.teamSlug}`} className="font-medium hover:text-accent-strong">
                              {t.team}
                            </Link>
                          ) : (
                            <span className="font-medium">{t.team}</span>
                          )}
                        </span>
                      </th>
                      <td className={`${td} text-right text-muted`}>{t.wins}</td>
                      <td className={`${td} text-right text-muted`}>{t.position === 1 ? "—" : t.gapToLeader != null ? `−${t.gapToLeader}` : "—"}</td>
                      <td className={`${td} text-right font-semibold`}>{t.points ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="px-3 py-4 text-sm text-muted">This season&apos;s snapshot has no published constructors&apos; standings. Nothing is summed in their place.</p>
          )}
        </section>
      </div>
      <p className="mt-4 text-xs leading-relaxed text-subtle">
        Positions and points are the championship standings published by OpenF1 after each race (official Formula 1 timing data). Derived from the
        same season&apos;s classifications: wins (race only), the gap to the leader, and the change since the previous round.
      </p>
    </div>
  );
}
