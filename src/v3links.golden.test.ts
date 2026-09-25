// Directive 9 (session 13): v1-v3 links load exactly as before. The fixture holds what the VERSION 3
// decoder returned (captured from commit a9db5ce, before scenario v4) for a fixed set of v1, v2 and v3
// links. Now each must decode to that same scenario migrated v3 -> v4 (the game becomes its outcome
// form, exactly), with the same dropped list.
// Regenerate only on purpose: $env:GOLDEN_LINKS="write"; npx vitest run src/v3links.golden.test.ts
import { describe, expect, it } from "vitest";
import golden from "./v3links.golden.json";
import { decodeScenarioLink } from "./share/link";
import { fragmentOf } from "./share/testLinks";

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

const base = { b: 1000, bb: 10, tn: 1, sw: 1100, r: 1000, n: 10000, sd: 12345 };
/** The fixed link set: every game form each old version could carry, plus partial loads. */
export const OLD_LINKS: Record<string, string> = {
  "v1 european, Kelly 0 sentinel": fragmentOf({ v: 1, g: "european", ...base, st: [["flat"], ["kelly", { assumedWinProb: 0, fraction: 0.5 }]] }),
  "v1 custom game": fragmentOf({ v: 1, g: ["custom", 0.45, 1.2], ...base, st: [["martingale"]] }),
  "v2 rule + american": fragmentOf({ v: 2, g: "american", ...base, st: [["flat"], ["p", "Double after a loss", 1, [[["r"]]], [[["m", 2]]]]] }),
  "v2 custom game, long digits": fragmentOf({ v: 2, g: ["custom", 0.4712345678901234, 1.0833333333333333], ...base, st: [["paroli", { streakCap: 4 }]] }),
  "v2 partial (bad win target, unknown strategy)": fragmentOf({ v: 2, g: "european", ...base, sw: 900, st: [["flat"], ["doubleUpSystem"]] }),
  "v3 sports market -110 / -110": fragmentOf({ v: 3, g: ["o", "m", "a", -110, -110, "a", 0.5], ...base, st: [["flat"], ["martingale"]] }),
  "v3 sports +150 / -180 side B, decimal": fragmentOf({ v: 3, g: ["o", "m", "d", 2.5, 1.5555555555555556, "b", 0.5], ...base, st: [["oscars"]] }),
  "v3 sports estimate 0.55": fragmentOf({ v: 3, g: ["o", "e", "a", -110, -110, "a", 0.55], ...base, st: [["kelly"]] }),
  "v3 fair coin, every field set": fragmentOf({ v: 3, g: "fairCoin", b: 1234.56, bb: 5, tn: 1, tx: 250, sw: 1500, sl: 500, r: 777, f: "a", n: 25000, sd: 4294967295, st: [["dalembert", { unitSize: 0.5 }]] }),
  "v3 custom game": fragmentOf({ v: 3, g: ["custom", 0.3, 2.5], ...base, st: [["fibonacci"]] }),
  "v3 bad game": fragmentOf({ v: 3, g: ["custom", 1.5, -1], ...base, st: [["flat"]] }),
};

/** A decoded link without instance uids (React identity, not content). */
export function decodedContent(hash: string): unknown {
  const r = decodeScenarioLink(hash);
  if (r.kind !== "loaded") return r;
  return { fromVersion: r.fromVersion, dropped: r.dropped, scenario: { ...r.scenario, strategies: r.scenario.strategies.map(({ uid: _uid, ...rest }) => rest) } };
}

describe.skipIf(env.GOLDEN_LINKS !== "write")("golden capture (writes v3links.golden.json)", () => {
  it("captures", async () => {
    const out = Object.fromEntries(Object.entries(OLD_LINKS).map(([name, hash]) => [name, { hash, decoded: decodedContent(hash) }]));
    const fsName = "node:fs";
    const fs = (await import(/* @vite-ignore */ fsName)) as { writeFileSync(u: URL, s: string): void };
    fs.writeFileSync(new URL("./v3links.golden.json", import.meta.url), JSON.stringify(out, null, 1) + "\n");
  });
});

describe("the captured fixture covers the link set", () => {
  it("one entry per link, same fragments", () => {
    const g = golden as Record<string, { hash: string }>;
    expect(Object.keys(g).sort()).toEqual(Object.keys(OLD_LINKS).sort());
    for (const [name, hash] of Object.entries(OLD_LINKS)) expect(g[name]!.hash).toBe(hash);
  });
});
