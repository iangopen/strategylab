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
    runner.ts         runSession, table rules
    montecarlo.ts     runMonteCarlo, CRN seeding, sample paths
    strategies/
      types.ts        Strategy, FieldSpec
      registry.ts     the ONE place strategies are registered
      flat.ts         reference implementation
    stats/
      types.ts        StatDef
      accumulator.ts  single-pass accumulator
      registry.ts     the ONE place stats are registered
  worker/
    sim.worker.ts     Comlink-exposed runMonteCarlo
    client.ts         worker lifecycle, progress, cancel
  ui/
    ConfigPanel.tsx
    StrategyPicker.tsx
    SchemaForm.tsx    renders any configSchema
    RunControls.tsx
    ResultsTable.tsx  renders any stats registry
    ChartSlot.tsx     reserved chart panels
  scenario.ts         ScenarioConfig type, defaults, validation
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

_Nothing yet. Session 1 fills this in._

### Built but not yet verified

_Nothing yet._

### Still open

- Everything in the roadmap.

### Decisions made outside the spec

_Record any choice the session prompt didn't specify, with the reason, so later sessions don't undo it by accident._
