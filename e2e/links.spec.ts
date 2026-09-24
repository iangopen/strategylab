import { expect, test, type Page } from "@playwright/test";
import { RULE_LIMITS } from "../src/engine/rules/limits";
import type { Entry, ProgressionRule } from "../src/engine/rules/types";
import { defaultScenario, MAX_STRATEGIES, newCustomInstance, newStrategyInstance, type ScenarioConfig } from "../src/scenario";
import { decodeScenarioLink, encodeScenarioLink } from "../src/share/link";
import { addStrategy, BASE_PATH, expectTableMatchesEngine, openApp, runAndWait, watchPage } from "./helpers";

const RULE: ProgressionRule = {
  kind: "progression",
  name: "Double after 2 losses",
  startUnits: 1,
  onWin: [{ then: { type: "reset" } }],
  onLoss: [{ when: { type: "lossStreak", atLeast: 2 }, then: { type: "multiply", by: 2 } }, { then: { type: "add", units: 0 } }],
};
const SCENARIO: ScenarioConfig = { ...defaultScenario(), baseBet: 5, strategies: [newStrategyInstance("martingale"), newCustomInstance(RULE)] };

/** A #s= fragment made by the app's own encoder in Node. */
function fragmentFor(s: ScenarioConfig): string {
  const e = encodeScenarioLink(s, "");
  if (!e.ok) throw new Error(e.message);
  return e.fragment;
}

async function ruleJsonIn(page: Page, index: number): Promise<unknown> {
  const c = page.locator(".strategy-card").nth(index);
  await c.getByRole("tab", { name: "JSON" }).click();
  return JSON.parse(await c.getByRole("textbox", { name: "Rule JSON" }).inputValue()) as unknown;
}

test("SUB-PATH: open a #s= link at /strategylab/, run, Copy link; the copied URL contains /strategylab/#s= and loads the same scenario in a new page", async ({ page, context }) => {
  const problems = watchPage(page);
  await openApp(page, fragmentFor(SCENARIO));
  expect(new URL(page.url()).pathname).toBe(BASE_PATH);
  await expect(page.getByRole("status")).toContainText("Loaded the scenario from the link.");
  // Opening a link never runs anything.
  await expect(page.getByText("Run a simulation to see results.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Base bet", exact: true })).toHaveValue("5");
  expect(await ruleJsonIn(page, 1)).toEqual(RULE);
  await runAndWait(page);
  await expectTableMatchesEngine(page, SCENARIO);

  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.locator(".run-controls")).toContainText(/Link copied \([\d,]+ characters\)/);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain(`${BASE_PATH}#s=`);
  expect(copied.startsWith(`${new URL(page.url()).origin}${BASE_PATH}#s=`)).toBe(true);
  expect(page.url()).toBe(copied); // the address bar holds the same link (replaceState)

  const other = await context.newPage();
  const otherProblems = watchPage(other);
  await other.goto(copied);
  await expect(other.getByRole("status")).toContainText("Loaded the scenario from the link.");
  await expect(other.getByRole("textbox", { name: "Base bet", exact: true })).toHaveValue("5");
  expect(await ruleJsonIn(other, 1)).toEqual(RULE);
  const decoded = decodeScenarioLink(new URL(copied).hash);
  if (decoded.kind !== "loaded") throw new Error("copied link did not decode");
  await runAndWait(other);
  await expectTableMatchesEngine(other, decoded.scenario);
  expect(problems).toEqual([]);
  expect(otherProblems).toEqual([]);
});

test("session 7 (2): after Copy link, a reload restores the scenario, custom rule included (the lost-on-reload fix)", async ({ page }) => {
  await openApp(page);
  await addStrategy(page, "Blank rule (same bet every round)");
  await page.locator(".strategy-card").nth(2).getByRole("textbox", { name: "Name", exact: true }).fill("Kept across reloads");
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page).toHaveURL(new RegExp(`${BASE_PATH}#s=`));
  await page.reload();
  await expect(page.locator(".strategy-card").nth(2).locator(".strategy-head strong")).toHaveText("Kept across reloads");
});

test("session 7 (3): a garbage or cut-off fragment shows a clean error, keeps the settings, and is removed from the address bar", async ({ page }) => {
  await openApp(page);
  await page.getByRole("textbox", { name: "Base bet", exact: true }).fill("7");
  for (const bad of ["#s=hello!", fragmentFor(SCENARIO).slice(0, 40)]) {
    await page.evaluate((h) => (window.location.hash = h), bad);
    await expect(page.getByRole("alert").filter({ hasText: "Couldn’t load a scenario from this link." })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Base bet", exact: true })).toHaveValue("7");
    await expect(page).toHaveURL(new RegExp(`${BASE_PATH}$`));
    await page.getByRole("button", { name: "Dismiss" }).click();
  }
});

test("session 7 (4): a scenario too large for a link shows the error and copies nothing", async ({ page }) => {
  // The adversarial maximum rule from size.test.ts: 40 × "€" name, 10 + 10 entries, 17-digit numbers.
  const n = (x: number) => x + 0.123456789012345;
  const entries = (seed: number): Entry[] => [
    ...Array.from({ length: RULE_LIMITS.maxEntries - 1 }, (_, i): Entry => ({
      when: i % 2 === 0 ? { type: "bankroll", op: ">=", pct: n(100 + seed + i) } : { type: "betUnits", atLeast: n(10 + i) },
      then: { type: "set", units: n(100_000 + i) },
    })),
    { then: { type: "multiply", by: n(1) } },
  ];
  const big: ProgressionRule = { kind: "progression", name: "€".repeat(40), startUnits: n(12), onWin: entries(1), onLoss: entries(2) };
  await openApp(page);
  await page.evaluate(() => navigator.clipboard.writeText("untouched"));
  for (let i = 0; i < 6; i++) {
    await addStrategy(page, "Blank rule (same bet every round)");
    const c = page.locator(".strategy-card").nth(2 + i);
    await c.getByRole("tab", { name: "JSON" }).click();
    await c.getByRole("textbox", { name: "Rule JSON" }).fill(JSON.stringify(big));
    await expect(c.locator(".rule-errors")).toHaveCount(0);
  }
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.locator(".run-controls [role=alert]")).toContainText(/over the 8,000-character limit .* Nothing was copied\./);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("untouched");
  await expect(page).toHaveURL(new RegExp(`${BASE_PATH}$`));
});

test("session 7 (5): Copy link is disabled with its reason while a setting is invalid; Add is disabled at 8 strategies", async ({ page }) => {
  await openApp(page);
  // An invalid COMMITTED value (0 < $0.01). Clearing the field would not do it: NumberField never
  // commits unparseable text (session 1 decision), so the scenario would keep its last valid value.
  await page.getByRole("textbox", { name: "Starting bankroll", exact: true }).fill("0");
  await expect(page.getByText("Must be at least $0.01.")).toBeVisible();
  const copy = page.getByRole("button", { name: "Copy link" });
  await expect(copy).toBeDisabled();
  await expect(page.locator(".copy-link")).toHaveAttribute("title", "Fix the highlighted settings before copying a link.");
  await expect(page.locator("#copy-link-why")).toHaveText("Copy link: Fix the highlighted settings before copying a link.");
  await page.getByRole("textbox", { name: "Starting bankroll", exact: true }).fill("1000");
  await expect(copy).toBeEnabled();
  for (let i = 2; i < MAX_STRATEGIES; i++) await addStrategy(page, "Flat");
  await expect(page.locator(".strategy-card")).toHaveCount(MAX_STRATEGIES);
  await expect(page.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
  await expect(page.getByText(`At most ${MAX_STRATEGIES} strategies (one per chart color). Remove one to add another.`)).toBeVisible();
});

test("session 7 (6): the ready-made links — v1 with Kelly 0, a partially valid link, and a newer-version link", async ({ page }) => {
  const v1 = "#s=eyJ2IjoxLCJnIjoiZXVyb3BlYW4iLCJiIjoxMDAwLCJiYiI6MTAsInRuIjoxLCJzdyI6MTEwMCwiciI6MTAwMCwibiI6MTAwMDAsInNkIjoxMjM0NSwic3QiOltbImZsYXQiXSxbImtlbGx5Iix7ImFzc3VtZWRXaW5Qcm9iIjowLCJmcmFjdGlvbiI6MC41fV1dfQ";
  await openApp(page, v1);
  await expect(page.getByRole("status")).toContainText("It was made with an older version (1) and was upgraded.");
  await expect(page.getByRole("textbox", { name: "Assumed win probability", exact: true })).toHaveValue("");
  await expect(page.getByRole("textbox", { name: "Kelly fraction", exact: true })).toHaveValue("0.5");

  const partial = "#s=eyJ2IjoyLCJnIjoiZXVyb3BlYW4iLCJiIjoxMDAwLCJiYiI6MTAsInRuIjoxLCJzdyI6OTAwLCJyIjoxMDAwLCJuIjoxMDAwMCwic2QiOjEyMzQ1LCJzdCI6W1siZmxhdCJdLFsiZG91YmxlVXBTeXN0ZW0iXSxbImtlbGx5Iix7ImFzc3VtZWRXaW5Qcm9iIjo1fV1dfQ";
  await openApp(page, partial);
  const status = page.getByRole("status");
  await expect(status).toContainText("Loaded the scenario from the link, except 3 items:");
  await expect(status.locator("li")).toHaveText([
    'Strategy 2: unknown strategy "doubleUpSystem"; left out',
    "Win target: Must be above the starting bankroll (or blank for off). The link had 900; using off.",
    "Strategy 2 (Kelly): Assumed win probability: Must be at most 0.99 (or blank). The link had 5; using the default.",
  ]);

  await openApp(page, "#s=eyJ2Ijo5OTk5OTksInN0IjpbXX0");
  await expect(page.getByRole("alert")).toContainText("This link needs a newer version of the app (it is scenario version 999999; this app reads up to version 3).");
});

test("session 7 (7): Back to an already-loaded link does not load it a second time", async ({ page }) => {
  await openApp(page, fragmentFor(SCENARIO));
  await expect(page.getByRole("textbox", { name: "Base bet", exact: true })).toHaveValue("5");
  await page.getByRole("textbox", { name: "Base bet", exact: true }).fill("9"); // an edit after loading
  await page.evaluate(() => (window.location.hash = "#s=hello!")); // a new history entry
  await expect(page.getByRole("alert")).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/#s=/);
  // The link at this history entry was already applied: the edit must survive.
  await expect(page.getByRole("textbox", { name: "Base bet", exact: true })).toHaveValue("9");
  await expect(page.getByRole("status")).toHaveCount(0);
});
