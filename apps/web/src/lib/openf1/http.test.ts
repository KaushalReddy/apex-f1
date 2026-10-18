import { describe, expect, it } from "vitest";
import { TokenManager } from "./auth";
import { createOpenF1Http } from "./http";

type A = { status: number; body?: unknown; headers?: Record<string, string> } | Error;
function setup(answers: A[], extra: Parameters<typeof createOpenF1Http>[0] = {}) {
  let clock = 1_000_000;
  const urls: string[] = [];
  const auths: (string | undefined)[] = [];
  const sleeps: number[] = [];
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    urls.push(String(url));
    auths.push((init?.headers as Record<string, string> | undefined)?.authorization);
    const a = answers.shift() ?? { status: 500 };
    if (a instanceof Error) throw a;
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status, headers: a.headers });
  }) as typeof fetch;
  const http = createOpenF1Http({ fetch: f, now: () => clock, sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    }, random: () => 1, ...extra });
  return { http, urls, auths, sleeps, tick: (ms: number) => (clock += ms) };
}

describe("OpenF1 live HTTP client", () => {
  it("returns rows, treats 404 as no data, and spaces requests", async () => {
    const t = setup([{ status: 200, body: [{ a: 1 }] }, { status: 404 }]);
    expect(await t.http.get("position?session_key=1")).toEqual([{ a: 1 }]);
    expect(await t.http.get("intervals?session_key=1")).toEqual([]);
    expect(t.sleeps).toEqual([300]);
  });

  it("identical concurrent requests share one fetch", async () => {
    const t = setup([{ status: 200, body: [1] }]);
    const [a, b] = await Promise.all([t.http.get("laps?session_key=1"), t.http.get("laps?session_key=1")]);
    expect(a).toEqual([1]);
    expect(b).toEqual([1]);
    expect(t.urls).toHaveLength(1);
  });

  it("retries 5xx and network errors with backoff, bounded", async () => {
    const t = setup([{ status: 503 }, new TypeError("fetch failed"), { status: 200, body: [7] }]);
    expect(await t.http.get("x")).toEqual([7]);
    expect(t.http.stats.retries).toBe(2);
    const u = setup([{ status: 503 }, { status: 503 }, { status: 503 }]);
    await expect(u.http.get("x")).rejects.toMatchObject({ category: "unavailable" });
  });

  it("429: fails at once, pauses every request until Retry-After, then resumes", async () => {
    const t = setup([{ status: 429, headers: { "retry-after": "20" } }, { status: 200, body: [1] }]);
    await expect(t.http.get("a")).rejects.toMatchObject({ category: "rate-limit" });
    await expect(t.http.get("b")).rejects.toMatchObject({ category: "rate-limit" });
    expect(t.urls).toHaveLength(1); // nothing sent while paused
    t.tick(20_001);
    expect(await t.http.get("b")).toEqual([1]);
  });

  it("opens the circuit after repeated failures and refuses requests until the cooldown passes", async () => {
    const t = setup([{ status: 400 }, { status: 400 }, { status: 400 }, { status: 200, body: [1] }], { breakerThreshold: 3, breakerCooldownMs: 60_000 });
    for (let k = 0; k < 3; k++) await expect(t.http.get("x")).rejects.toMatchObject({ category: "request" });
    await expect(t.http.get("x")).rejects.toMatchObject({ category: "suppressed" });
    expect(t.urls).toHaveLength(3);
    t.tick(60_001);
    expect(await t.http.get("x")).toEqual([1]);
  });

  it("sends the bearer token; a 401 renews it once; a second 401 is an auth error (no loop)", async () => {
    let n = 0;
    const tokens = new TokenManager({
      username: "u",
      password: "p",
      fetch: (async () => new Response(JSON.stringify({ access_token: `tok-${++n}`, expires_in: 3600 }), { status: 200 })) as unknown as typeof fetch,
    });
    const t = setup([{ status: 401 }, { status: 200, body: [1] }], { auth: tokens });
    expect(await t.http.get("position?session_key=latest")).toEqual([1]);
    expect(t.auths).toEqual(["Bearer tok-1", "Bearer tok-2"]);
    const u = setup([{ status: 401 }, { status: 401 }], { auth: tokens });
    await expect(u.http.get("x")).rejects.toMatchObject({ category: "auth" });
    expect(u.urls).toHaveLength(2);
  });

  it("without credentials an authenticated client reports unconfigured and sends nothing", async () => {
    const t = setup([], { auth: new TokenManager({}) });
    await expect(t.http.get("x")).rejects.toMatchObject({ category: "unconfigured" });
    expect(t.urls).toHaveLength(0);
  });
});
