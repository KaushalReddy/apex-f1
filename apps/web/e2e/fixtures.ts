import { readFileSync } from "node:fs";
import path from "node:path";
import { test as base, expect, type Page } from "@playwright/test";

/** Console errors and uncaught exceptions fail the test (a page that "works" while throwing is a bug). */
export const test = base.extend<{ errors: string[] }>({
  errors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(`console: ${m.text()}`);
      });
      await use(errors);
      expect(errors, "no console errors or uncaught exceptions").toEqual([]);
    },
    { auto: true },
  ],
});
export { expect };

/** REAL DATA: Singapore 2026 (OpenF1 session 11388), as exported to public/replay. */
export const SINGAPORE = 11388;
const sg = JSON.parse(readFileSync(path.join(__dirname, "../public/replay/2026/11388.json"), "utf8")) as { lightsOutMs: number };
/** Replay time (ms) at `min` minutes after lights out in Singapore. */
export const sgAt = (min: number) => sg.lightsOutMs + min * 60_000;

/** The replay header's "Lap n/N · h:mm:ss" readout. */
export async function replayClock(page: Page) {
  return (await page.getByText(/^Lap \d+\/\d+ · [\d:]+$/).first().textContent())?.trim() ?? "";
}

/** Opens the Singapore replay (optionally at a moment) and waits until the race has loaded. */
export async function openReplay(page: Page, atMin?: number) {
  await page.goto(`/replay/${SINGAPORE}${atMin != null ? `#t=${sgAt(atMin)}` : ""}`);
  // Loaded once playback is possible (the race order is collapsed on phones, so it is not the signal).
  await expect(page.getByRole("button", { name: /^(Play|Resume)$/ })).toBeEnabled({ timeout: 30_000 });
  await expect(page.locator("canvas").first()).toBeVisible();
}

/** A faked /api/engineer answer stream (newline-delimited JSON events), so no test calls Gemini. */
export function fakeEngineer(page: Page, events: object[]) {
  return page.route("**/api/engineer", (route) => route.fulfill({ status: 200, contentType: "application/x-ndjson", body: events.map((e) => JSON.stringify(e)).join("\n") + "\n" }));
}
