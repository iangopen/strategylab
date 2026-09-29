# StrategyLab: detailed specs and reference

Moved out of CLAUDE.md in session 15 to keep the startup file small. The text below is the original wording, unchanged (the "Folder map" onward; the "Chart rules" directives and their headline rules stay in CLAUDE.md, and the implementation notes that followed them are here). Where it says "see STATUS n", that is in `docs/history.md`.


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
