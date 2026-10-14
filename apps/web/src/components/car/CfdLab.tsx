"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { decode, streamlines } from "@/lib/cfd/field";
import {
  ISA,
  compareResults,
  richardson,
  trustLevel,
  validateRequest,
  type CfdResult,
  type CfdSummary,
  type JobState,
  type WingRequest,
} from "@/lib/cfd/model";
import type { SetupParams } from "@/lib/car/lab";
import { cn } from "@/lib/cn";
import { displayRange, legendGradient, paintField, type FieldName } from "./cfdPaint";

interface JobView {
  id: string;
  state: JobState;
  stages: Array<{ state: JobState; at: string }>;
  progress: { iterations: number; maxIterations: number; elapsedS: number; } | null;
  message: string | null;
  resultId: string | null;
}

const fmt = (v: number | null | undefined, digits = 3) =>v == null || !Number.isFinite(v) ? "—" : v.toFixed(digits);
const sci = (v: number) => v.toExponential(3).replace("e+", " × 10^").replace("e-", " × 10^-");
const signed = (v: number, d = 3) => `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v).toFixed(d)}`;

function Row({ k, v, hint }: { k: string; v: ReactNode; hint?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right tabular-nums text-fg">
        {v}
        {hint && <span className="block text-[11px] text-subtle">{hint}</span>}
      </dd>
    </div>
  );
}

/** Computed field (2D), with computed streamlines and a legend carrying the field's unit and range. */
function FieldView({ result, field, lines }: { result: CfdResult; field: FieldName; lines: boolean; }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const decoded = useMemo(() => decode(result.field), [result]);
  const traced = useMemo(() => (lines ? streamlines(decoded, 26) : []), [decoded, lines]);
  const meta = result.field.fields[field];
  const range = useMemo(() => displayRange(field, field === "speed" ? decoded.speed : decoded.cp), [decoded, field]);
  useEffect(() => {
    if (ref.current) paintField(ref.current, decoded, field, range, { lines: traced, scale: 3 });
  }, [decoded, field, range, traced]);
  const [x0, x1, y0, y1] = result.field.window;
  const unitLen = result.reference.lengthM;
  return (
    <figure>
      <canvas
        ref={ref}
        role="img"
        aria-label={`${field === "speed" ? "Velocity magnitude" : "Pressure coefficient"} computed by SU2 around the section; range ${fmt(meta.min)} to ${fmt(meta.max)} ${meta.unit}`}
        className="block w-full rounded-md bg-[#0c0f14]"
        style={{ aspectRatio: `${x1 - x0} / ${y1 - y0}` }}
      />
      <figcaption className="mt-2 text-xs text-muted">
        <span aria-hidden="true" className="block h-2 w-full rounded-full" style={{ background: legendGradient(field) }} />
        <span className="mt-1 flex justify-between gap-2 tabular-nums">
          <span>
            {fmt(range[0], 2)} {meta.unit}
          </span>
          <span>{field === "cp" ? "0 (free-stream pressure)" : `${meta.unit}`}</span>
          <span>
            {fmt(range[1], 2)} {meta.unit}
          </span>
        </span>
        <span className="mt-1 block text-subtle">
          Field min {fmt(meta.min)} · max {fmt(meta.max)} {meta.unit}; colours span the {field === "cp" ? "2nd–98th" : "0–99th"} percentile range, with values beyond it in the end colours. Flow left to right. Window {" "}
          {fmt((x1 - x0) / unitLen, 2)} × {fmt((y1 - y0) / unitLen, 2)}{" "} reference
          chords, sampled on a {result.field.nx} × {result.field.ny}{" "} grid from the solver mesh.{lines && " White lines: streamlines traced through the computed velocity field."}
        </span>
      </figcaption>
    </figure>
  );
}

/** Surface pressure coefficient vs x/c (negative up, the usual convention), with the published reference for the benchmark. */
function CpPlot({ result, reference }: { result: CfdResult; reference: Array<[number, number]> | null; }) {
  const W = 360;
  const H = 200;
  const lref = result.reference.lengthM;
  const all = Object.values(result.surface).flatMap((s) => s.cp);
  const lo = Math.min(...all, ...(reference ?? []).map((p) => p[1]));
  const hi = Math.max(...all, ...(reference ?? []).map((p) => p[1]));
  const xs = Object.values(result.surface).flatMap((s) => s.x.map((x) => x / lref));
  const xmin = Math.min(0, ...xs);
  const xmax = Math.max(1, ...xs);
  const X = (x: number) => 30 + ((x - xmin) / (xmax - xmin)) * (W - 40);
  const Y = (cp: number) => 10 + ((cp - lo) / (hi - lo || 1)) * (H - 30); // Cp increases downwards
  const colours = ["#5cb8ff", "#f5b83d"];
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Surface pressure coefficient along the section, from ${fmt(lo, 2)} to ${fmt(hi, 2)}`}>
        <line x1={30} x2={W - 10} y1={Y(0)} y2={Y(0)} stroke="var(--color-line-strong)" />
        <text x={26} y={Y(0) + 3} textAnchor="end" fontSize="9" fill="var(--color-subtle)">
          0
        </text>
        {Math.abs(Y(lo) - Y(0)) > 12 && (
          <text x={26} y={Y(lo) + 6} textAnchor="end" fontSize="9" fill="var(--color-subtle)">
            {fmt(lo, 1)}
          </text>
        )}
        {Math.abs(Y(hi) - Y(0)) > 12 && (
          <text x={26} y={Y(hi)} textAnchor="end" fontSize="9" fill="var(--color-subtle)">
            {fmt(hi, 1)}
          </text>
        )}
        {reference?.map(([x, cp], i) =>i % 4 === 0 ? ( <circle key={i} cx={X(x)} cy={Y(cp)} r={1.2} fill="var(--color-muted)" />
          ) : null)}
        {Object.entries(result.surface).map(([name, s], k) => (
          <g key={name}>
            {s.x.map((x, i) => (
              <circle key={i} cx={X(x / lref)} cy={Y(s.cp[i])} r={1.6} fill={colours[k % 2]} />
            ))}
          </g>
        ))}
        <text x={W / 2} y={H - 4} textAnchor="middle" fontSize="9" fill="var(--color-subtle)">
          x / reference chord
        </text>
      </svg>
      <figcaption className="flex flex-wrap gap-x-4 text-xs text-muted">
        {Object.keys(result.surface).map((n, k) => (
          <span key={n} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full" style={{ backgroundColor: colours[k % 2] }} />
            {n === "airfoil" ? "SU2 (this run)" : n.replace("wing_", "")}
          </span>
        ))}
        {reference && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-2 rounded-full bg-muted" />
            NASA TMR, CFL3D 897×257
          </span>
        )}
        <span className="text-subtle">Cp, negative (suction) up.</span>
      </figcaption>
    </figure>
  );
}

type CfdTab = "flow" | "pressure" | "forces" | "run" | "case";

interface Props {
  setups: { a: SetupParams; b: SetupParams };
  /** Show a computed slice on the 3D car (rear-wing results only), or null to remove it. */
  onShowInCar: (result: CfdResult | null, field: FieldName) => void;
}

/**
 * CFD in the Car Lab: real SU2 solutions (see tools/cfd) for a 2D section of the rear wing and the NACA 0012 verification benchmark.
 * Nothing here computes flow: it lists, displays and compares solver results, and can request new runs where the solver is installed.
 */
export function CfdLab({ setups, onShowInCar }: Props) {
  const id = useId();
  const [shipped, setShipped] = useState<CfdSummary[]>([]);
  const [local, setLocal] = useState<CfdSummary[]>([]);
  const [runner, setRunner] = useState<{ available: boolean } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [compareTo, setCompareTo] = useState<string>("");
  const [cache, setCache] = useState<Record<string, CfdResult>>({});
  const [field, setField] = useState<FieldName>("cp");
  const [lines, setLines] = useState(true);
  const [onCar, setOnCar] = useState(false);
  const [tab, setTab] = useState<CfdTab>("forces");
  const [reference, setReference] = useState<Record<string, Array<[number, number]>> | null>(null);
  const [form, setForm] = useState<{ config: "a" | "b"; speedMps: number; meshLevel: "coarse" | "medium"; }>({ config: "a", speedMps: 50, meshLevel: "coarse" });
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch("/cfd/index.json");
      if (r.ok) setShipped(((await r.json()) as CfdSummary[]).map((s) => ({ ...s, origin: "shipped" as const })));
    } catch {
      /* no shipped results */
    }
    try {
      const r = await fetch("/api/cfd/results");
      if (r.ok) setLocal(((await r.json()) as { local: CfdSummary[] }).local);
      const s = await fetch("/api/cfd/status");
      setRunner(s.ok ? ((await s.json()) as { available: boolean }) : { available: false });
    } catch {
      setRunner({ available: false }); // static hosting: no API
    }
  }, []);
  useEffect(() => {
    void Promise.resolve().then(refresh);
  }, [refresh]);

  const all = useMemo(() => [...local, ...shipped.filter((s) => !local.some((l) => l.caseId === s.caseId))], [local, shipped]);
  const current = selected ?? all.find((s) => s.kind === "rear-wing-section")?.caseId ?? all[0]?.caseId ?? null;

  const load = useCallback(
    async (caseId: string) => {
      if (cache[caseId]) return cache[caseId];
      const s = all.find((x) => x.caseId === caseId);
      const r = await fetch(s?.origin === "local" ? `/api/cfd/results/${caseId}` : `/cfd/${caseId}.json`);
      if (!r.ok) throw new Error("result not found");
      const res = { ...((await r.json()) as CfdResult), origin: s?.origin };
      setCache((c) => ({ ...c, [caseId]: res }));
      return res;
    },
    [all, cache],
  );
  useEffect(() => {
    if (current && !cache[current]) void Promise.resolve(current).then(load).catch(() => setError("Could not load that result."));
  }, [current, cache, load]);
  useEffect(() => {
    if (compareTo && !cache[compareTo]) void Promise.resolve(compareTo).then(load).catch(() => setError("Could not load that result."));
  }, [compareTo, cache, load]);
  useEffect(() => {
    if (!reference && all.some((s) => s.kind === "benchmark-naca0012"))
      void fetch("/cfd/reference/tmr-n0012-cp.json")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setReference(d.byAlpha));
  }, [all, reference]);

  const result = current ? cache[current] : undefined;
  const isWing = result?.kind === "rear-wing-section";
  useEffect(() => {
    onShowInCar(onCar && result && isWing ? result : null, field);
  }, [onCar, result, isWing, field, onShowInCar]);

  // Job polling: one request every two seconds until the job reaches a terminal state.
  useEffect(() => {
    if (!job || ["completed", "failed", "cancelled"].includes(job.state)) return;
    const t = setTimeout(async () => {
      const r = await fetch(`/api/cfd/jobs/${job.id}`);
      if (!r.ok) return;
      const next = (await r.json()) as JobView;
      setJob(next);
      if (next.state === "completed" && next.resultId) {
        await refresh();
        setSelected(next.resultId);
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [job, refresh]);

  const request: WingRequest = {
    kind: "rear-wing-section",
    label: `Config ${form.config.toUpperCase()}: main ${setups[form.config].rearMainDeg}°, flap ${setups[form.config].rearFlapDeg}°${setups[form.config].lowDrag ? " (low-drag mode off: CFD uses the set angles)" : ""}`,
    speedMps: form.speedMps,
    ...ISA,
    wings: { rearMainDeg: setups[form.config].rearMainDeg, rearFlapDeg: setups[form.config].rearFlapDeg },
    meshLevel: form.meshLevel,
  };
  const problems = validateRequest(request);
  const submit = async () => {
    setError(null);
    const r = await fetch("/api/cfd/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
    const body = await r.json();
    if (!r.ok) return setError(body.error ?? "The request was rejected.");
    if (body.cached) {
      setSelected(body.cached.caseId);
      setError(null);
      setJob(null);
      return;
    }
    setJob({ id: body.jobId, state: "queued", stages: [], progress: null, message: null, resultId: null });
  };

  const benchmarks = all.filter((s) => s.kind === "benchmark-naca0012" && s.status.solverCompleted).sort((a, b) => GRID_ORDER.indexOf(a.meshLevel) - GRID_ORDER.indexOf(b.meshLevel));
  const wings = all.filter((s) => s.kind === "rear-wing-section");
  const other = compareTo ? cache[compareTo] : undefined;
  const comparison = result && other ? compareResults(result, other) : null;
  const trust = result ? trustLevel(result) : null;

  // "Runs": new solver runs (only where the solver is installed) and comparison of compatible results.
  const runPanel = result && (
    <div className="space-y-3">
      <div className="rounded-md border border-white/10 p-3">
            <p className="eyebrow">Run a simulation</p>
            {runner === null ? (
              <p className="mt-2 text-sm text-muted">Checking for a solver…</p>
            ) : !runner.available ? (
              <p className="mt-2 text-sm text-muted">
                The SU2 solver is not available on this server, so new cases cannot be run here. Install it with{" "} <code className="text-fg">tools/cfd/setup.sh</code> and start
                the app with <code className="text-fg">APEX_CFD_RUNNER=1</code>. The results listed above were computed by SU2 and are shown as stored.
              </p>
            ) : (
              <div className="mt-2 space-y-2 text-sm">
                <div role="radiogroup" aria-label="Wing configuration" className="grid grid-cols-2 gap-1.5">
                  {(["a", "b"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={form.config === k}
                      onClick={() => setForm((f) => ({ ...f, config: k }))}
                      className={cn("rounded-md border px-2 py-1.5 text-left", form.config === k ? "border-accent/70 bg-surface-2" : "border-line text-muted")}
                    >
                      Config {k.toUpperCase()}
                      <span className="block text-xs text-subtle">
                        main {setups[k].rearMainDeg}° · flap {setups[k].rearFlapDeg}°
                      </span>
                    </button>
                  ))}
                </div>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-muted">Air speed (m/s)</span>
                  <input
                    type="number"
                    min={5}
                    max={100}
                    step={1}
                    value={form.speedMps}
                    onChange={(e) => setForm((f) => ({ ...f, speedMps: Number(e.target.value) }))}
                    className="h-8 w-24 rounded-md border border-line-strong bg-surface-2 px-2 text-right tabular-nums"
                  />
                </label>
                <label className="flex items-center justify-between gap-2">
                  <span className="text-muted">Mesh</span>
                  <select
                    value={form.meshLevel}
                    onChange={(e) => setForm((f) => ({ ...f, meshLevel: e.target.value as "coarse" | "medium" }))}
                    className="h-8 rounded-md border border-line-strong bg-surface-2 px-2"
                  >
                    <option value="coarse">Coarse (minutes)</option>
                    <option value="medium">Medium (about an hour)</option>
                  </select>
                </label>
                <p className="text-xs text-subtle">
                  Air: ISA sea level ({ISA.densityKgM3} kg/m³, {ISA.temperatureK} K, μ = {ISA.viscosityPaS} Pa·s). Only the rear-wing angles reach the solver; the front-wing angle
                  and the low-drag mode are not part of the 2D section.
                </p>
                {problems.length > 0 && (
                  <ul className="text-xs text-danger" role="alert">
                    {problems.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
                <Button size="sm" disabled={problems.length > 0 || (job !== null && !["completed", "failed", "cancelled"].includes(job.state))} onClick={submit}>
                  Run SU2
                </Button>
                {job && (
                  <div className="rounded-md bg-surface-2 p-2 text-xs" aria-live="polite">
                    <p className="font-medium text-fg">
                      Job {job.state}
                      {job.progress && job.state === "solving" && ` · iteration ${job.progress.iterations} of at most ${job.progress.maxIterations} · ${job.progress.elapsedS} s`}
                    </p>
                    {job.message && ( <p className="mt-1 text-muted">{job.message}</p>
                )}
                    <ol className="mt-1 flex flex-wrap gap-x-2 text-subtle">
                      {job.stages.map((s, i) => (
                        <li key={i}>{s.state}</li>
                      ))}
                    </ol>
                    {!["completed", "failed", "cancelled"].includes(job.state) && (
                      <Button size="sm" variant="ghost" className="mt-1 h-7 px-2" onClick={() => fetch(`/api/cfd/jobs/${job.id}`, { method: "DELETE" })}>
                        Cancel
                      </Button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

            {isWing && (
              <div className="rounded-md border border-white/10 p-3 text-sm">
                <label className="flex flex-wrap items-center gap-2">
                  <span className="eyebrow">Compare with</span>
                  <select value={compareTo} onChange={(e) => setCompareTo(e.target.value)} className="h-8 rounded-md border border-line-strong bg-surface-2 px-2">
                    <option value="">Choose a rear-wing result</option>
                    {wings
                      .filter((w) => w.caseId !== current)
                      .map((w) => (
                        <option key={w.caseId} value={w.caseId}>
                          {w.label} · {w.meshLevel}
                        </option>
                      ))}
                  </select>
                </label>
                {comparison && other && (
                  <div className="mt-2">
                    {!comparison.comparable ? (
                      <p className="text-muted">Not comparable: {comparison.reasons.join(", ")}. Only converged results with the same conditions, mesh level and solver are compared.</p>
                    ) : (
                      <table className="w-full text-sm tabular-nums">
                        <caption className="sr-only">Selected result compared with {other.label}</caption>
                        <thead className="text-[11px] uppercase tracking-wider text-subtle">
                          <tr>
                            <th scope="col" className="py-1 text-left font-medium">Quantity</th>
                            <th scope="col" className="py-1 text-right font-medium">{result.label}</th>
                            <th scope="col" className="py-1 text-right font-medium">{other.label}</th>
                            <th scope="col" className="py-1 text-right font-medium">Difference</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          <tr>
                            <th scope="row" className="py-1 text-left font-normal text-muted">Downforce coefficient C_DF</th>
                            <td className="py-1 text-right">{fmt(-result.coefficients.CL, 4)}</td>
                            <td className="py-1 text-right">{fmt(-other.coefficients.CL, 4)}</td>
                            <td className="py-1 text-right">{signed(-comparison.dCL, 4)}</td>
                          </tr>
                          <tr>
                            <th scope="row" className="py-1 text-left font-normal text-muted">Drag coefficient C_D</th>
                            <td className="py-1 text-right">{fmt(result.coefficients.CD, 5)}</td>
                            <td className="py-1 text-right">{fmt(other.coefficients.CD, 5)}</td>
                            <td className="py-1 text-right">{signed(comparison.dCD, 5)}</td>
                          </tr>
                          <tr>
                            <th scope="row" className="py-1 text-left font-normal text-muted">Downforce (N/m of span)</th>
                            <td className="py-1 text-right">{fmt(result.forcesPerSpan?.downforceNPerM, 1)}</td>
                            <td className="py-1 text-right">{fmt(other.forcesPerSpan?.downforceNPerM, 1)}</td>
                            <td className="py-1 text-right">{comparison.dDownforceNPerM == null ? "—" : signed(comparison.dDownforceNPerM, 1)}</td>
                          </tr>
                          <tr>
                            <th scope="row" className="py-1 text-left font-normal text-muted">Drag (N/m of span)</th>
                            <td className="py-1 text-right">{fmt(result.forcesPerSpan?.dragNPerM, 1)}</td>
                            <td className="py-1 text-right">{fmt(other.forcesPerSpan?.dragNPerM, 1)}</td>
                            <td className="py-1 text-right">{comparison.dDragNPerM == null ? "—" : signed(comparison.dDragNPerM, 1)}</td>
                          </tr>
                        </tbody>
                      </table>
                    )}
                    <p className="mt-1 text-xs text-subtle">
                      Differences of the 2D section only (per metre of span, same air speed and mesh). They are not the change in the car&apos;s total downforce or drag, and no lap time
                      follows from them.
                    </p>
                  </div>
                )}
              </div>
            )}

            </div>
  );
  // "Case": how the result was produced and what it may claim.
  const casePanel = result && (
    <div className="space-y-3">
      <dl className="divide-y divide-white/10 text-sm">
        <Row
          k="Model"
          v={result.model.equations}
          hint={`Turbulence: ${result.model.turbulence}`}
        />
        <Row
          k="Mesh"
          v={`${result.mesh.cells.toLocaleString()} cells · ${result.mesh.nodes.toLocaleString()} nodes`}
          hint={`${String(result.mesh.generator ?? "")} · ${result.mesh.level}${result.mesh.firstCellHeightM ? ` · first cell ${sci(Number(result.mesh.firstCellHeightM))} m` : ""}`}
        />
        {result.yPlus && (
          <Row
            k="Wall y+"
            v={`mean ${fmt(result.yPlus.mean, 2)} · max ${fmt(result.yPlus.max, 2)}`}
            hint="Target ≈ 1 for the SA model without wall functions"
          />
        )}
        <Row
          k="Iterations"
          v={`${result.convergence.iterations}${result.convergence.maxIterations ? ` of ${result.convergence.maxIterations}` : ""}`}
          hint={`Stopped by: ${result.convergence.terminatedBy ?? "—"}`}
        />
        <Row
          k="Residual drop (orders)"
          v={
            Object.values(result.convergence.residualDropOrders ?? {}).length
              ? fmt(
                  Math.min(
                    ...Object.values(
                      result.convergence.residualDropOrders ?? {},
                    ),
                  ),
                  1,
                )
              : "—"
          }
          hint={`smallest over ${Object.keys(result.convergence.residualDropOrders ?? {}).join(", ")}`}
        />
        <Row
          k="Force stability"
          v={
            result.convergence.forceStability
              ? `C_L ${fmt(result.convergence.forceStability.CL.relativeRange ?? 0, 6)} · C_D ${fmt(result.convergence.forceStability.CD.relativeRange ?? 0, 6)}`
              : "—"
          }
          hint={`relative range over the last ${result.convergence.rules?.window ?? "—"} iterations (rule: ≤ ${result.convergence.rules?.relativeRange ?? "—"})`}
        />
        <Row
          k="Run time"
          v={`${Math.round(result.durationS)} s`}
          hint={result.solver.build}
        />
      </dl>
      {!isWing && (
        <BenchmarkStudy runs={benchmarks} cache={cache} load={load} />
      )}
      <details className="text-xs text-muted">
              <summary className="cursor-pointer hover:text-fg">Physical model, boundary conditions and limitations</summary>
              <ul className="mt-2 list-disc space-y-1 pl-4 leading-relaxed">
                <li>
                  {isWing
                    ? "Steady incompressible RANS: ∇·u = 0, ρ(u·∇)u = −∇p + ∇·[(μ + μ_t)(∇u + ∇uᵀ)], constant density and viscosity; μ_t from the Spalart-Allmaras model as implemented in SU2."
                    : "Steady compressible RANS (SU2 RANS solver) with the Spalart-Allmaras model, at M = 0.15 and Re = 6 × 10^6, the NASA TMR conditions."}
                </li>
                <li>
                  Boundaries: no-slip adiabatic walls on each element; a far-field boundary on a circle{" "} {isWing ? "25 reference chords" : "about 500 chords"} away, at free-stream conditions.
                  {isWing && " No ground plane, so no ground effect; nothing rotates."}
                </li>
                <li>
                  Coefficients: C = F / (q A_ref) with q = ½ ρ U∞² and, in 2D, A_ref = c_ref × 1 m. Forces are SU2&apos;s integral of pressure and viscous stress over the walls,
                  ∫(−p n + τ·n) dS. Lift is the component normal to the free stream (+y up); downforce = −lift. Pressure coefficient Cp = (p − p∞) / q.
                </li>
                <li>
                  Convergence rules (stated before any results were computed): forces steady to {result.convergence.rules?.relativeRange ?? "—"} relative over the last {result.convergence.rules?.window ?? "—"} iterations,
                  and every residual down at least {" "}
            {result.convergence.rules?.minResidualDropOrders ?? "—"} orders of magnitude. SU2&apos;s own stopping test is a Cauchy criterion on C_L and C_D.
                </li>
                {result.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
                <li>Full-car 3D CFD is not available: the procedural car is many overlapping, open surfaces rather than one watertight body, and a credible 3D turbulent run needs far more memory and time than this setup has.</li>
              </ul>
            </details>
          </div>
        );

  const optionLabel = (s: CfdSummary) =>
    `${s.label ?? s.caseId.slice(0, 8)} · ${s.kind === "rear-wing-section" ? `${s.meshLevel} mesh` : s.meshLevel}${s.status.converged ? "" : " · not converged"}`;
  const tabs: Array<[CfdTab, string]> = [
    ["flow", "Flow"],
    ["pressure", "Pressure"],
    ["forces", "Forces"],
    ["run", "Runs"],
    ["case", "Case"],
  ];

  return (
    <section aria-labelledby={`${id}-h`} className="text-sm">
      {/* Compact header: what is shown, how far it can be trusted, the headline numbers and the link to the car. */}
      <div className="space-y-2 border-b border-white/10 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${id}-h`} className="eyebrow">
            CFD · SU2 {result?.solver.version ?? "8.5.0"}
          </h2>
          <span className="text-[11px] text-subtle">
            2D sections, computed by the solver
          </span>
        </div>
        {all.length === 0 ? (
          <p className="text-muted">No CFD results in this build.</p>
        ) : (
          <label className="flex flex-col gap-1">
            <span className="sr-only">CFD case</span>
            <select
              value={current ?? ""}
              onChange={(e) => setSelected(e.target.value)}
              className="h-9 w-full rounded-md border border-line-strong bg-surface-2 px-2 text-sm text-fg"
            >
              {wings.length > 0 && (
                <optgroup label="Rear-wing section">
                  {wings.map((w) => (
                    <option key={w.caseId} value={w.caseId}>
                      {optionLabel(w)}
                    </option>
                  ))}
                </optgroup>
              )}
              {benchmarks.length > 0 && (
                <optgroup label="Verification benchmark (NACA 0012)">
                  {benchmarks.map((w) => (
                    <option key={w.caseId} value={w.caseId}>
                      {optionLabel(w)}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
        )}
        {result && (
          <>
            <div className="flex flex-wrap gap-1.5">
              {trust && <Badge tone={trust.tone}>{trust.label}</Badge>}
              <Badge tone="neutral">
                {result.origin === "local" ? "Computed here" : "Shipped run"}
              </Badge>
            </div>
            <dl
              className="grid grid-cols-3 overflow-hidden rounded-md border border-white/10 tabular-nums"
              style={{ gap: 1 }}
            >
              {(isWing
                ? [
                    ["C_DF", fmt(-result.coefficients.CL, 3), "−C_L"],
                    ["C_D", fmt(result.coefficients.CD, 4), ""],
                    [
                      "Downforce",
                      result.forcesPerSpan
                        ? `${fmt(result.forcesPerSpan.downforceNPerM, 0)} N/m`
                        : "—",
                      "per m span",
                    ],
                  ]
                : [
                    ["C_L", fmt(result.coefficients.CL, 4), ""],
                    ["C_D", fmt(result.coefficients.CD, 5), ""],
                    ["Grid", result.mesh.level, ""],
                  ]
              ).map(([k, v, h]) => (
                <div key={k} className="bg-surface/60 px-2 py-1.5">
                  <dt className="text-[10px] uppercase tracking-wider text-subtle">
                    {k}
                  </dt>
                  <dd className="font-display text-base font-semibold leading-tight">
                    {v}
                  </dd>
                  {h && <p className="text-[10px] text-subtle">{h}</p>}
      </div>
              ))}
            </dl>
            {!result.status.converged && (
              <p className="text-xs text-warning">
                Provisional: {result.convergence.reasons.join("; ")}.
              </p>
            )}
            {isWing && (
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={onCar}
                  onChange={(e) => setOnCar(e.target.checked)}
                  className="size-3.5 accent-[var(--color-accent)]"
                />
                Show the computed {field === "cp" ? "pressure" : "velocity"}{" "}
                field on the car (slice at z = {result.transform?.z} m)
              </label>
            )}
          </>
        )}
      </div>

      {result && (
        <>
          <div
            role="tablist"
            aria-label="CFD views"
            className="flex gap-0.5 overflow-x-auto border-b border-white/10 px-1.5 py-1 [scrollbar-width:none]"
          >
            {tabs.map(([t, label]) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => {
                  setTab(t);
                  if (t === "flow") setField("speed");
                  if (t === "pressure") setField("cp");
                }}
                className={cn(
                  "motion-interactive h-8 shrink-0 rounded-md px-2.5 text-xs font-medium",
                  tab === t
                    ? "bg-white/10 text-fg"
                    : "text-muted hover:bg-white/5 hover:text-fg",
                )}
              >
                {label}
              </button>
            ))}
          </div>

          <div
            role="tabpanel"
            aria-label={tabs.find(([t]) => t === tab)?.[1]}
            className="space-y-3 p-3"
          >
            {tab === "flow" && (
              <>
                <label className="flex items-center gap-1.5 text-xs text-muted">
                  <input
                    type="checkbox"
                    checked={lines}
                    onChange={(e) => setLines(e.target.checked)}
                    className="size-3.5 accent-[var(--color-accent)]"
                  />
                  Streamlines (traced through the computed velocity)
                </label>
                <FieldView result={result} field="speed" lines={lines} />
              </>
            )}
            {tab === "pressure" && (
              <>
                <FieldView result={result} field="cp" lines={false} />
                <CpPlot
                  result={result}
                  reference={
                    !isWing && reference
                      ? (reference[
                          String(Math.round(result.conditions.aoaDeg))
                        ] ?? null)
                      : null
                  }
                />
              </>
            )}
            {tab === "forces" && (
              <dl className="divide-y divide-white/10">
                <Row
                  k="Lift coefficient C_L (+y up)"
                  v={fmt(result.coefficients.CL, 4)}
                  hint={
                    isWing
                      ? `Downforce coefficient C_DF = −C_L = ${fmt(-result.coefficients.CL, 4)}`
                      : undefined
                  }
                />
                <Row
                  k="Drag coefficient C_D"
                  v={fmt(result.coefficients.CD, 5)}
                />
                {result.forcesPerSpan && (
                  <>
                    <Row
                      k="Downforce"
                      v={`${fmt(result.forcesPerSpan.downforceNPerM, 1)} N/m`}
                      hint="per metre of span: −C_L q c_ref"
                    />
                    <Row
                      k="Drag"
                      v={`${fmt(result.forcesPerSpan.dragNPerM, 1)} N/m`}
                    />
                  </>
                )}
                {result.perElement &&
                  Object.entries(result.perElement).map(([n, c]) => (
                    <Row
                      key={n}
                      k={`${n.replace("wing_", "")} element`}
                      v={`C_L ${fmt(c.CL, 3)} · C_D ${fmt(c.CD, 4)}`}
                    />
                  ))}
                <Row
                  k="Reynolds number"
                  v={sci(result.derived.reynolds)}
                  hint={
                    isWing
                      ? `ρ U c_ref / μ, c_ref = ${result.reference.lengthM} m`
                      : "per chord"
                  }
                />
                <Row k="Mach number" v={fmt(result.derived.mach, 3)} />
                {isWing ? (
                  <Row
                    k="Conditions"
                    v={`${result.conditions.speedMps} m/s · ${result.conditions.densityKgM3} kg/m³`}
                    hint={`q = ${fmt(result.derived.dynamicPressurePa, 1)} Pa`}
                  />
                ) : (
                  <Row
                    k="Conditions"
                    v={`α = ${result.conditions.aoaDeg}°`}
                    hint="M = 0.15, Re = 6 × 10^6 (NASA TMR case)"
                  />
                )}
              </dl>
            )}
            {tab === "run" && runPanel}
            {tab === "case" && casePanel}
          </div>
        </>
      )}
      {error && (
        <p className="px-3 pb-3 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

const GRID_ORDER = ["113x33", "225x65", "449x129"];

/** Grid-convergence study for the benchmark: the three published TMR grids, Richardson extrapolation and the NASA reference values. */
function BenchmarkStudy({ runs, cache, load }: { runs: CfdSummary[]; cache: Record<string, CfdResult>; load: (id: string) => Promise<CfdResult>; }) {
  useEffect(() => {
    for (const r of runs) if (!cache[r.caseId]) void load(r.caseId).catch(() => {});
  }, [runs, cache, load]);
  const full = runs.map((r) => cache[r.caseId]).filter(Boolean);
  const ref = full.find((r) => r.verification)?.verification?.reference;
  const ordered = GRID_ORDER.map((g) => full.find((r) => r.mesh.level === g)).filter((r): r is CfdResult => !!r);
  const rich =
    ordered.length === 3
      ? { CL: richardson(ordered[0].coefficients.CL, ordered[1].coefficients.CL, ordered[2].coefficients.CL), CD: richardson(ordered[0].coefficients.CD, ordered[1].coefficients.CD, ordered[2].coefficients.CD) }
      : null;
  const pct = (v: number, r: number) => `${signed(((v - r) / r) * 100, 1)} %`;
  return (
    <div className="rounded-md border border-line p-3 text-sm">
      <p className="eyebrow">Verification: grid study against published results (α = 10°)</p>
      <table className="mt-2 w-full tabular-nums">
        <caption className="sr-only">SU2 results on three grids compared with NASA TMR reference values</caption>
        <thead className="text-[11px] uppercase tracking-wider text-subtle">
          <tr>
            <th scope="col" className="py-1 text-left font-medium">Grid</th>
            <th scope="col" className="py-1 text-right font-medium">Cells</th>
            <th scope="col" className="py-1 text-right font-medium">C_L</th>
            <th scope="col" className="py-1 text-right font-medium">C_D</th>
            <th scope="col" className="py-1 text-right font-medium">Converged</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {ordered.map((r) => (
            <tr key={r.caseId}>
              <th scope="row" className="py-1 text-left font-normal">{r.mesh.level}</th>
              <td className="py-1 text-right">{r.mesh.cells.toLocaleString()}</td>
              <td className="py-1 text-right">{fmt(r.coefficients.CL, 4)}</td>
              <td className="py-1 text-right">{fmt(r.coefficients.CD, 5)}</td>
              <td className="py-1 text-right">{r.status.converged ? "yes" : "no"}</td>
            </tr>
          ))}
          {rich && (
            <tr>
              <th scope="row" className="py-1 text-left font-normal text-muted">Richardson extrapolation</th>
              <td className="py-1 text-right text-subtle">—</td>
              <td className="py-1 text-right">{rich.CL ? fmt(rich.CL.extrapolated, 4) : "not monotonic"}</td>
              <td className="py-1 text-right">{rich.CD ? fmt(rich.CD.extrapolated, 5) : "not monotonic"}</td>
              <td className="py-1 text-right text-subtle">
                p = {rich.CL ? fmt(rich.CL.order, 2) : "—"} / {" "}
                {rich.CD ? fmt(rich.CD.order, 2) : "—"}
              </td>
            </tr>
          )}
          {ref?.values && (
            <tr>
              <th scope="row" className="py-1 text-left font-normal text-muted">
                NASA TMR: {ref.code} {ref.grid}
              </th>
              <td className="py-1 text-right text-subtle">—</td>
              <td className="py-1 text-right">{fmt(ref.values.CL, 4)}</td>
              <td className="py-1 text-right">{fmt(ref.values.CD, 5)}</td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
      {ref?.values && ordered.length > 0 && (
        <p className="mt-2 text-xs text-muted">
          Finest grid here ({ordered[ordered.length - 1].mesh.level}) vs {" "}
          {ref.code} on {ref.grid}: C_L{" "} {pct(ordered[ordered.length - 1].coefficients.CL, ref.values.CL)}, C_D{" "}
          {pct(ordered[ordered.length - 1].coefficients.CD, ref.values.CD)}.
          {rich?.CL && rich.CD && ` Extrapolated: C_L ${pct(rich.CL.extrapolated, ref.values.CL)}, C_D ${pct(rich.CD.extrapolated, ref.values.CD)}.`}{" "} Other codes on the 897×257 grid span C_L{" "}
          {fmt(Math.min(...Object.values(ref.otherCodesAlpha10).map((v) => v[0])), 4)}–{fmt(Math.max(...Object.values(ref.otherCodesAlpha10).map((v) => v[0])), 4)}, C_D{" "}
          {fmt(Math.min(...Object.values(ref.otherCodesAlpha10).map((v) => v[1])), 5)}–{fmt(Math.max(...Object.values(ref.otherCodesAlpha10).map((v) => v[1])), 5)}.{" "}
          <a href={ref.url} className="underline underline-offset-4 hover:text-accent-strong">
            Source
          </a>
          . This is code-to-code verification, not validation against experiment.
        </p>
      )}
    </div>
  );
}
