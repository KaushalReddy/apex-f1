import { expect, test } from "./fixtures";

test.describe("site navigation", () => {
  test("the main navigation reaches every section", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation").first();
    for (const [link, heading] of [
      ["Drivers", /^Drivers$/],
      ["Teams", /^Teams$/],
      ["Cars", /car/i],
      ["Circuits", /circuits/i],
      ["Standings", /standings/i],
    ] as const) {
      await nav.getByRole("link", { name: link, exact: true }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(heading);
    }
  });

  test("the analysis hub lists the tools with their real status", async ({ page }) => {
    await page.goto("/analysis");
    for (const tool of ["Replay", "Telemetry", "Strategy", "Race Engineer"]) await expect(page.getByRole("link", { name: new RegExp(tool) }).first()).toBeVisible();
    await expect(page.getByText("2026 races").first()).toBeVisible();
    // Internal development stages never reach the product.
    await expect(page.getByText(/\bphase\b/i)).toHaveCount(0);
  });

  test("no page shows internal development stages or tooling language", async ({ page }) => {
    for (const path of ["/", "/drivers", "/teams", "/cars", "/circuits", "/standings", "/analysis", "/replay", "/telemetry", "/strategy", "/race-engineer"]) {
      await page.goto(path);
      // Visible text only (innerText): embedded data in scripts, e.g. circuit provenance, is not what visitors read.
      const text = await page.locator("body").innerText();
      expect(text, path).not.toMatch(/\bphase \d|\bin this build\b|tools\/openf1|static preview/i);
    }
  });

  test("an unknown page answers 404 with a way back", async ({ page, errors }) => {
    const res = await page.goto("/does-not-exist");
    expect(res?.status()).toBe(404);
    await expect(page.getByRole("link", { name: /home|start/i }).first()).toBeVisible();
    // The browser logs the page's own 404 response as a console error: expected here, and nothing else may be logged.
    expect(errors.filter((e) => !/status of 404/.test(e))).toEqual([]);
    errors.length = 0;
  });
});
