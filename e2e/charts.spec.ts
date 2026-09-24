import { expect, test } from "@playwright/test";
import { defaultScenario } from "../src/scenario";
import { encodeScenarioLink } from "../src/share/link";
import { addStrategy, openApp, runAndWait } from "./helpers";

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

interface Box {
  label: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  knockout: boolean;
  moved: boolean;
}
const boxesOf = async (canvas: import("@playwright/test").Locator): Promise<Box[]> => {
  await expect(canvas).toHaveAttribute("data-ref-labels", /^\[/);
  return JSON.parse((await canvas.getAttribute("data-ref-labels"))!) as Box[];
};
const overlap = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

async function expectLabelsClean(canvases: import("@playwright/test").Locator, expectedLabels: string[]) {
  const n = await canvases.count();
  expect(n).toBeGreaterThan(0);
  for (let i = 0; i < n; i++) {
    const boxes = await boxesOf(canvases.nth(i));
    expect(boxes.map((b) => b.label)).toEqual(expectedLabels);
    for (const b of boxes) expect(b.knockout, `${b.label} knockout`).toBe(true);
    for (let a = 0; a < boxes.length; a++) for (let c = a + 1; c < boxes.length; c++) expect(overlap(boxes[a]!, boxes[c]!), JSON.stringify(boxes)).toBe(false);
  }
}

test("reference labels: every fan, replay and histogram label is drawn on a knockout, and no two overlap", async ({ page }) => {
  await openApp(page);
  await runAndWait(page);
  await page.getByRole("textbox", { name: "Session", exact: true }).fill("0");
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect(page.getByTestId("replay-bankroll")).toHaveAttribute("data-lines", "2");
  await expectLabelsClean(page.getByTestId("fan-canvas"), ["Start", "Win target"]);
  await expectLabelsClean(page.getByTestId("replay-bankroll"), ["Start", "Win target"]);
  await expectLabelsClean(page.getByTestId("hist-canvas"), ["Start"]);
});

test("reference labels, crowded: win target $1,005 and floor $995 around a $1,000 start stay apart (one is moved)", async ({ page }) => {
  const s = { ...defaultScenario(), stopWin: 1005, stopLoss: 995 };
  const e = encodeScenarioLink(s, "");
  if (!e.ok) throw new Error(e.message);
  await openApp(page, e.fragment);
  await runAndWait(page);
  await expectLabelsClean(page.getByTestId("fan-canvas"), ["Start", "Win target", "Loss floor"]);
  const boxes = await boxesOf(page.getByTestId("fan-canvas").first());
  expect(boxes.some((b) => b.moved)).toBe(true);
  // The narrowest layout too: phone width, where panels are smallest.
  await page.setViewportSize({ width: 360, height: 800 });
  await expect.poll(async () => (await page.getByTestId("fan-canvas").first().boundingBox())!.width).toBeLessThan(360);
  await expect.poll(() => page.getByTestId("fan-canvas").first().getAttribute("data-draws")).not.toBe("1");
  await expectLabelsClean(page.getByTestId("fan-canvas"), ["Start", "Win target", "Loss floor"]);
});

test("selected-path highlight: the replayed session is highlighted (on a theme-aware halo) in EVERY fan panel", async ({ page }) => {
  await openApp(page);
  await addStrategy(page, "Paroli");
  await runAndWait(page);
  const fans = page.getByTestId("fan-canvas");
  await expect(fans).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(fans.nth(i)).not.toHaveAttribute("data-highlighted", /.*/);
  const theme = page.getByRole("combobox", { name: "Theme", exact: true });
  for (const [session, mode] of [[7, "light"], [31, "dark"]] as const) {
    await theme.selectOption(mode);
    await page.getByRole("textbox", { name: "Session", exact: true }).fill(String(session));
    await page.getByRole("button", { name: "Replay", exact: true }).click();
    const panel = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--panel").trim());
    for (let i = 0; i < 3; i++) {
      await expect(fans.nth(i)).toHaveAttribute("data-highlighted", String(session));
      await expect(fans.nth(i)).toHaveAttribute("data-halo", panel);
      await expect(fans.nth(i)).toHaveAttribute("data-theme", mode);
    }
  }
  // A session beyond the 50 sample paths has no path to highlight: the hook says so.
  await page.getByRole("textbox", { name: "Session", exact: true }).fill("500");
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  for (let i = 0; i < 3; i++) await expect(fans.nth(i)).not.toHaveAttribute("data-highlighted", /.*/);
});
