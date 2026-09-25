import { describe, expect, it } from "vitest";
import { betSequence, expectPure, gameView, L, W } from "../testUtils";
import { oscars } from "./oscars";

describe("oscars: exact bet sequences (no runner)", () => {
  it("holds the bet after losses, raises it one unit after a win, capped to what closes the cycle", () => {
    // cp/u: 0/1 -L-> -100/1 -L-> -200/1 -W-> -100/2 (raise) -W-> reaches +100 goal, reset to 0/1.
    // The u=2 bet would be 200 but only +200 is needed to hit the goal from -100, so 200 stands.
    expect(betSequence(oscars, {}, [L, L, W, W])).toEqual([100, 100, 100, 200, 100]);
  });

  it("a single win at the base bet closes the cycle immediately", () => {
    expect(betSequence(oscars, {}, [W])).toEqual([100, 100]);
  });

  it("non-even payout 1.2: the cap is ceil((goal - profit) / netPayout), so the base bet shrinks", () => {
    // One $1 win pays $1.20, more than the $1 goal, so the very first bet is capped to 84c.
    expect(betSequence(oscars, {}, [W], 100, gameView(1.2))).toEqual([84, 84]);
  });

  it("non-even payout 1.2: the cap also clamps a raised bet down to the exact win needed", () => {
    // 0/1 -W(84)-> +100.8 resets? No: first bet is capped to 84 and wins, so use L first.
    // 0/1 -L(84)-> -84/1 -W(100)-> +36/2 -> cap = ceil((100-36)/1.2)=54 clamps the u=2 (200) bet.
    expect(betSequence(oscars, {}, [L, W], 100, gameView(1.2))).toEqual([84, 100, 54]);
  });
});

describe("oscars: purity", () => {
  it("does not mutate deep-frozen config, state, or ctx", () => {
    expectPure(oscars, {});
  });
});
