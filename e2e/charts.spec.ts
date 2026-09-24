import { expect, test } from "@playwright/test";
import { openApp, runAndWait } from "./helpers";

// Session 10: chart polish seen on the live site. Assertions are on state (text, data-* hooks).

test("no stale 'later version' / 'coming soon' copy anywhere, before or after a run; the empty charts say what they will show", async ({ page }) => {
  const stale = /later version|coming soon/i;
  await openApp(page);
  await expect(page.locator("body")).not.toContainText(stale);
  const slots = page.locator(".chart-slot");
  await expect(slots).toHaveCount(2);
  await expect(slots.nth(0)).toContainText("How each strategy's bankroll evolves over the rounds");
  await expect(slots.nth(1)).toContainText("Where each strategy's sessions end");
  for (let i = 0; i < 2; i++) await expect(slots.nth(i)).toContainText("Press Run above to simulate: this chart appears here.");
  await expect(page.getByTestId("elapsed")).toHaveText("—"); // no run yet
  await runAndWait(page);
  await expect(page.locator(".chart-slot")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(stale);
  await expect(page.getByTestId("elapsed")).toHaveText(/^(<0\.1|\d+\.\d)s$/);
});
