import type { CfdRequest } from "@/lib/cfd/model";
import { submit } from "@/lib/cfd/server";
import { clientKey, rateLimiter, tooMany } from "@/lib/rate-limit";

/** A new case starts a solver run of several minutes: at most 6 new runs per visitor per hour (cached results are not counted). */
const limit = rateLimiter(6, 60 * 60_000);

export const dynamic = "force-dynamic";

/**
 * Requests a simulation. The body is a typed request (lib/cfd/model.ts), validated before anything is written; an identical earlier
 * case returns its cached result instead of running again.
 */
export async function POST(req: Request) {
  let body: CfdRequest;
  try {
    body = (await req.json()) as CfdRequest;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  try {
    const key = clientKey(req);
    const r = await submit(body, () => limit(key));
    return "retryAfterS" in r ? tooMany(r.retryAfterS, `Too many new simulations. Try again in ${Math.ceil(r.retryAfterS / 60)} min.`) : Response.json(r);
  } catch (e) {
    const message = e instanceof Error ? e.message : "request rejected";
    return Response.json({ error: message }, { status: /not available|busy/.test(message) ? 503 : 400 });
  }
}
