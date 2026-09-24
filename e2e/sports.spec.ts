import { expect, test, type Page } from "@playwright/test";
import { convertOdds, displayOdds, sportsGame, type SportsInput } from "../src/engine/odds";
import { defaultScenario, defaultSportsInput, sportsScenarioGame } from "../src/scenario";
import { PUSH_NOTE, sportsReadoutLines } from "../src/ui/sportsReadout";
import { expectTableMatchesEngine, openApp, runAndWait } from "./helpers";

/** The readout must show exactly the lines sportsReadoutLines() computes in Node for the same inputs. */
async function expectReadout(page: Page, input: SportsInput) {
  const r = sportsGame(input);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const lines = sportsReadoutLines(r.readout);
  const dl = page.getByLabel("What these odds imply");
  await expect(dl.locator("dt")).toHaveText(lines.map((l) => l.label));
  await expect(dl.locator("dd")).toHaveText(lines.map((l) => l.value));
}

async function chooseSports(page: Page) {
  await page.getByRole("combobox", { name: "Game", exact: true }).selectOption({ label: "Sports odds" });
  await expect(page.getByRole("combobox", { name: "Input", exact: true })).toHaveValue("market");
}

test("session 8 (1): market readout for -110 / -110, and the push note", async ({ page }) => {
  await openApp(page);
  await chooseSports(page);
  await expect(page.getByRole("textbox", { name: "Side A odds", exact: true })).toHaveValue("-110");
  await expect(page.getByRole("textbox", { name: "Side B odds", exact: true })).toHaveValue("-110");
  await expectReadout(page, defaultSportsInput());
  await expect(page.getByLabel("What these odds imply")).toContainText("4.762%"); // the spec's hand-computed overround
  await expect(page.getByLabel("What these odds imply")).toContainText("4.545% of every dollar wagered");
  await expect(page.getByText(PUSH_NOTE, { exact: false })).toBeVisible();
});

test("session 8 (2): Decimal shows 1.91 / 1.91 with the same readout; back to American shows -110 / -110 (exact round trip)", async ({ page }) => {
  await openApp(page);
  await chooseSports(page);
  await page.getByRole("combobox", { name: "Odds format", exact: true }).selectOption("decimal");
  const d = convertOdds(-110, "american", "decimal");
  await expect(page.getByRole("textbox", { name: "Side A odds", exact: true })).toHaveValue(displayOdds("decimal", d));
  await expect(page.getByRole("textbox", { name: "Side B odds", exact: true })).toHaveValue("1.91");
  await expectReadout(page, { ...defaultSportsInput(), format: "decimal", sideA: d, sideB: d });
  await page.getByRole("combobox", { name: "Odds format", exact: true }).selectOption("american");
  await expect(page.getByRole("textbox", { name: "Side A odds", exact: true })).toHaveValue("-110");
  await expectReadout(page, defaultSportsInput());
});

test("session 8 (3): -50 is rejected inline and blocks Run; +110 / +110 is flagged as rare and usually a data-entry error", async ({ page }) => {
  await openApp(page);
  await chooseSports(page);
  const a = page.getByRole("textbox", { name: "Side A odds", exact: true });
  await a.fill("-50");
  await expect(page.getByText("American odds must be +100 or higher, or -100 or lower (got -50).")).toBeVisible();
  await expect(page.getByText("Fix the odds above to see what they imply.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  await a.fill("110");
  await page.getByRole("textbox", { name: "Side B odds", exact: true }).fill("110");
  await expectReadout(page, { ...defaultSportsInput(), sideA: 110, sideB: 110 });
  await expect(page.getByLabel("What these odds imply").locator(".warn")).toContainText(["Player edge", "rare in real markets and is usually a data-entry error"]);
});

test("session 8 (4): 'One side + my estimate' relabels the field, shows the estimate and its help, and a 0.55 estimate reads as a believed player edge", async ({ page }) => {
  await openApp(page);
  await chooseSports(page);
  await page.getByRole("combobox", { name: "Input", exact: true }).selectOption("estimate");
  await expect(page.getByRole("textbox", { name: "Your side's odds", exact: true })).toHaveValue("-110");
  await expect(page.getByRole("textbox", { name: "Side B odds", exact: true })).toHaveCount(0);
  const est = page.getByRole("textbox", { name: "Your estimated win probability", exact: true });
  await expect(est).toBeVisible();
  await expect(page.getByText(/believing is not the same as having one/)).toBeVisible();
  await est.fill("0.55");
  await expectReadout(page, { ...defaultSportsInput(), mode: "estimate", estimate: 0.55 });
  await expect(page.getByLabel("What these odds imply")).toContainText("5.000% of every dollar wagered");
});

test("session 8 (5-6): run Flat + Martingale on -110 / -110 (numbers equal the engine's), then Copy link and open it in a new tab", async ({ page, context }) => {
  await openApp(page);
  await chooseSports(page);
  await runAndWait(page);
  const s = { ...defaultScenario(), game: sportsScenarioGame(defaultSportsInput()) };
  await expectTableMatchesEngine(page, s);
  await page.getByRole("button", { name: "Copy link" }).click();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain("/strategylab/#s=");
  const other = await context.newPage();
  await other.goto(copied);
  await expect(other.getByRole("combobox", { name: "Game", exact: true })).toHaveValue("sports");
  await expect(other.getByRole("textbox", { name: "Side A odds", exact: true })).toHaveValue("-110");
  await expectReadout(other, defaultSportsInput());
  await runAndWait(other);
  await expectTableMatchesEngine(other, s);
});
