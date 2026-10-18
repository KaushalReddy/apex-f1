#!/usr/bin/env node
// OpenF1 sync worker: keeps DATA_DIR up to date with new races, telemetry and season results, so the deployed website shows new data
// without a code change or redeploy. Historical data only (no OpenF1 account needed). See README.md in this folder.
//
//   node tools/openf1-sync/sync.mjs --once          one run (for cron / a scheduled job)
//   node tools/openf1-sync/sync.mjs --watch         keep running: one run every OPENF1_SYNC_INTERVAL_MIN (backs off after failures)
//
// Environment: DATA_DIR (required), OPENF1_SYNC_YEARS (default: current year), OPENF1_SYNC_INTERVAL_MIN (30), OPENF1_MIN_INTERVAL_MS (2100),
// WEB_URL + SYNC_SECRET (to tell the website to refresh; optional), APEX_BUNDLED_REPLAY_DIR / APEX_BUNDLED_TELEMETRY_DIR (data shipped
// with the site's build, default: this repo's apps/web copies).
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openf1 } from "../openf1-client.mjs";
import { runSync } from "./core.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const TOOLS = resolve(HERE, "..");
const REPO = resolve(TOOLS, "..");
const env = process.env;
const log = (o) => process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), ...o }) + "\n");

const DATA_DIR = env.DATA_DIR;
if (!DATA_DIR) {
  log({ event: "sync.config.missing", detail: "DATA_DIR is required (a persistent directory shared with the website)" });
  process.exit(2);
}
const years = (env.OPENF1_SYNC_YEARS ?? String(new Date().getUTCFullYear())).split(",").map(Number).filter(Number.isInteger);
const intervalMin = Number(env.OPENF1_SYNC_INTERVAL_MIN ?? 30);
const EXPORTER_TIMEOUT_MS = 2 * 3_600_000;

/** Session keys shipped with the site's build: already final, never re-downloaded. */
function bundledKeys() {
  const keys = new Set();
  for (const [dir, sub] of [
    [env.APEX_BUNDLED_REPLAY_DIR ?? join(REPO, "apps/web/public/replay"), "replay"],
    [env.APEX_BUNDLED_TELEMETRY_DIR ?? join(REPO, "apps/web/src/data/telemetry"), "telemetry"],
  ])
    for (const y of years) {
      const f = join(dir, String(y), "index.json");
      if (!existsSync(f)) continue;
      for (const s of JSON.parse(readFileSync(f, "utf8")).sessions ?? []) keys.add(`${sub}:${s.sessionKey}`);
    }
  return keys;
}

/** Runs one exporter as a child process (bounded time and captured output); rejects with its last stderr lines. */
function runExporter(job) {
  const out = {
    replay: ["openf1-replay/export.mjs", "--year", String(job.year), "--out", join(DATA_DIR, "replay", String(job.year)), "--sessions", String(job.sessionKey)],
    telemetry: ["openf1-telemetry/export.mjs", "--year", String(job.year), "--out", join(DATA_DIR, "telemetry", String(job.year)), "--keys", job.sessionKeys?.join(",") ?? ""],
    results: ["openf1-results/export.mjs", "--year", String(job.year), "--out", join(DATA_DIR, "results", `${job.year}.json`)],
  }[job.kind];
  const [script, ...args] = out;
  return new Promise((ok, fail) => {
    const child = spawn(process.execPath, [join(TOOLS, script), ...args], {
      env: { ...env, OPENF1_CACHE_DIR: join(DATA_DIR, ".cache"), OPENF1_FRESH: job.fresh ? "1" : "0" },
      stdio: ["ignore", "ignore", "pipe"],
    });
    let tail = "";
    child.stderr.on("data", (b) => (tail = (tail + b).slice(-4000))); // bounded: last 4 kB only
    const timer = setTimeout(() => child.kill("SIGTERM"), EXPORTER_TIMEOUT_MS);
    child.on("error", (e) => fail(e));
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) ok();
      else fail(new Error(tail.split("\n").filter(Boolean).slice(-3).join("\n") || `exit ${code}`));
    });
  });
}

/** Tells the website to revalidate the affected pages (POST, shared secret). Optional: without it, pages refresh on their own schedule. */
async function notify(kinds) {
  if (!env.WEB_URL || !env.SYNC_SECRET) return false; // not configured: pages refresh on their own schedule
  const res = await fetch(new URL("/api/revalidate", env.WEB_URL), {
    method: "POST",
    headers: { authorization: `Bearer ${env.SYNC_SECRET}`, "content-type": "application/json" },
    body: JSON.stringify({ kinds }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`revalidate answered HTTP ${res.status}`);
}

async function once() {
  const get = openf1(join(DATA_DIR, ".cache", "sync"), { log: (m) => log({ event: "openf1.retry", detail: m.trim().slice(0, 160) }) });
  const keys = bundledKeys();
  // planSync takes one set: a session counts as bundled when the site ships it (replay for races, telemetry for qualifying).
  const bundled = new Set([...keys].filter((k) => k.startsWith("replay:")).map((k) => Number(k.split(":")[1])));
  const teleBundled = new Set([...keys].filter((k) => k.startsWith("telemetry:")).map((k) => Number(k.split(":")[1])));
  for (const k of teleBundled) if (!bundled.has(k)) bundled.add(k); // qualifying sessions shipped with telemetry
  const summary = await runSync({ dataDir: DATA_DIR, years, bundled, get, runExporter, notify, log });
  log({ event: "sync.run.done", planned: summary.planned ?? 0, done: summary.done?.length ?? 0, failed: summary.failed?.category ?? null, skipped: !!summary.skipped, stats: get.stats });
  return summary;
}

if (process.argv.includes("--watch")) {
  let stopping = false;
  let wake = null;
  for (const sig of ["SIGTERM", "SIGINT"])
    process.on(sig, () => {
      stopping = true;
      log({ event: "sync.stopping", signal: sig });
      wake?.();
    });
  let failures = 0;
  while (!stopping) {
    const s = await once();
    failures = s.failed ? failures + 1 : 0;
    // Back off after failures (x2 each, up to 8x), with jitter so several workers never align.
    const ms = intervalMin * 60_000 * Math.min(8, 2 ** failures) * (0.9 + Math.random() * 0.2);
    log({ event: "sync.sleep", minutes: Math.round(ms / 60_000) });
    await new Promise((r) => {
      const t = setTimeout(r, ms);
      wake = () => {
        clearTimeout(t);
        r();
      };
    });
  }
} else {
  const s = await once();
  process.exit(s.failed ? 1 : 0);
}
