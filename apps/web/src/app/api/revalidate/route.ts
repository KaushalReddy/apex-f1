import { revalidatePath } from "next/cache";
import { hasSyncSecret } from "@/lib/data/sync";

/**
 * POST /api/revalidate (Authorization: Bearer SYNC_SECRET), body { kinds: ["replay" | "telemetry" | "results"] }: called by the sync
 * worker after new data lands, so the affected pages are rebuilt now instead of at their next scheduled refresh (circuit pages too: a new
 * race replaces their simulated race). Car Lab and other static pages are not touched. Not callable without the secret.
 */
export const dynamic = "force-dynamic";

const PATHS: Record<string, { path: string; type?: "page" | "layout" }[]> = {
  replay: [{ path: "/replay", type: "layout" }, { path: "/live" }, { path: "/strategy" }, { path: "/race-engineer" }, { path: "/" }, { path: "/circuits", type: "layout" }],
  telemetry: [{ path: "/telemetry" }, { path: "/circuits", type: "layout" }, { path: "/drivers", type: "layout" }],
  results: [{ path: "/drivers", type: "layout" }, { path: "/teams", type: "layout" }, { path: "/standings" }, { path: "/cars", type: "layout" }, { path: "/" }],
};

export async function POST(req: Request) {
  const auth = hasSyncSecret(req);
  if (auth !== "ok") return Response.json({ error: auth === "unconfigured" ? "revalidation disabled: SYNC_SECRET is not set" : "unauthorized" }, { status: auth === "unconfigured" ? 503 : 401 });
  let kinds: unknown;
  try {
    kinds = ((await req.json()) as { kinds?: unknown }).kinds;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!Array.isArray(kinds) || kinds.length === 0 || kinds.some((k) => typeof k !== "string" || !(k in PATHS))) return Response.json({ error: "kinds must list replay, telemetry or results" }, { status: 400 });
  const done = new Set<string>();
  for (const k of new Set(kinds as string[])) for (const p of PATHS[k]) if (!done.has(p.path)) {
    revalidatePath(p.path, p.type);
    done.add(p.path);
  }
  return Response.json({ revalidated: [...done] });
}
