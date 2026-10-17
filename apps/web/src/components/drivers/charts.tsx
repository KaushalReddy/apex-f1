"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Small SVG charts for the driver pages (no chart library in the project). Conventions: one y-axis, 2 px lines, 8 px markers, recessive grid,
 * hover crosshair + tooltip, a legend whenever there are two series, and a data table for every chart. Text uses text tokens; colour only
 * marks identity. Series colours are validated for colour-vision deficiency on the dark surface (driver A #3d9be0, driver B #c4850e).
 */
export const SERIES_A = "#3d9be0";
export const SERIES_B = "#c4850e";

export interface Series {
  id: string;
  label: string;
  color: string;
  /** One value per x position; null leaves a gap (missing data is never interpolated). */
  values: Array<number | null>;
  /** Optional text per x position shown instead of a value (e.g. "DNF"), drawn as a cross in the non-finish band. */
  notes?: Array<string | null>;
}

interface Props {
  title: string;
  summary: string;
  xLabels: string[];
  xNames: string[];
  series: Series[];
  /** Positions: 1 at the top. */
  invert?: boolean;
  yDomain?: [number, number];
  yFormat?: (v: number) => string;
  valueLabel: string;
  /** Join consecutive values with a line (off for positions, where each race is separate). */
  connect?: boolean;
  /** Dumbbell mode: two series drawn as a pair per x, joined by a neutral stem; series 0 hollow, series 1 filled. */
  dumbbell?: boolean;
}

const H = 240;
const M = { l: 40, r: 12, t: 12, b: 28 };

/** Position axes always show P1 (so wins sit on a labelled line) and then a nice step. */
const positionTicks = (lo: number, hi: number) => [lo, ...[5, 10, 15, 20, 25].filter((t) => t > lo && t <= hi)];

function ticks(lo: number, hi: number, n = 4) {
  const span = hi - lo || 1;
  const step = Math.pow(10, Math.floor(Math.log10(span / n)));
  const nice = [1, 2, 5, 10].map((k) => k * step).find((s) => span / s <= n) ?? step * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / nice) * nice; v <= hi + 1e-9; v += nice) out.push(Math.round(v * 1000) / 1000);
  return out;
}

export function Chart({ title, summary, xLabels, xNames, series, invert, yDomain, yFormat = (v) => String(v), valueLabel, connect = true, dumbbell }: Props) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  // Draw at the container's real width so text keeps its size (scaling a fixed viewBox would enlarge it on wide layouts).
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const n = xLabels.length;
  const all = series.flatMap((s) => s.values.filter((v): v is number => v != null));
  const hasNotes = series.some((s) => s.notes?.some(Boolean));
  const [lo, hi] = yDomain ?? [Math.min(0, ...all), Math.max(1, ...all)];
  const plotB = H - M.b - (hasNotes ? 18 : 0);
  const x = (i: number) => M.l + (n <= 1 ? (W - M.l - M.r) / 2 : (i * (W - M.l - M.r)) / (n - 1));
  const y = (v: number) => {
    const t = (v - lo) / (hi - lo || 1);
    return invert ? M.t + t * (plotB - M.t) : plotB - t * (plotB - M.t);
  };
  const labelEvery = Math.max(1, Math.ceil(n / Math.max(4, Math.floor(W / 56))));
  const path = (vals: Array<number | null>) => {
    let d = "";
    let pen = false;
    vals.forEach((v, i) => {
      if (v == null) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  if (n === 0 || series.every((s) => s.values.every((v) => v == null) && !s.notes?.some(Boolean)))
    return (
      <figure className="rounded-lg border border-line bg-surface p-4">
        <figcaption className="eyebrow">{title}</figcaption>
        <p className="mt-2 text-sm text-muted">No data for this season.</p>
      </figure>
    );

  return (
    <figure className="rounded-lg border border-line bg-surface p-4" aria-labelledby={`${id}-t`} aria-describedby={`${id}-s`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <figcaption id={`${id}-t`} className="eyebrow">
          {title}
        </figcaption>
        {(series.length > 1 || dumbbell) && (
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
            {dumbbell ? (
              <>
                <li className="inline-flex items-center gap-1.5">
                  <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="3.5" fill="none" stroke={series[0].color} strokeWidth="2" /></svg>
                  {series[0].label}
                </li>
                <li className="inline-flex items-center gap-1.5">
                  <svg width="10" height="10" aria-hidden="true"><circle cx="5" cy="5" r="4" fill={series[1].color} /></svg>
                  {series[1].label}
                </li>
              </>
            ) : (
              series.map((s) => (
                <li key={s.id} className="inline-flex items-center gap-1.5">
                  <span aria-hidden="true" className="inline-block h-0.5 w-4 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.label}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
      <p id={`${id}-s`} className="mt-1 text-xs text-subtle">
        {summary}
      </p>
      <div ref={box} className="relative mt-2">
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="img" aria-label={`${title}. ${summary}`} onMouseLeave={() => setHover(null)}>
          {(invert ? positionTicks(lo, hi) : ticks(lo, hi)).map((t) => (
            <g key={t}>
              <line x1={M.l} x2={W - M.r} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth="1" />
              <text x={M.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize="10" fill="var(--color-subtle)">
                {invert ? `P${t}` : yFormat(t)}
              </text>
            </g>
          ))}
          {xLabels.map((l, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--color-subtle)">
                {l}
              </text>
            ) : null,
          )}
          {hasNotes && (
            <text x={M.l - 6} y={plotB + 14} textAnchor="end" fontSize="9" fill="var(--color-subtle)">
              Out
            </text>
          )}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={plotB + (hasNotes ? 18 : 0)} stroke="var(--color-line-strong)" strokeWidth="1" />}

          {dumbbell
            ? xLabels.map((_, i) => {
                const a = series[0].values[i];
                const b = series[1].values[i];
                if (a == null || b == null) return null;
                return (
                  <g key={i}>
                    <line x1={x(i)} x2={x(i)} y1={y(a)} y2={y(b)} stroke="var(--color-line-strong)" strokeWidth="2" />
                    <circle cx={x(i)} cy={y(a)} r="4" fill="var(--color-surface)" stroke={series[0].color} strokeWidth="2" />
                    <circle cx={x(i)} cy={y(b)} r="4" fill={series[1].color} stroke="var(--color-surface)" strokeWidth="2" />
                  </g>
                );
              })
            : series.map((s) => (
                <g key={s.id}>
                  {connect && <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
                  {s.values.map((v, i) => (v == null ? null : <circle key={i} cx={x(i)} cy={y(v)} r="4" fill={s.color} stroke="var(--color-surface)" strokeWidth="2" />))}
                  {s.notes?.map((t, i) =>
                    t ? (
                      <g key={`n${i}`} stroke={s.color} strokeWidth="2" strokeLinecap="round">
                        <line x1={x(i) - 3.5} x2={x(i) + 3.5} y1={plotB + 7} y2={plotB + 14} />
                        <line x1={x(i) - 3.5} x2={x(i) + 3.5} y1={plotB + 14} y2={plotB + 7} />
                      </g>
                    ) : null,
                  )}
                </g>
              ))}

          {/* Hover targets: full-height columns, wider than the marks. */}
          {xLabels.map((_, i) => (
            <rect key={i} x={x(i) - (W - M.l - M.r) / Math.max(n - 1, 1) / 2} y={0} width={(W - M.l - M.r) / Math.max(n - 1, 1)} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}
        </svg>
        {hover != null && (
          <div
            role="presentation"
            className="pointer-events-none absolute top-1 z-10 min-w-[9rem] -translate-x-1/2 rounded-md border border-line-strong bg-surface-3 px-2.5 py-1.5 text-xs shadow-2"
            style={{ left: `${(Math.min(Math.max(x(hover), 90), W - 90) / W) * 100}%` }}
          >
            <p className="font-medium text-fg">
              {xLabels[hover]} · {xNames[hover]}
            </p>
            {series.map((s) => {
              const v = s.values[hover];
              const note = s.notes?.[hover];
              return (
                <p key={s.id} className="mt-0.5 flex items-center justify-between gap-3 text-muted">
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden="true" className="inline-block size-2 rounded-full" style={{ backgroundColor: s.color }} />
                    {s.label}
                  </span>
                  <span className="tabular-nums text-fg">{v != null ? (invert ? `P${v}` : yFormat(v)) : note ?? "No result"}</span>
                </p>
              );
            })}
          </div>
        )}
      </div>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-muted hover:text-fg">Data table</summary>
        <div className="mt-2 max-h-64 overflow-auto">
          <table className="w-full text-left tabular-nums">
            <caption className="sr-only">{title}</caption>
            <thead className="text-subtle">
              <tr>
                <th scope="col" className="py-1 pr-3 font-medium">
                  Round
                </th>
                {series.map((s) => (
                  <th key={s.id} scope="col" className="py-1 pr-3 font-medium">
                    {s.label} · {valueLabel}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {xLabels.map((l, i) => (
                <tr key={i}>
                  <th scope="row" className="py-1 pr-3 font-normal text-muted">
                    {l} {xNames[i]}
                  </th>
                  {series.map((s) => (
                    <td key={s.id} className="py-1 pr-3">
                      {s.values[i] != null ? (invert ? `P${s.values[i]}` : yFormat(s.values[i]!)) : s.notes?.[i] ?? "—"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

/** A labelled figure for stat rows. */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="eyebrow">{label}</dt>
      <dd className="mt-1 font-display text-2xl font-semibold leading-none tabular-nums">{value}</dd>
      {/* A second <dd>: a <dl> group may only hold <dt>/<dd> (a <p> here broke the term-value pairing for screen readers). */}
      {hint && <dd className="mt-1 text-[11px] text-subtle">{hint}</dd>}
    </div>
  );
}
