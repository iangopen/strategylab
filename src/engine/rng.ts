// All engine randomness goes through this file. Math.random is banned in src/engine/.

/** Uniform draw in [0, 1). */
export type Rng = () => number;

/** splitmix32 finalizer: a well-mixed uint32 hash of a uint32 input. */
export function splitmix32(x: number): number {
  let z = (x + 0x9e3779b9) | 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
  return (z ^ (z >>> 16)) >>> 0;
}

/** mulberry32 PRNG. Returns uniform draws in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Seed for session i. NEVER masterSeed + i: adjacent mulberry32 seeds are correlated.
 * Every strategy uses the same seed for session i (common random numbers).
 */
export function sessionSeed(masterSeed: number, i: number): number {
  return splitmix32((masterSeed ^ splitmix32(i)) >>> 0);
}
