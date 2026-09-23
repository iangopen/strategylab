import { useEffect, useMemo, useRef, useState } from "react";
import type { MonteCarloResult } from "./engine/montecarlo";
import { defaultScenario, toSimRequest, validateScenario, type ScenarioConfig } from "./scenario";
import { ChartSlot } from "./ui/ChartSlot";
import { ConfigPanel } from "./ui/ConfigPanel";
import { ResultsTable } from "./ui/ResultsTable";
import { RunControls } from "./ui/RunControls";
import { instanceLabel } from "./ui/format";
import { StrategyPicker } from "./ui/StrategyPicker";
import { CancelledError, SimClient } from "./worker/client";

interface CompletedRun {
  result: MonteCarloResult;
  labels: string[];
  /** JSON of the scenario that produced this result, to flag stale results. */
  scenarioJson: string;
}

export default function App() {
  // ALL scenario state lives here, in one serializable object.
  const [scenario, setScenario] = useState<ScenarioConfig>(defaultScenario);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [status, setStatus] = useState<string | null>(null);
  const [run, setRun] = useState<CompletedRun | null>(null);
  const client = useRef<SimClient | null>(null);

  useEffect(() => {
    const c = new SimClient();
    client.current = c;
    return () => {
      c.dispose();
      client.current = null;
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const start = performance.now();
    const id = setInterval(() => setElapsedMs(performance.now() - start), 100);
    return () => clearInterval(id);
  }, [running]);

  const errors = useMemo(() => validateScenario(scenario), [scenario]);
  const canRun = Object.keys(errors).length === 0;

  async function handleRun() {
    const c = client.current;
    if (!c || !canRun) return;
    const snapshot = scenario;
    const started = performance.now();
    setRunning(true);
    setProgress(0);
    setElapsedMs(0);
    setStatus(null);
    try {
      const result = await c.run(toSimRequest(snapshot), setProgress);
      const ms = performance.now() - started;
      setElapsedMs(ms);
      setRun({
        result,
        labels: snapshot.strategies.map((_, i) => instanceLabel(snapshot.strategies, i)),
        scenarioJson: JSON.stringify(snapshot),
      });
      setStatus(`Done: ${result.nSessions.toLocaleString("en-US")} sessions in ${(ms / 1000).toFixed(1)}s.`);
    } catch (err) {
      setStatus(err instanceof CancelledError ? "Cancelled. Previous results (if any) are kept." : `Error: ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  const columns = run ? run.result.perStrategy.map((outcome, i) => ({ label: run.labels[i] ?? outcome.strategyId, outcome })) : [];

  return (
    <div className="app">
      <header>
        <h1>Betting Lab</h1>
        <p className="tagline">
          In a game with a house edge, every bet loses <em>edge × stake</em> on average. No betting strategy changes that; it only
          reshapes the spread of outcomes. Compare strategies here on identical simulated outcomes.
        </p>
      </header>
      <main className="layout">
        <div className="left">
          <ConfigPanel scenario={scenario} onChange={setScenario} errors={errors} />
          <StrategyPicker instances={scenario.strategies} onChange={(strategies) => setScenario({ ...scenario, strategies })} errors={errors} />
        </div>
        <div className="right">
          <RunControls
            running={running}
            canRun={canRun}
            progress={progress}
            elapsedMs={elapsedMs}
            status={status}
            onRun={() => void handleRun()}
            onCancel={() => client.current?.cancel()}
          />
          <ResultsTable columns={columns} nSessions={run?.result.nSessions ?? 0} stale={run !== null && run.scenarioJson !== JSON.stringify(scenario)} />
          <ChartSlot title="Sample paths" description="Bankroll over time for the first 50 sessions of each strategy." />
          <ChartSlot title="Percentile bands" description="5th–95th percentile bankroll over time." />
          <ChartSlot title="Final bankroll distribution" description="Histogram of final bankrolls across all sessions." />
        </div>
      </main>
      <footer className="help">Educational simulation. No real money, no casino links.</footer>
    </div>
  );
}
