// Screen-reader announcements and keyboard-only use (portfolio hardening audit, 2026-09-27: "results
// not announced"). The expected sentences are built from the engine's own output in Node, never
// hardcoded, like every other spec.
import { expect, test, type Page } from "@playwright/test";
import { runMonteCarlo } from "../src/engine/montecarlo";
import { replaySession } from "../src/engine/replay";
import { defaultScenario, toSimRequest } from "../src/scenario";
import { endText } from "../src/ui/charts/adapters";
import { formatStat, instanceLabel, replayAnnouncement, runAnnouncement } from "../src/ui/format";
import { resolveStrategies } from "../src/worker/resolve";
import { openApp, watchPage } from "./helpers";

/** Press Tab until the focused element matches, as a keyboard-only user would. */
async function tabTo(page: Page, isTarget: () => boolean, max = 150) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    if (await page.evaluate(isTarget)) return i + 1;
  }
  throw new Error(`target not reached in ${max} Tab presses`);
}

test("keyboard only: Run, then the results and a replay are announced through status regions that exist before they fill", async ({ page }) => {
  const problems = watchPage(page);
  await openApp(page);
  const s = defaultScenario();
  const req = toSimRequest(s);
  const specs = resolveStrategies(req.strategies);
  const labels = s.strategies.map((_, i) => instanceLabel(s.strategies, i));

  // The live regions are in the page, empty, BEFORE the run: a region that appears with its text is often not read.
  const runRegion = page.getByTestId("run-announcer");
  await expect(runRegion).toHaveAttribute("role", "status");
  await expect(runRegion).toHaveText("");

  const presses = await tabTo(page, () => document.activeElement?.textContent === "Run");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("run-status")).toContainText(/^Done: /, { timeout: 120_000 });

  const r = runMonteCarlo(req.game, specs, req.session, req.nSessions, req.masterSeed);
  const expected = runAnnouncement(r.perStrategy.map((o, i) => ({ label: labels[i]!, stats: o.stats })));
  await expect(runRegion).toContainText(expected);
  const said = await runRegion.textContent();
  console.log(`Run reached in ${presses} Tab presses. The status region reads: ${said}`);

  // Replay by keyboard: the Session field is the keyboard route to what a click on a fan line does.
  const replayRegion = page.getByTestId("replay-announcer");
  await expect(replayRegion).toHaveAttribute("role", "status");
  await tabTo(page, () => (document.activeElement as HTMLInputElement | null)?.placeholder?.startsWith("0–") === true);
  await page.keyboard.type("6");
  await page.keyboard.press("Enter");
  const rep = replaySession(req.game, specs, req.session, req.masterSeed, 6);
  const expectedReplay = replayAnnouncement(6, rep.strategies.map((st, k) => `${labels[k]}: ${endText(st.endReason, st.rounds)}, final bankroll ${formatStat("money", st.finalBankroll)}`));
  await expect(replayRegion).toHaveText(expectedReplay);
  console.log(`The replay region reads: ${expectedReplay}`);

  expect(problems).toEqual([]);
});

test("the third-party licence notices ship with the site and the footer links to them", async ({ page }) => {
  await openApp(page);
  const link = page.getByRole("link", { name: "Third-party licences" });
  const href = await link.getAttribute("href");
  expect(href).toBe("/strategylab/third-party-licenses.txt");
  const res = await page.request.get(href!);
  expect(res.status()).toBe(200);
  const text = await res.text();
  for (const pkg of ["comlink", "react", "react-dom", "scheduler"]) expect(text).toMatch(new RegExp(`^${pkg} \\d+\\.\\d+\\.\\d+ \\(`, "m"));
  expect(text).toContain("Copyright (c) Meta Platforms, Inc. and affiliates.");
  expect(text).toContain("Apache License");
});
