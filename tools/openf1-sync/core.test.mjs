import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { OpenF1Error } from "../openf1-client.mjs";
import { acquireLock, categorize, readState, runSync } from "./core.mjs";

const H = 3_600_000;
const END = Date.parse("2026-10-25T22:00:00Z");
// TEST DATA: OpenF1 /sessions rows (real keys for the 2026 US GP weekend, fields as published).
const SESSIONS = [
  { session_key: 11392, session_name: "Qualifying", date_end: "2026-10-24T22:00:00+00:00" },
  { session_key: 11396, session_name: "Race", date_end: "2026-10-25T22:00:00+00:00" },
];

/** A fake exporter that writes the files the real ones write (minimal valid shapes). */
function fakeExporter(dataDir, { failOn } = {}) {
  const runs = [];
  const run = async (job) => {
    runs.push(job);
    if (failOn?.(job)) throw Object.assign(new Error("  rate limited on /laps: waiting 30 s\n/laps: rate limited (HTTP 429) after 6 attempts"), {});
    if (job.kind === "replay") {
      const d = join(dataDir, "replay", String(job.year));
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, `${job.sessionKey}.json`), JSON.stringify({ schema: "apex-f1/race-replay@1", sessionKey: job.sessionKey, drivers: [{ laps: [[1, 0, 90]] }], raceControl: [] }));
    } else if (job.kind === "telemetry") {
      const d = join(dataDir, "telemetry", String(job.year));
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, "index.json"), JSON.stringify({ sessions: job.sessionKeys.map((k) => ({ sessionKey: k })) }));
    } else {
      mkdirSync(join(dataDir, "results"), { recursive: true });
      writeFileSync(join(dataDir, "results", `${job.year}.json`), JSON.stringify({ events: [{}, {}] }));
    }
  };
  return { run, runs };
}

function deps(dataDir, over = {}) {
  const notified = [];
  const ex = fakeExporter(dataDir, over);
  const get = async () => SESSIONS;
  get.stats = { requests: 1 };
  return { notified, ex, d: { dataDir, years: [2026], bundled: new Set([11388]), get, runExporter: ex.run, notify: async (k) => notified.push(k), now: () => END + 2 * H, ...over.d } };
}

test("a new race weekend: replay, telemetry and results are exported, validated, recorded, and the website is notified", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sync-"));
  const { d, ex, notified } = deps(dir);
  const s = await runSync(d);
  assert.equal(s.failed, null);
  assert.deepEqual(ex.runs.map((j) => j.kind), ["replay", "telemetry", "results"]);
  const st = readState(dir);
  assert.equal(st.replay[11396].final, false);
  assert.deepEqual(st.replay[11396].records, { drivers: 1, laps: 1, raceControl: 0 });
  assert.ok(st.telemetry[11392] && st.telemetry[11396]);
  assert.equal(st.run.consecutiveFailures, 0);
  assert.ok(st.run.lastSuccess);
  assert.deepEqual(notified, [["replay", "telemetry", "results"]]);
  // Idempotent: the same run again does nothing and notifies nobody.
  const again = deps(dir);
  const s2 = await runSync(again.d);
  assert.equal(s2.planned, 0);
  assert.equal(again.ex.runs.length, 0);
  assert.equal(again.notified.length, 0);
});

test("interrupted by a rate limit: stops, keeps what finished, records the category, and the next run resumes only the rest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sync-"));
  const first = deps(dir, { failOn: (j) => j.kind === "telemetry" });
  const s = await runSync(first.d);
  assert.equal(s.failed.category, "rate-limit");
  assert.deepEqual(first.ex.runs.map((j) => j.kind), ["replay", "telemetry"]); // stopped; results not attempted
  const st = readState(dir);
  assert.ok(st.replay[11396]);
  assert.equal(st.telemetry[11396], undefined);
  assert.equal(st.run.consecutiveFailures, 1);
  assert.equal(st.run.lastSuccess, null);
  assert.equal(st.run.lastError.category, "rate-limit");
  assert.deepEqual(first.notified, [["replay"]]); // what did finish is published
  const second = deps(dir);
  await runSync(second.d);
  assert.deepEqual(second.ex.runs.map((j) => j.kind), ["telemetry", "results"]);
  assert.equal(readState(dir).run.consecutiveFailures, 0);
});

test("output that does not validate is not recorded as stored", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sync-"));
  const { d } = deps(dir);
  d.runExporter = async (job) => {
    if (job.kind !== "replay") return;
    mkdirSync(join(dir, "replay", "2026"), { recursive: true });
    writeFileSync(join(dir, "replay", "2026", `${job.sessionKey}.json`), "{ not json");
  };
  const s = await runSync(d);
  assert.equal(s.failed.category, "invalid-output");
  assert.deepEqual(readState(dir).replay, {});
});

test("a race OpenF1 lists without lap data (exporter skips it) is recorded as no data and does not block later runs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sync-"));
  const { d, ex } = deps(dir);
  const real = ex.run;
  d.runExporter = async (job) => (job.kind === "replay" ? undefined : real(job)); // replay exporter writes nothing (skipped)
  const s = await runSync(d);
  assert.equal(s.failed, null);
  assert.deepEqual(readState(dir).replay[11396].records, { noData: true });
  const again = deps(dir);
  assert.equal((await runSync(again.d)).planned, 0);
});

test("OpenF1 unreachable during discovery: recorded as unavailable, the last success is kept", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sync-"));
  const ok = deps(dir);
  await runSync(ok.d);
  const before = readState(dir).run.lastSuccess;
  const { d } = deps(dir);
  d.get = async () => {
    throw new OpenF1Error("unavailable", "/sessions: no answer after 6 attempts");
  };
  const s = await runSync(d);
  assert.equal(s.failed.category, "unavailable");
  const st = readState(dir);
  assert.equal(st.run.lastSuccess, before);
  assert.equal(st.run.lastError.category, "unavailable");
});

test("one run at a time: a held lock skips the run; a stale lock (crashed holder) is reclaimed", async () => {
  const dir = mkdtempSync(join(tmpdir(), "sync-"));
  const release = acquireLock(dir);
  assert.ok(release);
  assert.equal(acquireLock(dir), null);
  const { d, ex } = deps(dir);
  assert.deepEqual(await runSync(d), { skipped: true });
  assert.equal(ex.runs.length, 0);
  // Age the lock past 3 h: the next run reclaims it.
  const old = (Date.now() - 4 * H) / 1000;
  utimesSync(join(dir, ".sync.lock"), old, old);
  assert.ok(acquireLock(dir));
  release();
});

test("error categories never carry raw output", () => {
  assert.equal(categorize("/laps: HTTP 429"), "rate-limit");
  assert.equal(categorize("/token: HTTP 401"), "auth");
  assert.equal(categorize("/x: HTTP 422"), "request");
  assert.equal(categorize("TypeError: fetch failed"), "unavailable");
  assert.equal(categorize("something odd"), "exporter");
});
