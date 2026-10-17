"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";

export interface PickDriver {
  id: string;
  number: number;
  code: string;
  name: string | null;
  team: string | null;
  colour: string;
  position: number | null;
}

/** Normalised for accent-insensitive search ("perez" finds "Pérez"). */
const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Chooses Driver A and Driver B from the session's drivers. One slot is active at a time; picking fills it and moves on to the other.
 * The driver in the other slot cannot be picked, so the same driver is never compared with itself.
 */
export function ComparePicker({
  drivers,
  initialA,
  initialB,
  onStart,
  onCancel,
}: {
  drivers: PickDriver[];
  initialA: string | null;
  initialB: string | null;
  onStart: (a: string, b: string) => void;
  onCancel: () => void;
}) {
  const [a, setA] = useState<string | null>(initialA);
  const [b, setB] = useState<string | null>(initialB && initialB !== initialA ? initialB : null);
  const [slot, setSlot] = useState<"a" | "b">(initialA ? "b" : "a");
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const q = norm(query.trim());
    return drivers.filter((d) => !q || [d.code, d.name ?? "", d.team ?? "", String(d.number)].some((f) => norm(f).includes(q)));
  }, [drivers, query]);
  const other = slot === "a" ? b : a;
  const byId = new Map(drivers.map((d) => [d.id, d]));
  const pick = (id: string) => {
    if (slot === "a") {
      setA(id);
      if (!b) setSlot("b");
    } else {
      setB(id);
      if (!a) setSlot("a");
    }
  };

  return (
    <section aria-labelledby="compare-pick-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <h2 id="compare-pick-heading" className="eyebrow">
          Compare two drivers
        </h2>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <div role="radiogroup" aria-label="Which driver to choose" className="grid grid-cols-2 gap-1.5 px-3 pt-3">
        {(["a", "b"] as const).map((k) => {
          const d = (k === "a" ? a : b) ? byId.get((k === "a" ? a : b) as string) : null;
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={slot === k}
              onClick={() => setSlot(k)}
              className={cn(
                "motion-interactive flex min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm",
                slot === k ? "border-accent/70 bg-surface-2 text-fg" : "border-white/10 text-muted hover:text-fg",
              )}
            >
              <span className="text-[11px] font-semibold uppercase tracking-wider text-subtle">{k.toUpperCase()}</span>
              {d ? (
                <>
                  <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-sm" style={{ backgroundColor: d.colour }} />
                  <span className="truncate font-medium">{d.code}</span>
                </>
              ) : (
                <span className="truncate text-subtle">Choose</span>
              )}
            </button>
          );
        })}
      </div>
      <label className="block px-3 pt-2.5">
        <span className="sr-only">Search drivers</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name, team or number"
          className="h-9 w-full rounded-md border border-line-strong bg-surface-2 px-2.5 text-sm text-fg placeholder:text-subtle"
        />
      </label>
      <ul aria-label={`Drivers for slot ${slot.toUpperCase()}`} className="mt-2 min-h-0 flex-1 divide-y divide-white/10 overflow-y-auto">
        {list.length === 0 && <li className="px-3 py-3 text-sm text-muted">No driver matches “{query}”.</li>}
        {list.map((d) => {
          const taken = d.id === other;
          const chosen = d.id === (slot === "a" ? a : b);
          return (
            <li key={d.id}>
              <button
                type="button"
                disabled={taken}
                aria-pressed={chosen}
                title={taken ? `Already Driver ${slot === "a" ? "B" : "A"}` : undefined}
                onClick={() => pick(d.id)}
                className={cn(
                  "motion-interactive grid w-full grid-cols-[1.5rem_0.25rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 text-left text-sm enabled:hover:bg-surface-2 disabled:opacity-40",
                  chosen && "bg-surface-2",
                )}
              >
                <span className="text-xs tabular-nums text-subtle">{d.position != null ? `P${d.position}` : ""}</span>
                <span aria-hidden="true" className="h-4 w-1 rounded-sm" style={{ backgroundColor: d.colour }} />
                <span className="min-w-0">
                  <span className="font-medium text-fg">{d.code}</span> <span className="text-muted">{d.name ?? ""}</span>
                  <span className="block truncate text-xs text-subtle">{d.team ?? "Team not published"}</span>
                </span>
                <span className="text-xs tabular-nums text-subtle">#{d.number}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-white/10 p-3">
        <Button size="sm" className="w-full" disabled={!a || !b || a === b} onClick={() => a && b && onStart(a, b)}>
          {a && b ? `Compare ${byId.get(a)?.code} and ${byId.get(b)?.code}` : "Choose two drivers"}
        </Button>
      </div>
    </section>
  );
}
