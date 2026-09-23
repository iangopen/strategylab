import { useEffect, useMemo, useRef, useState } from "react";
import type { MonteCarloResult } from "./engine/montecarlo";
import type { Replay } from "./engine/replay";
import { defaultScenario, toSimRequest, validateScenario, type ScenarioConfig } from "./scenario";
import { ChartSlot } from "./ui/ChartSlot";
import type { ChartRefs } from "./ui/charts/adapters";
import { FanChart } from "./ui/charts/FanChart";
import { HistogramChart } from "./ui/charts/HistogramChart";
import { ReplayChart } from "./ui/charts/ReplayChart";
import { ConfigPanel } from "./ui/ConfigPanel";
import { ResultsTable } from "./ui/ResultsTable";
import { RunControls } from "./ui/RunControls";
import { instanceLabel } from "./ui/format";
import { StrategyPicker } from "./ui/StrategyPicker";
import { applyThemePref, loadThemePref, type ThemePref } from "./ui/theme";
import { CancelledError, SimClient } from "./worker/client";
import type { SimRequest } from "./worker/sim.worker";

interface CompletedRun {
  result: MonteCarloResult;
  labels: string[];
  /** JSON of the scenario that produced this result, to flag stale results. */
  scenarioJson: string;
  /** The exact request that produced this result (charts and replay use it, not the live form). */
  request: SimRequest;
  refs: ChartRefs;
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
  // UI preference, not scenario state.
  const [theme, setTheme] = useState<ThemePref>(loadThemePref);
  // Which session is highlighted / replayed. View state, not scenario state.
  const [selectedSession, setSelectedSession] = useState<number | null>(null);

  const [replay, setReplay] = useState<Replay | null>(null);
  const [replayStatus, setReplayStatus] = useState<string | null>(null);
  const replayRequestId = useRef(0);

  useEffect(() => applyThemePref(theme), [theme]);

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
      const request = toSimRequest(snapshot);
      const result = await c.run(request, setProgress);
      const ms = performance.now() - started;
      setElapsedMs(ms);
      setRun({
        result,
        labels: snapshot.strategies.map((_, i) => instanceLabel(snapshot.strategies, i)),
        scenarioJson: JSON.stringify(snapshot),
        request,
        refs: { start: request.session.startBankroll, stopWin: request.session.stopWin, stopLoss: request.session.stopLoss },
      });
      setSelectedSession(null);
      setReplay(null);
      setReplayStatus(null);
      setStatus(`Done: ${result.nSessions.toLocaleString("en-US")} sessions in ${(ms / 1000).toFixed(1)}s.`);
    } catch (err) {
      setStatus(err instanceof CancelledError ? "Cancelled. Previous results (if any) are kept." : `Error: ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  // Replay the selected session for every strategy in the displayed run (re-simulated in the worker).
  useEffect(() => {
    const c = client.current;
    if (!run || selectedSession === null || !c || running) return;
    const id = ++replayRequestId.current;
    setReplayStatus(`Replaying session ${selectedSession.toLocaleString("en-US")}...`);
    c.replay(run.request, selectedSession).then(
      (r) => {
        if (id !== replayRequestId.current) return; // a newer replay was requested
        setReplay(r);
        setReplayStatus(null);
      },
      (err: unknown) => {
        if (id === replayRequestId.current) setReplayStatus(`Replay failed: ${(err as Error).message}`);
      },
    );
  }, [run, selectedSession, running]);

  const columns = useMemo(() => (run ? run.result.perStrategy.map((outcome, i) => ({ label: run.labels[i] ?? outcome.strategyId, outcome, colorIndex: i })) : []), [run]);

  return (
    <div className="app">
      <header>
        <div className="header-row">
          <h1>Betting Lab</h1>
          <label className="theme-control">
            Theme
            <select value={theme} onChange={(e) => setTheme(e.target.value as ThemePref)}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
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
          {run ? (
            <FanChart result={run.result} labels={run.labels} refs={run.refs} onPickSession={setSelectedSession} selectedSession={selectedSession} />
          ) : (
            <ChartSlot title="Bankroll over time" description="Percentile bands and the first 50 sessions of each strategy, on shared axes." />
          )}
          {run && (
            <ReplayChart
              nSessions={run.result.nSessions}
              labels={run.labels}
              refs={run.refs}
              replay={replay}
              status={replayStatus}
              disabled={running}
              onReplay={setSelectedSession}
            />
          )}
          {run ? (
            <HistogramChart result={run.result} labels={run.labels} start={run.refs.start} />
          ) : (
            <ChartSlot title="Final bankroll distribution" description="Histogram of final bankrolls, on bins shared by every strategy." />
          )}
        </div>
      </main>
      <footer className="help">Educational simulation. No real money, no casino links.</footer>
    </div>
  );
}
