import { describe, expect, it } from "vitest";
import { DALEMBERT_RULE, LABOUCHERE_RULE, MARTINGALE_RULE, PAROLI_RULE } from "../../engine/rules/examples";
import { formatUnits, parseScript, PREVIEW_MAX_ROUNDS, previewContextOf, previewRule, type PreviewContext } from "./preview";

// $1,000 start, $10 base, even money.
const EVEN: PreviewContext = { baseBet: 1000, startBankroll: 100_000, winProb: 18 / 37, netPayout: 1 };

function ladder(rule: unknown, script: string, pc = EVEN) {
  const r = previewRule(rule, script, pc);
  if (!r.ok) throw new Error(r.error);
  return { units: r.rows.map((x) => x.units), bankroll: r.rows.map((x) => x.bankrollAfter / 100), next: r.next, stoppedEarly: r.stoppedEarly, rows: r.rows };
}

describe("rule preview adapter (hand-written W/L strings)", () => {
  it("Martingale x2 rule, LLLWLW: 1, 2, 4, 8, 1, 2, next 1; bankroll tracks each bet", () => {
    const p = ladder(MARTINGALE_RULE, "LLLWLW");
    expect(p.units).toEqual([1, 2, 4, 8, 1, 2]);
    expect(p.next).toEqual({ units: 1 });
    expect(p.bankroll).toEqual([990, 970, 930, 1010, 1000, 1020]);
    expect(p.rows.map((r) => r.won)).toEqual([false, false, false, true, false, true]);
    expect(p.rows.map((r) => r.round)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("Paroli cap 3 rule, WWWWLW: 1, 2, 4, 1, 2, 1, next 2", () => {
    const p = ladder(PAROLI_RULE, "WWWWLW");
    expect(p.units).toEqual([1, 2, 4, 1, 2, 1]);
    expect(p.next).toEqual({ units: 2 });
  });

  it("D'Alembert rule, LLWWW: 1, 2, 3, 2, 1, next 1 (floor)", () => {
    expect(ladder(DALEMBERT_RULE, "LLWWW").units).toEqual([1, 2, 3, 2, 1]);
  });

  it("a sequence rule, LWWW: 5, 6, 6, 3, next 5 (restart)", () => {
    const p = ladder(LABOUCHERE_RULE, "LWWW");
    expect(p.units).toEqual([5, 6, 6, 3]);
    expect(p.next).toEqual({ units: 5 });
  });

  it("a stop partway through ends the ladder early", () => {
    // Flat, stop at +20%: $100 start, $10 base. W W reaches $120 -> stop before round 3.
    const rule = {
      kind: "progression",
      name: "Flat, stop at +20%",
      startUnits: 1,
      onWin: [{ when: { type: "bankroll", op: ">=", pct: 120 }, then: { type: "stop" } }, { then: { type: "reset" } }],
      onLoss: [{ then: { type: "reset" } }],
    };
    const p = ladder(rule, "WWWL", { ...EVEN, startBankroll: 10_000 });
    expect(p.units).toEqual([1, 1]);
    expect(p.bankroll).toEqual([110, 120]);
    expect(p.next).toBe("stop");
    expect(p.stoppedEarly).toBe(true);
    // A stop on the very last round is reported as the next bet, not as stopping early.
    const q = ladder(rule, "WW", { ...EVEN, startBankroll: 10_000 });
    expect(q.next).toBe("stop");
    expect(q.stoppedEarly).toBe(false);
  });

  it("uses the game's payout: after a $10 loss, the $20 bet wins $24 at 1.2", () => {
    expect(ladder(MARTINGALE_RULE, "LW", { ...EVEN, netPayout: 1.2 }).bankroll).toEqual([990, 1014]);
  });

  it("ignores case, spaces, commas and dashes; empty script shows only the first bet", () => {
    expect(ladder(MARTINGALE_RULE, " l l, w-L ").units).toEqual([1, 2, 4, 1]);
    const e = ladder(MARTINGALE_RULE, "");
    expect(e.units).toEqual([]);
    expect(e.next).toEqual({ units: 1 });
  });

  it("rejects bad characters, over-long scripts and invalid rules with a message", () => {
    expect(parseScript("LLXW")).toEqual({ ok: false, error: "Use only W (win) and L (loss), e.g. LLLWLW." });
    expect(parseScript("W".repeat(PREVIEW_MAX_ROUNDS)).ok).toBe(true);
    expect(parseScript("W".repeat(PREVIEW_MAX_ROUNDS + 1))).toEqual({ ok: false, error: `At most ${PREVIEW_MAX_ROUNDS} rounds (got ${PREVIEW_MAX_ROUNDS + 1}).` });
    const bad = previewRule({ ...MARTINGALE_RULE, startUnits: -1 }, "LW", EVEN);
    expect(bad).toEqual({ ok: false, error: "Fix the rule's problems to see the preview." });
  });

  it("uses the same compiled strategy as the simulation (units clamp shows through)", () => {
    const shrink = { kind: "progression", name: "shrink", startUnits: 1, onWin: [{ then: { type: "add", units: -5 } }], onLoss: [{ then: { type: "reset" } }] };
    const p = ladder(shrink, "W");
    expect(p.next).toEqual({ units: 0.01 });
    expect(formatUnits(0.01)).toBe("0.01");
    expect(formatUnits(1 / 3)).toBe("0.3333");
  });

  it("previewContextOf converts dollars to cents and falls back while the scenario is invalid", () => {
    expect(previewContextOf({ baseBet: 10, startBankroll: 1000, game: { winProb: 0.4, netPayout: 1.2 } })).toEqual({ baseBet: 1000, startBankroll: 100_000, winProb: 0.4, netPayout: 1.2 });
    expect(previewContextOf({ baseBet: NaN, startBankroll: 0, game: { winProb: 1, netPayout: -1 } })).toEqual({ baseBet: 1000, startBankroll: 100_000, winProb: 0.5, netPayout: 1 });
  });
});
