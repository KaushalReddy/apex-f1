import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";

// TEST DATA: /api/live is faked in the browser so these states do not depend on OpenF1, a subscription, or a race being on.
const base = { pollMs: 5000, errorCategory: null, session: null, next: { name: "Practice 1", event: "United States", start: "2026-10-23T17:30:00+00:00" }, drivers: [], raceControl: [], sourceTime: null, fetchedAt: null, stale: false, reason: null };
const now = new Date();
const live = {
  ...base,
  status: "live",
  session: { key: 11396, name: "Race", event: "United States", circuit: "Austin", start: now.toISOString(), end: now.toISOString() },
  drivers: [
    { number: 1, code: "VER", name: null, team: null, colour: "#4781D7", position: 1, positionAt: now.toISOString(), gapToLeader: 0, lapsDown: null, interval: null, x: null, y: null, locationAt: null },
    { number: 4, code: "NOR", name: null, team: null, colour: "#F47600", position: 2, positionAt: now.toISOString(), gapToLeader: 1.234, lapsDown: null, interval: 1.234, x: null, y: null, locationAt: null },
  ],
  sourceTime: now.toISOString(),
  fetchedAt: now.toISOString(),
};
const fakeLive = (page: Page, body: object) => page.route("**/api/live", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) }));
const status = (page: Page) => page.getByRole("status").filter({ hasText: /live timing|Live|Reconnecting|No session/i }).first();

test.describe("live timing status", () => {
  test("without a subscription it says live timing is unavailable and when the next session starts", async ({ page }) => {
    await fakeLive(page, { ...base, status: "unavailable", reason: "Live timing needs an OpenF1 real-time subscription, which this site has not configured." });
    await page.goto("/live");
    await expect(status(page)).toContainText("Live timing unavailable: this site has no OpenF1 real-time subscription.");
    await expect(status(page)).toContainText("Next session: United States · Practice 1");
  });

  test("live: the order, and both the source time and the retrieval time", async ({ page }) => {
    await fakeLive(page, live);
    await page.goto("/live");
    await expect(status(page)).toContainText("Live · United States · Race");
    await expect(status(page)).toContainText("recorded by OpenF1 at");
    await expect(status(page)).toContainText("received just now");
    const order = page.getByRole("list", { name: "Live running order" });
    await expect(order.getByRole("listitem")).toHaveCount(2);
    await expect(order.getByRole("listitem").nth(1)).toContainText("NOR");
    await expect(order.getByRole("listitem").nth(1)).toContainText("+1.234");
  });

  test("a failed poll reads Reconnecting, never Live, and says the data is not current", async ({ page }) => {
    await fakeLive(page, { ...live, stale: true, errorCategory: "rate-limit", reason: "Reconnecting to OpenF1: showing the last data received." });
    await page.goto("/live");
    await expect(status(page)).toContainText("Reconnecting · United States · Race");
    await expect(status(page)).toContainText("it is not current");
    await expect(status(page)).not.toContainText(/^Live ·/);
  });
});

test("the replay list says where its data comes from", async ({ page }) => {
  await page.goto("/replay");
  // The e2e server has no DATA_DIR: the bundled snapshot, labelled as such.
  await expect(page.getByRole("status").filter({ hasText: "Race data" })).toContainText("the OpenF1 snapshot built into this version of the site");
});
