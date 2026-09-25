// Live preview: feeds a hand-typed win/loss script to the COMPILED rule and returns the bet ladder.
// Pure and tested. It is not a simulation: no RNG, no runner, a fixed script of at most 100 rounds.
// It deliberately ignores table limits and running out of money (the preview says so).
import { compileValidRule } from "../../engine/rules/compile";
import { validateRule } from "../../engine/rules/validate";
import type { RoundResult, StrategyContext } from "../../engine/strategies/types";

export const PREVIEW_MAX_ROUNDS = 100;

export interface PreviewContext {
  /** Cents. */
  baseBet: number;
  /** Cents. */
  startBankroll: number;
  winProb: number;
  netPayout: number;
}

export interface PreviewRow {
  round: number;
  /** Bet in units of the base bet, as the rule asked for it. */
  units: number;
  /** Bet placed in cents (rounded to a whole cent, at least 1). */
  bet: number;
  won: boolean;
  bankrollAfter: number;
}

export type PreviewResult =
  | { ok: true; rows: PreviewRow[]; next: { units: number } | "stop"; stoppedEarly: boolean }
  | { ok: false; error: string };

/** "LLLWLW" (case-insensitive; spaces, commas and dashes ignored) to outcomes. */
export function parseScript(text: string): { ok: true; outcomes: boolean[] } | { ok: false; error: string } {
  const cleaned = text.replace(/[\s,-]/g, "").toUpperCase();
  if (/[^WL]/.test(cleaned)) return { ok: false, error: "Use only W (win) and L (loss), e.g. LLLWLW." };
  if (cleaned.length > PREVIEW_MAX_ROUNDS) return { ok: false, error: `At most ${PREVIEW_MAX_ROUNDS} rounds (got ${cleaned.length}).` };
  return { ok: true, outcomes: [...cleaned].map((c) => c === "W") };
}

export function previewRule(rule: unknown, script: string, pc: PreviewContext): PreviewResult {
  const parsed = parseScript(script);
  if (!parsed.ok) return parsed;
  const v = validateRule(rule);
  if (!v.ok) return { ok: false, error: "Fix the rule's problems to see the preview." };
  const strategy = compileValidRule(v.rule);

  const game = { winProb: pc.winProb, netPayout: pc.netPayout, edge: 1 - pc.winProb * (1 + pc.netPayout), outcomes: [{ prob: pc.winProb, net: pc.netPayout }, { prob: 1 - pc.winProb, net: -1 }] };
  let bankroll = pc.startBankroll;
  let lastBet: number | null = null;
  let carry = 0; // the runner's sub-cent carry, so the bankroll column matches a real session
  const ctx = (round: number): StrategyContext => ({ bankroll, baseBet: pc.baseBet, round, lastBet, game });

  let state = strategy.init({}, ctx(0));
  const rows: PreviewRow[] = [];
  for (const [i, won] of parsed.outcomes.entries()) {
    const desired = strategy.nextBet(state, ctx(i));
    if (desired === "stop") return { ok: true, rows, next: "stop", stoppedEarly: true };
    const bet = Math.max(1, Math.round(desired));
    if (won) {
      const owed = bet * pc.netPayout + carry;
      const paid = Math.round(owed);
      carry = owed - paid;
      bankroll += paid;
    } else {
      bankroll -= bet;
    }
    lastBet = bet;
    rows.push({ round: i + 1, units: desired / pc.baseBet, bet, won, bankrollAfter: bankroll });
    // The round's exact profit (bet × net), as the runner reports it.
    const result: RoundResult = won ? { kind: "win", outcomeIndex: 0, profit: bet * pc.netPayout } : { kind: "loss", outcomeIndex: 1, profit: -bet };
    state = strategy.update(state, result, ctx(i + 1));
  }
  const next = strategy.nextBet(state, ctx(parsed.outcomes.length));
  return { ok: true, rows, next: next === "stop" ? "stop" : { units: next / pc.baseBet }, stoppedEarly: false };
}

/** Preview context from the scenario's (dollar) values, falling back to sane values while they're invalid. */
export function previewContextOf(s: { baseBet: number; startBankroll: number; game: { winProb: number; netPayout: number } }): PreviewContext {
  const cents = (d: number, fallback: number) => (Number.isFinite(d) && Math.round(d * 100) >= 1 ? Math.round(d * 100) : fallback);
  const winProb = Number.isFinite(s.game.winProb) && s.game.winProb > 0 && s.game.winProb < 1 ? s.game.winProb : 0.5;
  const netPayout = Number.isFinite(s.game.netPayout) && s.game.netPayout > 0 ? s.game.netPayout : 1;
  return { baseBet: cents(s.baseBet, 1000), startBankroll: cents(s.startBankroll, 100_000), winProb, netPayout };
}

/** Units for display: up to 4 decimals, no trailing zeros. */
export function formatUnits(u: number): string {
  return u.toLocaleString("en-US", { maximumFractionDigits: 4 });
}
