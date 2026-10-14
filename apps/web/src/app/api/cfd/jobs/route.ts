import type { CfdRequest } from "@/lib/cfd/model";
import { submit } from "@/lib/cfd/server";

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
    return Response.json(await submit(body));
  } catch (e) {
    const message = e instanceof Error ? e.message : "request rejected";
    return Response.json({ error: message }, { status: /not available/.test(message) ? 503 : 400 });
  }
}
