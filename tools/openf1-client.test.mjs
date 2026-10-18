// node --test tools/  (deterministic: fake fetch, sleep and clock; no network)
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { backoffMs, OpenF1Error, openf1, retryAfterMs } from "./openf1-client.mjs";

function harness(responses, opts = {}) {
  const calls = [];
  const sleeps = [];
  let clock = 1_000_000;
  const fetch = async (url) => {
    calls.push(url);
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: { get: (h) => r.headers?.[h.toLowerCase()] ?? null }, json: async () => r.body };
  };
  const sleep = async (ms) => {
    sleeps.push(ms);
    clock += ms;
  };
  const dir = mkdtempSync(join(tmpdir(), "openf1-test-"));
  const get = openf1(dir, { fetch, sleep, now: () => clock, random: () => 1, log: () => {}, minIntervalMs: 2100, ...opts });
  return { get, calls, sleeps, dir };
}

test("caches a non-empty answer and serves it again without a request; fresh bypasses the cache", async () => {
  const h = harness([{ status: 200, body: [{ a: 1 }] }, { status: 200, body: [{ a: 2 }] }]);
  assert.deepEqual(await h.get("laps?session_key=1"), [{ a: 1 }]);
  assert.deepEqual(await h.get("laps?session_key=1"), [{ a: 1 }]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.get.stats.cacheHits, 1);
  assert.deepEqual(await h.get("laps?session_key=1", { fresh: true }), [{ a: 2 }]);
  assert.equal(h.calls.length, 2);
  assert.ok(readdirSync(h.dir).every((f) => !f.includes(".tmp-")), "atomic writes leave no temporary files");
});

test("404 means no data; empty answers are not cached", async () => {
  const h = harness([{ status: 404 }, { status: 200, body: [] }, { status: 200, body: [{ x: 1 }] }]);
  assert.deepEqual(await h.get("pit?session_key=1"), []);
  assert.deepEqual(await h.get("stints?session_key=1"), []);
  assert.deepEqual(await h.get("stints?session_key=1"), [{ x: 1 }]);
});

test("spaces requests by the minimum interval", async () => {
  const h = harness([{ status: 200, body: [1] }, { status: 200, body: [2] }]);
  await h.get("a");
  await h.get("b");
  assert.deepEqual(h.sleeps, [2100]);
});

test("429 waits for Retry-After, then succeeds; counted as rate limited", async () => {
  const h = harness([{ status: 429, headers: { "retry-after": "7" } }, { status: 200, body: [1] }]);
  assert.deepEqual(await h.get("position?session_key=1"), [1]);
  assert.ok(h.sleeps.includes(7000));
  assert.equal(h.get.stats.rateLimited, 1);
  assert.equal(h.get.stats.retries, 1);
});

test("5xx and network errors back off exponentially, bounded; then fail as unavailable", async () => {
  const h = harness([{ status: 503 }, new TypeError("fetch failed"), { status: 502 }], { maxAttempts: 3 });
  await assert.rejects(h.get("laps?session_key=1"), (e) => e instanceof OpenF1Error && e.category === "unavailable");
  assert.equal(h.calls.length, 3);
  // random() = 1: full step: 4 s, then 8 s (plus the 2.1 s request spacing, already covered by the backoff).
  assert.deepEqual(h.sleeps.filter((s) => s !== 2100), [4000, 8000]);
});

test("401/403/400 are not retried", async () => {
  for (const status of [400, 401, 403]) {
    const h = harness([{ status }]);
    await assert.rejects(h.get("x"), (e) => e.category === "request" && e.status === status);
    assert.equal(h.calls.length, 1);
  }
});

test("repeated 429 gives up as rate-limit instead of retrying forever", async () => {
  const h = harness([{ status: 429 }, { status: 429 }], { maxAttempts: 2 });
  await assert.rejects(h.get("x"), (e) => e.category === "rate-limit");
  assert.equal(h.calls.length, 2);
});

test("retryAfterMs reads seconds and HTTP dates; backoff is capped with jitter", () => {
  assert.equal(retryAfterMs("3"), 3000);
  assert.equal(retryAfterMs(new Date(10_000).toUTCString(), 4_000), 6000);
  assert.equal(retryAfterMs(null), null);
  assert.equal(backoffMs(10, { random: () => 1 }), 120_000);
  assert.equal(backoffMs(0, { random: () => 0 }), 2000);
});
