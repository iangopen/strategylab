import { describe, expect, it } from "vitest";
import { editorGame, ticketExample, type OutcomeEditor } from "./outcomeEditor";

const ok = (e: OutcomeEditor) => {
  const r = editorGame(e);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r;
};

describe("outcome editor -> outcomes", () => {
  it("the ticket example: nets (prize - price) / price, mean prize $61.67, house edge 5/42", () => {
    const r = ok(ticketExample());
    expect(r.outcomes.map((o) => o.net)).toEqual([(20 - 70) / 70, (50 - 70) / 70, (100 - 70) / 70]);
    expect(r.outcomes.map((o) => o.prob)).toEqual([1 / 6, 3 / 6, 2 / 6]);
    expect(r.outcomes.map((o) => o.label)).toEqual(["$20", "$50", "$100"]);
    expect(r.readout.probSum).toBe("1");
    expect(r.readout.meanPrize).toBeCloseTo(370 / 6, 12);
    expect(r.readout.meanReturn).toBeCloseTo(37 / 42, 15);
    expect(r.readout.edge).toBeCloseTo(5 / 42, 15);
    expect(r.readout.kinds).toEqual(["loss", "loss", "win"]);
    expect(r.readout.cannotLose).toBe(false);
    const at60 = ok({ ...ticketExample(), price: 60 });
    expect(at60.readout.edge).toBeCloseTo(-1 / 36, 15); // player edge 2.778%
  });

  it("a prize equal to the price is a push (net exactly 0); a $0 prize is a total loss (net exactly -1)", () => {
    const r = ok({ mode: "ticket", price: 7.3, rows: [{ prob: "1/2", value: 7.3 }, { prob: "1/2", value: 0 }] });
    expect(r.outcomes.map((o) => o.net)).toEqual([0, -1]);
    expect(r.readout.kinds).toEqual(["push", "loss"]);
  });

  it("multiplier mode: net = r - 1 with the decimal artifact snapped; 1 is a push; the cannot-lose warning", () => {
    const r = ok({ mode: "multiplier", price: null, rows: [{ prob: "0.5", value: 1.91 }, { prob: "0.5", value: 0 }] });
    expect(1.91 - 1).not.toBe(0.91);
    expect(r.outcomes[0]!.net).toBe(0.91);
    expect(r.outcomes[0]!.label).toBe("1.91x");
    const safe = ok({ mode: "multiplier", price: null, rows: [{ prob: "0.9", value: 1 }, { prob: "0.1", value: 1.5 }] });
    expect(safe.readout.cannotLose).toBe(true);
    expect(safe.readout.kinds).toEqual(["push", "win"]);
  });

  it("errors are keyed per field and the probability sum is exact", () => {
    const r = editorGame({ mode: "ticket", price: -5, rows: [{ prob: "1/0", value: 20 }, { prob: "0.5", value: -1 }, { prob: "0.5", value: 3, label: "x".repeat(25) }] });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(Object.keys(r.errors).sort()).toEqual(["price", "row1.prob", "row2.value", "row3.label"]);
    const sum = editorGame({ mode: "multiplier", price: null, rows: [{ prob: "1/3", value: 2 }, { prob: "1/3", value: 0 }] });
    expect(!sum.ok && sum.errors.sum).toBe("The probabilities must add up to 1 (they add up to 2/3).");
    expect(editorGame({ mode: "multiplier", price: null, rows: [] }).ok).toBe(false);
    // Within 1e-9 of 1 is accepted, exactly as the engine does.
    expect(ok({ mode: "multiplier", price: null, rows: [{ prob: "0.5", value: 2 }, { prob: "0.5000000005", value: 0 }] }).readout.probSum).toBe("2000000001/2000000000");
  });
});
