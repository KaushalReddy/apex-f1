"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { EVENT_LEAD_IN_MS, type ReplayModel } from "@/lib/replay/model";
import { rewindSteps, rewindSummary, type RewindStep, type SwapCause } from "@/lib/replay/rewind";

const CAUSE: Record<SwapCause, { label: string; gain: string; loss: string }> = {
  "on-track": { label: "On-track passes", gain: "Passed on track", loss: "Passed on track by" },
  "own-pit": { label: "Own pit stops", gain: "", loss: "Pit stop: dropped behind" },
  "rival-pit": { label: "Rivals' pit stops", gain: "Gained as they pitted", loss: "" },
  "rival-stopped": { label: "Rivals stopping", gain: "Gained as they stopped", loss: "" },
  unexplained: { label: "Unexplained", gain: "Gained, no pass or pit stop recorded, from", loss: "Lost, no pass or pit stop recorded, to" },
};
const ORDER: SwapCause[] = ["on-track", "own-pit", "rival-pit", "rival-stopped", "unexplained"];
const clock = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};
const signed = (v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0");

interface Props {
  model: ReplayModel;
  t: number;
  /** Driver to show first (car number), e.g. the one selected in the replay. */
  initialNumber: number | null;
  onSeek: (t: number) => void;
  /** Pre-fill a question for the Race Engineer (recorded races only). */
  onAsk?: (question: string) => void;
  onClose: () => void;
}

/**
 * Race Rewind (Phase 15): every position change of one driver up to the replay moment, with why (calculated from OpenF1 data, see
 * lib/replay/rewind). Selecting a step seeks the replay there; Previous/Next step through.
 */
export function RewindPanel({ model, t, initialNumber, onSeek, onAsk, onClose }: Props) {
  const drivers = model.ds.drivers;
  const [num, setNum] = useState<number>(() => initialNumber ?? drivers.find((d) => model.positionOf(d.number, t) === 1)?.number ?? drivers[0].number);
  const [whole, setWhole] = useState(false);
  const i = Math.max(0, drivers.findIndex((d) => d.number === num));
  const all = useMemo(() => rewindSteps(model, i), [model, i]);
  // Up to the replay moment, including a change the replay was just sent to (seeks land EVENT_LEAD_IN_MS before it).
  const steps = whole ? all : all.filter((s) => s.t - EVENT_LEAD_IN_MS - 1000 <= t);
  const sum = rewindSummary(model, i, steps);
  const code = (n: number) => drivers.find((d) => d.number === n)?.acronym ?? `#${n}`;
  const me = drivers[i];
  const net = sum.start != null && sum.now != null ? sum.start - sum.now : null;
  const go = (s: RewindStep) => onSeek(Math.max(0, s.t - EVENT_LEAD_IN_MS));
  const next = steps.find((s) => s.t - EVENT_LEAD_IN_MS > t + 500);
  const prev = [...steps].reverse().find((s) => s.t - EVENT_LEAD_IN_MS < t - 500);
  const current = [...steps].reverse().find((s) => s.t - EVENT_LEAD_IN_MS - 1000 <= t && t <= s.tEnd + 15_000);
  const sorted = [...drivers].sort((a, b) => (model.positionOf(a.number, t) ?? 99) - (model.positionOf(b.number, t) ?? 99));

  return (
    <section aria-labelledby="rewind-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <h2 id="rewind-heading" className="eyebrow whitespace-nowrap">
          Race rewind
        </h2>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onClose}>
          Close
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 pt-2.5 text-xs">
        <label className="flex items-center gap-1.5 text-muted">
          Driver
          <select value={num} onChange={(e) => setNum(Number(e.target.value))} className="h-7 rounded-md border border-line-strong bg-surface-2 px-1.5 text-xs text-fg">
            {sorted.map((d) => (
              <option key={d.number} value={d.number}>
                {d.acronym ?? `#${d.number}`} {d.fullName ? `· ${d.fullName}` : ""}
              </option>
            ))}
          </select>
        </label>
        <label className="ml-auto flex items-center gap-1.5 text-muted">
          <input type="checkbox" className="size-3.5" checked={whole} onChange={() => setWhole((w) => !w)} />
          Whole race <span className="text-subtle">(spoilers)</span>
        </label>
      </div>

      <div className="mx-3 mt-2.5 rounded-md bg-surface-2/70 px-2.5 py-2 text-xs">
        <p className="text-fg">
          <span className="font-semibold">{me.acronym ?? `#${me.number}`}</span> started P{sum.start ?? "?"}
          {sum.now != null && (
            <>
              , {whole ? "finished" : "now"} <span className="font-semibold">P{sum.now}</span>
              {net != null && <span className={cn("ml-1 tabular-nums", net > 0 ? "text-success" : net < 0 ? "text-danger" : "text-muted")}>({signed(net)})</span>}
            </>
          )}
        </p>
        <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px]">
          {ORDER.map((c) => (
            <div key={c} className="flex justify-between gap-2">
              <dt className="text-subtle">{CAUSE[c].label}</dt>
              <dd className={cn("tabular-nums", sum.byCause[c] > 0 ? "text-success" : sum.byCause[c] < 0 ? "text-danger" : "text-muted")}>{signed(sum.byCause[c])}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex items-center gap-1.5 px-3 pt-2">
        <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" disabled={!prev} onClick={() => prev && go(prev)}>
          Previous
        </Button>
        <Button size="sm" variant="secondary" className="h-7 px-2 text-xs" disabled={!next} onClick={() => next && go(next)}>
          Next
        </Button>
        <span className="ml-auto text-[11px] text-subtle">{steps.length} changes</span>
      </div>

      {steps.length === 0 ? (
        <p className="px-3 py-3 text-sm text-muted">{t < model.ds.lightsOutMs ? "The race has not started yet." : "No position changes yet."}</p>
      ) : (
        <ol aria-label={`Position changes of ${me.acronym ?? me.number}`} className="mt-1.5 min-h-0 flex-1 divide-y divide-white/10 overflow-y-auto">
          {steps.map((s) => {
            const gain = s.to < s.from;
            const groups = ORDER.map((c) => ({ c, cars: s.swaps.filter((w) => w.cause === c).map((w) => code(w.other)) })).filter((g) => g.cars.length);
            return (
              <li key={s.t}>
                <button type="button" onClick={() => go(s)} aria-current={current === s ? "step" : undefined} className={cn("motion-interactive w-full px-3 py-2 text-left text-xs hover:bg-surface-2", current === s && "bg-surface-2")}>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-subtle tabular-nums">
                      {s.lap != null ? `Lap ${s.lap} · ` : ""}
                      {clock(s.t - model.ds.lightsOutMs)}
                    </span>
                    <span className="tabular-nums text-fg">
                      P{s.from} → P{s.to} <span className={gain ? "text-success" : "text-danger"}>{gain ? `▲${s.from - s.to}` : `▼${s.to - s.from}`}</span>
                    </span>
                  </span>
                  <span className="mt-0.5 block text-fg/90">
                    {groups.map((g) => (
                      <span key={g.c} className="block">
                        {gain ? CAUSE[g.c].gain : CAUSE[g.c].loss} {g.cars.join(", ")}
                        {g.c === "own-pit" && s.pit?.laneS != null && <span className="text-subtle"> ({s.pit.laneS.toFixed(1)} s in the pit lane)</span>}
                      </span>
                    ))}
                    {s.swaps.length < Math.abs(s.to - s.from) && (
                      <span className="block text-subtle">
                        {Math.abs(s.to - s.from) - s.swaps.length} place{Math.abs(s.to - s.from) - s.swaps.length > 1 ? "s" : ""} with no car swapped in the published order (e.g. a car
                        dropping out of it).
                      </span>
                    )}
                  </span>
                  {(s.neutralised || s.penalties.length > 0) && (
                    <span className="mt-1 flex flex-wrap gap-1">
                      {s.neutralised && <span className="rounded-sm border border-warning/50 px-1 text-[10px] text-warning">Under {s.neutralised}</span>}
                      {s.penalties.map((p) => (
                        <span key={p} className="rounded-sm border border-danger/40 px-1 text-[10px] text-danger">
                          {p}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="border-t border-white/10 px-3 py-2.5">
        <p className="text-[11px] text-subtle">Calculated from the official order, pit stops and OpenF1&apos;s published on-track passes. &quot;Unexplained&quot; means no record explains the change.</p>
        {onAsk && (
          <Button size="sm" variant="ghost" className="mt-1.5 h-7 px-2 text-xs" onClick={() => onAsk(`Why did ${me.acronym ?? me.fullName} gain and lose places${whole ? " in this race" : " so far"}?`)}>
            Ask the engineer to explain
          </Button>
        )}
      </div>
    </section>
  );
}
