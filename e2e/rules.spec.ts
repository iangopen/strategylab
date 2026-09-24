import { expect, test, type Locator } from "@playwright/test";
import { defaultScenario, newCustomInstance, newStrategyInstance } from "../src/scenario";
import { formatUnits, previewContextOf, previewRule } from "../src/ui/rules/preview";
import { addStrategy, card, expectTableMatchesEngine, openApp, runAndWait } from "./helpers";

const BLANK = "Blank rule (same bet every round)";

/** The rule's card by POSITION (third, after the default Flat and Martingale): stable when the rule is renamed. */
const ruleCard = (page: import("@playwright/test").Page) => page.locator(".strategy-card").nth(2);

/** The rule exactly as the UI holds it: read from its JSON tab (then back to Form). */
async function ruleOf(c: Locator): Promise<unknown> {
  await c.getByRole("tab", { name: "JSON" }).click();
  const json = await c.getByRole("textbox", { name: "Rule JSON" }).inputValue();
  await c.getByRole("tab", { name: "Form" }).click();
  return JSON.parse(json) as unknown;
}

/** The preview must equal previewRule() in Node for the same rule and scenario context. */
async function expectPreviewMatches(c: Locator, script: string) {
  const expected = previewRule(await ruleOf(c), script, previewContextOf(defaultScenario()));
  if (!expected.ok) throw new Error(expected.error);
  const rows = c.locator(".rule-preview-table tbody tr");
  await expect(rows).toHaveCount(expected.rows.length);
  await expect(rows.locator("td:nth-child(2)")).toHaveText(expected.rows.map((r) => formatUnits(r.units)));
  await expect(c.locator(".rule-ladder strong")).toHaveText(expected.next === "stop" ? "stop" : `next ${formatUnits(expected.next.units)}`);
}

test("session 6 (1-3): add a blank rule, build it in the form, reorder and delete entries; the live preview follows every edit", async ({ page }) => {
  await openApp(page);
  await addStrategy(page, BLANK);
  const c = ruleCard(page);
  await expect(c.locator(".strategy-head strong")).toHaveText("My rule");
  await expect(c.locator(".strategy-head .swatch")).toHaveAttribute("style", /--series-2/);
  await expect(c.getByRole("tab", { name: "Form" })).toHaveAttribute("aria-selected", "true");
  await expect(c.getByRole("tab", { name: "JSON" })).toBeVisible();

  // After a loss: "Losses in a row, at least 2" -> "Multiply the bet by 2"; Otherwise stays "Back to the start bet".
  const loss = c.locator("fieldset.rule-list", { has: page.locator("legend", { hasText: "After a loss" }) });
  await loss.getByRole("button", { name: "+ Add a rule" }).click();
  const rule1 = loss.locator(".rule-entry").nth(0);
  await rule1.getByRole("combobox", { name: "When", exact: true }).selectOption({ label: "Losses in a row, at least" });
  await rule1.getByRole("textbox", { name: "At least", exact: true }).fill("2");
  await rule1.getByRole("combobox", { name: "Then", exact: true }).selectOption({ label: "Multiply the bet by" });
  await rule1.getByRole("textbox", { name: "Factor", exact: true }).fill("2");
  await expect(loss.locator(".rule-entry").nth(1).getByRole("combobox", { name: "Then (in every other case)" })).toHaveValue("reset");
  await c.getByRole("textbox", { name: "Name", exact: true }).fill("Double after two losses");
  await expect(c.locator(".strategy-head strong")).toHaveText("Double after two losses");
  const renamed = c;
  await expectPreviewMatches(renamed, "LLLWLW");

  // A second rule, moved above the first, then deleted: order and preview follow.
  await loss.getByRole("button", { name: "+ Add a rule" }).click();
  const entries = loss.locator(".rule-entry");
  await expect(entries).toHaveCount(3);
  await entries.nth(1).getByRole("combobox", { name: "Then", exact: true }).selectOption({ label: "Stop the session" });
  await entries.nth(1).getByRole("button", { name: "Move up" }).click();
  await expect(entries.nth(0).getByRole("combobox", { name: "Then", exact: true })).toHaveValue("stop");
  await expect(entries.nth(1).getByRole("combobox", { name: "Then", exact: true })).toHaveValue("multiply");
  await expect(entries.nth(0).getByRole("button", { name: "Move up" })).toBeDisabled();
  await expect(entries.nth(1).getByRole("button", { name: "Move down" })).toBeDisabled(); // never below the default
  // With "2 losses in a row -> stop" first, LLL stops: the preview ends in a stop.
  await renamed.getByRole("textbox", { name: "Preview: type wins and losses (W / L)" }).fill("LLLWLW");
  await expectPreviewMatches(renamed, "LLLWLW");
  await expect(renamed.locator(".rule-ladder strong")).toHaveText("stop");
  await expect(renamed.locator(".rule-preview")).toContainText("The rule stopped before the end of the script.");
  await entries.nth(0).getByRole("button", { name: "Delete" }).click();
  await expect(entries).toHaveCount(2);
  await expectPreviewMatches(renamed, "LLLWLW");

  // A bad script: readable error.
  await renamed.getByRole("textbox", { name: "Preview: type wins and losses (W / L)" }).fill("LLX");
  await expect(renamed.locator(".rule-preview .error")).toHaveText("Use only W (win) and L (loss), e.g. LLLWLW.");
});

test("session 6 (4-5): the rule runs beside Flat and Martingale with its own column, color and chart panels; numbers equal the engine's; replay includes it", async ({ page }) => {
  await openApp(page);
  await addStrategy(page, BLANK);
  const c = ruleCard(page);
  const loss = c.locator("fieldset.rule-list", { has: page.locator("legend", { hasText: "After a loss" }) });
  await loss.getByRole("button", { name: "+ Add a rule" }).click();
  await loss.locator(".rule-entry").nth(0).getByRole("combobox", { name: "Then", exact: true }).selectOption({ label: "Multiply the bet by" });
  const rule = await ruleOf(c);
  await runAndWait(page);
  const table = page.getByTestId("results-table");
  await expect(table.locator("thead th")).toHaveText(["Statistic", "Flat", "Martingale", "My rule"]);
  await expect(table.locator("thead th").nth(3).locator(".swatch")).toHaveAttribute("style", /--series-2/);
  await expectTableMatchesEngine(page, { ...defaultScenario(), strategies: [newStrategyInstance("flat"), { ...newStrategyInstance("martingale"), config: { multiplier: 2 } }, newCustomInstance(rule)] });
  await expect(page.getByTestId("fan-canvas")).toHaveCount(3);
  await expect(page.getByTestId("hist-canvas")).toHaveCount(3);
  await expect(page.getByTestId("fan-canvas").nth(2)).toHaveAttribute("data-label", "My rule");
  await page.getByRole("textbox", { name: "Session", exact: true }).fill("0");
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect(page.locator(".replay-legend li")).toHaveCount(3);
  await expect(page.locator(".replay-legend li").nth(2)).toContainText("My rule");
});

test("session 6 (6): pasted JSON: unknown key and bad values are listed and block Run; non-JSON is reported; fixing it brings the form back", async ({ page }) => {
  await openApp(page);
  await addStrategy(page, BLANK);
  const c = ruleCard(page);
  await c.getByRole("tab", { name: "JSON" }).click();
  const json = c.getByRole("textbox", { name: "Rule JSON" });
  const bad = '{"kind":"progression","name":"x","startUnits":1,"onWin":[{"then":{"type":"reset"}}],"onLoss":[{"then":{"type":"multiply","by":20}}],"script":"alert(1)"}';
  await json.fill(bad);
  await expect(c.locator(".rule-errors")).toContainText('unknown key "script" (allowed: kind, name, startUnits, onWin, onLoss)');
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  await json.fill("{ kind: 1 }");
  await expect(c.getByText(/^Not valid JSON: /)).toBeVisible();
  // The previously pasted (invalid) rule is still what's stored, so the preview says so too.
  await expect(c.locator(".rule-preview .error")).toHaveText("Fix the rule's problems to see the preview.");
  await json.fill(bad.replace(',"script":"alert(1)"', ""));
  await expect(c.locator(".rule-errors")).toContainText("onLoss entry 1 → action → by: must be between 0.1 and 10 (got 20)");
  await c.getByRole("tab", { name: "Form" }).click();
  await expect(c.getByRole("textbox", { name: "Factor", exact: true })).toHaveValue("20"); // the form shows it, flagged
  await c.getByRole("tab", { name: "JSON" }).click();
  await json.fill(bad.replace(',"script":"alert(1)"', "").replace('"by":20', '"by":2'));
  await expect(c.locator(".rule-errors")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
  await c.getByRole("tab", { name: "Form" }).click();
  await expect(c.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("x");
});

test("session 6 (7): Kelly's assumed win probability can be cleared to blank with no error; 0 is rejected", async ({ page }) => {
  await openApp(page);
  await addStrategy(page, "Kelly");
  const k = card(page, "Kelly");
  const p = k.getByRole("textbox", { name: "Assumed win probability", exact: true });
  await p.fill("0.6");
  await expect(k.locator(".field.has-error")).toHaveCount(0);
  await p.fill("0");
  await expect(k.locator(".field.has-error .error")).toHaveText("Must be at least 0.01 (or blank).");
  await p.fill("");
  await expect(p).toHaveValue("");
  await expect(p).toHaveAttribute("placeholder", "blank");
  await expect(k.locator(".field.has-error")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
});
