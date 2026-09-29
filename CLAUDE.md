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

## Where things are

`src/engine/` pure engine (rules 1-11 above): `rng`, `games` (outcome model), `runner` (session loop, table rules, sub-cent carry), `montecarlo` + `checkpoints`, `replay`, `odds` (sports), `strategies/` (8 built-ins + `registry.ts`), `rules/` (JSON rule language: validate + compile), `stats/` (accumulator, quantile, registry). `src/worker/` Comlink worker + client. `src/share/` scenario links (untrusted input). `src/ui/` React UI and `charts/` (canvas; all scales in `adapters.ts`). `src/scenario.ts` is the one serializable `ScenarioConfig` (version 4). `e2e/` Playwright specs, `scripts/screenshots/` README images. Full annotated file map: `docs/spec.md` ("Folder map").

## Chart rules

These are the owner's session 4 directives, verbatim. They bind every chart, present and future.

**SHARED AXES ACROSS STRATEGIES.** Charts are small multiples, one panel per strategy instance, and EVERY panel of a chart type uses the SAME x and y ranges (and the histogram uses the session 3 shared bins and a shared y max). NEVER autoscale per panel. Reason: per-panel scales make Martingale's tail look like Flat's; same principle as shared bins. Bankroll y-axes start at 0.

**ONE COLOR PER STRATEGY INSTANCE**, used everywhere: results table header, every chart panel, replay lines. Colorblind-safe palette, and every panel also carries a text label (NEVER color alone). Theme-aware via CSS variables for light and dark.

**ZOOM IS ALWAYS SHARED ACROSS PANELS; Y NEVER RESCALES** (session 10). One x window applies to every panel of a chart; nothing zooms a single panel. The y range is always the global shared range, whatever the zoom.

---

## Detail lives in docs (read on demand, NOT loaded at startup)

Read the relevant section BEFORE changing that area. These files are plain paths, deliberately not @imports.

- `docs/spec.md`: full folder map; chart rule implementation notes (fan zoom, label knockouts, colors); how to add a strategy (with the Strategy specs and test kit) and how to add a stat; the **rule language** (grammar, evaluation order, limits, worked examples); the **URL scenario format** (key map, limits, loading, history); **sports odds** (conversions, de-vig, format toggle, cents rounding / carry, link representation); **multi-outcome games** (model, one draw per round, payouts, Kelly generalized, editor, replay strip, scenario v4); the roadmap.
- `docs/history.md`: the STATUS log (sessions 1-14, verification items numbered 1-126, referenced as "STATUS n"), the old owner browser checklists, the full "Still open" list including closed items, and every "Decisions made outside the spec" entry with its reasoning. Check it before undoing any earlier decision.

## Current state (session 14, 2026-09-26)

All roadmap sessions 1-14 are done and verified: 717 unit/stats tests pass (5 skipped), `npm run build`, `npm run lint` and 41 Playwright specs pass, CI green with Pages deploy, live at https://iangopen.github.io/strategylab/. `src/engine/` was untouched in session 14. Only record in STATUS what was actually verified.

## Still open

- Result allocation: the per-round `RoundResult` object costs about 8% on the benchmark (STATUS 116). Reusing one mutable object recovers about half but weakens purity; owner decision, not taken.
- Candidates beyond the roadmap: three-way sports lines (needs a three-way de-vig spec), parlays (needs a leg-correlation spec), other de-vig methods (power, Shin, additive), optional Vercel deploy (`VITE_BASE=/`).
- Oscar's Grind on multi-outcome games uses an approximation (mean winning net); the invariant still holds. Kelly always stops on a house-edge multi-outcome game (`assumedWinProb` is binary-only), by design.
- Sports mode stores decimal prices at full precision after a format switch; the field shows 2 decimals, the readout shows the real payout (by design).
- The address bar is not kept in sync while editing: after opening a link and editing, a reload restores the LINK until Copy link is clicked again.
- Rule language gaps by design: one action per entry, no step-back, no payout-capped bet, no bankroll-proportional stake (those stay built-ins). Only Martingale x2 is proven bit-identical to its rule form.
- Links made with the pre-rename Pages address are permanently dead (no redirect). CI `ubuntu-latest` moves to Ubuntu 26 from 2026-10-19; nothing to do unless a run breaks.
- Replay zoom is x-only; hover values go to a text readout, not an on-canvas tooltip. Cosmetic: a 1,000-session run reports "in 0.0s".
