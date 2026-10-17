import { expect, test } from "./fixtures";

test.describe("circuits", () => {
  test("the directory searches circuits", async ({ page }) => {
    await page.goto("/circuits");
    await page.getByRole("searchbox").first().fill("Monza");
    await expect(page.getByRole("link", { name: /Monza/ }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Marina Bay/ })).toHaveCount(0);
  });

  test("the explorer renders the layout and switches views and circuits", async ({ page }) => {
    await page.goto("/circuits/marina-bay");
    await expect(page.getByRole("heading", { name: "Marina Bay" })).toBeVisible();
    await expect(page.locator("canvas").first()).toBeVisible();
    await page.getByRole("button", { name: "Top-down" }).click();
    await expect(page.getByRole("button", { name: "Top-down" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("link", { name: /^Next circuit:/ }).click();
    await expect(page).not.toHaveURL(/marina-bay/);
    await expect(page.locator("canvas").first()).toBeVisible();
  });
});
