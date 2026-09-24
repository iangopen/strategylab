import { expect, test } from "@playwright/test";
import { runMonteCarlo } from "../src/engine/montecarlo";
import { defaultScenario, toSimRequest } from "../src/scenario";
import { activeRangeEnd } from "../src/ui/charts/adapters";
import { MARGIN } from "../src/ui/charts/canvas";
import { resolveStrategies } from "../src/worker/resolve";
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

// ---------------------------------------------------------------- synchronized fan zoom

/** Activity ends per strategy for the DEFAULT scenario, from the engine in Node (the exact worker code). */
function defaultActiveEnds(): number[] {
  const req = toSimRequest(defaultScenario());
  const r = runMonteCarlo(req.game, resolveStrategies(req.strategies), req.session, req.nSessions, req.masterSeed);
  return r.perStrategy.map((o) => activeRangeEnd(o.bands, r.bands.rounds));
}

async function fanState(page: import("@playwright/test").Page) {
  const fans = page.getByTestId("fan-canvas");
  const n = await fans.count();
  for (let i = 0; i < n; i++) await expect(fans.nth(i)).toHaveAttribute("data-x-range", /^[\d.]+-[\d.]+$/);
  return fans.evaluateAll((els) => els.map((e) => ({ xRange: e.dataset.xRange!, zoom: e.dataset.zoom!, yMin: e.dataset.yMin!, yMax: e.dataset.yMax! })));
}

async function expectAllPanels(page: import("@playwright/test").Page, attr: string, value: string) {
  const fans = page.getByTestId("fan-canvas");
  const n = await fans.count();
  for (let i = 0; i < n; i++) await expect(fans.nth(i)).toHaveAttribute(attr, value);
}

test("zoom: a drag on the Martingale panel zooms EVERY fan panel to one identical x window; y never changes; double-click resets", async ({ page }) => {
  await openApp(page);
  await runAndWait(page);
  const before = await fanState(page);
  expect(before.map((s) => s.xRange)).toEqual(["0-1000", "0-1000"]);
  const mart = page.getByTestId("fan-canvas").nth(1);
  await expect(mart).toHaveAttribute("data-label", "Martingale");
  await mart.scrollIntoViewIfNeeded();
  const b = (await mart.boundingBox())!;
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + b.width * 0.3, y);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.45, y);
  await page.mouse.move(b.x + b.width * 0.6, y);
  await page.mouse.up();
  await expect(mart).not.toHaveAttribute("data-zoom", "full");
  const zoomed = await fanState(page);
  expect(new Set(zoomed.map((s) => s.xRange)).size).toBe(1); // identical on every panel
  expect(zoomed[0]!.zoom).toBe(zoomed[0]!.xRange);
  const [lo, hi] = zoomed[0]!.xRange.split("-").map(Number) as [number, number];
  expect(lo).toBeGreaterThan(0);
  expect(hi).toBeLessThan(1000);
  expect(zoomed.map((s) => [s.yMin, s.yMax])).toEqual(before.map((s) => [s.yMin, s.yMax])); // y untouched
  await expect(page.getByTestId("fan-zoom-status")).toContainText(`Showing rounds ${lo.toLocaleString("en-US")}–`);
  // The drag did not also pick a path (it was a zoom, not a click).
  await expect(mart).not.toHaveAttribute("data-selected", /.*/);
  await page.getByTestId("fan-canvas").first().dblclick();
  await expectAllPanels(page, "data-zoom", "full");
  await expectAllPanels(page, "data-x-range", "0-1000");
});

test("zoom: 'Fit to this strategy' on Martingale sets [0, its active range] (from the engine, under 100 rounds) on every panel; Reset restores", async ({ page }) => {
  const ends = defaultActiveEnds();
  expect(ends[1]!).toBeLessThan(100);
  await openApp(page);
  await runAndWait(page);
  const fans = page.getByTestId("fan-canvas");
  await expect(fans.nth(0)).toHaveAttribute("data-active-end", String(ends[0]));
  await expect(fans.nth(1)).toHaveAttribute("data-active-end", String(ends[1]));
  const before = await fanState(page);
  await page.locator("figure.chart-panel", { has: page.locator('[data-label="Martingale"]') }).getByRole("button", { name: "Fit to this strategy" }).click();
  await expectAllPanels(page, "data-x-range", `0-${ends[1]}`);
  await expectAllPanels(page, "data-zoom", `0-${ends[1]}`);
  const after = await fanState(page);
  expect(after.map((s) => [s.yMin, s.yMax])).toEqual(before.map((s) => [s.yMin, s.yMax]));
  // The hover readout follows the zoom: the snapped round is inside the window.
  const flat = fans.first();
  const fb = (await flat.boundingBox())!;
  await flat.hover({ position: { x: fb.width * 0.7, y: fb.height * 0.5 } });
  await expect(flat).toHaveAttribute("data-hover-round", /^\d+$/);
  expect(Number(await flat.getAttribute("data-hover-round"))).toBeLessThanOrEqual(ends[1]!);
  await page.getByRole("button", { name: "Show every round", exact: true }).click();
  await expectAllPanels(page, "data-zoom", "full");
  // Fit to Flat: its sessions run the whole way, so it is the full range.
  await page.locator("figure.chart-panel", { has: page.locator('[data-label="Flat"]') }).getByRole("button", { name: "Fit to this strategy" }).click();
  await expectAllPanels(page, "data-x-range", `0-${ends[0]}`);
});

test("zoom: a new run starts unzoomed, and a plain click still picks a path to replay", async ({ page }) => {
  await openApp(page);
  await runAndWait(page);
  await page.locator("figure.chart-panel", { has: page.locator('[data-label="Martingale"]') }).getByRole("button", { name: "Fit to this strategy" }).click();
  const fan = page.getByTestId("fan-canvas").first();
  await expect(fan).not.toHaveAttribute("data-zoom", "full");
  // While zoomed, a click (no drag) on the start point shared by all 50 paths picks a session.
  const [xMin, xMax] = (await fan.getAttribute("data-x-range"))!.split("-").map(Number) as [number, number];
  const yMax = Number(await fan.getAttribute("data-y-max"));
  const b = (await fan.boundingBox())!;
  const px = MARGIN.left + ((0 - xMin) / (xMax - xMin)) * (b.width - MARGIN.left - MARGIN.right);
  const py = MARGIN.top + (b.height - MARGIN.top - MARGIN.bottom) * (1 - defaultScenario().startBankroll * 100 / yMax);
  await fan.click({ position: { x: px + 2, y: py } });
  await expect(fan).toHaveAttribute("data-selected", /^\d+$/);
  await expect(fan).not.toHaveAttribute("data-zoom", "full"); // a click never changes the zoom
  await page.getByRole("textbox", { name: "Seed", exact: true }).fill("99");
  await runAndWait(page);
  await expectAllPanels(page, "data-zoom", "full");
});
