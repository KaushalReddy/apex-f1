import { describe, expect, it } from "vitest";
import { clientKey, rateLimiter } from "./rate-limit";

describe("rateLimiter", () => {
  it("allows the limit per window per client, then asks to wait until the window ends", () => {
    let t = 0;
    const take = rateLimiter(2, 60_000, () => t);
    expect([take("a"), take("a"), take("b")]).toEqual([0, 0, 0]);
    t = 15_000;
    expect(take("a")).toBe(45);
    t = 60_000;
    expect(take("a")).toBe(0);
  });

  it("keys on the first forwarded address", () => {
    expect(clientKey(new Request("http://x", { headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" } }))).toBe("203.0.113.5");
    expect(clientKey(new Request("http://x"))).toBe("local");
  });
});
