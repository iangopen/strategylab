import { expect, test, type Page } from "@playwright/test";
import { defaultScenario, type ScenarioConfig } from "../src/scenario";
import { readoutInputOf, sweepReadout } from "../src/report/sweepReadout";
import { encodeScenarioLink } from "../src/share/link";
import { toSweepRequest } from "../src/sweep/request";
import { runSweep } from "../src/sweep/run";
import { sweepGrid } from "../src/sweep/sweep";
import { readoutCell } from "../src/ui/sweep/heatmap";
import { expectCanvasNotBlank, openApp, watchPage } from "./helpers";

/** A small sweep: bankroll $200-$1,000 (3 values) by base bet $5-$20 (2 values), Martingale, 500 sessions per cell. */
function smallSweep(): ScenarioConfig {
  const s = { ...defaultScenario(), sessions: 500 };
  return { ...s, sweep: { x: { field: "startBankroll", start: 200, end: 1000, steps: 3 }, y: { field: "baseBet", start: 5, end: 20, steps: 2 }, strategyUid: s.strategies[1]!.uid, targetPct: 5 } };
}

/** The sweep table's exact numbers (data-raw = String(double) of P(bust)|low|high), in cell order. */
async function rawSweep(page: Page): Promise<string[]> {
  return page.getByTestId("sweep-table").locator("td[data-cell]").evaluateAll((tds) => tds.map((td) => `${td.getAttribute("data-cell")}:${td.getAttribute("data-raw")}`));
}

async function runSweepAndWait(page: Page) {
  await page.getByRole("button", { name: "Run sweep" }).click();
  await expect(page.getByTestId("sweep-status")).toContainText(/^Done: /, { timeout: 120_000 });
}

test("a small sweep end to end: heatmap, readout, hover/tap values and the table show the engine's numbers", async ({ page }) => {
  const problems = watchPage(page);
  const s = smallSweep();
  const e = encodeScenarioLink(s, "");
  if (!e.ok) throw new Error(e.message);
  await openApp(page, e.fragment);
  await expect(page.getByTestId("sweep-size")).toHaveText("6 cells × 500 sessions = 3,000 sessions. Every other setting comes from the scenario above.");
  await runSweepAndWait(page);
  await expect(page.getByTestId("sweep-status")).toContainText("Done: 6 cells × 500 sessions in");

  const canvas = page.getByTestId("sweep-canvas");
  await expect(canvas).toHaveAttribute("data-filled", "6");
  await expect(canvas).toHaveAttribute("data-cols", "3");
  await expect(canvas).toHaveAttribute("data-rows", "2");
  await expectCanvasNotBlank(canvas);

  // The table is the same numbers, and they are the engine's (the same request run in Node).
  await page.getByText("Show the same numbers as a table").click();
  const table = page.getByTestId("sweep-table");
  await expect(table.locator("tbody tr")).toHaveCount(2);
  await expect(table.locator("thead th")).toHaveText(["Base bet", "$200", "$600", "$1,000"]);
  const expected = runSweep(toSweepRequest(s, s.sweep!));
  expect(await rawSweep(page)).toEqual(expected.map((c) => `${c.index}:${c.stats.pBust}|${c.stats.pBustLow}|${c.stats.pBustHigh}`));
  await expect(table.locator('td[data-cell="0"]')).toHaveText(/^\d+\.\d% \(\d+\.\d–\d+\.\d%\)$/);

  // Hover shows a cell's P(bust) and interval; a tap (click) pins it.
  const box = (await canvas.boundingBox())!;
  const active = page.getByTestId("sweep-active");
  await page.mouse.move(box.x + box.width - 20, box.y + 12); // top-right cell: bankroll $1,000, base bet $20 (cell 5)
  await expect(active).toContainText(/^Starting bankroll \$1,000, base bet \$20: P\(bust\) \d+\.\d% \(\d+\.\d–\d+\.\d%\), 500 sessions\.$/);
  await expect(canvas).toHaveAttribute("data-active", "5");
  await page.mouse.click(box.x + 80, box.y + box.height - 50); // bottom-left area: cell 0
  await page.mouse.move(box.x + 2, box.y + box.height - 2); // leave the grid: the pinned cell stays
  await expect(canvas).toHaveAttribute("data-active", "0");
  await expect(active).toContainText("Starting bankroll $200, base bet $5: P(bust)");

  const readout = page.getByTestId("sweep-readout").locator("li");
  await expect(readout).toHaveCount(3);
  await expect(readout.first()).toContainText("A bankroll counts only when the upper end of its 95% interval for P(bust) is below 5%");
  await expect(readout.nth(1)).toContainText(/^With a base bet of \$5, /);
  await expect(readout.nth(2)).toContainText(/^With a base bet of \$20, /);
  // The sentences are the pure readout's, on the engine's numbers (the same request run in Node).
  const sentences = sweepReadout(readoutInputOf(s.sweep!, sweepGrid(s, s.sweep!), expected.map(readoutCell)));
  await expect(readout).toHaveText(sentences);
  expect(problems).toEqual([]);
});

test("with no bankroll axis the readout says it needs one and marks no cell", async ({ page }) => {
  const problems = watchPage(page);
  const base = { ...defaultScenario(), sessions: 500 };
  const s: ScenarioConfig = { ...base, sweep: { x: { field: "maxRounds", start: 100, end: 1000, steps: 2 }, y: { field: "baseBet", start: 5, end: 20, steps: 2 }, strategyUid: base.strategies[1]!.uid, targetPct: 5 } };
  const e = encodeScenarioLink(s, "");
  if (!e.ok) throw new Error(e.message);
  await openApp(page, e.fragment);
  await runSweepAndWait(page);
  const canvas = page.getByTestId("sweep-canvas");
  await expect(canvas).toHaveAttribute("data-filled", "4");
  await expect(canvas).toHaveAttribute("data-marked", "");
  await expect(page.getByTestId("sweep-readout").locator("li")).toHaveText(["The bankroll readout needs the starting bankroll as one of the two axes."]);
  await expect(page.getByTestId("sweep-readout")).not.toContainText("smallest bankroll");
  expect(problems).toEqual([]);
});

test("Cancel stops a running max-size sweep, keeps the finished cells, and the worker is usable again", async ({ page }) => {
  const s = defaultScenario();
  const max: ScenarioConfig = { ...s, sweep: { x: { field: "startBankroll", start: 100, end: 1000, steps: 20 }, y: { field: "baseBet", start: 1, end: 20, steps: 20 }, strategyUid: s.strategies[1]!.uid, targetPct: 5 } };
  const e = encodeScenarioLink(max, "");
  if (!e.ok) throw new Error(e.message);
  await openApp(page, e.fragment);
  await expect(page.getByTestId("sweep-size")).toContainText("400 cells × 2,500 sessions = 1,000,000 sessions (fewer than the 10,000 in Sessions");
  await page.getByRole("button", { name: "Run sweep" }).click();
  const canvas = page.getByTestId("sweep-canvas");
  await expect.poll(async () => Number(await canvas.getAttribute("data-filled")), { timeout: 60_000 }).toBeGreaterThan(0);
  // The page stays responsive during the sweep: over one second, no gap between animation frames on
  // the main thread is long (the simulation runs in the worker; cells arrive as small messages).
  const longestFrameGap = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let last = performance.now();
        let worst = 0;
        const end = last + 1000;
        const tick = (t: number) => {
          worst = Math.max(worst, t - last);
          last = t;
          if (t < end) requestAnimationFrame(tick);
          else resolve(worst);
        };
        requestAnimationFrame(tick);
      }),
  );
  console.log(`[sweep e2e] longest gap between frames during the sweep: ${longestFrameGap.toFixed(1)} ms`);
  expect(longestFrameGap).toBeLessThan(250);
  expect(Number(await canvas.getAttribute("data-filled"))).toBeLessThan(400); // still running while measured
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Cancel sweep" }).click();
  await expect(page.getByTestId("sweep-status")).toContainText(/^Cancelled after \d+ of 400 cells\. The finished cells are kept; the bankroll readout needs every cell\.$/);
  const kept = Number(await canvas.getAttribute("data-filled"));
  expect(kept).toBeGreaterThan(0);
  expect(kept).toBeLessThan(400);
  await expect(page.getByTestId("sweep-readout")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Cancel sweep" })).toBeDisabled();
  // Nothing keeps running: the count stays put, and a plain run works in the respawned worker.
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByTestId("run-status")).toContainText(/^Done: /, { timeout: 120_000 });
  expect(Number(await canvas.getAttribute("data-filled"))).toBe(kept);
});

test("the share link reproduces the sweep's numbers bit for bit", async ({ page, context }) => {
  const e = encodeScenarioLink(smallSweep(), "");
  if (!e.ok) throw new Error(e.message);
  await openApp(page, e.fragment);
  await runSweepAndWait(page);
  await page.getByText("Show the same numbers as a table").click();
  const original = await rawSweep(page);

  // The app's own Copy link (it also writes the link into the address bar).
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByText(/^Link copied/)).toBeVisible();
  const link = page.url();
  expect(link).toMatch(/#s=[A-Za-z0-9_-]+$/);

  const fresh = await context.newPage();
  await fresh.goto(link);
  await expect(fresh.getByRole("status", { name: "Opened link" })).toContainText("Loaded the scenario from the link.");
  await runSweepAndWait(fresh);
  await fresh.getByText("Show the same numbers as a table").click();
  const rerun = await rawSweep(fresh);
  expect(rerun).toEqual(original);
  expect(rerun).toHaveLength(6);
  expect(rerun.every((v) => /^\d:[\d.e-]+\|[\d.e-]+\|[\d.e-]+$/.test(v))).toBe(true);
});
