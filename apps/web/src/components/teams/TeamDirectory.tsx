"use client";

import { useMemo, useState } from "react";
import { EmptyState } from "@/components/ui/empty-state";
import type { SeasonMeta } from "@/lib/drivers/views";
import type { TeamCardData } from "@/lib/teams/views";
import { TeamShowcaseCard } from "./TeamShowcaseCard";

type Sort = "default" | "championship" | "name";
type Show = "all" | "winners" | "car";

/** Team directory, one season at a time. The default order is the canonical eleven-team order; other orders only when chosen. */
export function TeamDirectory({ seasons }: { seasons: Array<{ meta: SeasonMeta; teams: TeamCardData[] }> }) {
  const [season, setSeason] = useState(seasons[0].meta.season);
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<Show>("all");
  const [sort, setSort] = useState<Sort>("default");
  const current = seasons.find((s) => s.meta.season === season) ?? seasons[0];
  const list = useMemo(() => filterTeams(current.teams, { query, show, sort }), [current, query, show, sort]);
  const select = "h-10 rounded-md border border-line-strong bg-surface-2 px-2 text-sm text-fg";

  return (
    <div>
      <div role="search" className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]">
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Search</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Team, code or driver, e.g. Ferrari, AMR, NOR"
            className="h-10 rounded-md border border-line-strong bg-surface-2 px-3 text-fg placeholder:text-subtle"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Season</span>
          <select value={season} onChange={(e) => setSeason(Number(e.target.value))} className={select}>
            {seasons.map((s) => (
              <option key={s.meta.season} value={s.meta.season}>
                {s.meta.season}
                {s.meta.complete ? "" : ` (${s.meta.eventsInSnapshot} races so far)`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Show</span>
          <select value={show} onChange={(e) => setShow(e.target.value as Show)} className={select}>
            <option value="all">All teams</option>
            <option value="winners">Race winners this season</option>
            <option value="car">Teams with a 3D car</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Order</span>
          <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className={select}>
            <option value="default">Default</option>
            <option value="championship">Championship position</option>
            <option value="name">Name</option>
          </select>
        </label>
      </div>
      <p className="mb-4 text-xs text-subtle" aria-live="polite">
        {list.length} of {current.teams.length} teams · {current.meta.season}
        {current.meta.complete ? " season" : ` season, ${current.meta.eventsInSnapshot} races so far`} · line-ups and standings as published by {current.meta.source}
      </p>
      {list.length === 0 ? (
        <EmptyState title="No teams match" status="No results" headingLevel="h2">
          Nothing in the {current.meta.season} grid matches{query ? ` “${query}”` : ""}
          {show === "winners" ? " among race winners" : show === "car" ? " among teams with a 3D car" : ""}. Clear the search or change the filter.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:gap-5">
          {list.map((t, i) => (
            <li key={t.slug}>
              <TeamShowcaseCard t={t} season={current.meta.season} priority={i < 2} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Search (team name, season name, code or driver; accent- and case-insensitive), filter and order. Exported for tests. */
export function filterTeams(teams: readonly TeamCardData[], o: { query: string; show: Show; sort: Sort }): TeamCardData[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = norm(o.query.trim());
  return teams
    .filter((t) => o.show === "all" || (o.show === "winners" ? t.wins > 0 : t.carViewer))
    .filter((t) => !q || [t.name, t.racedAs ?? "", t.code, ...t.drivers.flatMap((d) => [d.name, d.acronym])].some((s) => norm(s).includes(q)))
    .sort((a, b) =>
      o.sort === "name" ? a.name.localeCompare(b.name) : o.sort === "championship" ? (a.position ?? 99) - (b.position ?? 99) || a.order - b.order : a.order - b.order,
    );
}
