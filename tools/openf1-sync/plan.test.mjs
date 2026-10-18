import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULTS, isFinal, planSync } from "./plan.mjs";

const H = 3_600_000;
const END = Date.parse("2026-10-25T22:00:00Z"); // US GP race end (TEST DATA shape, real keys)
const sessions = [
  { session_key: 11392, session_name: "Qualifying", date_end: "2026-10-24T22:00:00Z", year: 2026 },
  { session_key: 11396, session_name: "Race", date_end: "2026-10-25T22:00:00Z", year: 2026 },
  { session_key: 11391, session_name: "Practice 3", date_end: "2026-10-24T18:30:00Z", year: 2026 },
  { session_key: 11388, session_name: "Race", date_end: "2026-10-11T14:00:00Z", year: 2026 },
];
const bundled = new Set([11388]);

test("nothing before the race has settled; practice is never synced; bundled races are skipped", () => {
  const jobs = planSync({ sessions, state: {}, bundled, now: END + 30 * 60_000 });
  // Only qualifying (ended a day earlier) is ready: telemetry for it.
  assert.deepEqual(jobs, [{ kind: "telemetry", year: 2026, sessionKeys: [11392], fresh: false, reason: "new" }]);
});

test("a new race after it settles: replay, telemetry and season results, from cache", () => {
  // Qualifying already final (it ended a day earlier, so 2 h after the race it is past its own finalize window).
  const jobs = planSync({ sessions, state: { telemetry: { 11392: { final: true } } }, bundled, now: END + 2 * H });
  assert.deepEqual(jobs, [
    { kind: "replay", year: 2026, sessionKey: 11396, fresh: false, reason: "new" },
    { kind: "telemetry", year: 2026, sessionKeys: [11396], fresh: false, reason: "new" },
    { kind: "results", year: 2026, fresh: false, reason: "new race" },
  ]);
});

test("idempotent: the same state and time plan nothing new", () => {
  const state = { replay: { 11396: { final: false } }, telemetry: { 11392: { final: true }, 11396: { final: false } } };
  assert.deepEqual(planSync({ sessions, state, bundled, now: END + 3 * H }), []);
});

test("finalises once, bypassing the cache, after the finalize window; then never again", () => {
  const state = { replay: { 11396: { final: false } }, telemetry: { 11392: { final: false }, 11396: { final: false } } };
  const jobs = planSync({ sessions, state, bundled, now: END + DEFAULTS.finalizeMs + 1 });
  assert.deepEqual(jobs.map((j) => [j.kind, j.fresh, j.reason]), [
    ["replay", true, "finalize"],
    ["telemetry", true, "finalize"],
    ["results", true, "finalize"],
  ]);
  const done = { replay: { 11396: { final: true } }, telemetry: { 11392: { final: true }, 11396: { final: true } } };
  assert.deepEqual(planSync({ sessions, state: done, bundled, now: END + 100 * H }), []);
});

test("qualifying is finalised on its own clock, a day before the race", () => {
  const jobs = planSync({ sessions, state: { telemetry: { 11392: { final: false } } }, bundled, now: END + 2 * H });
  assert.deepEqual(jobs.find((j) => j.kind === "telemetry"), { kind: "telemetry", year: 2026, sessionKeys: [11392, 11396], fresh: true, reason: "finalize" });
});

test("a session with an unreadable end time is ignored rather than synced early", () => {
  assert.deepEqual(planSync({ sessions: [{ session_key: 1, session_name: "Race", date_end: "", year: 2026 }], state: {}, bundled: new Set(), now: END }), []);
});

test("isFinal", () => {
  assert.equal(isFinal("2026-10-25T22:00:00Z", END + 2 * H), false);
  assert.equal(isFinal("2026-10-25T22:00:00Z", END + 27 * H), true);
});

test("results are rebuilt when a stored race is newer than the stored results (interrupted run)", () => {
  const state = {
    replay: { 11396: { year: 2026, syncedAt: "2026-10-26T00:00:00.000Z", final: false } },
    telemetry: { 11392: { final: true }, 11396: { final: false } },
    results: { 2026: { syncedAt: "2026-10-20T00:00:00.000Z" } },
  };
  assert.deepEqual(planSync({ sessions, state, bundled, now: END + 3 * H }), [{ kind: "results", year: 2026, fresh: false, reason: "new race" }]);
  state.results[2026].syncedAt = "2026-10-26T00:05:00.000Z";
  assert.deepEqual(planSync({ sessions, state, bundled, now: END + 3 * H }), []);
});
