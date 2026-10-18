import { describe, expect, it, vi } from "vitest";
import { OpenF1AuthError, TokenManager } from "./auth";

function tokenFetch(answers: { status: number; body?: unknown }[]) {
  const calls: RequestInit[] = [];
  const f = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(init!);
    const a = answers.shift() ?? { status: 500 };
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status });
  });
  return { f: f as unknown as typeof fetch, calls };
}

describe("OpenF1 TokenManager", () => {
  it("without credentials it is unconfigured and never calls the token endpoint", async () => {
    const { f, calls } = tokenFetch([]);
    const t = new TokenManager({ fetch: f });
    expect(t.configured).toBe(false);
    await expect(t.get()).rejects.toMatchObject({ category: "unconfigured" });
    expect(calls).toHaveLength(0);
  });

  it("posts form-encoded credentials, caches the token, and renews it a minute before expiry", async () => {
    let now = 0;
    const { f, calls } = tokenFetch([
      { status: 200, body: { access_token: "tok-1", expires_in: "3600", token_type: "bearer" } },
      { status: 200, body: { access_token: "tok-2", expires_in: 3600 } },
    ]);
    const t = new TokenManager({ username: "u", password: "p w", fetch: f, now: () => now });
    expect(await t.get()).toBe("tok-1");
    expect(calls[0].body).toBe("username=u&password=p+w");
    expect((calls[0].headers as Record<string, string>)["content-type"]).toBe("application/x-www-form-urlencoded");
    now = 3_500_000; // still more than 60 s left
    expect(await t.get()).toBe("tok-1");
    now = 3_545_000; // within a minute of expiry
    expect(await t.get()).toBe("tok-2");
    expect(calls).toHaveLength(2);
  });

  it("concurrent callers share one token request", async () => {
    const { f, calls } = tokenFetch([{ status: 200, body: { access_token: "tok", expires_in: 3600 } }]);
    const t = new TokenManager({ username: "u", password: "p", fetch: f });
    expect(await Promise.all([t.get(), t.get(), t.get()])).toEqual(["tok", "tok", "tok"]);
    expect(calls).toHaveLength(1);
  });

  it("rejected credentials: an auth error without the password, then a cooldown with no further requests", async () => {
    let now = 0;
    const { f, calls } = tokenFetch([{ status: 401 }, { status: 200, body: { access_token: "tok", expires_in: 3600 } }]);
    const t = new TokenManager({ username: "user", password: "hunter2", fetch: f, now: () => now });
    const err = (await t.get().catch((e: unknown) => e)) as OpenF1AuthError;
    expect(err).toMatchObject({ category: "auth" });
    expect(err.message).not.toContain("hunter2");
    await expect(t.get()).rejects.toMatchObject({ category: "auth" });
    expect(calls).toHaveLength(1);
    now = 5 * 60_000 + 1;
    expect(await t.get()).toBe("tok");
  });

  it("invalidate() forces a new token (after a 401 from the data API)", async () => {
    const { f, calls } = tokenFetch([
      { status: 200, body: { access_token: "old", expires_in: 3600 } },
      { status: 200, body: { access_token: "new", expires_in: 3600 } },
    ]);
    const t = new TokenManager({ username: "u", password: "p", fetch: f });
    await t.get();
    t.invalidate();
    expect(await t.get()).toBe("new");
    expect(calls).toHaveLength(2);
  });
});
