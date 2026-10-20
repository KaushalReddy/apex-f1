import { ApiError, GoogleGenAI } from "@google/genai";
import { configured, runEngineer, validHistory, type EngineerEvent } from "@/lib/engineer/engineer";
import { EngineerData } from "@/lib/engineer/tools";
import type { ReplayDataset } from "@/lib/replay/dataset";
import { clientKey, rateLimiter, tooMany } from "@/lib/rate-limit";
import { loadReplayDataset, loadReplayIndex } from "@/lib/replay/load";

/**
 * POST /api/engineer: one Race Engineer question (Phase 14). Body: { session, history: [{role, text}], until?: replay ms }. Answers stream
 * back as newline-delimited JSON events. The API key stays on the server (GEMINI_API_KEY); without it the route answers 503.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Each question is a paid AI call: at most 12 per visitor per 10 minutes. */
const limit = rateLimiter(12, 10 * 60_000);

/** The last few races asked about, parsed once (each file is several MB). */
const cache = new Map<number, ReplayDataset>();
async function dataset(season: number, key: number) {
  const hit = cache.get(key);
  if (hit) return hit;
  const r = await loadReplayDataset(season, key);
  if (!r.ok) return null;
  if (cache.size >= 3) cache.delete(cache.keys().next().value as number);
  cache.set(key, r.value);
  return r.value;
}

/** The API's own explanation inside an ApiError message (which wraps the JSON error body), if present. */
function apiMessage(e: ApiError): string {
  const m = /"message":\s*"((?:[^"\\]|\\.)*)"/.exec(e.message);
  return m ? m[1] : e.message;
}

function friendly(e: unknown) {
  if (e instanceof ApiError) {
    if (e.status === 429) return "The engineer is busy or the key's quota is used up (rate limited). Try again later.";
    if (e.status === 401 || e.status === 403) return `The server's Gemini API key was rejected: ${apiMessage(e)}`;
    // A rejected request (bad key, unknown model, billing) carries the API's own explanation: show it, since retrying will not help.
    if (e.status >= 400 && e.status < 500) return `The AI service rejected the request: ${apiMessage(e)}`;
    return `The AI service returned an error (${e.status}). Try again.`;
  }
  return "Something went wrong while answering.";
}

export async function POST(req: Request) {
  if (!configured()) return Response.json({ error: "not-configured" }, { status: 503 });
  const wait = limit(clientKey(req));
  if (wait) return tooMany(wait, `Too many questions in a short time. Try again in ${Math.ceil(wait / 60)} min.`);
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid JSON" }, { status: 400 });
  }
  const history = validHistory(body.history);
  if (!history) return Response.json({ error: "invalid history" }, { status: 400 });
  const until = body.until == null ? null : Number(body.until);
  if (until != null && !Number.isFinite(until)) return Response.json({ error: "invalid until" }, { status: 400 });
  const entry = (await loadReplayIndex()).find((r) => String(r.sessionKey) === String(body.session));
  if (!entry) return Response.json({ error: "unknown race" }, { status: 404 });
  const ds = await dataset(entry.season, entry.sessionKey);
  if (!ds) return Response.json({ error: "this race could not be read" }, { status: 500 });

  const data = new EngineerData(ds, until);
  const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const emit = (e: EngineerEvent) => ctrl.enqueue(enc.encode(JSON.stringify(e) + "\n"));
      try {
        await runEngineer(client, history, data, `${entry.eventName} ${entry.season} (OpenF1 session ${entry.sessionKey})`, emit, req.signal);
      } catch (e) {
        if (!req.signal.aborted) {
          console.error("engineer:", e);
          emit({ type: "error", message: friendly(e) });
        }
      } finally {
        ctrl.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
