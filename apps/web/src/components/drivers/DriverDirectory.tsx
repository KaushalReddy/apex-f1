"use client";

import { useId, useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import { gridRank, portraitOf, teamRank } from "@/lib/drivers/grid";
import type { DirectoryEntry, SeasonMeta } from "@/lib/drivers/views";
import { DriverShowcaseCard } from "./DriverShowcaseCard";

type Sort = "grid" | "championship" | "name" | "wins" | "number";

/** Searchable, filterable driver directory for one season at a time. All filtering is client-side over the season's line-up. */
export function DriverDirectory({ seasons }: { seasons: Array<{ meta: SeasonMeta; drivers: DirectoryEntry[] }> }) {
  const id = useId();
  const [season, setSeason] = useState(seasons[0]?.meta.season ?? 0);
  const [query, setQuery] = useState("");
  const [team, setTeam] = useState("");
  const [sort, setSort] = useState<Sort>("grid");
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
            <option value="grid">Grid order</option>
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
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:gap-5">
          {list.map((d, i) => (
            <li key={d.acronym}>
              <DriverShowcaseCard d={d} portrait={portraitOf(d.acronym)} priority={i < 2} />
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
      // Grid order: the grid (lib/drivers/grid.ts) team by team; anyone not on it (e.g. a replaced driver) follows, by team, then standing.
      if (o.sort === "grid")
        return gridRank(a.acronym) - gridRank(b.acronym) || teamRank(a.team) - teamRank(b.team) || (a.championshipPosition ?? 99) - (b.championshipPosition ?? 99) || a.name.localeCompare(b.name);
      return (a.championshipPosition ?? 99) - (b.championshipPosition ?? 99) || a.name.localeCompare(b.name);
    });
}
