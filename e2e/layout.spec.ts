import { expect, test, type Page } from "@playwright/test";
import { addStrategy, dataNum, expectCanvasNotBlank, openApp, runAndWait } from "./helpers";

/** The page has no horizontal scroll at the current viewport width. */
async function expectNoHorizontalScroll(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), { message: "horizontal overflow in px" }).toBe(0);
}

/** Resolved value of a CSS custom property under the current theme. */
const cssVar = (page: Page, name: string) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), name);

test("session 4 / 6 (8): Dark theme redraws every chart in the dark palette, and back; the rule builder follows", async ({ page }) => {
  await openApp(page);
  await addStrategy(page, "Blank rule (same bet every round)");
  await runAndWait(page);
  await page.getByRole("textbox", { name: "Session", exact: true }).fill("0");
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  const fans = page.getByTestId("fan-canvas");
  const hists = page.getByTestId("hist-canvas");
  const bank = page.getByTestId("replay-bankroll");
  await expect(bank).toHaveAttribute("data-lines", "3");
  const theme = page.getByRole("combobox", { name: "Theme", exact: true });

  for (const mode of ["light", "dark", "light"] as const) {
    const drawsBefore = await dataNum(fans.first(), "draws");
    await theme.selectOption(mode);
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    const colors = [await cssVar(page, "--series-0"), await cssVar(page, "--series-1"), await cssVar(page, "--series-2")];
    for (let i = 0; i < 3; i++) {
      await expect(fans.nth(i)).toHaveAttribute("data-theme", mode);
      await expect(fans.nth(i)).toHaveAttribute("data-color", colors[i]!);
      await expect(hists.nth(i)).toHaveAttribute("data-theme", mode);
      await expect(hists.nth(i)).toHaveAttribute("data-color", colors[i]!);
      await expectCanvasNotBlank(fans.nth(i));
    }
    await expect(bank).toHaveAttribute("data-theme", mode);
    // Every change of the data-theme attribute (even System -> Light) redraws the charts.
    await expect.poll(() => dataNum(fans.first(), "draws")).toBeGreaterThan(drawsBefore);
    // The builder card uses the theme's panel background and text colors.
    const panel = await cssVar(page, "--panel");
    const card = page.locator(".strategy-card").nth(2);
    await expect(card.locator(".rule-json, .rule-form").first()).toBeVisible();
    const bg = await page.locator(".panel").first().evaluate((el) => getComputedStyle(el).backgroundColor);
    const expected = await page.evaluate((hex) => {
      const d = document.createElement("div");
      d.style.backgroundColor = hex;
      document.body.appendChild(d);
      const c = getComputedStyle(d).backgroundColor;
      d.remove();
      return c;
    }, panel);
    expect(bg).toBe(expected);
  }
  // The light and dark palettes really differ (the test above would be vacuous otherwise).
  await theme.selectOption("dark");
  const dark0 = await cssVar(page, "--series-0");
  await theme.selectOption("light");
  expect(await cssVar(page, "--series-0")).not.toBe(dark0);
});

test("session 6 (8) / phone width: at 360 px nothing scrolls sideways — defaults, rule builder, results and charts, sports odds", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openApp(page);
  await expectNoHorizontalScroll(page);
  await addStrategy(page, "Blank rule (same bet every round)");
  const c = page.locator(".strategy-card").nth(2);
  await c.locator("fieldset.rule-list").last().getByRole("button", { name: "+ Add a rule" }).click();
  await expectNoHorizontalScroll(page);
  await c.getByRole("tab", { name: "JSON" }).click();
  await expectNoHorizontalScroll(page);
  await runAndWait(page);
  await expectNoHorizontalScroll(page);
  await page.getByRole("combobox", { name: "Game", exact: true }).selectOption({ label: "Sports odds" });
  await page.getByRole("textbox", { name: "Side A odds", exact: true }).fill("110");
  await page.getByRole("textbox", { name: "Side B odds", exact: true }).fill("110"); // the long negative-overround warning
  await expectNoHorizontalScroll(page);
  // The charts shrink to fit: every canvas is at most the viewport wide.
  const widths = await page.locator("canvas").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
  for (const w of widths) expect(w).toBeLessThanOrEqual(360);
});
