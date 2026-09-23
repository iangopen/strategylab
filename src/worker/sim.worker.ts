import * as Comlink from "comlink";
import type { Game } from "../engine/games";
import { resultTransferables, runMonteCarlo, type MonteCarloResult } from "../engine/montecarlo";
import { getStrategy } from "../engine/strategies/registry";
import type { StrategyConfig } from "../engine/strategies/types";
import type { SessionConfig } from "../engine/types";

/** Plain-data request: strategies are referenced by registry id, since functions can't cross the worker boundary. */
export interface SimRequest {
  game: Game;
  strategies: { strategyId: string; config: StrategyConfig }[];
  session: SessionConfig;
  nSessions: number;
  masterSeed: number;
}

const api = {
  run(req: SimRequest, onProgress: (fraction: number) => void): MonteCarloResult {
    const specs = req.strategies.map(({ strategyId, config }) => {
      const strategy = getStrategy(strategyId);
      if (!strategy) throw new Error(`Unknown strategy "${strategyId}"`);
      return { strategy, config };
    });
    // onProgress is a Comlink proxy; calls are fire-and-forget messages (~every 2%).
    const result = runMonteCarlo(req.game, specs, req.session, req.nSessions, req.masterSeed, (f) => void onProgress(f));
    // Typed arrays (histogram, bands) are transferred, not copied. Per-session columns never leave here.
    return Comlink.transfer(result, resultTransferables(result));
  },
};

export type SimApi = typeof api;

Comlink.expose(api);
