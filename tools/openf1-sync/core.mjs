// OpenF1 sync worker core: lock, state, discovery, plan, run exporters, validate, record, notify. All I/O is injectable (core.test.mjs).
//
// Data directory layout (DATA_DIR, a persistent disk shared with the website):
//   replay/<year>/<sessionKey>.json + index.json    race replay datasets (tools/openf1-replay)
//   telemetry/<year>/<sessionKey>.json + index.json fastest-lap telemetry (tools/openf1-telemetry)
//   results/<year>.json                              season results and standings (tools/openf1-results)
//   sync-state.json                                  what is stored, when, and the last run's outcome (read by the website)
//   .cache/                                          OpenF1 response cache (lets an interrupted run resume without re-downloading)
//   .sync.lock                                       held while a run is in progress
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from "node:fs";
import { join } from "node:path";
import { writeAtomic } from "../openf1-client.mjs";
import { DEFAULTS, isFinal, planSync } from "./plan.mjs";

export const STATE_SCHEMA = "apex-f1/sync-state@1";
const LOCK_STALE_MS = 3 * 3_600_000;

/** Exclusive lock (O_EXCL): a second run exits instead of downloading the same data twice. A lock left by a crash is reclaimed after 3 h. */
export function acquireLock(dataDir) {
  const now = Date.now(); // real time: compared with the lock file's modification time
  const file = join(dataDir, ".sync.lock");
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(file, "wx");
      writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date(now).toISOString() }));
      closeSync(fd);
      return () => {
        try {
          unlinkSync(file);
        } catch {
          /* already gone */
        }
      };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      if (now - statSync(file).mtimeMs < LOCK_STALE_MS) return null;
      unlinkSync(file); // stale: the holder died without releasing it
    }
  }
  return null;
}

export function readState(dataDir) {
  const file = join(dataDir, "sync-state.json");
  if (!existsSync(file)) return { schema: STATE_SCHEMA, replay: {}, telemetry: {}, results: {}, run: {} };
  const s = JSON.parse(readFileSync(file, "utf8"));
  return { schema: STATE_SCHEMA, replay: s.replay ?? {}, telemetry: s.telemetry ?? {}, results: s.results ?? {}, run: s.run ?? {} };
}

export const writeState = (dataDir, state) => writeAtomic(join(dataDir, "sync-state.json"), JSON.stringify(state, null, 1) + "\n");

/** Sanitised error category from an exporter failure (its last stderr lines): never the raw output, which could be long. */
export function categorize(text) {
  if (/rate limited|HTTP 429/i.test(text)) return "rate-limit";
  if (/HTTP 40[13]\b/.test(text)) return "auth";
  if (/HTTP 4\d\d\b/.test(text)) return "request";
  if (/no answer|network error|timeout|ECONN|ENOTFOUND|fetch failed/i.test(text)) return "unavailable";
  if (/invalid output/i.test(text)) return "invalid-output";
  return "exporter";
}

/** Checks what an exporter wrote before it counts as stored; returns record counts for the report. */
export function validateOutput(dataDir, job) {
  const read = (f) => {
    try {
      return JSON.parse(readFileSync(f, "utf8"));
    } catch {
      throw new Error(`invalid output: ${f.slice(dataDir.length)} missing or not JSON`);
    }
  };
  if (job.kind === "replay") {
    const file = join(dataDir, "replay", String(job.year), `${job.sessionKey}.json`);
    // The exporter skips (and exits 0 for) a race OpenF1 lists without lap data, e.g. a cancelled event: recorded as having no data, so it
    // does not block every later run; re-checked once at the finalize point like any other race.
    if (!existsSync(file)) return { noData: true };
    const d = read(file);
    if (d.schema !== "apex-f1/race-replay@1" || d.sessionKey !== job.sessionKey || !d.drivers?.length) throw new Error(`invalid output: replay ${job.sessionKey}`);
    return { drivers: d.drivers.length, laps: d.drivers.reduce((n, x) => n + x.laps.length, 0), raceControl: d.raceControl?.length ?? 0 };
  }
  if (job.kind === "telemetry") {
    const ix = read(join(dataDir, "telemetry", String(job.year), "index.json"));
    const have = new Set((ix.sessions ?? []).map((s) => s.sessionKey));
    const missing = job.sessionKeys.filter((k) => !have.has(k));
    // A session without published laps is skipped by the exporter: recorded as having no data, not as a failure.
    return { sessions: job.sessionKeys.length - missing.length, withoutData: missing.length };
  }
  const r = read(join(dataDir, "results", `${job.year}.json`));
  if (!Array.isArray(r.events)) throw new Error(`invalid output: results ${job.year}`);
  return { events: r.events.length };
}

/**
 * One sync run. deps: { dataDir, years, bundled:Set<number>, get(path,{fresh}), runExporter(job), notify(kinds), now(), log(event) }.
 * Returns the run summary (also stored in sync-state.json).
 */
export async function runSync({ dataDir, years, bundled, get, runExporter, notify, now = Date.now, log = () => {}, settleMs = DEFAULTS.settleMs, finalizeMs = DEFAULTS.finalizeMs }) {
  mkdirSync(dataDir, { recursive: true });
  const release = acquireLock(dataDir);
  if (!release) {
    log({ event: "sync.skipped", reason: "another run holds the lock" });
    return { skipped: true };
  }
  const state = readState(dataDir);
  const started = new Date(now()).toISOString();
  const summary = { startedAt: started, finishedAt: null, planned: 0, done: [], failed: null };
  try {
    const sessions = [];
    for (const year of years) for (const s of await get(`sessions?year=${year}`, { fresh: true })) sessions.push({ ...s, year });
    const jobs = planSync({ sessions, state, bundled, now: now(), settleMs, finalizeMs });
    summary.planned = jobs.length;
    log({ event: "sync.plan", jobs: jobs.map((j) => `${j.kind}:${j.year}:${j.sessionKey ?? j.sessionKeys?.join("+") ?? ""}${j.fresh ? ":fresh" : ""}`) });
    const endOf = new Map(sessions.map((s) => [s.session_key, s.date_end]));
    for (const job of jobs) {
      const t0 = now();
      try {
        await runExporter(job);
        const records = validateOutput(dataDir, job);
        const at = now();
        const stamp = (key) => ({ syncedAt: new Date(at).toISOString(), final: isFinal(endOf.get(key), at, finalizeMs), sourceEnd: endOf.get(key) ?? null });
        if (job.kind === "replay") state.replay[job.sessionKey] = { year: job.year, ...stamp(job.sessionKey), records };
        else if (job.kind === "telemetry") for (const k of job.sessionKeys) state.telemetry[k] = { year: job.year, ...stamp(k) };
        else state.results[job.year] = { syncedAt: new Date(at).toISOString(), records };
        writeState(dataDir, state); // progress: an interruption after this point never repeats this job
        summary.done.push({ kind: job.kind, year: job.year, sessionKey: job.sessionKey ?? null, reason: job.reason, ms: at - t0, records });
        log({ event: "sync.job.done", kind: job.kind, year: job.year, sessionKey: job.sessionKey ?? job.sessionKeys, ms: at - t0, records });
      } catch (e) {
        const category = e.category ?? categorize(String(e.message ?? e));
        summary.failed = { kind: job.kind, year: job.year, sessionKey: job.sessionKey ?? null, category, at: new Date(now()).toISOString() };
        log({ event: "sync.job.failed", kind: job.kind, year: job.year, sessionKey: job.sessionKey ?? job.sessionKeys, category });
        break; // stop the run: never hammer a provider that is failing, rate limiting or rejecting us; the next run resumes from here
      }
    }
  } catch (e) {
    summary.failed = { kind: "discovery", category: e.category ?? categorize(String(e.message ?? e)), at: new Date(now()).toISOString() };
    log({ event: "sync.discovery.failed", category: summary.failed.category });
  }
  summary.finishedAt = new Date(now()).toISOString();
  state.run = {
    lastAttempt: summary.finishedAt,
    lastSuccess: summary.failed ? (state.run.lastSuccess ?? null) : summary.finishedAt,
    lastError: summary.failed ?? state.run.lastError ?? null,
    consecutiveFailures: summary.failed ? (state.run.consecutiveFailures ?? 0) + 1 : 0,
    last: { planned: summary.planned, done: summary.done.length, failed: summary.failed?.category ?? null, stats: get.stats ?? null },
  };
  writeState(dataDir, state);
  release();
  if (summary.done.length) {
    try {
      const sent = await notify([...new Set(summary.done.map((d) => d.kind))]);
      log({ event: sent === false ? "sync.notify.skipped" : "sync.notify.done" });
    } catch (e) {
      log({ event: "sync.notify.failed", category: "web-unreachable", detail: String(e?.message ?? e).slice(0, 120) });
    }
  }
  return summary;
}
