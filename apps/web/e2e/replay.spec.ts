import { expect, fakeEngineer, openReplay, replayClock, sgAt, test } from "./fixtures";

const seconds = (clock: string) => {
  const [h, m, s] = clock.split(" · ")[1].split(":").map(Number);
  return h * 3600 + m * 60 + s;
};

test.describe("race replay (Singapore 2026, real data)", () => {
  test("loads the race in a worker, shows the order, and plays", async ({ page }) => {
    const workers: string[] = [];
    page.on("worker", (w) => workers.push(w.url()));
    await openReplay(page);
    expect(workers.length, "the race file is parsed off the main thread").toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: /^(Play|Resume)$/ })).toBeVisible();
    await page.getByRole("button", { name: /^(Play|Resume)$/ }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    // The race clock moves while playing.
    await expect.poll(async () => (await page.getByText(/^[−-]?\d:\d\d:\d\d$|^Lap \d+\/\d+ · /).first().textContent()) ?? "", { timeout: 15_000 }).not.toBe("−0:00:20");
  });

  test("a #t= link opens at that moment, and ±10 s seeks", async ({ page }) => {
    await openReplay(page, 60);
    await expect.poll(() => replayClock(page)).toMatch(/^Lap 3[67]\/62 · 0:59:5\d$/);
    const before = seconds(await replayClock(page));
    await page.getByRole("button", { name: /forward 10 seconds/ }).click();
    await expect.poll(async () => seconds(await replayClock(page))).toBe(before + 10);
    await page.getByRole("button", { name: /back 10 seconds/ }).click();
    await expect.poll(async () => seconds(await replayClock(page))).toBe(before);
  });

  test("race control lists messages up to the moment and seeks to one; conditions show the weather", async ({ page }) => {
    await openReplay(page, 60);
    await page.getByRole("button", { name: "Race control" }).click();
    const panel = page.getByRole("region", { name: /race control/i });
    const list = panel.getByRole("list", { name: "Race control messages" });
    await expect(list.getByRole("button").first()).toBeVisible();
    // Newest first, up to 60 minutes: the only "VSC deployed" so far is the first VSC (lap 8, 12:54 into the race).
    await list.getByRole("button", { name: /VSC deployed/i }).click();
    await expect.poll(async () => seconds(await replayClock(page))).toBeLessThan(14 * 60);
    await expect.poll(async () => seconds(await replayClock(page))).toBeGreaterThan(12 * 60);
    await panel.getByRole("tab", { name: "Conditions" }).click();
    await expect(panel.getByText("Track", { exact: true })).toBeVisible();
    // One Close press closes it.
    await panel.getByRole("button", { name: "Close" }).click();
    await expect(panel).toHaveCount(0);
  });

  test("compares two drivers, with both tyre strategies on the lap chart", async ({ page }) => {
    await openReplay(page, 60);
    await page.getByRole("button", { name: "Compare", exact: true }).click();
    await page.getByRole("button", { name: /^P\d+ VER / }).click();
    await page.getByRole("button", { name: /^P\d+ NOR / }).click();
    await page.getByRole("button", { name: "Compare VER and NOR" }).click();
    await expect(page.getByRole("button", { name: "Exit comparison" })).toBeVisible();
    await page.getByRole("tab", { name: "Laps" }).click();
    const strip = page.getByLabel("Tyre stints");
    await expect(strip.locator("span[title]")).toHaveCount(4); // two stints each
    await expect(page.getByRole("link", { name: /Tyre strategy and a what-if/ })).toHaveAttribute("href", /\/strategy\?session=11388&driver=VER/);
  });

  test("rewind explains a driver's position changes up to the replay moment and steps through them", async ({ page }) => {
    await openReplay(page, 60);
    await page.getByRole("button", { name: "Rewind" }).click();
    const panel = page.getByRole("region", { name: /race rewind/i });
    const driver = panel.getByRole("combobox", { name: "Driver" });
    await driver.selectOption((await driver.locator("option", { hasText: "NOR" }).getAttribute("value")) ?? "");
    await expect(panel.getByText(/NOR started P5/)).toBeVisible();
    const steps = panel.getByRole("list", { name: /Position changes of NOR/ }).getByRole("listitem");
    await expect(steps).toHaveCount(5); // up to 60 minutes: no spoilers
    await expect(panel.getByText(/Pit stop: dropped behind/)).toBeVisible();
    await panel.getByRole("checkbox", { name: /Whole race/ }).check();
    await expect(steps).toHaveCount(8);
    await expect(panel.getByText(/finished\s*P4/)).toBeVisible();
    // Selecting a change jumps there and highlights it.
    await steps.first().getByRole("button").click();
    await expect(steps.first().getByRole("button")).toHaveAttribute("aria-current", "step");
    await expect.poll(async () => seconds(await replayClock(page))).toBeLessThan(31 * 60);
  });

  test("the engineer panel answers from a (faked) stream, and its moment links seek", async ({ page }) => {
    await fakeEngineer(page, [
      { type: "tool", label: "Race summary", ok: true },
      { type: "text", text: `**VER** leads. NOR pitted on [lap 32](#t=${sgAt(52)}).` },
      { type: "done" },
    ]);
    await openReplay(page, 60);
    await page.getByRole("button", { name: "Engineer" }).click();
    const panel = page.getByRole("region", { name: /race engineer/i });
    await panel.getByRole("textbox", { name: "Your question" }).fill("What happened?");
    await panel.getByRole("button", { name: "Ask" }).click();
    await expect(panel.getByText("Looked up: Race summary")).toBeVisible();
    await expect(panel.getByText("VER", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "lap 32" }).click();
    await expect.poll(async () => seconds(await replayClock(page))).toBe(51 * 60 + 57);
  });

  test("rewind's 'ask the engineer' pre-fills the question without sending it", async ({ page }) => {
    let calls = 0;
    await page.route("**/api/engineer", (r) => {
      calls++;
      return r.abort();
    });
    await openReplay(page, 60);
    await page.getByRole("button", { name: "Rewind" }).click();
    await page.getByRole("button", { name: "Ask the engineer to explain" }).click();
    await expect(page.getByRole("textbox", { name: "Your question" })).toHaveValue(/^Why did .+ gain and lose places so far\?$/);
    expect(calls).toBe(0);
  });
});
