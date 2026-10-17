"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { FocusSet } from "@/lib/race/visibility";

export interface FocusDriver {
  id: string;
  code: string;
  name: string | null;
  team: string | null;
  number: number | null;
  colour: string;
  position: number | null;
  /** Hollowed out on the circuit right now. */
  hollow: boolean;
}

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

/**
 * Drivers / circuit focus control. Ticks are a draft until "Focus selected" applies them, so editing never empties the circuit by accident;
 * "Show all" removes the focus (everyone normal); "Clear selection" only clears the ticks. Comparison mode overrides the emphasis without
 * changing the applied focus, which this control keeps and shows.
 */
export function CircuitFocus({
  drivers,
  applied,
  comparing,
  onApply,
  onClose,
}: {
  drivers: FocusDriver[];
  applied: FocusSet;
  /** Codes of the compared pair while comparison is on. */
  comparing: [string, string] | null;
  onApply: (focus: FocusSet) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Set<string>>(() => new Set(applied ?? []));
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const q = norm(query.trim());
    return drivers.filter((d) => !q || [d.code, d.name ?? "", d.team ?? "", d.number != null ? String(d.number) : ""].some((f) => norm(f).includes(q)));
  }, [drivers, query]);
  const toggle = (id: string) =>
    setDraft((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const shownCount = drivers.filter((d) => !d.hollow).length;

  return (
    <section aria-labelledby="focus-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <h2 id="focus-heading" className="eyebrow whitespace-nowrap">
          Circuit focus
        </h2>
        <span className="flex items-center gap-2">
          <span className="whitespace-nowrap text-xs tabular-nums text-muted" aria-live="polite">
            {shownCount === drivers.length ? "All shown" : `${shownCount} of ${drivers.length} shown`}
          </span>
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onClose}>
            Close
          </Button>
        </span>
      </div>
      {comparing && (
        <p className="border-b border-white/10 px-3 py-2 text-xs text-muted">
          Comparison is focusing on <span className="font-medium text-fg">{comparing[0]}</span> and <span className="font-medium text-fg">{comparing[1]}</span>.{" "}
          {applied ? `Your focus on ${applied.size} driver${applied.size === 1 ? "" : "s"} returns when you exit the comparison.` : "Everyone is shown again when you exit the comparison."} The comparison panel
          comes back when you close this.
        </p>
      )}
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
      <ul aria-label="Drivers to keep in focus" className="mt-2 min-h-0 flex-1 divide-y divide-white/10 overflow-y-auto">
        {list.length === 0 && <li className="px-3 py-3 text-sm text-muted">No driver matches “{query}”.</li>}
        {list.map((d) => (
          <li key={d.id}>
            <label className="motion-interactive grid cursor-pointer grid-cols-[1rem_1.75rem_0.25rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 text-sm hover:bg-surface-2">
              <input type="checkbox" checked={draft.has(d.id)} onChange={() => toggle(d.id)} className="size-4" aria-label={`${d.code}${d.name ? `, ${d.name}` : ""}`} />
              <span className="text-xs tabular-nums text-subtle">{d.position != null ? `P${d.position}` : ""}</span>
              <span aria-hidden="true" className={cn("h-4 w-1 rounded-sm", d.hollow && "opacity-40")} style={{ backgroundColor: d.colour }} />
              <span className="min-w-0">
                <span className={cn("font-medium", d.hollow ? "text-muted" : "text-fg")}>{d.code}</span> <span className="text-muted">{d.name ?? ""}</span>
                <span className="block truncate text-xs text-subtle">
                  {d.team ?? "Team not published"}
                  {d.number != null ? ` · #${d.number}` : ""}
                </span>
              </span>
              <span className={cn("rounded-sm border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider", d.hollow ? "border-white/10 text-subtle" : "border-white/25 text-fg")}>
                {d.hollow ? "Hollow" : "Shown"}
              </span>
            </label>
          </li>
        ))}
      </ul>
      {draft.size === 0 && (
        <p role="status" className="border-t border-white/10 px-3 py-2 text-xs text-muted">
          No drivers ticked. Tick the drivers to keep in focus, or show everyone.
        </p>
      )}
      <div className="grid grid-cols-2 gap-1.5 border-t border-white/10 p-3">
        <Button size="sm" variant="ghost" className="px-2" onClick={() => onApply(null)}>
          Show all
        </Button>
        <Button size="sm" variant="ghost" className="px-2" disabled={draft.size === 0} onClick={() => setDraft(new Set())}>
          Clear selection
        </Button>
        <Button size="sm" className="col-span-2" disabled={draft.size === 0} onClick={() => onApply(new Set(draft))}>
          {draft.size ? `Focus selected (${draft.size})` : "Focus selected"}
        </Button>
      </div>
    </section>
  );
}
