import { execSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { defaultScenario, MAX_STRATEGIES, newStrategyInstance, type ScenarioConfig } from "../src/scenario";
import { encodeScenarioLink } from "../src/share/link";
import { TABLE_ROWS } from "../src/ui/format";
import { BASE_PATH, expectTableMatchesEngine, openApp, runAndWait, watchPage } from "./helpers";

/** Pages in a PDF made by Chromium: one /Type /Page object per page (not /Pages). */
function pdfPageCount(pdf: Buffer): number {
  return (pdf.toString("latin1").match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

/** Every results-table cell's exact numbers (data-raw: String(double), a bit-exact round trip), row by row. */
async function rawTable(page: Page): Promise<Record<string, string[]>> {
  const table = page.getByTestId("results-table");
  const out: Record<string, string[]> = {};
  for (const row of TABLE_ROWS) out[row.id] = await table.locator(`tr[data-stat="${row.id}"] td`).evaluateAll((tds) => tds.map((td) => td.getAttribute("data-raw") ?? ""));
  return out;
}

async function openReport(page: Page) {
  await page.getByRole("button", { name: "Report", exact: true }).click();
  await expect(page.getByRole("heading", { name: "StrategyLab report", level: 1 })).toBeFocused();
}

/** Printable area of US Letter with 0.5in margins, in CSS px: 7.5in × 10in. */
const PRINT_WIDTH = 720;
const PRINT_HEIGHT = 960;

/**
 * Chromium's PDF of the report, as printed: print media, US Letter, the page's own @page margins.
 * First it checks the page fits at FULL size. Chromium silently shrinks a page whose content is wider
 * than the paper, which once made an overflowing report pass on one machine and fail on another.
 */
async function printToPdf(page: Page): Promise<Buffer> {
  // Lay the page out at the paper's printable width, as a browser's print does.
  await page.setViewportSize({ width: PRINT_WIDTH, height: PRINT_HEIGHT });
  await page.emulateMedia({ media: "print" });
  // Every chart panel has been sized and drawn (an unsized canvas is 300 × 150 by default).
  const canvases = page.getByTestId("report-canvas");
  for (let i = 0; i < (await canvases.count()); i++) await expect(canvases.nth(i)).toHaveAttribute("data-draws", /^[1-9]/);
  const fit = await page.getByTestId("report").evaluate((el) => ({ height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width, scrollWidth: el.scrollWidth }));
  console.log(`[report] printed size ${fit.width.toFixed(0)} × ${fit.height.toFixed(0)} px (page ${PRINT_WIDTH} × ${PRINT_HEIGHT}); content width ${fit.scrollWidth} px`);
  expect(fit.width, "the report is laid out at the printable width").toBeLessThanOrEqual(PRINT_WIDTH);
  expect(fit.scrollWidth, "nothing is wider than the page (Chromium would shrink everything to fit)").toBeLessThanOrEqual(Math.ceil(fit.width));
  expect(fit.height, "the report fits one page at full size").toBeLessThanOrEqual(PRINT_HEIGHT);
  return page.pdf({ format: "Letter", preferCSSPageSize: true, printBackground: true });
}

const EIGHT: ScenarioConfig = {
  ...defaultScenario(),
  sessions: 2000,
  strategies: ["flat", "martingale", "paroli", "dalembert", "fibonacci", "labouchere", "oscars", "kelly"].map((id) => newStrategyInstance(id)),
};

test("the report: default run, every part present, and the printed PDF is exactly one US Letter page", async ({ page }) => {
  const problems = watchPage(page);
  await openApp(page);
  await expect(page.getByRole("button", { name: "Report", exact: true })).toBeDisabled();
  await runAndWait(page);
  await expectTableMatchesEngine(page, defaultScenario());
  // Nothing is fragile on the default run: no marker, no note, no qualifier in the announcement.
  await expect(page.locator("[data-fragile]")).toHaveCount(0);
  await expect(page.getByTestId("fragile-note")).toHaveCount(0);
  await expect(page.getByTestId("run-announcer")).not.toContainText("whole-bankroll loss");
  await openReport(page);
  const report = page.getByTestId("report");
  await expect(report.locator("[data-fragile]")).toHaveCount(0);
  await expect(page.getByTestId("report-fragile-note")).toHaveCount(0);

  // Configuration, seed, build, link, key statistics, chart, takeaways.
  await expect(page.getByTestId("report-config")).toContainText("European roulette (even-money); house edge 2.703%");
  await expect(page.getByTestId("report-config")).toContainText("Martingale (Multiplier after a loss: 2)");
  await expect(page.getByTestId("report-seed")).toHaveText("12345");
  const head = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  await expect(page.getByTestId("report-commit")).toHaveText(new RegExp(`^${head}(\\+local changes)?$`));
  await expect(page.getByTestId("report-link")).toHaveText(new RegExp(`^http://localhost:\\d+${BASE_PATH}#s=[A-Za-z0-9_-]+$`));
  await expect(page.getByTestId("report-table").locator("tbody tr")).toHaveCount(10);
  await expect(page.getByTestId("report-table").locator("tbody tr").nth(3)).toContainText(/P\(bust\) \(95% interval\)\s*1\.6% \(1\.4–1\.9%\)\s*17\.1% \(16\.3–17\.8%\)/);
  await expect(page.getByTestId("report-canvas")).toHaveCount(2);
  const items = page.getByTestId("report-takeaways").locator("li");
  expect(await items.count()).toBeGreaterThanOrEqual(3);
  expect(await items.count()).toBeLessThanOrEqual(5);
  await expect(items.filter({ hasText: /round \d/ })).toContainText([/^Counting busted sessions only, /]);
  // The contrast survives the worst-case-session check on 10,000 sessions (one bankroll loss is small there).
  await expect(items.last()).toContainText(/^Martingale ended ahead in .* of sessions yet lost money per dollar wagered on average/);
  // Strategies are compared on their per-session differences (same sessions), with the method, size, interval and n.
  await expect(items.nth(1)).toContainText("over the same 10,000 sessions (paired t-interval), Martingale's EV per $ minus Flat's is -0.15 percentage points (95% interval -0.99 to 0.69), which includes zero");
  await expect(items.nth(2)).toContainText("over the same 10,000 sessions (paired-proportion interval), Martingale's bust rate minus Flat's is 15.5 percentage points (95% interval 14.7 to 16.2), which excludes zero");
  // The report is drawn light whatever the theme, so the screen matches the paper.
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");

  const pdf = await printToPdf(page);
  await test.info().attach("report.pdf", { body: pdf, contentType: "application/pdf" });
  expect(pdfPageCount(pdf), "the default report must print on one page").toBe(1);
  // The print button and the way back are not printed.
  await expect(page.getByRole("button", { name: "Print / save as PDF" })).toBeHidden();
  await page.emulateMedia({ media: "screen" });

  await page.getByRole("button", { name: "Back to the lab" }).click();
  await expect(page.getByRole("button", { name: "Report", exact: true })).toBeFocused();
  await expect(report).toHaveCount(0);
  expect(problems).toEqual([]);
});

test("the report with all eight strategies still prints on one page", async ({ page }) => {
  const e = encodeScenarioLink(EIGHT, "");
  if (!e.ok) throw new Error(e.message);
  await openApp(page, e.fragment);
  await runAndWait(page);
  await openReport(page);
  await expect(page.getByTestId("report-canvas")).toHaveCount(MAX_STRATEGIES);
  const pdf = await printToPdf(page);
  await test.info().attach("report-8.pdf", { body: pdf, contentType: "application/pdf" });
  expect(pdfPageCount(pdf), "an 8-strategy report must print on one page").toBe(1);
});
test("the report with three and with four strategies prints on one page (dense type from three up)", async ({ page }) => {
  for (const ids of [["flat", "martingale", "paroli"], ["flat", "martingale", "paroli", "dalembert"]]) {
    const e = encodeScenarioLink({ ...defaultScenario(), strategies: ids.map((id) => newStrategyInstance(id)) }, "");
    if (!e.ok) throw new Error(e.message);
    await page.emulateMedia({ media: "screen" });
    await page.goto("about:blank"); // a hash-only change would not reload the app
    await openApp(page, e.fragment);
    await runAndWait(page);
    await openReport(page);
    await expect(page.getByTestId("report-canvas")).toHaveCount(ids.length);
    await expect(page.getByTestId("report-takeaways").locator("li").nth(1)).toContainText(`widened to keep 95% across all ${(ids.length * (ids.length - 1)) / 2} pairs`);
    const pdf = await printToPdf(page);
    expect(pdfPageCount(pdf), `a ${ids.length}-strategy report must print on one page`).toBe(1);
  }
});

test("the report with five and with six strategies prints on one page", async ({ page }) => {
  const all = ["flat", "martingale", "paroli", "dalembert", "fibonacci", "labouchere"];
  for (const k of [5, 6]) {
    const e = encodeScenarioLink({ ...defaultScenario(), strategies: all.slice(0, k).map((id) => newStrategyInstance(id)) }, "");
    if (!e.ok) throw new Error(e.message);
    await page.emulateMedia({ media: "screen" });
    await page.goto("about:blank"); // a hash-only change would not reload the app
    await openApp(page, e.fragment);
    await runAndWait(page);
    await openReport(page);
    await expect(page.getByTestId("report-canvas")).toHaveCount(k);
    const pdf = await printToPdf(page);
    expect(pdfPageCount(pdf), `a ${k}-strategy report must print on one page`).toBe(1);
  }
});

test("the report with seven strategies prints on one page", async ({ page }) => {
  const ids = ["flat", "martingale", "paroli", "dalembert", "fibonacci", "labouchere", "oscars"];
  const e = encodeScenarioLink({ ...defaultScenario(), strategies: ids.map((id) => newStrategyInstance(id)) }, "");
  if (!e.ok) throw new Error(e.message);
  await openApp(page, e.fragment);
  await runAndWait(page);
  await openReport(page);
  await expect(page.getByTestId("report-canvas")).toHaveCount(7);
  await expect(page.getByTestId("report-takeaways").locator("li").nth(1)).toContainText("widened to keep 95% across all 21 pairs");
  const pdf = await printToPdf(page);
  expect(pdfPageCount(pdf), "a 7-strategy report must print on one page").toBe(1);
});

test("rare busts, few sessions: an EV gap that one whole-bankroll loss would undo is not named, and the page still fits", async ({ page }) => {
  // $1 bets for 10 rounds on a $1,000 bankroll: Martingale almost never busts in 250 sessions, so it
  // looks better than Flat with a tight interval. The true EV per $ is the same for both.
  const scenario: ScenarioConfig = { ...defaultScenario(), baseBet: 1, stopWin: null, maxRounds: 10, sessions: 250, seed: 16 };
  const e = encodeScenarioLink(scenario, "");
  if (!e.ok) throw new Error(e.message);
  await openApp(page, e.fragment);
  await runAndWait(page);

  // The results table, the announcement and the report all mark Martingale (column 1), and only it.
  const table = page.getByTestId("results-table");
  const evRow = table.locator('tr[data-stat="evPerWagered"]');
  const martingaleCell = evRow.locator('td[data-col="1"]');
  await expect(martingaleCell).toHaveAttribute("data-fragile", "true");
  await expect(martingaleCell).toHaveText("6.24%* (fragile: see the note under the table)"); // the number is unchanged
  await expect(martingaleCell).toHaveAttribute("aria-describedby", "fragile-note");
  await expect(martingaleCell.locator(".fragile-mark")).toHaveAttribute("title", "Above the theoretical value, but one more whole-bankroll loss would undo that: this is not evidence of a gain. The figures are the run's own.");
  await expect(evRow.locator('td[data-col="0"]')).not.toHaveAttribute("data-fragile", /.*/);
  await expect(evRow.locator('td[data-col="0"]')).toHaveText("-1.68%");
  await expect(table.locator("td[data-fragile]")).toHaveCount(1);
  await expect(page.getByTestId("fragile-note")).toHaveText(
    "* EV per $ wagered for Martingale: above the theoretical value, but one more whole-bankroll loss would undo that: this is not evidence of a gain. The figures are the run's own.",
  );
  await expect(page.getByTestId("run-announcer")).toContainText(
    "EV per $ wagered: Flat -1.68%, Martingale 6.24% (above the theoretical value, but one more whole-bankroll loss would undo that: this is not evidence of a gain); theory -2.70%.",
  );

  await openReport(page);
  const reportEv = page.getByTestId("report-table").locator("tbody tr").first().locator("td");
  await expect(reportEv.nth(1)).toHaveAttribute("data-fragile", "true");
  await expect(reportEv.nth(1).locator(".fragile-mark")).toHaveText("*");
  await expect(reportEv.nth(0)).not.toHaveAttribute("data-fragile", /.*/);
  await expect(reportEv.nth(0).locator(".fragile-mark")).toHaveCount(0);
  await expect(page.getByTestId("report-table").locator("td[data-fragile]")).toHaveCount(1);
  await expect(page.getByTestId("report-fragile-note")).toContainText("Above the theoretical value, but one more whole-bankroll loss would undo that: this is not evidence of a gain.");
  const ev = page.getByTestId("report-takeaways").locator("li").nth(1);
  await expect(ev).toContainText("over the same 250 sessions (paired t-interval), Flat's EV per $ minus Martingale's is -7.92 percentage points (95% interval -12.16 to -3.67), which excludes zero, but one more whole-bankroll loss would undo that: the difference isn't clear at this sample size.");
  await expect(ev).not.toContainText("measured a lower EV");
  // Martingale's interval lies above zero here; the sentence must not leave that reading as a gain.
  await expect(ev).toContainText("Flat -1.68% (-5.53% to 2.17%) and Martingale 6.24% (1.56–10.91%); for Martingale the interval is above the theoretical -2.70%, but one more whole-bankroll loss would undo that: this is not evidence of a gain; for Flat the result is not clearly different from zero at this sample size");
  await expect(ev).not.toContainText("by chance about one time in twenty");
  const pdf = await printToPdf(page);
  expect(pdfPageCount(pdf), "the report must print on one page").toBe(1);
});

test("reproducible: the report's link, opened in a new page and run, gives bit-identical statistics", async ({ page, context }) => {
  await openApp(page);
  await runAndWait(page);
  const original = await rawTable(page);
  await openReport(page);
  const link = (await page.getByTestId("report-link").textContent())!.trim();

  const fresh = await context.newPage();
  await fresh.goto(link);
  await expect(fresh.getByRole("status", { name: "Opened link" })).toContainText("Loaded the scenario from the link.");
  await runAndWait(fresh);
  const rerun = await rawTable(fresh);
  expect(rerun).toEqual(original);
  // Not a vacuous comparison: real numbers, every row, both strategies.
  expect(Object.keys(rerun)).toHaveLength(TABLE_ROWS.length);
  expect(rerun.evPerWagered).toHaveLength(2);
  expect(rerun.evPerWagered!.every((v) => Number.isFinite(Number(v)))).toBe(true);
  expect(rerun.pBust![1]!.split("|")).toHaveLength(3);
});
