import type { Locator } from "@playwright/test";
import { expect, test } from "./fixtures";

/** Selects the option whose text contains `text`. */
async function pick(select: Locator, text: string) {
  const value = await select.locator("option", { hasText: text }).first().getAttribute("value");
  await select.selectOption(value ?? "");
}

test.describe("drivers, teams and standings", () => {
  test("the driver directory filters by search and opens a profile", async ({ page }) => {
    await page.goto("/drivers");
    await page.getByRole("searchbox", { name: "Search" }).fill("Norris");
    const results = page.getByRole("link", { name: /Lando Norris/ });
    await expect(results.first()).toBeVisible();
    await expect(page.getByRole("link", { name: /Max Verstappen/ })).toHaveCount(0);
    await results.first().click();
    await expect(page).toHaveURL(/\/drivers\/norris$/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Norris");
  });

  test("two drivers can be compared head to head", async ({ page }) => {
    await page.goto("/drivers/compare");
    await pick(page.getByRole("combobox", { name: "Driver A" }), "Lando Norris");
    await pick(page.getByRole("combobox", { name: "Driver B" }), "Oscar Piastri");
    await page.getByRole("button", { name: "Compare" }).click();
    await expect(page.getByRole("heading", { name: /Lando Norris and Oscar Piastri/ })).toBeVisible();
  });

  test("standings show both championships and link to drivers and teams", async ({ page }) => {
    await page.goto("/standings");
    await expect(page.getByRole("heading", { name: "Drivers' championship" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Constructors' championship" })).toBeVisible();
    await page.getByRole("link", { name: "Ferrari", exact: true }).first().click();
    await expect(page).toHaveURL(/\/teams\/ferrari$/);
  });

  test("a team page switches season", async ({ page }) => {
    await page.goto("/teams/ferrari");
    await expect(page.getByRole("heading", { name: "2026 season" })).toBeVisible();
    await page.getByRole("radio", { name: "2025" }).check();
    await expect(page.getByRole("radio", { name: "2025" })).toBeChecked();
    await expect(page.getByRole("heading", { name: "2025 season" })).toBeVisible();
  });
});
