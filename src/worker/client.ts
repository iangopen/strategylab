import * as Comlink from "comlink";
import type { MonteCarloResult } from "../engine/montecarlo";
import type { Replay } from "../engine/replay";
import type { SweepCellResult, SweepRequest } from "../sweep/run";
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
    return this.track(() => this.api.run(req, Comlink.proxy(onProgress)));
  }

  /** Runs a sweep in the same worker; cancel() stops it like a run (terminate + respawn). */
  sweep(req: SweepRequest, onCell: (cell: SweepCellResult) => void, onProgress: (fraction: number) => void): Promise<SweepCellResult[]> {
    return this.track(() => this.api.sweep(req, Comlink.proxy(onCell), Comlink.proxy(onProgress)));
  }

  /** One job at a time; cancel() and dispose() reject the pending one with CancelledError. */
  private track<T>(start: () => Promise<T>): Promise<T> {
    if (this.running) return Promise.reject(new Error("A simulation is already running"));
    return new Promise<T>((resolve, reject) => {
      this.rejectPending = reject;
      start().then(
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

  /** Re-simulates one session for every strategy. Not allowed while a run is in progress. */
  replay(req: SimRequest, session: number): Promise<Replay> {
    if (this.running) return Promise.reject(new Error("Wait for the run to finish before replaying"));
    return this.api.replay(req, session);
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
