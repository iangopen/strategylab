import type { Strategy } from "./types";

type DAlembertConfig = { unitSize: number };
type DAlembertState = { readonly unitSize: number; readonly units: number };

/**
 * D'Alembert: bet = base + units × (unitSize × base). Loss: units + 1. Win: units - 1,
 * never below 0, so the bet never drops below the base bet.
 */
export const dalembert: Strategy<DAlembertConfig, DAlembertState> = {
  id: "dalembert",
  label: "D'Alembert",
  description: "Adds one unit to the bet after a loss and removes one after a win, never going below the base bet. A slower, linear progression.",
  configSchema: [
    { key: "unitSize", label: "Unit size (× base bet)", kind: "number", min: 0.1, max: 10, step: 0.1, help: "1 means each step changes the bet by one base bet." },
  ],
  defaultConfig: { unitSize: 1 },
  init: (config) => ({ unitSize: config.unitSize, units: 0 }),
  nextBet: (state, ctx) => ctx.baseBet + state.units * state.unitSize * ctx.baseBet,
  update: (state, result) => ({ ...state, units: result.kind === "win" ? Math.max(0, state.units - 1) : state.units + 1 }),
};
