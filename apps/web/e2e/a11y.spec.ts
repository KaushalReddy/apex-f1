import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "./fixtures";

// Serious and critical accessibility issues fail the test; the 3D canvases are excluded (axe cannot read WebGL content).
const PAGES = ["/", "/analysis", "/drivers", "/drivers/norris", "/drivers/compare", "/teams", "/teams/ferrari", "/standings", "/cars", "/circuits", "/strategy?session=11388", "/telemetry", "/race-engineer", "/replay", "/replay/11388"];

test.describe("accessibility (axe)", () => {
  for (const path of PAGES) {
    test(`${path} has no serious or critical issues`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      const r = await new AxeBuilder({ page }).exclude("canvas").withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
      const bad = r.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
      expect(bad.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
    });
  }
});
