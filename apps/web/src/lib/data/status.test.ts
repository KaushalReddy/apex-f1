import { describe, expect, it } from "vitest";
import { dataStatus } from "./status";

const NOW = Date.parse("2026-10-26T12:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

describe("dataStatus", () => {
  it("without a sync, the bundled snapshot is labelled as such (never as fresh)", () => {
    expect(dataStatus(null, false, NOW, 30)).toMatchObject({ health: "bundled", lastSuccessfulSync: null });
  });
  it("fresh within three intervals of the last success, stale after", () => {
    expect(dataStatus({ run: { lastSuccess: ago(60), lastAttempt: ago(60), consecutiveFailures: 0 } }, true, NOW, 30).health).toBe("fresh");
    expect(dataStatus({ run: { lastSuccess: ago(91), lastAttempt: ago(91), consecutiveFailures: 0 } }, true, NOW, 30).health).toBe("stale");
  });
  it("configured but never run is stale, not fresh", () => {
    expect(dataStatus(null, true, NOW, 30).health).toBe("stale");
  });
  it("a failed latest attempt is failing, with the sanitised category and the last good time kept", () => {
    const s = dataStatus({ run: { lastSuccess: ago(120), lastAttempt: ago(5), consecutiveFailures: 2, lastError: { category: "rate-limit", at: ago(5) } } }, true, NOW, 30);
    expect(s).toMatchObject({ health: "failing", failure: "rate-limit", lastSuccessfulSync: ago(120) });
  });
  it("counts only synced races that have data", () => {
    const replay = { 1: { year: 2026, syncedAt: ago(1), records: { noData: true } }, 2: { year: 2026, syncedAt: ago(1) } };
    expect(dataStatus({ replay, run: { lastSuccess: ago(1), lastAttempt: ago(1) } }, true, NOW, 30).syncedRaces).toBe(1);
  });
  it("a recovered run is fresh again even though an old error is still recorded", () => {
    expect(dataStatus({ run: { lastSuccess: ago(1), lastAttempt: ago(1), consecutiveFailures: 0, lastError: { category: "unavailable", at: ago(40) } } }, true, NOW, 30)).toMatchObject({ health: "fresh", failure: null });
  });
});
