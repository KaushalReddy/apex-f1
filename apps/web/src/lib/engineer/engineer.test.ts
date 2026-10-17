import { readFileSync } from "node:fs";
import type { GenerateContentParameters, GoogleGenAI, Part } from "@google/genai";
import { describe, expect, it } from "vitest";
import { parseReplay, type ReplayDataset } from "@/lib/replay/dataset";
import { MAX_ROUNDS, runEngineer, validHistory, type EngineerEvent } from "./engineer";
import { cutAt, EngineerData, runTool } from "./tools";

// REAL DATA: Singapore 2026 (OpenF1 session 11388), as exported.
const r = parseReplay(JSON.parse(readFileSync("public/replay/2026/11388.json", "utf8")));
if (!r.ok) throw new Error(r.error);
const ds: ReplayDataset = r.value;
const mid = ds.lightsOutMs + 45 * 60_000; // 45 minutes into the race

describe("cutAt (no spoilers)", () => {
  const cut = cutAt(ds, mid);
  it("keeps nothing after the replay moment", () => {
    expect(cut.durationMs).toBe(mid);
    expect(cut.order.every(([t]) => t <= mid)).toBe(true);
    expect(cut.pits.every((p) => p.t <= mid)).toBe(true);
    expect(cut.raceControl.every((m) => m.t <= mid)).toBe(true);
    expect(cut.weather!.t.every((t) => t <= mid)).toBe(true);
    for (const d of cut.drivers) {
      expect(d.laps.every(([, start, s]) => start + (s as number) * 1000 <= mid)).toBe(true);
      expect(d.intervals.t.every((t) => t <= mid)).toBe(true);
      const last = d.laps.at(-1)?.[0] ?? 0;
      expect(d.stints.every((s) => (s.lapStart ?? 0) <= Math.max(1, last) && (s.lapEnd == null || s.lapEnd <= last))).toBe(true);
    }
    expect(cut.raceControl.some((m) => /CHEQUERED/.test(m.message))).toBe(false);
  });
  it("returns the full race unchanged without a cut", () => {
    expect(cutAt(ds, null)).toBe(ds);
    expect(cutAt(ds, ds.durationMs + 1)).toBe(ds);
  });
});

describe("tools on real data", () => {
  const full = new EngineerData(ds, null);
  const part = new EngineerData(ds, mid);
  it("summarises the whole race with a final classification, and the replay moment with the current order only", () => {
    const s = full.summary() as Record<string, unknown>;
    expect(s.scope).toBe("Whole race.");
    const fc = s.final_classification as { position: number; driver: string }[];
    expect(fc[0]).toMatchObject({ position: 1, driver: "VER" });
    const p = part.summary() as Record<string, unknown>;
    expect(p.final_classification).toBeUndefined();
    expect(String(p.scope)).toMatch(/Nothing later is known/);
    expect(p.laps_completed_by_leader as number).toBeLessThan(s.laps_completed_by_leader as number);
  });
  it("finds drivers by code, number or surname, and refuses unknown ones", () => {
    const nor = full.driver("nor")!;
    expect(full.code(nor)).toBe("NOR");
    expect(full.driver(String(ds.drivers[nor].number))).toBe(nor);
    expect(full.driver("Norris")).toBe(nor);
    expect(runTool(full, "driver_race", { driver: "XYZ" })).toMatchObject({ ok: false });
  });
  it("validates every tool input and reports unknown tools", () => {
    expect(runTool(full, "lap_times", { drivers: [], from_lap: 1, to_lap: 2 })).toMatchObject({ ok: false });
    expect(runTool(full, "lap_times", { drivers: ["VER"], from_lap: 5, to_lap: 2 })).toMatchObject({ ok: false });
    expect(runTool(full, "lap_times", { drivers: ["VER"], from_lap: "1", to_lap: 2 })).toMatchObject({ ok: false });
    expect(runTool(full, "race_control", { from_lap: 1.5 })).toMatchObject({ ok: false });
    expect(runTool(full, "nope", {})).toMatchObject({ ok: false, error: "unknown tool nope" });
    const lt = runTool(full, "lap_times", { drivers: ["VER", "NOR"], from_lap: 10, to_lap: 12 });
    expect(lt.ok && (lt.value as { laps: unknown[] }[]).map((d) => d.laps.length)).toEqual([3, 3]);
  });
  it("gives a driver's race with pit stops and stints, and a battle with gaps between two cars", () => {
    const d = runTool(full, "driver_race", { driver: "NOR" });
    if (!d.ok) throw new Error(d.error);
    const v = d.value as { pit_stops: { lap: number }[]; stints: { compound: string }[]; finish_position: number };
    expect(v.pit_stops.map((p) => p.lap)).toEqual([32]);
    expect(v.stints.map((s) => s.compound)).toEqual(["SOFT", "MEDIUM"]);
    expect(v.finish_position).toBe(4);
    const b = runTool(full, "battle", { driver_a: "VER", driver_b: "NOR" });
    if (!b.ok) throw new Error(b.error);
    const laps = (b.value as { laps: { gap_b_minus_a_s: number | null }[] }).laps;
    expect(laps.filter((l) => l.gap_b_minus_a_s != null).length).toBeGreaterThan(40);
  });
});

describe("position_changes tool", () => {
  it("gives the Race Rewind analysis, cut at the replay moment", () => {
    const full = runTool(new EngineerData(ds, null), "position_changes", { driver: "NOR" });
    if (!full.ok) throw new Error(full.error);
    const v = full.value as { finish_position: number; changes: { swaps: { cause: string }[] }[] };
    expect(v.finish_position).toBe(4);
    expect(v.changes.some((c) => c.swaps.some((w) => w.cause === "own-pit"))).toBe(true);
    const part = runTool(new EngineerData(ds, mid), "position_changes", { driver: "NOR" });
    if (!part.ok) throw new Error(part.error);
    const p = part.value as { current_position: number; changes: { t: number }[] };
    expect(p.changes.every((c) => c.t <= mid)).toBe(true);
    expect(p.changes.length).toBeLessThan(v.changes.length);
  });
});

describe("validHistory", () => {
  it("accepts alternating turns that end with a question, and rejects anything else", () => {
    expect(validHistory([{ role: "user", text: "Who won?" }])).toHaveLength(1);
    expect(validHistory([])).toBeNull();
    expect(validHistory([{ role: "assistant", text: "hi" }])).toBeNull();
    expect(validHistory([{ role: "user", text: "a" }, { role: "assistant", text: "b" }])).toBeNull();
    expect(validHistory([{ role: "user", text: "x".repeat(2001) }])).toBeNull();
    expect(validHistory([{ role: "system", text: "x" }])).toBeNull();
    expect(validHistory(Array.from({ length: 21 }, (_, k) => ({ role: k % 2 ? "assistant" : "user", text: "x" })))).toBeNull();
  });
});

/** A stand-in for the Gemini client: each scripted response is streamed as one chunk per part; each request is recorded. */
function stub(responses: { parts: Part[]; finishReason?: string }[]) {
  const requests: GenerateContentParameters[] = [];
  const client = {
    models: {
      async generateContentStream(params: GenerateContentParameters) {
        // Copy: the loop appends to the same contents array after each round.
        requests.push({ ...params, contents: [...(params.contents as unknown[])] } as GenerateContentParameters);
        const res = responses[requests.length - 1];
        return (async function* () {
          for (const [k, p] of res.parts.entries()) yield { candidates: [{ content: { role: "model", parts: [p] }, finishReason: k === res.parts.length - 1 ? res.finishReason : undefined }] };
          if (!res.parts.length) yield { candidates: [{ finishReason: res.finishReason }] };
        })();
      },
    },
  };
  return { client: client as unknown as Pick<GoogleGenAI, "models">, requests };
}

type Sent = { role: string; parts: Part[] }[];

describe("runEngineer (stubbed API)", () => {
  const data = new EngineerData(ds, mid);
  it("runs the tools the model asks for, returns all results in one turn with the model's parts kept, then streams the answer", async () => {
    const { client, requests } = stub([
      {
        parts: [
          { text: "planning", thought: true, thoughtSignature: "sig" },
          { text: "Let me check. " },
          { functionCall: { id: "a", name: "race_summary", args: {} } },
          { functionCall: { id: "b", name: "driver_race", args: { driver: "nobody" } } },
        ],
        finishReason: "STOP",
      },
      { parts: [{ text: "VER " }, { text: "leads." }], finishReason: "STOP" },
    ]);
    const events: EngineerEvent[] = [];
    await runEngineer(client, [{ role: "user", text: "Who leads?" }], data, "Singapore Grand Prix 2026", (e) => events.push(e));
    // The summary is attached by the server (first event); the preamble before the tool calls and the thought text are never shown.
    expect(events).toEqual([
      { type: "tool", label: "Race summary", ok: true },
      { type: "tool", label: "Race summary", ok: true },
      { type: "tool", label: 'driver_race: no single driver matches "nobody" in this race', ok: false },
      { type: "text", text: "VER leads." },
      { type: "done" },
    ]);
    // The question carries the race and the spoiler scope; the thought text is never shown.
    const first = requests[0].contents as Sent;
    expect(first[0].parts[0].text).toMatch(/^\[Race: Singapore Grand Prix 2026\. Data scope: up to race clock 0:45:00/);
    // The attached summary is the cut one: current order, no final classification.
    expect(first[0].parts[0].text).toMatch(/\[Race summary from the data: \{.*"current_order"/);
    expect(first[0].parts[0].text).not.toMatch(/final_classification/);
    expect(first[0].parts[0].text).toMatch(/Question: Who leads\?$/);
    const second = requests[1].contents as Sent;
    expect(second.at(-2)).toMatchObject({ role: "model", parts: [{ thoughtSignature: "sig" }, { text: "Let me check. " }, { functionCall: { id: "a" } }, { functionCall: { id: "b" } }] });
    const results = second.at(-1)!;
    expect(results.role).toBe("user");
    expect(results.parts.map((p) => [p.functionResponse?.id, p.functionResponse?.response && "error" in p.functionResponse.response])).toEqual([
      ["a", false],
      ["b", true],
    ]);
  });
  it("stops offering tools after the last allowed round", async () => {
    const loop = { parts: [{ functionCall: { id: "x", name: "weather", args: {} } }] };
    const { client, requests } = stub([...Array.from({ length: MAX_ROUNDS }, () => loop), { parts: [{ text: "Done." }], finishReason: "STOP" }]);
    await runEngineer(client, [{ role: "user", text: "Weather?" }], data, "x", () => {});
    expect(requests).toHaveLength(MAX_ROUNDS + 1);
    expect(requests.at(-1)!.config?.toolConfig?.functionCallingConfig?.mode).toBe("NONE");
    expect(requests[0].config?.toolConfig?.functionCallingConfig?.mode).toBe("AUTO");
  });
  it("reports a safety block instead of an empty answer", async () => {
    const { client } = stub([{ parts: [], finishReason: "SAFETY" }]);
    const events: EngineerEvent[] = [];
    await runEngineer(client, [{ role: "user", text: "?" }], data, "x", (e) => events.push(e));
    expect(events).toEqual([
      { type: "tool", label: "Race summary", ok: true },
      { type: "error", message: "The engineer declined to answer that." },
    ]);
  });
});
