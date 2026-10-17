import { FinishReason, FunctionCallingConfigMode, type Content, type FunctionCall, type GoogleGenAI, type Part } from "@google/genai";
import { EngineerData, runTool, TOOLS } from "./tools";

/** Gemini model; override with GEMINI_MODEL (e.g. a newer or larger model available to your key). */
export const MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
/** Tool rounds per question: enough to cross-check a few drivers, bounded so one question cannot run up cost. */
export const MAX_ROUNDS = 6;
export const MAX_HISTORY = 20;
export const MAX_CHARS = 2000;

/** SERVER ONLY. Whether a Gemini API key is set (the key itself never leaves the server). */
export const configured = () => !!process.env.GEMINI_API_KEY;

/** Frozen. The race and data scope arrive in the latest user message, so this text never varies. */
export const SYSTEM = `You are the APEX F1 race engineer: you explain one Formula 1 race to fans using only this app's race data.

Rules:
- Every fact about the race (drivers, positions, gaps, lap times, pit stops, tyres, flags, penalties, weather) must come from the race summary given with the question or from your tools in this conversation. Never use outside knowledge of this race, its results or the people in it, even if you think you know them: the season may differ from anything you remember. Never mention a driver, lap, time or event that is not in that data. If the data does not have something, say plainly that it does not include it.
- The race summary (order, gaps, start positions, stops, tyres, Safety Car/VSC/red-flag periods, fastest lap, weather) comes with each question. Look up anything more specific before stating it: driver_race for one driver (their position every lap, pit stops, stints), battle for two cars, race_control for flags and penalties. Do not claim who led which laps without driver_race.
- You may use general racing knowledge to explain concepts (an undercut, why a Virtual Safety Car makes a pit stop cheaper), but present it as explanation, not as a fact about this race.
- Values marked calc. or calculated (degradation, consistency, gaps between two cars) are estimates from the data: say so when you use them. Do not invent what-if outcomes.
- If the scope says the data stops at a moment of the race, the user is watching a replay: talk only about what has happened up to then and never guess what comes later.
- When you mention a specific moment, link it as [short label](#t=<t>) using a t value copied exactly from the data, so the user can jump there in the replay. Never make up a t value.
- Answer in plain English for fans, short: a direct answer first, then the evidence in a few sentences or a short list. Use driver codes (NOR) or surnames. Times in seconds with up to three decimals.`;

export interface ChatTurn {
  role: "user" | "assistant";
  text: string;
}

export type EngineerEvent = { type: "text"; text: string } | { type: "tool"; label: string; ok: boolean } | { type: "done" } | { type: "error"; message: string };

/** Checks the browser's history (untrusted): alternating turns starting and ending with the user, bounded in count and size. */
export function validHistory(x: unknown): ChatTurn[] | null {
  if (!Array.isArray(x) || x.length < 1 || x.length > MAX_HISTORY) return null;
  const out: ChatTurn[] = [];
  for (const [k, t] of x.entries()) {
    if (!t || typeof t !== "object") return null;
    const { role, text } = t as Record<string, unknown>;
    if (role !== (k % 2 === 0 ? "user" : "assistant") || typeof text !== "string" || !text.trim() || text.length > MAX_CHARS * 4) return null;
    if (role === "user" && text.length > MAX_CHARS) return null;
    out.push({ role: role as ChatTurn["role"], text });
  }
  return out.at(-1)?.role === "user" ? out : null;
}

const BLOCKED = new Set<string>([FinishReason.SAFETY, FinishReason.PROHIBITED_CONTENT, FinishReason.BLOCKLIST, FinishReason.SPII, FinishReason.RECITATION]);

/**
 * One question: the conversation so far plus tool rounds until the model answers. Streams text deltas and tool labels through `emit`.
 * `client` is the Gemini SDK client (a stub in tests).
 */
export async function runEngineer(client: Pick<GoogleGenAI, "models">, history: ChatTurn[], data: EngineerData, raceLine: string, emit: (e: EngineerEvent) => void, signal?: AbortSignal) {
  const scope = data.partial
    ? `Data scope: up to race clock ${data.clock(data.m.ds.durationMs)} of the replay (lap ${data.lapsDone()}). The user has not seen anything later.`
    : "Data scope: the whole race.";
  // The race summary goes with every question, so the model never answers without the real order and drivers in front of it.
  const summary = JSON.stringify(data.summary());
  emit({ type: "tool", label: "Race summary", ok: true });
  const contents: Content[] = history.map((t, k) => ({
    role: t.role === "user" ? "user" : "model",
    parts: [{ text: k === history.length - 1 ? `[Race: ${raceLine}. ${scope}]\n[Race summary from the data: ${summary}]\n\nQuestion: ${t.text}` : t.text }],
  }));
  const functionDeclarations = TOOLS.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.input_schema }));
  for (let round = 0; round <= MAX_ROUNDS; round++) {
    const stream = await client.models.generateContentStream({
      model: MODEL,
      contents,
      config: {
        systemInstruction: SYSTEM,
        tools: [{ functionDeclarations }],
        // The last round offers no tools, so the model must answer with what it has.
        toolConfig: { functionCallingConfig: { mode: round === MAX_ROUNDS ? FunctionCallingConfigMode.NONE : FunctionCallingConfigMode.AUTO } },
        abortSignal: signal,
      },
    });
    // The model's turn is every part it streamed, kept as sent (thought signatures must go back unchanged with the function results).
    const parts: Part[] = [];
    const calls: FunctionCall[] = [];
    // Text is held until the round ends: text written before tool calls is a preamble the final answer repeats, so it is dropped.
    let text = "";
    let finish: string | undefined;
    let blocked = false;
    for await (const chunk of stream) {
      if (chunk.promptFeedback?.blockReason) blocked = true;
      const cand = chunk.candidates?.[0];
      if (cand?.finishReason) finish = cand.finishReason;
      for (const p of cand?.content?.parts ?? []) {
        parts.push(p);
        if (p.text && !p.thought) text += p.text;
        if (p.functionCall) calls.push(p.functionCall);
      }
    }
    if (blocked || (finish && BLOCKED.has(finish))) {
      emit({ type: "error", message: "The engineer declined to answer that." });
      return;
    }
    if (calls.length === 0) {
      if (text) emit({ type: "text", text });
      if (finish === FinishReason.MAX_TOKENS) emit({ type: "text", text: "\n\n(Answer cut short: it reached the length limit.)" });
      emit({ type: "done" });
      return;
    }
    contents.push({ role: "model", parts });
    // All results of one round in a single turn, in call order.
    const results: Part[] = calls.map((c) => {
      const r = runTool(data, c.name ?? "", c.args ?? {});
      emit({ type: "tool", label: r.ok ? r.label : `${c.name}: ${r.error}`, ok: r.ok });
      return { functionResponse: { id: c.id, name: c.name, response: r.ok ? { output: r.value } : { error: r.error } } };
    });
    contents.push({ role: "user", parts: results });
  }
  emit({ type: "done" });
}
