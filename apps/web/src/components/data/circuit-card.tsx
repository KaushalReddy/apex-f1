import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { CARD_LINK, CardArrow } from "@/components/ui/card-arrow";
import { SEASON_LABEL, TYPE_LABEL, type CircuitEntry } from "@/lib/circuit/catalog";
import type { Outline } from "@/lib/circuit/outline";

/** Circuit tile: the real layout outline (from car-position data), name, location and the key sourced facts. */
export function CircuitCard({ circuit, outline }: { circuit: CircuitEntry; outline?: Outline | null }) {
  return (
    <Link href={`/circuits/${circuit.id}`} className={`${CARD_LINK} flex h-full flex-col !p-4`}>
      <div className="flex items-start justify-between gap-2">
        <p className="eyebrow">
          {circuit.locality} · {circuit.country}
        </p>
        <CardArrow />
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="grid size-20 shrink-0 place-items-center rounded-md bg-bg/60">
          {outline ? (
            <svg viewBox={`0 0 ${outline.size} ${outline.size}`} className="size-full" role="img" aria-label={`Layout of ${circuit.shortName}`}>
              <path d={outline.d} fill="none" stroke="currentColor" strokeWidth="3" strokeLinejoin="round" className="text-fg/80" />
            </svg>
          ) : (
            <span className="px-1 text-center text-[10px] text-subtle">No layout data</span>
          )}
        </div>
        <div className="min-w-0">
          <p className="font-display text-lg font-semibold leading-tight">{circuit.shortName}</p>
          <p className="mt-0.5 truncate text-xs text-muted" title={circuit.name}>
            {circuit.name}
          </p>
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3 text-sm tabular-nums">
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-subtle">Length</dt>
          <dd className="font-medium">{circuit.lengthKm != null ? `${circuit.lengthKm.toFixed(3)} km` : "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-subtle">Turns</dt>
          <dd className="font-medium">{circuit.turns ?? "—"}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-wider text-subtle">Type</dt>
          <dd className="truncate font-medium">{circuit.type ? TYPE_LABEL[circuit.type].replace(" circuit", "") : "—"}</dd>
        </div>
      </dl>
      <div className="mt-auto flex flex-wrap gap-1.5 pt-3">
        {circuit.calendar === "previous" ? <Badge tone="neutral">Not on the 2026 calendar</Badge> : circuit.season2026 && <Badge tone={circuit.season2026 === "not-held" ? "warning" : "info"}>{SEASON_LABEL[circuit.season2026]}</Badge>}
      </div>
    </Link>
  );
}
