import { expect, test, type Locator, type Page } from "@playwright/test";
import { replaySession } from "../src/engine/replay";
import { defaultScenario, toSimRequest } from "../src/scenario";
import { MARGIN } from "../src/ui/charts/canvas";
import { resolveStrategies } from "../src/worker/resolve";
import { dataNum, expectCanvasNotBlank, openApp, runAndWait } from "./helpers";

// The default scenario (Flat + Martingale x2). Its first Martingale bust among the 50 sample
// sessions is found by replaying in Node with the exact code the worker runs.
const req = toSimRequest(defaultScenario());
const specs = resolveStrategies(req.strategies);
const bust = (() => {
  for (let i = 0; i < 50; i++) {
    const r = replaySession(req.game, specs, req.session, req.masterSeed, i);
    const m = r.strategies[1]!;
    if (m.endReason === "insufficientFunds" || m.endReason === "ruin") return { session: i, replay: r };
  }
  throw new Error("no Martingale bust in the first 50 sessions");
})();

async function replay(page: Page, session: number) {
  await page.getByRole("textbox", { name: "Session", exact: true }).fill(String(session));
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect(page.locator(".replay-stack + p.help, .replay-stack ~ p.help").first()).toContainText(`Session ${session.toLocaleString("en-US")}`);
}

async function drag(page: Page, canvas: Locator, fromFrac: number, toFrac: number) {
  await canvas.scrollIntoViewIfNeeded();
  const b = (await canvas.boundingBox())!;
  const y = b.y + b.height / 2;
  await page.mouse.move(b.x + b.width * fromFrac, y);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * ((fromFrac + toFrac) / 2), y);
  await page.mouse.move(b.x + b.width * toFrac, y);
  await page.mouse.up();
}

test.beforeEach(async ({ page }) => {
  await openApp(page);
  await runAndWait(page);
});

test("replay session 0: both strategies in the legend, three stacked canvases drawn on one shared x range", async ({ page }) => {
  await replay(page, 0);
  const r0 = replaySession(req.game, specs, req.session, req.masterSeed, 0);
  await expect(page.locator(".replay-legend li")).toHaveCount(2);
  const bank = page.getByTestId("replay-bankroll");
  await expect(bank).toHaveAttribute("data-lines", "2");
  await expect(bank).toHaveAttribute("data-x-max", String(Math.max(...r0.strategies.map((s) => s.rounds))));
  await expect(bank).toHaveAttribute("data-zoom", "full");
  for (const id of ["replay-bankroll", "replay-bets", "replay-strip"]) await expectCanvasNotBlank(page.getByTestId(id));
  // Each legend line states how that strategy's session ended, from the engine's replay.
  for (const [k, s] of r0.strategies.entries()) await expect(page.locator(".replay-legend li").nth(k)).toContainText(`after ${s.rounds.toLocaleString("en-US")} round`);
});

test("session 5: 'fit to first ending' on a Martingale bust zooms to the earliest ending; double-click and Reset restore the full range", async ({ page }) => {
  await replay(page, bust.session);
  const bank = page.getByTestId("replay-bankroll");
  const first = Math.max(1, Math.min(...bust.replay.strategies.map((s) => s.rounds)));
  await expect(bank).toHaveAttribute("data-first-ending", String(first));
  await page.getByRole("button", { name: "Fit to first ending" }).click();
  await expect(bank).toHaveAttribute("data-zoom", `0-${first}`);
  await expect(bank).toHaveAttribute("data-x-max", String(first));
  await expect(page.getByText(`Showing rounds 0–${first.toLocaleString("en-US")}.`)).toBeVisible();
  await page.getByRole("button", { name: "Reset zoom" }).click();
  await expect(bank).toHaveAttribute("data-zoom", "full");
  await expect(page.getByRole("button", { name: "Reset zoom" })).toBeDisabled();
});

test("session 5: drag-to-zoom narrows the x window; double-click resets it", async ({ page }) => {
  await replay(page, 0);
  const bank = page.getByTestId("replay-bankroll");
  const full = await dataNum(bank, "x-max");
  await drag(page, bank, 0.3, 0.7);
  await expect(bank).not.toHaveAttribute("data-zoom", "full");
  const [lo, hi] = (await bank.getAttribute("data-zoom"))!.split("-").map(Number) as [number, number];
  expect(lo).toBeGreaterThan(0);
  expect(hi).toBeLessThan(full);
  expect(hi - lo).toBeGreaterThanOrEqual(2);
  await bank.dblclick();
  await expect(bank).toHaveAttribute("data-zoom", "full");
});

test("session 5: replay hover shows the crosshair round and each strategy's bankroll and bet", async ({ page }) => {
  await replay(page, 0);
  const bank = page.getByTestId("replay-bankroll");
  const b = (await bank.boundingBox())!;
  await bank.hover({ position: { x: b.width * 0.5, y: b.height * 0.5 } });
  await expect(bank).toHaveAttribute("data-hover-round", /^\d+$/);
  const readout = page.locator(".replay-stack .chart-readout");
  await expect(readout).toContainText(/^Round [\d,]+:/);
  await expect(readout).toContainText("Flat $");
  await expect(readout).toContainText("Martingale $");
  await page.getByRole("heading", { name: "Replay one session" }).hover();
  await expect(bank).not.toHaveAttribute("data-hover-round", /.*/);
});

test("clicking a sample path on the fan chart selects that session and replays it", async ({ page }) => {
  const fan = page.getByTestId("fan-canvas").first();
  await fan.scrollIntoViewIfNeeded();
  const b = (await fan.boundingBox())!;
  // The start point (round 0, the starting bankroll) is shared by all 50 paths: clicking there
  // always hits a path. Map it to pixels from the chart's own exposed ranges.
  const xMin = await dataNum(fan, "x-min");
  const xMax = await dataNum(fan, "x-max");
  const yMax = await dataNum(fan, "y-max");
  const px = MARGIN.left + ((0 - xMin) / (xMax - xMin)) * (b.width - MARGIN.left - MARGIN.right);
  const py = MARGIN.top + (b.height - MARGIN.top - MARGIN.bottom) * (1 - req.session.startBankroll / yMax);
  await fan.click({ position: { x: px + 2, y: py } });
  await expect(fan).toHaveAttribute("data-selected", /^\d+$/);
  const selected = await dataNum(fan, "selected");
  await expect(page.locator(".replay-stack ~ p.help").first()).toContainText(`Session ${selected}`);
});
