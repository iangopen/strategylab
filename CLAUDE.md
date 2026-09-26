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

- Vite + React + TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`)
- Vitest for tests, colocated as `*.test.ts`
- Playwright (Chromium only) for E2E, in `e2e/*.spec.ts`, against the PRODUCTION build served under `/strategylab/` (session 9)
- Web Worker via Comlink for all simulation
- Charts: raw Canvas 2D, no chart library (session 4 spike decision, see Decisions)
- No Supabase, no backend, no CSS framework
- OS: Windows / PowerShell. Every command run or documented here must work in PowerShell (use `;` not `&&` on Windows PowerShell 5, no `rm -rf`, no bash-only syntax).
- GitHub: **`iangopen/strategylab`** (the account was renamed during session 10; `origin` points at `https://github.com/iangopen/strategylab.git` since session 11). GitHub redirects the old repo and git URLs, but NOT the old Pages address. **Public**, intentionally, since session 9. Product name: **StrategyLab**, subtitle "A Monte Carlo simulator for betting strategies." (session 14; it was "Betting Lab (working name)"). Used in the README, `<title>`, `og:title`, the repo description and the app header. **License: MIT** (`LICENSE`, © 2026 Ian Gopen). gh CLI is authenticated.
- **Deploy: GitHub Pages via Actions, after CI passes.** Live at **https://iangopen.github.io/strategylab/**. **Links made with the pre-rename Pages address are permanently broken:** GitHub Pages does not redirect after an account rename, so they return 404 forever. Re-share such links with the new address (the `#s=` fragment is unchanged).
  - `.github/workflows/ci.yml` runs lint, unit, build and E2E on every push and pull request.
  - Only a push to `main` that passes ALL four builds the Pages artifact (`npm run build:pages`) and deploys it (`actions/upload-pages-artifact` + `actions/deploy-pages`). The deploy job has exactly `pages: write` + `id-token: write`.
  - A failing test never deploys. The Pages source is "GitHub Actions" (`build_type: workflow`).
- **Base path:** `vite.config.ts` reads `VITE_BASE` (default `/`; it must start and end with `/`). The Pages build and E2E use `/strategylab/`.
  - Never hardcode a base path in app code. Assets and the worker resolve via `new URL(..., import.meta.url)`. Share links are built from `location.origin + location.pathname`.
  - `#s=` links need no 404 fallback: a fragment never reaches the server, and the app has no client-side routes.
- **Line endings:** `.gitattributes` enforces LF (`text=auto eol=lf`) in the repo and working copies (session 9).
- **Background dev/preview servers:** stopping the task that ran `npx vite preview` (or `vite`) can leave vite's `node` child alive and holding the port. E2E uses port 4180 (`npm run preview:pages`). Before starting a server, check the port; stop a leftover only after confirming its command line is our own `vite ... --port <n>`.
- **Never create files with `echo > file` in PowerShell.** Windows PowerShell 5 writes UTF-16 LE, which git treats as binary (this happened to the first `README.md`). Use the editor/file tools, or `Set-Content -Encoding utf8`.

### Commands

```powershell
npm run dev           # local dev server (base "/")
npm run test          # Vitest: "unit" project, then "stats" (*.stats.test.ts); must be clean before any commit (chain commits after it: npm run test && git commit ...)
npm run build         # strict type check (app, config, E2E specs) + production build, must be clean before any push
npm run lint          # oxlint
npm run e2e           # Playwright: builds with VITE_BASE=/strategylab/, serves on :4180, runs e2e/*.spec.ts
npm run build:pages   # the GitHub Pages build (VITE_BASE=/strategylab/)
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

5. **Game model** (`games.ts`). **Since session 13 a game is a list of 1–12 outcomes `{ prob, net }` (see "Multi-outcome games"); binary games are `[{p, n}, {1 − p, −1}]` and the text below describes them.** Originally: `interface Game { id; name; winProb; netPayout }`. `netPayout` = profit per unit staked on a win (even money = 1). Derived: `edge = 1 - winProb * (1 + netPayout)`. Presets: European roulette even-money (18/37, 1), American (18/38, 1), fair coin (0.5, 1), custom, and (session 8) sports odds, which COMPILE to a Game in `odds.ts` (see "Sports odds"). Validate `0 < winProb < 1` and `netPayout > 0`.

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

9. **Stats are a plug-in layer** (`src/engine/stats/`). A stat is `{ id; label; format: "money" | "pct" | "ratio" | "int"; emphasis?: boolean; compute(acc: Accumulator, ctx: RunContext): number }`, where `RunContext` is read-only `{ game, edge, config, nSessions }` (session 3). The Accumulator is built in a single pass per strategy and holds running sums (final, wagered, rounds, sums of squares for SE), endReason counts, and one `Float64Array` per strategy for EACH per-session column: final bankroll, max drawdown, longest losing streak (session 3). These columns NEVER leave the worker; only derived outputs cross, typed arrays via `Comlink.transfer`. Every percentile goes through ONE function, `quantileSorted` (type 7) in `stats/quantile.ts`, on a sorted copy made once per column (`sortedColumn`). NEVER retain full paths for all sessions. Stats are registered in `stats/registry.ts`, and the results table renders purely from that registry.

10. **runMonteCarlo(game, strategies[], config, nSessions, masterSeed, onProgress)** runs every strategy over the SAME session seeds and returns per strategy: stat values, raw endReason counts, the first 50 session paths (streaming min/max downsampled), final-bankroll histogram counts over ONE set of 50 bins shared by every strategy in the run, and p5/p25/p50/p75/p95 percentile bands at the ADAPTIVE checkpoints of `checkpoints.ts` (session 12: every round 0..min(maxRounds, 64), then +25% steps capped at ceil(maxRounds / 200), ending exactly at maxRounds; at most 287 checkpoints), from the first min(2000, n) sessions (the same indices for every strategy). Band and sample-path sessions are observed through the runner's optional per-round `observer`; every other session pays only a branch check. Memory per observed session is independent of maxRounds.

11. **Worker.** `src/worker/sim.worker.ts` exposes runMonteCarlo via Comlink. The progress callback is passed with `Comlink.proxy` and reported about every 2%. Cancel = `worker.terminate()`, then respawn (Comlink cannot interrupt a sync loop). The UI NEVER runs a simulation on the main thread. `client.ts` owns the worker lifecycle.

### Also non-negotiable

- **All scenario state lives in one serializable `ScenarioConfig`** (`src/scenario.ts`, plain JSON). No scenario state hidden in component-local state. Reason: URL sharing must stay trivial.
- **If an approved decision turns out wrong mid-session, STOP and ask before changing it.** (Added in session 12, after session 11 swapped an approved option for a variant and only reported it afterwards.)
- **Monte Carlo-heavy tests go in the `stats` Vitest project; never add a per-file or per-test timeout** (session 13). A test that simulates about 1,000 sessions or more, or takes over a second alone, lives in a `*.stats.test.ts` file: invariant tables, equivalence, fuzz, goldens, frequency and property tests. The `stats` project runs AFTER `unit` on 2 workers with ONE project-wide timeout (120 s, in `vite.config.ts`); `unit` keeps Vitest's 5 s default. Reason: heavy files competing for CPU made deterministic tests time out, and per-file timeouts only hid that.
- **Statistical tests use standard-error tolerances**, never hand-picked constants. Tolerance = 4 × SE computed in the test from the samples, and the test prints the SE. Fixed seeds keep them deterministic; SE-based bounds keep them honest. Do NOT increase nSessions or loosen tolerances just to make a test pass. If an invariant test fails, the engine is presumed wrong until proven otherwise.

---

## Folder map

```
.github/workflows/ci.yml  CI (lint, unit, build, e2e) + GitHub Pages deploy after all pass
playwright.config.ts      E2E: production build under /strategylab/ on :4180, Chromium, clipboard permissions
playwright.screenshots.config.ts  the screenshot script (NOT the suite): live site, light, 1280x800 @2x
scripts/screenshots/capture.spec.ts  default run, table = engine, then README images + the OG image, oxipng
docs/                     README screenshots (generated: results.png, fan-fit-martingale.png, replay-bust.png)
public/og-image.png       1200x630 link-preview image (generated; og:image points at it on Pages)
e2e/
  helpers.ts          engineTable (same scenario through the engine in Node), watchPage, canvas-not-blank, dataNum
  app.spec.ts         sub-path load, all strategies' forms, default run = engine, shared axes, labels, fan hover
  replay.spec.ts      replay legend, fit to first ending (Martingale bust), drag-zoom, dblclick reset, hover, click a path
  rules.spec.ts       rule builder form, reorder/delete, preview = previewRule, run beside built-ins, JSON errors, Kelly blank
  links.spec.ts       SUB-PATH copy link, reload, garbage/cut-off fragments, too large, blocked copy, ready-made links, Back
  sports.spec.ts      readout = sportsReadoutLines, decimal round trip, invalid odds, estimate mode, run + link
  layout.spec.ts      dark/light theme redraws (data-theme, data-color), 360 px without horizontal scroll
  responsiveness.spec.ts  100k x 6: typing mid-run, cancel, fresh run, long tasks
src/
  engine/
    rng.ts            mulberry32 + splitmix32
    games.ts          Outcome / Game (binary shorthand) / OutcomesGame / AnyGame, presets, edge, legacyView, validation
    probText.ts       probability TEXT -> exact BigInt rational ("1/6", "0.25"); exact sums
    outcomeEditor.ts  the outcome editor's inputs (ticket | multiplier) -> outcomes + readout (pure)
    odds.ts           sports odds -> Game: conversions, proportional de-vig, estimate mode (pure)
    types.ts          shared engine types (SessionResult, EndReason, ...)
    runner.ts         runSession, runSessionWithRng, compileGame + outcomeIndex (the one-draw mapping), table rules, observer + onRound hooks, sub-cent carry
    runner.golden.stats.test.ts + .json  pre-carry golden SessionResults on even/integer payouts (bit-identical), old-rule -110 run
    runner.carry.stats.test.ts    carry property test: |paid - exact| < 1 cent, exact BigInt rationals, after every round
    runner.regression.stats.test.ts -110 flat $5, 100k sessions: z before (golden) vs after the carry
    invariant.stats.test.ts       THE full invariant table: 8 built-ins + a custom rule x 5 games (incl. two sports games)
    montecarlo.ts     runMonteCarlo, CRN seeding, sample paths, histogram, bands, resultTransferables
    montecarlo.golden.stats.test.ts + .json  pre-session-12 runMonteCarlo outputs (all but bands): bit-identical
    checkpoints.ts    THE band checkpoint schedule (pure): dense early, geometric, capped; exhaustively tested
    downsample.ts     streaming min/max sample-path downsampler (<= 1000 points)
    replay.ts         same-luck replay of one session for every strategy (calls runSession only)
    perf.bench.stats.test.ts opt-in benchmark (BENCH=1): session 2 timing scenario + observer cost
    testUtils.ts      test-only helpers (scripted/counting RNG, sample-based SE)
    isolation.test.ts guards rules 1-2 (no Math.random / React / DOM in engine)
    strategies/
      types.ts        Strategy, FieldSpec
      registry.ts     the ONE place strategies are registered
      flat.ts         reference implementation
      validate.ts     checks a config against its configSchema
      crn.test.ts     CRN across every registered strategy plus one custom rule
      customGame.stats.test.ts  every strategy on p = 0.45, payout 1.2, via the registered z stat
    rules/            the rule language (see "Rule language"): user strategies as DATA, never code
      types.ts        Rule, Entry, Condition, Action
      limits.ts       every limit and range (validator and builder read these)
      validate.ts     THE closed-grammar validator (worker and UI), parseRuleJson; never throws
      compile.ts      validated rule -> Strategy (id "custom", label = rule name); pure, no RNG
      examples.ts     shipped example rules (four reproduce built-ins exactly)
      equivalence.stats.test.ts  4 built-ins vs their rules: bit-identical over 10,000 sessions
      fuzz.stats.test.ts    200 random valid rules (invariant) + 200 invalid (all rejected)
      noEval.test.ts  static scan: no eval / Function / dynamic import in the rule pipeline
    stats/
      types.ts        StatDef, RunContext
      accumulator.ts  single-pass accumulator, per-session columns, sortedColumn (sort once)
      quantile.ts     THE percentile function (type 7) + sortedCopy
      histogram.ts    shared-bin histogram (50 bins over [min, max] across all strategies)
      bands.ts        BandRecorder (percentile bands over time, on any strictly increasing checkpoint list)
      registry.ts     the ONE place stats are registered (row order = table order)
  worker/
    sim.worker.ts     Comlink-exposed runMonteCarlo and replay
    resolve.ts        StrategyRef (builtin id+config | custom rule data) -> specs; rules compile HERE
    client.ts         worker lifecycle, progress, cancel
  ui/
    ConfigPanel.tsx   game, bankroll, table, stops, rounds, sessions, seed
    NumberField.tsx   numeric input with inline errors
    format.ts         stat formatting, strategy column labels
    StrategyPicker.tsx  built-ins + custom rules (from examples); series swatch per card
    SchemaForm.tsx    renders any configSchema
    rules/
      RuleBuilder.tsx Form / JSON tabs + live preview for one custom rule
      RuleForm.tsx    entry lists: add / reorder / delete, condition + action dropdowns
      RuleJson.tsx    raw JSON view, copy, paste (JSON.parse only)
      RulePreview.tsx W/L script -> bet ladder table
      edit.ts         pure form-editing helpers (tested)
      preview.ts      pure preview adapter over the COMPILED rule (tested)
    RunControls.tsx   Run / Cancel / progress, and Copy link (tooltip + reason when blocked)
    LinkBanner.tsx    outcome of opening a link: loaded, loaded except N items, or not loaded
    SportsOddsFields.tsx  sports odds inputs (mode, format, sides, estimate) + always-visible readout
    sportsReadout.ts  readout lines (pure, tested) + the push note; tone test scans sports sources
    linkBoot.ts       browser glue: one page loader, initial load, replaceState canonicalization
    ResultsTable.tsx  renders any stats registry
    ChartSlot.tsx     placeholder panels shown before the first run
    theme.ts          System / Light / Dark preference (data-theme; not scenario state)
    charts/
      adapters.ts     ALL result-to-chart transforms (pure, tested): shared scales, series, ticks, replay layout
      canvas.ts       thin Canvas 2D layer: DPR sizing, axes, bands, lines, reference lines, resize hook
      FanChart.tsx    fan + spaghetti small multiples (click a path to replay)
      HistogramChart.tsx  final-bankroll histograms, shared bins, linear/log
      ReplayChart.tsx stacked replay: bankroll, bet size, ONE win/loss strip
  scenario.ts         ScenarioConfig (v4 since session 13: games as outcomes, sports/editor inputs; v2: builtin | custom instances, at most MAX_STRATEGIES = 8), defaults, validation, toSimRequest (dollars -> cents), migrateScenario (v1 -> v2)
  share/              scenario links (see "URL scenario format"): UNTRUSTED input, no React, no DOM
    limits.ts         prefix, 8,000-character cap, depth limit, size budget
    base64url.ts      strict hand-written base64url (never throws, errors carry a position)
    compact.ts        key map, rule/config compaction, type-level expansion of untrusted payloads
    link.ts           encodeScenarioLink / decodeScenarioLink, copyBlocker, partial loading (settle)
    linkLoader.ts     applies each fragment at most once per page lifetime (pure, tested)
    testLinks.ts      test-only: fragmentOf(payload)
    *.test.ts         round trip, size budget, load, save, migration, malicious input
  App.tsx             owns the ScenarioConfig and the SimClient
```

---

## Chart rules

These are the owner's session 4 directives, verbatim. They bind every chart, present and future.

**SHARED AXES ACROSS STRATEGIES.** Charts are small multiples, one panel per strategy instance, and EVERY panel of a chart type uses the SAME x and y ranges (and the histogram uses the session 3 shared bins and a shared y max). NEVER autoscale per panel. Reason: per-panel scales make Martingale's tail look like Flat's; same principle as shared bins. Bankroll y-axes start at 0.

**ONE COLOR PER STRATEGY INSTANCE**, used everywhere: results table header, every chart panel, replay lines. Colorblind-safe palette, and every panel also carries a text label (NEVER color alone). Theme-aware via CSS variables for light and dark.

**ZOOM IS ALWAYS SHARED ACROSS PANELS; Y NEVER RESCALES** (session 10). One x window applies to every panel of a chart; nothing zooms a single panel. The y range is always the global shared range, whatever the zoom.

How the code honors them: ranges come ONLY from `src/ui/charts/adapters.ts` (`fanScales`, `histogramScales`, `replayLayout`), each computed over ALL strategies of the run and tested.
- **Fan zoom (session 10):** `zoomedFanScales(scales, zoom)` returns ONE `{x, y}` for every fan panel. x is the shared window, clamped to the full range. y is the very same global y object, and a test asserts that identity.
  - The window is set by a drag on any panel (`zoomFromDrag`, the same adapter as the replay), by "Fit to this strategy" (`[0, activeRangeEnd(bands)]`), or cleared by double-click or "Show every round".
  - Panels expose `data-x-range`, `data-zoom` and `data-active-end`.
- **Reference labels:** `placeLabels` keeps them apart and inside the plot. `drawRefLines` / `refLineV` paint each label on a `--panel` knockout AFTER the data. Boxes are exposed as `data-ref-labels` with `knockout: true`. The color of instance k is `var(--series-k mod 8)` (`seriesColorVar`), defined for light and dark in `index.css`, and it is always paired with the instance's text label. Components only draw. Charts redraw on new results, resize, or theme change, never on keystrokes.

## How to add a strategy

**First ask whether it can be a rule instead of code.** Since session 6, any progression that sizes the next bet from wins/losses, streaks, cycle profit, the bankroll vs start, or the current bet (Martingale, Paroli, D'Alembert, custom Labouchère lines and many variants) can be written in the rule language (see "Rule language") with no code, no registry line and no tests: it compiles into the same Strategy contract, and the fuzzed invariant already covers it. Ship it as an example in `rules/examples.ts` if it is worth offering. Write a built-in only when the rule language cannot express it (e.g. Fibonacci's step-back, Oscar's Grind's payout-capped bet, Kelly's bankroll-proportional stake), or when it needs config fields the UI should render from a schema.

1. Create `src/engine/strategies/<id>.ts` exporting one `Strategy<Config, State>`.
2. Define `Config`, `State`, `defaultConfig`, and a `configSchema` covering every config key. Give each field sensible min/max bounds.
3. Implement `init`, `nextBet`, `update` as pure functions. `update(state, result, ctx)` gets a `RoundResult` (session 13): branch on `result.kind === "win"` (a loss is `"loss"`; a push never reaches `update`, the runner skips it so state is unchanged across a push), and book profit from `result.profit` (the placed bet × the outcome's net, exact) rather than recomputing it. Return new state objects; never mutate. Do not clamp to table limits or bankroll; the runner does that. Payout-aware sizing reads `ctx.game` (`{ winProb, netPayout, edge, outcomes }`; on a multi-outcome game winProb/netPayout are the approximation described in "Multi-outcome games", read-only, filled by the runner — reading it never touches the RNG, so CRN is safe). Copy any config a strategy needs into State at `init`; `nextBet` gets no config.
4. Add one line to `strategies/registry.ts`.
5. Write `<id>.test.ts` (fast, `unit` project) and `<id>.stats.test.ts` (the invariant and any other Monte Carlo check, `stats` project; see "Strategy test kit" below) covering:
   - the progression over a hand-written win/loss sequence (`betSequence`, assert the exact bet sequence in cents; `betSequence` carries the just-placed bet as `ctx.lastBet` and takes an optional `game` for payout-aware strategies)
   - reset behavior, caps and floors
   - purity (`expectPure`)
   - the invariant (`describeEvInvariant(strategy, config)`, in `<id>.stats.test.ts`): EV per $ wagered within 4 SE of `-edge` on European roulette, within 4 SE of 0 on a fair coin, AND within 4 SE of `-edge` on the positive-edge game (p = 0.55, even money), with stop conditions ON. The config passed here must make the strategy actually WAGER on all three games (e.g. Kelly needs a misjudged edge above 0.5), or EV per $ is 0/0.
   - the push rule is covered automatically: `strategies/push.test.ts` runs every registered strategy through a push inside a streak (it must bet on its positive-edge push game);
   - then add the id to the expected id-list assertion in `strategies/crn.test.ts` (and give it a betting config there and in `customGame.stats.test.ts` if its default refuses to bet on a negative-edge game, as Kelly does).
6. Run the app and confirm the strategy appears in the picker with a working config form and no UI edits.
7. Update STATUS.

### Strategy specs

Every progression keeps its own level in State and computes the next bet from it. NEVER derive the next bet from `ctx.lastBet`: that is the bet AFTER table limits, so a tableMax clamp would silently rewrite the progression. Table limits are the runner's job alone (rule 7). Config values a strategy needs are copied into State at `init` (`nextBet` receives no config).

- **Martingale** (`martingale.ts`): bet = base × multiplier^level. Loss: level + 1. Win: level = 0. Config `multiplier` number, default 2, 1.1–10.
- **Paroli** (`paroli.ts`): bet = base × 2^wins. Win: wins + 1, and when wins reaches streakCap it resets to 0. Loss: wins = 0. Largest bet = base × 2^(streakCap − 1). Config `streakCap` integer, default 3, 1–10 (1 = flat).
- **D'Alembert** (`dalembert.ts`): bet = base + units × unitSize × base. Loss: units + 1. Win: units − 1, floor 0. Config `unitSize` number (multiple of base), default 1, 0.1–10.
- **Fibonacci** (`fibonacci.ts`): bet = base × fib(step), fib(0) = fib(1) = 1. Loss: step + 1. Win: step − 2, floor 0. No config (empty `configSchema`).
- **Overflow guard:** Martingale and Fibonacci cap the *returned* bet at `Number.MAX_SAFE_INTEGER` (the level keeps climbing), because the runner rejects non-finite bets and a long enough streak would overflow to Infinity. The runner still clamps and checks bankroll as usual.
- **Labouchere** (`labouchere.ts`): a line of unit numbers. Bet = (first + last) units × base; a single remaining number bets that number. Win: remove the first and the last number. Loss: append the units just bet (first + last, or the single number). When the line empties, the cycle is complete: `onComplete` "restart" (default) refills it from the preset, "stop" returns "stop". The line lives in State as an IMMUTABLE array (slice/spread only, NEVER mutate). Config: `sequence` select of presets ("1-2-3-4" default, "1-1-1-1-1", "1-2-3-4-5-6", "2-2-2-2") and `onComplete` select ("restart" default | "stop"). No new FieldSpec kind — presets are strings parsed at `init`. Custom sequences are the rule builder's job (roadmap session 6). During an uninterrupted losing streak `first` is fixed and `last` grows by `first` each loss, so the bet grows LINEARLY (no overflow guard needed; the runner still clamps).
- **Oscar's Grind** (`oscars.ts`): goal is +1 base unit of profit per cycle. State: `cycleProfit` and `betUnits` (start 1). Win: `cycleProfit += ctx.lastBet × ctx.game.netPayout`; if `cycleProfit >= goal` reset the cycle (`cycleProfit = 0`, `betUnits = 1`), otherwise `betUnits += 1`. Loss: `cycleProfit -= ctx.lastBet`, `betUnits` unchanged. Next bet = `min(betUnits × base, ceil((goal − cycleProfit) / ctx.game.netPayout))` in cents — never bet more than what one win needs to reach the goal. Profit is tracked from `ctx.lastBet` (the PLACED bet, after table rules) and `ctx.game.netPayout`, NEVER from the intended bet. No config (empty `configSchema`).
- **Kelly** (`kelly.ts`): `f* = (b·p − q) / b`, with `b = ctx.game.netPayout`, `p` the assumed win probability, `q = 1 − p`. If `f* <= 0`, Kelly says do not play: return "stop" (the session ends `strategyStop`, so with a never-betting Kelly EV per $ is 0/0 → "—" and P(strategy stopped) reads 100%). Else bet = `fraction × f* × current bankroll` in cents; the runner applies table limits as always. `f*` depends only on session-constant `p`, `q`, `b`, so it is computed once at `init`. Config: `assumedWinProb` optionalNumber (blank = use the game's true `winProb`; otherwise 0.01–0.99; default blank; session 6 replaced the old 0 sentinel) and `fraction` number (default 1 = full Kelly, 0.5 = half Kelly, range 0.1–2). The `assumedWinProb` help says plainly that setting it ABOVE the true probability models a MISJUDGED edge, not a real one. No "winning system" language, ever.

### Strategy test kit (`src/engine/testUtils.ts`)

- `betSequence(strategy, config, script)`: feeds a W/L script (`P` = a push: the round is played but `update` is skipped, as in the runner; W/L become `binaryResult(won, bet, netPayout)`) straight to init/nextBet/update (no runner) and returns every requested bet, so tests assert the exact sequence in cents.
- `expectPure(strategy, config)`: deep-frozen config, state and ctx, plus before/after snapshots (`testUtils.test.ts` proves it rejects a mutating strategy).
- `describeEvInvariant(strategy, config)`: THE fixed invariant scenario, shared by every strategy: $1,000 bankroll, $5 base, table $1–$250, stopWin $1,500, stopLoss floor $500, maxRounds 1000, insufficientFunds "stop", 20,000 sessions, on THREE games — European (seed 101), fair coin (seed 202), and the positive-edge game p = 0.55 / even money (seed 303, edge −0.10). Asserts |EV − (−edge)| < 4 SE and prints measured, expected, SE and z. Do not change this scenario to rescue a strategy. The passed config must wager on all three (Kelly uses a misjudged edge here).
- `crn.test.ts`: one `runMonteCarlo` over every registered strategy; for all 50 sample sessions, every strategy pair sees the identical W/L sequence over the rounds they both played. When you register a strategy, add its id to the expected list there.

## How to add a stat

1. If the stat needs data the Accumulator doesn't collect yet, extend `accumulator.ts` (single pass, no path retention; a new per-session column is one `Float64Array` plus a `ColumnKey`) and add a test for the new field.
2. Add a `StatDef` with `compute(acc, ctx)` in `stats/` and one line to `stats/registry.ts`, **at the right position**: the table renders registry order. Use `ctx` (game, edge, config, nSessions) instead of re-deriving run facts. Any percentile MUST be `quantileSorted(sortedColumn(acc, key), p)`. Never sort a column yourself. Return NaN for "undefined" (the UI shows a dash).
3. Test `compute` against a hand-built accumulator with a known answer (`testCtx(...)` in `testUtils.ts` builds the ctx). Update the row-order test in `stats.test.ts`.
4. Confirm it appears in the results table with no UI edits.
5. Update STATUS.

## Rule language

Users define progression strategies without code. A rule is **plain JSON data, never code**: no `eval`, no `new Function`, no dynamic `import`, no string-to-code of any kind (a static-scan test enforces this, like the `Math.random` guard). Rules are validated against the closed grammar below, and anything unrecognized (an unknown key, a wrong type, NaN, ±Infinity, a value out of range, a list that is too long) is REJECTED with a readable error. Reason: session 7 shares scenarios by URL, and a shared link must never be able to execute code.

A valid rule compiles (`src/engine/rules/compile.ts`) into the SAME `Strategy` contract as the built-ins, so every stat, chart, replay and invariant applies unchanged. Compiled strategies are pure and never touch the RNG. Compilation happens in the worker. The main thread runs the SAME validator only to show errors (and compiles for the live W/L preview, which is a fixed script, not a simulation).

### Grammar

```ts
type Rule = ProgressionRule | SequenceRule;

interface ProgressionRule {
  kind: "progression";
  name: string;          // 1–40 characters, no control characters; the column label
  startUnits: number;    // 0.01–1000 (bet = base bet × units)
  onWin:  Entry[];       // 1–10 entries
  onLoss: Entry[];       // 1–10 entries
}

// Every entry except the LAST must have "when". The last must NOT (it is the default).
interface Entry { when?: Condition; then: Action }

type Condition =
  | { type: "winStreak";   atLeast: number }        // integer 1–100: consecutive wins (this round included)
  | { type: "lossStreak";  atLeast: number }        // integer 1–100: consecutive losses (this round included)
  | { type: "cycleProfit"; atLeast: number }        // −1000..1000 base units of profit since the cycle began
  | { type: "bankroll";    op: ">=" | "<="; pct: number } // 0–1000: bankroll vs pct% of the starting bankroll
  | { type: "betUnits";    atLeast: number };       // 0.01–1,000,000: units of the bet just placed (before this action)

type Action =
  | { type: "set";      units: number }             // 0.01–1,000,000
  | { type: "multiply"; by: number }                // 0.1–10
  | { type: "add";      units: number }             // −1000..1000 (0 keeps the units unchanged)
  | { type: "reset" }                               // units = startUnits
  | { type: "resetCycle" }                          // units = startUnits, cycle profit = 0, both streaks = 0
  | { type: "stop" };                               // the next bet is "stop" (endReason strategyStop)

interface SequenceRule {                            // custom Labouchère
  kind: "sequence";
  name: string;                                     // as above
  line: number[];                                   // 1–20 entries, each an integer 1–100
  onComplete: "restart" | "stop";
}
```

Objects must be plain objects with exactly the listed keys (optional `when` aside). Numbers must be finite. Integer fields reject fractions. A non-final entry without `when` is rejected (it would make every later entry unreachable), and so is a final entry with one.

### Evaluation order (progression)

State: `units` (starts at `startUnits`), `winStreak`, `lossStreak`, `cycleProfit` (cents), `stopped`, and `start` (the starting bankroll, copied from `ctx.bankroll` at `init`).

- **nextBet:** `"stop"` if `stopped`; otherwise `min(baseBet × units, Number.MAX_SAFE_INTEGER)`. The runner rounds, applies table limits and checks the bankroll, as for every strategy.
- **update(won, ctx)**, in this order:
  1. Streaks: a win adds 1 to `winStreak` and sets `lossStreak` to 0; a loss does the opposite.
  2. Cycle profit: `+ ctx.lastBet × netPayout` (the EXACT winnings, fractional cents, as Oscar's Grind counts them) on a win, `− ctx.lastBet` on a loss. This is the PLACED bet (after table rules). The runner pays whole cents with a sub-cent carry, so over any stretch of rounds this is within 1 cent of the real bankroll change (session 11; it was `round(lastBet × netPayout)` before, which would drift by up to ½¢ per win against the carry).
  3. Pick the list (`onWin` or `onLoss`) and walk it TOP TO BOTTOM. The FIRST entry whose `when` holds, or that has no `when`, is the match. Conditions see the post-round bankroll (`ctx.bankroll`), the updated streaks and cycle profit, and the units of the bet just placed. `cycleProfit` compares against `atLeast × baseBet`; `bankroll` compares against `start × pct / 100`.
  4. Apply that entry's ONE action. After `set` / `multiply` / `add`, units are clamped to [0.01, `Number.MAX_SAFE_INTEGER`] (the session 2 overflow guard: units never become Infinity or ≤ 0).

Work per round is O(entries) (at most 10 condition checks), with no loops over history.

### Evaluation (sequence)

Exactly the built-in Labouchère: bet (first + last) × base, or the single number × base. A win removes the first and last numbers. A loss appends the units just bet. An empty line either restarts from `line` or stops. The line is immutable in State. Appending on a loss copies the line, so a loss costs O(line length), as in the built-in.

### Limits (enforced by the validator)

At most 10 entries per list, 20 numbers per sequence line, and 40 characters per name. JSON pasted into the builder is capped at 20,000 characters. Every numeric field has the range shown above. Bet units are clamped as described, and the returned bet is capped at `MAX_SAFE_INTEGER`, the same guard Martingale and Fibonacci use.

### Where rules live and how they are checked (session 6)

- **Storage:** a custom strategy instance in `ScenarioConfig` is `{ uid, kind: "custom", rule }`, where `rule` is plain JSON and untrusted until validated. Built-ins are `{ uid, kind: "builtin", strategyId, config }`. `ScenarioConfig.version` is 2, and `migrateScenario` upgrades v1.
- **Across the worker boundary:** `SimRequest.strategies` is `StrategyRef[]`, the same union as data. `worker/resolve.ts` validates and compiles rules INSIDE the worker. Functions never cross.
- **Validator output:** a FRESH, deep-frozen rule built only from known keys. It reads own properties only (never inherited ones), accepts only plain objects, and checks a list's length before iterating it. It never throws: exotic input returns an error, not an exception.
- **Error format:** errors carry a readable location and the bad value, e.g. `onLoss entry 2 → action → by: must be between 0.1 and 10 (got 12)`. All field problems are reported together. One exception: an unknown or missing key in an object stops the checks inside that object, so its fields are not reported until the keys are fixed.
- **`validateRule(raw, { ranges: false })`** checks structure and types only (keys, types, finite numbers, list shape, where `when` may appear). The form uses it so it can keep showing a rule while the user fixes an out-of-range value.
- **Compiled strategies** have id `"custom"`, label = the rule's name, `configSchema: []` and `defaultConfig: {}`. They are not registered, and they close over the frozen rule.
- **Live preview** (`ui/rules/preview.ts`) feeds a typed W/L script (≤ 100 rounds) to the COMPILED rule, using the scenario's base bet, start and payout. It ignores table limits and running out of money, and says so on screen.

### Worked examples (base bet = 1 unit; "next" = the bet after the script)

**1. Double after a loss (Martingale ×2):**

```json
{ "kind": "progression", "name": "Double after a loss", "startUnits": 1,
  "onWin":  [ { "then": { "type": "reset" } } ],
  "onLoss": [ { "then": { "type": "multiply", "by": 2 } } ] }
```

Script `LLLWLW` → bets 1, 2, 4, 8, 1, 2, next 1. Each loss doubles, and each win resets to 1.

**2. Double after a win, three-win cap (Paroli cap 3):**

```json
{ "kind": "progression", "name": "Double after a win, cap 3", "startUnits": 1,
  "onWin":  [ { "when": { "type": "winStreak", "atLeast": 3 }, "then": { "type": "resetCycle" } },
              { "then": { "type": "multiply", "by": 2 } } ],
  "onLoss": [ { "then": { "type": "reset" } } ] }
```

Script `WWWWLW` → bets 1, 2, 4, 1, 2, 1, next 2. On the third win the streak reaches 3, so the first entry matches and `resetCycle` zeroes the streak. The fourth win is then streak 1 again and doubles. If the action were plain `reset`, the streak would still read 4 and the fourth win would reset again, which is why `resetCycle` clears the streaks.

**3. Flat bet, stop once 20% up** (start $100, base $10, even money):

```json
{ "kind": "progression", "name": "Flat, stop at +20%", "startUnits": 1,
  "onWin":  [ { "when": { "type": "bankroll", "op": ">=", "pct": 120 }, "then": { "type": "stop" } },
              { "then": { "type": "reset" } } ],
  "onLoss": [ { "then": { "type": "reset" } } ] }
```

Script `WLWW` → bankroll 110, 100, 110, 120. Bets 1, 1, 1, 1, then "stop": after the fourth round the bankroll is 120 ≥ 120% of 100, so `stop` fires and the session ends `strategyStop`.

## URL scenario format

A scenario travels in the URL **fragment**: `#s=<base64url(UTF-8(compact JSON))>`. It is never in the query string: the fragment never reaches a server, so there are no request-size limits and no server logs of scenario data. A link is **untrusted input**, handled like pasted rule JSON:
- **Decoding** (`src/share/link.ts`) never throws and never evaluates anything. Every stage is bounded by the length cap.
- **Custom rules** go through the session 6 `validateRule`.
- **The rebuilt scenario** goes through `validateScenario`.
- **The no-eval scan** covers `src/share/`.

### Key map (top level)

| Key | Field | Notes |
|---|---|---|
| `v` | version | = `ScenarioConfig.version` (currently 2). The link format version IS the scenario version: any key-map change bumps it and needs a migration. |
| `g` | game | Preset id (`"european"`, `"american"`, `"fairCoin"`) when the numbers match the preset exactly; otherwise `[presetId, winProb, netPayout]` (`presetId` may be `"custom"`). |
| `b` `bb` `tn` | startBankroll, baseBet, tableMin | Dollars, as in `ScenarioConfig`. |
| `tx` `sw` `sl` | tableMax, stopWin, stopLoss | Omitted = off / no limit (`null`). |
| `r` `n` `sd` | maxRounds, sessions, seed | |
| `f` | insufficientFunds | Omitted = `"stop"`; `"a"` = `"allIn"`. |
| `st` | strategies | At most 8. Instance `uid`s are NOT encoded (they are React identity); loading makes new ones. |

**Strategies in `st`:**
- **Built-in:** `[id]` when the config equals `defaultConfig`, else `[id, {key: value}]` with only the keys that differ; `null` = blank (optionalNumber). Config keys keep their real names.
- **Progression rule:** `["p", name, startUnits, onWin, onLoss]`. Each entry is `[condition, action]`, or `[action]` for the default (last) entry.
  - Conditions: `["ws", n]` winStreak, `["ls", n]` lossStreak, `["cp", n]` cycleProfit, `["bu", n]` betUnits, `["bg", pct]` bankroll ≥ pct%, `["bl", pct]` bankroll ≤ pct%.
  - Actions: `["s", u]` set, `["m", x]` multiply, `["a", u]` add, `["r"]` reset, `["rc"]` resetCycle, `["x"]` stop.
- **Sequence rule:** `["q", name, line, "r" | "s"]` (restart | stop).

**Shrinking is lossless only:** short keys, and omitting a field only when it equals its documented default. Numbers are written by `JSON.stringify` (shortest exact round trip). A round-trip test proves deep equality, uids aside.

### Limits

- **Hard cap: 8,000 characters for the WHOLE link** (origin + path + fragment). RFC 9110 §4.1 recommends supporting URIs of at least 8,000 octets, and it is the practical limit of chat, mail and CDN tools a link passes through.
  - Copy link refuses a longer link with a message (length, limit, what to shorten). It NEVER truncates.
  - Loading rejects any fragment longer than 8,000 characters before decoding anything.
- **Nesting deeper than 16** is rejected by a linear pre-scan BEFORE `JSON.parse`. A real payload nests at most 6 deep.
- **Size budget:** a "typical" scenario (4 strategies, one a 10-entry rule, plus a 60-character address allowance) must stay under 2,000 characters. It is currently 562, enforced in `size.test.ts`.

### Loading

`decodeScenarioLink(hash)` returns one of:
- **`none`:** there is no `#s=` fragment.
- **`error`:** nothing is loaded and the defaults stay untouched. Causes: over the length cap, bad base64, invalid UTF-8, not JSON, too deep, not an object, a bad version, or a version newer than this app (the message says "needs a newer version of the app").
- **`loaded`:** the scenario loaded, plus a `dropped` list of everything that could not be loaded, each with the validator's message.

Version 1 links are expanded into a `ScenarioConfigV1` and upgraded by the EXISTING `migrateScenario` before validation.

**Partial loads:**
- A wrong type is dropped at expansion.
- Then, while `validateScenario` reports errors:
  - an offending top-level field falls back to its default (optional fields turn off);
  - an offending built-in setting resets to its default;
  - an unknown strategy or an invalid rule is left out.
- Unknown keys are reported, at most 5 by name and the rest summarized.

Opening a link never runs a simulation.

**History.** The page keeps ONE loader (`ui/linkBoot.ts`) that applies each fragment at most once per page lifetime. StrictMode double effects, `hashchange` + `popstate`, and Back to an already-loaded fragment never re-fire it, and a real reload (a new page lifetime) does apply it. After loading, `replaceState` writes the canonical fragment (or strips an unreadable one); loading never adds a history entry. Copy link also uses `replaceState` (there is no separate in-app "apply" step, so no `pushState`), which is why reloading right after copying restores the scenario, custom rules included.

## Sports odds

Sports odds **compile to the existing `Game { winProb, netPayout }`**. Nothing downstream changes: the runner, Monte Carlo, stats, strategies, rules, replay and links all see an ordinary game. All the math lives in ONE pure file, `src/engine/odds.ts`. If sports mode ever needed a pipeline change, the Game abstraction would be wrong. Stop and explain instead.

Tone: educational. No sportsbook names, no links, no "picks", no "sharp" or "value bet" language.

### Conversions (net payout = profit per $1 staked on a win)

| Input | Net payout | Rejected |
|---|---|---|
| American **+X** (X ≥ 100) | X / 100 | anything strictly between −100 and +100, including 0, NaN and ±Infinity |
| American **−X** (X ≥ 100) | 100 / X | |
| Decimal **d** (d > 1) | d − 1 | d ≤ 1, NaN, ±Infinity |

- **Implied probability** = 1 / (1 + net payout). That is the win probability at which the price would be fair.
- **Ranges:** American ±100 to ±100,000; decimal 1.001 to 1,001 (both give payouts 0.001 to 1,000). The estimate is 0.01 to 0.99. +100 and −100 are the same price (even money).
- **Decimal float artifact:** `d − 1` for a typed decimal can carry one extra bit (1.91 − 1 = 0.9099999999999999 in floating point). The payout snaps to the nearest short decimal (≤ 12 significant digits) when it is within 4 × ε × max(1, d) of it: 0.9099999999999999 → 0.91. Values that are not near a short decimal (e.g. a converted 1.9090909090909092) are left exactly as they are. Reason: a 50¢ bet at 1.91 must win 46¢, not 45¢ (winnings are `Math.round(bet × payout)`, so the artifact would flip half-cent boundaries).

### Two input modes

**Market (default).** Odds for BOTH sides of a two-way market, and the side you bet.
- **Overround (the vig)** = implied_A + implied_B − 1.
- **Fair probability of the chosen side, by PROPORTIONAL de-vig** = implied_side / (implied_A + implied_B).
- **House edge** = 1 − fair_p × (1 + net payout of the chosen side). Negative = player edge.
- **Identity:** with proportional de-vig, the edge is the SAME on both sides and equals 1 − 1 / (implied_A + implied_B) = overround / (1 + overround). The worked examples below show it.
- **A negative overround** (the two prices add up to less than 100%) is accepted, but the readout says plainly that this is rare in real markets and usually a data-entry error. As entered, it gives the bettor an edge.

**My estimate.** One price ("Your side's odds", stored as side A) plus the user's own win probability, which becomes `winProb` directly. The help text states plainly: an estimate ABOVE the fair probability models an edge you BELIEVE you have; the simulation will honor it, but believing in an edge is not the same as having one. (This is the same principle as Kelly's `assumedWinProb`.) Side B and the chosen side are kept but ignored in this mode, so switching back loses nothing.

**Other de-vig methods** (power, Shin, additive) are on the roadmap, not in the code.

### Format toggle (American ↔ Decimal)

- Switching format **converts the stored prices EXACTLY** (in floating point): American → decimal is d = 1 + net, and decimal → American is +100 × net when net ≥ 1, else −100 / net.
- **Snapping (corrected in session 8 while implementing; the first draft said "snap everything to 15 digits"):**
  - **American** results are snapped to 15 significant digits.
  - **Decimal** results keep full precision and snap only when within 4ε of a short (≤ 12-digit) decimal.
  - Why: snapping a converted DECIMAL to 15 digits breaks −180 → decimal → American, which came back as −179.999999999999.
  - With this rule, American → decimal → American returns the original exactly (tested for −110, +150, −180, +100, −250, +333, −105, +10,000, −100,000), and so does decimal → American → decimal for typed decimals (1.91, 2.5, 1.5, 3.75, 1.001, 1,001).
- The field **DISPLAYS** the value rounded: whole numbers for American, 2 decimals for decimal. The stored value only changes when the user edits the field.
- The readout shows the real payout, so a rounded display never hides the price. A converted decimal pays the same as the American price to within 2 ε (tested). For −110 it is bit-identical: edge 0.045454545454545414 in both formats.
- Even money converts to +100 (−100 and +100 are the same price).

### Worked examples

1. **−110 / −110 (market, bet side A).**
   - Net payout 100/110 = 10/11 = 0.909091. Implied 1/(1 + 10/11) = 11/21 = 0.523810 each.
   - Sum 22/21, **overround 1/21 = 4.762%**.
   - **Fair p = (11/21)/(22/21) = 0.5.**
   - **House edge = 1 − 0.5 × 21/11 = 1/22 = 4.545%** (= 1 − 21/22, the identity).
2. **+150 / −180 (market).**
   - +150: net 1.5, implied 0.4. −180: net 100/180 = 5/9 = 0.555556, implied 9/14 = 0.642857.
   - Sum 73/70 = 1.042857, **overround 3/70 = 4.286%**.
   - **Fair p: 28/73 = 0.383562** for +150 and **45/73 = 0.616438** for −180.
   - **House edge 3/73 = 4.110% on BOTH sides:** 1 − (28/73)(2.5) = 1 − (45/73)(14/9) = 1 − 70/73.
3. **My estimate 0.55 at −110.**
   - Edge = 1 − 0.55 × 21/11 = 1 − 1.05 = **−0.05, a 5% PLAYER edge**, believed, not established.
   - The invariant predicts EV per $ wagered = +0.05, and the simulation will show it: the engine honors the probability it is given.

### Cents rounding (session 11: per-session sub-cent carry)

The bankroll is whole cents, but `bet × netPayout` often is not (−110 at $5: 454.5454…¢). Since session 11 the runner pays each win as

```
owed  = bet × netPayout + carry      // fractional cents
paid  = Math.round(owed)             // whole cents, ties toward +∞
carry = owed − paid                  // |carry| ≤ 0.5; starts at 0 every session
```

- **Bound:** over any session, and at every round inside it, |total paid − total exact| = |carry| ≤ ½¢, plus float noise of at most ε × |owed| per win (~1e-4¢, and only at $10M bets on a 1,000 payout). `runner.carry.test.ts` checks it after every round of 15,000 random sessions with EXACT rational arithmetic: a float payout is a dyadic rational, so the reference total is a BigInt fraction. Measured max: −110 0.4545¢, +150 0.5¢, decimal 1.91 0.5000001¢, 1.2 0.4000004¢, 5,000 random payouts 0.50015¢.
- **Residual effect on EV per $:** at most ½¢ per SESSION (not per win), i.e. ≤ 0.5 / totalWagered. For the invariant scenario's Flat (~$5,000 wagered per session) that is ≤ 0.0001%, about 1/100 of an SE at 100k sessions. No helper is needed to describe it: `payoutRoundingBias` was deleted in session 11.
- **Tie rule: half-up (`Math.round`).** With a carry the tie direction cannot accumulate (a tie leaves carry −0.5, repaid by the next win), so half-even would buy nothing. Half-up keeps the FIRST win of every session paying exactly what it paid before session 11.
- **Integer payouts** (even money, 2:1, 35:1, …): `bet × n` is an exact integer, so the carry is exactly 0 and every result is bit-identical to the pre-carry runner (`runner.golden.test.ts`: 5 games × 2 scenarios × 9 strategies, 50 stored results plus a digest over 2,000 full paths per cell).
- **Draws:** the carry is arithmetic on the payout only. It never consumes a draw and never changes when one happens, so CRN and draws === rounds are unchanged.
- **Same rule elsewhere:** the rule builder's live preview (`ui/rules/preview.ts`) pays with the same carry, so its bankroll column matches a real session. Rule cycle profit counts exact winnings (see "Evaluation order").

**What it fixed:** before the carry, Flat at $5 on −110 was paid 455¢ per win instead of 454.545¢, a +0.0455% shift in EV per $: 2.12 SE at 20,000 sessions (session 8) and **5.29 SE at 100,000** (`runner.regression.test.ts`, same seeds: EV per $ −4.4947% vs −edge −4.5455%, SE 0.0096%). With the carry: **−4.5401%, z 0.55.** (At the app's default $10 bet the old shift was −0.0045%; at a $1 bet it could reach 0.25%.)

The invariant tests keep their 4 SE tolerance. If one fails on a non-integer payout, the carry is the FIRST suspect: investigate and report, never loosen the tolerance.

### Pushes are out of scope

Sports MODE still models **two-way markets without pushes** (the UI says so in one line). Since session 13 the engine itself supports pushes and any number of outcomes (see "Multi-outcome games"), but three-way sports lines (a push or a draw priced by the market) need their own de-vig spec and stay on the roadmap, with parlays and other de-vig methods.

### Scenario and link representation

- **Scenario version 3** (scenario games): `game = { presetId: "sports", winProb, netPayout, sports: { mode, format, sideA, sideB, side, estimate } }`.
  - The odds inputs are the source of truth. `winProb` / `netPayout` are derived, re-synced on every edit and load, and checked by `validateScenario`.
  - Errors are keyed `game.sideA`, `game.sideB` and `game.estimate`.
  - `migrateScenario` goes v2 → v3 (version bump only; v2 games load unchanged), chained after v1 → v2.
- **Links:**
  - The game is `["o", mode "m"|"e", format "a"|"d", sideA, sideB, side "a"|"b", estimate]`, inputs only. The derived numbers are recomputed on load.
  - v1 and v2 links load exactly as before, then migrate. A sports game in a v1/v2 link is rejected (it did not exist then).

---

## Multi-outcome games (session 13)

A game can have ANY number of outcomes (1 to 12), each with its own probability and payout. The ticket example: price P; a prize of $20 with probability 1/6, $50 with 3/6, $100 with 2/6.

### The model

```ts
interface Outcome {
  prob: number;   // > 0, finite
  net: number;    // profit per $1 staked: -1 = stake lost, 0 = push, 1 = even-money win; >= -1
  label?: string; // shown in the replay strip and the editor
}
interface OutcomesGame { id: string; name: string; outcomes: readonly Outcome[] }
interface Game { id: string; name: string; winProb: number; netPayout: number } // the binary shorthand (kept under its old name)
type AnyGame = Game | OutcomesGame;  // what the engine accepts; outcomesOf(game) gives the list
```

As built (session 13): the engine takes `AnyGame`. The binary shorthand keeps the name `Game` so every preset, custom and sports game, and every existing test, is untouched; `outcomesOf` turns it into the two-outcome form below.

- **Gross return** (the amount returned per $1 staked: 0 = stake lost, 1 = push, 2 = even-money win) is `1 + net`. It is what the editor and readouts SHOW.
- **Why `net` is stored rather than `grossReturn`** (owner-approved, session 13): `1 + n` loses a bit in floating point. With n = 100/110, `(1 + n) − 1` = 0.9090909090909092 ≠ n. Storing `net` keeps every binary game, sports price and link bit-exact.
- **Binary games are exactly** `[{ prob: p, net: n }, { prob: 1 − p, net: −1 }]`, where p and n are the old `winProb` and `netPayout`, untouched. Presets, the binary "Custom" game and sports odds all compile to this form.
- **Validation** (`validateGame`, never throws; every problem reported):
  - 1–12 outcomes;
  - every `prob` finite and > 0;
  - every `net` finite and ≥ −1 (i.e. gross return ≥ 0);
  - probabilities sum to 1 within 1e-9.
- **Edge** = `1 − Σ probᵢ × (1 + netᵢ)`. Negative = player edge. For a binary game the loss term is `(1 − p) × 0 = 0`, so this is BIT-EQUAL to the old `1 − p(1 + n)`: the theory stat and z do not move.

### One draw per round

The single uniform draw `u` picks the outcome by cumulative probability, in the order the outcomes were entered:
- `cum[k] = prob₀ + … + prob_k`, accumulated left to right, and the LAST bound is forced to exactly 1 (so rounding never leaves a gap);
- the outcome is the first k with `u < cum[k]`.

For a binary game `cum[0] = p`, so this is exactly the old `u < p` (win). CRN is unchanged: the same draw gives the same outcome index in every strategy. A round still consumes exactly ONE draw; nothing else does.

### Payout, carry and the round result

- The round's EXACT profit is `bet × net_k` (fractional cents).
- **Total loss (`net = −1`)** moves the bankroll by exactly `−bet`. **Push (`net = 0`)** moves it by exactly 0. Neither touches the carry.
- **Every other outcome** pays through the session 11 carry: `owed = bet × net_k + carry`, `paid = Math.round(owed)`, `carry = owed − paid`. That includes partial losses (−1 < net < 0).
- Why the two exemptions: a binary loss has always been exactly −bet, even when the carry is ±0.5 (`Math.round(−bet + 0.5)` would give −bet + 1). The exemptions keep binary games bit-identical, and they are exact accounting anyway (the exact change is a whole number of cents).
- `|carry| ≤ ½¢` still holds, so over any session |total paid − total exact| ≤ ½¢ (plus float noise).

**The strategy result.** `update(state, result, ctx)` receives

```ts
interface RoundResult { kind: "win" | "loss" | "push"; outcomeIndex: number; profit: number }
```

- `profit` is the EXACT profit `ctx.lastBet × net_k` in fractional cents, not the cents actually paid (those differ by the carry).
- `kind` follows the sign of `profit`: `"win"` if > 0, `"loss"` if < 0, `"push"` if 0. It depends on the outcome alone, so the same draw gives the same kind in every strategy.
- For binary games `profit` equals the old `placed × netPayout` on a win and `−placed` on a loss, bit for bit. Oscar's Grind and rule cycle profit use it and stay bit-identical.
- **On a push the runner does NOT call `update`:** state is unchanged, and streaks neither extend nor break. The runner's own `longestLosingStreak` also neither extends nor breaks on a push. The round still counts (`rounds`, `totalWagered`, observers).
- The runner gains an optional `onRound(roundsBefore, bet, result)` in `RunOptions`, called after EVERY resolved round (pushes included). Replay records bets and the outcome strip through it, because wrapping `update` would miss pushes. Sessions without it pay only a branch check.

### Legacy `ctx.game` fields (an approximation for multi-outcome games)

`ctx.game` is `{ outcomes, winProb, netPayout, edge }`.
- `winProb` = Σ prob over outcomes with net > 0.
- `netPayout` = the net of the winning outcome when there is exactly ONE (bit-exact for binary games). Otherwise it is the probability-weighted mean net over the winning outcomes. With no winning outcome, both are 0.
- **Oscar's Grind uses these.** Its cap `ceil((goal − cycleProfit) / netPayout)` assumes every win pays `netPayout`. On a multi-outcome game that is an APPROXIMATION: a win can pay more or less, so a cycle may close above or below exactly +1 unit. Its cycle-profit bookkeeping uses the exact `result.profit`.

### Kelly, generalized

- `f*` maximizes `G(f) = Σ probᵢ × log(1 + f × netᵢ)` over `0 ≤ f < f_max`, where `f_max = 1 / (−min netᵢ)` when some outcome loses money.
- **G is concave**, so it is solved by bisection on `G′(f) = Σ probᵢ netᵢ / (1 + f netᵢ)`, a decreasing function: 200 fixed iterations, deterministic.
- **`G′(0) = −edge`.** If it is ≤ 0, `f* ≤ 0`: Kelly says do not play and returns `"stop"`, as today.
- **If NO outcome loses money** (every net ≥ 0, some > 0), G grows without bound, so `f*` is capped at 1 (the whole bankroll). That game cannot lose money; the editor warns about it.
- **Legacy binary games** (exactly 2 outcomes, the first with net > 0 and the second with net = −1) keep the closed form `(b p − q) / b`, so every existing result stays bit-identical. A test runs the solver on binary games and requires agreement with the closed form to 1e-12.
- **`assumedWinProb` applies only to binary games.** The field carries a new generic `FieldSpec` flag `binaryOnly: true`: SchemaForm disables it on multi-outcome games with the note "Applies only to win/lose games; ignored here", and Kelly ignores it there (it uses the game's true probabilities).

### The editor: two input modes

The game list reads "Custom (win or lose)" (the binary editor, as before), **"Custom outcomes"** (opens a starter: a $10 ticket paying $20 or nothing at 1/2 each) and **"Ticket example ($70; prizes $20, $50, $100)"** (loads the example into the same editor, presetId `"outcomes"`). Rows: 1 to 12, with add and remove.
- **Ticket mode:** a price P plus a prize per outcome. `net = (prize − P) / P` (computed this way, not `prize / P − 1`). A prize equal to the price is labeled "push".
- **Multiplier mode:** the gross return per $1 staked per outcome (0 = stake lost, 1 = push, 2 = even money). `net = r − 1`, with the decimal float artifact snapped by the existing `snapShortDecimal` (1.91 → 0.91 exactly).
- **Probability fields** accept a decimal (`0.25`, `.5`) or a fraction of two whole numbers (`1/6`). They are parsed EXACTLY into BigInt rationals (a decimal is a rational too: 0.25 = 25/100). The sum is checked in exact rational arithmetic (`1/6 + 3/6 + 2/6` is exactly 1), within the same 1e-9 tolerance as the engine. The engine receives `num / den` as a float.
- **Rejected with readable messages:** `1/0`, `abc`, negatives, 0, empty, more than 40 characters, and anything else outside the grammar (`^\d+/\d+$` or a plain non-negative decimal).
- **Live readout:**
  - the sum of probabilities (exact);
  - the mean return per $1 (and the mean prize in ticket mode);
  - the edge, as house or player;
  - a plain warning when every outcome returns at least the stake: "Every outcome returns at least your stake, so this game cannot lose money."
- Tone rules unchanged: educational, no casino or lottery-operator names, no "winning" language.

### The replay strip

It is still drawn ONCE (CRN: every strategy saw the same outcomes).
- **Binary games:** unchanged (tall = won, short = lost).
- **Multi-outcome games:**
  - Bar height = (level + 1) / levels, the level being the outcome's rank by net (lowest net = shortest bar; equal nets share a level).
  - An HTML legend under the strip names every level ("Level 2 of 3: $50"), from the outcome's label or its return; the canvas exposes `data-levels` and `data-pushes`.
  - **Pushes are drawn as a hollow outlined bar** at their level.
  - Neutral grays only, never color alone.
  - Long sessions (bucketed): bar height = the mean level of the bucket.
- The strip stores per-round outcome indices (`Uint8Array`); a bucketed strip stores per-bucket level sums and counts.

### Scenario v4 and links

- **`ScenarioConfig.version` = 4.** `game = { presetId, outcomes: { prob, net, label? }[], sports?, editor? }`.
- **Sources of truth:**
  - presets and the binary custom game: `outcomes`;
  - sports: the odds inputs (outcomes re-derived, as in v3);
  - editor games: `editor = { mode: "ticket" | "multiplier", price, rows: { prob: string, value: number, label?: string }[] }`, with `outcomes` re-derived and re-synced on every edit and load and checked by `validateScenario`.
- **Probability TEXT is stored** (`"1/6"`), so a link reproduces exactly what was typed.
- **`migrateScenario` v3 → v4:** `{ winProb, netPayout }` becomes `[{ prob: winProb, net: netPayout }, { prob: 1 − winProb, net: −1 }]`. Converting back reads `outcomes[0]`, so the round trip is exact. Chained after v1 → v2 → v3.
- **Link key map (`g`), v = 4:**
  - Presets: the preset id, as before.
  - The binary custom game: `[presetId, winProb, netPayout]`, as before.
  - Sports: `["o", …]`, as before.
  - Editor games: **`["m", mode "t" | "x", price, [[probText, value, label?], …]]`**. `price` is `null` in multiplier mode.
  - v1–v3 links decode EXACTLY as before, then migrate.
  - The size test adds a 12-outcome game.

### Worked examples

**1. The ticket game** (probabilities 1/6, 3/6, 2/6; prizes $20, $50, $100). The mean prize is (20 + 150 + 200) / 6 = **$61.67**.

| Price | Nets | Mean return per $1 | Edge | Kelly |
|---|---|---|---|---|
| $70 | −5/7, −2/7, +3/7 | 37/42 = 0.880952 | **5/42 = 11.905% house edge** | G′(0) = −5/42 < 0: stops |
| $60 | −2/3, −1/6, +2/3 | 37/36 = 1.027778 | **−1/36 = 2.778% player edge** | G′(0) = +1/36: bets f* = 0.119801 (f_max 1.5) |

- `ctx.game` at $70: winProb 1/3, netPayout 3/7. At $60: winProb 1/3, netPayout 2/3.
- Draw bounds: `cum` = [0.16666666666666666, 0.6666666666666666, 1 (forced)].
- The invariant predicts EV per $ wagered = −edge: −11.905% at $70 and +2.778% at $60, for EVERY strategy.

**2. A game with a push:** win 0.44 at gross 2 (net 1), push 0.10 at gross 1 (net 0), lose 0.46 at gross 0 (net −1).
- Edge = 1 − (0.88 + 0.10 + 0) = **2%** (house edge).
- A push returns the stake: the bankroll and the carry are unchanged, and `update` is not called, so a Martingale at level 3 stays at level 3 across it.
- Kelly: G′(0) = 0.44 − 0.46 < 0, so it stops.
- Every strategy's EV per $ wagered must be −2%. Pushes count in the amount wagered, which is why EV per $ is −2% and not −2% / 0.9.

**3. European roulette, even money, as outcomes:** `[{ prob: 18/37, net: 1 }, { prob: 19/37, net: −1 }]`.
- Edge = 1 − (18/37 × 2 + 0) = **1/37 = 2.703%**, the same bits as before.
- Draw: `u < 18/37` wins, as before.
- Every existing result is bit-identical (the session 11 and 12 goldens, the invariant tables, CRN and draw count).

---

## Roadmap

Sessions run in this order. Each ends with `npm run test` and `npm run build` clean, a push, and a STATUS update.

1. **Infrastructure (session 1):** scaffold, repo, rng/games/runner, flat reference strategy, stats plug-in layer with starter stats, montecarlo, worker with progress and cancel, schema-driven UI shell, this file.
2. **Strategy archetypes:** Martingale, Paroli, D'Alembert, Fibonacci, each with progression tests and the per-strategy invariant test. Martingale analytic check: with bankroll B, base b, multiplier m, no tableMax, and stopWin = start + b (one cycle), P(bust) matches (1−p)^k within 4 SE, where k is the largest integer with b(m^k − 1)/(m − 1) ≤ B. Table-max check: with tableMax set, the capped bet is asserted and one-cycle recovery visibly fails.
3. **Statistics:** p5/p25/p75/p95 final bankroll, P(profit > 0), P(bust) = ruin + insufficientFunds, P(hit stopWin), max drawdown and longest losing streak summaries, SE shown for EV per $, final-bankroll histogram, percentile bands over time (subset of ≤2000 sessions, ≤200 checkpoints, early-ending sessions carry their final bankroll forward). P(profit > 0) sits next to EV per $ because that contrast is the lesson.
4. **Charts:** evaluate uPlot vs. canvas; sample-path spaghetti + percentile bands, final-bankroll histogram, single-session replay. Sample-path downsampling must preserve extrema and the final point (e.g. min/max per bucket), never plain stride; stride hides the bust. (Downsampler done in session 3; charts rendered in session 4.)
5. **More strategies:** Labouchere, Oscar's Grind, Kelly. (Also adds `ctx.game` to the strategy contract, and the replay zoom + chart hover readouts.)
6. **JSON rule builder:** user-defined strategies compiled into the same Strategy contract. Custom Labouchere sequences (beyond the presets) belong here.
7. **URL-serialized scenarios:** encode ScenarioConfig in the URL. (Done in session 7; see "URL scenario format".)
8. **Sports-odds mode:** American/decimal odds input, vig, derived winProb and netPayout. (Done in session 8; see "Sports odds".)

The original roadmap is complete. Candidates beyond it (not scheduled; see STATUS "Still open"):

- **Vercel (optional later):** deploy the same build at a domain root with `VITE_BASE=/` (the default). No code change is needed.

- ~~**Pushes (three-way outcome).**~~ **Done in session 13:** any number of outcomes per game, pushes included (see "Multi-outcome games").
- **Three-way sports lines** (a draw or a push priced by the market): sports mode is still two-way. Needs a three-way de-vig spec on top of the session 13 outcome model.
- **Result allocation in the round loop** (session 13 measurement, see STATUS 116): the per-round `RoundResult` object costs about 8% on the benchmark. Reusing one mutable object recovers about half but weakens the purity guarantee; a decision for the owner, not taken.
- **Parlays:** multi-leg bets whose legs all must win. Out of the two-way model; needs a spec for leg correlation (independent legs only?).
- **Other de-vig methods:** power, Shin, additive. Each gives a different fair p for the same prices. They would be alternatives to proportional de-vig in `odds.ts`, with hand-computed tests like the proportional ones.

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

Session 4 (2026-09-23). `npm run test` (194 passed, 2 benchmark tests skipped), `npm run build` and `oxlint` all clean under strict. `git diff cf0d8e5..HEAD -- src/engine/runner.ts src/engine/montecarlo.ts src/engine/stats/` is EMPTY.

29. **Chart library spike:** see the Decisions table (raw canvas 9.4–10.5 ms vs uPlot 38.6–61.8 ms for 6 panels; +0.8 KB vs +21.8 KB gzip). Spike branch deleted, never pushed.
30. **Adapters** (`adapters.test.ts`, 17 tests):
    - Fan y range is shared and computed over ALL strategies (a tall path in one strategy sets every panel's top), and it starts at 0.
    - On a real 5-strategy run, every panel's data fits the one range.
    - Histogram % sums to 100 per strategy. Linear y is shared and starts at 0.
    - Log mode turns empty bins into gaps (never log 0). Its y floor is the power of ten below the smallest nonzero % across all strategies.
    - Replay: one x range for all three strips, spanning the longest strategy; y from 0.
    - Bucketed strip win rate within 4 SE of 18/37 (z = −1.45).
    - Also: ticks, nearest-path hit test, colors, tick labels.
31. **Replay determinism** (`replay.test.ts`):
    - At maxRounds 20,000 (downsampled replay), the re-simulated session i's path EXACTLY equals the stored sample path i for i < 50, for all 5 strategies (117,833 points compared; the longest session ran 20,000 rounds).
    - At maxRounds 3,000 (full replay), downsampling the full path gives the stored sample path, for i < 50.
    - Win/loss sequences are identical across strategies over overlapping rounds (100 sessions, lengths differ). The strip equals the longest strategy's sequence.
    - Recorded bets equal |bankroll change| on even money and are exact on a 1.2 payout. The recording wrapper leaves every session identical.
32. **Manual** (`npm run build` + `npm run preview`, bundle `index-Co9th7O4.js` 82.30 KB gzip; tab hidden / unfocused as in sessions 1–3). With the NEW defaults (10,000 sessions, seed 12345), displayed exactly:

    | Row | Flat | Martingale |
    |---|---|---|
    | EV per $ wagered | -2.758% | -2.909% |
    | SE of EV per $ | 0.042% | 0.432% |
    | z vs theory | -1.33 | -0.48 |
    | P(profit > 0) | 53.760% | 82.930% |
    | P(bust) | 1.600% | 17.070% |
    | P(hit win target) | 53.170% | 82.930% |

    - **Fan:** both panels show identical axes, y $0–$2,000 and x 0–1,000 rounds (screenshot). Martingale's sessions average 18.6 rounds, so its fan is squeezed at the left: the shared axis doing its job.
    - **Histogram log toggle:** shared 0.01%–100% axis. Martingale's ~83% spike at the target and its bust cluster around $360–$450 are both readable; empty bins show no bar.
    - **Replay session 0** (typed into the Session input): both reach the win target, Martingale after 16 rounds and Flat after 28. The bet strip shows Martingale's ladder $10→$20 (three times) then $10→$20→$40→$80, with the round-16 win reaching $1,100. Flat stays at $10.
    - **Replay of a Martingale bust:** clicking a low Martingale sample path (by screen position) picked **session 31**. Martingale couldn't cover the next bet after 11 rounds ($390, bets up to $320) under the same early losing streak Flat saw. Flat played all 1,000 rounds and ended at $600.
    - **Theme:** switching Light → Dark → Light → System. An exact-pixel count of the Flat fan canvas shows the series color flipping completely: #0072b2 737 → 0 and #56b4e9 0 → 737 on Dark, then back on Light (668 / 0). Page background, swatches, legend and replay follow. No console errors.
    - **Click methods:**
      - Worked: `form_input` for selects; element-ref clicks for Run, the Session input and Replay (after a screenshot woke the tab); a screen-position click to pick the sample path.
      - Failed: one position click on Run missed after the new header row moved the button.

Session 5 (2026-09-23). `npm run test` (235 passed, 2 benchmark tests skipped), `npm run build` and `oxlint` all clean under strict. `git diff 4e214ec..HEAD -- src/engine/montecarlo.ts src/engine/stats/` is EMPTY: the pipeline and stats layer were not touched. Three strategies added (Labouchère, Oscar's Grind, Kelly), one contract change (`ctx.game`), plus replay zoom and chart hover readouts. **Ran on macOS / zsh this session, not Windows/PowerShell** (see the flag in the report) — the npm scripts are cross-platform, so build/test/lint are unaffected.

33. **`ctx.game` contract change:** the runner now fills a read-only `{ winProb, netPayout, edge }` on `ctx`, computed once per session. The five existing strategies ignore it, so their exact-sequence tests pass unchanged (only the ctx fixtures gained the field). `isolation.test.ts` still passes (no RNG in the engine), confirming reading the game does not affect CRN.
34. **Labouchère** added as one file + one registry line. Exact sequences (no runner): restart cycle `[L,W,W,W] → 500,600,600,300,500`; linear growth on a losing streak `[L,L,L] → 500,600,700,800`; onComplete **stop** `[W,W] → 500,500,"stop"` vs **restart** `[W,W] → 500,500,500`; a `2-2-2-2` preset at base $5. Purity (immutable line and preset). 
35. **Oscar's Grind** added the same way. Exact sequences: even money `[L,L,W,W] → 100,100,100,200,100` and `[W] → 100,100`; the **cap on payout 1.2** `[W] → 84,84` (one 84¢ win pays 100.8¢ ≥ the $1 goal) and `[L,W] → 84,100,54` (the raised u=2 bet 200 is clamped to the 54¢ that closes the cycle). Purity. Profit is tracked from `ctx.lastBet` and `ctx.game.netPayout`.
36. **Kelly** added the same way. f* ≤ 0 → `"stop"` (`[W,W] → "stop","stop","stop"` at true even money; `assumedWinProb 0.4 → "stop"`). f* > 0 stakes fraction × f* × bankroll (rounded): assumed 0.6 full → 2e8, half → 1e8; payout 2 assumed 0.5 → 2.5e8. Purity.
37. **EV-per-$ invariant, all EIGHT strategies × THREE games** (4 SE, SE from samples), every |z| < 4:

    | Strategy | European z | Fair coin z | posEdge (+10%) z |
    |---|---|---|---|
    | flat | −0.35 | −0.40 | 0.82 |
    | martingale ×2 | 0.02 | 0.56 | 2.15 |
    | paroli cap 3 | −0.67 | −0.65 | 0.06 |
    | d'alembert 1 | 0.23 | −0.31 | 1.23 |
    | fibonacci | 0.05 | −1.13 | 0.50 |
    | labouchere 1-2-3-4 | −1.12 | −0.30 | 1.19 |
    | oscars | 0.71 | −1.12 | 2.02 |
    | kelly (assumed 0.6) | −0.56 | 1.14 | −0.30 |

    The positive-edge game (edge −0.10, expected EV/$ = +0.10) is the sign check: EV per $ = −edge whether the house or the player has the edge.
38. **Kelly growth check** (p = 0.55 even money, no stops, 200 rounds, $1M start, 4,000 sessions sharing seeds via CRN). Mean log(final/start): half = 0.76, **full = 1.02**, double = 0.011 — full Kelly highest. Paired differences: full−half mean 0.261, SE 0.011, **z = 23.0**; full−double mean 1.010, SE 0.023, **z = 43.7** (both ≫ 4). Double Kelly's median final **$972,828 < $1,000,000 start** (over-betting loses ground). No session ruined, so every log was finite.
39. **CRN across all EIGHT strategies:** the crn test's id-list assertion and the 50-sample-path pairwise-equal check now include Labouchère, Oscar's and Kelly (Kelly given a misjudged edge so it wagers).
40. **Chart adapters** (pure, tested): `nearestIndex` (ascending nearest, ties low, end-clamped), `firstEndingRound` (earliest strategy end, ≥ 1), `zoomFromDrag` (ordered, clamped to the full range, rejects a click-sized span). 20 adapter tests pass.
41. **Programmatic evidence for the UI claims** (throwaway test, not committed; 10,000 sessions, European, seed 12345): Kelly default (assumed 0) → **100% strategyStop, EV per $ = NaN → "—", 0 rounds**; Kelly assumed 0.55 → it **bets** (0% strategyStop), **EV per $ = −2.690%** (≈ −edge = −2.703%), z = 0.08.
42. **Production build serves:** `npm run build` + `npm run preview` served bundle `index-BKlqEj5h.js` (84.94 KB gzip); the JS and the worker returned 200. Not driven in a browser this session (no browser automation available) — the visual/interaction pass is owner-run (see "Built but not yet verified").

Session 6 (2026-09-23, Windows / PowerShell). `npm run test` (391 passed, 2 benchmark tests skipped), `npm run build` and `npm run lint` (oxlint) all clean under strict. `git diff ecf2f36..HEAD -- src/engine/runner.ts src/engine/montecarlo.ts src/engine/stats/` is **EMPTY**. Delivered: the JSON rule language (progression + sequence), a closed-grammar validator, a compiler into the Strategy contract, the builder UI (form, JSON, live preview), worker plumbing, and the `optionalNumber` field with Kelly migrated onto it. The spec was committed before any code (`48e609b`).

43. **Validator** (`validate.test.ts`, 55 tests):
    - Every condition type (both bankroll ops) and every action type is accepted, as conditional entries and as the default.
    - Every numeric field is accepted at its min and max and rejected just outside. Integer fields reject a fraction. Every numeric field rejects NaN, Infinity, −Infinity, a string and null.
    - Lists: 1 and 10 entries are accepted, 0 and 11 rejected. Line length: 1 and 20 accepted, 0 and 21 rejected. A 1,000,000-element line gives one error without being iterated.
    - Name: 1 and 40 characters are accepted. Empty, blank, 41 characters, control characters and non-strings are rejected.
    - Also rejected: unknown keys at every level, `__proto__` and `constructor` from `JSON.parse` (and `Object.prototype` stays unpolluted), unknown kinds and types, missing fields, lists or null where objects belong, a default entry with a condition, and a non-final entry without one.
    - A Proxy whose `getPrototypeOf` throws, a `Date`, and an object with inherited keys are all rejected without throwing.
    - An exact error string is asserted: `onLoss entry 2 → action → by: must be between 0.1 and 10 (got 12)`.
44. **No code evaluation** (`noEval.test.ts`): a static scan of `src/engine/rules/`, `src/ui/rules/`, `src/worker/` and `src/scenario.ts` finds no `eval(`, `["eval"]`, `Function(`, `new Function`, `import(`, string `setTimeout` / `setInterval`, or `.constructor(`. A self-test shows each pattern catches its banned form. The engine isolation test covers `rules/` too.
45. **Compiler** (`compile.test.ts`):
    - The three CLAUDE.md worked examples give the exact documented ladders. Example 3 runs through the runner: bankroll 100 → 110, 100, 110, 120, then strategyStop with 4 draws.
    - Exact sequences for lossStreak + set, cycleProfit at payout 1.2, resetCycle zeroing the cycle, betUnits, bankroll ≤, first-match-wins with a shadowed entry, stop staying stopped, and custom lines.
    - Units clamp to 0.01. A 400-loss ×10 streak caps at `MAX_SAFE_INTEGER` and stays finite.
    - Cycle profit counts the PLACED bet. Under a tableMax clamp, intended 400 → placed 200, the rule does NOT stop where counting the intended bet would have. The rule stops exactly on round 6.
    - Every example passes `expectPure`. Mutating the caller's object after compiling changes nothing.
46. **Equivalence** (`equivalence.test.ts`): 10,000 sessions per pair per scenario, `SessionResult`s compared as whole JSON, full paths for the first 200. **0 mismatches** in all 8 comparisons:

    | Built-in vs rule | App default (rounds) | Invariant, tableMax clamp + stops (rounds) |
    |---|---|---|
    | Martingale ×2 | 185,665 | 1,997,899 |
    | Paroli cap 3 | 2,844,646 | 8,977,660 |
    | D'Alembert 1 | 299,115 | 1,632,283 |
    | Labouchère 1-2-3-4 | 73,629 | 582,946 |

    End reasons covered stopWin, stopLoss, ruin, insufficientFunds and maxRounds. **Negative control:** Paroli with plain `reset` instead of `resetCycle` differs in 904 of 1,000 sessions, so the comparison can fail.
47. **Fuzz** (`fuzz.test.ts`, seeded mulberry32):
    - The generator produces 200 valid rules (≈85% progressions), covering both kinds and every condition and action type.
    - Each ran 1,000 sessions of the invariant scenario with maxRounds 200:
      - **European:** 15,481,638 rounds, **worst |z| = 3.62** (rule 93), z mean −0.15, sd 1.10.
      - **p = 0.55:** 14,467,263 rounds, **worst |z| = 2.77** (rule 132), mean −0.17, sd 1.05.
    - Every result was finite integer cents, with nothing thrown and no NaN.
    - The 3.62 was checked, since the project rule presumes the engine is wrong until shown otherwise. On three fresh seeds with 20,000 sessions each, rule 93 gave z = −0.43, −0.12, 0.90 and rule 132 gave −0.89, −0.22, −0.43. It was sampling luck at n = 1,000, not a bug.
    - **200 invalid rules** (11 corruption kinds): all returned `ok: false` with messages, none threw, and `compileRule` threw `Invalid custom rule: …` for each. The test's own generator had one bug: it produced a valid `{type:"reset"}` action. That was fixed in the test; the validator was not changed.
48. **CRN with a custom rule:** the crn test adds one non-example rule (cycle-profit stop, streak resetCycle, add, set, ×1.5) beside all eight built-ins. All 50 sample sessions match pairwise over 243,465 rounds, and the custom rule played 2,898 rounds.
49. **Worker plumbing:**
    - `resolve.test.ts`: built-ins come from the registry. Custom rules are compiled from data, with id `custom` and label = name. An invalid rule fails the request with `Strategy 2: Invalid custom rule: unknown key "code" …`.
    - Scenario tests: a custom instance round-trips as JSON, validates with the same validator, and is sent to the worker as `{ kind: "custom", rule }`. v1 → v2 migration adds `kind: "builtin"`.
    - `format.test.ts`: labels use the rule name, number duplicates, and fall back to "Custom rule".
50. **Preview adapter** (`preview.test.ts`): hand-written scripts give these ladders:
    - Martingale rule `LLLWLW` → 1, 2, 4, 8, 1, 2, next 1, with bankroll $990, 970, 930, 1,010, 1,000, 1,020.
    - Paroli `WWWWLW` → 1, 2, 4, 1, 2, 1, next 2. D'Alembert `LLWWW` → 1, 2, 3, 2, 1. Sequence `LWWW` → 5, 6, 6, 3, next 5.
    - A stop partway through ends the ladder after 2 rounds. Payout 1.2 is honored. Case, spaces and dashes are ignored.
    - Bad characters, 101 rounds and invalid rules each give a message.
    - The builder's form helpers (`edit.test.ts`): add, move and delete keep the default last, and every produced rule validates.
51. **Optional number + Kelly:**
    - `optionalNumber` validation: absent or undefined is valid; 0.01 and 0.99 are accepted; 0, 1, NaN, Infinity, strings and booleans are rejected.
    - Kelly's default config is `{ fraction: 1 }` with no `assumedWinProb` key.
    - **Migration:** v1 Kelly `{ assumedWinProb: 0, fraction: 0.5 }` becomes `{ fraction: 0.5 }`, and 0.6 is kept. Unmigrated, 0 is flagged out of range.
    - **Behavior unchanged:** blank equals an explicit true p, session for session, over 2,000 sessions each on p = 0.55, on p = 0.4 with payout 2, and on European (0 rounds: it still refuses to bet).
    - The session 5 Kelly numbers reproduce exactly: growth z = 23.0 / 43.7, double-Kelly median $972,827.65, invariant z −0.56 / 1.14 / −0.30.
52. **The manual scenario, run programmatically through the app's own code path** (throwaway test, not committed: `toSimRequest` → `resolveStrategies` → `runMonteCarlo` / `replaySession`). Default scenario, 10,000 sessions, seed 12345, Martingale ×2 beside a hand-built rule "Double after 2 losses" (`lossStreak ≥ 2` → ×2, otherwise keep; win → reset):
    - Preview `LLLWLW` → 1, 1, 2, 4, 1, 1, next 1.
    - EV per $: Martingale **−2.909%** (SE 0.432%, z −0.48; identical to STATUS 32), rule **−2.547%** (SE 0.327%, z 0.47).
    - P(profit): 82.930% vs 82.730%. P(bust): 17.070% vs 17.270%.
    - Replay of session 0: Martingale reached the target in 16 rounds, the rule in 23.
    - A pasted rule with `"script":"alert(1)"` gives `unknown key "script" (allowed: kind, name, startUnits, onWin, onLoss)`. Non-JSON gives `Not valid JSON: Expected property name or '}' in JSON at position 2 …`.
53. **Production build serves:** `npm run build` + `npm run preview` served `index-zTg6uhW-.js` (92.11 KB gzip) and `sim.worker-B2nJLaBe.js`, all 200. The bundle contains the picker's custom-rule group, and the worker contains the rule compiler. **Not driven in a browser:** the Claude-in-Chrome extension was not connected (2 attempts), so the visual pass is owner-run (below).

Session 7 (2026-09-23, Windows / PowerShell). `npm run test` (452 passed, 2 benchmark tests skipped), `npm run build` and `npm run lint` all clean under strict. `git diff 85ce2af..HEAD -- src/engine/runner.ts src/engine/montecarlo.ts src/engine/stats/ src/engine/rules/validate.ts src/engine/rules/compile.ts` is **EMPTY**. The only engine change is `rules/noEval.test.ts`, whose scan was extended to the link code. Delivered: scenario links (codec, size budget, load path, save path, v1 migration, malicious-input hardening, UI). **This closes the "custom rule is lost on reload" gap:** after Copy link, the address bar holds the link, and a reload restores the scenario, rules included (verified at the code level; the in-browser reload is on the owner checklist).

54. **Round trip** (`roundtrip.test.ts`): each case is encoded, decoded, and passed through `migrateScenario`, which returns the SAME object (version unchanged). The result deep-equals the original, uids aside, with nothing dropped and nothing left out. Cases:
    - all 8 built-ins with default configs (the maximum);
    - all 8 with every setting changed (Kelly with 0.61 and with blank);
    - the 4 session 6 example rules, the blank rule, and a hand-built rule with every field non-default: 4 + 10 entries, every condition and action code, a non-ASCII name, values at range edges (0.01, 1,000,000, -1000, 999.99);
    - every top-level field non-default (custom game 0.4712345678901234 / 1.0833333333333333, $1,234.56 bankroll, table max, win target, stop-loss floor, all-in, 777 rounds, 25,000 sessions, seed 4,294,967,295);
    - each preset game. The default scenario's link is 191 characters.
55. **Size** (`size.test.ts`, 60-character address allowance):
    - The **typical scenario** (Flat, Martingale x2, Kelly 1/2, and a 4 + 6 = 10-entry rule, $250 table max) is **562 characters** (fragment 502 bytes); the budget is 2,000.
    - **8 x maximum-size rule** (10 + 10 entries, 40-character name): fits at **5,905** and round-trips exactly.
    - **Adversarial maximum** (17-digit numbers, 40 x "€" names): **12,155**, refused with "...over the 8,000-character limit... Nothing was copied..." and no fragment returned.
    - The whole-link cap includes the address.
56. **Load path** (`load.test.ts`):
    - A valid link loads with nothing dropped. Invalid fields each produce the exact reported message:
      - `b: -5` -> default, "Must be at least $0.01. The link had -5; using 1000."
      - `b: 5000` makes `sw: 1100` invalid -> win target off.
      - Wrong types (`bb: "10"`, `n: null`) are dropped at expansion.
      - Unknown keys (including `__proto__` from raw JSON) are reported.
      - Kelly `assumedWinProb: 5` -> reset to blank, Kelly kept.
      - Unknown strategy `doubleUpSystem`, a rule with `by: 50` (the validator's own message), and an unknown condition code -> each left out.
    - 12 strategies -> the first 8 load. None valid -> an empty list, which the app flags.
    - Fully invalid links (bad base64, `[1,2]`, not JSON, no version, `v: "2"`) -> error. `v: 3` -> "needs a newer version of the app".
57. **History** (verification 7, `load.test.ts`):
    - The same fragment handled 4 times in one page lifetime (initial, StrictMode, hashchange, popstate) applies **once**.
    - A fragment the app wrote itself (`markSeen`) is not loaded back.
    - **A new loader (a real reload) applies it again.**
    - Different fragments still load. Errors are applied once. The memory is bounded (50 fragments).
58. **Save path** (`save.test.ts`):
    - Valid scenarios copy completely.
    - An invalid rule and a built-in with `multiplier: 99` are left out (indices [1, 2]), and the link decodes cleanly to the other two.
    - Copy is blocked, with reasons, when: a scenario field is invalid, there are no strategies, none is valid, or there are more than 8.
59. **Migration** (verification 5, `migration.test.ts`):
    - A version-1 link with Kelly `{assumedWinProb: 0, fraction: 0.5}` loads as `{fraction: 0.5}` with **nothing dropped** (migrated, not reset), and 0.6 is kept.
    - The same 0 in a version-2 link IS reported. That contrast proves the path runs through `migrateScenario`.
    - Custom rules in a v1 link are left out. Versions 0, -1, 1.5, "1" and null are errors.
60. **Malicious input** (verification 4, `malicious.test.ts`; each decode asserted **< 50 ms** (SUPERSEDED in session 14 by counted stage inputs + a 1 s hang backstop; STATUS 118) and **< 2 MB of heap growth**, messages < 600 characters, dropped lists < 40; the file passed 5 runs in a row):
    - **Prototype pollution:** `__proto__` / `constructor` / `prototype` keys at the top, in configs, in the strategy list and in the game. Kelly never picks up a smuggled `fraction: 9`, and `Object.prototype` / `Array.prototype` have no keys afterward.
    - **Nesting:** 5,000-deep nesting inside the cap, nesting hidden in a valid payload, and deep objects are all rejected before `JSON.parse`. Brackets inside strings don't count.
    - **Size:** a **20 MB** string is refused by length without decoding. Within the cap: a 5,000-character name gets the validator's name error; 250 unknown keys at two levels give 12 summarized reports; a 2,000-item strategy list is only looked at up to 8.
    - **Invalid base64:** a bad character, `+` and `/`, padding, non-ASCII, percent-encoding, `<script>`.
    - **Truncation:** every truncation of a real link is an error.
    - **Invalid UTF-8.**
    - **Version:** `v: 999999` gives the newer-version message, and hostile versions are errors.
    - **Wrong types everywhere:** 9 hostile values x every key and rule position.
    - One test-side finding: the first heap measurement counted V8 flattening the test's own 20 MB concatenated input. The input is now flattened before measuring (a real `location.hash` is already flat).
61. **No code evaluation** (verification 6): `rules/noEval.test.ts` now also scans `src/share/**`, `ui/linkBoot.ts`, `ui/LinkBanner.tsx` and `ui/RunControls.tsx`. All are clean.
62. **Production build serves:** `npm run build` + `npm run preview` served `index-BBX1ndXj.js` (98.14 KB gzip) and the worker, both 200. The bundle contains "Copy link" and the newer-version and nesting messages. **Not driven in a browser:** the Chrome extension was not connected (3 attempts this session).

Session 8 (2026-09-23, Windows / PowerShell). `npm run test` (508 passed, 2 benchmark tests skipped), `npm run build` and `npm run lint` all clean under strict. `git diff 76a284f..HEAD -- src/engine/runner.ts src/engine/montecarlo.ts src/engine/stats/ src/engine/strategies/ src/engine/rules/compile.ts src/engine/rules/validate.ts` is **EMPTY**, and `games.ts` is untouched. The only engine changes are the new `odds.ts` and its three test files. **Sports odds compile to an ordinary Game; nothing downstream changed.** The spec was committed before any code (`ff25aae`).

63. **Conversions** (`odds.test.ts`, hand-computed):
    - American: +150 → 1.5; −110 → 100/110; −180 → 100/180; +100 and −100 → 1.
    - Decimal: 1.91 → 0.91 (the float artifact 0.9099999999999999 is removed); 2.50 → 1.5.
    - Implied probabilities: 0.4, 11/21, 9/14, 0.5, 1/1.91, 0.4.
    - Rejected with exact messages: −50, +99, 0, −99.99, NaN, ±Infinity, −100,001; decimal 1.0, 0.5, NaN, −Infinity, 1.0005, 1002.
    - The limits are inclusive (payouts 0.001 and 1,000 in both formats).
64. **Format toggle** (owner decision 6):
    - **American → decimal → American returns the original exactly** for −110, +150, −180, +100 (plus −250, 333, −105, 10,000, −100,000). −100 comes back as +100 (the same price).
    - Decimal → American → decimal round-trips for 1.91, 2.5, 1.5, 3.75, 1.001, 1,001.
    - A converted −110 is stored as 1.9090909090909092 and displayed "1.91". Its payout is within 2 ε of the American price.
    - Display rounding: whole American with a sign, 2-decimal decimals.
65. **De-vig** (`odds.devig.test.ts`, to 1e-15):
    - **−110 / −110:** implied 11/21 each, **overround 1/21 (4.762%)**, **fair p 0.5**, **house edge 1/22 (4.545%)** on both sides.
    - **+150 / −180:** implied 0.4 and 9/14, **overround 3/70 (4.286%)**, **fair p 28/73 (0.383562) and 45/73 (0.616438)**, **edge 3/73 (4.110%) on both sides**.
    - The identity edge = 1 − 1/sum holds on 2,000 random markets.
    - Decimal 1.91 / 1.91 gives p 0.5 and an edge of 4.5%.
    - +110 / +110 gives overround −4.762%, flagged as negative, with a player edge of 5%.
    - Errors are per field, and side B is ignored in estimate mode.
66. **Invariant** (`odds.invariant.test.ts`: 8 built-ins + a custom rule, the shared invariant scenario, 20,000 sessions each, 4 SE):

    | Strategy | −110 / −110 market: EV per $ (−edge −4.545%) | z | Estimate 0.55: EV per $ (−edge +5.000%) | z |
    |---|---|---|---|---|
    | flat | −4.520% | 1.17 | +5.022% | 1.03 |
    | martingale | −4.681% | −1.50 | +4.800% | −2.26 |
    | paroli | −4.558% | −0.48 | +4.996% | −0.15 |
    | dalembert | −4.509% | 0.69 | +4.970% | −0.59 |
    | fibonacci | −4.531% | 0.25 | +4.994% | −0.10 |
    | labouchere | −4.455% | 0.93 | +4.867% | −1.37 |
    | oscars | −4.561% | −0.26 | +4.969% | −0.56 |
    | kelly | −5.051% | −2.78 | +5.001% | 0.01 |
    | custom rule | −4.515% | 0.54 | +4.969% | −0.52 |

    - Worst |z| is 2.78 on the market and 2.26 on the estimate game.
    - On the market game, Kelly uses assumed 0.6: at the fair p it refuses to bet. On the estimate game, its default (blank = 0.55) bets.
    - Flat's cents-rounding shift and its rounding-aware z are printed; see "Cents rounding" (rewritten in session 11: the workaround and the second z were removed once the carry existed).
67. **Rounding bias** (directive 4):
    - The CLAUDE.md table is asserted to 1e-15: −110 flat at $1 / $5 / $10 / $25 gives +0.0455% / +0.0455% / −0.0045% / +0.0055%.
    - Worst case at $10 over 100,000 payouts: 0.02475% (bound 0.025%). −180 at $10: +0.0222%.
    - No invariant failed; the tolerance was not touched.
68. **Scenario v3** (`scenario.test.ts`):
    - A sports game compiles to `{ id: "sports", name: "Sports odds", winProb 0.5, netPayout 100/110 }` and is plain JSON.
    - Invalid odds give per-field errors (`game.sideA`, `game.sideB`, `game.estimate`), and the previous numbers are kept.
    - Stale derived numbers, missing inputs, and odds on a non-sports game are each caught.
    - **v2 → v3 migration leaves the game unchanged.** v1 → v3 chains.
69. **Links** (`sportslink.test.ts`, `size.test.ts`):
    - **7 sports scenarios round-trip bit-exactly**, inputs AND derived numbers: market American and decimal, side B, exact converted decimals, negative overround, and two estimate cases.
    - The link carries only the inputs `["o","m","a",-110,-110,"a",0.5]`.
    - **Golden:** the three session 7 links recorded in CLAUDE.md (v2 with a rule, v2 partial, v1 with Kelly 0) decode to EXACTLY what the session 7 decoder returned. That output was captured by running commit `76a284f` in a temporary worktree, since removed. Only the version (3) differs.
    - A sports game in a v1 or v2 link, invalid odds in a v3 link, and malformed sports arrays each fall back to the default game, reported.
    - **Typical scenario on a sports game: 590 characters** (budget 2,000).
70. **UI:**
    - `sportsReadout.test.ts`: the −110 / −110 lines read exactly 52.381% / 52.381% / 4.762% / 50.000% / 0.9091 / 4.545%.
    - A negative overround reads "rare in real markets and is usually a data-entry error".
    - A believed edge reads "believing you have an edge is not the same as having one". The push note is one line.
    - **Tone test:** no bookmaker names, links, "pick(s)", "sharp", "value bet", "guarantee", or "winning system" in the sports UI, readout, ConfigPanel or `odds.ts`. It caught my own comment listing the banned words, which was reworded.
71. **The manual scenario, run through the app's own code path** (throwaway test, not committed): default scenario on −110 / −110 with Flat + Martingale → `toSimRequest` → `resolveStrategies` → `runMonteCarlo`.
    - Readout as above. The decimal switch shows 1.91 / 1.91, stores 1.9090909090909092, and gives a bit-identical edge.
    - −50 gives the +100/−100 error.
    - **Flat EV per $ −4.590% (SE 0.036%, z −1.25), P(profit) 34.600%. Martingale −4.635% (SE 0.352%, z −0.25), P(profit) 79.610%, P(bust) 20.390%.**
    - The link is 209 characters and decodes to the identical game.
    - Build: `index-BlKlmlDe.js` 100.94 KB gzip.

Session 9 (2026-09-24, Windows / PowerShell). `npm run test` (508 passed, 2 benchmark tests skipped), `npm run build`, `npm run lint` and **`npm run e2e` (29 passed)** all clean. **CI run [35964572482](https://github.com/iangopen/strategylab/actions/runs/35964572482) was green** (lint, unit, build, e2e, build-pages, deploy), and so was **[35964910545](https://github.com/iangopen/strategylab/actions/runs/35964910545)** after the action bump. `git diff 8e6db6f..HEAD -- src/engine/` is **EMPTY**. There are no engine changes. The app changes are the Copy link base (drop `location.search`) and `data-*` / `data-testid` test hooks.

72. **Step zero:**
    - **Secret scan** of all 65 commits (committed env/key/credential files, and token/key patterns in every added line): **clean**.
    - **CLAUDE.md "binary" report:** not reproduced. The file is valid UTF-8 with no BOM and no NUL bytes, and git diffs it as text. The only file ever stored as binary is `README.md`, in the first two commits (the session 1 UTF-16 incident, fixed then).
    - `.gitattributes` (`text=auto eol=lf`) was added. `git add --renormalize .` changed no content.
73. **Base path:**
    - `VITE_BASE` is read in `vite.config.ts`. The Pages build rewrites every URL: `/strategylab/favicon.svg`, `/strategylab/assets/index-*.js`, and the worker as `new URL("/strategylab/assets/sim.worker-*.js", import.meta.url)`.
    - Copy link now uses `origin + pathname` only.
    - Test: `links.spec.ts` "SUB-PATH". A `#s=` link opened at `/strategylab/` loads the rule, runs with numbers equal to the engine's, and Copy link yields a URL containing `/strategylab/#s=`. That URL equals the address bar and loads the identical scenario in a new page, which runs to the engine's numbers.
    - `app.spec.ts` asserts that every request stays under `/strategylab/` and that nothing asks for `/src/`.
74. **E2E design (owner rules):**
    - Expected numbers are computed by running the same scenario through the engine in Node (`engineTable`), never hardcoded.
    - Specs assert state: text, and `data-*` attributes the canvases write (ranges, counts, zoom, hover round, theme, color, label boxes, draw count). There is also a canvas-not-blank pixel count.
    - No screenshot baselines, web-first assertions only, no sleeps, no skips.
    - `tsc -b` type-checks the specs, so a type error in a spec stops the E2E server from starting.
75. **Owner checklists → specs** (every item of sessions 1–8; nothing dropped):

    | Checklist item | Spec | Result |
    |---|---|---|
    | S1–3: speed in a focused, visible tab | `responsiveness.spec.ts` + a one-off run of the session 1 scenario | **visible + focused**. Session 1's flat 100k × 10,000: **30.0 s browser vs 28.0 s Node** (was 75.7–89.3 s hidden); mean final $93,257.60, identical to session 1 |
    | S5: all 8 strategies in the picker, forms from `configSchema` | `app.spec` "session 5: all eight…" | pass |
    | S5: Kelly form + help text | `app.spec` same test | pass |
    | S5: Kelly default 100% strategyStop → EV "—" | `app.spec` "default run…" | pass (the whole table equals the engine) |
    | S5: Start label doesn't overlap the win-target label | `app.spec` "charts…" (label boxes from `refLineH`) | pass |
    | S5: replay drag-to-zoom | `replay.spec` "drag-to-zoom…" | pass |
    | S5: "fit to first ending" on a Martingale bust | `replay.spec` (bust found by replaying in Node) | pass |
    | S5: double-click reset | `replay.spec` drag + fit tests | pass |
    | S5: fan + replay hover crosshair and readouts | `app.spec` "fan hover", `replay.spec` "hover" | pass |
    | S4: shared x/y ranges across panels | `app.spec` "charts…" (fan and histogram, linear and log) | pass |
    | S6.1: blank rule, swatch, Form/JSON tabs | `rules.spec` (1-3) | pass |
    | S6.2: build a rule, rename, ↑/↓/Delete | `rules.spec` (1-3) | pass |
    | S6.3: preview follows edits, `LLX` error, a stop | `rules.spec` (1-3) (preview = `previewRule` in Node) | pass |
    | S6.4: run beside Martingale: column, color, panels, numbers | `rules.spec` (4-5) | pass |
    | S6.5: replay includes the rule | `rules.spec` (4-5) | pass |
    | S6.6: pasted JSON: unknown key, not-JSON, fix → form returns | `rules.spec` (6) | pass |
    | S6.7: Kelly assumed probability blank | `rules.spec` (7) | pass |
    | S6.8: narrow width + dark theme | `layout.spec` (both tests) | pass |
    | S7.1: copy and reopen in a new tab; nothing auto-runs | `links.spec` SUB-PATH | pass |
    | S7.2: reload after copy keeps the rule | `links.spec` (2) | pass |
    | S7.3: garbage and cut-off fragments | `links.spec` (3) | pass |
    | S7.4: too large → error, nothing copied | `links.spec` (4) (6 adversarial rules; clipboard untouched) | pass |
    | S7.5: blocked copy + reason; Add disabled at 8 | `links.spec` (5) | pass. **Checklist wording corrected:** "clear Starting bankroll" does NOT block copying, because `NumberField` never commits unparseable text (session 1 design) and the scenario keeps its last valid value. The spec uses an invalid committed value (0). |
    | S7.5: "hovering shows the reason" | `links.spec` (5): the wrapper's `title` + the visible help line | pass. The browser's native tooltip rendering isn't inspectable, so the `title` attribute is asserted instead |
    | S7.6: v1 / partial / newer-version links | `links.spec` (6) | pass |
    | S7.7: Back doesn't re-apply a loaded link | `links.spec` (7) | pass |
    | S8.1–6: readout, decimal round trip, invalid odds, estimate, run, link | `sports.spec` (readout = `sportsReadoutLines` in Node) | pass |
    | "Vercel deploy: not connected" | dropped | Vercel is no longer the deploy target (Roadmap: optional later) |

76. **Bugs found:**
    - **App bugs found by E2E: none.**
    - One **test-infrastructure bug:** the Vitest default 5 s timeout. Commit `6f08221`: the equivalence test "Paroli cap 3, invariant" timed out once at 5,868 ms under parallel-file load (normally about 1.8 s). Its fixed-seed bit-identity assertion is deterministic, so it was the harness budget, not the engine. The fix is a suite-wide `testTimeout: 60_000`; no assertion changed.
    - Every E2E failure while writing the specs was a spec mistake, fixed in the spec before its first commit:
      - headless Chromium doesn't fetch favicons;
      - `getByLabel` on a `<select>` nested in its label matches the options' text, so specs query by role instead;
      - a raw mouse move missed an off-screen canvas;
      - locating a card by its name broke when the rule was renamed;
      - an over-broad error selector;
      - a data-attribute read before the first draw (`dataNum` now waits).
77. **Responsiveness** (`responsiveness.spec.ts`: 100k × 6, the Node benchmark scenario):
    - **Run 1:** typing into Base bet mid-run updated immediately while progress kept advancing. Cancel gave "Cancelled…".
    - **Run 2** (fresh worker): typing into Seed mid-run also updated. It finished in **20.4 s** (tab visible and focused), against **18.8 s for the same scenario in Node** in the test process, measured back to back.
    - **Long tasks: 0** during the run and 0 over the whole page life.
    - The results equal the engine's for the scenario at the click, and are correctly flagged stale.
    - This resolves the "browser 4–5× slower than Node" item from sessions 1–3: it was the hidden, unfocused automation tab.
78. **Deploy:**
    - Pages was already `build_type: workflow` when checked right before the push (it had been `legacy` earlier in the session, switched outside this session). `gh api -X PUT repos/iangopen/strategylab/pages -f build_type=workflow` (repo path updated after the rename) was run anyway, as instructed, and returned HTTP 204.
    - **Live:** the pre-rename Pages address → **200** (that address is now permanently 404; today's site is https://iangopen.github.io/strategylab/). The HTML references `/strategylab/assets/index-*.js` and **no** `/src/main.tsx`. The worker `/strategylab/assets/sim.worker-B2nJLaBe.js` → **200** (`application/javascript`). The favicon → 200.
    - **Live run:** headless Chromium (Playwright, local) opened the live URL and ran **1,000 sessions**: "Done: 1,000 sessions in 0.0s.", with EV per $ **−2.690% | −3.308%**, exactly the engine's numbers for that scenario. The worker loaded from the sub-path, with no console errors.

Session 10 (2026-09-24, Windows / PowerShell). `npm run test` (519 passed, 2 benchmark tests skipped), `npm run build`, `npm run lint` and **`npx playwright test` (36 passed)** all clean. **CI run [35971763924](https://github.com/iangopen/strategylab/actions/runs/35971763924) was green on `ubuntu-24.04`** (every job's runner label is `ubuntu-24.04`, with no annotations), and the Pages deploy succeeded. **No engine source changed.** The only `src/engine/` diff is the test file `rules/equivalence.test.ts`: its per-file 30 s timeout is exactly what directive 5 asked for, and that test can only live there.

79. **CI hygiene:**
    - Every job runs on `ubuntu-24.04`.
    - The suite-wide `testTimeout: 60_000` is gone. Only `equivalence.test.ts` has `{ timeout: 30_000 }`, with the reason in a comment. All 519 unit tests pass on the 5 s default.
    - `formatElapsed`: "<0.1s" under 100 ms (tested at 0, 1, 49 and 99.9 ms, plus 100 ms → "0.1s"). The counter shows "—" before the first run.
80. **Placeholder copy:**
    - `ChartSlot` now says what each chart will show and "Press **Run** above to simulate: this chart appears here."
    - No `later version` / `coming soon` string remains in `src/ui`. `charts.spec.ts` asserts the page has none before or after a run, and the live bundle has none.
81. **Reference labels:**
    - `placeLabels` is tested with the default spots, a same-end collision (it moves), a top-edge flip, padding, and a **2,000-case seeded property test** (never overlapping, always inside the plot).
    - E2E: every fan, replay and histogram label reports `knockout: true` and no pairwise overlap. That includes a crowded $995 / $1,000 / $1,005 case at 360 px, where a label is moved.
82. **Selected-path highlight:**
    - The replayed session is drawn last, 2.5 px `--text` on a 5 px `--panel` halo.
    - E2E: sessions 7 (light) and 31 (dark) report `data-highlighted` and the theme's `data-halo` on **every** panel. Session 500 (no sample path) highlights nothing.
83. **Fan zoom:**
    - **Adapters:** `activeRangeEnd` returns k+1 for bands that stop changing at k, the full range when they never stop, the first checkpoint when they never change, and responds to a single late-moving percentile. `zoomedFanScales` gives one x window and the SAME y object for any zoom.
    - **Real run** (default scenario): active range **Flat 1,000, Martingale 30 rounds**.
    - **E2E:**
      - A drag on the Martingale panel gives an identical `data-x-range` on every panel, with y unchanged, and the drag doesn't pick a path.
      - "Fit to this strategy" on Martingale gives `0-30` on every panel, equal to `activeRangeEnd` computed in Node from the same engine run.
      - The hover round stays inside the window. Reset and double-click restore `0-1000`. Fit on Flat gives the full range.
      - A new run starts unzoomed, and a click still picks a path while zoomed.
    - **Bug found by the existing replay spec while adding the zoom:** the new fan button was also named "Reset zoom", so the page had two same-named buttons (ambiguous for screen readers too). It was renamed "Show every round" before the commit was pushed.
84. **Live** (after the rename): `https://iangopen.github.io/strategylab/` → 200, with built assets only (0 references to `/src/main.tsx`), the worker → 200, and no stale copy in the bundle.
    - Headless Chromium against the live URL: the default run ("Done: 10,000 sessions in 1.0s."), then "Fit to this strategy" on Martingale → windows `0-30, 0-30`, labels with knockout, and no errors.

Session 11 (2026-09-24, Windows / PowerShell). `npm run test` (619 passed, 3 skipped: 2 benchmark tests + the golden writer), `npm run build`, `npm run lint` and **`npx playwright test` (36 passed, no spec edits)** all clean. **CI run [36057827693](https://github.com/iangopen/strategylab/actions/runs/36057827693) was green**: lint, unit, build, e2e, build-pages and deploy, every job on `ubuntu-24.04`. Delivered: the account rename (`origin` = `iangopen/strategylab`) and the **per-session sub-cent carry** on win payouts (see "Cents rounding").

85. **Rename:** `git remote set-url origin https://github.com/iangopen/strategylab.git`. `git remote -v` showed the new URL, and the push of `5d01387` succeeded. There are no old-account URLs left in the repo; the one remaining pre-rename reference is the Pages address, described in words as permanently dead.
86. **Golden bit-identity on even and integer payouts** (`runner.golden.test.ts`, 90 cells). Captured from the PRE-carry runner in commit `9d0cc24`, before `runner.ts` changed:
    - Games: European, American, fair coin, single number 35:1, dozen 2:1.
    - Scenarios: the invariant scenario (tableMax clamp, stops) and an all-in scenario.
    - Strategies: all 8 built-ins plus a custom rule.
    - Stored per cell: 50 full SessionResults plus an FNV-1a digest over 2,000 sessions with full paths.
    - **All 90 cells are identical after the carry.** The even-money columns of the invariant table (STATUS 90) also reproduce the session 5 z values exactly.
87. **Property test** (`runner.carry.test.ts`): 15,000 seeded sessions of random bets (up to $10M) and outcomes, checked after EVERY round against the exact rational total (BigInt). Named payouts, 2,500 sessions each:

    | Payout | Max \|paid − exact\| |
    |---|---|
    | −110 | 0.4545¢ |
    | +150 | 0.5000¢ |
    | decimal 1.91 | 0.5000001¢ |
    | 1.2 | 0.4000004¢ |
    | 5,000 random payouts (American, decimal, raw) | **0.50015¢** |

    - Every one is under the required 1¢.
    - Each round is also held to ½¢ plus ε × |owed| per win (float noise; the 0.00015¢ excess is at $10M bets on payouts near 1,000).
    - Also tested: the first win of every session pays `Math.round(bet × n)`, so no carry crosses sessions; and −110 at $5 pays 455, 454, 455, 454…, with 22 wins totaling exactly $100.
88. **Draws and CRN unchanged:** `runner.test.ts` (draws === rounds for every end reason plus 2,400 random sessions) and `strategies/crn.test.ts` have an EMPTY diff and pass.
89. **Regression** (`runner.regression.test.ts`): Flat, −110 / −110, $5 base, invariant scenario (stops on), 100,000 sessions, seed 1110. "Before" is the pre-carry runner on the same seeds (stored in the golden file).

    | Rule | EV per $ | SE | z vs −edge (−4.5455%) |
    |---|---|---|---|
    | before: `Math.round` per win | −4.4947% | 0.0096% | **5.29** |
    | after: sub-cent carry | −4.5401% | 0.0096% | **0.55** |

90. **Full invariant table** (`invariant.test.ts`: 20,000 sessions per cell, 4 SE; seeds 101 / 202 / 303 / 808 / 809). Every |z| < 4; the worst is Kelly on the market at −2.78, the same as session 8.

    | Strategy | European | Fair coin | p = 0.55 | −110 market | Estimate 0.55 |
    |---|---|---|---|---|---|
    | flat | −0.35 | −0.40 | 0.82 | −0.94 | −1.28 |
    | martingale | 0.02 | 0.56 | 2.15 | −1.55 | −2.31 |
    | paroli | −0.67 | −0.65 | 0.06 | −0.92 | −0.54 |
    | dalembert | 0.23 | −0.31 | 1.23 | 0.69 | −0.65 |
    | fibonacci | 0.05 | −1.13 | 0.50 | 0.06 | −0.41 |
    | labouchere | −1.12 | −0.30 | 1.19 | 0.91 | −1.39 |
    | oscars | 0.71 | −1.12 | 2.02 | −0.27 | −0.69 |
    | kelly | −0.56 | 1.14 | −0.30 | −2.78 | 0.01 |
    | custom rule | −0.16 | 0.12 | 1.07 | 0.42 | −0.64 |

    - It replaces `odds.invariant.test.ts`, and Flat's "rounding-aware" second z is gone: with the carry there is no shift to allow for.
    - The per-strategy `describeEvInvariant` tests and `customGame.test.ts` (payout 1.2, numbers changed) still pass unchanged.
91. **Tests that asserted the OLD rule, changed:**
    - `replay.test.ts` "exact on a 1.2 payout" now asserts each win equals the carry rule exactly, and Σ paid within ½¢ of exact.
    - The `payoutRoundingBias` tests in `odds.devig.test.ts` were deleted along with the helper.
    - No tolerance was loosened.
92. **Performance** (committed benchmark, `BENCH=1`, European 100k × 6, median of 3):
    - **Before 9.64 s** (9.62 / 9.64 / 9.72); **after 9.85 s** (9.78 / 9.85 / 9.93), so **+2.2%** (budget 5%).
    - Observer cost: plain 26.9 → 27.2 µs per 1,000-round session.
93. **Live** (headless Chromium, local Playwright, against `https://iangopen.github.io/strategylab/`, bundle `index-DO2qU1in.js`). The scenario was a `#s=` link: −110 / −110 market, $5 base, $1,000 bankroll, table $1–$250, win target $1,500, floor $500, Flat + Martingale, 100,000 sessions, seed 1110.
    - "Done: 100,000 sessions in 4.5s."
    - **z vs theory: Flat 0.55, Martingale −0.37.** EV per $ −4.540% / −4.560%, SE 0.010% / 0.040%.
    - **Every row of the results table equals the engine in Node**, and there were 0 console errors.
    - Flat's 0.55 is the regression test's number (same seed), so the deployed engine is the carry one.
94. **`src/engine/` diff since `5d01387`**, file by file:
    - `runner.ts`: the carry.
    - `odds.ts`: `payoutRoundingBias` deleted.
    - `rules/compile.ts`: cycle profit counts exact winnings (owner-approved option A, variant explained in Decisions).
    - `strategies/labouchere.ts`: help text.
    - `testUtils.ts`: the regression constants.
    - Test files: `runner.golden.test.ts` + `.json`, `runner.carry.test.ts`, `runner.regression.test.ts`, `invariant.test.ts` (renamed from `odds.invariant.test.ts`), `odds.devig.test.ts`, `replay.test.ts`.
    - Outside the engine: `src/ui/rules/preview.ts` pays with the same carry (option B).

Session 12 (2026-09-24, Windows / PowerShell). `npm run test` (632 passed, 4 skipped: 2 benchmark tests + 2 golden writers), `npm run build`, `npm run lint` and **`npx playwright test` (37 passed)** all clean. **CI run [36074254452](https://github.com/iangopen/strategylab/actions/runs/36074254452) was green**: lint, unit, build, e2e, build-pages and deploy, every job on `ubuntu-24.04`. Delivered: **adaptive band checkpoints** (`src/engine/checkpoints.ts`), a new working rule (stop and ask before changing an approved decision), and a fix for one flaky timeout.

95. **Schedule** (`checkpoints.test.ts`): every round 0..min(M, 64), then steps of min(ceil(M/200), max(1, floor(x/4))), with the last step clipped to M.
    - Checked for 1, 2, 63, 64, 65, 200, 1,000, 12,345 and 1,000,000:

      | maxRounds | Checkpoints | Widest gap (allowed) |
      |---|---|---|
      | 1 | 2 | 1 (1) |
      | 64 | 65 | 1 (1) |
      | 65 | 66 | 1 (1) |
      | 200 | 201 | 1 (2) |
      | 1,000 | 253 | 5 (8) |
      | 12,345 | 267 | 62 (97) |
      | 1,000,000 | 287 | 5,000 (7,813) |

    - **Exhaustive over EVERY maxRounds from 1 to 1,000,000** (2.6–2.8 s alone). Every one passes all three properties, starts at 0 and ends at M. The longest schedule is 287 (at M = 836,198); the limit is 320.
    - The widest gap is never larger than the old even spacing, so the new schedule is never coarser than before anywhere.
96. **Results did not move:**
    - **`montecarlo.golden.test.ts`** was captured BEFORE the wiring (commit `f44007c`): 4 scenarios (default, invariant, −110 market, 20,000-round American) × 9 strategies × 2,500 sessions (more than the 2,000-session band subset). It covers every stat as its exact decimal text, the end-reason counts, the shared histogram edges and counts, and a digest of every sample path. **Identical after the change.**
    - **Session 11's 90 runner golden cells, the invariant table and `customGame.test.ts` pass unchanged**, with identical printed z values.
    - **New observer-leak test:** `runSession` with a band observer on the new schedule deep-equals `runSession` without one (full paths included), for 9 strategies × 300 sessions.
97. **Band tests** (`bands.test.ts`):
    - The last checkpoint still equals the type-7 percentiles of the subset's finals, recomputed independently.
    - p5 ≤ p25 ≤ p50 ≤ p75 ≤ p95 at every one of the 253 checkpoints, for all 8 strategies.
    - Carry-forward holds for a session ending at round 1, both in the unit test and in a run where every session ends at round 1.
    - `r.bands.rounds` equals `checkpointRounds(1000)` exactly.
98. **"Fit to this strategy" on Martingale** (default scenario):
    - **Was 0–30 with 7 checkpoints; now 0–25 with 26 checkpoints, i.e. EVERY round 0..25.**
    - The window narrowed because the bands actually stop changing at round 24: the old 5-round grid overshot the end by up to 5 rounds.
    - E2E asserts `data-band-points` = window end + 1 = the engine's count, on every panel. The unit test asserts that the rounds inside the window are exactly 0..25.
99. **Non-uniform x** (every chart path reads the real `bands.rounds`; nothing assumed even spacing, so NO chart code needed fixing):
    - `fillBand`, `strokeLine` and `fanSeries` pass the rounds array through as x (asserted by identity).
    - `nearestIndex` is a binary search on values. It was tested on the real 1,000-round schedule at 2,700 cursor positions against brute force, including the 64 → 69 jump and the final 999 → 1000 gap.
    - `activeRangeEnd` returns actual checkpoints in the dense, geometric and capped parts.
    - **E2E:** after zooming to 449–551 (21 checkpoints, 5 apart), hovering 30% and 70% of the way between rounds 464 and 469 snaps to 464 and 469.
    - The existing zoom, fit and hover specs pass unchanged.
100. **Performance and memory:**
    - Benchmark (`BENCH=1`, European 100k × 6, median of 3): **before 10.05 s** (9.92 / 10.05 / 10.29); **after 10.40 s and 10.08 s** on two runs (+3.5% and +0.3%). Both are inside the 5% budget.
    - Per-round observer cost is unchanged (the same one comparison per round): 29.1 → 28.7 µs plain, 126.9 → 122.3 µs observed.
    - **Peak band memory per strategy** (checkpoints × 2,000 sessions × 8 B): **1,000 rounds: 4.05 MB** (253 checkpoints; was 3.22 MB with 201). **1,000,000 rounds: 4.59 MB** (287 checkpoints; was 3.22 MB).
    - On top of that come 5 output arrays (≤ 11.5 KB) and one 16 KB sort buffer. None of it depends on maxRounds beyond the checkpoint count.
101. **Flaky test fixed (owner-approved):** `customGame.test.ts` (Paroli, payout 1.2) takes 0.81 s alone but timed out at 8.3 s under the full parallel suite. It also failed 1 of 2 runs with this session's files stashed, so it predates session 12. It now has a per-file 30 s timeout; no assertion changed. The full suite then passed 3 runs in a row.
102. **`src/engine/` diff since `8923df7`**, file by file:
    - `checkpoints.ts` (new): the schedule.
    - `montecarlo.ts`: imports it, plus a comment.
    - `stats/bands.ts`: the old evenly spaced `checkpointRounds` and `BAND_CHECKPOINTS` were deleted, and the recorder's comment no longer claims even spacing. This is owner-approved cleanup (option A), outside the prompt's "checkpoints.ts, montecarlo.ts and tests" list.
    - Tests: `checkpoints.test.ts`, `montecarlo.golden.test.ts` + `.json`, `stats/bands.test.ts` (imports repointed; the old even-spacing test replaced by the schedule equality; observer-leak test added), `perf.bench.test.ts` (import), `strategies/customGame.test.ts` (timeout).
    - Outside the engine: `ui/charts/FanChart.tsx` (the `data-band-points` hook, option B), `ui/charts/adapters.test.ts`, `e2e/charts.spec.ts`.

Session 13 (2026-09-24, Windows / PowerShell). `npm run test` (717 passed, 5 skipped: 2 benchmark tests + 3 golden writers), `npm run build`, `npm run lint` and **`npx playwright test` (41 passed)** all clean. **CI run [36084800574](https://github.com/iangopen/strategylab/actions/runs/36084800574) was green**: lint, unit, build, e2e, build-pages and deploy, every job on `ubuntu-24.04`. The pre-step's own run, [36079893679](https://github.com/iangopen/strategylab/actions/runs/36079893679), was green too. Delivered: the Vitest `unit` / `stats` split, and **multi-outcome games** (spec committed first, `939086c`).

103. **Pre-step: two Vitest projects.**
    - `unit` (default parallelism, 5 s default) runs first. `stats` (`*.stats.test.ts`) runs after it, on 2 workers, under one 120 s project timeout.
    - No per-file or per-test timeout remains in any test file (grep).
    - **Wall time:** unit 3.0 s, stats 50.5 s. **Full suite 3 runs in a row: 47.7 s, 54.6 s, 49.9 s, all green.**
    - Worker count by measurement: 2 → 41.5 s, 4 → 42.5 s, 6 → 46.7 s. At 2, the slowest single test is 8.8 s (13× under the timeout).
    - The carry property test checks its per-round bound with a plain comparison plus `expect.fail`, instead of 2.25M `expect()` calls: 17 s → 0.8 s. A mutation (bound 0.3¢) still fails it.
    - The 8 strategy files split into `<id>.test.ts` (sequence tests) and `<id>.stats.test.ts` (invariant, analytic, growth).
    - The +8 test count is the isolation scan's one test per new engine file.
104. **Bit-identity (directive 3).** These pass UNCHANGED (`git diff 939086c..HEAD` is empty for each file):
    - the session 11 runner golden (90 cells) and the session 12 Monte Carlo golden (4 scenarios × 9 strategies);
    - `runner.test.ts` (draws === rounds, including 2,400 random sessions);
    - `strategies/crn.test.ts` and the rule equivalence test.
    - The invariant table's five old columns reproduce digit for digit.
    - The only sequence-test edits: Flat's hand-built ctx gained `outcomes`, and its two direct `update` calls pass a result.
105. **Draw mapping** (`runner.outcomes.test.ts`, `runner.frequency.stats.test.ts`):
    - Binary games: `outcomeIndex` equals `u < p` at the edge cases and on 140,000 random draws over 7 values of p.
    - The last bound is forced to 1.
    - draws === rounds on multi-outcome games (600 sessions).
    - **1,000,000 draws: ticket worst |z| 1.31; 12 outcomes incl. 0.001, worst |z| 2.41 (the 0.001 outcome: z 1.71).** SE = √(p(1−p)/N) is printed per outcome.
106. **Payouts:**
    - A $70 ticket pays back exactly $20 / $50 / $100.
    - Partial losses go through the carry: 7 × (−500/7¢) = exactly −500¢.
    - A push moves nothing, even with a carry pending.
    - Total losses are exactly −bet.
107. **Push semantics** (`strategies/push.test.ts`, all 8 built-ins + a custom rule, through the runner):
    - With pushes inside a losing and a winning streak, the bets equal those of the same script without the pushes, and the bet after each push equals the bet on it.
    - The runner test shows that `update` is skipped on a push, and that L, push, L counts as a losing streak of 2.
108. **Kelly** (`kellyGeneral.test.ts`):
    - **The solver matches the closed form to within 2.22e-16** (worst of 4,263 random binary games with f* > 0; the requirement is 1e-12).
    - **Ticket at $60: f* = 0.119801** (G is lower on both sides), and it bets. **At $70: stops.**
    - The 2% push game stops. Win 0.5 / push 0.1 / lose 0.4 gives f* = 1/9. A game that cannot lose is capped at 1.
    - `assumedWinProb` is ignored on multi-outcome games and still drives binary games.
109. **Invariant table** (`invariant.stats.test.ts`, 20,000 sessions per cell, 4 SE). New columns (z):

     | Strategy | ticket $70 (−11.905%) | ticket $60 (+2.778%) | push game (−2%) |
     |---|---|---|---|
     | flat | −1.98 | 0.46 | 0.61 |
     | martingale | −1.49 | −0.71 | 0.98 |
     | paroli | −1.30 | 0.84 | 2.22 |
     | dalembert | −2.52 | 0.31 | 0.21 |
     | fibonacci | −0.85 | −1.07 | −0.90 |
     | labouchere | −1.25 | −0.02 | 0.49 |
     | oscars | −2.00 | 0.48 | −0.92 |
     | kelly | stops (asserted) | −0.02 | stops (asserted) |
     | custom rule | −1.18 | −0.81 | −1.70 |

     Every |z| < 4. Kelly has no edge to size from on a house-edge multi-outcome game, so the test asserts that it refuses every session (0 rounds, strategyStop).
110. **Fraction parsing** (`games.test.ts`):
     - `"1/6" + "3/6" + "2/6"` = exactly 1 (BigInt), and so do 1/3 × 3 and 0.1 + 0.2 + 0.7.
     - `1/0`, `abc`, `-0.2`, `-1/6`, `0`, `7/6`, `1.5`, `1e-3`, `1/2/3`, `0x10`, empty, 41 characters and non-strings are all rejected with readable messages (asserted exactly).
111. **Migration and links:**
     - **The 11 captured v1–v3 links** (`src/v3links.golden.json`, captured from the v3 decoder at `a15431c`) decode to exactly that output, taken through v3 → v4. Session 7's three golden links, likewise.
     - **v4 editor games round-trip bit-exactly** (6 cases: the example, a push prize with labels, multiplier with 1.91 / a push / a partial loss, 12 outcomes with 0.001, a sure push, 1/997 fractions).
     - An editor game in a v1–v3 link is reported and falls back to the default game. Malformed `["m", …]` arrays (14 forms) are reported, never thrown.
     - **The typical scenario on a 12-outcome game is a 921-character link** (budget 2,000).
     - v2 → v4 migration keeps p and n exactly.
112. **Editor and E2E** (`outcomes.spec.ts`):
     - **The ticket game is built field by field** in "Custom outcomes". A 2/3 sum blocks Run with a message, and `1/0` shows a readable error. The readout reads 1 / $61.67 / 0.8810 / 11.905%.
     - Kelly's assumed probability is disabled on this game, with the note.
     - **Run: the table equals the engine.** **Replay:** 2 lines, and the strip names its three levels ($20, $50, $100).
     - **Copy link, reopen in a new page:** same inputs (`1/6` kept as typed), readout and results.
     - Also: the preset, the $60 player edge, a push prize, and the cannot-lose warning; 12 rows at 360 px with no horizontal scroll; and a push game whose strip push count and cell count equal the engine's replay computed in Node.
     - **One existing spec edited:** `links.spec.ts` asserted the literal "reads up to version 3". It now uses `SCENARIO_VERSION`: a version-bump message, not engine output.
113. **Replay strip** (`replay.outcomes.test.ts`):
     - The strip equals the seeded draw sequence and is the same for every strategy.
     - Bets are recorded on push rounds too.
     - Levels are ranked by net, with labels and a push flag.
     - For a bucketed 20,000-round session, the mean height is within 4 SE (z 0.63).
114. **Live** (headless Chromium, local Playwright, `https://iangopen.github.io/strategylab/`, bundle `index-C5_7WErn.js`): the ticket game at $70 via a link, Flat + Martingale + Oscar's, 10,000 sessions ("Done: 10,000 sessions in 1.8s").
     - **Every row equals the engine.** EV per $ −11.908% / −11.997% / −12.041% against −11.905%; z −0.19 / −0.57 / −2.36.
     - The strip levels read $20, $50, $100, with no console errors.
115. **`src/engine/` diff since `939086c`:**
     - `games.ts`: the model.
     - `probText.ts` and `outcomeEditor.ts`: new.
     - `runner.ts`: the draw mapping, payouts, `RoundResult`, `onRound`.
     - `types.ts`: `RoundHook`.
     - `strategies/*`: the mechanical `result.kind`; Oscar's uses `result.profit`.
     - `kelly.ts`: the solver.
     - `strategies/types.ts`: `RoundResult`, `binaryOnly`, `ctx.game.outcomes`.
     - `rules/compile.ts`: `result.profit`.
     - `replay.ts`: `onRound`, the strip.
     - `montecarlo.ts` and `stats/types.ts`: `AnyGame`.
     - Tests.
116. **Performance** (not a directive this session; measured because the round loop changed):
     - The committed benchmark, interleaved in a temporary worktree at `939086c` and at HEAD, 5 pairs, on a machine running about 2× slower than in session 12 (thermal or power state).
     - **Median before 19.66 s, after 21.23 s: +8%.**
     - Reusing one mutable result object recovers about half, but weakens purity, so it was not kept. Caching frozen results made it much slower (≈28 s). A two-outcome fast path was within noise.
     - Recorded under Still open.
117. **Incident (fixed):**
     - Removing the benchmark worktree with `git worktree remove --force` BEFORE deleting its `node_modules` junction let git delete files inside the real `node_modules` (`node_modules/.bin` was gone).
     - Found when `npx playwright` failed. Restored with `npm ci` from the lockfile.
     - The full gate re-ran clean afterwards (717 unit, 41 E2E).
     - Rule: delete a junction with a non-recursive delete FIRST (as session 8 did), then remove the worktree.

Session 14 (2026-09-26, Windows / PowerShell). Portfolio pass: red CI fixed, product renamed to StrategyLab, README, generated screenshots, Open Graph tags, repo metadata, MIT license. `npm run test` (717 passed, 5 skipped), `npm run build`, `npm run lint` and **`npx playwright test` (41 passed)** all clean. **Three green CI runs in a row on `main`, each with the Pages deploy, every job on `ubuntu-24.04`:** [36231438799](https://github.com/iangopen/strategylab/actions/runs/36231438799), [36231615199](https://github.com/iangopen/strategylab/actions/runs/36231615199), [36232008890](https://github.com/iangopen/strategylab/actions/runs/36232008890). **`git diff` of `src/engine/` over the session is EMPTY.**

118. **The red CI run** ([36085502803](https://github.com/iangopen/strategylab/actions/runs/36085502803)):
     - `src/share/malicious.test.ts` › "huge repeated strings: over the cap is refused without decoding…". A 20,000,003-character fragment took **68.2 ms against a 50 ms wall-clock limit**.
     - It guards a security bound: a hostile link cannot hang the page or grow memory. The decoder refuses that input with a constant-time length check (`parseFragment`), so the time was runner noise, not decoding work.
     - **Now deterministic:** every `measuredDecode` counts what each decoding stage is handed (`base64urlToBytes` wrapped with `vi.mock` + `importOriginal`; `TextDecoder.prototype.decode` and `JSON.parse` spied only during the decode).
       - A fragment over 8,000 characters reaches **no stage at all**.
       - Any other input reaches each stage at most once: base64 ≤ 7,997 characters, UTF-8 ≤ 5,997 bytes, and `JSON.parse` only on text within the cap and within depth 16.
       - A control asserts that a valid link reaches each stage exactly once, so "no stage reached" is meaningful.
     - **Backstop:** 1,000 ms, for real hangs only. The heap (< 2 MB), message and dropped-list bounds are unchanged. Nothing is skipped or deleted.
     - **Mutation check:** decoding before the length check fails 9 tests.
     - **Other wall-clock assertions in the pass/fail suites: none.** `downsample.stats`, `montecarlo.stats` and `checkpoints.stats` only log times, `perf.bench.stats` is opt-in (`BENCH=1`), `responsiveness.spec` records long tasks without asserting on time, and `charts.spec` checks the elapsed label's format only.
     - The no-eval scan also covers `src/share/*.test.ts`: a type-level `import("./base64url")` tripped it, so the type is written without `import(`. The scan was not loosened.
119. **Links after the rename:** `git grep -i iangopenbusinessai` returns nothing (it already did; `origin` moved in session 11). Homepage set with `gh repo edit`.
120. **Rename to StrategyLab** (owner): `<title>`, the app header (h1 + subtitle "A Monte Carlo simulator for betting strategies."), the too-long-link message, the README, `og:title` and the repo description. The two E2E heading selectors and one test regex follow the new text.
121. **Screenshots** (`npm run screenshots`, generated from the LIVE site):
     - Before capturing, the results table must equal `engineTable` in Node. The bust session is found in Node (**session 6**: Martingale couldn't cover the next bet after 9 rounds; Flat played all 1,000).
     - Images: `docs/results.png` 139,676 B, `docs/fan-fit-martingale.png` 101,740 B (rounds 0–25), `docs/replay-bust.png` 86,858 B, and `public/og-image.png` 1200×630, 40,858 B. oxipng level 3 cut them by 24–43%.
     - **A second run after the deploy reproduced all four byte for byte.**
122. **README:** every link returns 200 (curl, following redirects), including the CI badge (`image/svg+xml`) and the three images via raw.githubusercontent (`image/png`). Number → source:

     | README number | Source |
     |---|---|
     | 8 built-in strategies and their names | `strategies/registry.ts` (labels in each strategy file) |
     | up to 8 strategies per run | `MAX_STRATEGIES` in `scenario.ts` |
     | up to 12 outcomes | `MAX_OUTCOMES` in `games.ts` |
     | edge 1/37 = 2.703%; $1,000, $10, $1,100, 10,000 sessions, seed 12345 | `defaultScenario()` in `scenario.ts`; European preset in `games.ts` |
     | P(profit) 82.930% / 53.760%; EV per $ −2.909% / −2.758%; theory −2.703%; P(bust) 17.070% | the default run: `docs/results.png`, checked against `engineTable` by the screenshot script; identical to STATUS 32 and to the live run (STATUS 124) |
     | half a cent (carry bound) | "Cents rounding"; `runner.carry.stats.test.ts` |
     | more than 5 SE at 100,000 sessions (flat $5 at −110) | STATUS 89 (z 5.29), `runner.regression.stats.test.ts` |
     | 1,000,000 sessions; 1,000,000 rounds per session | `MAX_SESSIONS` in `montecarlo.ts`; `MAX_ROUNDS_CAP` in `types.ts` |
     | 8,000 characters; depth 16 | `share/limits.ts` |
     | 4 standard errors | `describeEvInvariant` in `testUtils.ts`, `invariant.stats.test.ts` |
     | Node.js 24 | `ci.yml` (`node-version: 24`) |
     | 1200×630 (OG image) | `capture.spec.ts` |
     | 2026 (license year) | `LICENSE` |

     The README has no wall-clock timings and no test counts.
123. **Open Graph tags on the live page** (curl): `og:type`, `og:title` "StrategyLab", `og:description`, `og:url` https://iangopen.github.io/strategylab/, `og:image` https://iangopen.github.io/strategylab/og-image.png (**200, `image/png`, byte-identical to the committed file**), width/height/alt, and `twitter:card` `summary_large_image`.
124. **Live demo** (headless Chromium, local Playwright, bundle `index-DCFDUANk.js`): title "StrategyLab". The default run finished ("Done: 10,000 sessions…") with EV per $ −2.758% | −2.909% and P(profit) 53.760% | 82.930%. The worker returned 200 from `/strategylab/assets/`, with **0 console errors**. The screenshot script's live runs also asserted every table row equals the engine.
125. **Repo metadata** (`gh repo view`): the description (the README pitch), homepage https://iangopen.github.io/strategylab/, the 10 topics (monte-carlo, simulation, typescript, react, vite, web-worker, probability, statistics, betting-strategies, education), and license MIT (detected by GitHub).
126. **Housekeeping:** two untracked session 13 leftovers were deleted after confirming the tracked `src/v3links.golden.test.ts` passes (12 passed, 1 skipped): `e2e/live.tmp.spec.ts` (it ran against the live site on every local E2E run) and a stale pre-move `src/share/v3links.golden.test.ts` (its JSON import did not resolve).

### Built but not yet verified

- Any run in a focused, visible tab (needs a human, about 2 minutes): is the 100k × 10,000-round flat run much faster than ~75–90s? Node does the same work in ~17s. (The owner runs this himself.)
- **ALL owner checklists below (sessions 5–8) are now covered by E2E and pass in CI: see STATUS 75 for the item-by-item mapping.** The lists stay here for history only; nothing in them still needs a human.
- **Session 5 browser pass (owner-run, no browser automation this session).** All eight strategies appearing in the picker with working config forms and no UI edits; Kelly's config form (assumed win probability + fraction) and its help text; the Start-label fix (session 4) no longer overlapping the win-target label; the replay drag-to-zoom, "fit to first ending" on a Martingale bust, double-click reset; and the fan/replay hover crosshair + readouts rendering. The numeric outcomes behind these (Kelly 100% strategyStop / "—" EV; Kelly assumed 0.55 EV ≈ −2.70%) ARE verified programmatically (STATUS 41); the visuals are not.
- **Session 6 browser pass (owner-run: the Chrome extension was not connected).** `npm run build; npm run preview`, then:
  1. In "Strategies to compare", pick **Custom rule (start from…) → Blank rule** and click Add. The card shows a colored swatch, the name "My rule", and Form / JSON tabs.
  2. In the Form tab, under "After a loss", click **+ Add a rule**. Set "When" to *Losses in a row, at least* = 2 and "Then" to *Multiply the bet by* = 2. Leave "Otherwise" as *Back to the start bet*, rename the rule, and try ↑ / ↓ / Delete on a second rule.
  3. In the preview box (default `LLLWLW`), the ladder and table should update as you edit. Also type `LLX` (error message) and a W/L string that ends in a stop.
  4. Make sure Martingale is in the list (it is by default), click **Run**. The rule gets its own column, series color and chart panels; the table, fan and histogram need no special handling. With only the steps above, the numbers should match STATUS 52 exactly.
  5. Replay a session (type 0, or click a sample path). Both strategies should show in the replay.
  6. In the JSON tab, paste `{"kind":"progression","name":"x","startUnits":1,"onWin":[{"then":{"type":"reset"}}],"onLoss":[{"then":{"type":"multiply","by":20}}],"script":"alert(1)"}`. You should see the `unknown key "script"` error and Run blocked. Then paste `{ kind: 1 }` and read the "Not valid JSON" message. Then fix `by` to 2 and remove `script`. The Form tab should come back.
  7. On a Kelly card, clear "Assumed win probability" (blank = true probability). No error should show, and the placeholder reads "blank".
  8. Check narrow width (about 360 px) and dark theme for the builder.
- **Session 7 browser pass (owner-run: no browser automation).** `npm run build; npm run preview`, then open `http://localhost:4173/`:
  1. **Copy and reopen:** add a custom rule (e.g. Blank rule; after a loss, "Losses in a row >= 2" -> "Multiply by 2"), keep Martingale, and click **Copy link**. Expect "Link copied (N characters)...", and the address bar shows `#s=...`. Paste the link into a NEW tab: the banner says "Loaded the scenario from the link", and every field and the rule match exactly. Nothing runs until you click Run.
  2. **Reload (the lost-on-reload fix):** reload the original tab. The rule is still there.
  3. **Garbage fragment:** replace the text after `#s=` with garbage (e.g. `#s=hello!`) and press Enter. You should see "Couldn't load a scenario from this link" with a reason, your settings unchanged, and the garbage removed from the address bar. Also try a cut-off link.
  4. **Too large:** add 6 custom rules and paste this into each one's JSON tab: the adversarial maximum rule from `size.test.ts` (40 x "€" name, 10 + 10 entries with 17-digit numbers). Session 7's throwaway script measured 1 -> 1,645, 5 -> 7,629, **6 -> too large**. Copy link should show the "over the 8,000-character limit... Nothing was copied" error.
  5. **Blocked copy:** clear Starting bankroll. Copy link is disabled; hovering shows the reason and a help line repeats it. With 8 strategies, Add is disabled with its reason.
  6. **Ready-made links** (append to `http://localhost:4173/`):
     - a version-1 link with Kelly 0: `#s=eyJ2IjoxLCJnIjoiZXVyb3BlYW4iLCJiIjoxMDAwLCJiYiI6MTAsInRuIjoxLCJzdyI6MTEwMCwiciI6MTAwMCwibiI6MTAwMDAsInNkIjoxMjM0NSwic3QiOltbImZsYXQiXSxbImtlbGx5Iix7ImFzc3VtZWRXaW5Qcm9iIjowLCJmcmFjdGlvbiI6MC41fV1dfQ` -> Kelly's assumed probability should be blank, and the banner says it was upgraded;
     - a partially valid link: `#s=eyJ2IjoyLCJnIjoiZXVyb3BlYW4iLCJiIjoxMDAwLCJiYiI6MTAsInRuIjoxLCJzdyI6OTAwLCJyIjoxMDAwLCJuIjoxMDAwMCwic2QiOjEyMzQ1LCJzdCI6W1siZmxhdCJdLFsiZG91YmxlVXBTeXN0ZW0iXSxbImtlbGx5Iix7ImFzc3VtZWRXaW5Qcm9iIjo1fV1dfQ` -> loaded except 3 items (win target, unknown strategy, Kelly setting);
     - a newer-version link: `#s=eyJ2Ijo5OTk5OTksInN0IjpbXX0` -> "needs a newer version of the app".
  7. **Back button:** after step 3, press Back to the earlier `#s=` entry. It must not reload the scenario a second time.
- **Session 8 browser pass (owner-run: the Chrome extension was not connected; 1 attempt).** `npm run build; npm run preview`, open `http://localhost:4173/`:
  1. **Market readout:** Game → **Sports odds**. The defaults are −110 / −110, side A. The readout should show implied 52.381% / 52.381%, overround 4.762%, fair probability 50.000%, net payout 0.9091, house edge 4.545%, and the push note.
  2. **Decimal:** switch format to **Decimal**. The fields show 1.91 / 1.91 and the readout is unchanged. Switch back to American: the fields show −110 / −110 (exact round trip).
  3. **Invalid odds:** type −50 in Side A. An inline error ("+100 or higher, or -100 or lower"), "Fix the odds above…", and Run blocked. Try +110 / +110: the readout warns that it is rare and usually a data-entry error.
  4. **My estimate:** switch to "One side + my estimate". The field is labeled "Your side's odds", and the estimate field and help appear. At 0.55 the readout shows a player edge of 5.000% and the believed-edge line.
  5. **Run:** back to −110 / −110 market, and Run with Flat + Martingale (the default). Expect the numbers in STATUS 71: Flat −4.590%, Martingale −4.635%.
  6. **Link:** Copy link, open it in a new tab, and confirm the game shows Sports odds with the same inputs and readout.
- **Sessions 4-6 checklists above are STILL owner-run** (replay zoom/hover, rule builder form, dark theme, phone width, Kelly blank, Start label): browser automation was unavailable in sessions 5, 6, 7 and 8.

### Still open

- The original 8-session roadmap is complete. Next candidates are in the Roadmap: three-way sports lines, parlays, other de-vig methods, and the result-allocation cost.
- **Session 13: +8% on the benchmark** (median of 5 interleaved pairs, 19.66 s -> 21.23 s on a throttled machine; STATUS 116). Not a directive this session; reported, not fixed.
- **Oscar's Grind on multi-outcome games uses an approximation** (the mean winning net), so a cycle can close above or below exactly +1 unit. Documented; the invariant holds regardless.
- **Kelly on a house-edge multi-outcome game always stops** (assumedWinProb does not apply there), so it cannot model a misjudged edge on such games. By design (directive 6); the invariant table asserts the stop instead of a 0/0 z.
- ~~Cents rounding on non-even payouts is ~2 SE for a flat $5 bettor at 20,000 sessions (STATUS 66).~~ **Closed in session 11:** the per-session sub-cent carry (see "Cents rounding"); at 100k sessions z went from 5.29 to 0.55.
- Sports mode stores decimal prices at full precision after a format switch. The field shows 2 decimals, so the stored price and the visible one can differ (e.g. 1.9090909090909092 vs "1.91"). The readout shows the real payout. This is by design (owner decision 6).
- The address bar is not kept in sync while editing (owner-approved in the session 7 plan). After opening a link and then editing, a reload brings back the LINK, not the edits, until Copy link is clicked again.
- Rule language gaps, by design for now: one action per entry (no "multiply AND cap"), no Fibonacci-style step-back, no payout-capped bet (Oscar's Grind), no bankroll-proportional stake (Kelly). Those stay built-ins.
- Only Martingale **×2** is proven bit-identical. A rule `multiply by m` compounds units by repeated multiplication, while the built-in computes `m ** level`, so for non-power-of-two m the last float bit can differ, which can change a rounded cent. Not tested, not claimed.
- Sequence rules copy the line on each loss (O(line length) per loss), like the built-in Labouchère. That is not the O(entries) bound progressions have, but it is bounded by the session's losses.
- An unknown key inside an object hides that object's field errors until the key is fixed. Every problem is reported only once the keys are right.
- **Account rename:** links shared with the OLD Pages address are permanently dead (GitHub Pages does not redirect across a rename). ~~The local `origin` still pointed at the old account.~~ **Closed in session 11:** `origin` is `https://github.com/iangopen/strategylab.git`.
- ~~Stale help text in `src/engine/strategies/labouchere.ts` ("Custom lines come later…").~~ **Closed in session 11:** it now points to the rule builder's Labouchère example.
- ~~Rules are not saved anywhere yet: a page reload loses them.~~ **Closed in session 7:** Copy link puts the scenario (rules included) in the address bar, so a reload restores it. Saving without a link (storage, accounts) is still out of scope.
- ~~Browser vs Node speed gap (~4–5×).~~ **Resolved in session 9:** in a visible, focused tab, the browser is within ~10% of Node (STATUS 77). The gap was the hidden automation tab.
- CI `ubuntu-latest` will move to Ubuntu 26 from 2026-10-19 (GitHub notice). Nothing to do unless a run breaks.
- A 1,000-session run reports "in 0.0s": it genuinely takes under 50 ms, and the status shows one decimal. Cosmetic only.
- (Obsolete since session 9: Playwright's headless tab is visible and focused.) The automation tab is always `hidden` / unfocused (sessions 1–3). In session 3 a click by element ref silently did nothing until a screenshot woke the renderer; coordinate clicks worked. A focused-tab check still needs a human.
- Hover crosshair uses `--chart-axis` (theme-aware) but there is still no on-canvas tooltip box; values go to a text readout under each chart. Good enough; a floating box could be nicer later.
- Replay zoom is x-only (no y zoom / brush) and only the bankroll strip drives it. Fine for reading a short bust; a full brush is future work.

### Decisions made outside the spec

_Record any choice the session prompt didn't specify, with the reason, so later sessions don't undo it by accident._

- **Repo is `strategylab`, not `betting-lab`.** The folder already had an `origin` named `strategylab` (then under the pre-rename account); the owner chose to keep it. Display name was "Betting Lab (working name)" until session 14, when it became **StrategyLab**.
- **No `echo >` in PowerShell for file creation** (writes UTF-16; see Environment). Use file tools or `Set-Content -Encoding utf8`.
- **Stop boundaries are inclusive:** stopWin fires at `bankroll >= target`, stopLoss at `bankroll <= floor`. The UI labels stopLoss as a "floor". Both boundaries are tested to the cent.
- **Runner check order each round:** stopWin → stopLoss → ruin → maxRounds → strategy ("stop") → round/tableMin/tableMax → insufficientFunds → ONE draw. Stops and ruin come before maxRounds so a session that busts or hits a target on its last allowed round is reported as that, not as maxRounds (keeps a future P(bust) honest). None of the pre-resolution checks draws; a test asserts draws === rounds for every endReason.
- **`update(state, won, ctx)` receives the post-round ctx:** bankroll after resolution, `lastBet` = the bet actually placed (after table rules). Progressions that need their own intended bet must keep it in State.
- **(SUPERSEDED in session 11 by the sub-cent carry; kept for history.)** **Win payout is `Math.round(bet * netPayout)` cents.** Exact for even money; for fractional custom payouts it introduces at most half a cent of rounding per win.
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
- **Session 3: bands include round 0** (the starting bankroll) as checkpoint 0 (owner decision), then C = min(200, maxRounds) rounds at round(j × maxRounds / C), ending at maxRounds. (Round 0 first and maxRounds last still hold; the even spacing was SUPERSEDED in session 12 by the adaptive schedule in `checkpoints.ts`.)
- **Session 3: P(hit win target) is NaN ("—") when stopWin is off**, not 0%.
- **Session 3: z vs theory is NaN ("—") when the SE is 0 or undefined.**
- **Session 3: histogram with identical values everywhere** widens the range to [min − 1¢, max + 1¢]. Bins are [e_i, e_{i+1}), and the last bin includes max.
- **Session 3: sample paths stay `number[]`**; histogram counts (`Uint32Array`), edges, and bands (`Float64Array`) are transferred with `Comlink.transfer` (`resultTransferables`).
- **Session 3: percentages display with 3 decimals** (owner-approved; `src/ui/format.ts`) so the SE row is readable (0.032%, not 0.03%).
- **Session 3: `testCtx` lives in `testUtils.ts`**; tests never import from other test files.
- **Session 3: `perf.bench.test.ts` (since session 13 `perf.bench.stats.test.ts`) is committed and skipped unless `BENCH=1`**, so later sessions can re-measure against the same scenario.
- **Session 4: chart library = raw Canvas 2D** (timeboxed spike on a throwaway branch `spike/charts`, deleted; never pushed). Same chart for all three candidates: fan (p5–p95, p25–p75, median) + 50 sample paths, 6 strategy panels, ~1000 points per path (real worker run, 10k sessions), production build, Chrome (tab hidden, DPR 1), median of 10 full redraws of all 6 panels:
  | Candidate | Bundle delta (gzip) | Render, 6 panels | Band fill | Per-path x arrays | Resize | Theming |
  |---|---|---|---|---|---|---|
  | Raw canvas | +0.80 KB JS (spike code) | 9.4 / 10.5 ms (2 passes) | yes (polygon) | native | own ResizeObserver + DPR | read CSS vars at draw, redraw on change |
  | uPlot + paths in draw hook | +21.85 KB JS, +0.50 KB CSS | 38.6 / 47.1 ms | yes (`bands`) | yes (hook draws on u.ctx) | `setSize` + own ResizeObserver | colors fixed at creation: recreate or redraw |
  | uPlot mode 2 (all series) | +21.79 KB JS, +0.50 KB CSS | 49.9 / 61.8 ms | yes (band series share x) | yes (mode 2) | same | same |
  uPlot times include destroy + recreate per redraw. Chose raw canvas: 4–5× faster, ~20 KB smaller, arbitrary per-path x arrays for free, and full control of the SHARED axes rule; uPlot's extras (cursor, legend, auto ticks) are not needed. Cost: we own nice-tick generation (pure, tested in `adapters.ts`).
- **Session 4: replay above 5,000 rounds** (owner-approved): ≤ 5,000 rounds uses `recordPath`; above, bankroll AND bets stream through the SAME `MinMaxDownsampler`/observer that produces stored sample paths (so replay ≡ sample path exactly), and the win/loss strip is 500 buckets over maxRounds shaded by win rate, drawn once, spanning the longest strategy.
- **Session 4: theme control** (owner-approved): System / Light / Dark in the header sets `data-theme` on `<html>` (System removes it). Persisted in `localStorage` inside try/catch; NOT in `ScenarioConfig`. CSS: `@media (prefers-color-scheme: dark) :root:not([data-theme="light"])` plus `:root[data-theme="dark"]`.
- **Session 4: replay bets come from a recording wrapper** (`recordingStrategy` in `replay.ts`): it spreads the strategy and wraps `update` to read `won` and `ctx.lastBet` (the bet placed after table rules), then delegates. The bankroll path cannot give exact bets for non-even payouts. The real strategy stays pure; a test proves the wrapper changes nothing.
- **Session 4: replay uses the run's own `SimRequest`** (stored with the result), never the live form, so it always matches the charts on screen. Replay is disabled while a run is in progress. The worker rejects a session index outside the run.
- **Session 4: the win/loss strip encodes by HEIGHT with neutral grays** (tall = won, short = lost; buckets: height = win rate), not red/green, so it never relies on color and never borrows a strategy's color.
- **Session 4: palette = Okabe-Ito**, in order blue, vermillion, bluish green, reddish purple, orange, sky blue, yellow, black (`--series-0..7`). Light theme darkens yellow to #8a7a00 for contrast on white. Dark theme uses lighter variants of each hue, and black becomes #e6e8eb. Color k = instance index k in the run.
- **Session 4: fan y top = niceCeil(1.02 × max over ALL strategies of p95 bands, every sample-path point, the start and the win target).** Sample paths are included so no panel clips a thin line.
- **Session 4: histogram x = the run's shared bin range** (edges[0]..edges[50]), not forced to $0: it is the bankroll axis of a histogram, and the "bankroll y-axes start at 0" rule applies to y axes. Histogram y is shared: linear from 0; log from the power of ten below the smallest nonzero % to the one above the largest.
- **Session 4: replay bet sizes are drawn as steps** (a bet decided after r rounds holds over [r, r+1]). Replay y axes (bankroll, bet) start at 0 and are shared by every strategy's line.
- **Session 4: selected session, histogram y mode and the replay input draft are view state**, not scenario state. Charts always show the last completed run and use its own labels, colors and reference values.
- **Session 4: Start reference label sits at the left end of its line**, win target and floor at the right, so close values ($1,000 vs $1,100) never overlap.
- **Session 4: the default scenario** keeps seed 12345, 10,000 sessions and table min $1 (not specified by the directive), and adds the $1,100 win target with Flat and Martingale ×2.
- **Scaffold:** `create-vite` (react-ts) was run into a scratch folder outside the repo, copied in, and the scratch folder deleted; nothing from it is committed except the copied config files.
- **Session 5: `ctx.game` is `{ winProb, netPayout, edge }`** (owner directive 1), read-only, computed once per session by the runner. Reading it never touches the RNG, so CRN is unaffected. The five existing strategies were not changed; only ctx fixtures in `testUtils.ts` and `flat.test.ts` gained the field, and `betSequence` now also feeds the just-placed bet as `ctx.lastBet` (so Oscar's Grind can be driven without the runner) and takes an optional `game`.
- **(SUPERSEDED in session 6 by the `optionalNumber` field; kept for history.)** **Session 5: Kelly's `assumedWinProb` uses 0 as the "use the game's true probability" sentinel** (range 0–0.99, default 0). The FieldSpec kinds are number/integer/boolean/select — there is no optional-number kind, and directive 2 forbade adding one — so a real "blank" cannot be expressed; 0 is the sentinel, and the help text states plainly that a value ABOVE the true probability models a MISJUDGED edge. This is the one place the prompt's "blank" was interpreted.
- **Session 5: Kelly refuses to bet when f* ≤ 0** (returns `"stop"` → `strategyStop`), so on any non-positive-edge game its default config plays 0 rounds and EV per $ is 0/0 → "—". `crn.test.ts` and `customGame.test.ts` therefore give Kelly a misjudged edge (assumed 0.6) so it wagers and the CRN / custom-game checks stay meaningful; `describeEvInvariant(kelly, …)` uses the same betting config.
- **Session 5: the invariant now covers a positive-edge game** (p = 0.55, even money, edge −0.10, seed 303) for every strategy, because the core truth "EV per $ = −edge" is sign-agnostic and testing only negative edges would hide a sign bug. `INVARIANT_SCENARIO` itself is unchanged.
- **Session 5: Oscar's Grind tracks cycle profit from the PLACED bet** (`ctx.lastBet`) and `ctx.game.netPayout`, and caps the next bet at `ceil((goal − cycleProfit) / netPayout)` so a win closes the cycle at exactly +1 base unit; a table clamp can't skew the accounting. No overflow guard: the bet is at most `betUnits × base`, and `betUnits` only rises after wins.
- **Session 5: Labouchère keeps the line AND the original preset in State as immutable arrays** (slice/spread only); on completing a cycle it refills from the preset (restart) or empties the line so `nextBet` returns `"stop"` (stop). No overflow guard: on a losing streak `first` is fixed and `last` grows by `first` each loss, so the bet grows linearly.
- **Session 5: replay zoom is view-only x-window state**, reset by keying `ReplayCanvases` on `replay.session` (not a setState-in-effect). Drag selection and the hover crosshair are drawn on ONE overlay canvas over the bankroll strip, so the stacked charts are never redrawn during a drag or hover. `zoomFromDrag` rejects a span below 2 rounds (a click), and "fit to first ending" uses `firstEndingRound` (≥ 1, so a never-betting strategy does not collapse the view to 0).
- **Session 5: chart hover values go to a text readout under each chart** (`.chart-readout`, a fixed-min-height muted line), not an on-canvas tooltip box; the overlay carries only the crosshair. This keeps the heavy draw effect off the hover path (its deps exclude hover state) while honoring "never re-render the whole chart on hover".
- **Session 5 ran on macOS / zsh, not the documented Windows/PowerShell.** The npm scripts (`test`/`build`/`lint`) are cross-platform, so this did not affect any verification; the PowerShell-specific notes in Environment still stand for whoever is on Windows. Flagged rather than silently changed.
- **Session 6: `resetCycle` also zeroes both streaks; `reset` only resets units** (owner-approved in the plan). Without this, Paroli can't be expressed: a 4th straight win would still read `winStreak = 4 ≥ 3` and reset again (the equivalence negative control shows 904/1,000 sessions differ).
- **Session 6: one action per entry**, no compound actions (keeps the grammar small; approved).
- **Session 6: units are clamped to [0.01, `MAX_SAFE_INTEGER`] after set/multiply/add, and the bet is capped at `MAX_SAFE_INTEGER`** (session 2's overflow guard). With ×2 this keeps Martingale bit-identical even past level 53.
- **Session 6: only Martingale ×2 is claimed bit-identical** (repeated `×m` vs `m ** level` can differ in the last bit for other m).
- **Session 6: cycle profit is tracked from `ctx.lastBet` (the placed bet)**, like Oscar's Grind. (Session 11: with the EXACT `lastBet × netPayout`, no longer the runner's old `Math.round`; within 1¢ of the real bankroll change over any stretch.)
- **Session 6: the starting bankroll is copied into State at `init`** (from `ctx.bankroll`) for bankroll conditions; no contract change was needed.
- **Session 6: compiled rules are NOT registered.** They report id `"custom"`, label = the rule name, and have an empty `configSchema`. The crn id-list assertion stays at eight built-ins, and the custom rule is added separately.
- **Session 6: the live preview compiles and runs the rule on the MAIN thread.** It is a fixed script of ≤ 100 rounds with no RNG and no runner, so it is not a simulation. Simulations still run only in the worker.
- **Session 6: `ScenarioConfig.version` is 2** (instances carry `kind`). `migrateScenario` accepts v1 and v2. It is a reshaper, not a parser for untrusted input.
- **Session 6: request type `StrategyRef` and `resolveStrategies` live in `src/worker/resolve.ts`**, free of Comlink and the DOM, so the worker's resolution path is unit-tested in Node.
- **Session 6: example rules in the picker.** A blank rule (same bet every round) plus the four equivalence rules, named descriptively ("Double after a loss", …). The picker labels say "Example: Martingale ×2 as a rule". There is no "winning system" wording anywhere, and the custom card says a rule "cannot change the expected result per dollar wagered; it only changes how results spread out".
- **Session 6: an invalid rule is still stored in the scenario** (so its errors show, and the JSON tab keeps what was pasted). Run is blocked through `strategy:<uid>:rule`. Text that does not parse as JSON stays a local draft and is never committed.
- **Session 6: the form uses `validateRule(…, { ranges: false })`** so an out-of-range value keeps the form visible with inline errors. A structurally broken rule shows "fix it in the JSON tab" plus the error list.
- **Session 6: instance labels are grouped by display label** (not by strategy id), so two custom rules with the same name number as "#1 / #2", and so would a custom rule named like a built-in.
- **Session 6: `optionalNumber` blank = the key is ABSENT** (no `undefined` values stored); `StrategyConfig` values widened to `ConfigValue | undefined` for typing. `SchemaForm` shows the placeholder "blank". Kelly's range is now 0.01–0.99.
- **Session 6: the Kelly 0 → blank migration applies to v1 scenarios only.** v2 is introduced in the same session, so no v2 scenario ever held the sentinel.
- **Session 6: the fuzz uses the invariant scenario with maxRounds 200 and 1,000 sessions per rule per game** (the "small Monte Carlo"). With 400 z-tests at 4 SE, a chance failure has roughly a 2.5% probability. Seeds are fixed, so the test is deterministic, and the worst |z| is printed for every run.
- **Session 6: the equivalence runs two scenarios** (the app default, and the invariant scenario with a tableMax clamp and stops), so clamped progressions are covered too.
- **Session 6 ran on Windows / PowerShell,** as documented.
- **Session 7: a real reload is a new page lifetime and re-applies the link** (that is the lost-on-reload fix). "Does not re-fire" applies within one page lifetime: StrictMode, hashchange + popstate, and Back to an applied fragment (owner-confirmed plan).
- **Session 7: Copy link writes the link into the address bar with `replaceState`.** There is no separate in-app apply step, so there is no `pushState`. Loading uses `replaceState` too, writing the canonical form or stripping an unreadable fragment.
- **Session 7: no automatic address-bar sync while editing** (owner-confirmed). See Still open.
- **Session 7: Copy link leaves out strategies with errors and names them** ("Left out of the link because they have errors: ..."). It is disabled only when a scenario field is invalid, there are no strategies, none is valid, or there are more than 8.
- **Session 7: partial-load fallbacks.** Top-level -> the default (optional fields -> off); a built-in setting -> its default; an unknown strategy or invalid rule -> left out; strategies beyond 8 -> left out. If none survive, the scenario loads with an empty list and the app's own validation says "Add at least one strategy".
- **Session 7: `MAX_STRATEGIES = 8`** (one per palette color) in `validateScenario`. The picker's Add is disabled at 8 with the reason. This limit is new this session.
- **Session 7: hard cap 8,000 characters for the whole link; depth limit 16 before `JSON.parse`.** Loading rejects fragments over 8,000 before decoding.
- **Session 7: the link format version is the scenario version** (`v`). A key-map change bumps both and needs a migration.
- **Session 7: link code lives in `src/share/`** (outside the engine, no React). Browser glue is in `ui/linkBoot.ts`, which is the only code that touches `location` and `history`.
- **Session 7: instance uids are not encoded.** Loading makes new ones, and round-trip equality is checked uids aside.
- **Session 7: the base64url codec is hand-written** (not `atob`/`btoa`): strict alphabet, no padding, never throws, errors carry a position, and the pending-bit accumulator stays bounded.
- **Session 7: a "copied" confirmation clears after 5 s.** Errors and left-out warnings stay until the next copy. If the clipboard is unavailable, the link appears in a read-only field.
- **Session 7: the Copy link tooltip lives on a wrapper `<span>`** (disabled buttons don't show `title` in every browser), and a visible help line repeats the reason.
- **Session 7: unknown keys are reported at most 5 by name per object, then summarized,** so a hostile link can't produce an unbounded error list.
- **Session 7: the size-budget test counts a 60-character address allowance,** since the real site address is unknown in tests.
- **Session 7 ran on Windows / PowerShell.**
- **Session 8: estimate mode uses side A as "Your side's odds"** (owner decision 1). Side B and the chosen side are kept but ignored, so switching back loses nothing.
- **Session 8: the scenario stores derived `winProb` / `netPayout` next to the odds inputs** (owner decision 2). They are re-synced on every edit and load, `validateScenario` checks they match, and links carry only the inputs. While the inputs are invalid, the previous numbers are kept and Run is blocked.
- **Session 8: decimal payouts snap float artifacts** (`snapShortDecimal`: a value within 4ε × max(1, d) of a ≤ 12-significant-digit decimal becomes that decimal; owner decision 3, refined). A typed 1.91 pays 0.91 exactly. A converted 1.9090909090909092 is left alone.
- **Session 8: ranges** American ±100 to ±100,000, decimal 1.001 to 1,001, estimate 0.01 to 0.99 (owner decision 4).
- **Session 8: a negative overround is accepted.** The readout says it is rare and usually a data-entry error, and that the bettor has the edge as entered (owner decision 5).
- **Session 8: the format toggle converts EXACTLY and stores the exact value; the field DISPLAYS it rounded** (owner decision 6). `NumberField` gained a `format` prop used only when the value comes from outside, so the stored value changes only when the user edits. The snapping rule (American 15 digits, decimal full precision unless near a short decimal) is in "Sports odds"; it corrects the first draft of the spec.
- **(Deleted in session 11.)** **Session 8: `payoutRoundingBias` lived in `odds.ts`** and was used by tests and docs only; the UI never showed it (owner decision 7). The carry removed the bias it described.
- **Session 8: game ids.** Sports is presetId `"sports"`, and `toSimRequest` builds `{ id: "sports", name: "Sports odds", ... }`. Choosing another game drops the odds inputs. Choosing Custom keeps the current numbers as a starting point.
- **Session 8: the default sports market is −110 / −110, side A, estimate 0.5** (a common two-way price).
- **Session 8: sports odds errors in a link are reported as one "Game" entry** (all odds messages joined), and the game falls back to the default. A sports game in a v1/v2 link is rejected as "sports odds need a version 3 link".
- **Session 8: the Kelly config in the sports invariant.** Assumed 0.6 on the market (at the fair p Kelly refuses to bet, 0/0), default (blank) on the estimate game, where it bets.
- **Session 8: version-bump test edits** (expected, owner-approved):
  - `scenario.test.ts`: v1 migrates to 3, not 2.
  - `load.test.ts`: the "newer version" example is now v4, since 3 is current.
  - `malicious.test.ts`: the message says "reads up to version 3".
  - `roundtrip.test.ts`: a literal `version: 2` became 3.
- **Session 8: golden v1/v2 link outputs were captured from the session 7 code itself** (commit `76a284f` in a temporary git worktree with a node_modules junction, removed afterwards; the junction was deleted without touching its target). This way "loads exactly as before" is compared against real session 7 output, not against my memory of it.
- **Session 8: a tone test** (`sportsReadout.test.ts`) scans the sports UI, readout, ConfigPanel and `odds.ts` for bookmaker names, URLs and tipster vocabulary, comments included.
- **Session 8 ran on Windows / PowerShell.**
- **Session 9: the repo is public** (owner: intentional). Deploy moved from Vercel to **GitHub Pages via Actions, after CI passes**; Vercel is on the roadmap as optional (`VITE_BASE=/`).
- **Session 9: `VITE_BASE` defaults to `/`;** the Pages build and E2E set `/strategylab/`. `npm run build:pages` uses `cross-env` (a new dev dependency) so it also works from PowerShell and cmd.
- **Session 9: Copy link builds from `location.origin + location.pathname` only** (owner decision 1). A query string is no longer carried into links. The same base is used when the address bar is canonicalized.
- **Session 9: Playwright runs Chromium only** (owner decision 3), 1 worker in CI and 2 locally, with no retries (a flaky spec is a bug, not something to retry).
- **Session 9: E2E expected numbers come from the engine in Node, never hardcoded** (owner change to decision 4), so the planned cents-rounding fix won't break E2E.
- **Session 9: charts expose their state through `data-*` attributes** written by the draw effect (`chartState`, `countDraw` in `canvas.ts`). `refLineH` returns its label box so specs can prove labels don't overlap. No screenshot baselines.
- **Session 9: the Pages deploy is two jobs.** `build-pages` (contents: read, checks out and builds) and `deploy` (only `pages: write` + `id-token: write`, no checkout), so the deploy job has exactly the owner's minimum permissions. The workflow default is `contents: read`.
- **Session 9: actions pinned to their Node 24 majors** (checkout v7, setup-node v7, upload-artifact v7, upload-pages-artifact v5, deploy-pages v5) after the first run's Node 20 deprecation warnings (owner decision 6).
- **Session 9: Vitest `testTimeout: 60_000` suite-wide** (see STATUS 76): Monte Carlo tests are CPU-bound and deterministic, and the 5 s default is a harness budget, not an assertion.
- **Session 9: `tsconfig.e2e.json`** (referenced from `tsconfig.json`) type-checks `e2e/` and `playwright.config.ts` with bundler resolution, so `npm run build` (and therefore the E2E server and CI) fails on a type error in a spec.
- **Session 9: the live-site check used local headless Playwright against the live URL** (owner decision 5); the Chrome extension never connected.
- **Session 9: commits are chained after `npm run test &&`.** One early session 9 commit went in while a test had failed (the timeout above); the chain prevents that.
- **Session 9 ran on Windows / PowerShell.**
- **Session 10: the fan zoom is view state in FanChart,** tied to the result object, so a new run starts unzoomed (no effect). It is not in `ScenarioConfig` or links (owner-approved plan).
- **Session 10: a strategy whose bands never change** (e.g. Kelly refusing to bet) fits to [0, first checkpoint]. Every window spans at least 2 rounds (`zoomFromDrag`'s rule).
- **Session 10: 4 px or less of pointer travel is a click** (it picks a path); more is a zoom drag. The click that ends a drag is suppressed. The second click of a double-click never picks a path.
- **Session 10: the fan's reset button is "Show every round",** not "Reset zoom": the replay chart already has "Reset zoom", and two same-named buttons are ambiguous (the existing replay spec caught it).
- **Session 10: the halo and the label knockouts use `--panel`,** the background the charts sit on. Knockouts are 92% opaque, with 2 px padding. The histogram's and the replay chart's labels get knockouts and hooks too.
- **Session 10: labels are drawn AFTER the data** (including over the highlighted path), so text never sits on paths. A label that can't fit anywhere (more labels than the plot can hold) is clamped inside the plot; the property test never hit that case.
- **Session 10: the hover readout snaps to the nearest band checkpoint INSIDE the zoom window.** If the window is narrower than one checkpoint, the readout clears.
- **Session 10: the elapsed counter shows "—" before the first run**, so "<0.1s" never claims a run happened.
- **(SUPERSEDED in session 13 by the `stats` Vitest project: no per-file timeouts anywhere.)** **Session 10: the equivalence test's timeout is 30 s** (per file, `describe(..., { timeout: 30_000 })`); every other test uses Vitest's 5 s default. (Session 12, owner-approved: `customGame.test.ts` also has a per-file 30 s timeout, and the exhaustive schedule test, the goldens and the invariant tests set their own.)
- **Session 10: the Labouchère help text was NOT changed** (option (b)): the owner's bare "yes" did not clearly override the hard "src/engine/ diff is EMPTY" rule. It is listed under Still open for session 11.
- **Session 10: the commit gate now runs with `set -o pipefail`.** Piping Playwright's output through `grep | head` hid one failing E2E run; that commit was fixed and amended before any push. Every earlier session 10 commit's captured output shows all specs passing.
- **Session 10 ran on Windows / PowerShell.**
- **Session 11: tie rule half-up (`Math.round`)** for the carry, not half-even: with a carry the tie direction cannot accumulate, and half-up keeps the first win of every session bit-identical to before.
- **Session 11: the carry is one float of loop state in `runSessionWithRng`.** `SessionConfig`, `SessionResult`, `RunOptions` and the Strategy contract are unchanged; strategies never see it.
- **Session 11: rule cycle profit = exact winnings `lastBet × netPayout`** (owner-approved option A). The plan proposed counting the real bankroll change (`ctx.bankroll` − previous), but the strategy test kit's `betSequence` keeps the bankroll fixed at 1e9 (Kelly's exact sequences depend on that), so bankroll deltas would read 0 there. Exact winnings give the same guarantee as the carry (within 1¢ of the real change over any stretch), need no extra State field, and are identical on integer payouts, so the equivalence tests are unaffected.
- **Session 11: the rule preview pays with the same carry** (option B), so its bankroll column matches a real session.
- **Session 11: `payoutRoundingBias` deleted, not repurposed.** The residual is one bound (≤ ½¢ per session), proven by the property test; a helper would only restate it.
- **Session 11: the golden fixture is committed** (`runner.golden.json`, ~160 KB; regenerate only on purpose with `GOLDEN=write`). It stores 50 results per cell plus a digest over 2,000 full paths, instead of every result, to stay small. It also holds the old-rule 100k −110 run, so "before" in the regression test comes from the real old runner, not a re-implementation.
- **Session 11: one invariant table test** (`invariant.test.ts`) covers the 3 classic games and the 2 sports games for all 9 strategies. The classic columns duplicate the per-strategy `describeEvInvariant` runs (same seeds, same numbers), which stay because the "add a strategy" recipe relies on them.
- **Session 11: the property test's per-round bound is ½¢ + Σ ε × |owed|,** not a hand-picked 1e-6: at $10M bets on a 1,000 payout, float noise is about 1e-4¢, measured at 0.50015¢ worst.
- **Session 11: the live check was a temporary Playwright spec** (not committed) comparing the live table to `engineTable` in Node, as in session 9.
- **Session 11 ran on Windows / PowerShell.**
- **Session 12: schedule constants.** Dense to 64, growth 1/4 (+25% per step), cap ceil(M / 200). The cap reproduces the old even spacing, so no part of any schedule is coarser than before. Growth 1/4 keeps the worst length at 287, well under 320. (A growth of 1/8 was considered; it would have needed more checkpoints for the same cap.)
- **Session 12: `checkpointRounds` returns a `Float64Array`**, as before, so `bands.rounds` still transfers with `Comlink.transfer` unchanged.
- **Session 12: the band recorder was NOT changed.** It already accepted any strictly increasing round list; only the list changed.
- **Session 12: the Monte Carlo golden stores stats as `String(value)`** (an exact decimal round trip that keeps NaN) and sample paths as a digest, so the fixture stays about 32 KB. It regenerates with `GOLDEN_MC=write`, separately from the runner golden (`GOLDEN=write`).
- **Session 12: the exhaustive schedule test's checker was made faster** (dense check and gap check in separate loops; same properties) to fit the owner's "about 3 s" condition: 4.0 s at first, then 2.6–2.8 s.
- **Session 12: `data-band-points`** on each fan canvas = the number of band checkpoints inside the shared x window. It is a test hook only; nothing visible changed.
- **Session 12: the E2E hover check zooms first** (a drag to about 449–551), so one pixel is a small fraction of the 5-round gap and the snap target is unambiguous.
- **Session 12 ran on Windows / PowerShell.**
- **Session 13: outcomes store `net`, not `grossReturn`** (owner-approved D1): `1 + n` loses a bit, which would break bit-identity and the round trip. Gross return is what the UI shows.
- **Session 13: `Game` keeps its name for the binary shorthand;** `OutcomesGame` is the list form, and `AnyGame` is what the engine takes. Every preset and existing test stays untouched.
- **Session 13: the carry skips total losses (net −1) and pushes (net 0)** (approved D4). Both are exact whole-cent moves; without the exemption a binary loss could move −bet + 1 when the carry is 0.5.
- **Session 13: `RoundResult.profit` is the EXACT profit** (lastBet × net), not the cents paid, so `kind` depends on the outcome alone (CRN-stable) and Oscar's / rule cycle profit stay bit-identical (approved D5).
- **Session 13: Kelly keeps the closed form on the legacy binary shape** (2 outcomes, first net > 0, second −1); the solver is used everywhere else, and a test holds the two to 1e-12 (approved D7). f* is capped at 1 only when no outcome loses. A stake above the bankroll is handled by the runner, as with fraction > 1.
- **Session 13: `assumedWinProb` is disabled via a generic `FieldSpec.binaryOnly`** (SchemaForm shows the note "Applies only to win/lose games; ignored here." from `ui/format.ts`), and Kelly ignores it on multi-outcome games.
- **Session 13: replay records through the runner's `onRound` hook** (approved D8); the old `recordingStrategy` wrapper is gone (a wrapper around `update` misses pushes). Its "changes nothing" test now covers the hook.
- **Session 13: probability TEXT is stored** in the scenario and links (approved D9); sums are exact BigInt rationals, accepted within 1e-9 like the engine.
- **Session 13: "Custom outcomes" opens a starter** ($10 ticket, $20 or nothing, 1/2 each), and "Ticket example" loads the example into the same editor (presetId `"outcomes"`, no separate stored preset id). The binary editor is relabeled "Custom (win or lose)". Switching ticket → multiplier converts prizes to prize / price; multiplier → ticket gives a $1 ticket.
- **Session 13: strip levels** = outcomes ranked by net (ties share a level); height (level + 1) / levels; pushes hollow; an HTML legend names every level (a 64 px canvas cannot hold 12 axis labels).
- **Session 13: the invariant table asserts that Kelly STOPS on house-edge multi-outcome games** instead of a 0/0 z (no betting config exists there by design).
- **Session 13: the v1–v3 link fixture lives in `src/` (not `src/share/`)** because its writer's dynamic `import("node:fs")` is exactly what the no-eval scan of `src/share/` forbids.
- **Session 13: the tone test also scans the outcome editor** (and bans lottery-operator names).
- **Session 13: the `stats` project runs on 2 workers** (measured: more workers were not faster on this machine, and 2 gives the most headroom per test). Its one timeout is 120 s.
- **Session 13 ran on Windows / PowerShell.**
- **Session 14: the malicious-link bound is proven by counting stage inputs, not by timing** (owner directive 1). The 1 s wall clock remains only as a hang backstop. `base64urlToBytes` is wrapped through `vi.mock` with `importOriginal` (the real function still runs), and `TextDecoder.decode` / `JSON.parse` are spied only for the duration of one decode, so Vitest's own use of them is never counted.
- **Session 14: product name StrategyLab** (owner). The header gains the subtitle line "A Monte Carlo simulator for betting strategies." (`.subtitle`). The repo and path stay `strategylab`.
- **Session 14: screenshots are a Playwright "spec" under `scripts/screenshots/`** with their own config (`playwright.screenshots.config.ts`), so Playwright's TypeScript loader resolves the engine's extensionless imports. They are outside `e2e/`, so never part of the suite, and type-checked through `tsconfig.e2e.json`.
- **Session 14: screenshot settings.** Light theme set explicitly through the Theme control (and `colorScheme: light`), 1280×800 at device scale 2, element screenshots of the three panels, mouse parked at (0, 0) so no crosshair shows. The replay is zoomed with "Fit to first ending", so Martingale's 9-round bust is readable next to Flat's 1,000 rounds.
- **Session 14: `@jsquash/oxipng` (WASM, lossless, level 3)** optimizes the PNGs (owner-approved dev dependency). In Node its wasm is loaded explicitly with `init(WebAssembly.compile(...))` from `node_modules`.
- **Session 14: `og:image` is `public/og-image.png`**, a 1200×630 viewport capture of the same default run (owner-approved; `docs/` is not in the Pages build). It shows the app's real status line, including its elapsed time ("in 0.3s"), so a regeneration could differ by that label alone. The og:url and og:image URLs are absolute canonical Pages URLs in `index.html`; this is HTML metadata, not app code, so the no-hardcoded-base rule is unaffected.
- **Session 14: the README states the carry bound with its caveat** ("within half a cent … up to floating-point noise"), and the regression figure with its scenario (flat $5 at −110), because each README number must match its source exactly.
- **Session 14: MIT license** (owner), © 2026 Ian Gopen, referenced in the README.
- **Session 14 ran on Windows / PowerShell** (tools via Git Bash where noted).
