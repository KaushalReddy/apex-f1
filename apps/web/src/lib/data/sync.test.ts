import { afterEach, describe, expect, it } from "vitest";
import { POST as revalidate } from "@/app/api/revalidate/route";
import { GET as health } from "@/app/api/sync/health/route";
import { hasSyncSecret } from "./sync";

const saved = process.env.SYNC_SECRET;
afterEach(() => {
  if (saved === undefined) delete process.env.SYNC_SECRET;
  else process.env.SYNC_SECRET = saved;
});
const req = (auth?: string, body?: unknown) => new Request("http://x/api/revalidate", { method: "POST", headers: auth ? { authorization: auth } : {}, body: body === undefined ? undefined : JSON.stringify(body) });

describe("protected sync routes", () => {
  it("are disabled (503), not open, when no secret is configured", async () => {
    delete process.env.SYNC_SECRET;
    expect(hasSyncSecret(req("Bearer anything"))).toBe("unconfigured");
    expect((await revalidate(req("Bearer anything", { kinds: ["replay"] }))).status).toBe(503);
    expect((await health(req("Bearer anything"))).status).toBe(503);
  });
  it("refuse a wrong or missing secret (401)", async () => {
    process.env.SYNC_SECRET = "s3cret-value";
    expect(hasSyncSecret(req())).toBe("denied");
    expect(hasSyncSecret(req("Bearer s3cret-valuX"))).toBe("denied");
    expect(hasSyncSecret(req("Bearer s3cret"))).toBe("denied");
    expect((await revalidate(req("Bearer wrong", { kinds: ["replay"] }))).status).toBe(401);
    expect((await health(req())).status).toBe(401);
  });
  it("accept the right secret, and validate the request body", async () => {
    process.env.SYNC_SECRET = "s3cret-value";
    expect(hasSyncSecret(req("Bearer s3cret-value"))).toBe("ok");
    expect((await revalidate(req("Bearer s3cret-value", { kinds: ["everything"] }))).status).toBe(400);
    expect((await revalidate(req("Bearer s3cret-value", { kinds: [] }))).status).toBe(400);
    const h = await health(req("Bearer s3cret-value"));
    expect(h.status).toBe(200);
    expect(JSON.stringify(await h.json())).not.toContain("s3cret-value");
  });
});
