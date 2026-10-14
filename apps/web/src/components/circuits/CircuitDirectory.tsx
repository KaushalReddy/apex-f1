"use client";

import { useMemo, useState } from "react";
import { CircuitCard } from "@/components/data/circuit-card";
import { EmptyState } from "@/components/ui/empty-state";
import type { CircuitEntry, CircuitType } from "@/lib/circuit/catalog";
import type { Outline } from "@/lib/circuit/outline";

type Sort = "name" | "length" | "turns" | "country";
export interface DirectoryFilters {
  query: string;
  calendar: "all" | "current" | "previous";
  type: "all" | CircuitType;
  sort: Sort;
}

/** Search (name, short name, locality, country; accent- and case-insensitive), filters and sort. Unknown values sort last. */
export function filterCircuits(
  list: readonly CircuitEntry[],
  f: DirectoryFilters,
): CircuitEntry[] {
  const norm = (s: string) =>
    s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const q = norm(f.query.trim());
  const num = (v: number | null, dir: 1 | -1) =>
    v == null ? Infinity : dir * v;
  return list
    .filter((c) => f.calendar === "all" || c.calendar === f.calendar)
    .filter((c) => f.type === "all" || c.type === f.type)
    .filter(
      (c) =>
        !q ||
        [c.name, c.shortName, c.locality, c.country, c.openf1.shortName].some(
          (s) => norm(s).includes(q),
        ),
    )
    .sort((a, b) =>
      f.sort === "length"
        ? num(a.lengthKm, -1) - num(b.lengthKm, -1) ||
          a.shortName.localeCompare(b.shortName)
        : f.sort === "turns"
          ? num(a.turns, -1) - num(b.turns, -1) ||
            a.shortName.localeCompare(b.shortName)
          : f.sort === "country"
            ? a.country.localeCompare(b.country) ||
              a.shortName.localeCompare(b.shortName)
            : a.shortName.localeCompare(b.shortName),
    );
}

export function CircuitDirectory({
  circuits,
  outlines,
}: {
  circuits: readonly CircuitEntry[];
  outlines: Record<string, Outline | null>;
}) {
  const [f, setF] = useState<DirectoryFilters>({
    query: "",
    calendar: "all",
    type: "all",
    sort: "name",
  });
  const list = useMemo(() => filterCircuits(circuits, f), [circuits, f]);
  const select =
    "h-10 rounded-md border border-line-strong bg-surface-2 px-2 text-sm text-fg";
  return (
    <div>
      <div
        role="search"
        className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))]"
      >
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Search</span>
          <input
            type="search"
            value={f.query}
            onChange={(e) => setF((x) => ({ ...x, query: e.target.value }))}
            placeholder="Circuit, city or country, e.g. Suzuka, Monza, Japan"
            className="h-10 rounded-md border border-line-strong bg-surface-2 px-3 text-fg placeholder:text-subtle"
          />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Calendar</span>
          <select
            value={f.calendar}
            onChange={(e) =>
              setF((x) => ({
                ...x,
                calendar: e.target.value as DirectoryFilters["calendar"],
              }))
            }
            className={select}
          >
            <option value="all">All circuits</option>
            <option value="current">On the 2026 calendar</option>
            <option value="previous">Not on the 2026 calendar</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Type</span>
          <select
            value={f.type}
            onChange={(e) =>
              setF((x) => ({
                ...x,
                type: e.target.value as DirectoryFilters["type"],
              }))
            }
            className={select}
          >
            <option value="all">All types</option>
            <option value="permanent">Permanent circuits</option>
            <option value="street">Street circuits</option>
            <option value="road">Road circuits</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="text-muted">Sort by</span>
          <select
            value={f.sort}
            onChange={(e) =>
              setF((x) => ({ ...x, sort: e.target.value as Sort }))
            }
            className={select}
          >
            <option value="name">Name</option>
            <option value="length">Length (longest first)</option>
            <option value="turns">Turns (most first)</option>
            <option value="country">Country</option>
          </select>
        </label>
      </div>
      <p className="mb-3 text-xs text-subtle" aria-live="polite">
        {list.length} of {circuits.length} circuits
      </p>
      {list.length === 0 ? (
        <EmptyState
          title="No circuits match"
          status="No results"
          headingLevel="h2"
        >
          Nothing matches{f.query ? ` “${f.query}”` : ""} with these filters.
          Clear the search or choose another filter.
        </EmptyState>
      ) : (
        <ul className="grid grid-cols-1 gap-3 min-[520px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {list.map((c) => (
            <li key={c.id}>
              <CircuitCard circuit={c} outline={outlines[c.id]} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
