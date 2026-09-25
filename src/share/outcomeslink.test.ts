// Scenario v4 multi-outcome games in links (session 13): exact round trips of the editor INPUTS and the
// derived outcomes, rejection in older link versions, and malformed or invalid input.
import { describe, expect, it } from "vitest";
import { ticketExample, type OutcomeEditor } from "../engine/outcomeEditor";
import { binaryView, defaultScenario, editorScenarioGame, migrateScenario, newStrategyInstance, OUTCOMES_GAME_ID, SCENARIO_VERSION, simGame, validateScenario, type ScenarioConfig } from "../scenario";
import { base64urlToBytes } from "./base64url";
import { decodeScenarioLink, encodeScenarioLink } from "./link";
import { FRAGMENT_PREFIX } from "./limits";
import { fragmentOf } from "./testLinks";

const BASE = "https://strategylab.example.app/";
const content = (s: ScenarioConfig) => ({ ...s, strategies: s.strategies.map(({ uid: _uid, ...rest }) => rest) });

function withEditor(editor: OutcomeEditor): ScenarioConfig {
  return { ...defaultScenario(), game: editorScenarioGame(editor), strategies: [newStrategyInstance("flat"), newStrategyInstance("oscars")] };
}

describe("v4 multi-outcome scenarios round-trip bit-exactly through a link", () => {
  const cases: [string, OutcomeEditor][] = [
    ["the ticket example ($70; 1/6, 3/6, 2/6)", ticketExample()],
    ["ticket at $60, with a push prize and labels", { mode: "ticket", price: 60, rows: [{ prob: "0.25", value: 0 }, { prob: "1/4", value: 60, label: "Money back" }, { prob: ".5", value: 90.5, label: "Jackpot" }] }],
    ["multiplier: 1.91 (float artifact snapped), a push, a partial loss, a total loss", { mode: "multiplier", price: null, rows: [{ prob: "0.4", value: 1.91 }, { prob: "0.1", value: 1 }, { prob: "0.2", value: 0.35 }, { prob: "0.3", value: 0 }] }],
    ["12 outcomes including 0.001, odd probabilities", { mode: "multiplier", price: null, rows: [0.2, 0.15, 0.12, 0.1, 0.09, 0.001, 0.08, 0.07, 0.06, 0.05, 0.049, 0.03].map((p, i) => ({ prob: String(p), value: i * 0.37 })) }],
    ["one outcome: a sure push", { mode: "multiplier", price: null, rows: [{ prob: "1", value: 1 }] }],
    ["fractions with big denominators", { mode: "ticket", price: 3.33, rows: [{ prob: "1/997", value: 1000 }, { prob: "996/997", value: 2.5 }] }],
  ];
  for (const [name, editor] of cases) {
    it(name, () => {
      const s = withEditor(editor);
      expect(validateScenario(s)).toEqual({});
      expect(s.game.presetId).toBe(OUTCOMES_GAME_ID);
      const enc = encodeScenarioLink(s, BASE);
      if (!enc.ok) throw new Error(enc.message);
      const dec = decodeScenarioLink(enc.fragment);
      if (dec.kind !== "loaded") throw new Error(JSON.stringify(dec));
      expect(dec.fromVersion).toBe(SCENARIO_VERSION);
      expect(dec.dropped).toEqual([]);
      expect(migrateScenario(dec.scenario)).toBe(dec.scenario);
      expect(content(dec.scenario)).toEqual(content(s)); // inputs AND derived outcomes, bit for bit
      expect(simGame(dec.scenario.game)).toEqual(simGame(s.game));
    });
  }

  it("the link carries only the inputs (probability TEXT, as typed); the outcomes are recomputed", () => {
    const enc = encodeScenarioLink(withEditor(ticketExample()), BASE);
    if (!enc.ok) throw new Error(enc.message);
    const bytes = base64urlToBytes(enc.fragment.slice(FRAGMENT_PREFIX.length));
    if (!bytes.ok) throw new Error(bytes.error);
    expect((JSON.parse(new TextDecoder().decode(bytes.bytes)) as { g: unknown }).g).toEqual(["m", "t", 70, [["1/6", 20], ["3/6", 50], ["2/6", 100]]]);
  });

  it("win/lose games stay in their old compact forms and read back exactly", () => {
    const s = defaultScenario();
    const enc = encodeScenarioLink(s, BASE);
    if (!enc.ok) throw new Error(enc.message);
    const dec = decodeScenarioLink(enc.fragment);
    expect(dec.kind === "loaded" && binaryView(dec.scenario.game)).toEqual({ winProb: 18 / 37, netPayout: 1 });
  });
});

describe("multi-outcome games in links: rejected where they can't be, reported when invalid", () => {
  const base = { g: "european", b: 1000, bb: 10, tn: 1, r: 1000, n: 10000, sd: 12345, st: [["flat"]] };
  const ticket = ["m", "t", 70, [["1/6", 20], ["3/6", 50], ["2/6", 100]]];

  it("a multi-outcome game in a version 1-3 link did not exist then: default game, reported", () => {
    for (const v of [1, 2, 3]) {
      const r = decodeScenarioLink(fragmentOf({ ...base, v, g: ticket }));
      expect(r.kind === "loaded" && r.scenario.game.presetId).toBe("european");
      expect(r.kind === "loaded" && r.dropped).toEqual([{ field: "Game", message: "multi-outcome games need a version 4 link; using the default" }]);
    }
  });

  it("invalid inputs in a v4 link: default game, with the editor's messages", () => {
    const r = decodeScenarioLink(fragmentOf({ ...base, v: 4, g: ["m", "t", 70, [["1/0", 20], ["abc", 50], ["2/6", -1]]] }));
    expect(r.kind === "loaded" && r.scenario.game.presetId).toBe("european");
    expect(r.kind === "loaded" && r.dropped).toEqual([
      { field: "Game", message: 'Cannot divide by zero (got "1/0"). Not a probability: "abc". Use a decimal (0.25) or a fraction (1/6). The prize must be from $0 to $1,000,000,000. Using the default game.' },
    ]);
    const sum = decodeScenarioLink(fragmentOf({ ...base, v: 4, g: ["m", "x", null, [["1/6", 2], ["1/6", 0]]] }));
    expect(sum.kind === "loaded" && sum.dropped).toEqual([{ field: "Game", message: "The probabilities must add up to 1 (they add up to 1/3). Using the default game." }]);
  });

  it("malformed outcome arrays are reported, never thrown", () => {
    const bad: unknown[] = [
      ["m"],
      ["m", "q", 70, [["1", 1]]],
      ["m", "t", "70", [["1", 1]]],
      ["m", "x", 5, [["1", 1]]],
      ["m", "t", 70, "rows"],
      ["m", "t", 70, []],
      ["m", "t", 70, Array.from({ length: 13 }, () => ["1/13", 1])],
      ["m", "t", 70, [[1, 1]]],
      ["m", "t", 70, [["1", "1"]]],
      ["m", "t", 70, [["1", 1, 7]]],
      ["m", "t", 70, [["1", 1, "x", "extra"]]],
      ["m", "t", 70, [["1".repeat(41), 1]]],
      ["m", "t", 70, [null]],
      ["m", "t", 70, [["1", 1]], "extra"],
    ];
    for (const g of bad) {
      const r = decodeScenarioLink(fragmentOf({ ...base, v: 4, g }));
      expect(r.kind).toBe("loaded");
      if (r.kind === "loaded") {
        expect(r.scenario.game.presetId, JSON.stringify(g)).toBe("european");
        expect(r.dropped, JSON.stringify(g)).toHaveLength(1);
        expect(r.dropped[0]!.field).toBe("Game");
      }
    }
  });
});

describe("scenario validation of outcome-editor games", () => {
  it("errors are keyed per input; stale derived outcomes and missing inputs are caught", () => {
    const bad = editorScenarioGame({ mode: "ticket", price: 0, rows: [{ prob: "1/2", value: 5 }, { prob: "x", value: 5 }] });
    expect(validateScenario({ ...defaultScenario(), game: bad })).toEqual({
      "game.price": "The ticket price must be more than $0 and at most $1,000,000.",
      "game.row2.prob": 'Not a probability: "x". Use a decimal (0.25) or a fraction (1/6).',
    });
    const stale = { ...editorScenarioGame(ticketExample()), outcomes: [{ prob: 1, net: 0 }] };
    expect(validateScenario({ ...defaultScenario(), game: stale }).game).toBe("The game's outcomes are out of date with its inputs.");
    expect(validateScenario({ ...defaultScenario(), game: { presetId: OUTCOMES_GAME_ID, outcomes: [{ prob: 1, net: 0 }] } }).game).toBe("The outcome inputs are missing.");
    expect(validateScenario({ ...defaultScenario(), game: { ...defaultScenario().game, editor: ticketExample() } }).game).toBe("Only an outcome-editor game has outcome inputs.");
    // A preset whose outcomes are not the win/lose form is flagged.
    expect(validateScenario({ ...defaultScenario(), game: { presetId: "european", outcomes: [{ prob: 1, net: 0 }] } }).game).toBe("A preset or custom game must be a win/lose game.");
  });

  it("the worker gets the outcome list (labels included); win/lose games still go as the binary shorthand", () => {
    expect(simGame(editorScenarioGame(ticketExample()))).toEqual({
      id: OUTCOMES_GAME_ID,
      name: "Custom outcomes",
      outcomes: [
        { prob: 1 / 6, net: (20 - 70) / 70, label: "$20" },
        { prob: 3 / 6, net: (50 - 70) / 70, label: "$50" },
        { prob: 2 / 6, net: (100 - 70) / 70, label: "$100" },
      ],
    });
    expect(simGame(defaultScenario().game)).toEqual({ id: "european", name: "European roulette (even-money)", winProb: 18 / 37, netPayout: 1 });
  });
});
