// Shared E2E helpers. Expected numbers are NEVER hardcoded: the same scenario runs through the
// engine in Node (the exact code the worker runs) and the UI must display exactly those values.
// Specs assert state (text, data-* attributes on canvases), never pixels, and use web-first
// assertions only (no fixed sleeps).
import { expect, type Locator, type Page } from "@playwright/test";
import { runMonteCarlo } from "../src/engine/montecarlo";
import { STATS } from "../src/engine/stats/registry";
import { toSimRequest, type ScenarioConfig } from "../src/scenario";
import { formatStat } from "../src/ui/format";
import { resolveStrategies } from "../src/worker/resolve";

export const BASE_PATH = "/strategylab/";

/** Every console error, page error, failed request, and request that escapes the base path. */
export function watchPage(page: Page) {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("requestfailed", (r) => problems.push(`requestfailed: ${r.url()}`));
  page.on("response", (r) => {
    const url = new URL(r.url());
    if (url.hostname !== "localhost") return;
    if (r.status() >= 400) problems.push(`HTTP ${r.status()}: ${url.pathname}`);
    if (!url.pathname.startsWith(BASE_PATH)) problems.push(`outside base path: ${url.pathname}`);
    if (url.pathname.includes("/src/")) problems.push(`dev source requested: ${url.pathname}`);
  });
  return problems;
}

export async function openApp(page: Page, hash = "") {
  await page.goto(hash === "" ? "./" : `./${hash}`);
  await expect(page.getByRole("heading", { name: "StrategyLab" })).toBeVisible();
}

/** Click Run and wait for the completion status (web-first). */
export async function runAndWait(page: Page, timeout = 120_000) {
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByTestId("run-status")).toContainText(/^Done: /, { timeout });
}

/** Stat values as the results table would print them, computed by the engine in Node. */
export function engineTable(s: ScenarioConfig): Record<string, string[]> {
  const req = toSimRequest(s);
  const r = runMonteCarlo(req.game, resolveStrategies(req.strategies), req.session, req.nSessions, req.masterSeed);
  return Object.fromEntries(STATS.map((stat) => [stat.id, r.perStrategy.map((o) => formatStat(stat.format, o.stats[stat.id]))]));
}

/** The UI's results table must show exactly the engine's values, every registered stat, every column. */
export async function expectTableMatchesEngine(page: Page, s: ScenarioConfig) {
  const expected = engineTable(s);
  const table = page.getByTestId("results-table");
  for (const [statId, values] of Object.entries(expected)) {
    const row = table.locator(`tr[data-stat="${statId}"]`);
    await expect(row.locator("td")).toHaveText(values);
  }
}

/** A canvas has drawn something: at least `min` non-transparent pixels. Not a pixel comparison. */
export async function expectCanvasNotBlank(canvas: Locator, min = 200) {
  await expect
    .poll(
      () =>
        canvas.evaluate((el) => {
          const c = el as HTMLCanvasElement;
          const ctx = c.getContext("2d");
          if (!ctx || c.width === 0 || c.height === 0) return 0;
          const data = ctx.getImageData(0, 0, c.width, c.height).data;
          let n = 0;
          for (let i = 3; i < data.length; i += 4) if (data[i]! > 0) n++;
          return n;
        }),
      { message: "canvas has drawn pixels" },
    )
    .toBeGreaterThan(min);
}

/** A data-* attribute as a number, once the chart has written it (web-first: waits for the draw). */
export async function dataNum(loc: Locator, attr: string): Promise<number> {
  await expect(loc).toHaveAttribute(`data-${attr}`, /^-?[\d.e+-]+$/);
  return Number(await loc.getAttribute(`data-${attr}`));
}

/** The strategy card whose header reads `label` exactly. */
export function card(page: Page, label: string): Locator {
  return page.locator(".strategy-card").filter({ has: page.locator(".strategy-head strong", { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`) }) });
}

/** Adds a strategy (or a custom rule example) through the picker. */
export async function addStrategy(page: Page, optionLabel: string) {
  await page.getByLabel("Strategy to add").selectOption({ label: optionLabel });
  await page.getByRole("button", { name: "Add", exact: true }).click();
}
