"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

/**
 * One telemetry channel against a shared x axis (distance or time). All rows of the lab share `hoverX`, so the crosshair moves together.
 * Conventions follow components/drivers/charts.tsx: one y axis, 2 px lines, recessive grid, colour only for identity. Nulls leave gaps
 * (missing samples are never drawn through); stepped channels (gear, brake) are drawn as steps, not slopes.
 */
export interface Trace {
  id: string;
  color: string;
  xs: ArrayLike<number>;
  ys: ArrayLike<number | null>;
  stepped?: boolean;
}

interface Props {
  label: string;
  unit: string;
  height: number;
  xDomain: [number, number];
  yDomain: [number, number];
  yTicks: number[];
  yFormat?: (v: number) => string;
  traces: Trace[];
  hoverX: number | null;
  onHover: (x: number | null) => void;
  /** Horizontal reference line (e.g. 0 on the delta chart). */
  reference?: number;
  /** Draw the x axis labels under this row (the last row). */
  xAxis?: { ticks: number[]; format: (v: number) => string };
  /** Accessible description of what the row shows. */
  summary: string;
  /** Each series' value at the cursor, shown beside the label (so the reading stays next to the trace at any screen width). */
  readout?: { color: string; text: string }[];
}

const M = { l: 48, r: 12, t: 8, b: 8 };
const AXIS_H = 22;

export function TraceChart({ label, unit, height, xDomain, yDomain, yTicks, yFormat = String, traces, hoverX, onHover, reference, xAxis, summary, readout }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = height + (xAxis ? AXIS_H : 0);
  const [x0, x1] = xDomain;
  const [y0, y1] = yDomain;
  const sx = (x: number) => M.l + ((x - x0) / (x1 - x0 || 1)) * (W - M.l - M.r);
  const sy = (y: number) => M.t + (1 - (y - y0) / (y1 - y0 || 1)) * (height - M.t - M.b);
  const invert = (px: number) => x0 + ((px - M.l) / (W - M.l - M.r)) * (x1 - x0);

  const path = (t: Trace) => {
    let d = "";
    let pen = false;
    for (let i = 0; i < t.xs.length; i++) {
      const x = t.xs[i];
      const y = t.ys[i];
      if (y == null || x < x0 || x > x1) {
        pen = false;
        continue;
      }
      const X = sx(x).toFixed(1);
      const Y = sy(y).toFixed(1);
      if (!pen) d += `M${X},${Y}`;
      else d += t.stepped ? `H${X}V${Y}` : `L${X},${Y}`;
      pen = true;
    }
    return d;
  };

  const move = (e: PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const v = invert(e.clientX - r.left);
    onHover(v < x0 || v > x1 ? null : v);
  };
  const keys = (e: KeyboardEvent<SVGSVGElement>) => {
    const step = (x1 - x0) / 100;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = (hoverX ?? x0) + (e.key === "ArrowRight" ? step : -step) * (e.shiftKey ? 10 : 1);
      onHover(Math.min(x1, Math.max(x0, next)));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      onHover(e.key === "Home" ? x0 : x1);
    } else if (e.key === "Escape") onHover(null);
  };

  return (
    <div ref={box} className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 pl-12 pr-3">
        <p className="text-xs font-medium text-muted">
          {label} <span className="text-subtle">({unit})</span>
        </p>
        {readout && hoverX != null && (
          <p className="flex gap-3 text-xs font-medium tabular-nums text-fg">
            {readout.map((r, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                <span aria-hidden="true" className="h-0.5 w-3 rounded-full" style={{ backgroundColor: r.color }} />
                {r.text}
              </span>
            ))}
          </p>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block max-w-full touch-none rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-accent-strong"
        role="img"
        aria-label={`${label}. ${summary} Use the left and right arrow keys to move the cursor.`}
        tabIndex={0}
        onPointerMove={move}
        onPointerDown={move}
        onPointerLeave={(e) => e.pointerType === "mouse" && onHover(null)}
        onKeyDown={keys}
      >
        {yTicks.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={sy(t)} y2={sy(t)} stroke="var(--color-line)" strokeWidth="1" />
            <text x={M.l - 6} y={sy(t)} dy="0.32em" textAnchor="end" className="fill-subtle text-[10px] tabular-nums">
              {yFormat(t)}
            </text>
          </g>
        ))}
        {reference != null && <line x1={M.l} x2={W - M.r} y1={sy(reference)} y2={sy(reference)} stroke="var(--color-line-strong)" strokeWidth="1" />}
        {traces.map((t) => (
          <path key={t.id} d={path(t)} fill="none" stroke={t.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {hoverX != null && <line x1={sx(hoverX)} x2={sx(hoverX)} y1={M.t} y2={height - M.b} stroke="var(--color-fg)" strokeOpacity="0.55" strokeWidth="1" />}
        {xAxis &&
          xAxis.ticks.map((t) => (
            <text key={t} x={sx(t)} y={height + 14} textAnchor="middle" className="fill-subtle text-[10px] tabular-nums">
              {xAxis.format(t)}
            </text>
          ))}
      </svg>
    </div>
  );
}

/** Round tick values for an axis: about n steps of 1, 2 or 5 × 10^k. */
export function niceTicks(lo: number, hi: number, n = 4): number[] {
  const span = hi - lo || 1;
  const step = Math.pow(10, Math.floor(Math.log10(span / n)));
  const nice = [1, 2, 5, 10].map((k) => k * step).find((s) => span / s <= n) ?? step * 10;
  const out: number[] = [];
  for (let v = Math.ceil(lo / nice) * nice; v <= hi + 1e-9; v += nice) out.push(Math.round(v * 1000) / 1000);
  return out;
}
