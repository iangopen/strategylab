import * as Comlink from "comlink";
import type { Game } from "../engine/games";
import { resultTransferables, runMonteCarlo, type MonteCarloResult } from "../engine/montecarlo";
import { replaySession, replayTransferables, type Replay } from "../engine/replay";
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

function specsOf(req: SimRequest) {
  return req.strategies.map(({ strategyId, config }) => {
    const strategy = getStrategy(strategyId);
    if (!strategy) throw new Error(`Unknown strategy "${strategyId}"`);
    return { strategy, config };
  });
}

const api = {
  run(req: SimRequest, onProgress: (fraction: number) => void): MonteCarloResult {
    const specs = specsOf(req);
    // onProgress is a Comlink proxy; calls are fire-and-forget messages (~every 2%).
    const result = runMonteCarlo(req.game, specs, req.session, req.nSessions, req.masterSeed, (f) => void onProgress(f));
    // Typed arrays (histogram, bands) are transferred, not copied. Per-session columns never leave here.
    return Comlink.transfer(result, resultTransferables(result));
  },

  /** Re-simulates session i for EVERY strategy in the run, from its seed (paths are never stored for this). */
  replay(req: SimRequest, session: number): Replay {
    if (session >= req.nSessions) throw new Error(`Session ${session} is outside this run (0..${req.nSessions - 1})`);
    const r = replaySession(req.game, specsOf(req), req.session, req.masterSeed, session);
    return Comlink.transfer(r, replayTransferables(r));
  },
};

export type SimApi = typeof api;

Comlink.expose(api);
