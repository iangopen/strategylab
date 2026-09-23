import * as Comlink from "comlink";
import type { MonteCarloResult } from "../engine/montecarlo";
import type { SimApi, SimRequest } from "./sim.worker";

export class CancelledError extends Error {
  constructor() {
    super("Simulation cancelled");
    this.name = "CancelledError";
  }
}

/**
 * Owns the simulation worker. The UI never runs a simulation on the main thread.
 * Cancel = terminate the worker (Comlink cannot interrupt a sync loop), then spawn a fresh one.
 */
export class SimClient {
  private worker!: Worker;
  private api!: Comlink.Remote<SimApi>;
  private rejectPending: ((e: Error) => void) | null = null;

  constructor() {
    this.spawn();
  }

  private spawn(): void {
    this.worker = new Worker(new URL("./sim.worker.ts", import.meta.url), { type: "module" });
    this.api = Comlink.wrap<SimApi>(this.worker);
  }

  get running(): boolean {
    return this.rejectPending !== null;
  }

  run(req: SimRequest, onProgress: (fraction: number) => void): Promise<MonteCarloResult> {
    if (this.running) return Promise.reject(new Error("A simulation is already running"));
    return new Promise<MonteCarloResult>((resolve, reject) => {
      this.rejectPending = reject;
      this.api.run(req, Comlink.proxy(onProgress)).then(
        (result) => {
          this.rejectPending = null;
          resolve(result);
        },
        (err: unknown) => {
          this.rejectPending = null;
          reject(err instanceof Error ? err : new Error(String(err)));
        },
      );
    });
  }

  cancel(): void {
    const reject = this.rejectPending;
    this.rejectPending = null;
    this.worker.terminate();
    this.spawn();
    reject?.(new CancelledError());
  }

  dispose(): void {
    const reject = this.rejectPending;
    this.rejectPending = null;
    this.worker.terminate();
    reject?.(new CancelledError());
  }
}
