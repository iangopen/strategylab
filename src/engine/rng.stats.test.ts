import { describe, expect, it } from "vitest";
import { mulberry32, sessionSeed, type Rng } from "./rng";

// Chi-square goodness-of-fit test of uniformity: bucket the draws into equal-width bins and compare
// the counts with n / bins. Under a uniform generator the statistic follows chi-square with bins − 1
// degrees of freedom. The threshold is the upper 1e-4 quantile (Wilson–Hilferty approximation; for
// 99 degrees of freedom it gives 160.17, the exact value is 160.06), the chi-square counterpart of the
// 4 SE rule: a correct generator fails about once in 10,000 seeds, and the seeds here are fixed.
// It checks the marginal distribution only (not independence between draws); the EV invariant and
// CRN tests cover how the draws are used.

const BINS = 100;
const DF = BINS - 1;
const Z_1E4 = 3.719016; // standard normal upper 1e-4 quantile

function chiSquareThreshold(df: number, z = Z_1E4): number {
  const a = 2 / (9 * df);
  return df * (1 - a + z * Math.sqrt(a)) ** 3;
}

/** Chi-square statistic of n draws in BINS equal-width bins over [0, 1). Draws outside [0, 1) throw. */
function chiSquareUniform(next: () => number, n: number): number {
  const counts = new Float64Array(BINS);
  for (let i = 0; i < n; i++) {
    const u = next();
    if (!(u >= 0 && u < 1)) throw new Error(`draw ${i} is outside [0, 1): ${u}`);
    counts[Math.floor(u * BINS)]!++;
  }
  const expected = n / BINS;
  let x2 = 0;
  for (const c of counts) x2 += ((c - expected) * (c - expected)) / expected;
  return x2;
}

const N = 1_000_000;
const THRESHOLD = chiSquareThreshold(DF);

function report(name: string, x2: number): void {
  console.log(`[rng chi-square] ${name}: chi2 = ${x2.toFixed(2)}, df = ${DF}, threshold (p = 1e-4) = ${THRESHOLD.toFixed(2)}`);
}

/** The first draw of each session's generator: the stream that decides round 1 of every session. */
function firstDrawsAcrossSessions(master: number, seedOf: (master: number, i: number) => number): () => number {
  let i = 0;
  return () => mulberry32(seedOf(master, i++))();
}

/** Deliberately biased: u^1.05 leans toward 0 (51.65% of draws fall below 0.5 instead of 50%). */
const biasedStub = (rng: Rng): Rng => () => rng() ** 1.05;

describe("rng: chi-square goodness of fit (100 bins, 1,000,000 draws, threshold at p = 1e-4)", () => {
  it("the threshold matches the exact chi-square quantile to within 0.2", () => {
    expect(THRESHOLD).toBeGreaterThan(159.9);
    expect(THRESHOLD).toBeLessThan(160.3);
  });

  it("mulberry32: one long stream (seed 12345) is uniform", () => {
    const x2 = chiSquareUniform(mulberry32(12345), N);
    report("mulberry32 stream, seed 12345", x2);
    expect(x2).toBeLessThan(THRESHOLD);
  });

  it("sessionSeed: the first draw of sessions 0..999,999 (master 12345) is uniform", () => {
    const x2 = chiSquareUniform(firstDrawsAcrossSessions(12345, sessionSeed), N);
    report("first draw across 1,000,000 session seeds", x2);
    expect(x2).toBeLessThan(THRESHOLD);
  });

  it("the test has power: a biased stub (u^1.05) is rejected", () => {
    const x2 = chiSquareUniform(biasedStub(mulberry32(12345)), N);
    report("biased stub u^1.05", x2);
    expect(x2).toBeGreaterThan(THRESHOLD);
  });

  it("the test has power: a stub that never draws from [0.5, 0.51) is rejected", () => {
    const base = mulberry32(12345);
    const holed: Rng = () => {
      const u = base();
      return u >= 0.5 && u < 0.51 ? u - 0.01 : u;
    };
    const x2 = chiSquareUniform(holed, N);
    report("stub with an empty bin", x2);
    expect(x2).toBeGreaterThan(THRESHOLD);
  });
});
