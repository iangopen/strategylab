import { expect, test } from "@playwright/test";
import { STRATEGIES } from "../src/engine/strategies/registry";
import { defaultScenario, newStrategyInstance } from "../src/scenario";
import { addStrategy, BASE_PATH, card, dataNum, expectCanvasNotBlank, expectTableMatchesEngine, openApp, runAndWait, watchPage } from "./helpers";

test("loads under /strategylab/ from built assets: favicon, script and worker all under the base, no console errors", async ({ page }) => {
  const problems = watchPage(page);
  await openApp(page);
  // Headless Chromium doesn't fetch favicons itself: resolve the page's own <link> and fetch it.
  const iconHref = await page.locator("link[rel=icon]").evaluate((l) => (l as HTMLLinkElement).href);
  expect(new URL(iconHref).pathname).toBe(`${BASE_PATH}favicon.svg`);
  expect((await page.request.get(iconHref)).status()).toBe(200);
  const scripts = await page.locator("script[type=module]").evaluateAll((els) => els.map((e) => (e as HTMLScriptElement).src));
  expect(scripts.length).toBeGreaterThan(0);
  for (const src of scripts) expect(new URL(src).pathname).toMatch(new RegExp(`^${BASE_PATH}assets/`));
  // The worker is spawned on load; its script must come from the base path too.
  await expect.poll(() => page.evaluate(() => performance.getEntriesByType("resource").map((e) => new URL(e.name).pathname).filter((p) => p.includes("sim.worker")))).toEqual([
    expect.stringMatching(new RegExp(`^${BASE_PATH}assets/sim\\.worker-.*\\.js$`)),
  ]);
  expect(problems).toEqual([]);
});

test("session 5: all eight strategies are in the picker, and each renders its own config form (no UI edits per strategy)", async ({ page }) => {
  await openApp(page);
  const picker = page.getByLabel("Strategy to add");
  await expect(picker.locator("optgroup[label='Built-in strategies'] option")).toHaveText(STRATEGIES.map((s) => s.label));
  // Remove the two defaults, then add every strategy once.
  await page.getByRole("button", { name: "Remove" }).first().click();
  await page.getByRole("button", { name: "Remove" }).first().click();
  for (const s of STRATEGIES) await addStrategy(page, s.label);
  for (const s of STRATEGIES) {
    const c = card(page, s.label);
    await expect(c).toBeVisible();
    await expect(c.locator(".help").first()).toHaveText(s.description);
    // One control per configSchema field, labeled exactly as the schema says.
    // By role + accessible name (a <select> nested in its <label> would otherwise match the options' text too).
    for (const f of s.configSchema) {
      const role = f.kind === "select" ? "combobox" : f.kind === "boolean" ? "checkbox" : "textbox";
      await expect(c.getByRole(role, { name: f.label, exact: true }), `${s.id}: ${f.label}`).toBeVisible();
    }
    await expect(c.locator(".schema-form .field")).toHaveCount(s.configSchema.length);
  }
  // Kelly's form: the assumed probability is blank by default, with its help text; the fraction is 1.
  const kelly = card(page, "Kelly");
  await expect(kelly.getByLabel("Assumed win probability", { exact: true })).toHaveValue("");
  await expect(kelly.getByLabel("Assumed win probability", { exact: true })).toHaveAttribute("placeholder", "blank");
  await expect(kelly).toContainText("Blank = use the game's true probability");
  await expect(kelly).toContainText("MISJUDGED edge");
  await expect(kelly.getByLabel("Kelly fraction", { exact: true })).toHaveValue("1");
});

test("the default run shows exactly the engine's numbers; Kelly at its default shows '—' for EV per $ (it refuses to bet)", async ({ page }) => {
  await openApp(page);
  await addStrategy(page, "Kelly");
  await runAndWait(page);
  const s = { ...defaultScenario(), strategies: [newStrategyInstance("flat"), { ...newStrategyInstance("martingale"), config: { multiplier: 2 } }, newStrategyInstance("kelly")] };
  await expectTableMatchesEngine(page, s);
  await expect(page.locator('tr[data-stat="evPerWagered"] td[data-col="2"]')).toHaveText("—");
});

test("charts: every fan panel and every histogram panel shares ONE x and ONE y range; canvases are drawn; reference labels never overlap", async ({ page }) => {
  await openApp(page);
  await addStrategy(page, "Paroli");
  await runAndWait(page);
  const fans = page.getByTestId("fan-canvas");
  await expect(fans).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(fans.nth(i)).toHaveAttribute("data-draws", /^\d+$/); // every panel has drawn
  const ranges = await fans.evaluateAll((els) => els.map((e) => [e.dataset.xMin, e.dataset.xMax, e.dataset.yMin, e.dataset.yMax].join(",")));
  expect(new Set(ranges).size).toBe(1);
  expect(ranges[0]!.split(",")[2]).toBe("0"); // bankroll y axes start at 0
  for (let i = 0; i < 3; i++) {
    await expectCanvasNotBlank(fans.nth(i));
    expect(await dataNum(fans.nth(i), "paths")).toBe(50);
    // Start label on the left, win target on the right: their boxes must not intersect.
    const boxes = JSON.parse((await fans.nth(i).getAttribute("data-ref-labels"))!) as { label: string; x0: number; x1: number; y0: number; y1: number }[];
    expect(boxes.map((b) => b.label)).toEqual(["Start", "Win target"]);
    const [a, b] = boxes as [(typeof boxes)[0], (typeof boxes)[0]];
    const overlap = a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
    expect(overlap, JSON.stringify(boxes)).toBe(false);
  }
  const hists = page.getByTestId("hist-canvas");
  await expect(hists).toHaveCount(3);
  for (let i = 0; i < 3; i++) await expect(hists.nth(i)).toHaveAttribute("data-draws", /^\d+$/);
  const hr = await hists.evaluateAll((els) => els.map((e) => [e.dataset.xMin, e.dataset.xMax, e.dataset.yMin, e.dataset.yMax, e.dataset.bins].join(",")));
  expect(new Set(hr).size).toBe(1);
  for (let i = 0; i < 3; i++) await expectCanvasNotBlank(hists.nth(i));
  // Log toggle: still one shared range, now logarithmic.
  await page.getByRole("combobox", { name: "y axis", exact: true }).selectOption("log");
  for (let i = 0; i < 3; i++) await expect(hists.nth(i)).toHaveAttribute("data-mode", "log");
  const hl = await hists.evaluateAll((els) => els.map((e) => [e.dataset.mode, e.dataset.yMin, e.dataset.yMax].join(",")));
  expect(new Set(hl).size).toBe(1);
});

test("fan hover: the crosshair round and the readout follow the mouse; leaving clears them", async ({ page }) => {
  await openApp(page);
  await runAndWait(page);
  const fan = page.getByTestId("fan-canvas").first();
  const box = (await fan.boundingBox())!;
  // locator.hover scrolls the canvas into view first (raw mouse coordinates could miss it).
  await fan.hover({ position: { x: box.width * 0.5, y: box.height * 0.5 } });
  await expect(fan).toHaveAttribute("data-hover-round", /^\d+$/);
  const first = await dataNum(fan, "hover-round");
  const readout = page.locator(".chart-readout").first();
  await expect(readout).toContainText(/^Round [\d,k.]+: p5 \$/);
  await fan.hover({ position: { x: box.width * 0.9, y: box.height * 0.5 } });
  await expect.poll(() => dataNum(fan, "hover-round")).toBeGreaterThan(first); // further right = a later round
  await page.getByRole("heading", { name: "Betting Lab" }).hover();
  await expect(fan).not.toHaveAttribute("data-hover-round", /.*/);
  await expect(readout).toHaveText("Hover for percentile and sample-path values.");
});
