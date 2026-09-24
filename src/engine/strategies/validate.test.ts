import { describe, expect, it } from "vitest";
import { kelly } from "./kelly";
import type { AnyStrategy } from "./types";
import { validateStrategyConfig } from "./validate";

describe("validateStrategyConfig: optionalNumber", () => {
  const fixture: AnyStrategy = {
    ...kelly,
    configSchema: [{ key: "p", label: "p", kind: "optionalNumber", min: 0.01, max: 0.99 }],
  } as AnyStrategy;

  it("blank (absent or undefined) is valid", () => {
    expect(validateStrategyConfig(fixture, {})).toEqual({});
    expect(validateStrategyConfig(fixture, { p: undefined })).toEqual({});
  });

  it("a number is checked against min and max at the boundaries", () => {
    expect(validateStrategyConfig(fixture, { p: 0.01 })).toEqual({});
    expect(validateStrategyConfig(fixture, { p: 0.99 })).toEqual({});
    expect(validateStrategyConfig(fixture, { p: 0 })).toEqual({ p: "Must be at least 0.01 (or blank)." });
    expect(validateStrategyConfig(fixture, { p: 1 })).toEqual({ p: "Must be at most 0.99 (or blank)." });
  });

  it("NaN, Infinity and non-numbers are rejected", () => {
    for (const p of [NaN, Infinity, "0.5", true]) expect(validateStrategyConfig(fixture, { p })).toEqual({ p: "Enter a number, or leave blank." });
  });

  it("Kelly's assumedWinProb is an optionalNumber, blank by default", () => {
    expect(kelly.configSchema.find((f) => f.key === "assumedWinProb")?.kind).toBe("optionalNumber");
    expect(kelly.defaultConfig).toEqual({ fraction: 1 });
    expect("assumedWinProb" in kelly.defaultConfig).toBe(false);
    expect(validateStrategyConfig(kelly, kelly.defaultConfig)).toEqual({});
    expect(validateStrategyConfig(kelly, { assumedWinProb: 0, fraction: 1 })).toEqual({ assumedWinProb: "Must be at least 0.01 (or blank)." });
  });
});
