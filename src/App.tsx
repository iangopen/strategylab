import { useEffect, useMemo, useRef, useState } from "react";
import { isBinary } from "./engine/games";
import type { MonteCarloResult } from "./engine/montecarlo";
import type { Replay } from "./engine/replay";
import { toSimRequest, validateScenario, type ScenarioConfig } from "./scenario";
import { ChartSlot } from "./ui/ChartSlot";
import type { ChartRefs } from "./ui/charts/adapters";
import { FanChart } from "./ui/charts/FanChart";
import { HistogramChart } from "./ui/charts/HistogramChart";
import { ReplayChart } from "./ui/charts/ReplayChart";
import { ConfigPanel } from "./ui/ConfigPanel";
import { LinkBanner } from "./ui/LinkBanner";
import { baseUrl, bootFromLocation, canonicalizeAddressBar, noticeOf, pageLinkLoader, showInAddressBar, type LinkNotice } from "./ui/linkBoot";
import { ResultsTable } from "./ui/ResultsTable";
import { RunControls, type CopyStatus } from "./ui/RunControls";
import { copyBlocker, encodeScenarioLink } from "./share/link";
import { formatElapsed, instanceLabel, runAnnouncement } from "./ui/format";
import { ReportView } from "./report/ReportView";
import { previewContextOf } from "./ui/rules/preview";
import { StrategyPicker } from "./ui/StrategyPicker";
import { applyThemePref, loadThemePref, type ThemePref } from "./ui/theme";
import { CancelledError, SimClient } from "./worker/client";
import type { SimRequest } from "./worker/sim.worker";
import { toSweepRequest } from "./sweep/request";
import { sweepGrid } from "./sweep/sweep";
import { isSweepErrorKey } from "./sweep/validate";
import { SweepPanel, type SweepRun } from "./ui/sweep/SweepPanel";

/** A scenario's identity for a plain run: everything but the sweep (editing the sweep doesn't stale a run). */
const runKey = (s: ScenarioConfig) => JSON.stringify({ ...s, sweep: undefined });

interface CompletedRun {
  result: MonteCarloResult;
  labels: string[];
  /** The scenario exactly as it was when Run was clicked (the report and its link use it). */
  scenario: ScenarioConfig;
  /** JSON of the scenario that produced this result, to flag stale results. */
  scenarioJson: string;
  /** The exact request that produced this result (charts and replay use it, not the live form). */
  request: SimRequest;
  refs: ChartRefs;
}

export default function App() {
  // ALL scenario state lives here, in one serializable object. A #s= link in the address bar seeds it
  // (decoded once per page; never auto-runs).
  const [scenario, setScenario] = useState<ScenarioConfig>(() => bootFromLocation().scenario);
  // What happened when a link was opened. View state, not scenario state.
  const [linkNotice, setLinkNotice] = useState<LinkNotice | null>(() => bootFromLocation().notice);
  const [copyStatus, setCopyStatus] = useState<CopyStatus | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  // null until the first run starts: the counter shows "—" rather than claiming a run took "<0.1s".
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<string | null>(null);
  const [run, setRun] = useState<CompletedRun | null>(null);
  const client = useRef<SimClient | null>(null);
  // UI preference, not scenario state.
  const [theme, setTheme] = useState<ThemePref>(loadThemePref);
  // Which session is highlighted / replayed. View state, not scenario state.
  const [selectedSession, setSelectedSession] = useState<number | null>(null);

  // The parameter sweep's progress and result. View state; the sweep SETUP is scenario.sweep.
  const [sweeping, setSweeping] = useState(false);
  const [sweepProgress, setSweepProgress] = useState(0);
  const [sweepStatus, setSweepStatus] = useState<string | null>(null);
  const [sweepRun, setSweepRun] = useState<SweepRun | null>(null);
  // Which sweep may still deliver cells. Cancel bumps it: cell messages the terminated worker had
  // already posted can still arrive afterwards, and they must not fill in a cancelled sweep.
  const sweepToken = useRef(0);

  const [replay, setReplay] = useState<Replay | null>(null);
  const [replayStatus, setReplayStatus] = useState<string | null>(null);
  const replayRequestId = useRef(0);
  // The one-page report for the displayed run. View state, not scenario state.
  const [reportOpen, setReportOpen] = useState(false);
  const reportButton = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef(false);
  useEffect(() => {
    if (!reportOpen && returnFocus.current) {
      returnFocus.current = false;
      reportButton.current?.focus();
    }
  }, [reportOpen]);

  useEffect(() => applyThemePref(theme), [theme]);

  // Links: canonicalize the address bar after the initial load (replaceState, no new history entry),
  // then load fragments that change later (typed or pasted into the address bar). The page loader
  // applies each fragment at most once, so Back, StrictMode and hashchange + popstate never re-fire it.
  useEffect(() => {
    const initial = bootFromLocation().result;
    if (initial) canonicalizeAddressBar(initial);
    const onNavigate = () =>
      pageLinkLoader.handle(window.location.hash, (r) => {
        if (r.kind === "loaded") setScenario(r.scenario);
        setLinkNotice(noticeOf(r));
        canonicalizeAddressBar(r);
      });
    window.addEventListener("hashchange", onNavigate);
    window.addEventListener("popstate", onNavigate);
    return () => {
      window.removeEventListener("hashchange", onNavigate);
      window.removeEventListener("popstate", onNavigate);
    };
  }, []);

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
  // A plain run ignores the sweep's errors; the sweep panel shows them.
  const canRun = Object.keys(errors).every(isSweepErrorKey);
  const linkBlocker = useMemo(() => copyBlocker(scenario), [scenario]);

  // A plain "copied" confirmation is brief; errors and left-out warnings stay until the next copy.
  useEffect(() => {
    if (copyStatus?.kind !== "copied" || copyStatus.leftOut.length > 0) return;
    const id = setTimeout(() => setCopyStatus(null), 5000);
    return () => clearTimeout(id);
  }, [copyStatus]);

  /** Encodes the valid part of the scenario, puts it in the address bar (replaceState) and copies it. */
  async function handleCopyLink() {
    const enc = encodeScenarioLink(scenario, baseUrl());
    if (!enc.ok) {
      setCopyStatus({ kind: "error", message: enc.message });
      return;
    }
    const url = baseUrl() + enc.fragment;
    const leftOut = enc.leftOut.map((i) => instanceLabel(scenario.strategies, i));
    if (enc.sweepLeftOut) leftOut.push("the sweep");
    showInAddressBar(enc.fragment); // a reload now restores this scenario, custom rules included
    try {
      await navigator.clipboard.writeText(url);
      setCopyStatus({ kind: "copied", urlLength: enc.urlLength, leftOut });
    } catch {
      setCopyStatus({ kind: "manual", url, leftOut });
    }
  }
  const { baseBet, startBankroll, game } = scenario;
  const previewContext = useMemo(() => previewContextOf({ baseBet, startBankroll, game }), [baseBet, startBankroll, game]);

  async function handleRun() {
    const c = client.current;
    if (!c || !canRun || sweeping) return;
    const snapshot = scenario;
    const started = performance.now();
    setRunning(true);
    setProgress(0);
    setElapsedMs(0);
    setStatus(null);
    setAnnouncement(null);
    try {
      const request = toSimRequest(snapshot);
      const result = await c.run(request, setProgress);
      const ms = performance.now() - started;
      setElapsedMs(ms);
      const labels = snapshot.strategies.map((_, i) => instanceLabel(snapshot.strategies, i));
      setRun({
        result,
        labels,
        scenario: snapshot,
        scenarioJson: runKey(snapshot),
        request,
        refs: { start: request.session.startBankroll, stopWin: request.session.stopWin, stopLoss: request.session.stopLoss },
      });
      setSelectedSession(null);
      setReplay(null);
      setReplayStatus(null);
      setAnnouncement(runAnnouncement(result.perStrategy.map((o, i) => ({ label: labels[i] ?? o.strategyId, stats: o.stats }))));
      setStatus(`Done: ${result.nSessions.toLocaleString("en-US")} sessions in ${formatElapsed(ms)}.`);
    } catch (err) {
      setStatus(err instanceof CancelledError ? "Cancelled. Previous results (if any) are kept." : `Error: ${(err as Error).message}`);
    } finally {
      setRunning(false);
    }
  }

  /** Runs the sweep in the worker cell by cell; each finished cell fills in at once. */
  async function handleSweep() {
    const c = client.current;
    const sweep = scenario.sweep;
    if (!c || !sweep || running || sweeping || Object.keys(errors).length > 0) return;
    const snapshot = scenario;
    const grid = sweepGrid(snapshot, sweep);
    const index = snapshot.strategies.findIndex((i) => i.uid === sweep.strategyUid);
    const started = performance.now();
    const token = ++sweepToken.current;
    let done = 0;
    setSweepRun({ scenario: snapshot, sweep, grid, strategyLabel: instanceLabel(snapshot.strategies, index), cells: Array<null>(grid.cells).fill(null), complete: false, scenarioJson: JSON.stringify(snapshot) });
    setSweeping(true);
    setSweepProgress(0);
    setSweepStatus(`Running ${grid.cells.toLocaleString("en-US")} cells...`);
    try {
      const all = await c.sweep(
        toSweepRequest(snapshot, sweep),
        (cell) => {
          if (token !== sweepToken.current) return; // cancelled: a late message from the old worker
          done++;
          setSweepRun((prev) => {
            if (!prev || prev.scenario !== snapshot) return prev;
            const cells = prev.cells.slice();
            cells[cell.index] = cell;
            return { ...prev, cells };
          });
        },
        (f) => {
          if (token === sweepToken.current) setSweepProgress(f);
        },
      );
      setSweepRun((prev) => (prev && prev.scenario === snapshot ? { ...prev, cells: all, complete: true } : prev));
      setSweepProgress(1);
      setSweepStatus(`Done: ${grid.cells.toLocaleString("en-US")} cells × ${grid.sessionsPerCell.toLocaleString("en-US")} sessions in ${formatElapsed(performance.now() - started)}.`);
    } catch (err) {
      setSweepStatus(
        err instanceof CancelledError
          ? `Cancelled after ${done.toLocaleString("en-US")} of ${grid.cells.toLocaleString("en-US")} cells. The finished cells are kept; the bankroll readout needs every cell.`
          : `Error: ${(err as Error).message}`,
      );
    } finally {
      setSweeping(false);
    }
  }

  // Replay the selected session for every strategy in the displayed run (re-simulated in the worker).
  useEffect(() => {
    const c = client.current;
    if (!run || selectedSession === null || !c || running || sweeping) return;
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
  }, [run, selectedSession, running, sweeping]);

  const columns = useMemo(() => (run ? run.result.perStrategy.map((outcome, i) => ({ label: run.labels[i] ?? outcome.strategyId, outcome, colorIndex: i })) : []), [run]);

  if (reportOpen && run) {
    return (
      <ReportView
        result={run.result}
        labels={run.labels}
        scenario={run.scenario}
        refs={run.refs}
        onClose={() => {
          returnFocus.current = true;
          setReportOpen(false);
        }}
      />
    );
  }

  return (
    <div className="app">
      <header>
        <div className="header-row">
          <h1>StrategyLab</h1>
          <label className="theme-control">
            Theme
            <select value={theme} onChange={(e) => setTheme(e.target.value as ThemePref)}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
        </div>
        <p className="subtitle">A Monte Carlo simulator for betting strategies.</p>
        <p className="tagline">
          In a game with a house edge, every bet loses <em>edge × stake</em> on average. No betting strategy changes that; it only
          reshapes the spread of outcomes. Compare strategies here on identical simulated outcomes.
        </p>
        <p className="disclaimer" data-testid="disclaimer">
          An educational simulation for adults (18+). No real money is involved, and nothing here is betting advice. If gambling
          is causing problems for you or someone you know, call or text 1-800-MY-RESET, the US National Problem Gambling Helpline
          (<a href="https://www.ncpgambling.org/help-treatment/" target="_blank" rel="noopener noreferrer">ncpgambling.org</a>).
        </p>
      </header>
      {linkNotice && <LinkBanner notice={linkNotice} onDismiss={() => setLinkNotice(null)} />}
      <main className="layout">
        <div className="left">
          <ConfigPanel scenario={scenario} onChange={setScenario} errors={errors} />
          <StrategyPicker instances={scenario.strategies} onChange={(strategies) => setScenario({ ...scenario, strategies })} errors={errors} previewContext={previewContext} binaryGame={isBinary(scenario.game)} />
        </div>
        <div className="right">
          <RunControls
            running={running}
            canRun={canRun && !sweeping}
            progress={progress}
            elapsedMs={elapsedMs}
            status={status}
            announcement={announcement}
            onRun={() => void handleRun()}
            onCancel={() => client.current?.cancel()}
            copyBlocker={linkBlocker}
            copyStatus={copyStatus}
            onCopyLink={() => void handleCopyLink()}
            reportAvailable={run !== null && !running}
            onOpenReport={() => setReportOpen(true)}
            reportButtonRef={reportButton}
          />
          <ResultsTable columns={columns} nSessions={run?.result.nSessions ?? 0} stale={run !== null && run.scenarioJson !== runKey(scenario)} />
          {run ? (
            <FanChart result={run.result} labels={run.labels} refs={run.refs} onPickSession={setSelectedSession} selectedSession={selectedSession} />
          ) : (
            <ChartSlot
              title="Bankroll over time"
              description="How each strategy's bankroll evolves over the rounds: the middle 50% and 90% of sessions, the median, and the first 50 sessions, one panel per strategy on shared axes."
            />
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
            <ChartSlot
              title="Final bankroll distribution"
              description="Where each strategy's sessions end: the share of sessions finishing in each bankroll range, on bins shared by every strategy."
            />
          )}
          <SweepPanel
            scenario={scenario}
            onChange={setScenario}
            errors={errors}
            baseValid={canRun}
            busy={running || sweeping}
            sweeping={sweeping}
            progress={sweepProgress}
            status={sweepStatus}
            run={sweepRun}
            onRun={() => void handleSweep()}
            onCancel={() => {
              sweepToken.current++;
              client.current?.cancel();
            }}
          />
        </div>
      </main>
      <footer className="help">
        Educational simulation. No real money, no casino links. <a href={`${import.meta.env.BASE_URL}third-party-licenses.txt`}>Third-party licences</a>
      </footer>
    </div>
  );
}
