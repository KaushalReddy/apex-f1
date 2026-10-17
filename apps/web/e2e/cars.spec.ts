import { expect, test } from "./fixtures";

test.describe("cars", () => {
  test("the showcase renders the car and its component thumbnails", async ({ page }) => {
    // Ten offscreen renders in software WebGL, competing with other 3D tests in parallel: slow but not broken (alone: all 10 in ~10 s).
    test.slow();
    await page.goto("/cars/mclaren");
    // Software WebGL in CI builds the car slowly; the page shows "Loading 3D car…" meanwhile.
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
    await expect.poll(() => page.locator('img[src^="data:image/png"]').count(), { timeout: 120_000 }).toBeGreaterThanOrEqual(8);
  });

  test("the car lab hides parts, x-rays and changes views", async ({ page }) => {
    await page.goto("/cars/mclaren/lab");
    await expect(page.locator("canvas").first()).toBeVisible({ timeout: 45_000 });
    const wing = page.getByRole("checkbox", { name: "Show Front wing" });
    await wing.uncheck();
    await expect(wing).not.toBeChecked();
    await expect(page.getByRole("button", { name: "Show all" })).toBeEnabled();
    await page.getByRole("button", { name: "Show all" }).click();
    await expect(wing).toBeChecked();
    await page.getByRole("button", { name: "X-ray" }).click();
    await expect(page.getByRole("button", { name: "X-ray" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Top", exact: true }).click();
    await page.getByRole("button", { name: "Reset scene" }).click();
    await expect(page.getByRole("button", { name: "X-ray" })).toHaveAttribute("aria-pressed", "false");
  });
});
