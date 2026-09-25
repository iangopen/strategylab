// Directive 5 (session 13): a push leaves every strategy's state untouched. Through the runner, on a
// game with a push outcome: the bets with a push inside a streak equal the bets of the same script
// WITHOUT the push, with the pushed round's bet simply repeated (state and the next bet unchanged).
import { describe, expect, it } from "vitest";
import type { OutcomesGame } from "../games";
import { compileRule } from "../rules/compile";
import { compileGame, runSessionWithRng } from "../runner";
import { sessionConfig } from "../testUtils";
import { STRATEGIES } from "./registry";
import type { AnyStrategy, StrategyConfig } from "./types";

// Positive edge so Kelly bets too: win 0.5 at 2x, push 0.1, lose 0.4.
const GAME: OutcomesGame = { id: "push", name: "win / push / lose", outcomes: [{ prob: 0.5, net: 1 }, { prob: 0.1, net: 0 }, { prob: 0.4, net: -1 }] };
const WIN = 0;
const PUSH = 1;
const LOSS = 2;

const CUSTOM = compileRule({
  kind: "progression",
  name: "push custom",
  startUnits: 1,
  onWin: [{ when: { type: "winStreak", atLeast: 2 }, then: { type: "resetCycle" } }, { then: { type: "multiply", by: 1.5 } }],
  onLoss: [{ when: { type: "lossStreak", atLeast: 3 }, then: { type: "reset" } }, { then: { type: "add", units: 1 } }],
});

const SPECS: [string, AnyStrategy, StrategyConfig][] = [...STRATEGIES.map((s): [string, AnyStrategy, StrategyConfig] => [s.id, s, { ...s.defaultConfig }]), ["custom rule", CUSTOM, {}]];

/** Bets placed over a scripted outcome sequence (the RNG lands mid-interval of each scripted outcome). */
function bets(strategy: AnyStrategy, config: StrategyConfig, script: readonly number[]): number[] {
  const { cum } = compileGame(GAME);
  let i = 0;
  const rng = () => {
    const k = script[i++]!;
    return ((k === 0 ? 0 : cum[k - 1]!) + cum[k]!) / 2;
  };
  const placed: number[] = [];
  runSessionWithRng(GAME, strategy, config, sessionConfig({ startBankroll: 10_000_000, baseBet: 1_000, maxRounds: script.length }), rng, { onRound: (_r, bet) => placed.push(bet) });
  return placed;
}

describe("a push inside a streak leaves every strategy's state and next bet unchanged", () => {
  // Pushes inside a losing streak and inside a winning streak.
  const withPush = [LOSS, LOSS, PUSH, LOSS, WIN, WIN, PUSH, WIN, LOSS];
  const withoutPush = withPush.filter((k) => k !== PUSH);
  for (const [name, strategy, config] of SPECS) {
    it(name, () => {
      const a = bets(strategy, config, withPush);
      const b = bets(strategy, config, withoutPush);
      // Remove each pushed round's bet: the rest must equal the no-push run, and the bet after a push
      // must equal the bet on the push itself (nothing changed in between).
      const kept = a.filter((_, r) => withPush[r] !== PUSH);
      expect(kept).toEqual(b);
      withPush.forEach((k, r) => {
        if (k === PUSH && r + 1 < a.length) expect(a[r + 1], `${name}: bet after the push at round ${r + 1}`).toBe(a[r]);
      });
      expect(a).toHaveLength(withPush.length); // every strategy bets throughout (Kelly too: positive edge)
    });
  }
});
