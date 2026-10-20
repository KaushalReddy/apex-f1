import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  PIPELINE_VERSION,
  SOLVER,
  TERMINAL,
  rearWingSection,
  summarize,
  validateRequest,
  type CfdRequest,
  type CfdResult,
  type CfdSummary,
  type JobState,
} from "./model";

/**
 * Server-only CFD job store and runner. Jobs live in apps/web/.cfd/jobs/<id>/ (gitignored): case.json (written here), status.json and
 * result.json (written by the Python runner). Results shipped with the app live in public/cfd/. The runner is started with a fixed
 * interpreter, a fixed module and the job directory as its only argument: no shell and no request text on the command line.
 * At most one solver job runs at a time (the machine has 8 GB of memory); further jobs wait in a queue.
 */
const WEB = process.cwd();
const ROOT = path.resolve(WEB, "../..");
const TOOLS = path.join(ROOT, "tools", "cfd");
const PYTHON = path.join(TOOLS, ".local", "venv", "bin", "python");
const SU2 = path.join(TOOLS, ".local", "su2", "bin", "SU2_CFD");
const MAX_QUEUED = 5;
const JOBS = path.join(WEB, ".cfd", "jobs");
const SHIPPED = path.join(WEB, "public", "cfd");

/** Solver jobs need the local toolchain (tools/cfd/setup.sh) and are off unless enabled, so a deployed site never runs processes. */
export const runnerAvailable = () => process.env.APEX_CFD_RUNNER === "1" && existsSync(PYTHON) && existsSync(SU2);

const stable = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(stable).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v);

/** Cache key: every input that can change the solution (case kind, model, conditions, geometry, mesh, limits, solver, pipeline). */
export const cacheKey = (c: Omit<CaseFile, "id" | "cacheKey" | "label">) => createHash("sha256").update(stable(c)).digest("hex").slice(0, 32);

export interface CaseFile {
  schema: "apex-f1/cfd-case@1";
  id: string;
  cacheKey: string;
  kind: CfdRequest["kind"];
  label?: string;
  solver: typeof SOLVER;
  pipeline: string;
  model: { equations: string; turbulence: string; regime: string };
  conditions: Record<string, number>;
  geometry?: Record<string, unknown>;
  reference?: { lengthM: number };
  mesh: { level: string };
  limits: { maxIter: number; timeoutS: number };
  transform?: unknown;
  limitations: string[];
}

const WING_LIMITATIONS = [
  "Two-dimensional section of APEX F1's procedural rear wing at z = 0.44 m: not any team's wing, and not a measured shape.",
  "Infinite-span flow: no endplates, tip vortices, beam wing or other 3D effects.",
  "Wing in free air: no ground, car body, wheels or upstream wake.",
  "Steady RANS with the Spalart-Allmaras model, fully turbulent, incompressible: separation and stall are predicted only as well as that model allows.",
  "Not validated against experimental data for this shape.",
];
const BENCHMARK_LIMITATIONS = [
  "Benchmark case for verifying the pipeline (NACA 0012, NASA TMR conditions); not car aerodynamics.",
  "Compared with published RANS-SA results from other codes, which is verification, not experimental validation.",
];

export function buildCase(r: CfdRequest): CaseFile {
  const problems = validateRequest(r);
  if (problems.length) throw new Error(problems.join(" "));
  const base =
    r.kind === "benchmark-naca0012"
      ? {
          schema: "apex-f1/cfd-case@1" as const,
          kind: r.kind,
          solver: SOLVER,
          pipeline: PIPELINE_VERSION,
          model: { equations: "Reynolds-averaged Navier-Stokes, compressible (SU2 RANS)", turbulence: "Spalart-Allmaras (SU2, negative variant)", regime: "M = 0.15, Re = 6 million per chord" },
          conditions: { mach: 0.15, reynolds: 6e6, aoaDeg: r.aoaDeg },
          geometry: { id: "tmr-naca0012", description: "NACA 0012 (NASA TMR definition, sharp trailing edge, unit chord)", simplified: false },
          mesh: { level: r.meshLevel },
          limits: { maxIter: r.meshLevel === "449x129" ? 6000 : 4000, timeoutS: 3 * 3600 },
          limitations: BENCHMARK_LIMITATIONS,
        }
      : (() => {
          const s = rearWingSection(r.wings);
          return {
            schema: "apex-f1/cfd-case@1" as const,
            kind: r.kind,
            solver: SOLVER,
            pipeline: PIPELINE_VERSION,
            model: { equations: "Reynolds-averaged Navier-Stokes, incompressible (SU2 INC_RANS)", turbulence: "Spalart-Allmaras (SU2)", regime: "steady, 2D, Mach < 0.3" },
            conditions: { speedMps: r.speedMps, densityKgM3: r.densityKgM3, temperatureK: r.temperatureK, viscosityPaS: r.viscosityPaS },
            geometry: {
              id: "apex-rear-wing-section",
              description: `Procedural rear wing, 2D section at z = ${s.transform.z} m: main plane ${r.wings.rearMainDeg}°, flap ${r.wings.rearFlapDeg}°`,
              wings: r.wings,
              simplified: true,
              elements: s.elements,
            },
            reference: { lengthM: s.referenceLengthM },
            mesh: { level: r.meshLevel },
            limits: { maxIter: 4000, timeoutS: 2 * 3600 },
            transform: s.transform,
            limitations: WING_LIMITATIONS,
          };
        })();
  return { ...base, id: randomUUID(), cacheKey: cacheKey(base), label: r.label };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Results

async function readJson<T>(p: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(p, "utf8")) as T;
  } catch {
    return null;
  }
}

export async function shippedSummaries(): Promise<CfdSummary[]> {
  return (await readJson<CfdSummary[]>(path.join(SHIPPED, "index.json"))) ?? [];
}

export async function localSummaries(): Promise<CfdSummary[]> {
  if (!existsSync(JOBS)) return [];
  const out: CfdSummary[] = [];
  for (const id of await readdir(JOBS)) {
    const r = await readJson<CfdResult>(path.join(JOBS, id, "result.json"));
    if (r) out.push({ ...summarize(r), origin: "local" });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

const isId = (id: string) => /^[0-9a-f-]{36}$/.test(id);

export async function getResult(id: string): Promise<CfdResult | null> {
  if (!isId(id)) return null;
  const local = await readJson<CfdResult>(path.join(JOBS, id, "result.json"));
  if (local) return { ...local, origin: "local" };
  const shipped = await readJson<CfdResult>(path.join(SHIPPED, `${id}.json`));
  return shipped ? { ...shipped, origin: "shipped" } : null;
}

/** A completed result for the same cache key (identical physics inputs), shipped or local. Failed and cancelled jobs never match. */
async function findCached(key: string): Promise<CfdSummary | null> {
  for (const s of [...(await localSummaries()), ...(await shippedSummaries())]) {
    const full = await getResult(s.caseId);
    if (full?.cacheKey === key) return s;
  }
  return null;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// Jobs

export interface JobStatus {
  id: string;
  state: JobState;
  stages: Array<{ state: JobState; at: string }>;
  progress: { iterations: number; maxIterations: number; elapsedS: number } | null;
  message: string | null;
  label?: string;
  resultId: string | null;
}

const queue: string[] = [];
let running: string | null = null;

function pump() {
  if (running || !queue.length) return;
  const id = queue.shift()!;
  running = id;
  const child = spawn(PYTHON, ["-m", "apexcfd.run", path.join(JOBS, id)], { cwd: TOOLS, stdio: "ignore", env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME ?? "", NODE_ENV: process.env.NODE_ENV } as NodeJS.ProcessEnv });
  const done = () => {
    running = null;
    pump();
  };
  child.on("exit", done);
  child.on("error", async () => {
    await writeFile(path.join(JOBS, id, "status.json"), JSON.stringify({ state: "failed", stages: [], progress: null, message: "the runner could not start" }));
    done();
  });
}

/** `admit` is asked only when a new run would start (cached answers are free); it returns seconds to wait when the caller is over a limit. */
export async function submit(r: CfdRequest, admit?: () => number): Promise<{ cached: CfdSummary } | { jobId: string } | { retryAfterS: number }> {
  const c = buildCase(r);
  const hit = await findCached(c.cacheKey);
  if (hit) return { cached: hit };
  if (!runnerAvailable()) throw new Error("The CFD solver is not available on this server.");
  // One solver runs at a time: a bounded queue keeps a burst of requests from filling the disk and the backlog.
  if (queue.length >= MAX_QUEUED) throw new Error("The solver is busy with other simulations. Try again in a few minutes.");
  const wait = admit?.() ?? 0;
  if (wait) return { retryAfterS: wait };
  const dir = path.join(JOBS, c.id);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "case.json"), JSON.stringify(c));
  await writeFile(path.join(dir, "status.json"), JSON.stringify({ state: "queued", stages: [{ state: "queued", at: new Date().toISOString() }], progress: null, message: null }));
  queue.push(c.id);
  pump();
  return { jobId: c.id };
}

export async function jobStatus(id: string): Promise<JobStatus | null> {
  if (!isId(id)) return null;
  const s = await readJson<Omit<JobStatus, "id" | "resultId">>(path.join(JOBS, id, "status.json"));
  if (!s) return null;
  const c = await readJson<CaseFile>(path.join(JOBS, id, "case.json"));
  // A job whose runner died (server restart) is reported as failed rather than left "solving" for ever.
  const orphaned = !TERMINAL.includes(s.state) && running !== id && !queue.includes(id);
  return {
    id,
    state: orphaned ? "failed" : s.state,
    stages: s.stages,
    progress: s.progress,
    message: orphaned ? "the job stopped without finishing (the server restarted)" : s.message,
    label: c?.label,
    resultId: s.state === "completed" && existsSync(path.join(JOBS, id, "result.json")) ? id : null,
  };
}

export async function cancel(id: string) {
  if (!isId(id)) return false;
  const q = queue.indexOf(id);
  if (q >= 0) {
    queue.splice(q, 1);
    await writeFile(path.join(JOBS, id, "status.json"), JSON.stringify({ state: "cancelled", stages: [], progress: null, message: "cancelled before it started" }));
    return true;
  }
  if (running === id) {
    await writeFile(path.join(JOBS, id, "cancel"), "");
    return true;
  }
  return false;
}

export const runnerState = () => ({ available: runnerAvailable(), running, queued: [...queue], solver: SOLVER, pipeline: PIPELINE_VERSION });
