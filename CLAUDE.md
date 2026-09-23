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

9. **Stats are a plug-in layer** (`src/engine/stats/`). A stat is `{ id; label; format: "money" | "pct" | "ratio" | "int"; emphasis?: boolean; compute(acc: Accumulator): number }`. The Accumulator is built in a single pass per strategy and holds running sums (final, wagered, rounds, sums of squares for SE), endReason counts, and ONE `Float64Array` of final bankrolls per strategy. NEVER retain full paths for all sessions. Stats are registered in `stats/registry.ts`, and the results table renders purely from that registry.

10. **runMonteCarlo(game, strategies[], config, nSessions, masterSeed, onProgress)** runs every strategy over the SAME session seeds and returns per strategy: stat values, raw endReason counts, and the first 50 session paths. Percentile bands and histograms plug in at the marked extension point.

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
    runner.ts         runSession, runSessionWithRng (injected RNG for tests), table rules
    montecarlo.ts     runMonteCarlo, CRN seeding, sample paths, EXTENSION POINT for bands
    testUtils.ts      test-only helpers (scripted/counting RNG, sample-based SE)
    isolation.test.ts guards rules 1-2 (no Math.random / React / DOM in engine)
    strategies/
      types.ts        Strategy, FieldSpec
      registry.ts     the ONE place strategies are registered
      flat.ts         reference implementation
      validate.ts     checks a config against its configSchema
    stats/
      types.ts        StatDef
      accumulator.ts  single-pass accumulator
      registry.ts     the ONE place stats are registered
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
5. Write `<id>.test.ts` covering:
   - the progression over a hand-written win/loss sequence (assert the exact bet sequence)
   - reset behavior and any caps
   - purity (inputs unchanged after calls)
   - the invariant: EV per $ wagered within 4 SE of `-edge` on European roulette, and within 4 SE of 0 on a fair coin, with stop conditions ON
6. Run the app and confirm the strategy appears in the picker with a working config form and no UI edits.
7. Update STATUS.

### Strategy specs (for the strategies session)

- **Martingale:** on loss, bet × multiplier (default 2); on win, reset to base.
- **Paroli / reverse Martingale:** on win, bet × 2 up to streakCap wins (default 3), then reset to base; on any loss, reset to base.
- **D'Alembert:** on loss, +1 unit; on win, −1 unit; never below base bet.
- **Fibonacci:** on loss, advance one step; on win, move back 2 steps (floor at step 0); bet = base × fib(step).
- **Labouchere, Oscar's Grind, Kelly:** spec to be written at the start of their session and added here before coding.

## How to add a stat

1. If the stat needs data the Accumulator doesn't collect yet, extend `accumulator.ts` (single pass, no path retention) and add a test for the new field.
2. Add a `StatDef` in `stats/` and one line to `stats/registry.ts`.
3. Test `compute` against a hand-built accumulator with a known answer.
4. Confirm it appears in the results table with no UI edits.
5. Update STATUS.

---

## Roadmap

Sessions run in this order. Each ends with `npm run test` and `npm run build` clean, a push, and a STATUS update.

1. **Infrastructure (session 1):** scaffold, repo, rng/games/runner, flat reference strategy, stats plug-in layer with starter stats, montecarlo, worker with progress and cancel, schema-driven UI shell, this file.
2. **Strategy archetypes:** Martingale, Paroli, D'Alembert, Fibonacci, each with progression tests and the per-strategy invariant test. Martingale analytic check: with bankroll B, base b, multiplier m, no tableMax, and stopWin = start + b (one cycle), P(bust) matches (1−p)^k within 4 SE, where k is the largest integer with b(m^k − 1)/(m − 1) ≤ B. Table-max check: with tableMax set, the capped bet is asserted and one-cycle recovery visibly fails.
3. **Statistics:** p5/p25/p75/p95 final bankroll, P(profit > 0), P(bust) = ruin + insufficientFunds, P(hit stopWin), max drawdown and longest losing streak summaries, SE shown for EV per $, final-bankroll histogram, percentile bands over time (subset of ≤2000 sessions, ≤200 checkpoints, early-ending sessions carry their final bankroll forward). P(profit > 0) sits next to EV per $ because that contrast is the lesson.
4. **Charts:** evaluate uPlot vs. canvas; sample-path spaghetti + percentile bands, final-bankroll histogram, single-session replay.
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

### Built but not yet verified

- Custom-game inputs, table-max and stop fields, and adding or removing a second strategy in the browser. These were covered by unit tests of `validateScenario` and `toSimRequest`, not clicked through.
- Vercel deploy: not connected yet (the owner connects it in the dashboard).

### Still open

- Everything in the roadmap from session 2 on.
- The browser run is ~4× slower than Node for the same work (75.7s for 1e9 rounds vs ~17s projected). This may be the dev build or the hidden-tab state. Worth measuring in a production build during the charts session.

### Decisions made outside the spec

_Record any choice the session prompt didn't specify, with the reason, so later sessions don't undo it by accident._

- **Repo is `strategylab`, not `betting-lab`.** The folder already had `origin` → `iangopenbusinessai-lab/strategylab`; the owner chose to keep it. Display name stays "Betting Lab (working name)".
- **No `echo >` in PowerShell for file creation** (writes UTF-16; see Environment). Use file tools or `Set-Content -Encoding utf8`.
- **Stop boundaries are inclusive:** stopWin fires at `bankroll >= target`, stopLoss at `bankroll <= floor`. The UI labels stopLoss as a "floor". Both boundaries are tested to the cent.
- **Runner check order each round:** stopWin → stopLoss → ruin → maxRounds → strategy ("stop") → round/tableMin/tableMax → insufficientFunds → ONE draw. Stops and ruin come before maxRounds so a session that busts or hits a target on its last allowed round is reported as that, not as maxRounds (keeps a future P(bust) honest). None of the pre-resolution checks draws; a test asserts draws === rounds for every endReason.
- **`update(state, won, ctx)` receives the post-round ctx:** bankroll after resolution, `lastBet` = the bet actually placed (after table rules). Progressions that need their own intended bet must keep it in State.
- **Win payout is `Math.round(bet * netPayout)` cents.** Exact for even money; for fractional custom payouts it introduces at most half a cent of rounding per win.
- **`runSessionWithRng`** (exported from `runner.ts`) takes an injected RNG so tests can script outcomes and count draws. Production code uses `runSession` (seeded mulberry32).
- **Sample paths are strided** so each has at most ~1000 points (`pathStride = ceil(maxRounds / 1000)`), stored as `{ rounds[], bankroll[] }`. Reason: 50 full paths at maxRounds = 1,000,000 would be ~400 MB.
- **Stats list is overridable:** `runMonteCarlo(..., onProgress, { stats })` defaults to the registry. Test 5 uses this to add a throwaway stat without editing any other code. The registry itself stays a static array.
- **Accumulator stores profit-based second moments** (`sumProfitSq`, `sumWageredSq`, `sumProfitWagered`) for a delta-method SE of EV per $ (`evPerWageredSE` in `stats/registry.ts`, tested against the sample-based SE; not yet a table row).
- **Median** sorts a copy of the `Float64Array` once at the end.
- **Engine validation:** `runSession`/`runMonteCarlo` throw on invalid game/config, non-finite strategy bets, strategy configs outside their `configSchema`, `nSessions` outside 1..1,000,000, or a seed that isn't uint32.
- **Units in the UI:** dollars in `ScenarioConfig`, converted to integer cents in `toSimRequest`. stopWin/stopLoss/tableMax are absolute amounts; blank = off / no limit (`null`). `baseBet` is passed in ctx; flat bets `baseBet × units`.
- **Number inputs keep a local text draft** (`NumberField`) only while typing; every parseable value is committed to `ScenarioConfig` immediately. Unparseable text shows an inline error and is not committed.
- **Config stays editable during a run.** Results are snapshotted with the scenario that produced them and flagged "configuration has changed since this run" when stale.
- **Worker requests reference strategies by registry id** (`SimRequest`), since functions can't cross the worker boundary.
- **Engine isolation is enforced by a test** (`isolation.test.ts`): no `Math.random`, React, or DOM globals in `src/engine/` (comments ignored).
- **Scaffold:** `create-vite` (react-ts) was run into a scratch folder outside the repo, copied in, and the scratch folder deleted; nothing from it is committed except the copied config files.
