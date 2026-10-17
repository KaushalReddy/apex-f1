"use client";

import { useMemo, useState } from "react";
import { niceTicks, TraceChart } from "@/components/telemetry/TraceChart";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { ReplayWeather } from "@/lib/replay/dataset";
import { EVENT_LEAD_IN_MS } from "@/lib/replay/model";
import { compass, messageText as sentence, weatherAt, type ClassifiedMessage, type MessageKind, type RaceControl } from "@/lib/replay/raceControl";

const KIND_LABEL: Record<MessageKind, string> = {
  start: "Start",
  finish: "Finish",
  "safety-car": "Safety Car",
  vsc: "VSC",
  "red-flag": "Red flag",
  green: "Green",
  yellow: "Yellow",
  "double-yellow": "Double yellow",
  clear: "Clear",
  blue: "Blue flag",
  "black-white": "Black and white",
  penalty: "Penalty",
  investigation: "Stewards",
  "track-limits": "Track limits",
  weather: "Weather",
  drs: "Overtake aid",
  "pit-lane": "Pit lane",
  other: "Info",
};
const KIND_TONE: Partial<Record<MessageKind, string>> = {
  "safety-car": "border-warning/50 text-warning",
  vsc: "border-warning/50 text-warning",
  yellow: "border-warning/50 text-warning",
  "double-yellow": "border-warning/60 text-warning",
  "red-flag": "border-danger/60 text-danger",
  penalty: "border-danger/40 text-danger",
  "black-white": "border-white/30 text-fg",
  green: "border-success/50 text-success",
  start: "border-white/30 text-fg",
  finish: "border-white/30 text-fg",
};
const clock = (ms: number) => {
  const s = Math.round(ms / 1000);
  const a = Math.abs(s);
  return `${s < 0 ? "−" : ""}${Math.floor(a / 3600)}:${String(Math.floor((a % 3600) / 60)).padStart(2, "0")}:${String(a % 60).padStart(2, "0")}`;
};

interface Props {
  rc: RaceControl;
  weather: ReplayWeather | null;
  /** Replay time (ms) and lights-out (ms), for the race clock. */
  t: number;
  lightsOutMs: number;
  durationMs: number;
  onSeek: (t: number) => void;
  onClose: () => void;
  showSectorFlags: boolean;
  onToggleSectorFlags: () => void;
}

/**
 * Race control and conditions at the replay's moment (Phase 12). Only messages up to the replay time are listed (no spoilers); "Key
 * moments" shows what shaped the race, "All" adds routine flags. Everything is as OpenF1 published it; the grouping is APEX F1's.
 */
export function RaceControlPanel({ rc, weather, t, lightsOutMs, durationMs, onSeek, onClose, showSectorFlags, onToggleSectorFlags }: Props) {
  const [tab, setTab] = useState<"messages" | "weather">("messages");
  const [filter, setFilter] = useState<"key" | "all">("key");
  const shown = rc.until(t);
  const key = shown.filter((m) => m.importance === "key");
  const list = (filter === "key" ? key : shown).slice().reverse();
  const w = weatherAt(weather, t);
  const [hover, setHover] = useState<number | null>(null);
  const series = useMemo(() => {
    if (!weather) return null;
    const xs = weather.t.map((x) => (x - lightsOutMs) / 60_000);
    const track = weather.track.map((v) => (v === 0 ? null : v)); // 0 °C: sensor dropout (see weatherAt)
    const vals = [...weather.air, ...track].filter((v): v is number => v != null);
    return { xs, track, air: weather.air, lo: Math.floor(Math.min(...vals) / 5) * 5, hi: Math.ceil(Math.max(...vals) / 5) * 5, rainy: weather.rain.some((r) => (r ?? 0) > 0) };
  }, [weather, lightsOutMs]);

  return (
    <section aria-labelledby="rc-heading" className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <h2 id="rc-heading" className="eyebrow whitespace-nowrap">
          Race control
        </h2>
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={onClose}>
          Close
        </Button>
      </div>
      <div role="tablist" aria-label="Race control view" className="flex gap-0.5 border-b border-white/10 px-1.5 py-1">
        {(
          [
            ["messages", "Messages"],
            ["weather", "Conditions"],
          ] as const
        ).map(([k, label]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("motion-interactive h-7 rounded-md px-2.5 text-xs font-medium", tab === k ? "bg-surface-3 text-fg" : "text-muted hover:text-fg")}>
            {label}
          </button>
        ))}
      </div>

      {tab === "messages" ? (
        <>
          <div role="radiogroup" aria-label="Which messages" className="flex items-center gap-1.5 px-3 pt-2.5 text-xs">
            {(
              [
                ["key", `Key moments (${key.length})`],
                ["all", `All (${shown.length})`],
              ] as const
            ).map(([k, label]) => (
              <button key={k} type="button" role="radio" aria-checked={filter === k} onClick={() => setFilter(k)} className={cn("motion-interactive h-7 rounded-md border px-2.5 font-medium", filter === k ? "border-accent/70 bg-surface-2 text-fg" : "border-white/10 text-muted hover:text-fg")}>
                {label}
              </button>
            ))}
          </div>
          <p className="px-3 pt-1.5 text-[11px] text-subtle">Up to {clock(t - lightsOutMs)} from lights out, newest first. Select one to jump there.</p>
          {list.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted">{t < lightsOutMs ? "No messages yet: the race has not started." : filter === "key" ? "No key moments yet. Switch to All for routine messages." : "No race-control messages yet."}</p>
          ) : (
            <ol aria-label="Race control messages" className="mt-1.5 min-h-0 flex-1 divide-y divide-white/10 overflow-y-auto">
              {list.map((m: ClassifiedMessage, i) => (
                <li key={`${m.t}-${i}`}>
                  <button type="button" onClick={() => onSeek(Math.max(0, m.t - EVENT_LEAD_IN_MS))} className="motion-interactive grid w-full grid-cols-[3.75rem_minmax(0,1fr)] gap-x-2 px-3 py-1.5 text-left text-xs hover:bg-surface-2">
                    <span className="tabular-nums text-subtle">{clock(m.t - lightsOutMs)}</span>
                    <span className="min-w-0">
                      <span className={cn("mr-1.5 inline-block rounded-sm border px-1 py-px text-[10px] font-medium uppercase tracking-wider", KIND_TONE[m.kind] ?? "border-white/15 text-muted")}>{KIND_LABEL[m.kind]}</span>
                      <span className="text-fg">{sentence(m.message)}</span>
                      {m.lap != null && <span className="ml-1 text-subtle">· lap {m.lap}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2.5 text-sm">
          {!w ? (
            <p className="text-xs text-muted">{weather ? "No weather reading in the last five minutes of the replay time." : "No weather data was published for this race."}</p>
          ) : (
            <>
              <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
                {(
                  [
                    ["Air", w.airC != null ? `${w.airC.toFixed(1)} °C` : "—"],
                    ["Track", w.trackC != null ? `${w.trackC.toFixed(1)} °C` : "—"],
                    ["Humidity", w.humidity != null ? `${Math.round(w.humidity)}%` : "—"],
                    ["Wind", w.windSpeed != null ? `${w.windSpeed.toFixed(1)} m/s${w.windDir != null ? ` ${compass(w.windDir)}` : ""}` : "—"],
                    ["Pressure", w.pressure != null ? `${Math.round(w.pressure)} hPa` : "—"],
                    ["Rain", w.rain == null ? "—" : w.rain ? "Yes" : "No"],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-subtle">{k}</dt>
                    <dd className={cn("tabular-nums text-fg", k === "Rain" && w.rain && "text-info")}>{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-1.5 text-[11px] text-subtle">Track-side weather station, reading from {clock(w.t - lightsOutMs)} (about one a minute). Rain is only on/off.</p>
            </>
          )}
          {series && (
            <div className="mt-3">
              <TraceChart
                label="Temperature"
                unit="°C, track and air"
                height={120}
                xDomain={[series.xs[0], series.xs[series.xs.length - 1]]}
                yDomain={[series.lo, series.hi]}
                yTicks={niceTicks(series.lo, series.hi, 3)}
                traces={[
                  { id: "track", color: "#c4850e", xs: series.xs, ys: series.track },
                  { id: "air", color: "#3d9be0", xs: series.xs, ys: series.air },
                ]}
                hoverX={hover}
                onHover={setHover}
                followX={(t - lightsOutMs) / 60_000}
                onPick={(x) => onSeek(Math.max(0, Math.min(durationMs, lightsOutMs + x * 60_000)))}
                xAxis={{ ticks: niceTicks(Math.max(0, series.xs[0]), series.xs[series.xs.length - 1], 4), format: (v) => `${Math.round(v)}′` }}
                readout={
                  hover != null && weather
                    ? (() => {
                        const r = weatherAt(weather, lightsOutMs + hover * 60_000);
                        return [
                          { color: "#c4850e", text: `Track ${r?.trackC != null ? r.trackC.toFixed(1) : "—"}` },
                          { color: "#3d9be0", text: `Air ${r?.airC != null ? r.airC.toFixed(1) : "—"}` },
                        ];
                      })()
                    : undefined
                }
                summary="Track and air temperature through the race; minutes from lights out."
              />
              {series.rainy && (
                <div className="mt-1 pl-12 pr-3">
                  <div className="relative h-2 rounded-sm bg-white/5" aria-label="Rain readings through the race" role="img">
                    {weather!.t.map((x, i) =>
                      (weather!.rain[i] ?? 0) > 0 ? (
                        <span key={x} className="absolute inset-y-0 bg-info/70" style={{ left: `${((x - weather!.t[0]) / (weather!.t[weather!.t.length - 1] - weather!.t[0])) * 100}%`, width: "1.2%" }} />
                      ) : null,
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-subtle">Blue: readings with rain.</p>
                </div>
              )}
              <p className="mt-1 text-[11px] text-subtle">Track temperature dropouts (single 0 °C readings) are left out.</p>
            </div>
          )}
        </div>
      )}

      <label className="flex items-start gap-2 border-t border-white/10 px-3 py-2.5 text-xs text-muted">
        <input type="checkbox" className="mt-0.5 size-4" checked={showSectorFlags} onChange={onToggleSectorFlags} disabled={rc.sectorCount == null} />
        <span>
          Show yellow-flag sectors on the circuit <span className="text-warning">(approximate)</span>
          <span className="block text-[11px] text-subtle">
            {rc.sectorCount == null
              ? "No sector flags in this race."
              : `OpenF1 gives the marshal-sector number (1–${rc.sectorCount}), not where it is, so each is drawn as an equal slice of the lap from the line.`}
          </span>
        </span>
      </label>
    </section>
  );
}
