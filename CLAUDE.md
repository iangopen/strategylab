# CLAUDE.md — Betting Lab (working name)

Read this file in full at the start of every session. It is the source of truth for what this project is, the rules it must never break, and what is actually done. If code and this file disagree, stop and flag it. Do not silently pick one.

---

## Product

Betting Lab is a Monte Carlo lab for betting strategies. Users configure a game, a bankroll scenario, and one or more strategies (Martingale, Fibonacci, etc.), run thousands of simulated sessions, and compare outcome distributions side by side.

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

- Vite + React + TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`)
- Vitest for tests, colocated as `*.test.ts`
- Web Worker via Comlink for all simulation
- No chart library yet (the charts session evaluates uPlot vs. raw canvas)
- No Supabase, no backend, no CSS framework
- OS: Windows / PowerShell. Every command run or documented here must work in PowerShell (use `;` not `&&` on Windows PowerShell 5, no `rm -rf`, no bash-only syntax).
- GitHub: `iangopenbusinessai-lab/strategylab` (private). Product display name stays "Betting Lab (working name)". gh CLI is authenticated.
- Deploy: Vercel auto-deploys on push to `main`. Never run the Vercel CLI.
- **Background dev/preview servers:** stopping the task that ran `npx vite preview` (or `vite`) can leave vite's `node` child alive and holding the port. Before starting a server, check the port; stop a leftover only after confirming its command line is our own `vite ... --port <n>`.
- **Never create files with `echo > file` in PowerShell.** Windows PowerShell 5 writes UTF-16 LE, which git treats as binary (this happened to the first `README.md`). Use the editor/file tools, or `Set-Content -Encoding utf8`.

### Commands

```powershell
npm run dev     # local dev server
npm run test    # Vitest, must be clean before any commit
npm run build   # strict type check + production build, must be clean before any push
```

---

## Absolute rules

These are not negotiable. A change that breaks one of them is wrong even if every test passes.

1. **Engine isolation.** `src/engine/` imports NOTHING from React or the DOM. It must run identically in a test, the main thread, or a worker. Reason: tests and worker must exercise the same code.

2. **Seeded randomness only.** All randomness goes through `src/engine/rng.ts` (mulberry32). `Math.random` is BANNED in `src/engine/`. Reason: reproducibility and shareable seeds.

3. **Common random numbers.** Session i's seed = `splitmix32(masterSeed ^ splitmix32(i))`. NEVER `masterSeed + i` (adjacent mulberry32 seeds are correlated). Each round consumes EXACTLY ONE uniform draw to resolve win/loss. Strategies NEVER touch the RNG. Reason: session i of every strategy sees the identical outcome sequence; this is the basis of fair comparison.

4. **Integer money.** The engine works in integer cents. Bets returned by strategies are rounded to whole cents by the runner. The UI converts at the boundary. Reason: no float drift in progressions.

5. **Game model** (`games.ts`): `interface Game { id; name; winProb; netPayout }`. `netPayout` = profit per unit staked on a win (even money = 1). Derived: `edge = 1 - winProb * (1 + netPayout)`. Presets: European roulette even-money (18/37, 1), American (18/38, 1), fair coin (0.5, 1), custom. Validate `0 < winProb < 1` and `netPayout > 0`.

6. **Strategy contract** (`strategies/types.ts`), registered in ONE place (`strategies/registry.ts`):
   ```ts
   interface Strategy<Config, State> {
     id; label; description;
     configSchema: FieldSpec[];   // drives the UI form
     defaultConfig: Config;
     init(config, ctx): State;
     nextBet(state, ctx): number | "stop";
     update(state, won: boolean, ctx): State;
   }
   ```
   `FieldSpec = { key, label, kind: "number" | "integer" | "boolean" | "select", min?, max?, step?, options?, help? }`. Strategies are PURE: no input mutation, no side effects. `ctx` is read-only (bankroll, baseBet, round, lastBet). The UI renders strategy config purely from `configSchema`. A new strategy = one file + one registry line, zero UI edits.

7. **Table rules live in the runner**, never in strategies. Raise the bet to tableMin, clamp it to tableMax. If bet > bankroll, apply `insufficientFunds: "stop"` (default) | `"allIn"`. `endReason` is one of: `"ruin"` (bankroll < tableMin), `"insufficientFunds"` (could not cover the next bet), `"stopWin"`, `"stopLoss"`, `"maxRounds"`, `"strategyStop"`. `maxRounds` is REQUIRED and finite (default 1000, hard cap 1,000,000). Reason: bounded runtime and defined checkpoints.

8. **runSession(game, strategy, config, seed, opts)** returns finalBankroll, rounds, totalWagered, peak, maxDrawdown, longestLosingStreak, endReason, and path only if `opts.recordPath`.

9. **Stats are a plug-in layer** (`src/engine/stats/`). A stat is `{ id; label; format: "money" | "pct" | "ratio" | "int"; emphasis?: boolean; compute(acc: Accumulator, ctx: RunContext): number }`, where `RunContext` is read-only `{ game, edge, config, nSessions }` (session 3). The Accumulator is built in a single pass per strategy and holds running sums (final, wagered, rounds, sums of squares for SE), endReason counts, and one `Float64Array` per strategy for EACH per-session column: final bankroll, max drawdown, longest losing streak (session 3). These columns NEVER leave the worker; only derived outputs cross, typed arrays via `Comlink.transfer`. Every percentile goes through ONE function, `quantileSorted` (type 7) in `stats/quantile.ts`, on a sorted copy made once per column (`sortedColumn`). NEVER retain full paths for all sessions. Stats are registered in `stats/registry.ts`, and the results table renders purely from that registry.

10. **runMonteCarlo(game, strategies[], config, nSessions, masterSeed, onProgress)** runs every strategy over the SAME session seeds and returns per strategy: stat values, raw endReason counts, the first 50 session paths (streaming min/max downsampled), final-bankroll histogram counts over ONE set of 50 bins shared by every strategy in the run, and p5/p25/p50/p75/p95 percentile bands at round 0 + up to 200 checkpoints, from the first min(2000, n) sessions (the same indices for every strategy). Band and sample-path sessions are observed through the runner's optional per-round `observer`; every other session pays only a branch check. Memory per observed session is independent of maxRounds.

11. **Worker.** `src/worker/sim.worker.ts` exposes runMonteCarlo via Comlink. The progress callback is passed with `Comlink.proxy` and reported about every 2%. Cancel = `worker.terminate()`, then respawn (Comlink cannot interrupt a sync loop). The UI NEVER runs a simulation on the main thread. `client.ts` owns the worker lifecycle.

### Also non-negotiable

- **All scenario state lives in one serializable `ScenarioConfig`** (`src/scenario.ts`, plain JSON). No scenario state hidden in component-local state. Reason: URL sharing must stay trivial.
- **Statistical tests use standard-error tolerances**, never hand-picked constants. Tolerance = 4 × SE computed in the test from the samples, and the test prints the SE. Fixed seeds keep them deterministic; SE-based bounds keep them honest. Do NOT increase nSessions or loosen tolerances just to make a test pass. If an invariant test fails, the engine is presumed wrong until proven otherwise.

---

## Folder map

```
src/
  engine/
    rng.ts            mulberry32 + splitmix32
    games.ts          Game type, presets, edge, validation
    types.ts          shared engine types (SessionResult, EndReason, ...)
    runner.ts         runSession, runSessionWithRng (injected RNG for tests), table rules, round observer
    montecarlo.ts     runMonteCarlo, CRN seeding, sample paths, histogram, bands, resultTransferables
    downsample.ts     streaming min/max sample-path downsampler (<= 1000 points)
    perf.bench.test.ts opt-in benchmark (BENCH=1): session 2 timing scenario + observer cost
    testUtils.ts      test-only helpers (scripted/counting RNG, sample-based SE)
    isolation.test.ts guards rules 1-2 (no Math.random / React / DOM in engine)
    strategies/
      types.ts        Strategy, FieldSpec
      registry.ts     the ONE place strategies are registered
      flat.ts         reference implementation
      validate.ts     checks a config against its configSchema
      crn.test.ts     CRN across every registered strategy
      customGame.test.ts  every strategy on p = 0.45, payout 1.2, via the registered z stat
    stats/
      types.ts        StatDef, RunContext
      accumulator.ts  single-pass accumulator, per-session columns, sortedColumn (sort once)
      quantile.ts     THE percentile function (type 7) + sortedCopy
      histogram.ts    shared-bin histogram (50 bins over [min, max] across all strategies)
      bands.ts        checkpoint rounds + BandRecorder (percentile bands over time)
      registry.ts     the ONE place stats are registered (row order = table order)
  worker/
    sim.worker.ts     Comlink-exposed runMonteCarlo
    client.ts         worker lifecycle, progress, cancel
  ui/
    ConfigPanel.tsx   game, bankroll, table, stops, rounds, sessions, seed
    NumberField.tsx   numeric input with inline errors
    format.ts         stat formatting, strategy column labels
    StrategyPicker.tsx
    SchemaForm.tsx    renders any configSchema
    RunControls.tsx
    ResultsTable.tsx  renders any stats registry
    ChartSlot.tsx     reserved chart panels
  scenario.ts         ScenarioConfig type, defaults, validation, toSimRequest (dollars -> cents)
  App.tsx             owns the ScenarioConfig and the SimClient
```

---

## How to add a strategy

1. Create `src/engine/strategies/<id>.ts` exporting one `Strategy<Config, State>`.
2. Define `Config`, `State`, `defaultConfig`, and a `configSchema` covering every config key. Give each field sensible min/max bounds.
3. Implement `init`, `nextBet`, `update` as pure functions. Return new state objects; never mutate. Do not clamp to table limits or bankroll; the runner does that.
4. Add one line to `strategies/registry.ts`.
5. Write `<id>.test.ts` (see "Strategy test kit" below) covering:
   - the progression over a hand-written win/loss sequence (`betSequence`, assert the exact bet sequence in cents)
   - reset behavior, caps and floors
   - purity (`expectPure`)
   - the invariant (`describeEvInvariant(strategy, config)`): EV per $ wagered within 4 SE of `-edge` on European roulette, and within 4 SE of 0 on a fair coin, with stop conditions ON
   - then add the id to the expected list in `strategies/crn.test.ts`
6. Run the app and confirm the strategy appears in the picker with a working config form and no UI edits.
7. Update STATUS.

### Strategy specs

Every progression keeps its own level in State and computes the next bet from it. NEVER derive the next bet from `ctx.lastBet`: that is the bet AFTER table limits, so a tableMax clamp would silently rewrite the progression. Table limits are the runner's job alone (rule 7). Config values a strategy needs are copied into State at `init` (`nextBet` receives no config).

- **Martingale** (`martingale.ts`): bet = base × multiplier^level. Loss: level + 1. Win: level = 0. Config `multiplier` number, default 2, 1.1–10.
- **Paroli** (`paroli.ts`): bet = base × 2^wins. Win: wins + 1, and when wins reaches streakCap it resets to 0. Loss: wins = 0. Largest bet = base × 2^(streakCap − 1). Config `streakCap` integer, default 3, 1–10 (1 = flat).
- **D'Alembert** (`dalembert.ts`): bet = base + units × unitSize × base. Loss: units + 1. Win: units − 1, floor 0. Config `unitSize` number (multiple of base), default 1, 0.1–10.
- **Fibonacci** (`fibonacci.ts`): bet = base × fib(step), fib(0) = fib(1) = 1. Loss: step + 1. Win: step − 2, floor 0. No config (empty `configSchema`).
- **Overflow guard:** Martingale and Fibonacci cap the *returned* bet at `Number.MAX_SAFE_INTEGER` (the level keeps climbing), because the runner rejects non-finite bets and a long enough streak would overflow to Infinity. The runner still clamps and checks bankroll as usual.
- **Labouchere, Oscar's Grind, Kelly:** spec to be written at the start of their session and added here before coding.

### Strategy test kit (`src/engine/testUtils.ts`)

- `betSequence(strategy, config, script)`: feeds a W/L script straight to init/nextBet/update (no runner) and returns every requested bet, so tests assert the exact sequence in cents.
- `expectPure(strategy, config)`: deep-frozen config, state and ctx, plus before/after snapshots (`testUtils.test.ts` proves it rejects a mutating strategy).
- `describeEvInvariant(strategy, config)`: THE fixed invariant scenario, shared by every strategy: $1,000 bankroll, $5 base, table $1–$250, stopWin $1,500, stopLoss floor $500, maxRounds 1000, insufficientFunds "stop", 20,000 sessions, European (seed 101) and fair coin (seed 202). Asserts |EV − (−edge)| < 4 SE and prints measured, expected, SE and z. Do not change this scenario to rescue a strategy.
- `crn.test.ts`: one `runMonteCarlo` over every registered strategy; for all 50 sample sessions, every strategy pair sees the identical W/L sequence over the rounds they both played. When you register a strategy, add its id to the expected list there.

## How to add a stat

1. If the stat needs data the Accumulator doesn't collect yet, extend `accumulator.ts` (single pass, no path retention; a new per-session column is one `Float64Array` plus a `ColumnKey`) and add a test for the new field.
2. Add a `StatDef` with `compute(acc, ctx)` in `stats/` and one line to `stats/registry.ts`, **at the right position**: the table renders registry order. Use `ctx` (game, edge, config, nSessions) instead of re-deriving run facts. Any percentile MUST be `quantileSorted(sortedColumn(acc, key), p)`. Never sort a column yourself. Return NaN for "undefined" (the UI shows a dash).
3. Test `compute` against a hand-built accumulator with a known answer (`testCtx(...)` in `testUtils.ts` builds the ctx). Update the row-order test in `stats.test.ts`.
4. Confirm it appears in the results table with no UI edits.
5. Update STATUS.

---

## Roadmap

Sessions run in this order. Each ends with `npm run test` and `npm run build` clean, a push, and a STATUS update.

1. **Infrastructure (session 1):** scaffold, repo, rng/games/runner, flat reference strategy, stats plug-in layer with starter stats, montecarlo, worker with progress and cancel, schema-driven UI shell, this file.
2. **Strategy archetypes:** Martingale, Paroli, D'Alembert, Fibonacci, each with progression tests and the per-strategy invariant test. Martingale analytic check: with bankroll B, base b, multiplier m, no tableMax, and stopWin = start + b (one cycle), P(bust) matches (1−p)^k within 4 SE, where k is the largest integer with b(m^k − 1)/(m − 1) ≤ B. Table-max check: with tableMax set, the capped bet is asserted and one-cycle recovery visibly fails.
3. **Statistics:** p5/p25/p75/p95 final bankroll, P(profit > 0), P(bust) = ruin + insufficientFunds, P(hit stopWin), max drawdown and longest losing streak summaries, SE shown for EV per $, final-bankroll histogram, percentile bands over time (subset of ≤2000 sessions, ≤200 checkpoints, early-ending sessions carry their final bankroll forward). P(profit > 0) sits next to EV per $ because that contrast is the lesson.
4. **Charts:** evaluate uPlot vs. canvas; sample-path spaghetti + percentile bands, final-bankroll histogram, single-session replay. Sample-path downsampling must preserve extrema and the final point (e.g. min/max per bucket), never plain stride; stride hides the bust. (Done in session 3 in `downsample.ts`. All chart data is now produced; session 4 only renders it.)
5. **More strategies:** Labouchere, Oscar's Grind, Kelly.
6. **JSON rule builder:** user-defined strategies compiled into the same Strategy contract.
7. **URL-serialized scenarios:** encode ScenarioConfig in the URL.
8. **Sports-odds mode:** American/decimal odds input, vig, derived winProb and netPayout.

---

## STATUS

Only record what was actually verified, and how. "Written" is not "verified."

### Real and verified

Session 1 (2026-09-22). Automated checks: `npm run test` (68 tests) and `npm run build` both clean under strict.

1. **Determinism:** same masterSeed gives deep-equal and JSON-identical `runMonteCarlo` output; a different seed differs (`montecarlo.test.ts`). The same holds at session level (`runner.test.ts`).
2. **Common random numbers:** across 300 sessions, a test-only flat-2× fixture and flat see identical win/loss sequences over their overlapping rounds, and the fixture busts earlier in some of them, so the overlap case is exercised. Two identical strategy instances in one run give identical outcomes.
3. **EV per $ wagered (flat):** European roulette, 2,000,000 rounds, no stops: −0.026893 vs −0.027027, SE 0.000699 (z = 0.19). Fair coin: −0.000520 vs 0, SE 0.000694 (z = −0.75). With stops ON (20k sessions): European z = −1.40, coin z = −0.06. The tolerance is 4 × SE computed from the samples, and the SE is printed.
4. **Runner rules:** tableMin raise, tableMax clamp, rounding to cents, insufficientFunds stop vs allIn, fractional-payout rounding, every endReason, stopWin/stopLoss boundaries exact to the cent, and stop/ruin-before-maxRounds priority.
5. **No draw on pre-resolution endings:** a scripted counting RNG shows draws === rounds for stopWin, stopLoss, ruin, strategyStop, insufficientFunds, and maxRounds. The same holds across 2,400 random seeded sessions.
6. **Stats plug-in:** a throwaway StatDef appears in `runMonteCarlo` output with no other code changes. Every registered stat was checked against a hand-built accumulator. `evPerWageredSE` from running sums matches the sample SE.
7. **Memory (test 6):** 100k sessions × 1000 rounds ran in 1.7s under Vitest with an explicit 180s timeout. Heap delta was 1.1 MB, and 50,050 path points were retained (50 paths).
8. **Engine isolation:** a test asserts no `Math.random`, React, or DOM globals in `src/engine/`.
9. **Manual browser check** (Chrome via Claude-in-Chrome, `npm run dev`). Settings: 100,000 sessions, maxRounds 10,000, bankroll $100,000, flat. At the default 1,000 rounds a run finishes in ~2s, too fast to interact with.
   - Run 1: typed "25" into Base bet at ~3s. The input updated immediately, and progress advanced in 2% steps (0.02 … 0.26). Clicked Cancel at 28%. Status showed "Cancelled", and Run re-enabled.
   - Run 2 (right after the cancel): typed "10" into Base bet mid-run and it updated. A `longtask` PerformanceObserver recorded **zero** main-thread tasks over 50 ms for the whole run. It completed "100,000 sessions in 75.7s" with EV per $ −2.70%, mean wagered $250,000 (the $25 snapshot × 10,000 rounds), and the table flagged as stale because Base bet changed after the click. No console errors.
   - Caveat: the automated tab reported `visibilityState: hidden`, so a setInterval monitor saw ~1s timer throttling. That is why the longtask observer, not timer gaps, is the evidence for "no freeze". Not yet checked by a human in a focused, visible tab.

Session 2 (2026-09-22). `npm run test` (122 tests) and `npm run build` clean under strict. Martingale, Paroli, D'Alembert and Fibonacci were each added as one strategy file plus registry lines. `git diff 31f6e87..HEAD -- src/engine/runner.ts src/engine/montecarlo.ts src/ui/` is empty: no pipeline or UI edits were needed.

10. **Exact sequences** (no runner) assert every bet in cents. Martingale: ×2, ×3, ×1.5 (fractional cents left to the runner), overflow guard. Paroli: reset at cap 3, reset on loss, caps 1, 2 and 10. D'Alembert: floor at base, unitSize 0.5 and 2. Fibonacci: fib values, two-step retreat, floor, overflow guard.
11. **Purity:** every strategy passes `expectPure`, and a mutating fixture is shown to fail it.
12. **EV invariant, shared scenario, stops ON** (4 SE, SE from samples):

    | Strategy | European z | Fair coin z |
    |---|---|---|
    | flat | −0.35 | −0.40 |
    | martingale ×2 | 0.02 | 0.56 |
    | paroli cap 3 | −0.67 | −0.65 |
    | d'alembert 1 | 0.23 | −0.31 |
    | fibonacci | 0.05 | −1.13 |

13. **Martingale analytic one-cycle bust** (20,000 sessions each, P(insufficientFunds) vs (1−p)^k, every other session ends in stopWin):

    | Game | B, b | k | Expected | Measured | z |
    |---|---|---|---|---|---|
    | European | $1,000, $10 | 6 | 0.01834 | 0.01940 | 1.09 |
    | European | $500, $1 | 8 | 0.00484 | 0.00540 | 1.09 |
    | American | $1,000, $10 | 6 | 0.02126 | 0.02195 | 0.67 |
    | American | $500, $1 | 8 | 0.00589 | 0.00610 | 0.38 |

    All four use master seed 31337, so they share draws and are correlated, not independent confirmations.
14. **Table max breaks recovery:** Martingale with base $1 and tableMax $8 over script L×6 then W. Placed bets were 1, 2, 4, 8, 8, 8, 8 dollars while the strategy asked for up to $64. The one win leaves the session at −$23.
15. **CRN across real strategies:** in one `runMonteCarlo` with all five strategies, all 50 sample sessions show identical W/L sequences for every strategy pair over their overlapping rounds (141,138 pairwise rounds; all 50 sessions had different lengths across strategies).
16. **Manual, Chrome, `npm run build` + `npm run preview`:** the production bundle `index-Dme2EcaJ.js` was served.
    - All five strategies appeared in the picker with no UI edits. Added Martingale, Paroli, D'Alembert, Fibonacci, a second Martingale and a second Flat. Removed Flat #2, and the remaining card relabelled to "Flat".
    - Every card's fields, help text and ranges matched its `configSchema`. Fibonacci rendered no fields.
    - Bad input showed inline errors: Paroli 2.5 gave "Enter a whole number.", Martingale 0.5 gave "Must be at least 1.1." Run was disabled with "Fix the highlighted fields to run." After fixing (Martingale #2 = 3) the errors cleared.
    - Six instances, European, default scenario, 100k sessions: done in 58.3s with zero main-thread long tasks. EV per $: flat −2.71%, Martingale×2 −2.67%, Paroli −2.71%, D'Alembert −2.70%, Fibonacci −2.71%, Martingale×3 −2.51%.
    - The same run reproduced in Node gave identical results to the cent. The Martingale×3 SE is 0.16% (z = 1.17), and all six |z| < 1.2.
    - Custom game p = 0.45, payout 1.2: displayed "House edge: 1.000%", matching 1 − 0.45 × 2.2 exactly. A 20k-session run gave EV per $ −0.94% to −1.19% across columns. That is plausible, but no SE was shown or checked.
    - Session 1's exact run (flat, $100k, $25 base, 10,000 rounds, 100k sessions, seed 12345) took **89.3s on preview vs 75.7s on dev in session 1**, with identical results ($93,257.60 mean final). No console errors.
    - **Caveat:** the automation tab reported `visibilityState: hidden` and `hasFocus() = false` the whole time, in both sessions. The requested focused-tab condition was NOT met, and the timing comparison is inconclusive (hidden and deprioritized in both).

Session 3 (2026-09-23). `npm run test` (168 passed, 2 benchmark tests skipped) and `npm run build` clean under strict.

17. **quantile (type 7)** matches hand-computed values on odd, even, single-element and tied inputs, and on p = 0 and 1. My first hand value for the tied case was wrong (5.6); the correct value is 6.2, matching numpy.
18. **Every new stat** was tested against a hand-built 5-session accumulator: EV, SE (vs the sample-based SE), theory, z, and P(profit), which is strict (a session ending at exactly start is not counted). Also P(bust), P(hit win target) (and "—" when off), final p5/p25/median/p75/p95/mean, mean and p95 drawdown, mean and max streak, volume, and end reasons. A test locks the exact row order.
19. **Histogram:** the edges equal the global min and max final bankroll across all 5 strategies (checked with throwaway plug-in min/max stats). There are 51 strictly increasing edges, counts sum to n for every strategy, and the max lands in the last bin. Identical-values and `count` cases are unit-tested.
20. **Bands:** p5 ≤ p25 ≤ p50 ≤ p75 ≤ p95 at every checkpoint for all 5 strategies. Round 0 equals start. The last checkpoint equals the type-7 percentiles of the subset's final bankrolls, recomputed independently. The subset is capped at 2000 with n = 2500. Carry-forward was tested with a session ending at round 1, both in the unit test and in a run where every session ends at round 1.
21. **Streaming downsampler:** a 1,000,000-round synthetic path busting at round 777,777 kept 779 points (cap 1000), including the global max (round 123,457), the global min and bust round (777,777), and a lone one-round dip. A full 1M-round path keeps its final point. The downsampler is lossless at maxRounds 998.
22. **maxRounds 1,000,000 with observed sessions:** 60 sessions × 1,000,000 rounds (50 sample paths plus bands) took 1.9–2.1s with **1.5–1.7 MB** heap growth (bound 50 MB; full paths would be ≈ 960 MB).
23. **Memory test 6** (100k × 1000 with the new columns and bands): heap delta −2.1 MB after the run. GC ran and the columns are freed after `runMonteCarlo` returns, so this does not show the peak. The added peak working set by construction: 3 × 100k × 8 B = 2.4 MB per strategy for columns, plus 3.2 MB per strategy for band values until percentiles are computed.
24. **Performance** (session 2 scenario, 100k × 6 strategies, median of 3): **before 10.45s; after 9.90s and 10.72s** on two runs (run-to-run noise ≈ ±5%). That is at most +2.6%, within the +25% budget. **Observer cost:** a 1000-round flat session with band + downsampler takes 130.0 µs vs 29.4 µs plain (**×4.43**, worst case). Only ≤ 2000 sessions per strategy are observed, and only 50 carry the downsampler.
25. **CRN** holds across all 5 strategies (now on lossless maxRounds 998). The session 2 invariant table re-ran identically (every |z| ≤ 1.13), and the Martingale analytic check is unchanged.
26. **Custom game p = 0.45, payout 1.2,** all 5 strategies, shared scenario with stops on, 20,000 sessions, via the registered z stat: flat z = 0.03, martingale 0.28, paroli −0.97, d'alembert −0.08, fibonacci −0.09. All within 4 SE. This closes the session 2 open item.
27. **Transfer:** `resultTransferables` lists every typed-array buffer once. After `structuredClone(..., { transfer })` the source is detached (transferred, not copied), and a result carries no per-session arrays.
28. **Manual** (`npm run build` + `npm run preview`, bundle `index-Bx6Ihsq9.js`, tab hidden / unfocused): all five strategies, European, default scenario, 10,000 sessions, done in 3.2s. Displayed exactly:

    | Row | Flat | Martingale | Paroli | D'Alembert | Fibonacci |
    |---|---|---|---|---|---|
    | EV per $ wagered | -2.726% | -2.840% | -2.736% | -2.752% | -2.704% |
    | SE of EV per $ | 0.032% | 0.180% | 0.039% | 0.073% | 0.103% |
    | Theoretical EV per $ (−edge) | -2.703% | -2.703% | -2.703% | -2.703% | -2.703% |
    | z vs theory | -0.74 | -0.76 | -0.84 | -0.67 | -0.01 |
    | P(profit > 0) | 18.990% | 15.200% | 22.610% | 5.960% | 15.350% |
    | P(bust: ruin or couldn't cover bet) | 1.800% | 95.890% | 29.690% | 93.960% | 84.630% |
    | P(hit win target) | — | — | — | — | — |

    All 25 rows rendered in registry order. No console errors.

### Built but not yet verified

- Any run in a focused, visible tab (needs a human, about 2 minutes): is the 100k × 10,000-round flat run much faster than ~75–90s? Node does the same work in ~17s.
- Vercel deploy: not connected yet (the owner connects it in the dashboard).

### Still open

- Roadmap sessions 4 on.
- Browser vs Node speed gap (~4–5×). Measure in a focused tab before optimizing anything.
- The automation tab is always `hidden` / unfocused (sessions 1–3). In session 3 a click by element ref silently did nothing until a screenshot woke the renderer; coordinate clicks worked. A focused-tab check still needs a human.

### Decisions made outside the spec

_Record any choice the session prompt didn't specify, with the reason, so later sessions don't undo it by accident._

- **Repo is `strategylab`, not `betting-lab`.** The folder already had `origin` → `iangopenbusinessai-lab/strategylab`; the owner chose to keep it. Display name stays "Betting Lab (working name)".
- **No `echo >` in PowerShell for file creation** (writes UTF-16; see Environment). Use file tools or `Set-Content -Encoding utf8`.
- **Stop boundaries are inclusive:** stopWin fires at `bankroll >= target`, stopLoss at `bankroll <= floor`. The UI labels stopLoss as a "floor". Both boundaries are tested to the cent.
- **Runner check order each round:** stopWin → stopLoss → ruin → maxRounds → strategy ("stop") → round/tableMin/tableMax → insufficientFunds → ONE draw. Stops and ruin come before maxRounds so a session that busts or hits a target on its last allowed round is reported as that, not as maxRounds (keeps a future P(bust) honest). None of the pre-resolution checks draws; a test asserts draws === rounds for every endReason.
- **`update(state, won, ctx)` receives the post-round ctx:** bankroll after resolution, `lastBet` = the bet actually placed (after table rules). Progressions that need their own intended bet must keep it in State.
- **Win payout is `Math.round(bet * netPayout)` cents.** Exact for even money; for fractional custom payouts it introduces at most half a cent of rounding per win.
- **`runSessionWithRng`** (exported from `runner.ts`) takes an injected RNG so tests can script outcomes and count draws. Production code uses `runSession` (seeded mulberry32).
- **Sample paths are min/max downsampled, streaming** (session 3; replaced session 1's plain `pathStride`): 499 buckets over maxRounds, each keeping its min and max point; first, final, peak and trough always kept; ≤ 1000 points, stored as `{ rounds[], bankroll[] }`. Lossless while maxRounds ≤ 998 (≤ 2 rounds per bucket), which is why `crn.test.ts` uses maxRounds 998.
- **Stats list is overridable:** `runMonteCarlo(..., onProgress, { stats })` defaults to the registry. Test 5 uses this to add a throwaway stat without editing any other code. The registry itself stays a static array.
- **Accumulator stores profit-based second moments** (`sumProfitSq`, `sumWageredSq`, `sumProfitWagered`) for a delta-method SE of EV per $ (`evPerWageredSE` in `stats/registry.ts`, tested against the sample-based SE; the "SE of EV per $" row since session 3).
- **Median** is `quantileSorted(sortedColumn(acc, "finals"), 0.5)` (type 7; identical to the usual median).
- **Engine validation:** `runSession`/`runMonteCarlo` throw on invalid game/config, non-finite strategy bets, strategy configs outside their `configSchema`, `nSessions` outside 1..1,000,000, or a seed that isn't uint32.
- **Units in the UI:** dollars in `ScenarioConfig`, converted to integer cents in `toSimRequest`. stopWin/stopLoss/tableMax are absolute amounts; blank = off / no limit (`null`). `baseBet` is passed in ctx; flat bets `baseBet × units`.
- **Number inputs keep a local text draft** (`NumberField`) only while typing; every parseable value is committed to `ScenarioConfig` immediately. Unparseable text shows an inline error and is not committed.
- **Config stays editable during a run.** Results are snapshotted with the scenario that produced them and flagged "configuration has changed since this run" when stale.
- **Worker requests reference strategies by registry id** (`SimRequest`), since functions can't cross the worker boundary.
- **Engine isolation is enforced by a test** (`isolation.test.ts`): no `Math.random`, React, or DOM globals in `src/engine/` (comments ignored).
- **Session 2: progressions keep their level in State,** never derived from `ctx.lastBet` (owner directive). Tested: under a tableMax clamp the strategy keeps asking for the uncapped bet.
- **Session 2: overflow guard** (owner-approved): Martingale and Fibonacci return `min(bet, Number.MAX_SAFE_INTEGER)`. This is not a table rule; it stops a long streak from producing Infinity, which the runner rejects.
- **Session 2: "one registry line" is really an import line plus an array entry** in `strategies/registry.ts`. No other file changes are needed to add a strategy (verified by the empty diff above).
- **Session 2: Fibonacci has no config** and an empty `configSchema`. `Record<string, never>` is its Config type. The UI renders the card with its description only.
- **Session 2: D'Alembert `unitSize` is a multiple of base** (bet = base + units × unitSize × base), so it scales with the base bet like the other strategies.
- **Session 2: the invariant scenario sets tableMax $250,** so Martingale's ladder ($5 → $320) is clamped inside the invariant test. The invariant holds under a clamp.
- **Session 2: the Martingale analytic pairs were chosen so money is left over after k losses** ($370 and $245). If the leftover were exactly 0, the session would end in ruin (bankroll < tableMin) instead of insufficientFunds.
- **Session 2: shared test kit in `testUtils.ts`** (`betSequence`, `expectPure`, `describeEvInvariant`, `deltasFromPath`). It imports vitest, so it is test-only. Production code never imports `testUtils`.
- **Session 3: the owner rejected full-path recording** for bands and samples (2000 full paths at maxRounds 1,000,000 ≈ 16 GB). Instead the runner takes an optional per-round `observer(round, bankroll)`, called at round 0 and after every resolved round, passed ONLY for band-subset sessions. `recordPath` (full path) remains for tests and future single-session replay; `pathStride` is gone.
- **Session 3: bands include round 0** (the starting bankroll) as checkpoint 0 (owner decision), then C = min(200, maxRounds) rounds at round(j × maxRounds / C), ending at maxRounds.
- **Session 3: P(hit win target) is NaN ("—") when stopWin is off**, not 0%.
- **Session 3: z vs theory is NaN ("—") when the SE is 0 or undefined.**
- **Session 3: histogram with identical values everywhere** widens the range to [min − 1¢, max + 1¢]. Bins are [e_i, e_{i+1}), and the last bin includes max.
- **Session 3: sample paths stay `number[]`**; histogram counts (`Uint32Array`), edges, and bands (`Float64Array`) are transferred with `Comlink.transfer` (`resultTransferables`).
- **Session 3: percentages display with 3 decimals** (owner-approved; `src/ui/format.ts`) so the SE row is readable (0.032%, not 0.03%).
- **Session 3: `testCtx` lives in `testUtils.ts`**; tests never import from other test files.
- **Session 3: `perf.bench.test.ts` is committed and skipped unless `BENCH=1`**, so later sessions can re-measure against the same scenario.
- **Scaffold:** `create-vite` (react-ts) was run into a scratch folder outside the repo, copied in, and the scratch folder deleted; nothing from it is committed except the copied config files.
