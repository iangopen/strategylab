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

/** Chromium's PDF of the report, as printed: print media, US Letter, the page's own @page margins. */
async function printToPdf(page: Page): Promise<Buffer> {
  await page.emulateMedia({ media: "print" });
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
  await openReport(page);
  const report = page.getByTestId("report");

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
