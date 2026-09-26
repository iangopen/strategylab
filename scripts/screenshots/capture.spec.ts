// Generates the README screenshots and the Open Graph image from the real app (not hand-made).
// Run: npm run screenshots   (captures https://iangopen.github.io/strategylab/ unless SCREENSHOT_URL is set)
// Not part of the test suite: it lives outside e2e/ and runs only through playwright.screenshots.config.ts.
//
// Everything is the DEFAULT scenario with its fixed seed (Flat vs Martingale x2, 10,000 sessions,
// seed 12345). Before capturing, the results table must equal the engine's numbers computed in Node,
// so an image can never show numbers the engine does not produce. Output is optimized losslessly
// with oxipng (WebAssembly; no native build step).
import { readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import optimise, { init } from "@jsquash/oxipng/optimise.js";
import { replaySession } from "../../src/engine/replay";
import { defaultScenario, toSimRequest } from "../../src/scenario";
import { resolveStrategies } from "../../src/worker/resolve";
import { expectTableMatchesEngine } from "../../e2e/helpers";

const ROOT = new URL("../../", import.meta.url);

// The first Martingale bust among the 50 sample sessions, found by replaying in Node with the exact
// code the worker runs (as in e2e/replay.spec.ts), never hardcoded.
const req = toSimRequest(defaultScenario());
const specs = resolveStrategies(req.strategies);
const bustSession = (() => {
  for (let i = 0; i < 50; i++) {
    const m = replaySession(req.game, specs, req.session, req.masterSeed, i).strategies[1]!;
    if (m.endReason === "insufficientFunds" || m.endReason === "ruin") return i;
  }
  throw new Error("no Martingale bust in the first 50 sessions");
})();

let wasmReady: Promise<void> | undefined;
async function save(png: Buffer, relPath: string) {
  wasmReady ??= (async () => {
    await init(await WebAssembly.compile(readFileSync(new URL("node_modules/@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm", ROOT))));
  })();
  await wasmReady;
  const out = Buffer.from(await optimise(png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer, { level: 3 }));
  writeFileSync(new URL(relPath, ROOT), out);
  console.log(`[screenshots] ${relPath}: ${png.length.toLocaleString("en-US")} -> ${out.length.toLocaleString("en-US")} bytes`);
}

const panel = (page: Page, heading: string): Locator => page.locator("section.panel", { has: page.locator(`h2:text-is("${heading}")`) });

async function openAndRun(page: Page) {
  await page.goto("./");
  await expect(page.getByRole("heading", { name: "StrategyLab" })).toBeVisible();
  await page.getByRole("combobox", { name: "Theme" }).selectOption("light");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect(page.getByTestId("run-status")).toContainText(/^Done: /, { timeout: 240_000 });
  await expectTableMatchesEngine(page, defaultScenario());
}

test("README screenshots: results table, fan chart fit to Martingale, replay of a Martingale bust", async ({ page }) => {
  await openAndRun(page);
  // Nothing hovered, so no crosshair or readout sits on a chart.
  await page.mouse.move(0, 0);

  // (a) The results table: Flat vs Martingale.
  await save(await panel(page, "Results").screenshot(), "docs/results.png");

  // (b) The fan chart after "Fit to this strategy" on Martingale (the zoom is shared by every panel).
  const fan = panel(page, "Bankroll over time");
  await fan.locator("figure.chart-panel", { has: page.locator('[data-label="Martingale"]') }).getByRole("button", { name: "Fit to this strategy" }).click();
  await expect(page.getByTestId("fan-canvas").first()).not.toHaveAttribute("data-zoom", "full");
  await page.mouse.move(0, 0);
  await save(await fan.screenshot(), "docs/fan-fit-martingale.png");

  // (c) The replay of that bust, zoomed to the first ending (Martingale's bust).
  await page.getByRole("textbox", { name: "Session", exact: true }).fill(String(bustSession));
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  const replay = panel(page, "Replay one session");
  await expect(replay.locator(".replay-legend li")).toHaveCount(2);
  await replay.getByRole("button", { name: "Fit to first ending" }).click();
  await expect(page.getByTestId("replay-bankroll")).not.toHaveAttribute("data-zoom", "full");
  await page.mouse.move(0, 0);
  await save(await replay.screenshot(), "docs/replay-bust.png");
  console.log(`[screenshots] replayed session ${bustSession} (the first Martingale bust among the sample sessions)`);
});

test("Open Graph image: 1200 x 630, the same default run, results in view", async ({ browser }) => {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1, colorScheme: "light", baseURL: test.info().project.use.baseURL });
  await openAndRun(page);
  await page.mouse.move(0, 0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await save(await page.screenshot(), "public/og-image.png");
  await page.close();
});
