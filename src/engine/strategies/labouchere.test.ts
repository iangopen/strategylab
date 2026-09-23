import { describe, expect, it } from "vitest";
import { betSequence, describeEvInvariant, expectPure, L, W } from "../testUtils";
import { labouchere } from "./labouchere";

describe("labouchere: exact bet sequences (no runner)", () => {
  it("bets first + last, cancels both on a win, appends the bet on a loss, then restarts", () => {
    // line [1,2,3,4] -> L append 5 -> [1,2,3,4,5] -> W cancel -> [2,3,4] -> W -> [3] (single) -> W clears -> restart.
    expect(betSequence(labouchere, { sequence: "1-2-3-4", onComplete: "restart" }, [L, W, W, W])).toEqual([500, 600, 600, 300, 500]);
  });

  it("a losing streak grows the line, and the bet, linearly", () => {
    expect(betSequence(labouchere, { sequence: "1-2-3-4", onComplete: "restart" }, [L, L, L])).toEqual([500, 600, 700, 800]);
  });

  it("onComplete = stop returns \"stop\" once the line clears", () => {
    // [1,2,3,4] -> W -> [2,3] -> W clears -> stop.
    expect(betSequence(labouchere, { sequence: "1-2-3-4", onComplete: "stop" }, [W, W])).toEqual([500, 500, "stop"]);
  });

  it("onComplete = restart refills from the preset instead of stopping", () => {
    expect(betSequence(labouchere, { sequence: "1-2-3-4", onComplete: "restart" }, [W, W])).toEqual([500, 500, 500]);
  });

  it("a different preset and base bet", () => {
    // [2,2,2,2] -> W -> [2,2] -> W clears -> restart. Base $5.
    expect(betSequence(labouchere, { sequence: "2-2-2-2", onComplete: "restart" }, [W, W], 500)).toEqual([2000, 2000, 2000]);
  });
});

describe("labouchere: purity", () => {
  it("does not mutate deep-frozen config, state, or ctx (line and preset stay immutable)", () => {
    expectPure(labouchere, { sequence: "1-2-3-4", onComplete: "restart" });
    expectPure(labouchere, { sequence: "1-1-1-1-1", onComplete: "stop" });
  });
});

describeEvInvariant(labouchere, { sequence: "1-2-3-4", onComplete: "restart" });
