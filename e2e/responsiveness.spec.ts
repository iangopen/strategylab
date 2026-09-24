import { expect, test, type Page } from "@playwright/test";
import { defaultScenario, newStrategyInstance, type ScenarioConfig } from "../src/scenario";
import { encodeScenarioLink } from "../src/share/link";
import { engineTable, openApp } from "./helpers";

// The Node benchmark scenario (perf.bench.test.ts; ~10.5 s in Node): European, $1,000, $10 base,
// $1 table min, no stops, 1,000 rounds, 100k sessions, seed 12345, six strategy instances.
const SCENARIO: ScenarioConfig = {
  ...defaultScenario(),
  stopWin: null,
  sessions: 100_000,
  strategies: [
    newStrategyInstance("flat"),
    { ...newStrategyInstance("martingale"), config: { multiplier: 2 } },
    newStrategyInstance("paroli"),
    newStrategyInstance("dalembert"),
    newStrategyInstance("fibonacci"),
    { ...newStrategyInstance("martingale"), config: { multiplier: 3 } },
  ],
};

interface LongTask {
  start: number;
  duration: number;
}

const progress = (page: Page) => page.getByRole("progressbar", { name: "Simulation progress" }).evaluate((el) => (el as HTMLProgressElement).value);

test("100k sessions × 6 strategies: the page stays responsive mid-run, Cancel works, and a fresh run completes", async ({ page }, info) => {
  test.setTimeout(420_000);
  // Record every main-thread long task (> 50 ms) from the first script onward.
  await page.addInitScript(() => {
    const w = window as unknown as { __longTasks: LongTask[] };
    w.__longTasks = [];
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: "longtask", buffered: true });
  });
  const enc = encodeScenarioLink(SCENARIO, "");
  if (!enc.ok) throw new Error(enc.message);
  await openApp(page, enc.fragment);
  await expect(page.getByRole("textbox", { name: "Sessions", exact: true })).toHaveValue("100000");
  const visibility = await page.evaluate(() => `${document.visibilityState}, focus ${document.hasFocus()}`);
  const baseBet = page.getByRole("textbox", { name: "Base bet", exact: true });
  const run = page.getByRole("button", { name: "Run", exact: true });
  const cancel = page.getByRole("button", { name: "Cancel", exact: true });

  // Run 1: type mid-run (the input must update while the worker computes), then cancel.
  await run.click();
  await expect.poll(() => progress(page), { timeout: 120_000 }).toBeGreaterThan(0.04);
  await baseBet.fill("25");
  await expect(baseBet).toHaveValue("25");
  const p1 = await progress(page);
  await expect.poll(() => progress(page), { timeout: 60_000 }).toBeGreaterThan(p1); // still advancing
  await cancel.click();
  await expect(page.getByTestId("run-status")).toHaveText("Cancelled. Previous results (if any) are kept.");
  await expect(run).toBeEnabled();

  // Run 2 (fresh worker after the cancel): restore $10, run to completion, typing mid-run again.
  await baseBet.fill("10");
  const t0 = await page.evaluate(() => performance.now());
  await run.click();
  await expect.poll(() => progress(page), { timeout: 120_000 }).toBeGreaterThan(0.1);
  await page.getByRole("textbox", { name: "Seed", exact: true }).fill("777");
  await expect(page.getByRole("textbox", { name: "Seed", exact: true })).toHaveValue("777");
  await expect(page.getByTestId("run-status")).toContainText(/^Done: 100,000 sessions in [\d.]+s\.$/, { timeout: 360_000 });
  const t1 = await page.evaluate(() => performance.now());
  const status = await page.getByTestId("run-status").textContent();
  // The results are for the scenario AT THE CLICK (seed 12345), flagged stale because the seed changed.
  await expect(page.getByText("The configuration has changed since this run.")).toBeVisible();
  const tn0 = performance.now();
  const expected = engineTable(SCENARIO);
  const nodeSeconds = (performance.now() - tn0) / 1000;
  for (const [statId, values] of Object.entries(expected)) {
    await expect(page.locator(`[data-testid="results-table"] tr[data-stat="${statId}"] td`)).toHaveText(values);
  }

  const tasks = await page.evaluate(() => (window as unknown as { __longTasks: LongTask[] }).__longTasks);
  const during = tasks.filter((t) => t.start >= t0 && t.start <= t1);
  const longest = during.reduce((m, t) => Math.max(m, t.duration), 0);
  const summary = [
    `tab: ${visibility}`,
    `run 2: ${status} (wall ${((t1 - t0) / 1000).toFixed(1)} s)`,
    `same scenario in Node (this test process): ${nodeSeconds.toFixed(1)} s`,
    `long tasks during run 2: ${during.length}, longest ${longest.toFixed(0)} ms, total ${during.reduce((s, t) => s + t.duration, 0).toFixed(0)} ms`,
    `long tasks over the whole page life: ${tasks.length}, longest ${tasks.reduce((m, t) => Math.max(m, t.duration), 0).toFixed(0)} ms`,
  ].join("\n");
  console.log(`[responsiveness]\n${summary}`);
  await info.attach("responsiveness", { body: summary, contentType: "text/plain" });
});
