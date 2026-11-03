// node --test tools/  (deterministic: fake fetch, sleep and clock; no network)
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { backoffMs, OpenF1Error, openf1, retryAfterMs, tokenSource } from "./openf1-client.mjs";

function harness(responses, opts = {}) {
  const calls = [];
  const sleeps = [];
  let clock = 1_000_000;
  const fetch = async (url, init = {}) => {
    calls.push(url);
    (fetch.inits ??= []).push(init);
    const r = responses.shift();
    if (r instanceof Error) throw r;
    return { status: r.status, ok: r.status >= 200 && r.status < 300, headers: { get: (h) => r.headers?.[h.toLowerCase()] ?? null }, json: async () => r.body };
  };
  const sleep = async (ms) => {
    sleeps.push(ms);
    clock += ms;
  };
  const dir = mkdtempSync(join(tmpdir(), "openf1-test-"));
  const { login, ...rest } = opts;
  const auth = login ? tokenSource({ ...login, fetch, now: () => clock }) : null;
  const get = openf1(dir, { fetch, sleep, now: () => clock, random: () => 1, log: () => {}, minIntervalMs: 2100, auth, ...rest });
  return { get, calls, sleeps, dir, inits: () => fetch.inits, tick: (ms) => (clock += ms) };
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

test("401/403/400 are not retried; without a login, 401/403 say a login is needed", async () => {
  for (const status of [400, 401, 403]) {
    const h = harness([{ status }]);
    await assert.rejects(h.get("x"), (e) => e.category === (status === 400 ? "request" : "auth") && e.status === status);
    assert.equal(h.calls.length, 1);
  }
  await assert.rejects(harness([{ status: 401 }]).get("x"), /OPENF1_USERNAME/);
});

const LOGIN = { username: "user@example.com", password: "s3cret-pw" };
const TOKEN = (t = "tok-1", expires_in = 3600) => ({ status: 200, body: { access_token: t, expires_in, token_type: "bearer" } });

test("with a login: posts the form to the token endpoint once and sends the bearer token on every request", async () => {
  const h = harness([TOKEN(), { status: 200, body: [1] }, { status: 200, body: [2] }], { login: LOGIN });
  assert.deepEqual(await h.get("a"), [1]);
  assert.deepEqual(await h.get("b"), [2]);
  assert.deepEqual(h.calls, ["https://api.openf1.org/token", "https://api.openf1.org/v1/a", "https://api.openf1.org/v1/b"]);
  const [login, a, b] = h.inits();
  assert.equal(login.method, "POST");
  assert.equal(login.body, "username=user%40example.com&password=s3cret-pw");
  assert.equal(a.headers.authorization, "Bearer tok-1");
  assert.equal(b.headers.authorization, "Bearer tok-1");
});

test("an expiring token is renewed before use", async () => {
  const h = harness([TOKEN("old", 120), { status: 200, body: [1] }, TOKEN("new"), { status: 200, body: [2] }], { login: LOGIN });
  await h.get("a");
  h.tick(70_000); // inside the last minute of the token's life
  await h.get("b");
  assert.equal(h.inits()[3].headers.authorization, "Bearer new");
});

test("a 401 with a token renews it once, then succeeds; a second 401 is an auth failure, not a loop", async () => {
  const ok = harness([TOKEN("a"), { status: 401 }, TOKEN("b"), { status: 200, body: [1] }], { login: LOGIN });
  assert.deepEqual(await ok.get("x"), [1]);
  assert.equal(ok.inits()[3].headers.authorization, "Bearer b");
  const bad = harness([TOKEN("a"), { status: 401 }, TOKEN("b"), { status: 401 }], { login: LOGIN });
  await assert.rejects(bad.get("x"), (e) => e.category === "auth" && e.status === 401);
  assert.equal(bad.calls.length, 4);
});

test("rejected, unreachable or malformed token answers fail clearly and never contain the credentials", async () => {
  const cases = [
    [[{ status: 401 }], "auth"],
    [[{ status: 503 }], "unavailable"],
    [[new TypeError("fetch failed")], "unavailable"],
    [[{ status: 200, body: { detail: "nope" } }], "unavailable"],
  ];
  for (const [responses, category] of cases) {
    const h = harness(responses, { login: LOGIN });
    await assert.rejects(h.get("x"), (e) => e.category === category && !e.message.includes(LOGIN.password) && !e.message.includes(LOGIN.username));
    assert.equal(h.calls.length, 1, "no data request without a token");
  }
});

test("credentials: none means unauthenticated; only one of the two is a configuration error", () => {
  assert.equal(tokenSource({}), null);
  assert.throws(() => tokenSource({ username: "u" }), (e) => e.category === "config" && /OPENF1_PASSWORD/.test(e.message));
  assert.throws(() => tokenSource({ password: "p" }), (e) => e.category === "config" && !e.message.includes("p\""));
});

test("a malformed 200 answer is an error, never an empty result", async () => {
  for (const body of [{ detail: "Live F1 session in progress" }, undefined]) {
    const h = harness([{ status: 200, body }]);
    await assert.rejects(h.get("session_result?session_key=1"), (e) => e.category === "invalid-response");
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
