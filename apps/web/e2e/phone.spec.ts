import { expect, openReplay, test } from "./fixtures";

const noSideScroll = (page: import("@playwright/test").Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe("phone layout", () => {
  for (const path of ["/", "/drivers", "/standings", "/circuits", "/strategy?session=11388", "/telemetry", "/race-engineer"]) {
    test(`${path} has no sideways scroll`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await noSideScroll(page)).toBe(true);
    });
  }

  test("the replay's panels open below the toolbar, one at a time", async ({ page }) => {
    await openReplay(page, 60);
    expect(await noSideScroll(page)).toBe(true);
    const toolbarBottom = await page.getByRole("button", { name: "Rewind" }).evaluate((b) => b.parentElement!.getBoundingClientRect().bottom);
    await page.getByRole("button", { name: "Rewind" }).click();
    const rewind = page.getByRole("region", { name: /race rewind/i });
    await expect(rewind).toBeVisible();
    expect((await rewind.boundingBox())!.y).toBeGreaterThanOrEqual(toolbarBottom);
    await page.getByRole("button", { name: "Race control" }).click();
    await expect(page.getByRole("region", { name: /race control/i })).toBeVisible();
    await expect(rewind).toHaveCount(0);
  });

  test("the telemetry map is built only when scrolled near", async ({ page }) => {
    await page.goto("/telemetry");
    await expect(page.getByText("Speed (km/h)").first()).toBeVisible();
    await expect(page.locator("canvas")).toHaveCount(0);
    await page.getByText("Loading the circuit…").scrollIntoViewIfNeeded();
    await expect(page.locator("canvas").first()).toBeVisible();
  });
});
