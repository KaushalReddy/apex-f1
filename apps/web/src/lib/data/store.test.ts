import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSeasons } from "@/lib/drivers/load";
import { loadReplayDataset, loadReplayIndex, replayFile } from "@/lib/replay/load";
import { loadTelemetryIndex } from "@/lib/telemetry/load";

// REAL DATA (bundled with the build) plus a temporary DATA_DIR standing in for what tools/openf1-sync writes.
let dir: string;
const before = process.env.DATA_DIR;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "apex-data-"));
  process.env.DATA_DIR = dir;
});
afterEach(() => {
  if (before === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = before;
});

const bundledIndex = JSON.parse(readFileSync("public/replay/2026/index.json", "utf8"));
const sg = bundledIndex.sessions.find((s: { sessionKey: number }) => s.sessionKey === 11388);

describe("synced data first, bundled as fallback", () => {
  it("without DATA_DIR the bundled races are listed as before", async () => {
    delete process.env.DATA_DIR;
    const ix = await loadReplayIndex();
    expect(ix.length).toBe(bundledIndex.sessions.length);
    expect((await replayFile(2026, 11388))?.origin).toBe("bundled");
  });

  it("a race synced after the build is listed and served from DATA_DIR; a synced entry replaces the bundled one", async () => {
    mkdirSync(path.join(dir, "replay", "2026"), { recursive: true });
    // TEST DATA: a "new" race 99999 (a copy of Singapore's file with a new key) and a corrected Singapore entry.
    const doc = JSON.parse(readFileSync("public/replay/2026/11388.json", "utf8"));
    writeFileSync(path.join(dir, "replay", "2026", "99999.json"), JSON.stringify({ ...doc, sessionKey: 99999, eventName: "New Grand Prix" }));
    writeFileSync(path.join(dir, "replay", "2026", "index.json"), JSON.stringify({ schema: "apex-f1/race-replay-index@1", season: 2026, sessions: [{ ...sg, sessionKey: 99999, eventName: "New Grand Prix", date: "2026-10-25" }, { ...sg, eventName: "Singapore Grand Prix (corrected)" }] }));
    const ix = await loadReplayIndex();
    expect(ix.length).toBe(bundledIndex.sessions.length + 1);
    expect(ix[0]).toMatchObject({ sessionKey: 99999, eventName: "New Grand Prix", season: 2026 }); // newest first
    expect(ix.find((r) => r.sessionKey === 11388)?.eventName).toBe("Singapore Grand Prix (corrected)");
    expect((await replayFile(2026, 99999))?.origin).toBe("synced");
    const d = await loadReplayDataset(2026, 99999);
    expect(d.ok && d.value.eventName).toBe("New Grand Prix");
  });

  it("a damaged synced file falls back to the bundled copy instead of breaking the page", async () => {
    mkdirSync(path.join(dir, "replay", "2026"), { recursive: true });
    writeFileSync(path.join(dir, "replay", "2026", "11388.json"), "{ truncated");
    const d = await loadReplayDataset(2026, 11388);
    expect(d.ok && d.value.sessionKey).toBe(11388);
  });

  it("season results: a valid synced season replaces the bundled one; an invalid one falls back", async () => {
    mkdirSync(path.join(dir, "results"), { recursive: true });
    const bundled = JSON.parse(readFileSync("src/data/results/2026.json", "utf8"));
    writeFileSync(path.join(dir, "results", "2026.json"), JSON.stringify({ ...bundled, events: bundled.events.slice(0, 3) }));
    const synced = (await loadSeasons()).seasons.find((s) => s.season === 2026)!;
    expect(synced.events.length).toBe(3);
    writeFileSync(path.join(dir, "results", "2026.json"), "not json");
    const fallback = (await loadSeasons()).seasons.find((s) => s.season === 2026)!;
    expect(fallback.events.length).toBe(bundled.events.length);
  });

  it("telemetry index merges synced sessions with the bundled ones", async () => {
    const base = (await loadTelemetryIndex()).length;
    const t = path.join(dir, "telemetry", "2026");
    mkdirSync(t, { recursive: true });
    const ix = JSON.parse(readFileSync("src/data/telemetry/2026/index.json", "utf8"));
    writeFileSync(path.join(t, "index.json"), JSON.stringify({ ...ix, sessions: [{ ...ix.sessions[0], sessionKey: 99998, date: "2026-10-24" }] }));
    copyFileSync(`src/data/telemetry/2026/${ix.sessions[0].sessionKey}.json`, path.join(t, "99998.json"));
    expect((await loadTelemetryIndex()).length).toBe(base + 1);
  });
});
