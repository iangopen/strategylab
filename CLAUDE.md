# CLAUDE.md — StrategyLab

Read this file in full at the start of every session. It is the source of truth for what this project is, the rules it must never break, and what is actually done. If code and this file disagree, stop and flag it. Do not silently pick one.

---

## Product

StrategyLab ("A Monte Carlo simulator for betting strategies.") is a Monte Carlo lab for betting strategies. Users configure a game, a bankroll scenario, and one or more strategies (Martingale, Fibonacci, etc.), run thousands of simulated sessions, and compare outcome distributions side by side.

### The core truth

In any game with a house edge, every bet has expected value `-edge * betSize`, regardless of what came before. So for ANY strategy, expected loss = edge * expected total wagered. Progressions do not change EV per dollar wagered; they only reshape the distribution (Martingale: many small wins, rare catastrophic loss). "EV per $ wagered" is the headline stat and the engine's key correctness test.

### Why it's different

Existing tools (miniwebtool, martingalecalculator.com, roulettesim.app, bettingsimulation.com) are mostly one-strategy-per-page calculators in an SEO / casino-affiliate niche. We differentiate with:

- True side-by-side comparison on IDENTICAL random outcomes (common random numbers)
- EV per $ wagered as the headline stat
- A custom rule builder
- Shareable scenario URLs
- Later, a sports-odds mode (American/decimal odds + vig)

Tone is educational and honest: no casino links, no affiliate content, no "winning system" language, ever. This applies to UI copy, README, commit messages, and page metadata.

---

## Stack and environment

- Playwright (Chromium only) for E2E, in `e2e/*.spec.ts`, against the PRODUCTION build served under `/strategylab/` (session 9)
- Charts: raw Canvas 2D, no chart library (session 4 spike decision, see Decisions)
- No Supabase, no backend, no CSS framework
- OS: Windows / PowerShell. Every command run or documented here must work in PowerShell (use `;` not `&&` on Windows PowerShell 5, no `rm -rf`, no bash-only syntax).
- GitHub: **`iangopen/strategylab`**, public, MIT, gh CLI authenticated (account renamed in session 10: old repo URLs redirect, the old Pages address does NOT). Product name **StrategyLab**, subtitle "A Monte Carlo simulator for betting strategies." in the README, `<title>`, `og:title`, repo description and app header.
- **Deploy: GitHub Pages via Actions**, live at **https://iangopen.github.io/strategylab/**. `.github/workflows/ci.yml` runs lint, unit, build and E2E on every push and PR; only a `main` push passing ALL four builds (`npm run build:pages`) and deploys (`upload-pages-artifact` + `deploy-pages`; the deploy job has exactly `pages: write` + `id-token: write`; Pages source "GitHub Actions"). A failing test never deploys. Pre-rename Pages links 404; re-share with the new address (same `#s=`).
- **Base path:** `vite.config.ts` reads `VITE_BASE` (default `/`; it must start and end with `/`). The Pages build and E2E use `/strategylab/`.
  - Never hardcode a base path in app code: assets and the worker resolve via `new URL(..., import.meta.url)`, share links from `location.origin + location.pathname`. `#s=` links need no 404 fallback (fragments never reach the server; no client-side routes).
- **Line endings:** `.gitattributes` enforces LF (`text=auto eol=lf`) in the repo and working copies (session 9).
- **Background dev/preview servers:** stopping the task that ran `vite` can leave its `node` child holding the port (E2E uses 4180). Check the port; stop a leftover only after confirming its command line is our own `vite ... --port <n>`.
- **Never create files with `echo > file` in PowerShell:** PowerShell 5 writes UTF-16 LE, which git treats as binary. Use the file tools or `Set-Content -Encoding utf8`.

### Commands

```powershell
npm run test          # Vitest: "unit" project, then "stats" (*.stats.test.ts); must be clean before any commit (chain commits after it: npm run test && git commit ...)
npm run build         # strict type check (app, config, E2E specs) + production build, must be clean before any push
npm run e2e           # Playwright: builds with VITE_BASE=/strategylab/, serves on :4180, runs e2e/*.spec.ts
npm run bench         # one fixed, seeded 100k-session run and one max-size sweep, timed (one machine's numbers, never a claim)
npm run screenshots   # regenerate docs/*.png + public/og-image.png from the LIVE site (SCREENSHOT_URL overrides); NOT a test
npx playwright install chromium   # once per machine, before the first e2e run
```

---

## Absolute rules

These are not negotiable. A change that breaks one of them is wrong even if every test passes.

1. **Engine isolation.** `src/engine/` imports NOTHING from React or the DOM. It must run identically in a test, the main thread, or a worker. Reason: tests and worker must exercise the same code.

2. **Seeded randomness only.** All randomness goes through `src/engine/rng.ts` (mulberry32). `Math.random` is BANNED in `src/engine/`. Reason: reproducibility and shareable seeds.

3. **Common random numbers.** Session i's seed = `splitmix32(masterSeed ^ splitmix32(i))`. NEVER `masterSeed + i` (adjacent mulberry32 seeds are correlated). Each round consumes EXACTLY ONE uniform draw, which picks the outcome by cumulative probability (session 13; for a win/lose game exactly `u < p`). Strategies NEVER touch the RNG. Reason: session i of every strategy sees the identical outcome sequence; this is the basis of fair comparison.

4. **Integer money, with a per-session sub-cent carry.** The engine works in integer cents. Bets returned by strategies are rounded to whole cents by the runner. The UI converts at the boundary. A win pays `Math.round(bet × netPayout + carry)` cents and keeps the remainder as the session's `carry` (session 11): the bankroll is always whole cents, `|carry| ≤ 0.5`, the carry starts at 0 in every session and never crosses sessions, and it never consumes or moves a draw. For integer payouts it is always exactly 0. Reason: no float drift in progressions, and no systematic cents-rounding bias in EV per $ on non-integer payouts (see "Cents rounding").

5. **Game model** (`games.ts`). **A game is a list of 1–12 outcomes `{ prob, net }` (session 13, see "Multi-outcome games"); a binary game is `[{p, n}, {1 − p, −1}]`, described here.** `netPayout` = profit per unit staked on a win (even money = 1); `edge = 1 - winProb * (1 + netPayout)`. Presets: European roulette even-money (18/37, 1), American (18/38, 1), fair coin (0.5, 1), custom, and (session 8) sports odds, which COMPILE to a Game in `odds.ts` (see "Sports odds"). Validate `0 < winProb < 1` and `netPayout > 0`.

6. **Strategy contract** (`strategies/types.ts`), registered in ONE place (`strategies/registry.ts`):
   ```ts
   interface Strategy<Config, State> {
     id; label; description;
     configSchema: FieldSpec[];   // drives the UI form
     defaultConfig: Config;
     init(config, ctx): State;
     nextBet(state, ctx): number | "stop";
     update(state, result: RoundResult, ctx): State;   // session 13; NOT called on a push
   }
   interface RoundResult { kind: "win" | "loss" | "push"; outcomeIndex: number; profit: number } // profit = lastBet × net, exact
   ```
   `FieldSpec = { key, label, kind: "number" | "integer" | "optionalNumber" | "boolean" | "select", min?, max?, step?, options?, help?, binaryOnly? }` (`optionalNumber`, session 6: blank = the key is ABSENT from the config, otherwise a number within min/max). Strategies are PURE: no input mutation, no side effects. `ctx` is read-only (bankroll, baseBet, round, lastBet). The UI renders strategy config purely from `configSchema`. A new strategy = one file + one registry line, zero UI edits.

7. **Table rules live in the runner**, never in strategies. Raise the bet to tableMin, clamp it to tableMax. If bet > bankroll, apply `insufficientFunds: "stop"` (default) | `"allIn"`. `endReason` is one of: `"ruin"` (bankroll < tableMin), `"insufficientFunds"` (could not cover the next bet), `"stopWin"`, `"stopLoss"`, `"maxRounds"`, `"strategyStop"`. `maxRounds` is REQUIRED and finite (default 1000, hard cap 1,000,000). Reason: bounded runtime and defined checkpoints.

8. **runSession(game, strategy, config, seed, opts)** returns finalBankroll, rounds, totalWagered, peak, maxDrawdown, longestLosingStreak, endReason, and path only if `opts.recordPath`.

9. **Stats are a plug-in layer** (`src/engine/stats/`). A stat is `{ id; label; format: "money" | "pct" | "ratio" | "int"; emphasis?: boolean; compute(acc: Accumulator, ctx: RunContext): number }`, where `RunContext` is read-only `{ game, edge, config, nSessions }` (session 3). The Accumulator is built in a single pass per strategy and holds running sums (final, wagered, rounds, sums of squares for SE), endReason counts, and one `Float64Array` per strategy for EACH per-session column: final bankroll, max drawdown, longest losing streak (session 3), rounds to bust (session 18; NaN unless the session busted, so sorting puts busts first), total wagered (session 22; read session by session by the paired comparison, not a percentile column). These columns NEVER leave the worker; only derived outputs cross, typed arrays via `Comlink.transfer`. Every percentile goes through ONE function, `quantileSorted` (type 7) in `stats/quantile.ts`, on a sorted copy made once per column (`sortedColumn`). NEVER retain full paths for all sessions. Stats are registered in `stats/registry.ts`, and the results table renders purely from that registry.

10. **runMonteCarlo(game, strategies[], config, nSessions, masterSeed, onProgress)** runs every strategy over the SAME session seeds and returns per strategy: stat values, raw endReason counts, the first 50 session paths (streaming min/max downsampled), final-bankroll histogram counts over ONE set of 50 bins shared by every strategy in the run, and p5/p25/p50/p75/p95 percentile bands at the ADAPTIVE checkpoints of `checkpoints.ts` (session 12: dense to round 64, then geometric, ending exactly at maxRounds; at most 287), from the first min(2000, n) sessions (the same indices for every strategy). The result also carries `comparisons` (session 22): one small record per pair of strategies from `stats/paired.ts` (difference in EV per $ with its paired SE, the discordant bust counts, and what one whole-bankroll loss weighs for each strategy). Band and sample-path sessions are observed through the runner's optional per-round `observer`; every other session pays only a branch check. Memory per observed session is independent of maxRounds.

11. **Worker.** `src/worker/sim.worker.ts` exposes runMonteCarlo via Comlink. The progress callback is passed with `Comlink.proxy` and reported about every 2%. Cancel = `worker.terminate()`, then respawn (Comlink cannot interrupt a sync loop). The UI NEVER runs a simulation on the main thread. `client.ts` owns the worker lifecycle.

### Also non-negotiable

- **All scenario state lives in one serializable `ScenarioConfig`** (`src/scenario.ts`, plain JSON). No scenario state hidden in component-local state. Reason: URL sharing must stay trivial.
- **If an approved decision turns out wrong mid-session, STOP and ask before changing it.** (Added in session 12, after session 11 swapped an approved option for a variant and only reported it afterwards.)
- **Monte Carlo-heavy tests go in the `stats` Vitest project; never add a per-file or per-test timeout** (session 13). A test that simulates about 1,000 sessions or more, or takes over a second alone, lives in a `*.stats.test.ts` file: invariant tables, equivalence, fuzz, goldens, frequency and property tests. The `stats` project runs AFTER `unit` on 2 workers with ONE project-wide timeout (120 s, in `vite.config.ts`); `unit` keeps Vitest's 5 s default. Reason: heavy files competing for CPU made deterministic tests time out, and per-file timeouts only hid that.
- **Statistical tests use standard-error tolerances**, never hand-picked constants. Tolerance = 4 × SE computed in the test from the samples, and the test prints the SE. Fixed seeds keep them deterministic; SE-based bounds keep them honest. Do NOT increase nSessions or loosen tolerances just to make a test pass. If an invariant test fails, the engine is presumed wrong until proven otherwise.

---

## Where things are

`src/share/` parses untrusted input; every chart scale lives in `src/ui/charts/adapters.ts`; `src/scenario.ts` is the one `ScenarioConfig`. Annotated file map: `docs/spec.md` ("Folder map").

## Chart rules

These are the owner's session 4 directives, verbatim. They bind every chart, present and future.

**SHARED AXES ACROSS STRATEGIES.** Charts are small multiples, one panel per strategy instance, and EVERY panel of a chart type uses the SAME x and y ranges (and the histogram uses the session 3 shared bins and a shared y max). NEVER autoscale per panel. Reason: per-panel scales make Martingale's tail look like Flat's; same principle as shared bins. Bankroll y-axes start at 0.

**ONE COLOR PER STRATEGY INSTANCE**, used everywhere: results table header, every chart panel, replay lines. Colorblind-safe palette, and every panel also carries a text label (NEVER color alone). Theme-aware via CSS variables for light and dark.

**ZOOM IS ALWAYS SHARED ACROSS PANELS; Y NEVER RESCALES** (session 10). One x window applies to every panel of a chart; nothing zooms a single panel. The y range is always the global shared range, whatever the zoom.

---

## Detail lives in docs (read on demand, NOT loaded at startup)

Read the relevant section BEFORE changing that area. These files are plain paths, deliberately not @imports.

- `docs/spec.md`: folder map; chart rule notes; how to add a strategy (spec + test kit) or a stat; the **rule language**; the **URL scenario format**; **sports odds** (conversions, de-vig, cents carry); **multi-outcome games** (one draw per round, Kelly, scenario v4); the roadmap.
- `docs/history.md`: the STATUS log (sessions 1-26, "STATUS n"), old browser checklists, the full "Still open" list, and every "Decisions made outside the spec" with its reasoning. Check it before undoing any earlier decision.
- `docs/guide.md`: plain-language author's guide with file:line pointers (re-checked session 21; refresh any you move).
- Outside the repo (local only, never committed here): `C:\devwork\portfolio-audit\strategylab\INTERVIEW-PREP.md` and `NEXT-STEPS.md` (scored candidates, recommended order, the stage 1 prompt).

## Current state (session 26, 2026-11-16): v1.0.0 plus paired comparisons

All roadmap sessions are done and verified, CI green with Pages deploy; **v1.0.0** is tagged on the commit that carries these docs, after its CI passed, with a GitHub release (session 21). The September 2026 audit's findings are fixed (STATUS 127-133):
- **Session 26 (STATUS 207-209): the EV-difference check stresses a hidden GAIN too** (guide 3.10, "The mirror case"). Adopted from the independent statistical review of 2026-11-16 (`C:\devwork\portfolio-audit\REVIEW-stats.md`, finding 1), its patch applied unchanged.
  - **Before:** only one more whole-bankroll loss of the better-looking strategy was checked. On a game whose top payout exceeds the bankroll, a missing rare win gave false verdicts: Flat against Paroli, 1-in-1000 paying 974 to 1, $200 bankroll, 10,000 sessions: 38.50% false "clear" (200 runs; true difference zero).
  - **Now:** `TakeawayInput.maxNet` (largest net payout; `runTakeawayInput` fills it) makes the one extra session the larger of that loss and a whole-bankroll win at `maxNet` by the worse-looking strategy: 0.00% in the same runs. Never less conservative than before; without `maxNet` the old check runs exactly. Only `evDifference` changed: `evClaim` and the fragile flag are still one-sided (Still open).
- **Session 25 (STATUS 202-206): the tables, the announcement and the sentences say the same thing** (guide 3.10).
  - **One flag:** `evNotes(input)` (takeaways.ts) is evClaim's `fragile` flag per strategy; `runTakeawayInput` builds THE input for the app and the report. `App` computes the notes once per run (`CompletedRun.notes`) for the results table and `runAnnouncement`; `ReportView` computes them from the same input as its sentences. Never recompute fragility anywhere else.
  - **One wording:** `undoneByOneLoss` / `fragileFootnote` in `ui/format.ts`, used by the sentence, both tables' footnotes and the announcement.
  - **Table:** a fragile EV per $ cell keeps its number (and interval, in the report) unchanged and gains `data-fragile`, an `aria-hidden` `*` (hover tooltip), sr-only "(fragile: see the note under the table)" and `aria-describedby` to the footnote. The footnote exists only when a cell is fragile; in the report it joins the existing note line.
  - **Contrast sentence:** "lost money per dollar wagered" needs `evClaim.clearlyLoses` (below zero even after one more whole-bankroll loss, whose wider interval can reach zero). Unchanged on the default run.
  - **Verified:** seed-16 E2E checks the app cell, the announcement, the report cell and the sentence all mark Martingale and only it; the default run has no marker anywhere. Page fit 2 → 949, 3 → 854, 4 → 892, 5 → 892, 6 → 905, 7 → 937, 8 → 947 px; the fragile seed-16 report 878 px (was 864).
- **Session 24 (STATUS 196-201): the single-strategy EV sentences use the same worst-case-session check** (`evClaim`; tables in guide 3.10).
  - **Before:** with rare busts the plain interval sat wholly above the true EV per $ in up to 47% of runs and wholly above zero (reading as a gain) in up to 34% (Martingale, Fibonacci; 30 sessions).
  - **Now:** "above the theoretical value" and "above zero" are claimed only if they survive one more whole-bankroll loss; otherwise the sentence says "...but one more whole-bankroll loss would undo that: this is not evidence of a gain". Reported: above theory at most 3.75%, reads as a gain at most 0.50%. The printed interval itself is unchanged. A reader must never be left thinking a negative-EV strategy gains: keep the hedge.
  - `TakeawayInput.startBankroll` (cents) switches the check on; `ReportView` passes it. Only the upper side is checked (misses below theory measured 0.25-4.75%).
  - **Pairs validated beyond Flat/Martingale:** Paroli vs Flat, Martingale vs Fibonacci, Martingale vs Paroli, four regimes, n 30 to 1,000: reported false "clear" at most 4.75%.
  - **Page fit:** E2E now prints every count from 2 to 8 (5 → 892 px, 6 → 905 px).
  - `npm run test` now takes about 115 s here (was about 75 s): the real-engine tables run four strategies.
- **Session 23 (STATUS 190-195): small-sample coverage of the comparison, and page fit at seven.** Tables in guide 3.10.
  - **The paired t-interval alone is NOT safe when busts are rare:** Flat against Martingale (true difference zero) gave about 40% false "clear" at 30 sessions and 8.6% at 1,000 sessions with a 0.25% bust rate. A minimum session count cannot fix it.
  - **The fix (`evDifference`): an EV difference is named only if the interval still excludes zero after ONE more session in which the better-looking strategy lost its whole bankroll.** Reported false "clear" is then 0.00-4.25% in every measured case (n 30 to 1,000, bust rates 0.25% to 36%). Never remove this check to gain power: on every game here the true EV-per-$ difference is zero. The sentence reads "excludes zero, but one more whole-bankroll loss would undo that".
  - **Bonett-Price (bust) is unchanged:** 0.00-3.46% false "clear" for 1-3% bust rates at 30-250 sessions.
  - **Page fit:** seven strategies measure 937 px of 960; E2E prints 2, 3, 4, 7 and 8, plus a real fragile verdict (seed 16).
- **Session 22 (STATUS 183-188): the report compares strategies through ONE interval on their difference** (guide 3.10, "How two strategies are compared"); the interval-overlap rule is gone (`overlaps` stays only for tests). Verified by `src/report/comparison.stats.test.ts` (seeded; rates in STATUS 185).
  - **Paired (every app run):** strategies share session seeds, so `pairedComparison` (worker side) differences them session by session. EV per $: paired t-interval on the linearised ratio terms, n − 1 df. Bust rate: Bonett-Price interval on the discordant sessions. Chosen over a bootstrap: one O(n) pass, no extra random numbers, so a verdict is a pure function of the run.
  - **Unpaired fallback** (callers passing no `comparisons`; nothing in the app does): Welch for EV per $, Newcombe for bust rates.
  - **More than two strategies:** lowest against highest, with the interval widened by Bonferroni over all pairs among the strategies that placed bets; the sentence says so. Nothing is compared below 30 sessions (`MIN_COMPARE_SESSIONS`).
  - Sentences state method, sessions, difference in percentage points with its interval, and "includes / excludes zero". No p-values. Keep it that way.
  - **Report fit:** dense type now starts at THREE strategies (`DENSE_ABOVE = 2`) and chart panels are 135 / 84 px high; every count from 2 to 8 measures 854-949 px of 960.
- **Screen-reader announcements:** run and replay statuses are `role="status"` regions mounted before any text; a finished run adds a hidden summary (`runAnnouncement` in `ui/format.ts`). Keep them always mounted. Select status regions by role AND name in specs (the link banner is "Opened link").
- **Licence notices:** `scripts/licenseNotices.ts` writes `third-party-licenses.txt` into every build (footer link). A bundled package without a licence file FAILS the build; fix the dependency, never the check.
- `.claude/settings.local.json` is git-ignored here.
- **Session 21 (STATUS 176-180): v1.0 polish.** The sweep readout names a bankroll only when it AND every larger bankroll on its line pass (`lineAnswer`); non-contiguous passes say "unstable at this sample size" and name none. Results table decimals: 1 for every share of sessions, 2 for EV per $ and theory, 3 for its SE (`TABLE_PCT_DIGITS`; guide section 3 table). README top rewritten for a 30-second read.
- **Session 20 (STATUS 163-175): sweeps** (guide 3.11): each cell is a plain `runMonteCarlo` run seeded `cellSeed(base, k)` (independent cells, no CRN); caps in `share/limits.ts` enforced by `validateSweep` (inside `validateScenario`, so links drop an oversize sweep) AND `runSweep`; link key `sp`, version stays 4; the readout uses the Wilson UPPER bound. Cancel bumps a per-sweep token: a terminated worker's posted cell messages still arrive.
- **Report fonts (STATUS 173):** Arial / Liberation Sans (metric twins) so the page lays out the same on every OS. Print tests lay out at 720 px and assert width <= 720, height <= 960 BEFORE `page.pdf()`: Chromium silently shrinks a too-wide page (that hid a Linux overflow).
- **Session 19 (STATUS 155-162): report** (guide 3.10): `window.print()` of the run's snapshot; pure hedged takeaways; ONE interval display (`formatInterval`); table cells carry `data-raw`; `docs/report-sample.pdf` comes from `npm run screenshots`.
- **Session 18 (STATUS 145-154):** a new stat id goes in `STATS_ADDED_AFTER_CAPTURE` (never regenerate the Monte Carlo golden).
- **Local gotcha:** if Playwright lists far fewer than 50 tests, check for OneDrive cloud-file reparse points in the working tree (Node skips them as symlinks); see STATUS 133.

Only record in STATUS what was actually verified.

## Docs and disclosures (session 16; STATUS 134-140)

- **README:** every claim maps to a file, a log entry or a recorded run; it states scale, never speed. **Update its test counts (845 Vitest with 7 opt-in skipped, 55 Playwright in 12 spec files; top bullets AND Testing section, plus guide section 1) from `npm run test` and `npx playwright test --list` when tests are added.**
- **Privacy:** no PRIVACY.md, because nothing leaves the browser (same-origin GETs only, no cookies, one localStorage key `betting-lab.theme`, kept under its old name). Adding any network call, storage or analytics means writing a PRIVACY.md first.
- **Disclaimer:** the footer line stays; under the tagline: adults (18+), no real money, not betting advice, US National Problem Gambling Helpline **1-800-MY-RESET** (https://www.ncpgambling.org/help-treatment/, checked 2026-09-29). In the README too; `e2e/app.spec.ts` checks it.
- **Credits** in the README and `third-party-licenses.txt`; original favicon; MIT LICENSE; GitHub About set.

Only Ian can supply: real usage numbers, a personal pitch, a non-US helpline, and confirming 1-800-MY-RESET (NCPG's listed number).

## Still open

- Result allocation: the per-round `RoundResult` costs about 8% (STATUS 116); a mutable reuse weakens purity. Owner decision, not taken.
- Beyond the roadmap: three-way sports lines and parlays (each needs a spec), other de-vig methods, optional Vercel deploy (`VITE_BASE=/`).
- Oscar's Grind on multi-outcome games uses an approximation (mean winning net); the invariant still holds. Kelly always stops on a house-edge multi-outcome game (`assumedWinProb` is binary-only), by design.
- Sports mode keeps decimal prices at full precision after a format switch (field shows 2 decimals; by design).
- The address bar isn't synced while editing: a reload restores the opened LINK until Copy link is clicked again.
- Rule language gaps by design: one action per entry, no step-back, no payout-capped bet, no bankroll-proportional stake (those stay built-ins). Only Martingale x2 is proven bit-identical to its rule form.
- Planned feature work is DONE (stages 1-3 of the audit folder's `NEXT-STEPS.md`, sessions 18-20) and v1.0.0 is tagged. Further work needs a new decision.
- Sweep limits: no sweep section in the report (931 of 960 px used). Independent cells add noise between neighbours (no CRN across cells). Axes: bankroll, base bet, max rounds. The readout's whole-line rule refuses self-contradicting lines but keeps 95% per cell (no Bonferroni widening).
- Report limits: one page is tested for 2 to 8 built-ins, not for long labels or long links (big custom rules).
- Comparison limits (session 22): only the lowest-against-highest pair is reported, not every pair. Bonferroni is conservative (4.2% false "clear" measured against 5%). The worst-case-session check is conservative: it withholds an EV verdict whenever one bankroll loss would outweigh the difference, even for a strategy that truly cannot go bust. Paroli against Flat shows the cost: the t-interval alone was already at 5% there, and the check withholds every verdict in three of four regimes. It is measured on four built-ins (Flat, Martingale, Paroli, Fibonacci) on European roulette, compared two at a time; not on the other built-ins, custom rules, multi-outcome or player-edge games, or the widened lowest-against-highest comparison. The unpaired fallback has no such check. Hidden GAINS (session 26): the paired EV-difference check now stresses them too, measured on one long-shot pair only (Flat against Paroli, 1-in-1000 paying 974 to 1); "one whole-bankroll bet at the top payout" is a stress size by analogy with the bankroll loss, not a proven bound. The results table's "z vs theory" row is still a plain number (3.75 for Martingale on the seed-16 run, next to the marked EV cell); only the EV per $ cell is marked. The marker follows `fragile` only: on a player-edge game an interval above zero that one loss would pull back to zero gets the sentence's "not clearly different from zero" but no marker. P(profit) is not compared between strategies. Sweep cells are still independent runs and are not compared with each other. On the default run the paired SE is only about 15% below the unpaired one, so few real verdicts change.
- `docs/report-sample.pdf` must be regenerated from the live site after each report change (`npm run screenshots`); check STATUS for the build it came from. `v1.0.0` still points at the pre-session-22 report; a new tag is the owner's call.
- Replay zoom is x-only; hover values go to a text readout, not an on-canvas tooltip.

### Decisions for Ian from the statistical review (2026-11-16)

Recorded from `C:\devwork\portfolio-audit\REVIEW-stats.md`; no code changed for any of them. Its numbers come from reduced trial counts (free memory was under 2 GB there), seeds and logs in that file.
- **Shared random-number cycle (review finding 2).** mulberry32's state is a Weyl sequence, so every session seed is a starting position on ONE 2^32-long cycle, and sessions within maxRounds draws of each other replay shifted draws. The variance inflation is about 1 + sessions × rounds / 2^32. Measured, fixed stakes: default run 10,000 × 1,000: 1.003 (unaffected); 100,000 × 1,000: SE about 1.1% too small; 100,000 × 10,000 (`npm run bench`) and 1,000,000 × 1,000: SE about 10% too small, so a nominal 95% interval covers about 92%. Progressions not quantified; CRN pairing itself is unaffected. **Do NOT change mulberry32 without a decision:** it changes every seed's results, every shared link and every golden (rule 2). Options, least to most invasive: (a) disclose it in the guide and README ("independent sessions up to about 10^8 total rounds"); (b) cap sessions × maxRounds, e.g. at 2^32 / 50 ≈ 8.6·10^7 (inflation ≤ 1.02); (c) a larger-state per-session generator (e.g. sfc32 or xoshiro128** seeded by splitmix32 of (master, i)) as a versioned scenario change.
- **The "95%" label on rare-event intervals (finding 3).** The verdict is guarded, but the printed difference interval keeps its "95%" label. Measured coverage: Flat vs Paroli on 1-in-200 × 194, 38.50% at 200 sessions (90.40% at 1,000, 94.00% at 10,000); on 1-in-1000 × 974, 21.20% / 9.20% / 63.25% at 200 / 1,000 / 10,000. Option: when the verdict is fragile, drop "95%" or say the interval is unreliable (wording only, no statistics change).
- **Unadjusted per-strategy "one time in twenty" notes (finding 5).** Pair verdicts are Bonferroni-controlled (at least one false claim in at most about 2% of 8-strategy reports, 6.33% (SE 1.41%) at k = 2), but the clause "misses the theoretical X, which a 95% interval does by chance about one time in twenty" appeared in 24.00% (SE 1.74%) and 26.33% (SE 2.54%) of 8-strategy default reports at 200 and 1,000 sessions, and 12.67-15.67% at k = 4. Option: when k > 1, say it happens by chance in about 1 − 0.95^k of reports.
- **The fragile flag never fires below the theoretical value (finding 4).** `evClaim` only stresses a hidden loss. On the 1-in-1000 × 974 game Flat's interval sat wholly BELOW the truth in 5.90% (SE 0.75%) of 200-session runs against a nominal 2.5%, and the sentence calls it a one-in-twenty chance miss (both sides combined: 6.9%). Every above-truth Martingale run was flagged (no miss on the loss side). Also: for a strategy that cannot bust (Flat, $1,000 bankroll, $100 maximum loss), the flag fires on its ordinary 2-3% chance misses and names a loss it cannot suffer: harmless, but the stated mechanism is wrong there. Option: a mirror (hidden-gain) check in `evClaim`, which needs new wording in `ui/format.ts` and the tables: a product decision.
