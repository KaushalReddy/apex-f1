import { expect, fakeEngineer, SINGAPORE, test } from "./fixtures";

test.describe("strategy", () => {
  test("shows a driver's stints and a labelled what-if", async ({ page }) => {
    await page.goto(`/strategy?session=${SINGAPORE}&driver=NOR`);
    await expect(page.getByRole("heading", { name: /Tyre stints, in finishing order/ })).toBeVisible();
    const stints = page.getByRole("table", { name: "Stints of NOR" });
    await expect(stints.getByRole("row")).toHaveCount(3); // header + soft + medium
    const whatIf = page.getByRole("complementary", { name: "What if?" });
    await expect(whatIf.getByText("Simulation")).toBeVisible();
    await whatIf.getByRole("slider").fill("37");
    await expect(whatIf.getByText(/s over the race/)).toBeVisible();
    await expect(whatIf.getByText(/P4/)).toBeVisible();
  });

  test("switches race from the picker", async ({ page }) => {
    await page.goto(`/strategy?session=${SINGAPORE}`);
    const race = page.getByRole("combobox", { name: "Race" });
    await race.selectOption((await race.locator("option", { hasText: "Dutch Grand Prix" }).getAttribute("value")) ?? "");
    await expect(page).toHaveURL(/session=11353/);
    await expect(page.getByRole("heading", { name: /Tyre stints/ })).toBeVisible();
  });
});

test.describe("telemetry lab", () => {
  test("compares two fastest laps with charts and the 3D map", async ({ page }) => {
    await page.goto("/telemetry");
    await expect(page.getByText("Speed (km/h)").first()).toBeVisible();
    await expect(page.locator("canvas").first()).toBeVisible();
    const b = page.getByRole("combobox", { name: "Driver B" });
    const options = b.locator("option");
    const second = await options.nth(2).getAttribute("value");
    await b.selectOption(second ?? "");
    await page.getByRole("button", { name: "Compare" }).click();
    await expect(page).toHaveURL(/b=/);
    await expect(page.getByText("Speed (km/h)").first()).toBeVisible();
  });
});

test.describe("race engineer page", () => {
  test("answers from a (faked) stream, shows look-ups and links moments into the replay", async ({ page }) => {
    await fakeEngineer(page, [
      { type: "tool", label: "Race summary", ok: true },
      { type: "tool", label: "VER's race", ok: true },
      { type: "text", text: "**Verstappen** won from pole.\n\n- Pitted on [lap 32](#t=3198920)\n- <b>never html</b>" },
      { type: "done" },
    ]);
    await page.goto(`/race-engineer?session=${SINGAPORE}`);
    await page.getByRole("button", { name: "How was this race won?" }).click();
    await expect(page.getByText("Looked up: VER's race")).toBeVisible();
    await expect(page.getByText("Verstappen", { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "lap 32" })).toHaveAttribute("href", "/replay/11388#t=3198920");
    await expect(page.getByText("<b>never html</b>")).toBeVisible(); // model output is never rendered as HTML
  });

  test("shows the provider's reason when a question is rejected", async ({ page }) => {
    await fakeEngineer(page, [{ type: "error", message: "The AI service rejected the request: quota used up" }]);
    await page.goto(`/race-engineer?session=${SINGAPORE}`);
    await page.getByRole("textbox", { name: "Your question" }).fill("Who won?");
    await page.getByRole("button", { name: "Ask" }).click();
    await expect(page.getByText("The AI service rejected the request: quota used up")).toBeVisible();
  });
});
