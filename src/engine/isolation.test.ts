import { describe, expect, it } from "vitest";

// Raw source of every engine file (tests included), loaded through Vite so no node:fs is needed.
const sources = import.meta.glob<string>("./**/*.ts", { query: "?raw", import: "default", eager: true });

describe("engine isolation (rules 1 and 2)", () => {
  it("found the engine sources", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5);
  });

  for (const [file, src] of Object.entries(sources)) {
    if (file === "./isolation.test.ts") continue;
    it(`${file}: no Math.random, no React/DOM`, () => {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""); // ignore comments
      expect(code).not.toMatch(/Math\s*\.\s*random/);
      expect(code).not.toMatch(/from\s+["'](react|react-dom)(\/[^"']*)?["']/);
      expect(code).not.toMatch(/\b(document|window|localStorage)\./);
    });
  }
});
