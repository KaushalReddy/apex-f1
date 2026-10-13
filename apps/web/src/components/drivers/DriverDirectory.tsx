"use client";

import Link from "next/link";
import { useId, useMemo, useState } from "react";
import { CARD_LINK, CardArrow } from "@/components/ui/card-arrow";
import { EmptyState } from "@/components/ui/empty-state";
import type { DirectoryEntry, SeasonMeta } from "@/lib/drivers/views";

type Sort = "championship" | "name" | "wins" | "number";

/** Searchable, filterable driver directory for one season at a time. All filtering is client-side over the season's line-up. */
export function DriverDirectory({ seasons }: { seasons: Array<{ meta: SeasonMeta; drivers: DirectoryEntry[] }> }) {
  const id = useId();
  const [season, setSeason] = useState(seasons[0]?.meta.season ?? 0);
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState("");
  const [sort, setSort] = useState<Sort>("championship");
  const current = seasons.find((s) => s.meta.season === season) ?? seasons[0];
  const teams = useMemo(() => [...new Set(current.drivers.map((d) => d.team).filter((t): t is string => !!t))].sort(), [current]);
  const list = useMemo(() => filterDrivers(current.drivers, { query, team, sort }), [current, query, team, sort]);
  const select = "h-10 rounded-md border border-line-strong bg-surface-2 px-2 text-sm text-fg";

  return (
    <div>
      <div role="search" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Search</span>
          <input
            id={`${id}-q`}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or code, e.g. Norris or NOR"
            className="h-10 rounded-md border border-line-strong bg-surface-2 px-3 text-fg placeholder:text-subtle"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Season</span>
          <select value={season} onChange={(e) => (setSeason(Number(e.target.value)), setTeam(""))} className={select}>
            {seasons.map((s) => (
              <option key={s.meta.season} value={s.meta.season}>
                {s.meta.season}
                {s.meta.complete ? "" : ` (${s.meta.eventsInSnapshot} races so far)`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Team</span>
          <select value={team} onChange={(e) => setTeam(e.target.value)} className={select}>
            <option value="">All teams</option>
            {teams.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Sort by</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={select}>
            <option value="championship">Championship position</option>
            <option value="wins">Wins</option>
            <option value="name">Name</option>
            <option value="number">Race number</option>
          </select>
        </label>
      </div>
      <p className="mb-3 text-xs text-subtle" aria-live="polite">
        {list.length} of {current.drivers.length} drivers · {current.meta.season}
        {current.meta.complete ? " season" : ` season, ${current.meta.eventsInSnapshot} races so far`} · standings as published by {current.meta.source}
        {current.meta.skipped.length > 0 && ` · no classification published for ${current.meta.skipped.map((s) => `${s.name} (${s.date})`).join(" and ")}`}
      </p>
      {list.length === 0 ? (
        <EmptyState title="No drivers match" status="No results" headingLevel="h2">
          Nothing in the {current.meta.season} line-up matches “{query}”{team ? ` in ${team}` : ""}. Clear the search or choose another team.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {list.map((d) => (
            <li key={d.acronym}>
              <Link href={`/drivers/${d.slug}`} className={`${CARD_LINK} relative overflow-hidden pl-6`}>
                <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: d.teamColour }} />
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-display text-3xl font-semibold leading-none tracking-[0.04em]">{d.acronym}</p>
                    <p className="mt-2 text-base font-medium">{d.name}</p>
                    <p className="mt-0.5 text-sm text-muted">
                      {d.team ?? "Team not published"}
                      {d.number != null && ` · #${d.number}`}
                    </p>
                  </div>
                  <CardArrow />
                </div>
                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-sm tabular-nums">
                  <div>
                    <dt className="text-[11px] uppercase tracking-wider text-subtle">Pos</dt>
                    <dd className="font-medium">{d.championshipPosition != null ? `P${d.championshipPosition}` : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wider text-subtle">Points</dt>
                    <dd className="font-medium">{d.championshipPoints ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] uppercase tracking-wider text-subtle">Wins</dt>
                    <dd className="font-medium">{d.wins}</dd>
                  </div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Search (name or acronym, accent- and case-insensitive), team filter and sort. Unknown positions sort last. Exported for tests. */
export function filterDrivers(drivers: readonly DirectoryEntry[], o: { query: string; team: string; sort: Sort }): DirectoryEntry[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = norm(o.query.trim());
  return drivers
    .filter((d) => !o.team || d.team === o.team)
    .filter((d) => !q || norm(d.name).includes(q) || d.acronym.toLowerCase().includes(q))
    .sort((a, b) => {
      if (o.sort === "name") return a.name.localeCompare(b.name);
      if (o.sort === "wins") return b.wins - a.wins || (a.championshipPosition ?? 99) - (b.championshipPosition ?? 99);
      if (o.sort === "number") return (a.number ?? 999) - (b.number ?? 999);
      return (a.championshipPosition ?? 99) - (b.championshipPosition ?? 99) || a.name.localeCompare(b.name);
    });
}
