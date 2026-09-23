import { describe, expect, it } from "vitest";
import { mulberry32, sessionSeed, splitmix32 } from "./rng";

describe("rng", () => {
  it("mulberry32 is deterministic and in [0, 1)", () => {
    const a = mulberry32(99);
    const b = mulberry32(99);
    for (let i = 0; i < 10_000; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x >= 0 && x < 1).toBe(true);
    }
  });

  it("splitmix32 returns uint32", () => {
    for (const x of [0, 1, 0xffffffff, 123456789]) {
      const y = splitmix32(x);
      expect(Number.isInteger(y) && y >= 0 && y <= 0xffffffff).toBe(true);
    }
  });

  it("sessionSeed follows splitmix32(master ^ splitmix32(i)) and is not master + i", () => {
    expect(sessionSeed(5, 3)).toBe(splitmix32((5 ^ splitmix32(3)) >>> 0));
    const seeds = new Set<number>();
    for (let i = 0; i < 10_000; i++) {
      const s = sessionSeed(1000, i);
      expect(s).not.toBe(1000 + i);
      seeds.add(s);
    }
    expect(seeds.size).toBe(10_000);
  });
});
