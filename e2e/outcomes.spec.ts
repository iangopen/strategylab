import { expect, test, type Page } from "@playwright/test";
import { replaySession } from "../src/engine/replay";
import { stripCells } from "../src/ui/charts/adapters";
import { defaultScenario, editorScenarioGame, toSimRequest, ticketExampleGame, type ScenarioConfig } from "../src/scenario";
import { resolveStrategies } from "../src/worker/resolve";
import { encodeScenarioLink } from "../src/share/link";
import { decodeScenarioLink } from "../src/share/link";
import { BINARY_ONLY_NOTE } from "../src/ui/format";
import { addStrategy, expectTableMatchesEngine, openApp, runAndWait, watchPage } from "./helpers";

// Session 13: multi-outcome games. Build the ticket game in the editor, run it, replay a session,
// copy the link and reopen it. Expected numbers come from the engine in Node, never hardcoded.

const TICKET: ScenarioConfig = { ...defaultScenario(), game: ticketExampleGame() };

const readout = (page: Page) => page.getByLabel("What these outcomes imply");
const row = (page: Page, i: number) => page.getByTestId("outcome-row").nth(i);

async function expectTicketReadout(page: Page) {
  await expect(readout(page).locator("dd")).toHaveText(["1", "$61.67", "0.8810", "11.905% of every dollar wagered"]);
  await expect(readout(page).locator("dt")).toHaveText(["Sum of probabilities", "Mean prize", "Mean return per $1 staked", "House edge"]);
}

test("build the ticket game in the editor, run it, replay a session, copy the link and reopen it", async ({ page, context }) => {
  const problems = watchPage(page);
  await openApp(page);
  await page.getByRole("combobox", { name: "Game", exact: true }).selectOption({ label: "Custom outcomes" });
  await expect(page.getByTestId("outcome-row")).toHaveCount(2); // the starter: $10 ticket, $20 or nothing

  // Build it: $70 ticket; $20 at 1/6, $50 at 3/6, $100 at 2/6 (fractions typed as fractions).
  await page.getByRole("textbox", { name: "Ticket price", exact: true }).fill("70");
  await row(page, 0).getByRole("textbox", { name: "Outcome 1 probability" }).fill("1/6");
  await row(page, 0).getByRole("textbox", { name: "Outcome 1 prize" }).fill("20");
  await row(page, 1).getByRole("textbox", { name: "Outcome 2 probability" }).fill("3/6");
  await row(page, 1).getByRole("textbox", { name: "Outcome 2 prize" }).fill("50");
  // Mid-edit the sum is 4/6: the readout says so and Run is blocked.
  await expect(page.getByText("The probabilities must add up to 1 (they add up to 2/3).")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "+ Add an outcome" }).click();
  await row(page, 2).getByRole("textbox", { name: "Outcome 3 probability" }).fill("2/6");
  await row(page, 2).getByRole("textbox", { name: "Outcome 3 prize" }).fill("100");
  await expectTicketReadout(page);
  await expect(page.getByTestId("outcome-kind")).toHaveText(["loses", "loses", "wins"]);

  // Bad input gets a readable error.
  await row(page, 0).getByRole("textbox", { name: "Outcome 1 probability" }).fill("1/0");
  await expect(row(page, 0)).toContainText('Cannot divide by zero (got "1/0").');
  await row(page, 0).getByRole("textbox", { name: "Outcome 1 probability" }).fill("1/6");
  await expectTicketReadout(page);

  // Kelly's assumed probability applies only to win/lose games: disabled here, with the note.
  await addStrategy(page, "Kelly");
  await expect(page.getByRole("textbox", { name: "Assumed win probability", exact: true })).toBeDisabled();
  await expect(page.getByText(BINARY_ONLY_NOTE)).toBeVisible();
  await page.locator(".strategy-card").nth(2).getByRole("button", { name: /Remove/ }).click();

  // Run: the table equals the engine's, for the SAME scenario built in Node from the shipped example.
  await runAndWait(page);
  await expectTableMatchesEngine(page, TICKET);

  // Replay session 0: both strategies, one outcome strip with a level per outcome.
  await page.getByRole("textbox", { name: "Session", exact: true }).fill("0");
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect(page.getByTestId("replay-bankroll")).toHaveAttribute("data-lines", "2");
  await expect(page.getByTestId("replay-strip")).toHaveAttribute("data-levels", JSON.stringify(["$20", "$50", "$100"]));
  await expect(page.getByTestId("strip-levels").locator("li")).toHaveText(["Level 1 of 3: $20", "Level 2 of 3: $50", "Level 3 of 3: $100"]);

  // Copy link, reopen in a new page: the same inputs, readout and results.
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.locator(".run-controls")).toContainText(/Link copied \([\d,]+ characters\)/);
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  const decoded = decodeScenarioLink(new URL(copied).hash);
  if (decoded.kind !== "loaded") throw new Error("copied link did not decode");
  expect(decoded.scenario.game).toEqual(TICKET.game);
  const other = await context.newPage();
  const otherProblems = watchPage(other);
  await other.goto(copied);
  await expect(other.getByRole("status")).toContainText("Loaded the scenario from the link.");
  await expect(other.getByRole("combobox", { name: "Game", exact: true })).toHaveValue("outcomes");
  await expect(other.getByRole("textbox", { name: "Outcome 1 probability" })).toHaveValue("1/6");
  await expectTicketReadout(other);
  await runAndWait(other);
  await expectTableMatchesEngine(other, TICKET);
  expect(problems).toEqual([]);
  expect(otherProblems).toEqual([]);
});

test("the ticket example preset, the player-edge price, a push and the cannot-lose warning", async ({ page }) => {
  await openApp(page);
  await page.getByRole("combobox", { name: "Game", exact: true }).selectOption({ label: "Ticket example ($70; prizes $20, $50, $100)" });
  await expectTicketReadout(page);
  await page.getByRole("textbox", { name: "Ticket price", exact: true }).fill("60");
  await expect(readout(page)).toContainText("Player edge");
  await expect(readout(page)).toContainText("2.778% of every dollar wagered");
  // A prize equal to the price is a push.
  await row(page, 1).getByRole("textbox", { name: "Outcome 2 prize" }).fill("60");
  await expect(page.getByTestId("outcome-kind").nth(1)).toHaveText("push (prize = price)");
  // Multiplier mode, every return at least 1: the plain warning.
  await page.getByRole("combobox", { name: "Outcome input", exact: true }).selectOption("multiplier");
  for (let i = 0; i < 3; i++) await row(page, i).getByRole("textbox", { name: `Outcome ${i + 1} return per $1` }).fill(String(1 + i * 0.5));
  await expect(readout(page)).toContainText("Every outcome returns at least your stake, so this game cannot lose money.");
});

test("the outcome editor fits a 360 px screen without horizontal scrolling", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await openApp(page);
  await page.getByRole("combobox", { name: "Game", exact: true }).selectOption({ label: "Ticket example ($70; prizes $20, $50, $100)" });
  await expectTicketReadout(page);
  for (let i = 0; i < 9; i++) await page.getByRole("button", { name: "+ Add an outcome" }).click();
  await expect(page.getByTestId("outcome-row")).toHaveCount(12);
  await expect(page.getByRole("button", { name: "+ Add an outcome" })).toBeDisabled(); // at most 12
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("replay on a game with a push: the strip marks pushes (hollow bars), exactly the engine's rounds, and names every level", async ({ page }) => {
  const s: ScenarioConfig = {
    ...defaultScenario(),
    game: editorScenarioGame({ mode: "multiplier", price: null, rows: [{ prob: "0.44", value: 2, label: "win" }, { prob: "0.1", value: 1, label: "push" }, { prob: "0.46", value: 0, label: "lose" }] }),
  };
  const req = toSimRequest(s);
  const rep = replaySession(req.game, resolveStrategies(req.strategies), req.session, req.masterSeed, 3);
  const pushes = stripCells(rep).filter((c) => c.push).length;
  expect(pushes).toBeGreaterThan(0);
  const link = encodeScenarioLink(s, "");
  if (!link.ok) throw new Error(link.message);
  await openApp(page, link.fragment);
  await expect(readout(page)).toContainText("2.000% of every dollar wagered");
  await runAndWait(page);
  await expectTableMatchesEngine(page, s);
  await page.getByRole("textbox", { name: "Session", exact: true }).fill("3");
  await page.getByRole("button", { name: "Replay", exact: true }).click();
  await expect(page.getByTestId("replay-strip")).toHaveAttribute("data-pushes", String(pushes));
  await expect(page.getByTestId("replay-strip")).toHaveAttribute("data-cells", String(stripCells(rep).length));
  await expect(page.getByTestId("strip-levels").locator("li")).toHaveText(["Level 1 of 3: lose", "Level 2 of 3: push (push: hollow bar)", "Level 3 of 3: win"]);
});
