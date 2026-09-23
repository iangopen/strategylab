import type { Strategy } from "./types";

type LabouchereConfig = { sequence: string; onComplete: string };
type LabouchereState = {
  /** The working line of unit numbers. IMMUTABLE: only slice/spread ever build the next one. */
  readonly line: readonly number[];
  /** The original line, used to restart a completed cycle. */
  readonly preset: readonly number[];
  readonly onComplete: "restart" | "stop";
};

const PRESETS = ["1-2-3-4", "1-1-1-1-1", "1-2-3-4-5-6", "2-2-2-2"] as const;

/** Parses a preset like "1-2-3-4" into [1, 2, 3, 4]. */
function parseLine(s: string): number[] {
  return s.split("-").map((n) => Number(n));
}

/** Units staked from the current line: the single number, or first + last. */
function betUnits(line: readonly number[]): number {
  if (line.length === 1) return line[0]!;
  return line[0]! + line[line.length - 1]!;
}

/**
 * Labouchere (cancellation): keep a line of unit numbers. Bet the first + last (or the single
 * remaining number) × base. A win cancels the first and last; a loss appends the units just bet.
 * When the line empties, the cycle is complete: restart from the preset, or stop.
 */
export const labouchere: Strategy<LabouchereConfig, LabouchereState> = {
  id: "labouchere",
  label: "Labouchère",
  description:
    "Works down a line of numbers: bet the first plus the last, cross both off after a win, and add the amount just bet after a loss. Clearing the line books a small target profit; a long losing run makes the line — and the bets — grow.",
  configSchema: [
    {
      key: "sequence",
      label: "Starting line",
      kind: "select",
      options: PRESETS.map((p) => ({ value: p, label: p })),
      help: "Units in the starting line. Bet = (first + last) × base bet. Custom lines come later, with the rule builder.",
    },
    {
      key: "onComplete",
      label: "When the line clears",
      kind: "select",
      options: [
        { value: "restart", label: "Restart the line" },
        { value: "stop", label: "Stop the session" },
      ],
      help: "Clearing the line books the target profit. Restart to keep going, or stop and keep it.",
    },
  ],
  defaultConfig: { sequence: "1-2-3-4", onComplete: "restart" },
  init: (config) => {
    const preset = parseLine(config.sequence);
    return { line: preset, preset, onComplete: config.onComplete === "stop" ? "stop" : "restart" };
  },
  nextBet: (state, ctx) => {
    if (state.line.length === 0) return "stop"; // only reachable when onComplete = "stop"
    return ctx.baseBet * betUnits(state.line);
  },
  update: (state, won) => {
    if (state.line.length === 0) return state; // session already ended
    if (!won) return { ...state, line: [...state.line, betUnits(state.line)] };
    // Win: cancel the first and last number.
    const next = state.line.length <= 2 ? [] : state.line.slice(1, -1);
    if (next.length > 0) return { ...state, line: next };
    // Cycle complete: refill from the preset, or leave empty to stop next time.
    return { ...state, line: state.onComplete === "restart" ? state.preset : [] };
  },
};
