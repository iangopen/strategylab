import type { Strategy } from "./types";

type FlatConfig = { units: number };
type FlatState = { readonly units: number };

/** Reference implementation of the strategy contract: bet the same amount every round. */
export const flat: Strategy<FlatConfig, FlatState> = {
  id: "flat",
  label: "Flat",
  description: "Bets the same amount every round: base bet × units.",
  configSchema: [
    { key: "units", label: "Units per bet", kind: "number", min: 0.01, max: 1000, step: 0.5, help: "Bet = base bet × units." },
  ],
  defaultConfig: { units: 1 },
  init: (config) => ({ units: config.units }),
  nextBet: (state, ctx) => ctx.baseBet * state.units,
  update: (state) => state,
};
