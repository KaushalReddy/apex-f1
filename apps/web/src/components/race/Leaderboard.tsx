"use client";

import { useRef, type KeyboardEvent } from "react";
import { teamColor } from "@/lib/race/entries";
import { formatGap, formatLapTime, stepSelection } from "@/lib/race/session";
import type { DriverState } from "@/lib/race/types";
import { cn } from "@/lib/cn";

/**
 * Compact race order, driven by the same snapshot as the circuit markers. Rows are buttons: clicking selects the driver on the circuit
 * too; ArrowUp/ArrowDown move the selection through the order. Missing timing shows as "—", never as an estimate.
 */
export function Leaderboard({
  drivers,
  ordered,
  selected,
  gapMode,
  onSelect,
}: {
  drivers: readonly DriverState[];
  ordered: boolean;
  selected: string | null;
  gapMode: "leader" | "ahead";
  onSelect: (id: string | null, viaKeyboard?: boolean) => void;
}) {
  const list = useRef<HTMLOListElement>(null);
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const next = stepSelection(
      drivers.map((d) => d.id),
      selected,
      e.key === "ArrowDown" ? 1 : -1,
    );
    onSelect(next, true);
    list.current?.querySelector<HTMLButtonElement>(`[data-row="${next}"]`)?.focus();
  };

  return (
    <ol ref={list} onKeyDown={onKey} aria-label={ordered ? "Race order" : "Cars (race order not available from this source)"} className="divide-y divide-line">
      {drivers.map((d) => {
        const isSel = d.id === selected;
        return (
          <li key={d.id}>
            <button
              type="button"
              data-row={d.id}
              aria-pressed={isSel}
              onClick={() => onSelect(isSel ? null : d.id)}
              className={cn(
                "motion-interactive grid w-full grid-cols-[1.75rem_minmax(0,1fr)_4.75rem_4.75rem] items-center gap-2 border-l-2 px-3 py-1.5 text-left text-sm tabular-nums",
                isSel ? "border-accent bg-surface-2" : "border-transparent hover:bg-surface-2",
                d.stale && "opacity-60",
              )}
            >
              <span className={cn("font-semibold", d.position === 1 ? "text-warning" : "text-muted")}>{d.position ?? "—"}</span>
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden="true" className="h-4 w-1 shrink-0 rounded-sm" style={{ backgroundColor: teamColor(d.teamSlug) }} />
                <span className="font-semibold">{d.code}</span>
                {d.pit === "in-pit" && <span className="rounded-sm border border-info/40 px-1 text-[10px] font-semibold uppercase tracking-wider text-info">Pit</span>}
                {d.finished && <span className="rounded-sm border border-line-strong px-1 text-[10px] font-semibold uppercase tracking-wider text-muted">Fin</span>}
                {d.stale && <span className="text-[10px] uppercase tracking-wider text-warning">Stale</span>}
              </span>
              <span className="text-right text-muted">{formatGap(d, gapMode)}</span>
              <span className="text-right text-subtle">{formatLapTime(d.lastLapMs)}</span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
