import { describe, expect, it } from "vitest";

// Rules are DATA, never code (directive for URL-shared scenarios). Static scan, like the Math.random
// guard: no eval, no Function constructor, no dynamic import, no string timers anywhere a rule is
// validated, compiled, previewed, carried into the worker, or edited in the UI.
const sources = {
  ...import.meta.glob<string>("./*.ts", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob<string>("../../ui/rules/**/*.{ts,tsx}", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob<string>("../../worker/*.ts", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob<string>("../../scenario.ts", { query: "?raw", import: "default", eager: true }),
  // Session 7: scenario links (decoding untrusted URLs) and their browser glue.
  ...import.meta.glob<string>("../../share/**/*.ts", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob<string>("../../ui/linkBoot.ts", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob<string>("../../ui/LinkBanner.tsx", { query: "?raw", import: "default", eager: true }),
  ...import.meta.glob<string>("../../ui/RunControls.tsx", { query: "?raw", import: "default", eager: true }),
};

const BANNED: [string, RegExp][] = [
  ["eval", /\beval\s*\(/],
  ["indirect eval", /\[\s*["'`]eval["'`]\s*\]/],
  ["Function constructor", /\bFunction\s*\(/],
  ["new Function", /\bnew\s+Function\b/],
  ["dynamic import", /\bimport\s*\(/],
  ["string timer", /\bset(Timeout|Interval)\s*\(\s*["'`]/],
  ["constructor chain", /\.constructor\s*\(/],
];

describe("rules are data: no code evaluation in the rule pipeline", () => {
  it("scanned the rule compiler, the rule UI, the worker, the scenario and the link decoder", () => {
    const files = Object.keys(sources);
    expect(files).toContain("./compile.ts");
    expect(files).toContain("./validate.ts");
    expect(files).toContain("../../worker/sim.worker.ts");
    expect(files).toContain("../../scenario.ts");
    expect(files).toContain("../../share/link.ts");
    expect(files).toContain("../../share/compact.ts");
    expect(files).toContain("../../share/base64url.ts");
    expect(files).toContain("../../ui/linkBoot.ts");
  });

  for (const [file, src] of Object.entries(sources)) {
    if (file === "./noEval.test.ts") continue;
    it(`${file}: none of ${BANNED.map(([n]) => n).join(", ")}`, () => {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""); // ignore comments
      for (const [name, re] of BANNED) expect(code, name).not.toMatch(re);
    });
  }

  it("the scan catches each banned form (self-test)", () => {
    const samples = ['eval("1")', 'globalThis["eval"]', 'Function("return 1")', "new Function", 'import("./x")', 'setTimeout("x()", 1)', "x.constructor('return 1')"];
    samples.forEach((s, i) => expect(s).toMatch(BANNED[i]![1]));
  });
});
